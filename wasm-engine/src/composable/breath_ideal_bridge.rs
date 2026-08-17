//! `Ideal` breath policy: burst-open timing decided by a bounded engine REPLAY.
//!
//! Behind the `BREATH_BURST_MODEL` flag plus the per-side `Ideal` breath
//! policy, this replaces the fixed
//! `OnAvailability` / `OnFullBar` cadence with a marginal engine search. At
//! each burst boundary (the side charging, no run open, past the inter-chain
//! recast), [`resolve`] clones the live `LoopState` once per candidate open
//! time, forces this side to open its next run at that time, runs the real
//! engine forward over the bounded `compute_replay_horizon` window
//! (extrapolated to the fight cap by `project_terminal_state`), and scores with
//! `compute_replay_fitness`. It returns the best open time, which
//! `loop_iter::run_one_event_loop_iter` commits onto the side; the fuel stepper
//! then honours it (hold, open, drain) and re-decides at the next boundary.
//!
//! Same pre-resolve shape as `fortify_rollout_bridge`: [`resolve`] runs BEFORE
//! the breath-phase context is built (the fork needs a whole-`LoopState` clone,
//! which conflicts with the phase's disjoint `&mut` borrows).
//!
//! The candidate set is the Ideal-grid of open delays plus an explicit
//! "charge to a full bar" point, so it always spans `OnAvailability` (open now)
//! through `OnFullBar` (open at full): the pick is no worse than either shipped
//! discipline at the decision point.
//!
//! Recursion guard
//!
//! Every inner fork runs with `ability_policy_mode: GateOnly`, so [`resolve`]
//! returns `None` inside it and never re-enters the search. The forced open
//! time is plain side state the stepper reads directly; once the forced run
//! drains the stepper reverts to `OnAvailability`, so the inner replay's breath
//! is pinned to availability. Posture is frozen (`ForcedOff`) inside the fork
//! so it can't spawn its own nested replay.
//!
//! Cost
//!
//! One search (~12 forks) per burst cycle per side, each fork a bounded-horizon
//! replay - the same order of cost as the Fortify rollout. Affordable for
//! Compare and Sandbox (single fights); Best Builds never selects the `Ideal`
//! policy (gated on the TS side, mirroring how posture policy is left off
//! there), so its ~95 k matchups pay nothing.

use crate::composable::config::SimpleBreathPolicyMode;
use crate::contracts::SimpleBreathProfile;

use super::ability_metadata::ability_blocked_by_necropoison;
use super::breath::{breath_burst_model_enabled, is_standard_breath};
use super::loop_iter::{
    run_one_event_loop_iter, AbilityPolicyMode, IterHooks, LoopOutcome, LoopParams, LoopState,
    PosturePolicyMode,
};
use super::posture::Posture;
use super::posture_policy::{compute_replay_fitness, POSTURE_BOUNDED_HORIZON, REPLAY_MAX_ITERS};
use super::stance_bridge::{compute_replay_horizon, project_terminal_state};

/// Ideal-grid candidate open delays (mirrors `policy::timing_mode::ideal_candidates`).
const IDEAL_GRID: [f64; 11] = [0.0, 0.25, 0.5, 1.0, 1.5, 2.0, 3.0, 4.0, 6.0, 8.0, 12.0];

/// A candidate must beat the incumbent by this fitness margin to win the pick -
/// guards against float-fragile ties (mirrors the Fortify rollout). A
/// winner-flip clears it decisively (hundreds of HP / a death-time swing).
const POLICY_FITNESS_MARGIN: f64 = 1e-6;

/// Resolve the next burst-open time for `self_is_attacker`'s side.
///
/// Returns `None` when the search is not engaged (flag off, inner replay, the
/// side is not on the `Ideal` policy, has no standard breath, or is not at a
/// burst boundary) - the caller then leaves the side's commitment untouched.
/// `Some(open_at)` is the clock time the stepper should open the next run.
pub(super) fn resolve(
    state: &LoopState,
    params: &LoopParams<'_>,
    self_is_attacker: bool,
) -> Option<f64> {
    if params.ability_policy_mode != AbilityPolicyMode::Normal || !breath_burst_model_enabled() {
        return None;
    }
    let config = params.config;
    let policy = if self_is_attacker {
        config.attacker_breath_policy
    } else {
        config.defender_breath_policy
    };
    if policy != SimpleBreathPolicyMode::Ideal {
        return None;
    }
    let (side, breath) = if self_is_attacker {
        (&state.a, params.attacker_breath)
    } else {
        (&state.b, params.defender_breath)
    };
    let breath = breath?;
    if !is_standard_breath(breath) {
        return None;
    }
    // Decide only at a burst boundary: the side is charging (no run open, no
    // open time already committed) and past the inter-chain recast. Skip a
    // side that cannot breathe this window (dead / settled non-standing /
    // Head Start inert / Necropoison), mirroring the breath-phase gates - the
    // fuel stepper would not fire there, so a fork would waste work.
    let inert = if self_is_attacker {
        config.head_start_inert_a(state.time)
    } else {
        config.head_start_inert_b(state.time)
    };
    if side.death_time.is_some()
        || side.breath_bursting
        || side.breath_burst_open_at.is_finite()
        || state.time + 1e-9 < side.breath_recast_until
        || side.posture_settled_non_standing()
        || inert
        || ability_blocked_by_necropoison("Breath", &side.statuses)
    {
        return None;
    }
    Some(run_search(state, params, self_is_attacker, breath))
}

/// Score every candidate open time and return the best.
fn run_search(
    state: &LoopState,
    params: &LoopParams<'_>,
    self_is_attacker: bool,
    breath: &SimpleBreathProfile,
) -> f64 {
    let now = state.time;
    let side = if self_is_attacker { &state.a } else { &state.b };

    // The Ideal grid spans "open now" (availability) up to a 12 s hold. Add an
    // explicit "charge to a full bar" point when full is further out than the
    // grid reaches, so the search can always match `OnFullBar`. Charging adds
    // `tick_sec / regen_rate` fuel per tick, i.e. filling `delta` capacity takes
    // `delta * regen_rate` seconds.
    let max_capacity = breath.capacity.max(0.0);
    let regen_rate = breath.regen_rate.max(0.0);
    let time_to_full = (max_capacity - side.breath_capacity).max(0.0) * regen_rate;

    let mut candidates: Vec<f64> = IDEAL_GRID.iter().map(|&d| now + d).collect();
    if time_to_full > IDEAL_GRID[IDEAL_GRID.len() - 1] {
        candidates.push(now + time_to_full);
    }

    let mut best: Option<(f64, f64)> = None;
    for open_at in candidates {
        let fitness = run_fork(state, params, self_is_attacker, open_at);
        match best {
            None => best = Some((open_at, fitness)),
            Some((_, bf)) if fitness > bf + POLICY_FITNESS_MARGIN => best = Some((open_at, fitness)),
            _ => {}
        }
    }
    best.map(|(open_at, _)| open_at).unwrap_or(now)
}

/// One inner replay: clone the live state, force this side to open its next run
/// at `open_at`, run the engine forward over the bounded horizon under
/// `GateOnly`, and score the (possibly extrapolated) terminal state.
fn run_fork(
    state: &LoopState,
    params: &LoopParams<'_>,
    self_is_attacker: bool,
    open_at: f64,
) -> f64 {
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
        // Recursion guard: the search never re-enters itself inside the fork.
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
    if self_is_attacker {
        cloned.a.breath_burst_open_at = open_at;
    } else {
        cloned.b.breath_burst_open_at = open_at;
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
/// `fortify_rollout_bridge::score_fork_endstate`: extrapolate to the fight cap
/// only when the bounded replay stopped AT the window edge with both sides
/// alive.
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
