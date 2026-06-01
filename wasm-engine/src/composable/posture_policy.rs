//! Posture policy — engine-replay decision making.
//!
//! Module B's earlier calibrated passive sim (P7-P8.2) tried to
//! approximate combat outcomes with hand-rolled DPS scaling. That
//! approach systematically missed: breath capacity/cooldown, on-bite
//! passives (Defensive Bleed, Corrosion / Injury Attack), active
//! abilities (Fortify, Harden, Warden's Rage, etc.), and status
//! interactions. Brute-force scenarios 11/12 with realistic Compare
//! breath profiles showed +781 HP mathematical-ideal lay gain that
//! the calibrated sim could not capture — Module B suppressed every
//! lay candidate because its calibration over-estimated cost during
//! the Spirit Glare burst window.
//!
//! P9 fix: Module B clones the live `LoopState` at the decision
//! moment, applies each candidate posture transition, then runs the
//! REAL engine forward via `run_one_event_loop_iter` (with inner
//! posture-policy `ForcedOff` so the projection can't recurse).
//! Fitness comes from final HP / death state. No approximations —
//! whatever the engine does in production is exactly what the
//! policy evaluates.
//!
//! ## Why this is the durable fix
//!
//! Engine-replay self-corrects when new abilities are added to the
//! engine: the policy automatically sees them via the replay. The
//! calibrated sim required a hand-rolled patch for every new
//! mechanic; engine-replay needs none.
//!
//! ## Trade-off: runtime cost
//!
//! Per decision (~5 s cadence): clone state × 3 candidates × replay
//! up to N events. For a typical 60 s fight that's ~36 ms per side
//! per fight. Acceptable for Compare and Sandbox; Best Builds doesn't
//! enable posture policy.
//!
//! ## Trade-off: recursion guard
//!
//! Inner replays MUST use `posture_policy_override: ForcedOff` so
//! they don't call this decision logic again — that would explode
//! exponentially. The state machine's posture transitions still
//! execute via `request_posture_transition` (no recursion).

use super::side::CombatSide;
use crate::contracts::{SimpleAbilityTimingMode, SimpleBreathProfile, SimpleCombatantStats};

use super::config::ComposableAbilityConfig;
use super::setup::ComposableLoopFlags;
use super::{FortifySimulationControl, OrderedEventPhase};

/// Periodic re-evaluation interval (used by
/// `schedule_next_posture_decision` in mod.rs for the base cadence).
pub(super) const DECISION_PERIODIC_SEC: f64 = 5.0;

/// Engine-replay horizon — how far forward each candidate is
/// simulated. Bumped 2026-05-22 (P19) to `f64::INFINITY` so the
/// replay always uses the caller's `max_time_sec` as the de-facto
/// cap. Earlier setting of 120 s under-projected fights longer than
/// 120 s — settled-Lay incoming-damage penalties past the inner
/// replay window weren't priced into the candidate's fitness, and
/// the policy could pick a candidate that looks good over the first
/// 120 s but loses by the time a 180-s fight ends. Cost is
/// negligible in the common case because the replay terminates
/// naturally on either side's death (typical fight resolves in
/// 30–90 s); for fights that never resolve we still cap iterations
/// at [`REPLAY_MAX_ITERS`].
pub(super) const REPLAY_HORIZON_SEC: f64 = f64::INFINITY;

/// Hard cap on inner-replay iteration count per candidate. DoS guard
/// against pathological loops; production engine iters terminate
/// naturally on side-death or time bound, this is just belt-and-
/// braces.
pub(super) const REPLAY_MAX_ITERS: u32 = 5_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PostureAction {
    Stay,
    StartSit,
    StartLay,
    StandUp,
}

/// Fitness function matched to the brute-force benchmark.
/// `self_is_attacker = true` ranks from attacker (A) perspective.
///
///   - Both alive at horizon → my surviving HP (higher is better).
///   - Only opp dead → my_hp + 1 (kill bonus).
///   - Only I dead → −opp's surviving HP.
///   - Both dead — compare death times: if I outlived opp by even a
///     fraction of a second, I "won the race" → my_hp.max(0) + 1.
///     If opp outlived me → −opp_hp. Equal death times → 0 (tie).
///
/// Including death timestamps lets the policy / benchmark distinguish
/// scenarios where both sides die from accumulated DoTs but the timing
/// differs — important for matchups like Opra vs Gimon where Compare
/// determines the winner by who died last, not whether either is alive
/// at max_time.
pub(super) fn compute_replay_fitness(
    a_hp: f64,
    b_hp: f64,
    a_death: Option<f64>,
    b_death: Option<f64>,
    hp_a_at_b_death: Option<f64>,
    hp_b_at_a_death: Option<f64>,
    self_is_attacker: bool,
) -> f64 {
    let (my_hp, my_death, opp_hp, opp_death, opp_hp_at_my_death) = if self_is_attacker {
        (a_hp, a_death, b_hp, b_death, hp_b_at_a_death)
    } else {
        (b_hp, b_death, a_hp, a_death, hp_a_at_b_death)
    };
    match (my_death, opp_death) {
        // Both alive at horizon. Credit BOTH my surviving HP and the
        // damage dealt to opp (opp_hp_loss = opp_max_hp - opp_hp).
        //
        // Originally this branch returned just `my_hp` to match the
        // brute-force benchmark's "alive→my_hp" semantics. But for
        // short-horizon engine-replay decisions (e.g., bite-variant
        // run at every bite event with a horizon ≪ full fight),
        // both sides routinely stay alive at the inner-replay
        // horizon. With just `my_hp`, two candidates that deal
        // wildly different damage to opp (primary 50 dmg/bite vs
        // secondary 250 dmg/bite) score identical fitness ⇒ tie ⇒
        // anti-jitter falls back to primary even when secondary is
        // 5× better. Discovered 2026-05-22 by the
        // `dynamic_picks_secondary_when_opp_is_immune_to_on_hit_status`
        // reference test failure during the bite-variant
        // engine-replay refactor (BiteVariant P2).
        //
        // The fix: subtract opp_hp so the formula becomes
        // "damage-delta at horizon". Still monotone with respect to
        // both factors (more my_hp ⇒ better, less opp_hp ⇒ better),
        // and gives a clear signal in tie-prone short-horizon
        // simulations. `compute_fitness` in `posture_benchmark.rs`
        // mirrors this so the memory rule
        // "policy sim fitness must match benchmark" holds.
        (None, None) => my_hp.max(0.0) - opp_hp.max(0.0),
        (None, Some(_)) => my_hp.max(0.0) + 1.0,
        (Some(_), None) => -opp_hp.max(0.0),
        (Some(me_t), Some(op_t)) => {
            if me_t > op_t + 1e-9 {
                // Outlive duration in seconds + small base to make any
                // outlive count above tie. Differentiates "barely won"
                // from "decisive trade" — beam search can hunt for
                // strategies that extend the lead.
                (me_t - op_t) + 1.0
            } else if op_t > me_t + 1e-9 {
                // Lost the trade. Magnitude = opp's HP at MY death.
                //
                // Earlier we used `-opp_hp` with `opp_hp` = the FINAL
                // opp HP. When the opp dies eventually too (accumulated
                // DoTs etc.), final opp HP collapses to 0 and the
                // function returned the SAME value (0) for ANY
                // trajectory where opp eventually dies after me — even
                // wildly different trajectories like "opp had 1792 HP
                // when I died" vs "opp had 976 HP when I died". The
                // stance decision's tree-search couldn't see the
                // difference and committed Stay even when a non-Stay
                // plan would clearly accelerate opp's demise.
                //
                // Discovered 2026-05-22 by the Kendyll vs Goreganthus
                // diagnostic: with the broken formula, POLICY scored
                // identical to OFF for that matchup despite a known
                // Lay@0+Stand@5 trajectory accelerating Gore's death
                // by ~1.8 s (hp_a@b_death dropped from 1792 → 976).
                //
                // The fix uses opp_hp_at_my_death — opp's HP at MY
                // death moment — as the "I lost the trade by THIS
                // much" magnitude. Matches the TS-side bFitness in
                // posturePolicyRealCompareBeam.test.ts.
                -opp_hp_at_my_death.unwrap_or(0.0).max(0.0)
            } else {
                0.0
            }
        }
    }
}

// `decide` was the calibrated entry point; the live posture path now
// goes through `stance_bridge::decide_stance_now`. Kept here because
// `posture_tests.rs` tests invoke `decide()` directly to validate
// the legacy-stay contract and the no-perturbation invariant.
#[allow(dead_code, unused_variables)]
#[allow(clippy::too_many_arguments)]
pub(super) fn decide(
    _self_side: &CombatSide,
    _opp_side: &CombatSide,
    _self_stats: &SimpleCombatantStats,
    _opp_stats: &SimpleCombatantStats,
    _self_breath: Option<&SimpleBreathProfile>,
    _opp_breath: Option<&SimpleBreathProfile>,
    _time: f64,
    _self_is_attacker: bool,
    _config: &ComposableAbilityConfig,
    _flags: &ComposableLoopFlags,
    _ability_policy: SimpleAbilityTimingMode,
    _event_phase_order: &[OrderedEventPhase],
    _fortify_control: FortifySimulationControl,
    _max_time_sec: f64,
) -> PostureAction {
    // Legacy entry point. The live posture path is
    // `stance_bridge::decide_stance_now`, which has full
    // LoopState access for engine-replay. Standalone test
    // callers receive `Stay` so they don't pollute results.
    PostureAction::Stay
}
