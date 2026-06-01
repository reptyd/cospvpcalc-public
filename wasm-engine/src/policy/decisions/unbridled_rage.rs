//! Built-in Unbridled Rage decision.
//!
//! Reference: `ability_unbridled_rage` in
//! `src/pages/referenceContent.ts`.
//!
//! UR is the same shape as Adrenaline: pure outgoing buff (1.3x bite
//! damage, 30 s, 120 s cooldown), no cost, no defensive component.
//! Earlier application weakly dominates because the buff magnitude
//! is identical regardless of when the window lands within a fight
//! that fits the full duration, and earlier outgoing damage
//! shortens opponent TTK.
//!
//! Implementation mirrors AdrenalineDecision with the UR-specific
//! multiplier (1.3 instead of 1.2) and id.

use crate::policy::state::PolicyState;
use crate::policy::traits::TimedDecision;

/// Stable id under which this decision registers.
pub const UNBRIDLED_RAGE_DECISION_ID: &str = "builtin.unbridled_rage";

/// Active duration of one Unbridled Rage cast.
pub const ACTIVE_SEC: f64 = 30.0;

/// Bite damage multiplier while UR is active.
const BUFF_MULTIPLIER: f64 = 1.3;

/// Built-in Unbridled Rage timed decision.
#[derive(Debug, Default, Clone)]
pub struct UnbridledRageDecision;

impl UnbridledRageDecision {
    pub fn new() -> Self {
        Self
    }
}

impl TimedDecision for UnbridledRageDecision {
    fn id(&self) -> &str {
        UNBRIDLED_RAGE_DECISION_ID
    }

    fn utility(&self, state: &PolicyState) -> f64 {
        let out_dps = state.self_side.bite_dps();
        if out_dps <= 0.0 {
            return 0.0;
        }
        let remaining = state.remaining_fight_sec(out_dps, state.opponent.bite_dps());
        if remaining <= 0.0 {
            return 0.0;
        }
        let window = ACTIVE_SEC.min(remaining);
        out_dps * (BUFF_MULTIPLIER - 1.0) * window
    }

    fn is_available(&self, state: &PolicyState) -> bool {
        state.self_side.is_idle_for(state.time, UNBRIDLED_RAGE_DECISION_ID)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::policy::testing::default_state as fresh_state;

    #[test]
    fn id_is_in_builtin_namespace() {
        assert_eq!(UnbridledRageDecision::new().id(), "builtin.unbridled_rage");
    }

    #[test]
    fn really_fast_gate_fires_when_available() {
        let state = fresh_state();
        let d = UnbridledRageDecision::new();
        assert_eq!(d.really_fast_gate(&state), Some(true));
    }

    #[test]
    fn unavailable_during_cooldown() {
        let mut state = fresh_state();
        state
            .self_side
            .cooldowns
            .insert(UNBRIDLED_RAGE_DECISION_ID.to_string(), 120.0);
        state.time = 30.0;
        let d = UnbridledRageDecision::new();
        assert!(!d.is_available(&state));
    }

    #[test]
    fn utility_grows_with_outgoing_dps() {
        let d = UnbridledRageDecision::new();
        let make = |dmg: f64| {
            let mut s = fresh_state();
            s.self_side.stats.damage = dmg;
            s.opponent.hp = 1_000_000.0;
            s
        };
        let u_low = d.utility(&make(50.0));
        let u_high = d.utility(&make(200.0));
        assert!(
            u_high > u_low,
            "stronger DPS → more buff value: low={u_low}, high={u_high}"
        );
    }
}
