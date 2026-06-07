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
//! ## Entry point
//!
//! [`decide_stance_now`] is called from
//! `composable/loop_iter.rs::run_one_event_loop_iter` whenever the
//! posture-policy block fires for a side. It consults the
//! registered stance decision (today: the built-in
//! [`BuiltinStanceReplayDecision`]) and returns the engine-internal
//! `PostureAction` the state machine then applies.
//!
//! ## Recursion guard
//!
//! Each inner engine-replay inside a stance decision runs the loop
//! with `posture_policy_override: ForcedOff`, so
//! `run_one_event_loop_iter` does NOT call back into
//! `decide_stance_now` from the inner replay. Without this guard the
//! replay would explode exponentially (each candidate plan calling
//! `decide_stance_now` calling `replay_with_plan` calling
//! `decide_stance_now` …).

use std::sync::OnceLock;

use crate::policy::decisions::stance::BuiltinStanceReplayDecision;
use crate::policy::traits::{
    StanceAction, StanceDecision, StancePosture, StanceReplayer, StanceSideView,
};

use super::loop_iter::{
    run_one_event_loop_iter, DecideOverrideFn, IterHooks, LoopOutcome, LoopParams, LoopState,
    PosturePolicyMode,
};
use super::posture::Posture;
use super::posture_policy::{
    compute_replay_fitness, PostureAction, POSTURE_BOUNDED_HORIZON, POSTURE_REPLAY_WINDOW_SEC,
    REGEN_CADENCE_SEC, REPLAY_HORIZON_SEC, REPLAY_MAX_ITERS,
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

/// Decide the posture action for `self_is_attacker`'s side at the
/// current `state.time`. Calls the registered stance decision with
/// engine-side adapters; translates the trait's [`StanceAction`]
/// back into the engine-internal [`PostureAction`] expected by
/// `apply_policy_action`.
pub(super) fn decide_stance_now(
    state: &LoopState,
    params: &LoopParams<'_>,
    self_is_attacker: bool,
) -> PostureAction {
    let actor_side = if self_is_attacker { &state.a } else { &state.b };
    let view = CombatSideStanceView { side: actor_side };
    let replay_horizon = compute_replay_horizon(state.time, params.max_time_sec);
    let mut replayer = LoopStateReplayer {
        state,
        params,
        self_is_attacker,
        replay_horizon,
        decision_start_time: state.time,
    };
    let action = stance_decision().decide(&view, state.time, &mut replayer);
    stance_to_posture_action(action)
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
fn compute_replay_horizon(decision_time: f64, max_time_sec: f64) -> f64 {
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
    ) -> (f64, f64, Option<f64>, Option<f64>, Option<f64>, Option<f64>) {
        let self_is_attacker = self.self_is_attacker;
        // The override is consulted at each scheduled posture
        // decision moment inside the inner replay. Re-build the
        // StanceSideView on the live CombatSide at that moment so
        // dynamic plans (cyclic-*, status-decay, alternating-*) see
        // up-to-date next_regen / status stacks / pending posture.
        let override_fn: Box<DecideOverrideFn> = Box::new(
            move |ask_self: &CombatSide,
                  _opp: &CombatSide,
                  t: f64,
                  is_attacker: bool|
                  -> PostureAction {
                if is_attacker != self_is_attacker {
                    // Passive opponent during inner projection - same
                    // simplifying assumption as before the refactor.
                    return PostureAction::Stay;
                }
                let live_view = CombatSideStanceView { side: ask_self };
                stance_to_posture_action(plan(&live_view, t))
            },
        );

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
        };

        let mut cloned = self.state.clone();
        cloned.same_time_processed_phases = 0;

        let mut iter_count: u32 = 0;
        while cloned.time + 1e-9 < horizon
            && (cloned.a.death_time.is_none() || cloned.b.death_time.is_none())
            && iter_count < REPLAY_MAX_ITERS
        {
            match run_one_event_loop_iter(&mut cloned, &inner_params) {
                LoopOutcome::Break | LoopOutcome::BoundExceeded => break,
                LoopOutcome::Continue | LoopOutcome::Advanced => {}
            }
            iter_count += 1;
        }

        // Bounded-horizon terminal projection. Only when:
        //   - `project` is requested by the caller (bounded mode),
        //   - the replay stopped AT the window edge (reached `horizon`,
        //     NOT a death and NOT the true `max_time_sec`), and
        //   - BOTH sides are still alive.
        // Otherwise (the engine resolved the fight inside the window, or
        // the window IS the fight cap) we return the true engine
        // end-state - so short fights and in-window deaths are exactly
        // the unbounded result.
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
                &cloned,
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
}

impl StanceReplayer for LoopStateReplayer<'_> {
    fn replay_with_plan(
        &mut self,
        plan: &dyn Fn(&dyn StanceSideView, f64) -> StanceAction,
    ) -> f64 {
        // Flag OFF: horizon is INFINITY-capped, `project = false` ⇒
        // exact engine end-state, byte-identical to the shipped path.
        // Flag ON: bounded window + terminal projection.
        let (a_hp, b_hp, a_death, b_death, hp_a_at_b_death, hp_b_at_a_death) =
            self.run_replay(plan, self.replay_horizon, POSTURE_BOUNDED_HORIZON);
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

    fn replay_with_plan_detailed(
        &mut self,
        plan: &dyn Fn(&dyn StanceSideView, f64) -> StanceAction,
    ) -> crate::policy::traits::StanceReplayOutcome {
        let (a_hp, b_hp, a_death, b_death, hp_a_at_b_death, hp_b_at_a_death) =
            self.run_replay(plan, self.replay_horizon, true);
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
            self.run_replay(plan, exact_horizon, false);
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
    /// ×incoming multiplier via the engine's counter accounting).
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
            let per_tick = crate::statuses::compute_simple_dot_damage(max_hp, id, inst.stacks, tick_sec);
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
            let per_tick = crate::statuses::compute_simple_dot_damage(max_hp, id, inst.stacks, tick_sec);
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
/// hp_b_at_a_death)` tuple in the SAME shape
/// `compute_replay_fitness` consumes. Pure / deterministic - no
/// wall-clock, no RNG.
///
/// Both sides are stepped in lock-step in regen-cadence ticks. Each
/// step subtracts that side's persistent posture-priced incoming rate
/// plus its decaying DoT budget, and adds regen recomputed at the
/// CURRENT projected HP (HP-fraction dependent, never frozen). On a
/// side's first zero-crossing we record its interpolated death time and
/// the opponent's HP at that instant - exactly the inputs the
/// who-died-last branch of `compute_replay_fitness` needs.
#[allow(clippy::too_many_arguments)]
fn project_terminal_state(
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
