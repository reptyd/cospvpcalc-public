//! Bridge between the composable engine and the
//! [`StanceDecision`](crate::policy::traits::StanceDecision) trait
//! family in `policy::`.
//!
//! Same pattern as `policy_bridge.rs` for the rest of the policy
//! framework: the engine implements the trait surface
//! ([`StanceSideView`], [`StanceReplayer`]) over its private
//! `LoopState` / `LoopParams` / `CombatSide` types so the decision
//! itself stays engine-agnostic and lives entirely in
//! `policy/decisions/stance.rs`.
//!
//! Entry point
//!
//! [`decide_stance_now`] is called from
//! `composable/loop_iter.rs::run_one_event_loop_iter` whenever the
//! posture-policy block fires for a side. It consults the
//! registered stance decision (today: the built-in
//! [`BuiltinStanceReplayDecision`]) and returns the engine-internal
//! `PostureAction` the state machine then applies.
//!
//! Recursion guard
//!
//! Each inner engine-replay inside a stance decision runs the loop
//! with `posture_policy_override: ForcedOff`, so
//! `run_one_event_loop_iter` does NOT call back into
//! `decide_stance_now` from the inner replay. Without this guard the
//! replay would explode exponentially (each candidate plan calling
//! `decide_stance_now` calling `replay_with_plan` calling
//! `decide_stance_now` ...).

use std::sync::OnceLock;

use crate::policy::decisions::stance::BuiltinStanceReplayDecision;
use crate::policy::traits::{
    toggle_commit_answer, StanceAction, StanceDecision, StancePosture, StanceReplayer,
    StanceReplayOutcome, StanceSideView, ToggleReplaySideView,
};

use super::loop_iter::{
    run_one_event_loop_iter, AbilityPolicyMode, DecideOverrideFn, DecideToggleOverrideFn, IterHooks,
    LoopOutcome, LoopParams, LoopState, PosturePolicyMode,
};
use super::posture::Posture;
use super::posture_policy::{
    compute_replay_fitness, PostureAction, POSTURE_BOUNDED_HORIZON, POSTURE_REPLAY_WINDOW_SEC,
    POSTURE_TREE_CHECKPOINT, REGEN_CADENCE_SEC, REPLAY_HORIZON_SEC, REPLAY_MAX_ITERS,
};
use super::side::CombatSide;
use crate::combat::effective_hp_regen_multiplier;

/// Singleton stance decision. Today the only registered stance
/// decision; future user/constructor-built stance decisions would
/// be wired through a `DecisionRegistry`-aware lookup the same way
/// the rest of the policy framework already does.
fn stance_decision() -> &'static dyn StanceDecision {
    static D: OnceLock<BuiltinStanceReplayDecision> = OnceLock::new();
    D.get_or_init(BuiltinStanceReplayDecision::new)
}

// Test-only recorder of the live policy's realized posture decisions.
// When armed, `decide_stance_now` appends every `(self_is_attacker,
// action)` it returns, in firing order. The oracle benchmark drains this
// to extract the policy's realized script and prove its ceiling
// tautologically (the script is one of the action-sequences the
// exhaustive oracle enumerates). Gated on `#[cfg(test)]`, so it is absent
// from the shipped wasm and the live decision path stays byte-identical.
#[cfg(test)]
thread_local! {
    static DECISION_RECORDER: std::cell::RefCell<Option<Vec<(bool, PostureAction)>>> =
        const { std::cell::RefCell::new(None) };
}

/// Arm the decision recorder, discarding any prior recording.
#[cfg(test)]
pub(super) fn arm_decision_recorder() {
    DECISION_RECORDER.with(|r| *r.borrow_mut() = Some(Vec::new()));
}

/// Disarm the recorder and return what it captured (empty if not armed).
#[cfg(test)]
pub(super) fn take_decision_recording() -> Vec<(bool, PostureAction)> {
    DECISION_RECORDER.with(|r| r.borrow_mut().take().unwrap_or_default())
}

// Test-only runtime override of `POSTURE_TREE_CHECKPOINT` (which is a
// compile-time const) so the decision-identity gate can capture flag-off
// vs flag-on in one process. `None` => use the const. Absent from shipped wasm.
#[cfg(test)]
thread_local! {
    static TREE_CHECKPOINT_OVERRIDE: std::cell::Cell<Option<bool>> = const { std::cell::Cell::new(None) };
}

/// Set (or clear) the test-only tree-checkpoint override.
#[cfg(test)]
pub(super) fn set_tree_checkpoint_override(v: Option<bool>) {
    TREE_CHECKPOINT_OVERRIDE.with(|c| c.set(v));
}

/// Whether posture<->toggle coordination is engaged. In shipped builds this is
/// exactly [`toggle_replay_bridge::toggle_rollout_enabled`] - both moves gate on
/// the toggle rollout, so with it off `decide_toggle_override` stays `None` and
/// no augmented candidate is emitted (byte-identical pi-zero path). A `#[cfg(test)]`
/// override lets the coordination experiment run the "both flags on,
/// coordination disabled" conflict arm.
#[cfg(not(test))]
#[inline(always)]
pub(super) fn coordination_enabled() -> bool {
    super::toggle_replay_bridge::toggle_rollout_enabled()
}

#[cfg(test)]
thread_local! {
    static COORDINATION_OVERRIDE: std::cell::Cell<Option<bool>> = const { std::cell::Cell::new(None) };
}

#[cfg(test)]
pub(super) fn coordination_enabled() -> bool {
    if !super::toggle_replay_bridge::toggle_rollout_enabled() {
        return false;
    }
    COORDINATION_OVERRIDE.with(|c| c.get()).unwrap_or(true)
}

/// Set (or clear) the test-only coordination override (experiment arm A1).
#[cfg(test)]
pub(super) fn set_coordination_override(v: Option<bool>) {
    COORDINATION_OVERRIDE.with(|c| c.set(v));
}

/// Which toggle plan the actor's toggles play inside a coordinated inner
/// replay's `decide_toggle_override`.
#[derive(Clone, Copy)]
enum ToggleSource {
    /// Move 1: the actor's committed plan tag - the shipped normal candidates
    /// see the toggle's ACTUAL committed plan instead of pi-zero.
    Committed,
    /// Move 2: the actor's optimistic feasible plan - the augmented "hold
    /// Standing" candidate.
    Optimistic,
}

/// Adapter exposing a `CombatSide` to [`ToggleReplaySideView`] so
/// [`toggle_commit_answer`] can resolve a plan tag at the replay moment.
struct ToggleSideView<'a> {
    side: &'a CombatSide,
}

impl ToggleReplaySideView for ToggleSideView<'_> {
    fn next_regen_at(&self) -> f64 {
        self.side.next_regen
    }
}

/// The augmented candidate's posture plan: hold Standing (stand up first if
/// mid-transition). Shared by the bounded and exact coordinated replays.
fn standing_plan(view: &dyn StanceSideView, _t: f64) -> StanceAction {
    if view.pending_posture() != StancePosture::Standing {
        StanceAction::StandUp
    } else {
        StanceAction::Stay
    }
}

/// Decide the posture action for `self_is_attacker`'s side at the
/// current `state.time`. Calls the registered stance decision with
/// engine-side adapters; translates the trait's [`StanceAction`]
/// back into the engine-internal [`PostureAction`] expected by
/// `apply_policy_action`.
pub(super) fn decide_stance_now(
    state: &mut LoopState,
    params: &LoopParams<'_>,
    self_is_attacker: bool,
) -> PostureAction {
    // Posture<->toggle coordination applies only when the toggle rollout is
    // engaged AND the actor carries a posture-gated toggle. Off => the shipped
    // pi-zero path (no committed-plan override, no augmented candidate).
    let coordinate = coordination_enabled()
        && super::toggle_replay_bridge::actor_has_coordinated_toggle(params, self_is_attacker);
    let replay_horizon = compute_replay_horizon(state.time, params.max_time_sec);
    let action;
    let coordinated_won;
    {
        let actor_side = if self_is_attacker { &state.a } else { &state.b };
        let view = CombatSideStanceView { side: actor_side };
        let mut replayer = LoopStateReplayer {
            state,
            params,
            self_is_attacker,
            replay_horizon,
            decision_start_time: state.time,
            // The live policy projects each candidate against a passive
            // opponent; a benchmark/oracle injects a declared opponent instead.
            opp_strategy: ReplayOpponent::Hold,
            coordinate,
            coordinated_won: std::cell::Cell::new(false),
        };
        action = stance_decision().decide(&view, state.time, &mut replayer);
        coordinated_won = replayer.coordinated_won.get();
    }
    // Move 2 handoff: the augmented standing+toggle candidate won => commit the
    // toggle's optimistic plan + advance its epoch on the actor's side, in this
    // same iteration, before the follower's `resolve` runs.
    if coordinated_won {
        super::toggle_replay_bridge::commit_coordinated_toggles(state, params, self_is_attacker);
    }
    let posture_action = stance_to_posture_action(action);
    #[cfg(test)]
    DECISION_RECORDER.with(|r| {
        if let Some(log) = r.borrow_mut().as_mut() {
            log.push((self_is_attacker, posture_action));
        }
    });
    posture_action
}

/// Compute the inner-replay horizon for a decision starting at
/// `decision_time`, capped at `max_time_sec`.
///
/// Flag OFF (default): exactly the shipped behavior -
/// `(decision_time + REPLAY_HORIZON_SEC).min(max_time_sec)` with
/// `REPLAY_HORIZON_SEC == f64::INFINITY`, i.e. the de-facto cap is
/// `max_time_sec` (replay the whole remaining fight). Byte-identical to
/// the prior inline expression.
///
/// Flag ON: a short cycle-aligned receding window. We take
/// `decision_time + POSTURE_REPLAY_WINDOW_SEC`, then round UP to land
/// one regen cadence (`REGEN_CADENCE_SEC`) PAST the last regen tick
/// that falls inside the raw window - so the windowed replay always
/// observes the complete settled-posture regen/incoming effect of
/// every tick it spans (the per-tick lay-before/stand-after gain the
/// curated cyclic plans encode). The result is still capped at
/// `max_time_sec`, so short fights see no change.
pub(super) fn compute_replay_horizon(decision_time: f64, max_time_sec: f64) -> f64 {
    if !POSTURE_BOUNDED_HORIZON {
        return (decision_time + REPLAY_HORIZON_SEC).min(max_time_sec);
    }
    let raw_edge = decision_time + POSTURE_REPLAY_WINDOW_SEC;
    // Number of whole regen cadences from the decision moment to the
    // raw edge, rounded UP, then one extra cadence so the window
    // strictly clears the last in-window tick by a full cycle.
    let cadences = ((raw_edge - decision_time) / REGEN_CADENCE_SEC).ceil() + 1.0;
    let aligned_edge = decision_time + cadences * REGEN_CADENCE_SEC;
    aligned_edge.min(max_time_sec)
}

/// Adapter exposing posture-relevant fields of a [`CombatSide`] to
/// the [`StanceSideView`] trait. Zero-cost - fields are read on
/// demand.
struct CombatSideStanceView<'a> {
    side: &'a CombatSide,
}

impl StanceSideView for CombatSideStanceView<'_> {
    fn pending_posture(&self) -> StancePosture {
        posture_to_stance(self.side.posture_pending)
    }
    fn next_regen_at(&self) -> f64 {
        self.side.next_regen
    }
    fn total_status_stacks(&self) -> f64 {
        self.side.statuses.values().map(|s| s.stacks).sum()
    }
}

/// What the opponent does at its own posture-decision moments inside an
/// inner replay. Parameterizing this is the seam that lets one replay
/// machinery serve both the live policy (which projects each candidate
/// against a passive opponent) and a benchmark/oracle that scores a policy
/// against a declared opponent instead of a frozen one.
#[derive(Clone, Copy)]
enum ReplayOpponent {
    /// Hold the current posture at every decision moment - the historical
    /// passive-standing assumption used by the live policy's projection.
    Hold,
}

impl ReplayOpponent {
    fn decide(self, _opp: &CombatSide, _t: f64) -> PostureAction {
        match self {
            ReplayOpponent::Hold => PostureAction::Stay,
        }
    }
}

/// Engine-replay primitive: clones the engine state, installs the
/// candidate `plan` as the posture-policy override, runs the real
/// engine forward with `posture_policy_override: ForcedOff` so the
/// inner replay never re-enters `decide_stance_now`, then scores
/// the outcome via [`compute_replay_fitness`].
struct LoopStateReplayer<'a> {
    state: &'a LoopState,
    params: &'a LoopParams<'a>,
    self_is_attacker: bool,
    replay_horizon: f64,
    /// Engine time at which this decision (and thus every candidate
    /// replay) starts. Used by the bounded-horizon terminal projection
    /// to measure the in-window elapsed time / incoming rate.
    decision_start_time: f64,
    /// The opponent's behaviour inside the inner replay. The live policy
    /// uses [`ReplayOpponent::Hold`] (the historical frozen passive
    /// opponent); a benchmark/oracle injects a declared opponent here.
    opp_strategy: ReplayOpponent,
    /// Posture<->toggle coordination is engaged for this decision (toggle rollout
    /// on + the actor carries a posture-gated toggle). Gates Move 1's
    /// committed-plan toggle override in every inner replay and Move 2's
    /// augmented standing candidate.
    coordinate: bool,
    /// Move 2 handoff signal: set by [`StanceReplayer::note_coordinated_winner`]
    /// when the augmented candidate wins, read back by [`decide_stance_now`].
    coordinated_won: std::cell::Cell<bool>,
}

impl LoopStateReplayer<'_> {
    /// Core inner replay shared by all `StanceReplayer` entry points.
    /// Runs the real engine forward to `horizon`, then - only when
    /// `project` is true AND the replay stopped AT the window edge with
    /// both sides alive - extrapolates to `max_time_sec` via
    /// [`project_terminal_state`]. Returns the end-state tuple in the
    /// shape [`compute_replay_fitness`] consumes.
    ///
    /// With the feature flag OFF every caller passes
    /// `horizon == self.replay_horizon` (INFINITY-capped at
    /// `max_time_sec`) and `project == false`, so this returns the true
    /// engine end-state - byte-identical to the prior inline body.
    fn run_replay(
        &self,
        plan: &dyn Fn(&dyn StanceSideView, f64) -> StanceAction,
        horizon: f64,
        project: bool,
        toggle_source: ToggleSource,
    ) -> (f64, f64, Option<f64>, Option<f64>, Option<f64>, Option<f64>) {
        let self_is_attacker = self.self_is_attacker;
        let opp_strategy = self.opp_strategy;
        // The override is consulted at each scheduled posture
        // decision moment inside the inner replay. Re-build the
        // StanceSideView on the live CombatSide at that moment so
        // dynamic plans (cyclic-*, status-decay, alternating-*) see
        // up-to-date next_regen / status stacks / pending posture.
        let override_fn: Box<DecideOverrideFn> = Box::new(
            move |ask_self: &CombatSide,
                  opp: &CombatSide,
                  t: f64,
                  is_attacker: bool|
                  -> Option<PostureAction> {
                if is_attacker != self_is_attacker {
                    return Some(opp_strategy.decide(opp, t));
                }
                let live_view = CombatSideStanceView { side: ask_self };
                Some(stance_to_posture_action(plan(&live_view, t)))
            },
        );
        // Move 1/2: the actor's toggles play their committed (normal candidates)
        // or optimistic (augmented candidate) plan; the opponent stays pi-zero.
        // `None` when coordination is off => the shipped pi-zero-everywhere replay.
        let toggle_ov = self.toggle_override(toggle_source);

        let inner_params = LoopParams {
            attacker: self.params.attacker,
            defender: self.params.defender,
            attacker_breath: self.params.attacker_breath,
            defender_breath: self.params.defender_breath,
            config: self.params.config,
            flags: self.params.flags,
            ability_policy: self.params.ability_policy,
            event_phase_order: self.params.event_phase_order,
            record_trace: false,
            max_time_sec: horizon,
            bench_count: false,
            posture_policy_override: PosturePolicyMode::Normal,
            iter_hooks: IterHooks::default(),
            decide_override: Some(&override_fn),
            decide_override_respects_schedule: true,
            decide_bite_variant_override: self.params.decide_bite_variant_override,
            decide_toggle_override: toggle_ov.as_deref(),
            // pi-zero fix: with the Fortify or toggle rollout on, force those
            // abilities to their gate inside the posture inner replay so they
            // can't nest their own rollout. Both flags off => Normal =>
            // byte-identical.
            ability_policy_mode: if super::fortify_rollout_bridge::fortify_rollout_enabled()
                || super::toggle_replay_bridge::toggle_rollout_enabled()
            {
                AbilityPolicyMode::GateOnly
            } else {
                AbilityPolicyMode::Normal
            },
        };

        let mut cloned = self.state.clone();
        cloned.same_time_processed_phases = 0;

        let mut iter_count: u32 = 0;
        while cloned.time + 1e-9 < horizon
            && (cloned.a.death_time.is_none() || cloned.b.death_time.is_none())
            && iter_count < REPLAY_MAX_ITERS
        {
            #[cfg(test)]
            let time_before = cloned.time;
            match run_one_event_loop_iter(&mut cloned, &inner_params) {
                LoopOutcome::Break | LoopOutcome::BoundExceeded => break,
                LoopOutcome::Continue | LoopOutcome::Advanced => {}
            }
            iter_count += 1;
            // Per-iteration crawl snapshot (test-only). `cloned.time` AFTER the
            // iter is the real `next_time` the scheduler advanced to, measured
            // empirically (no reproduction of the private scheduler min). Every
            // candidate value below is read straight off the post-iter state.
            #[cfg(test)]
            {
                let aura = |t: Option<f64>| t.unwrap_or(f64::INFINITY);
                let stk = |s: &CombatSide| {
                    s.statuses.get("Healing_Ailment").map(|x| x.stacks).unwrap_or(0.0)
                };
                let posture_next_a = if inner_params.config.attacker_posture_policy_enabled {
                    cloned.a.posture_next_decision_at
                } else {
                    f64::INFINITY
                };
                let posture_next_b = if inner_params.config.defender_posture_policy_enabled {
                    cloned.b.posture_next_decision_at
                } else {
                    f64::INFINITY
                };
                crate::composable::oracle::record_crawl_snap(
                    crate::composable::oracle::CrawlSnap {
                        iter_index: iter_count,
                        time_before,
                        next_time: cloned.time,
                        a_next_hit: cloned.a.next_hit,
                        b_next_hit: cloned.b.next_hit,
                        a_next_breath: cloned.a.next_breath,
                        b_next_breath: cloned.b.next_breath,
                        a_next_regen: cloned.a.next_regen,
                        b_next_regen: cloned.b.next_regen,
                        a_next_status_tick: cloned.a.next_status_tick(),
                        b_next_status_tick: cloned.b.next_status_tick(),
                        a_next_status_decay: cloned.a.next_status_decay(cloned.time),
                        b_next_status_decay: cloned.b.next_status_decay(cloned.time),
                        a_next_lance_aura: cloned.a.next_lance_aura_tick(),
                        b_next_lance_aura: cloned.b.next_lance_aura_tick(),
                        a_next_self_destruct: cloned.a.next_self_destruct_event(),
                        b_next_self_destruct: cloned.b.next_self_destruct_event(),
                        posture_next_a,
                        posture_next_b,
                        a_next_healing_pulse: cloned.a.next_healing_pulse,
                        b_next_healing_pulse: cloned.b.next_healing_pulse,
                        a_healing_ailment_tick: aura(cloned.a.healing_ailment_next_tick_at),
                        b_healing_ailment_tick: aura(cloned.b.healing_ailment_next_tick_at),
                        a_aura_tick: aura(cloned.a.aura_next_tick_at),
                        b_aura_tick: aura(cloned.b.aura_next_tick_at),
                        a_healing_step_tick: aura(cloned.a.healing_step_next_tick_at),
                        b_healing_step_tick: aura(cloned.b.healing_step_next_tick_at),
                        a_damage_trail_tick: aura(cloned.a.damage_trail_next_tick_at),
                        b_damage_trail_tick: aura(cloned.b.damage_trail_next_tick_at),
                        a_toxic_trap_tick: aura(cloned.a.toxic_trap_next_tick_at),
                        b_toxic_trap_tick: aura(cloned.b.toxic_trap_next_tick_at),
                        a_death: cloned.a.death_time,
                        b_death: cloned.b.death_time,
                        a_hp: cloned.a.hp,
                        b_hp: cloned.b.hp,
                        a_heal_ail_stacks: stk(&cloned.a),
                        b_heal_ail_stacks: stk(&cloned.b),
                    },
                );
            }
        }
        #[cfg(test)]
        {
            let both_dead = cloned.a.death_time.is_some() && cloned.b.death_time.is_some();
            let capped = iter_count >= REPLAY_MAX_ITERS;
            crate::composable::oracle::note_replay(
                project,
                both_dead,
                capped,
                iter_count as u64,
                cloned.time - self.decision_start_time,
            );
            if capped {
                let stk = |s: &CombatSide| {
                    s.statuses.get("Healing_Ailment").map(|x| x.stacks).unwrap_or(0.0)
                };
                crate::composable::oracle::dump_capped_once(
                    self.decision_start_time,
                    cloned.time,
                    cloned.a.next_healing_pulse,
                    cloned.a.healing_pulse_cooldown_until,
                    cloned.a.healing_ailment_next_tick_at,
                    stk(&cloned.a),
                    cloned.b.next_healing_pulse,
                    cloned.b.healing_pulse_cooldown_until,
                    cloned.b.healing_ailment_next_tick_at,
                    stk(&cloned.b),
                );
                // Flush the per-iteration crawl ring for this capped replay
                // (only the first SNAP_MAX_REPLAYS are printed).
                crate::composable::oracle::flush_crawl_snap_if_capped(
                    self.decision_start_time,
                    cloned.time,
                    iter_count,
                );
            } else {
                // Not capped: drop the ring so it does not leak into the next
                // (possibly capped) replay's snapshot.
                crate::composable::oracle::discard_crawl_snap();
            }
        }

        self.score_endstate(&cloned, horizon, project)
    }

    /// Build the `decide_toggle_override` for an inner posture replay. With
    /// coordination engaged, the actor's toggles play `source` (their committed
    /// plan tag for the normal candidates, their optimistic feasible plan for
    /// the augmented candidate) while the opponent's toggles stay pi-zero; otherwise
    /// `None` => the shipped pi-zero-everywhere path (byte-identical). The toggle
    /// bridge's `resolve` short-circuits on `decide_toggle_override.is_some()`,
    /// so no nested toggle replay runs.
    fn toggle_override(&self, source: ToggleSource) -> Option<Box<DecideToggleOverrideFn<'static>>> {
        if !self.coordinate {
            return None;
        }
        let self_is_attacker = self.self_is_attacker;
        Some(Box::new(
            move |id: &'static str, actor: &CombatSide, t: f64, is_attacker: bool| -> Option<bool> {
                if is_attacker != self_is_attacker {
                    return None; // opponent toggle stays pi-zero
                }
                let plan = match source {
                    ToggleSource::Committed => {
                        super::toggle_replay_bridge::committed_plan_for_id(actor, id)
                    }
                    ToggleSource::Optimistic => {
                        super::toggle_replay_bridge::optimistic_plan_for_id(id)
                    }
                };
                plan.map(|c| toggle_commit_answer(c, &ToggleSideView { side: actor }, t))
            },
        ))
    }

    /// Score a finished (or window-edge-stopped) inner-replay end-state into
    /// the tuple [`compute_replay_fitness`] consumes. Applies the
    /// bounded-horizon terminal projection only when `project` is set AND the
    /// replay stopped AT the window edge with both sides alive; otherwise
    /// returns the true engine end-state. Extracted from [`run_replay`] so the
    /// checkpoint DFS scores its leaves through the identical path -
    /// byte-identical to the prior inline body.
    fn score_endstate(
        &self,
        cloned: &LoopState,
        horizon: f64,
        project: bool,
    ) -> (f64, f64, Option<f64>, Option<f64>, Option<f64>, Option<f64>) {
        let self_is_attacker = self.self_is_attacker;
        let stopped_at_window_edge = project
            && cloned.a.death_time.is_none()
            && cloned.b.death_time.is_none()
            && cloned.time + 1e-6 < self.params.max_time_sec
            && cloned.time + 1e-6 >= horizon;

        if stopped_at_window_edge {
            let edge_posture_self = if self_is_attacker {
                cloned.a.posture_current
            } else {
                cloned.b.posture_current
            };
            let edge_posture_opp = if self_is_attacker {
                cloned.b.posture_current
            } else {
                cloned.a.posture_current
            };
            return project_terminal_state(
                cloned,
                self.params,
                self.state,
                self.decision_start_time,
                edge_posture_self,
                edge_posture_opp,
                self_is_attacker,
            );
        }

        (
            cloned.a.hp.max(0.0),
            cloned.b.hp.max(0.0),
            cloned.a.death_time,
            cloned.b.death_time,
            cloned.hp_a_at_b_death,
            cloned.hp_b_at_a_death,
        )
    }

    /// Advance the inner replay from a decision-boundary checkpoint by ONE
    /// decision interval: apply `action_first` at the first actor decision
    /// reached, then Stay. With `stop_at_next_decision`, return
    /// [`Segment::Boundary`] holding the checkpoint positioned BEFORE the iter
    /// that fires the NEXT actor decision - a pure prefix of the uninterrupted
    /// replay, so resuming from it is byte-identical. Without it, run to the
    /// horizon and return [`Segment::Terminal`]. `iters_used` threads the
    /// cumulative per-path iteration budget so the `REPLAY_MAX_ITERS` cap
    /// matches the uninterrupted replay; the returned count excludes the
    /// boundary iter (it belongs to the child's segment).
    fn advance_segment(
        &self,
        mut state: LoopState,
        action_first: StanceAction,
        horizon: f64,
        mut iters_used: u32,
        stop_at_next_decision: bool,
    ) -> (Segment, u32) {
        let self_is_attacker = self.self_is_attacker;
        let opp_strategy = self.opp_strategy;
        let action_first_pa = stance_to_posture_action(action_first);
        let my_fire = std::rc::Rc::new(std::cell::Cell::new(0u32));
        let my_fire_cl = my_fire.clone();
        // Mirror make_quad_plan: return the action on the FIRST actor
        // consultation, Stay after - ignoring the side view, exactly as the
        // nested-loop quad plan does.
        let override_fn: Box<DecideOverrideFn> = Box::new(
            move |_ask_self: &CombatSide, opp: &CombatSide, t: f64, is_attacker: bool| -> Option<PostureAction> {
                if is_attacker != self_is_attacker {
                    return Some(opp_strategy.decide(opp, t));
                }
                let n = my_fire_cl.get();
                my_fire_cl.set(n + 1);
                if n == 0 {
                    Some(action_first_pa)
                } else {
                    Some(PostureAction::Stay)
                }
            },
        );
        // Move 1: the tree-search candidates run the actor's committed toggle
        // plan (same as `run_replay`); `None` when coordination is off.
        let toggle_ov = self.toggle_override(ToggleSource::Committed);
        let inner_params = LoopParams {
            attacker: self.params.attacker,
            defender: self.params.defender,
            attacker_breath: self.params.attacker_breath,
            defender_breath: self.params.defender_breath,
            config: self.params.config,
            flags: self.params.flags,
            ability_policy: self.params.ability_policy,
            event_phase_order: self.params.event_phase_order,
            record_trace: false,
            max_time_sec: horizon,
            bench_count: false,
            posture_policy_override: PosturePolicyMode::Normal,
            iter_hooks: IterHooks::default(),
            decide_override: Some(&override_fn),
            decide_override_respects_schedule: true,
            decide_bite_variant_override: self.params.decide_bite_variant_override,
            decide_toggle_override: toggle_ov.as_deref(),
            // pi-zero fix: see `run_replay`.
            ability_policy_mode: if super::fortify_rollout_bridge::fortify_rollout_enabled()
                || super::toggle_replay_bridge::toggle_rollout_enabled()
            {
                AbilityPolicyMode::GateOnly
            } else {
                AbilityPolicyMode::Normal
            },
        };
        loop {
            // Same termination as `run_replay`'s while-condition.
            if !(state.time + 1e-9 < horizon
                && (state.a.death_time.is_none() || state.b.death_time.is_none())
                && iters_used < REPLAY_MAX_ITERS)
            {
                return (Segment::Terminal(Box::new(state)), iters_used);
            }
            // The boundary is the SECOND actor decision, so a checkpoint clone
            // is only needed once the first has fired.
            let pre = if stop_at_next_decision && my_fire.get() >= 1 {
                Some(state.clone())
            } else {
                None
            };
            match run_one_event_loop_iter(&mut state, &inner_params) {
                LoopOutcome::Break | LoopOutcome::BoundExceeded => {
                    return (Segment::Terminal(Box::new(state)), iters_used)
                }
                LoopOutcome::Continue | LoopOutcome::Advanced => {}
            }
            iters_used += 1;
            if stop_at_next_decision && my_fire.get() >= 2 {
                return (
                    Segment::Boundary(Box::new(
                        pre.expect("pre is cloned once the first decision has fired"),
                    )),
                    iters_used - 1,
                );
            }
        }
    }

    /// Score a finished inner-replay end-state into the [`StanceReplayOutcome`]
    /// the tree recorder consumes - identical to `replay_with_plan_detailed`.
    fn outcome_from_endstate(
        &self,
        end: &LoopState,
        horizon: f64,
        project: bool,
    ) -> crate::policy::traits::StanceReplayOutcome {
        let (a_hp, b_hp, a_death, b_death, hp_a_at_b_death, hp_b_at_a_death) =
            self.score_endstate(end, horizon, project);
        let fitness = compute_replay_fitness(
            a_hp, b_hp, a_death, b_death, hp_a_at_b_death, hp_b_at_a_death, self.self_is_attacker,
        );
        let (me_death, op_death) = if self.self_is_attacker {
            (a_death, b_death)
        } else {
            (b_death, a_death)
        };
        crate::policy::traits::StanceReplayOutcome { fitness, me_death, op_death }
    }

    /// Record every completion `(prefix[..from_depth], *, ...)` with the same
    /// `outcome`: when the replay ended within an interval the deeper actions
    /// don't change the trajectory, so all completions share the end-state -
    /// matching the nested loop's identical-fitness candidates with distinct
    /// `kind` tuples. Lexicographic order.
    fn record_terminal_subtree(
        &self,
        prefix: &mut [StanceAction; 4],
        from_depth: usize,
        outcome: crate::policy::traits::StanceReplayOutcome,
        record: &mut dyn FnMut(
            StanceAction,
            StanceAction,
            StanceAction,
            StanceAction,
            crate::policy::traits::StanceReplayOutcome,
        ),
    ) {
        if from_depth >= 4 {
            record(prefix[0], prefix[1], prefix[2], prefix[3], outcome);
            return;
        }
        for &a in &TREE_ACTIONS_STANCE {
            prefix[from_depth] = a;
            self.record_terminal_subtree(prefix, from_depth + 1, outcome, record);
        }
    }

    /// MY-side pending posture at a checkpoint - the key for the no-op branch
    /// collapse. By the settle-invariance lemma (`process_posture_settle`
    /// mutates only `posture_current`), the pending read at the checkpoint
    /// equals the pending at the decision the override is about to drive.
    fn actor_pending_posture(&self, state: &LoopState) -> StancePosture {
        let side = if self.self_is_attacker { &state.a } else { &state.b };
        posture_to_stance(side.posture_pending)
    }

    /// Depth-4 shared-prefix tree DFS with the no-op branch collapse. At each
    /// node, fork the checkpoint per action and advance one decision interval;
    /// recurse to depth 3, then finish the tail and score. Leaves are visited
    /// in the SAME lexicographic order as the nested loops with the identical
    /// per-leaf outcome.
    ///
    /// Collapse: at a node with MY pending posture `P`, exactly one non-Stay
    /// action is a no-op (`StandUp@Standing`, `StartSit@Sitting`,
    /// `StartLay@Laying` route through `request_posture_transition`'s
    /// `pending == target` early-return - byte-identical to applying Stay). Its
    /// entire subtree equals the Stay subtree, so rather than re-simulate it we
    /// REUSE the Stay subtree's leaves with that slot swapped (record-but-skip):
    /// the candidate set keeps identical length, order and fitness (so the
    /// death-race top-2 is untouched), while the redundant ~1-of-4 branch of
    /// engine work is skipped. The `kind` tuple carries the no-op action; the
    /// death-race gate re-runs it from t=0 reaching the SAME pending (same
    /// deterministic prefix) so it stays a no-op there too - identical fitness.
    #[allow(clippy::too_many_arguments)]
    fn tree_dfs(
        &self,
        checkpoint: &LoopState,
        prefix: &mut [StanceAction; 4],
        depth: usize,
        iters_used: u32,
        horizon: f64,
        project: bool,
        record: &mut dyn FnMut(
            StanceAction,
            StanceAction,
            StanceAction,
            StanceAction,
            crate::policy::traits::StanceReplayOutcome,
        ),
    ) {
        let pending = self.actor_pending_posture(checkpoint);
        // Leaves of the Stay subtree at this node, captured so the no-op action
        // (later in TREE_ACTIONS order) can re-emit them with its slot swapped.
        let mut stay_leaves: Vec<([StanceAction; 4], crate::policy::traits::StanceReplayOutcome)> =
            Vec::new();
        for &a in &TREE_ACTIONS_STANCE {
            prefix[depth] = a;
            // No-op non-Stay action: reuse the Stay subtree's leaves verbatim.
            if a != StanceAction::Stay && is_noop_stance(a, pending) {
                for (tup, outcome) in &stay_leaves {
                    let mut t = *tup;
                    t[depth] = a;
                    record(t[0], t[1], t[2], t[3], *outcome);
                }
                continue;
            }
            let capture = a == StanceAction::Stay;
            if depth == 3 {
                let (seg, _iu) =
                    self.advance_segment(checkpoint.clone(), a, horizon, iters_used, false);
                let (Segment::Terminal(end) | Segment::Boundary(end)) = seg;
                let outcome = self.outcome_from_endstate(&end, horizon, project);
                if capture {
                    stay_leaves.push((*prefix, outcome));
                }
                record(prefix[0], prefix[1], prefix[2], prefix[3], outcome);
            } else {
                let (seg, iu) =
                    self.advance_segment(checkpoint.clone(), a, horizon, iters_used, true);
                if capture {
                    let mut wrap =
                        |a0: StanceAction,
                         a1: StanceAction,
                         a2: StanceAction,
                         a3: StanceAction,
                         o: crate::policy::traits::StanceReplayOutcome| {
                            stay_leaves.push(([a0, a1, a2, a3], o));
                            record(a0, a1, a2, a3, o);
                        };
                    match seg {
                        Segment::Boundary(next) => {
                            self.tree_dfs(&next, prefix, depth + 1, iu, horizon, project, &mut wrap)
                        }
                        Segment::Terminal(end) => {
                            let outcome = self.outcome_from_endstate(&end, horizon, project);
                            self.record_terminal_subtree(prefix, depth + 1, outcome, &mut wrap)
                        }
                    }
                } else {
                    match seg {
                        Segment::Boundary(next) => {
                            self.tree_dfs(&next, prefix, depth + 1, iu, horizon, project, record)
                        }
                        Segment::Terminal(end) => {
                            let outcome = self.outcome_from_endstate(&end, horizon, project);
                            self.record_terminal_subtree(prefix, depth + 1, outcome, record)
                        }
                    }
                }
            }
        }
    }
}

/// Whether `a` is a no-op given the actor's pending posture `pending` -
/// `request_posture_transition` early-returns when `pending == target`, making
/// the action byte-identical to Stay. (Stay itself is trivially a no-op.)
fn is_noop_stance(a: StanceAction, pending: StancePosture) -> bool {
    match a {
        StanceAction::Stay => true,
        StanceAction::StandUp => pending == StancePosture::Standing,
        StanceAction::StartSit => pending == StancePosture::Sitting,
        StanceAction::StartLay => pending == StancePosture::Laying,
    }
}

/// Result of advancing the tree DFS one decision interval.
enum Segment {
    /// Checkpoint positioned BEFORE the iter that fires the next actor
    /// decision - a pure prefix of the uninterrupted replay.
    Boundary(Box<LoopState>),
    /// The replay terminated (death / horizon / iter cap) within the interval.
    Terminal(Box<LoopState>),
}

/// Tree-search action order - MUST match `stance::TREE_ACTIONS` so the DFS
/// visits leaves in the identical lexicographic order (tie identity).
const TREE_ACTIONS_STANCE: [StanceAction; 4] = [
    StanceAction::Stay,
    StanceAction::StartSit,
    StanceAction::StartLay,
    StanceAction::StandUp,
];

impl StanceReplayer for LoopStateReplayer<'_> {
    fn replay_with_plan(
        &mut self,
        plan: &dyn Fn(&dyn StanceSideView, f64) -> StanceAction,
    ) -> f64 {
        // Flag OFF: horizon is INFINITY-capped, `project = false` =>
        // exact engine end-state, byte-identical to the shipped path.
        // Flag ON: bounded window + terminal projection.
        let (a_hp, b_hp, a_death, b_death, hp_a_at_b_death, hp_b_at_a_death) =
            self.run_replay(plan, self.replay_horizon, POSTURE_BOUNDED_HORIZON, ToggleSource::Committed);
        compute_replay_fitness(
            a_hp,
            b_hp,
            a_death,
            b_death,
            hp_a_at_b_death,
            hp_b_at_a_death,
            self.self_is_attacker,
        )
    }

    fn bounded_mode(&self) -> bool {
        POSTURE_BOUNDED_HORIZON
    }

    fn tree_checkpoint_mode(&self) -> bool {
        #[cfg(test)]
        if let Some(v) = TREE_CHECKPOINT_OVERRIDE.with(|c| c.get()) {
            return v;
        }
        POSTURE_TREE_CHECKPOINT
    }

    fn tree_search_checkpointed(
        &mut self,
        record: &mut dyn FnMut(
            StanceAction,
            StanceAction,
            StanceAction,
            StanceAction,
            crate::policy::traits::StanceReplayOutcome,
        ),
    ) -> bool {
        let horizon = self.replay_horizon;
        let project = POSTURE_BOUNDED_HORIZON;
        let mut root = self.state.clone();
        root.same_time_processed_phases = 0;
        let mut prefix = [StanceAction::Stay; 4];
        self.tree_dfs(&root, &mut prefix, 0, 0, horizon, project, record);
        true
    }

    fn replay_with_plan_detailed(
        &mut self,
        plan: &dyn Fn(&dyn StanceSideView, f64) -> StanceAction,
    ) -> crate::policy::traits::StanceReplayOutcome {
        let (a_hp, b_hp, a_death, b_death, hp_a_at_b_death, hp_b_at_a_death) =
            self.run_replay(plan, self.replay_horizon, true, ToggleSource::Committed);
        let fitness = compute_replay_fitness(
            a_hp,
            b_hp,
            a_death,
            b_death,
            hp_a_at_b_death,
            hp_b_at_a_death,
            self.self_is_attacker,
        );
        // Map A/B deaths onto the actor's (me) / opponent's (op) frame.
        let (me_death, op_death) = if self.self_is_attacker {
            (a_death, b_death)
        } else {
            (b_death, a_death)
        };
        crate::policy::traits::StanceReplayOutcome {
            fitness,
            me_death,
            op_death,
        }
    }

    fn replay_with_plan_exact(
        &mut self,
        plan: &dyn Fn(&dyn StanceSideView, f64) -> StanceAction,
    ) -> f64 {
        // Death-race confirmation gate: re-run at the FULL unbounded
        // (INFINITY-capped) horizon with NO terminal projection, so the
        // who-died-last trade is decided by the exact engine.
        let exact_horizon = (self.decision_start_time + REPLAY_HORIZON_SEC).min(self.params.max_time_sec);
        let (a_hp, b_hp, a_death, b_death, hp_a_at_b_death, hp_b_at_a_death) =
            self.run_replay(plan, exact_horizon, false, ToggleSource::Committed);
        compute_replay_fitness(
            a_hp,
            b_hp,
            a_death,
            b_death,
            hp_a_at_b_death,
            hp_b_at_a_death,
            self.self_is_attacker,
        )
    }

    fn has_coordinated_toggle(&self) -> bool {
        self.coordinate
    }

    fn replay_coordinated_standing(&mut self) -> StanceReplayOutcome {
        // Bounded window (project = true) with the actor's toggle forced to its
        // optimistic feasible plan - the value that only materializes while
        // Standing, invisible to every committed-Off standing candidate.
        let (a_hp, b_hp, a_death, b_death, hp_a_at_b_death, hp_b_at_a_death) =
            self.run_replay(&standing_plan, self.replay_horizon, true, ToggleSource::Optimistic);
        let fitness = compute_replay_fitness(
            a_hp,
            b_hp,
            a_death,
            b_death,
            hp_a_at_b_death,
            hp_b_at_a_death,
            self.self_is_attacker,
        );
        let (me_death, op_death) = if self.self_is_attacker {
            (a_death, b_death)
        } else {
            (b_death, a_death)
        };
        StanceReplayOutcome { fitness, me_death, op_death }
    }

    fn replay_coordinated_standing_exact(&mut self) -> f64 {
        let exact_horizon =
            (self.decision_start_time + REPLAY_HORIZON_SEC).min(self.params.max_time_sec);
        let (a_hp, b_hp, a_death, b_death, hp_a_at_b_death, hp_b_at_a_death) =
            self.run_replay(&standing_plan, exact_horizon, false, ToggleSource::Optimistic);
        compute_replay_fitness(
            a_hp,
            b_hp,
            a_death,
            b_death,
            hp_a_at_b_death,
            hp_b_at_a_death,
            self.self_is_attacker,
        )
    }

    fn note_coordinated_winner(&self, won: bool) {
        self.coordinated_won.set(won);
    }
}

/// Per-side scalar projection state carried through the terminal
/// extrapolation loop.
struct SideProjection {
    hp: f64,
    max_hp: f64,
    health_regen: f64,
    regen_mult: f64,
    /// Persistent (posture-priced) incoming damage per second - the
    /// part of the in-window incoming rate that keeps flowing past the
    /// window (bites / breath, already carrying the settled-posture
    /// xincoming multiplier via the engine's counter accounting).
    persistent_rate: f64,
    /// Remaining DoT damage budget estimated from the statuses present
    /// at the window edge. Decremented as it is applied each step so
    /// finite DoTs do not over-charge the tail (the "decay any
    /// remaining DoT by step" requirement).
    dot_budget: f64,
    /// Real stats clone - passed straight into
    /// `effective_hp_regen_multiplier` so the projected regen honors
    /// Quick Recovery's HP-ratio threshold per step.
    stats: crate::contracts::SimpleCombatantStats,
    /// Statuses snapshot at the window edge - used to recompute the
    /// passive regen multiplier (status modifiers) per projected HP.
    statuses: std::collections::BTreeMap<String, crate::contracts::SimpleStatusInstance>,
    death_time: Option<f64>,
}

impl SideProjection {
    fn build(
        side: &CombatSide,
        stats: &crate::contracts::SimpleCombatantStats,
        edge_posture: Posture,
        in_window_incoming: f64,
        elapsed: f64,
    ) -> Self {
        // Split the measured in-window incoming rate into a finite-DoT
        // budget and a persistent (posture-priced) remainder. The DoT
        // budget is the damage the statuses present at the edge are
        // still expected to deal after the window; the persistent rate
        // is what is left of the in-window average once that DoT
        // contribution is removed, so we do not double-count DoT both
        // as a flat rate AND as a decaying budget.
        let dot_budget = estimate_remaining_dot(&side.statuses, stats.health);
        let in_window_dot = estimate_remaining_dot_window(&side.statuses, stats.health, elapsed);
        let total_rate = if elapsed > 1e-9 {
            in_window_incoming / elapsed
        } else {
            0.0
        };
        let dot_rate = if elapsed > 1e-9 {
            in_window_dot / elapsed
        } else {
            0.0
        };
        let persistent_rate = (total_rate - dot_rate).max(0.0);
        let regen_mult = if super::posture::is_settled_non_standing(edge_posture, edge_posture) {
            super::posture::settled_regen_mult(edge_posture)
        } else {
            1.0
        };
        Self {
            hp: side.hp.max(0.0),
            max_hp: stats.health.max(1.0),
            health_regen: stats.health_regen.max(0.0),
            regen_mult,
            persistent_rate,
            dot_budget,
            stats: stats.clone(),
            statuses: side.statuses.clone(),
            death_time: None,
        }
    }

    /// Advance the projected HP by `step` seconds ending at `t_end`.
    /// Applies persistent incoming, the decaying DoT budget, and
    /// HP-fraction-dependent regen recomputed at the CURRENT HP. On a
    /// zero-crossing, interpolates the death timestamp within the step.
    fn step(&mut self, step: f64, t_end: f64) {
        if self.death_time.is_some() || step <= 0.0 {
            return;
        }
        let hp_before = self.hp;
        // Persistent posture-priced incoming for this step.
        let persistent = self.persistent_rate * step;
        // DoT slice: drain the finite budget over the tail. One regen
        // cadence per step drains at most one cadence-worth of budget;
        // the budget is clamped non-negative so finite DoTs stop once
        // exhausted (the "decay any remaining DoT by step" requirement).
        let dot_step = self
            .dot_budget
            .min(self.dot_budget * (step / REGEN_CADENCE_SEC).min(1.0));
        self.dot_budget = (self.dot_budget - dot_step).max(0.0);
        // Regen recomputed at the pre-step (CURRENT) HP - HP-fraction
        // dependent via Quick Recovery, never frozen - scaled by the
        // settled-posture regen mult. health_regen is a per-cadence %,
        // so scale by step/cadence.
        let regen_passive = effective_hp_regen_multiplier(&self.stats, self.hp, &self.statuses);
        let heal = self.max_hp * self.health_regen * regen_passive / 100.0 * self.regen_mult
            * (step / REGEN_CADENCE_SEC);
        let net = heal - persistent - dot_step;
        self.hp = (self.hp + net).clamp(0.0, self.max_hp);
        if self.hp <= 0.0 && hp_before > 0.0 {
            // Interpolate the death moment within [t_end - step, t_end].
            let total_loss = (persistent + dot_step) - heal;
            let frac = if total_loss > 1e-9 {
                (hp_before / total_loss).clamp(0.0, 1.0)
            } else {
                1.0
            };
            self.death_time = Some(t_end - step + frac * step);
        }
    }
}

/// Estimate the total DoT damage the statuses present at the window
/// edge are still expected to deal over their remaining lifetime.
/// Uses the public `compute_simple_dot_damage` + `status_tick_sec`
/// engine helpers so the estimate tracks the real DoT model rather than
/// a hand-rolled copy.
fn estimate_remaining_dot(
    statuses: &std::collections::BTreeMap<String, crate::contracts::SimpleStatusInstance>,
    max_hp: f64,
) -> f64 {
    let mut total = 0.0;
    for (id, inst) in statuses.iter() {
        if let Some(tick_sec) = crate::statuses::status_tick_sec(id) {
            if tick_sec <= 0.0 {
                continue;
            }
            let per_tick = crate::statuses::compute_simple_dot_damage(max_hp, id, inst.stacks);
            if per_tick <= 0.0 {
                continue;
            }
            // Permanent (weather) instances never expire - bound their
            // contribution to the persistent rate instead by treating
            // their remaining DoT as zero here (they are already folded
            // into the measured in-window incoming rate).
            if inst.no_decay {
                continue;
            }
            let remaining_ticks = (inst.remaining_sec / tick_sec).max(0.0);
            total += per_tick * remaining_ticks;
        }
    }
    total
}

/// Estimate the DoT damage the edge statuses dealt DURING a window of
/// `elapsed` seconds - used to subtract the DoT slice from the measured
/// in-window incoming average so DoT is not double-counted as both a
/// flat persistent rate and a decaying budget.
fn estimate_remaining_dot_window(
    statuses: &std::collections::BTreeMap<String, crate::contracts::SimpleStatusInstance>,
    max_hp: f64,
    elapsed: f64,
) -> f64 {
    if elapsed <= 0.0 {
        return 0.0;
    }
    let mut total = 0.0;
    for (id, inst) in statuses.iter() {
        if let Some(tick_sec) = crate::statuses::status_tick_sec(id) {
            if tick_sec <= 0.0 {
                continue;
            }
            let per_tick = crate::statuses::compute_simple_dot_damage(max_hp, id, inst.stacks);
            if per_tick <= 0.0 {
                continue;
            }
            let ticks_in_window = (elapsed / tick_sec).max(0.0);
            total += per_tick * ticks_in_window;
        }
    }
    total
}

/// Extrapolate a window-edge engine state to `max_time_sec` and return
/// the terminal `(a_hp, b_hp, a_death, b_death, hp_a_at_b_death,
/// hp_b_at_a_death)` tuple in the SAME shape `compute_replay_fitness`
/// consumes.
///
/// Pillars section 1 contract. This is the bounded-horizon projection surrogate,
/// consulted ONLY in `POSTURE_BOUNDED_HORIZON` mode and only when the
/// windowed replay stopped at the window edge with both sides alive. It
/// conforms to section 5 purity/determinism - a pure function of its inputs (no
/// wall-clock, no RNG; inputs never mutated). It does NOT implement the
/// `StateProjection` trait (it returns the terminal scoring tuple in the
/// engine A/B frame, not a projected `PolicyState`), and under a strict
/// reading of section 2 ("one path per decision") it is a second, hand-rolled
/// scoring path - a deliberate cost-motivated carve-out. That carve-out is
/// sound ONLY because it never adjudicates a who-died-last trade alone:
/// any decision it would flip is re-confirmed at the exact engine horizon
/// by the death-race gate (`policy/decisions/stance.rs::run_death_race_gate`).
/// The structural section 2 exemption and its load-bearing proof (bounded-vs-exact
/// decision identity on the corpus) are tracked in
/// `docs/internal/architecture_backlog.md`.
///
/// Both sides are stepped in lock-step in regen-cadence ticks. Each
/// step subtracts that side's persistent posture-priced incoming rate
/// plus its decaying DoT budget, and adds regen recomputed at the
/// CURRENT projected HP (HP-fraction dependent, never frozen). On a
/// side's first zero-crossing we record its interpolated death time and
/// the opponent's HP at that instant - exactly the inputs the
/// who-died-last branch of `compute_replay_fitness` needs.
#[allow(clippy::too_many_arguments)]
pub(super) fn project_terminal_state(
    edge: &LoopState,
    params: &LoopParams<'_>,
    start: &LoopState,
    decision_start_time: f64,
    edge_posture_self: Posture,
    edge_posture_opp: Posture,
    self_is_attacker: bool,
) -> (f64, f64, Option<f64>, Option<f64>, Option<f64>, Option<f64>) {
    let elapsed = (edge.time - decision_start_time).max(0.0);

    // In-window incoming per side (delta of the cumulative counters).
    // dealt_a = damage A dealt to B = incoming to B; dealt_b = incoming
    // to A.
    let incoming_to_a = (edge.counters.dealt_b - start.counters.dealt_b).max(0.0);
    let incoming_to_b = (edge.counters.dealt_a - start.counters.dealt_a).max(0.0);

    let (edge_posture_a, edge_posture_b) = if self_is_attacker {
        (edge_posture_self, edge_posture_opp)
    } else {
        (edge_posture_opp, edge_posture_self)
    };

    let mut a = SideProjection::build(
        &edge.a,
        params.attacker,
        edge_posture_a,
        incoming_to_a,
        elapsed,
    );
    let mut b = SideProjection::build(
        &edge.b,
        params.defender,
        edge_posture_b,
        incoming_to_b,
        elapsed,
    );

    let mut hp_a_at_b_death: Option<f64> = edge.hp_a_at_b_death;
    let mut hp_b_at_a_death: Option<f64> = edge.hp_b_at_a_death;

    let mut t = edge.time;
    let end = params.max_time_sec;
    // Hard iteration cap mirrors REPLAY_MAX_ITERS as a determinism /
    // runaway guard; at a 15-s cadence over a 900-s cap this is ~60
    // steps, far under the cap.
    let mut guard: u32 = 0;
    while t + 1e-9 < end && (a.death_time.is_none() || b.death_time.is_none()) && guard < REPLAY_MAX_ITERS {
        let step = REGEN_CADENCE_SEC.min(end - t);
        let t_end = t + step;
        let a_alive_before = a.death_time.is_none();
        let b_alive_before = b.death_time.is_none();
        a.step(step, t_end);
        b.step(step, t_end);
        // Record cross-side HP at the moment a side dies this step.
        if a_alive_before && a.death_time.is_some() && hp_b_at_a_death.is_none() {
            hp_b_at_a_death = Some(b.hp.max(0.0));
        }
        if b_alive_before && b.death_time.is_some() && hp_a_at_b_death.is_none() {
            hp_a_at_b_death = Some(a.hp.max(0.0));
        }
        t = t_end;
        guard += 1;
    }

    (
        a.hp.max(0.0),
        b.hp.max(0.0),
        a.death_time,
        b.death_time,
        hp_a_at_b_death,
        hp_b_at_a_death,
    )
}

fn posture_to_stance(p: Posture) -> StancePosture {
    match p {
        Posture::Standing => StancePosture::Standing,
        Posture::Sitting => StancePosture::Sitting,
        Posture::Laying => StancePosture::Laying,
    }
}

fn stance_to_posture_action(a: StanceAction) -> PostureAction {
    match a {
        StanceAction::Stay => PostureAction::Stay,
        StanceAction::StartSit => PostureAction::StartSit,
        StanceAction::StartLay => PostureAction::StartLay,
        StanceAction::StandUp => PostureAction::StandUp,
    }
}
