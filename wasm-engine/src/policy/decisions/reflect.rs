//! Built-in Reflect decision.
//!
//! Reference: `ability_reflect` in `src/pages/referenceContent.ts`.
//!
//! Reflect has a fixed 6 s active window and 60 s cooldown. Both
//! the damage-block and the reflected-damage components scale with
//! how much incoming damage lands during the window.
//!
//! Per Reference `policyDifferences`:
//!
//! - **ReallyFast / Fast** "recast Reflect as soon as it becomes
//!   available again." Implemented via the trait-default
//!   `really_fast_gate` (fire-when-available) plus the Fast policy's
//!   short candidate set, which converges on `delay = 0` whenever
//!   utility is positive.
//! - **Precision (SemiIdeal / Ideal / Extreme)** "can use timing
//!   search instead of blindly recasting on cooldown" — exactly
//!   what the candidate-search policy provides. Each candidate
//!   delay is evaluated through the `utility()` formula below,
//!   which decreases as the projected fight tail shrinks; precision
//!   modes pick the delay that maximises projected reflected
//!   damage + blocked damage over the remaining horizon.

use crate::policy::state::PolicyState;
use crate::policy::traits::TimedDecision;

/// Stable id under which this decision registers.
pub const REFLECT_DECISION_ID: &str = "builtin.reflect";

/// Active duration of one Reflect cast.
pub const ACTIVE_SEC: f64 = 6.0;

/// Built-in Reflect timed decision.
#[derive(Debug, Default, Clone)]
pub struct ReflectDecision;

impl ReflectDecision {
    pub fn new() -> Self {
        Self
    }
}

impl TimedDecision for ReflectDecision {
    fn id(&self) -> &str {
        REFLECT_DECISION_ID
    }

    fn utility(&self, state: &PolicyState) -> f64 {
        // Combined value of damage blocked + reflected over the 6 s
        // window. Both contributions scale linearly with incoming
        // DPS during the window, capped by the remaining fight tail.
        // Strictly decreasing in `delay` because a delayed cast
        // potentially overhangs the fight end.
        let in_dps = state.opponent.bite_dps();
        if in_dps <= 0.0 {
            return 0.0;
        }
        let remaining = state.remaining_fight_sec(state.self_side.bite_dps(), in_dps);
        if remaining <= 0.0 {
            return 0.0;
        }
        let window = ACTIVE_SEC.min(remaining);
        // Two contributions per second of incoming damage: prevented
        // (saved actor HP) and reflected (subtracted from opponent
        // HP). Magnitude factor ~2x in_dps captures both.
        2.0 * in_dps * window
    }

    fn is_available(&self, state: &PolicyState) -> bool {
        state.self_side.is_idle_for(state.time, REFLECT_DECISION_ID)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::policy::testing::default_state as fresh_state;

    #[test]
    fn id_is_in_builtin_namespace() {
        assert_eq!(ReflectDecision::new().id(), "builtin.reflect");
    }

    #[test]
    fn available_when_no_cooldown_or_active_window() {
        let state = fresh_state();
        let d = ReflectDecision::new();
        assert!(d.is_available(&state));
    }

    #[test]
    fn unavailable_during_cooldown() {
        let mut state = fresh_state();
        state
            .self_side
            .cooldowns
            .insert(REFLECT_DECISION_ID.to_string(), 60.0);
        state.time = 30.0;
        let d = ReflectDecision::new();
        assert!(!d.is_available(&state));
    }

    #[test]
    fn unavailable_during_active_window() {
        let mut state = fresh_state();
        state
            .self_side
            .active_until
            .insert(REFLECT_DECISION_ID.to_string(), 6.0);
        state.time = 3.0;
        let d = ReflectDecision::new();
        assert!(!d.is_available(&state));
    }

    #[test]
    fn really_fast_gate_fires_when_available() {
        let state = fresh_state();
        let d = ReflectDecision::new();
        assert_eq!(d.really_fast_gate(&state), Some(true));
    }

    #[test]
    fn utility_zero_when_opponent_does_no_damage() {
        let mut state = fresh_state();
        state.opponent.stats.damage = 0.0;
        let d = ReflectDecision::new();
        assert_eq!(d.utility(&state), 0.0);
    }

    #[test]
    fn utility_grows_with_opponent_dps() {
        let d = ReflectDecision::new();
        let make = |opp_dmg: f64| {
            let mut s = fresh_state();
            s.opponent.stats.damage = opp_dmg;
            // Long fight so utility is bounded by `window`, not by
            // `remaining`.
            s.opponent.hp = 1_000_000.0;
            s
        };
        let u_low = d.utility(&make(50.0));
        let u_high = d.utility(&make(200.0));
        assert!(
            u_high > u_low,
            "stronger opp DPS → more value to block + reflect: low={u_low}, high={u_high}"
        );
    }
}
