//! Fortify activation decided by a bounded engine ROLLOUT.
//!
//! Behind the [`FORTIFY_ROLLOUT`] flag (default OFF => byte-identical), this
//! replaces Fortify's hand-utility candidate search with a marginal engine
//! fork. At each moment Fortify's gate is open, [`resolve`] clones the live
//! `LoopState` once per Ideal-grid candidate delay, forces Fortify to fire at
//! `now + d`, runs the real engine forward over the bounded
//! `compute_replay_horizon` window (extrapolated to the fight cap by
//! `project_terminal_state`), and scores with `compute_replay_fitness`. A skip
//! baseline scores the outcome of not committing the cast now. Fire NOW only
//! when the best fire candidate is `d ~ 0` and beats the skip baseline by
//! [`POLICY_FITNESS_MARGIN`]; a positive best delay means keep waiting (the
//! decision is re-evaluated next tick), a losing best means skip.
//!
//! Sweep pruning
//!
//! "Keep waiting" is the answer at nearly every tick, and the full sweep spent
//! ~12 forks to reach it. Since the verdict only asks whether `d = 0` holds the
//! lead AND clears the skip baseline, the sweep stops at the first candidate
//! that says otherwise - see [`FORTIFY_ROLLOUT_SHORT_CIRCUIT`] for why that is
//! decision-identical rather than an approximation.
//!
//! Same pre-resolve shape as `bite_variant_bridge`: [`resolve`] is called from
//! `loop_iter::run_one_event_loop_iter` BEFORE the Phase-3 context is built
//! (the fork needs a whole-`LoopState` clone, which conflicts with the phase's
//! disjoint `&mut` field borrows), and the resulting decision is threaded into
//! `process_phase_3_activations`.
//!
//! Recursion guard
//!
//! Every inner fork runs with `ability_policy_mode: GateOnly`, so Fortify
//! resolves on its ReallyFast gate there and never re-enters this rollout. The
//! fire branch drives Fortify through a single-shot forced schedule on the
//! clone (`PinnedDefensiveSchedule::fortify_forced_once`, the forced side skips
//! the gate); the skip branch is parameterised by the same `forced_at` seam
//! (see [`SKIP_LETS_REALLY_FAST_PLAY`]). Posture is frozen (`ForcedOff`) inside
//! the fork so it can't spawn its own nested replay.

use crate::contracts::SimpleAbilityTimingMode;
use crate::policy::decisions::fortify::FortifyDecision;
use crate::policy::light_projection::CombatStateProjection;
use crate::policy::state::PolicyState;
use crate::policy::traits::{StateProjection, TimedDecision};

use super::ability_metadata::ability_blocked_by_necropoison;
use super::loop_iter::{
    run_one_event_loop_iter, AbilityPolicyMode, IterHooks, LoopOutcome, LoopParams, LoopState,
    PosturePolicyMode,
};
use super::posture::Posture;
use super::posture_policy::{
    compute_replay_fitness, FORTIFY_ROLLOUT, FORTIFY_ROLLOUT_SHORT_CIRCUIT,
    POSTURE_BOUNDED_HORIZON, REPLAY_MAX_ITERS,
};
use super::stance_bridge::{compute_replay_horizon, project_terminal_state};

/// Ideal-mode candidate delays (mirrors `policy::timing_mode::ideal_candidates`).
const IDEAL_GRID: [f64; 11] = [0.0, 0.25, 0.5, 1.0, 1.5, 2.0, 3.0, 4.0, 6.0, 8.0, 12.0];

/// The same candidates, swept longest-wait-first after `d = 0`. "Fire now"
/// survives only if NO delay outscores it, so any single delay that does ends
/// the sweep - and the wait curve keeps climbing while the opponent is still
/// piling on pressure to cleanse, which makes the longest wait the likeliest
/// witness. Scoring it second finds it in ~1 fork instead of ~4. The verdict is
/// unchanged: `d = 0` is still scored first (nothing else can take the lead
/// from it and give it back), and "some later delay wins" is order-independent.
const PRUNE_SWEEP_ORDER: [f64; 11] = [0.0, 12.0, 8.0, 6.0, 4.0, 3.0, 2.0, 1.5, 1.0, 0.5, 0.25];

/// A fire candidate must beat the skip baseline by at least this fitness margin
/// to fire NOW - guards the decision against float-fragile ties. The
/// winner-flip it must clear is decisive (a loss vs a win differ by hundreds of
/// HP / a death-time swing), so a tiny epsilon suffices.
const POLICY_FITNESS_MARGIN: f64 = 1e-6;

/// How the skip baseline models "do not commit the cast now".
///
/// The milestone spec's skip branch "lets Fortify play its ReallyFast gate"
/// (`true`). But ReallyFast fires the instant >=15 removable stacks exist, which
/// at any decision time inside the flip window equals `fire@d=0`: the skip
/// baseline then shadows the fire-now decision (`fitness_skip == fitness_fire@0`),
/// so `fire@0` can never beat skip and the rollout never fires - the
/// base-policy-contamination failure the spec's own STOP clause names ("the
/// skip-branch ReallyFast can't be isolated"). Setting this `false` makes skip =
/// "Fortify is not cast" (the true marginal counterfactual for a one-cast,
/// 90 s-cooldown ability), which isolates the fire decision. See the module
/// report for the empirical evidence behind the default.
const SKIP_LETS_REALLY_FAST_PLAY: bool = false;

/// Whether the Fortify rollout is engaged. Reads the compile-time
/// [`FORTIFY_ROLLOUT`] const in shipped builds; a `#[cfg(test)]` thread-local
/// override lets one test process exercise both flag states.
#[cfg(not(test))]
#[inline(always)]
pub(super) fn fortify_rollout_enabled() -> bool {
    FORTIFY_ROLLOUT
}

#[cfg(test)]
thread_local! {
    static FORTIFY_ROLLOUT_OVERRIDE: std::cell::Cell<Option<bool>> = const { std::cell::Cell::new(None) };
}

#[cfg(test)]
pub(super) fn fortify_rollout_enabled() -> bool {
    FORTIFY_ROLLOUT_OVERRIDE.with(|c| c.get()).unwrap_or(FORTIFY_ROLLOUT)
}

/// Set (or clear) the test-only rollout-flag override.
#[cfg(test)]
pub(super) fn set_fortify_rollout_override(v: Option<bool>) {
    FORTIFY_ROLLOUT_OVERRIDE.with(|c| c.set(v));
}

/// Whether the candidate sweep may stop early. Same shape as the rollout flag:
/// the compile-time const in shipped builds, a `#[cfg(test)]` override so the
/// decision-identity gate can run one corpus both ways in one process.
#[cfg(not(test))]
#[inline(always)]
fn short_circuit_enabled() -> bool {
    FORTIFY_ROLLOUT_SHORT_CIRCUIT
}

#[cfg(test)]
thread_local! {
    static SHORT_CIRCUIT_OVERRIDE: std::cell::Cell<Option<bool>> = const { std::cell::Cell::new(None) };
}

#[cfg(test)]
fn short_circuit_enabled() -> bool {
    SHORT_CIRCUIT_OVERRIDE.with(|c| c.get()).unwrap_or(FORTIFY_ROLLOUT_SHORT_CIRCUIT)
}

/// Set (or clear) the test-only sweep-pruning override.
#[cfg(test)]
pub(super) fn set_fortify_short_circuit_override(v: Option<bool>) {
    SHORT_CIRCUIT_OVERRIDE.with(|c| c.set(v));
}

// Test-only cost probe: total inner forks and rollout invocations, so a
// validation test can report the per-decision replay count.
#[cfg(test)]
thread_local! {
    static FORK_COUNT: std::cell::Cell<u64> = const { std::cell::Cell::new(0) };
    static DECISION_COUNT: std::cell::Cell<u64> = const { std::cell::Cell::new(0) };
}

/// Reset and return `(total forks, rollout invocations)`.
#[cfg(test)]
pub(super) fn take_rollout_cost() -> (u64, u64) {
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

/// What the rollout decided for one side at one moment.
enum FortifyPlan {
    /// The rollout is not engaged here - the caller keeps its gate path.
    Disengaged,
    /// Do not commit the cast.
    Hold,
    /// Cast at `now + delay`.
    FireIn(f64),
}

/// Resolve Fortify's fire decision for `self_is_attacker`'s side.
///
/// Returns `None` when the rollout is not engaged (flag off, or this is an
/// inner replay) - the caller then falls back to the historical gate path.
/// Returns `Some(true)` to fire now, `Some(false)` to hold / skip.
///
/// Plans afresh at every ActiveAbilities event and answers the phase directly.
/// A caller that cannot afford the fork puts Fortify on its `ReallyFast` gate
/// through the per-ability policy override, which disengages this path entirely.
pub(super) fn resolve(
    state: &mut LoopState,
    params: &LoopParams<'_>,
    self_is_attacker: bool,
) -> Option<bool> {
    match plan_now(state, params, self_is_attacker) {
        FortifyPlan::Disengaged => None,
        FortifyPlan::Hold => Some(false),
        FortifyPlan::FireIn(delay) => Some(delay <= 1e-9),
    }
}

fn plan_now(state: &LoopState, params: &LoopParams<'_>, self_is_attacker: bool) -> FortifyPlan {
    if params.ability_policy_mode != AbilityPolicyMode::Normal || !fortify_rollout_enabled() {
        return FortifyPlan::Disengaged;
    }
    let config = params.config;
    let cfg_on = if self_is_attacker {
        config.attacker_fortify
    } else {
        config.defender_fortify
    };
    if !cfg_on {
        return FortifyPlan::Disengaged;
    }
    // The rollout is the PRECISION value model. ReallyFast (the base policy the
    // inner replays themselves run) and Fast keep their cheap gate / small
    // search, so picking a fast mode stays fast and the rollout can't recurse
    // into the policy it uses as its own baseline.
    let fortify_override = if self_is_attacker {
        config.attacker_ability_policy_overrides.fortify
    } else {
        config.defender_ability_policy_overrides.fortify
    };
    if matches!(
        crate::contracts::resolve_ability_policy(params.ability_policy, fortify_override),
        SimpleAbilityTimingMode::ReallyFast | SimpleAbilityTimingMode::Fast
    ) {
        return FortifyPlan::Disengaged;
    }
    let (side, stats, breath) = if self_is_attacker {
        (&state.a, params.attacker, params.attacker_breath)
    } else {
        (&state.b, params.defender, params.defender_breath)
    };
    let (opp, opp_stats, opp_breath) = if self_is_attacker {
        (&state.b, params.defender, params.defender_breath)
    } else {
        (&state.a, params.attacker, params.attacker_breath)
    };
    let inert = if self_is_attacker {
        config.head_start_inert_a(state.time)
    } else {
        config.head_start_inert_b(state.time)
    };
    // Mirror the Phase-3 outer gate: a Fortify blocked by posture / Head Start /
    // Necropoison / Cocoon can't fire, so don't spend a fork on it.
    if side.posture_settled_non_standing()
        || inert
        || ability_blocked_by_necropoison("Fortify", &side.statuses)
        || side.in_cocoon_phase_2(state.time)
    {
        return FortifyPlan::Hold;
    }
    let self_ps = super::policy_bridge::build_policy_side(side, stats, breath, std::iter::empty());
    let opp_ps =
        super::policy_bridge::build_policy_side(opp, opp_stats, opp_breath, std::iter::empty());
    let base = PolicyState {
        self_side: self_ps,
        opponent: opp_ps,
        time: state.time,
        extras: Default::default(),
    };
    // Gate: nothing to cleanse / still on cooldown => the rollout has no
    // decision to make this tick.
    if !FortifyDecision::new().is_available(&base) {
        return FortifyPlan::Hold;
    }
    run_rollout(state, params, self_is_attacker, &base)
}

/// The marginal fire-vs-skip fork: score the available Ideal-grid fire
/// candidates against the skip baseline and return the winning delay. Under
/// [`FORTIFY_ROLLOUT_SHORT_CIRCUIT`] the sweep stops as soon as the verdict is
/// settled instead of scoring candidates whose fitness cannot change it - which
/// is also why the pruned answer is only ever `d = 0` or "hold": once a later
/// delay takes the lead the sweep stops without finding the argmax, and the
/// decision cadence re-plans rather than pretending to know it.
fn run_rollout(
    state: &LoopState,
    params: &LoopParams<'_>,
    self_is_attacker: bool,
    base: &PolicyState,
) -> FortifyPlan {
    #[cfg(test)]
    DECISION_COUNT.with(|c| c.set(c.get() + 1));

    let now = state.time;
    let projector = CombatStateProjection;
    let decision = FortifyDecision::new();

    // Skip baseline: `None` => let Fortify play its ReallyFast gate (GateOnly);
    // `Some(INFINITY)` => Fortify is never cast (the forced target is never
    // reached, and GateOnly's forced-side branch also suppresses ReallyFast).
    let skip_forced = if SKIP_LETS_REALLY_FAST_PLAY {
        None
    } else {
        Some(f64::INFINITY)
    };

    // Pruned: the baseline is only consulted if `d = 0` survives the whole
    // sweep, so it is scored last and usually not at all.
    let prune = short_circuit_enabled();
    let scored_skip = if prune {
        None
    } else {
        Some(run_fork(state, params, self_is_attacker, skip_forced))
    };

    let sweep: &[f64] = if prune { &PRUNE_SWEEP_ORDER } else { &IDEAL_GRID };
    let mut best: Option<(f64, f64)> = None;
    for &d in sweep {
        // Only score candidates where Fortify is available at the projected
        // firing time (mirrors the CandidateSearchPolicy availability filter).
        let available = if d <= f64::EPSILON {
            decision.is_available(base)
        } else {
            decision.is_available(&projector.project(base, d))
        };
        if !available {
            continue;
        }
        let fitness = run_fork(state, params, self_is_attacker, Some(now + d));
        match best {
            None => best = Some((d, fitness)),
            Some((_, bf)) if fitness > bf + POLICY_FITNESS_MARGIN => best = Some((d, fitness)),
            _ => {}
        }
        // `d = 0` is scored first and nothing hands the lead back once it is
        // lost, so the moment another delay takes it the verdict is settled and
        // every remaining candidate would be scored only to be thrown away.
        if prune && !matches!(best, Some((delay, _)) if delay <= 1e-9) {
            return FortifyPlan::Hold;
        }
    }

    let fitness_skip = scored_skip
        .unwrap_or_else(|| run_fork(state, params, self_is_attacker, skip_forced));
    match best {
        Some((delay, fitness)) if fitness > fitness_skip + POLICY_FITNESS_MARGIN => {
            FortifyPlan::FireIn(delay)
        }
        _ => FortifyPlan::Hold,
    }
}

/// One inner replay: clone the live state, install `forced_at` as this side's
/// Fortify fire schedule, run the engine forward over the bounded horizon under
/// `GateOnly`, and score the (possibly extrapolated) terminal state.
fn run_fork(
    state: &LoopState,
    params: &LoopParams<'_>,
    self_is_attacker: bool,
    forced_at: Option<f64>,
) -> f64 {
    #[cfg(test)]
    FORK_COUNT.with(|c| c.set(c.get() + 1));

    let now = state.time;
    let horizon = compute_replay_horizon(now, params.max_time_sec);

    let inner_params = LoopParams {
        attacker: params.attacker,
        defender: params.defender,
        attacker_breath: params.attacker_breath,
        defender_breath: params.defender_breath,
        config: params.config,
        flags: params.flags,
        ability_policy: params.ability_policy,
        // Recursion guard: Fortify runs its ReallyFast gate inside the fork.
        ability_policy_mode: AbilityPolicyMode::GateOnly,
        event_phase_order: params.event_phase_order,
        record_trace: false,
        max_time_sec: horizon,
        bench_count: false,
        // Freeze posture so the fork can't spawn its own posture inner replay.
        posture_policy_override: PosturePolicyMode::ForcedOff,
        iter_hooks: IterHooks::default(),
        decide_override: None,
        decide_override_respects_schedule: false,
        decide_bite_variant_override: params.decide_bite_variant_override,
        decide_toggle_override: None,
    };

    let mut cloned = state.clone();
    cloned.same_time_processed_phases = 0;
    let pin = super::PinnedDefensiveSchedule::fortify_forced_once(forced_at);
    if self_is_attacker {
        cloned.fortify_control.attacker = pin;
    } else {
        cloned.fortify_control.defender = pin;
    }

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
        score_fork_endstate(&cloned, params, state, now, horizon, self_is_attacker);
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

/// Score a finished (or window-edge-stopped) fork end-state into the tuple
/// `compute_replay_fitness` consumes - the same shape as
/// `stance_bridge::score_endstate`: extrapolate to the fight cap only when the
/// bounded replay stopped AT the window edge with both sides alive.
fn score_fork_endstate(
    cloned: &LoopState,
    params: &LoopParams<'_>,
    start: &LoopState,
    decision_start_time: f64,
    horizon: f64,
    self_is_attacker: bool,
) -> (f64, f64, Option<f64>, Option<f64>, Option<f64>, Option<f64>) {
    let stopped_at_window_edge = POSTURE_BOUNDED_HORIZON
        && cloned.a.death_time.is_none()
        && cloned.b.death_time.is_none()
        && cloned.time + 1e-6 < params.max_time_sec
        && cloned.time + 1e-6 >= horizon;
    if stopped_at_window_edge {
        let (edge_posture_self, edge_posture_opp): (Posture, Posture) = if self_is_attacker {
            (cloned.a.posture_current, cloned.b.posture_current)
        } else {
            (cloned.b.posture_current, cloned.a.posture_current)
        };
        return project_terminal_state(
            cloned,
            params,
            start,
            decision_start_time,
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
