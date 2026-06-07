//! Built-in Hunker toggle decision.
//!
//! Reference: `ability_hunker` in `src/pages/referenceContent.ts`.
//!
//! Hunker is the canonical toggle in this codebase: no cooldown, no
//! active timer, just an on/off stance. While ON the actor's bite
//! damage is multiplied by 0.5x and incoming direct damage is
//! reduced by `hunker_reduction_pct` percent. Toggling OFF and back
//! ON adds a 5 s effect-delay; the very first activation has no
//! delay (engine handles the delay; decision only answers
//! "should it be on now?").
//!
//! Reference policy text:
//!
//! - ReallyFast / Fast: always on (engine maps both to
//!   `AlwaysOnIfEligibleTogglePolicy`).
//! - Semi-ideal / Ideal / Extreme: utility-driven on/off via the
//!   delta-toggle policy. Decision computes net value of being ON
//!   minus OFF as `(in_dps × reduction_pct/100) − (out_dps × 0.5)`
//!   over a fixed horizon.

use crate::policy::state::{PolicyState, PolicyValue};
use crate::policy::traits::ToggleDecision;

/// Stable id under which this decision registers.
pub const HUNKER_DECISION_ID: &str = "builtin.hunker";

/// `state.self_side.extras` key carrying the actor's current Hunker
/// on/off state. The engine sets this before each
/// `toggle_state_now` invocation; the decision reads it to apply
/// hysteresis (a "dead zone" around the delta=0 boundary) so the
/// toggle does not flicker every tick when ON-value and OFF-value
/// hover near each other in long fights.
///
/// Missing key ⇒ treated as `false` (default "off"). Mirrors the
/// `builtin.wardens_rage.on` pattern.
pub const CURRENTLY_ON_EXTRA_KEY: &str = "builtin.hunker.on";

/// Bite damage multiplier while Hunker is on. Outgoing-damage cost
/// of staying in stance.
const OUTGOING_DAMAGE_MULT: f64 = 0.5;

/// Minimum horizon over which the on/off value delta is evaluated.
/// Replaces the previous hardcoded 12 s. The actual horizon used at
/// each decision is `max(HORIZON_MIN_SEC, 2 × max_bite_cooldown)`,
/// so slow-cadence creatures get a longer look-ahead automatically
/// (a 5-second bite needs at least one full bite cycle for the
/// blocked-incoming math to be meaningful).
const HORIZON_MIN_SEC: f64 = 6.0;

/// Hysteresis dead-zone as a fraction of the actor's max HP. The
/// raw on/off delta is biased by this magnitude in the direction
/// that favours the current state - so the toggle only flips when
/// the new state is *strictly better* than the current one by at
/// least DEAD_ZONE worth of HP. Stops tick-by-tick flickering when
/// blocked-incoming ≈ lost-outgoing for long stretches of a fight.
const HYSTERESIS_DEAD_ZONE_PCT_MAX_HP: f64 = 0.005;

/// Built-in Hunker toggle decision.
#[derive(Debug, Default, Clone)]
pub struct HunkerDecision;

impl HunkerDecision {
    pub fn new() -> Self {
        Self
    }
}

impl ToggleDecision for HunkerDecision {
    fn id(&self) -> &str {
        HUNKER_DECISION_ID
    }

    fn on_off_delta(&self, state: &PolicyState) -> f64 {
        let actor = &state.self_side;
        let opp = &state.opponent;
        let reduction = (actor.stats.hunker_reduction_pct / 100.0).clamp(0.0, 1.0);
        if reduction <= 0.0 {
            // No reduction → being on never recovers the 0.5× cost.
            // Negative bias deep enough to swamp any hysteresis.
            return -1.0;
        }

        // Adaptive horizon: long enough to settle a bite cycle for
        // both sides, short enough not to drown in speculation. The
        // engine re-evaluates every tick anyway, so a single bite
        // round-trip's worth of horizon is plenty.
        let horizon = horizon_sec(actor, opp);

        // Event-discrete blocked-incoming value. `bite_dps()` is the
        // smooth-DPS average; for short adaptive windows that loses
        // tactical info ("opp's next hit is in 0.4 s - turn on" vs
        // "opp's next hit is in 4 s - push damage"). Count expected
        // events in `[now, now + horizon]` instead. Both bite and
        // breath contribute. DOT damage already on the actor is *not*
        // included - Hunker reduces direct hits only, not status ticks.
        let blocked_incoming = blocked_incoming_value(actor, opp, horizon, reduction, state.time);
        let lost_outgoing = lost_outgoing_value(actor, opp, horizon, state.time);

        let raw_delta = blocked_incoming - lost_outgoing;

        // Hysteresis: bias the delta by a small dead-zone in the
        // direction that favours the current state. Combined with
        // `DeltaTogglePolicy`'s `delta > eps` rule, this means a
        // flip only happens when the new state is strictly better
        // by ≥ DEAD_ZONE worth of HP. Stops the per-tick on/off
        // reported flickering in long fights when blocked
        // ≈ lost.
        let dead_zone = (actor.stats.health.max(1.0)) * HYSTERESIS_DEAD_ZONE_PCT_MAX_HP;
        let currently_on = state
            .self_side
            .extras
            .get(CURRENTLY_ON_EXTRA_KEY)
            .and_then(PolicyValue::as_bool)
            .unwrap_or(false);
        if currently_on {
            // Bias positive so the toggle keeps ON unless raw delta
            // drops below `-dead_zone`.
            raw_delta + dead_zone
        } else {
            // Bias negative so the toggle keeps OFF unless raw delta
            // climbs above `+dead_zone`.
            raw_delta - dead_zone
        }
    }

    fn is_eligible(&self, _state: &PolicyState) -> bool {
        // Hunker has no cooldown / active timer of its own. The
        // engine's outer guard already excludes ineligible cases
        // (Necropoison disables, Cocoon Ph2, etc.); this hook
        // returns true unconditionally.
        true
    }

    fn really_fast_default(&self, _state: &PolicyState) -> Option<bool> {
        // ReallyFast / Fast: always on (Reference policyDifferences).
        Some(true)
    }
}

/// Event-driven horizon: `max(HORIZON_MIN_SEC, 2 × max_bite_cd)`.
/// Adaptive to fight tempo without needing "remaining encounter
/// time" plumbing (which `PolicyState` doesn't carry today).
fn horizon_sec(
    actor: &crate::policy::state::PolicySide,
    opp: &crate::policy::state::PolicySide,
) -> f64 {
    let actor_cd = actor.stats.bite_cooldown.max(0.1);
    let opp_cd = opp.stats.bite_cooldown.max(0.1);
    let max_cd = actor_cd.max(opp_cd);
    (2.0 * max_cd).max(HORIZON_MIN_SEC)
}

/// Expected damage opp would deliver via direct hits (bites +
/// breath) in `[now, now + horizon]`, multiplied by `reduction` to
/// give the HP value Hunker would block. Uses `opp.next_hit` and
/// `opp.next_breath` for event-discrete event counting - average
/// DPS would miss tactical micro-windows ("opp's bite is 0.4 s
/// away → block it" vs "opp's bite is 5 s away → push damage").
fn blocked_incoming_value(
    actor: &crate::policy::state::PolicySide,
    opp: &crate::policy::state::PolicySide,
    horizon: f64,
    reduction: f64,
    now: f64,
) -> f64 {
    // Per-bite damage opp deals - light approximation: damage stat
    // before weight ratios / multipliers. The exact figure is hard
    // to predict from `PolicyState` alone (no access to multiplier
    // stack); damage stat is a stable rank-ordering proxy.
    let per_bite = opp.stats.damage.max(0.0);
    let bite_count = count_events_in_window(opp.next_hit, now, horizon, opp.stats.bite_cooldown);
    let bite_damage = per_bite * bite_count;

    let breath_damage = if let Some(breath) = &opp.breath {
        // Live engine: breath ticks 2/s while firing, dps_pct of
        // max HP per tick. Capped by opp's remaining capacity.
        const BREATH_TICKS_PER_SEC: f64 = 2.0;
        let actor_max_hp = actor.stats.health.max(1.0);
        let breath_window = horizon.min(opp.breath_capacity.max(0.0));
        let ticks = breath_window * BREATH_TICKS_PER_SEC;
        // dps_pct is "% of target max HP per second" in the live
        // engine. Per-tick damage = dps_pct / 100 / ticks_per_sec
        // × max_hp.
        let per_tick = (breath.dps_pct / 100.0 / BREATH_TICKS_PER_SEC).max(0.0) * actor_max_hp;
        per_tick * ticks
    } else {
        0.0
    };

    (bite_damage + breath_damage) * reduction
}

/// Outgoing damage the actor *gives up* by staying in Hunker stance:
/// every bite during the horizon does `(1 − OUTGOING_DAMAGE_MULT) ×
/// per_bite_damage` less than it would without Hunker. Counted
/// event-discrete via `actor.next_hit` and the actor's bite cooldown.
fn lost_outgoing_value(
    actor: &crate::policy::state::PolicySide,
    _opp: &crate::policy::state::PolicySide,
    horizon: f64,
    now: f64,
) -> f64 {
    let per_bite = actor.stats.damage.max(0.0);
    let bite_count = count_events_in_window(actor.next_hit, now, horizon, actor.stats.bite_cooldown);
    per_bite * bite_count * (1.0 - OUTGOING_DAMAGE_MULT)
}

/// Count how many events fire in `[now, now + horizon]` given an
/// initial scheduled event at `next_event_time` and a recurrence
/// period of `cadence`. Both first event and recurrences inside
/// the window count.
///
/// Edge cases:
/// - `next_event_time` already past `now + horizon` ⇒ 0 events.
/// - `cadence <= 0` ⇒ only the first event counts (degenerate).
/// - `next_event_time < now` ⇒ treat as "due now" (event-driven
///   simulators typically clamp to `now` when reschedule lagged).
fn count_events_in_window(
    next_event_time: f64,
    now: f64,
    horizon: f64,
    cadence: f64,
) -> f64 {
    if horizon <= 0.0 {
        return 0.0;
    }
    let first = next_event_time.max(now);
    let window_end = now + horizon;
    if first > window_end + 1e-9 {
        return 0.0;
    }
    let cad = cadence.max(0.1);
    let after_first = (window_end - first).max(0.0);
    1.0 + (after_first / cad).floor()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::policy::state::PolicyState;
    use crate::policy::testing::default_state;

    /// Hunker scenario baseline: actor wears the typical 40 % damage
    /// reduction from the hunker stance config (otherwise the toggle
    /// would never be a positive choice and most tests degenerate).
    fn fresh_state() -> PolicyState {
        let mut s = default_state();
        s.self_side.stats.hunker_reduction_pct = 40.0;
        s
    }

    #[test]
    fn id_is_in_builtin_namespace() {
        assert_eq!(HunkerDecision::new().id(), "builtin.hunker");
    }

    #[test]
    fn really_fast_default_is_always_on() {
        let state = fresh_state();
        let d = HunkerDecision::new();
        assert_eq!(d.really_fast_default(&state), Some(true));
    }

    #[test]
    fn delta_negative_when_no_reduction_value() {
        let mut state = fresh_state();
        state.self_side.stats.hunker_reduction_pct = 0.0;
        let d = HunkerDecision::new();
        assert!(d.on_off_delta(&state) < 0.0);
    }

    #[test]
    fn delta_positive_when_incoming_dominates_outgoing() {
        let mut state = fresh_state();
        // Heavy opp DPS, modest actor DPS → block-value > damage-cost.
        state.opponent.stats.damage = 200.0;
        state.self_side.stats.damage = 50.0;
        let d = HunkerDecision::new();
        assert!(d.on_off_delta(&state) > 0.0);
    }

    #[test]
    fn delta_negative_when_outgoing_dominates_incoming() {
        let mut state = fresh_state();
        // Strong actor DPS, weak opp → losing 50 % own DPS hurts more.
        state.self_side.stats.damage = 300.0;
        state.opponent.stats.damage = 50.0;
        let d = HunkerDecision::new();
        assert!(d.on_off_delta(&state) < 0.0);
    }

    #[test]
    fn always_eligible() {
        let state = fresh_state();
        let d = HunkerDecision::new();
        assert!(d.is_eligible(&state));
    }

    /// Hysteresis: in a borderline state where raw delta hovers
    /// near zero, the toggle must NOT flip on its own - it stays in
    /// whichever state the caller declares as "currently on / off".
    #[test]
    fn hysteresis_keeps_current_state_in_dead_zone() {
        // Set actor and opp so out_dps × 0.5 ≈ in_dps × reduction.
        // damage stats are similar, so the event-discrete blocked
        // and lost terms come out near each other.
        let mut state = fresh_state();
        state.self_side.stats.damage = 100.0;
        state.opponent.stats.damage = 100.0 / 0.4 * 0.5; // ≈125
        state.self_side.stats.health = 1_000.0;
        let d = HunkerDecision::new();

        // Without currently_on, raw delta could be slightly negative;
        // dead-zone biases it more negative → stays OFF.
        let delta_off_default = d.on_off_delta(&state);

        // currently_on = true biases positive by dead_zone (~5 HP).
        state
            .self_side
            .extras
            .insert(CURRENTLY_ON_EXTRA_KEY.to_string(), PolicyValue::Bool(true));
        let delta_on_after_bias = d.on_off_delta(&state);

        // Same raw delta, opposite biases. Difference must be 2 ×
        // dead_zone (within float tolerance).
        let dead_zone_total = 2.0 * state.self_side.stats.health * HYSTERESIS_DEAD_ZONE_PCT_MAX_HP;
        let observed = delta_on_after_bias - delta_off_default;
        assert!(
            (observed - dead_zone_total).abs() < 1e-6,
            "hysteresis bias must be ±dead_zone: expected {dead_zone_total}, got {observed}"
        );
    }

    /// Hysteresis must NOT prevent a strong signal from flipping
    /// the toggle - when raw delta exceeds the dead-zone in
    /// magnitude, the current state is overridden regardless of
    /// extras bias.
    #[test]
    fn hysteresis_yields_to_strong_signal() {
        let mut state = fresh_state();
        // Heavy opp DPS - blocked-incoming dominates by far.
        state.opponent.stats.damage = 500.0;
        state.self_side.stats.damage = 50.0;
        state.self_side.stats.health = 1_000.0;
        // Even with currently_on=false biasing OFF, raw delta is so
        // strongly positive that biased delta still > 0.
        state
            .self_side
            .extras
            .insert(CURRENTLY_ON_EXTRA_KEY.to_string(), PolicyValue::Bool(false));
        let d = HunkerDecision::new();
        let biased = d.on_off_delta(&state);
        assert!(
            biased > 0.0,
            "strong incoming pressure should turn Hunker ON even with OFF bias: got {biased}"
        );
    }

    /// Event-discrete window: when opp's next bite is *outside* the
    /// adaptive horizon, blocked-incoming for bites drops to zero
    /// for that bite - Hunker should not stay on just because
    /// average DPS looked threatening.
    #[test]
    fn delta_drops_when_opp_next_hit_is_far_outside_window() {
        let mut state = fresh_state();
        state.self_side.stats.damage = 50.0;
        state.opponent.stats.damage = 200.0;
        state.self_side.stats.bite_cooldown = 1.0;
        state.opponent.stats.bite_cooldown = 1.0; // horizon ≈ 6 s
        state.time = 0.0;
        // Opp's next bite is far past the 6 s horizon.
        state.opponent.next_hit = 100.0;
        state.self_side.next_hit = 0.0; // attacker keeps biting
        let d = HunkerDecision::new();
        let delta = d.on_off_delta(&state);
        // No incoming, full outgoing-loss - must be net negative.
        assert!(
            delta < 0.0,
            "no opp bites in window ⇒ Hunker should not be net-positive: got {delta}"
        );
    }
}
