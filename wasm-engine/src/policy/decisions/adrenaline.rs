//! Built-in Adrenaline decision.
//!
//! Reference: `ability_adrenaline` in `src/pages/referenceContent.ts`.
//!
//! Adrenaline is a pure outgoing buff (1.2x bite damage) for 30 s on
//! a 90 s cooldown, with no cost and no defensive component.
//! Reference policyDifferences explicitly state:
//!
//! > Adrenaline activates as soon as it is available across all
//! > timing policy modes. The 1.2x bite-damage buff is treated as a
//! > pure outgoing buff with no cost, so firing as early as possible
//! > strictly dominates any delayed window.
//!
//! Implementation:
//!
//! - `utility()` returns expected bonus damage (0.2 × out_dps × min(30 s,
//!   remaining_fight)). Strictly decreases as `delay` grows because
//!   `remaining_fight` shrinks — so the search policies always pick
//!   `delay = 0`.
//! - `really_fast_gate()` returns `Some(true)` whenever
//!   [`TimedDecision::is_available`] is true. ReallyFast fires immediately.

use crate::policy::state::PolicyState;
use crate::policy::traits::TimedDecision;

/// Stable id under which this decision registers.
pub const ADRENALINE_DECISION_ID: &str = "builtin.adrenaline";

/// Active duration of one Adrenaline cast.
pub const ACTIVE_SEC: f64 = 30.0;

/// Bite damage multiplier while Adrenaline is active.
const BUFF_MULTIPLIER: f64 = 1.2;

/// Built-in Adrenaline timed decision.
#[derive(Debug, Default, Clone)]
pub struct AdrenalineDecision;

impl AdrenalineDecision {
    pub fn new() -> Self {
        Self
    }
}

impl TimedDecision for AdrenalineDecision {
    fn id(&self) -> &str {
        ADRENALINE_DECISION_ID
    }

    fn utility(&self, state: &PolicyState) -> f64 {
        // Expected extra outgoing damage during the 30 s active
        // window. The +20% multiplier translates to 0.2 × baseline
        // damage per bite. The window contracts as the fight nears
        // its end (`remaining`), so utility strictly decreases with
        // `delay`. That property is what makes search policies pick
        // `delay = 0` automatically — the engine doesn't need a
        // dedicated "always fire ASAP" code path.
        let out_dps = state.self_side.bite_dps();
        if out_dps <= 0.0 {
            return 0.0;
        }
        let remaining = state.remaining_fight_sec(out_dps, state.opponent.bite_dps());
        if remaining <= 0.0 {
            return 0.0;
        }
        let window = ACTIVE_SEC.min(remaining);
        let extra_dmg_per_sec = out_dps * (BUFF_MULTIPLIER - 1.0);
        extra_dmg_per_sec * window
    }

    fn is_available(&self, state: &PolicyState) -> bool {
        state.self_side.is_idle_for(state.time, ADRENALINE_DECISION_ID)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::policy::testing::default_state as fresh_state;

    #[test]
    fn id_is_in_builtin_namespace() {
        assert_eq!(AdrenalineDecision::new().id(), "builtin.adrenaline");
    }

    #[test]
    fn available_when_no_cooldown_or_active_window() {
        let state = fresh_state();
        let d = AdrenalineDecision::new();
        assert!(d.is_available(&state));
    }

    #[test]
    fn unavailable_during_cooldown() {
        let mut state = fresh_state();
        state
            .self_side
            .cooldowns
            .insert(ADRENALINE_DECISION_ID.to_string(), 90.0);
        state.time = 30.0;
        let d = AdrenalineDecision::new();
        assert!(!d.is_available(&state));
    }

    #[test]
    fn unavailable_while_active_window_open() {
        let mut state = fresh_state();
        state
            .self_side
            .active_until
            .insert(ADRENALINE_DECISION_ID.to_string(), 30.0);
        state.time = 10.0;
        let d = AdrenalineDecision::new();
        assert!(!d.is_available(&state));
    }

    #[test]
    fn really_fast_gate_fires_when_available() {
        let state = fresh_state();
        let d = AdrenalineDecision::new();
        assert_eq!(d.really_fast_gate(&state), Some(true));
    }

    #[test]
    fn really_fast_gate_skips_during_cooldown() {
        let mut state = fresh_state();
        state
            .self_side
            .cooldowns
            .insert(ADRENALINE_DECISION_ID.to_string(), 90.0);
        state.time = 30.0;
        let d = AdrenalineDecision::new();
        assert_eq!(d.really_fast_gate(&state), Some(false));
    }

    #[test]
    fn utility_strictly_decreases_with_delay_until_window_caps() {
        let d = AdrenalineDecision::new();
        // Long fight: utility = 0.2 × 50 dps × 30 s window =
        // 300 baseline. Should plateau at the constant 300 once
        // remaining_fight ≥ 30, but tail off as remaining shrinks.
        let make_at = |remaining_hp: f64, opp_hp: f64| {
            let mut s = fresh_state();
            s.self_side.hp = remaining_hp;
            s.opponent.hp = opp_hp;
            s
        };
        let u_long = d.utility(&make_at(10_000.0, 10_000.0));
        let u_mid = d.utility(&make_at(5_000.0, 5_000.0));
        let u_short = d.utility(&make_at(500.0, 500.0));
        assert!(u_long >= u_mid - 1e-9, "long horizon ≥ mid: {u_long} vs {u_mid}");
        assert!(u_mid > u_short, "mid horizon > short tail: {u_mid} vs {u_short}");
    }

    #[test]
    fn utility_zero_when_opponent_already_dead() {
        let mut state = fresh_state();
        state.opponent.hp = 0.0;
        let d = AdrenalineDecision::new();
        assert_eq!(d.utility(&state), 0.0);
    }

    #[test]
    fn utility_zero_when_actor_has_no_damage() {
        let mut state = fresh_state();
        state.self_side.stats.damage = 0.0;
        let d = AdrenalineDecision::new();
        assert_eq!(d.utility(&state), 0.0);
    }
}
