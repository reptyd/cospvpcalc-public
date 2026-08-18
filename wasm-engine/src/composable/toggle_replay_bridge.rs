//! Hunker / Warden's Rage toggle state decided by a bounded engine
//! REPLAY.
//!
//! Behind the [`TOGGLE_ROLLOUT`] flag (default OFF => byte-identical),
//! this replaces the deleted analytic `on_off_delta` for the precision
//! modes with a held-plan ablation. At the posture ~5 s decision epoch,
//! [`resolve`] scores each candidate held-plan (`hold_off`, `hold_on`,
//! plus a Warden's harvest) by cloning the live `LoopState`, installing
//! the plan as this toggle's override on the evaluated side, running the
//! real engine forward over the bounded `compute_replay_horizon` window
//! (extrapolated by `project_terminal_state`), and scoring with
//! `compute_replay_fitness`. The winning [`ToggleCommit`] is stored on
//! the side and HELD between epochs (re-evaluated per tick so the
//! Warden harvest's sub-epoch release fires).
//!
//! Same pre-resolve shape as `fortify_rollout_bridge`: [`resolve`] is
//! called from `loop_iter::run_one_event_loop_iter` BEFORE the phase
//! context is built (the fork needs a whole-`LoopState` clone, which
//! conflicts with the phase's disjoint `&mut` field borrows), and the
//! resulting `Option<bool>` is threaded into the Hunker / Warden phases.
//!
//! Recursion guard
//!
//! An inner replay drives the evaluated toggle through
//! `decide_toggle_override` and marks `ability_policy_mode: GateOnly`
//! with posture `ForcedOff`. [`resolve`] returns early whenever an
//! override is installed (consulting it) or the mode is not `Normal`,
//! so the replay never nests another toggle / posture replay; every
//! OTHER toggle inside the fork runs its pi-zero gate.

use crate::contracts::SimpleAbilityTimingMode;
use crate::policy::decisions::toggle_replay::BuiltinToggleReplayDecision;
use crate::policy::traits::{
    toggle_commit_answer, ToggleCommit, ToggleReplayDecision, ToggleReplaySideView, ToggleReplayer,
};

use super::loop_iter::{
    run_one_event_loop_iter, AbilityPolicyMode, DecideToggleOverrideFn, IterHooks, LoopOutcome,
    LoopParams, LoopState, PosturePolicyMode,
};
use super::posture::Posture;
use super::posture_policy::{
    compute_replay_fitness, POSTURE_BOUNDED_HORIZON, REPLAY_MAX_ITERS,
    TOGGLE_ROLLOUT,
};
use super::side::CombatSide;
use super::stance_bridge::{compute_replay_horizon, project_terminal_state};

/// Which toggle a [`resolve`] call is deciding.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(super) enum ToggleKind {
    Hunker,
    WardenRage,
}

impl ToggleKind {
    fn id(self) -> &'static str {
        use crate::policy::decisions::toggle_replay::{
            HUNKER_REPLAY_DECISION_ID, WARDEN_RAGE_REPLAY_DECISION_ID,
        };
        match self {
            ToggleKind::Hunker => HUNKER_REPLAY_DECISION_ID,
            ToggleKind::WardenRage => WARDEN_RAGE_REPLAY_DECISION_ID,
        }
    }

    fn decision(self) -> BuiltinToggleReplayDecision {
        match self {
            ToggleKind::Hunker => BuiltinToggleReplayDecision::hunker(),
            ToggleKind::WardenRage => BuiltinToggleReplayDecision::wardens_rage(),
        }
    }

    /// Move 2 coordination DATA TABLE: the optimistic feasible plan under which
    /// this toggle realizes its buffered-regen value while STANDING - the
    /// augmented candidate's hold, and the plan committed on the handoff.
    fn optimistic_plan(self) -> ToggleCommit {
        match self {
            ToggleKind::Hunker => ToggleCommit::On,
            ToggleKind::WardenRage => ToggleCommit::Harvest,
        }
    }
}

/// Move 2: the optimistic feasible toggle plan keyed by decision id, for the
/// posture leader's augmented-candidate override (`stance_bridge`).
pub(super) fn optimistic_plan_for_id(id: &str) -> Option<ToggleCommit> {
    if id == ToggleKind::Hunker.id() {
        Some(ToggleKind::Hunker.optimistic_plan())
    } else if id == ToggleKind::WardenRage.id() {
        Some(ToggleKind::WardenRage.optimistic_plan())
    } else {
        None
    }
}

/// Move 1: the side's committed toggle plan tag keyed by decision id, so the
/// posture leader's inner replay plays the actor's ACTUAL committed plan across
/// all posture candidates instead of pi-zero.
pub(super) fn committed_plan_for_id(side: &CombatSide, id: &str) -> Option<ToggleCommit> {
    if id == ToggleKind::Hunker.id() {
        Some(side.hunker_toggle_commit)
    } else if id == ToggleKind::WardenRage.id() {
        Some(side.warden_rage_toggle_commit)
    } else {
        None
    }
}

/// Move 2 handoff: when the posture leader's augmented candidate wins, commit
/// each carried toggle's optimistic plan on the actor's side and advance its
/// epoch, so the follower's `resolve` honors the written commit this iteration
/// and skips its own ablation (same-iteration consistency; saves ~3 replays).
pub(super) fn commit_coordinated_toggles(
    state: &mut LoopState,
    params: &LoopParams<'_>,
    self_is_attacker: bool,
) {
    let next = next_toggle_epoch(state, self_is_attacker);
    for kind in [ToggleKind::Hunker, ToggleKind::WardenRage] {
        if !toggle_enabled(params, self_is_attacker, kind) {
            continue;
        }
        let commit = kind.optimistic_plan();
        #[cfg(test)]
        COMMIT_RECORDER.with(|r| {
            if let Some(log) = r.borrow_mut().as_mut() {
                log.push((kind, commit));
            }
        });
        let side = if self_is_attacker { &mut state.a } else { &mut state.b };
        match kind {
            ToggleKind::Hunker => {
                side.hunker_toggle_commit = commit;
                side.hunker_toggle_next_decision_at = next;
            }
            ToggleKind::WardenRage => {
                side.warden_rage_toggle_commit = commit;
                side.warden_rage_toggle_next_decision_at = next;
            }
        }
    }
}

/// Whether the actor carries at least one posture-gated toggle to coordinate -
/// the posture leader emits its augmented candidate only then. Mirrors the
/// per-toggle enable gate `commit_coordinated_toggles` writes through.
pub(super) fn actor_has_coordinated_toggle(
    params: &LoopParams<'_>,
    self_is_attacker: bool,
) -> bool {
    toggle_enabled(params, self_is_attacker, ToggleKind::Hunker)
        || toggle_enabled(params, self_is_attacker, ToggleKind::WardenRage)
}

/// Whether the toggle rollout is engaged. Reads the compile-time
/// [`TOGGLE_ROLLOUT`] const in shipped builds; a `#[cfg(test)]`
/// thread-local override lets one test process exercise both states.
#[cfg(not(test))]
#[inline(always)]
pub(super) fn toggle_rollout_enabled() -> bool {
    TOGGLE_ROLLOUT
}

#[cfg(test)]
thread_local! {
    static TOGGLE_ROLLOUT_OVERRIDE: std::cell::Cell<Option<bool>> = const { std::cell::Cell::new(None) };
}

#[cfg(test)]
pub(super) fn toggle_rollout_enabled() -> bool {
    TOGGLE_ROLLOUT_OVERRIDE.with(|c| c.get()).unwrap_or(TOGGLE_ROLLOUT)
}

/// Set (or clear) the test-only rollout-flag override.
#[cfg(test)]
pub(super) fn set_toggle_rollout_override(v: Option<bool>) {
    TOGGLE_ROLLOUT_OVERRIDE.with(|c| c.set(v));
}

// Test-only cost probe: total inner forks and epoch decisions, so a
// validation test can report the per-fight replay count (Gate 3).
#[cfg(test)]
thread_local! {
    static FORK_COUNT: std::cell::Cell<u64> = const { std::cell::Cell::new(0) };
    static DECISION_COUNT: std::cell::Cell<u64> = const { std::cell::Cell::new(0) };
}

/// Reset and return `(total forks, epoch decisions)`.
#[cfg(test)]
pub(super) fn take_replay_cost() -> (u64, u64) {
    let forks = FORK_COUNT.with(|c| {
        let v = c.get();
        c.set(0);
        v
    });
    let decisions = DECISION_COUNT.with(|c| {
        let v = c.get();
        c.set(0);
        v
    });
    (forks, decisions)
}

// Test-only recorder of the committed plan tags, so a validation test
// can prove the Warden's harvest is actually committed (Gate 4).
#[cfg(test)]
thread_local! {
    static COMMIT_RECORDER: std::cell::RefCell<Option<Vec<(ToggleKind, ToggleCommit)>>> =
        const { std::cell::RefCell::new(None) };
}

/// Arm the commit recorder, discarding any prior recording.
#[cfg(test)]
pub(super) fn arm_commit_recorder() {
    COMMIT_RECORDER.with(|r| *r.borrow_mut() = Some(Vec::new()));
}

/// Disarm and return what was captured.
#[cfg(test)]
pub(super) fn take_commit_recording() -> Vec<(ToggleKind, ToggleCommit)> {
    COMMIT_RECORDER.with(|r| r.borrow_mut().take().unwrap_or_default())
}

// Recorder of the per-tick held-state answer `resolve` hands back, keyed by
// `(time_bits, id, is_attacker)`. The defensive-pin capture API arms it around
// a full `ideal` run to lift each toggle's committed timeline into a
// `PinnedDefensiveSchedule`. Inert (disarmed) unless a caller arms it, so the
// shipped simulate path is behavior-identical.
/// One recorded consultation: `(time_bits, toggle_id, is_attacker, held)`.
type RecordedAnswer = (u64, &'static str, bool, bool);

thread_local! {
    static ANSWER_RECORDER: std::cell::RefCell<Option<Vec<RecordedAnswer>>> =
        const { std::cell::RefCell::new(None) };
}

/// Arm the per-tick answer recorder, discarding any prior recording.
/// Driven by the defensive-pin capture API (funnel wiring lands in a later
/// phase); reachable in the lib target only through that not-yet-live caller.
#[allow(dead_code)]
pub(super) fn arm_answer_recorder() {
    ANSWER_RECORDER.with(|r| *r.borrow_mut() = Some(Vec::new()));
}

/// Disarm and return the recorded consultations.
#[allow(dead_code)]
pub(super) fn take_answer_recording() -> Vec<RecordedAnswer> {
    ANSWER_RECORDER.with(|r| r.borrow_mut().take().unwrap_or_default())
}

/// Resolve the held ON/OFF for `self_is_attacker`'s `kind` toggle at the
/// current tick.
///
/// Returns `None` when the toggle should fall back to its pi-zero gate
/// (`toggle_state_now`): flag off, this is an inner replay, or the
/// side's effective policy for this toggle is a fast (non-precision)
/// mode. Returns `Some(true|false)` to force the toggle held state -
/// the epoch-committed plan tag, re-evaluated at the current tick.
pub(super) fn resolve(
    state: &mut LoopState,
    params: &LoopParams<'_>,
    self_is_attacker: bool,
    kind: ToggleKind,
) -> Option<bool> {
    // Inner replay: the evaluated toggle is driven by the installed
    // override (Some => plan answer, None => pi-zero for every other toggle).
    // Returns early either way, so the replay never nests another.
    if let Some(ov) = params.decide_toggle_override {
        let actor = if self_is_attacker { &state.a } else { &state.b };
        return ov(kind.id(), actor, state.time, self_is_attacker);
    }
    // Top-level Best Builds pin replay: a captured schedule answers this toggle
    // directly, reproducing the full `ideal` decision without re-running its
    // replay. Empty (the shipped default) => fall through to the live path.
    if let Some(held) = state
        .fortify_control
        .side(self_is_attacker)
        .toggle_answer(kind.id(), state.time)
    {
        return Some(held);
    }
    // Any OTHER inner replay (posture / bite-variant / Fortify rollout)
    // runs its fork at GateOnly - no nested toggle replay there either.
    if params.ability_policy_mode != AbilityPolicyMode::Normal || !toggle_rollout_enabled() {
        return None;
    }
    // Only spend replays on a toggle the side actually carries (mirrors
    // the phase-site enable gates).
    if !toggle_enabled(params, self_is_attacker, kind) {
        return None;
    }
    // The replay is the PRECISION value model; fast modes keep their
    // cheap gate (and the replays themselves run pi-zero as the base policy).
    let toggle_override = toggle_policy_override(params.config, self_is_attacker, kind);
    if matches!(
        crate::contracts::resolve_ability_policy(params.ability_policy, toggle_override),
        SimpleAbilityTimingMode::ReallyFast | SimpleAbilityTimingMode::Fast
    ) {
        return None;
    }

    let marker = |side: &CombatSide| match kind {
        ToggleKind::Hunker => side.hunker_toggle_next_decision_at,
        ToggleKind::WardenRage => side.warden_rage_toggle_next_decision_at,
    };
    let due = state.time + 1e-9 >= marker(if self_is_attacker { &state.a } else { &state.b });

    if due {
        #[cfg(test)]
        DECISION_COUNT.with(|c| c.set(c.get() + 1));
        let commit = run_decision(state, params, self_is_attacker, kind);
        #[cfg(test)]
        COMMIT_RECORDER.with(|r| {
            if let Some(log) = r.borrow_mut().as_mut() {
                log.push((kind, commit));
            }
        });
        let next = next_toggle_epoch(state, self_is_attacker);
        let side = if self_is_attacker { &mut state.a } else { &mut state.b };
        match kind {
            ToggleKind::Hunker => {
                side.hunker_toggle_commit = commit;
                side.hunker_toggle_next_decision_at = next;
            }
            ToggleKind::WardenRage => {
                side.warden_rage_toggle_commit = commit;
                side.warden_rage_toggle_next_decision_at = next;
            }
        }
    }

    let side = if self_is_attacker { &state.a } else { &state.b };
    let commit = match kind {
        ToggleKind::Hunker => side.hunker_toggle_commit,
        ToggleKind::WardenRage => side.warden_rage_toggle_commit,
    };
    let view = CombatSideToggleView { side };
    let answer = toggle_commit_answer(commit, &view, state.time);
    ANSWER_RECORDER.with(|r| {
        if let Some(log) = r.borrow_mut().as_mut() {
            log.push((state.time.to_bits(), kind.id(), self_is_attacker, answer));
        }
    });
    Some(answer)
}

/// Whether the side actually carries this toggle (mirrors the phase-site
/// enable gates: `attacker_hunker && has_hunker`, `attacker_warden_rage`).
fn toggle_enabled(params: &LoopParams<'_>, self_is_attacker: bool, kind: ToggleKind) -> bool {
    let config = params.config;
    match kind {
        ToggleKind::Hunker => {
            let (cfg_on, stats) = if self_is_attacker {
                (config.attacker_hunker, params.attacker)
            } else {
                (config.defender_hunker, params.defender)
            };
            cfg_on && stats.hunker_reduction_pct > 0.0
        }
        ToggleKind::WardenRage => {
            if self_is_attacker {
                config.attacker_warden_rage
            } else {
                config.defender_warden_rage
            }
        }
    }
}

/// Per-toggle policy override off the config (mirrors the phase-site
/// `resolve_ability_policy` call).
fn toggle_policy_override(
    config: &super::config::ComposableAbilityConfig,
    self_is_attacker: bool,
    kind: ToggleKind,
) -> Option<SimpleAbilityTimingMode> {
    let overrides = if self_is_attacker {
        &config.attacker_ability_policy_overrides
    } else {
        &config.defender_ability_policy_overrides
    };
    match kind {
        ToggleKind::Hunker => overrides.hunker,
        ToggleKind::WardenRage => overrides.wardens_rage,
    }
}

/// The next epoch moment for a toggle decision: the strict 5 s grid
/// (`DECISION_PERIODIC_SEC`), pulled forward to a pre-regen-tick moment
/// so the harvest opportunity is re-decided fresh each regen cycle.
fn next_toggle_epoch(state: &LoopState, self_is_attacker: bool) -> f64 {
    let side = if self_is_attacker { &state.a } else { &state.b };
    let cadence = super::posture_policy::decision_periodic_sec();
    let mut next = ((state.time / cadence).floor() + 1.0) * cadence;
    if side.next_regen.is_finite() {
        let pre = side.next_regen - crate::policy::traits::TOGGLE_HARVEST_RELEASE_LEAD_SEC;
        if pre > state.time + 1e-9 && pre < next {
            next = pre;
        }
        let post = side.next_regen + 1e-6;
        if post > state.time + 1e-9 && post < next {
            next = post;
        }
    }
    next
}

/// Run the toggle-replay decision: score its candidate held-plans and
/// return the committed [`ToggleCommit`].
fn run_decision(
    state: &LoopState,
    params: &LoopParams<'_>,
    self_is_attacker: bool,
    kind: ToggleKind,
) -> ToggleCommit {
    let side = if self_is_attacker { &state.a } else { &state.b };
    let view = CombatSideToggleView { side };
    let mut replayer = LoopStateToggleReplayer {
        state,
        params,
        self_is_attacker,
        toggle_id: kind.id(),
    };
    kind.decision().decide(&view, state.time, &mut replayer)
}

/// Adapter exposing a `CombatSide` to [`ToggleReplaySideView`].
struct CombatSideToggleView<'a> {
    side: &'a CombatSide,
}

impl ToggleReplaySideView for CombatSideToggleView<'_> {
    fn next_regen_at(&self) -> f64 {
        self.side.next_regen
    }
}

/// Engine-replay primitive: clone the live state, install `plan` as the
/// evaluated toggle's override, run the bounded window forward under
/// `GateOnly` / posture `ForcedOff`, and score the terminal state.
struct LoopStateToggleReplayer<'a> {
    state: &'a LoopState,
    params: &'a LoopParams<'a>,
    self_is_attacker: bool,
    toggle_id: &'static str,
}

impl ToggleReplayer for LoopStateToggleReplayer<'_> {
    fn replay_with_plan(
        &mut self,
        plan: &dyn Fn(&dyn ToggleReplaySideView, f64) -> bool,
    ) -> f64 {
        #[cfg(test)]
        FORK_COUNT.with(|c| c.set(c.get() + 1));

        let self_is_attacker = self.self_is_attacker;
        let toggle_id = self.toggle_id;
        let now = self.state.time;
        let horizon = compute_replay_horizon(now, self.params.max_time_sec);

        // The override answers for the evaluated toggle on the evaluated
        // side; every other (toggle, side) returns None => pi-zero gate.
        let override_fn: Box<DecideToggleOverrideFn> = Box::new(
            move |ask_id: &'static str, actor: &CombatSide, t: f64, is_attacker: bool| -> Option<bool> {
                if ask_id != toggle_id || is_attacker != self_is_attacker {
                    return None;
                }
                let view = CombatSideToggleView { side: actor };
                Some(plan(&view, t))
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
            // Recursion guard: timed abilities run their gate inside the
            // fork; toggles are driven by the override / pi-zero; posture is
            // frozen. No nested replay of any kind.
            ability_policy_mode: AbilityPolicyMode::GateOnly,
            event_phase_order: self.params.event_phase_order,
            record_trace: false,
            max_time_sec: horizon,
            bench_count: false,
            posture_policy_override: PosturePolicyMode::ForcedOff,
            iter_hooks: IterHooks::default(),
            decide_override: None,
            decide_override_respects_schedule: false,
            decide_bite_variant_override: self.params.decide_bite_variant_override,
            decide_toggle_override: Some(&override_fn),
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

        let (a_hp, b_hp, a_death, b_death, hp_a_at_b_death, hp_b_at_a_death) =
            self.score_endstate(&cloned, now, horizon);
        compute_replay_fitness(
            a_hp,
            b_hp,
            a_death,
            b_death,
            hp_a_at_b_death,
            hp_b_at_a_death,
            self_is_attacker,
        )
    }
}

impl LoopStateToggleReplayer<'_> {
    /// Score a finished (or window-edge-stopped) fork end-state into the
    /// tuple `compute_replay_fitness` consumes - same shape as
    /// `fortify_rollout_bridge::score_fork_endstate`: extrapolate to the
    /// fight cap only when the bounded replay stopped AT the window edge
    /// with both sides alive.
    fn score_endstate(
        &self,
        cloned: &LoopState,
        decision_start_time: f64,
        horizon: f64,
    ) -> (f64, f64, Option<f64>, Option<f64>, Option<f64>, Option<f64>) {
        let stopped_at_window_edge = POSTURE_BOUNDED_HORIZON
            && cloned.a.death_time.is_none()
            && cloned.b.death_time.is_none()
            && cloned.time + 1e-6 < self.params.max_time_sec
            && cloned.time + 1e-6 >= horizon;
        if stopped_at_window_edge {
            let (edge_posture_self, edge_posture_opp): (Posture, Posture) = if self.self_is_attacker {
                (cloned.a.posture_current, cloned.b.posture_current)
            } else {
                (cloned.b.posture_current, cloned.a.posture_current)
            };
            return project_terminal_state(
                cloned,
                self.params,
                self.state,
                decision_start_time,
                edge_posture_self,
                edge_posture_opp,
                self.self_is_attacker,
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
