//! Built-in Unbridled Rage decision.
//!
//! Reference: `ability_unbridled_rage` in `src/pages/referenceContent.ts`.
//!
//! UR is the same shape as Adrenaline: a pure outgoing buff (1.3x bite damage,
//! 30 s, 120 s cooldown), no cost, no defensive component. Earlier application
//! weakly dominates - the buff magnitude is identical wherever the window lands
//! within a fight that fits its full duration, and earlier outgoing damage
//! shortens opponent TTK.
//!
//! There is therefore no timing to search: the decision reduces to its gate. A
//! measurement sweep (`composable::policy_gate_classification`) confirmed
//! `Ideal == ReallyFast == Extreme` on real matchups, so `utility` delegates to
//! the ReallyFast gate via [`gate_only_utility`](super::gate_only_utility).

use crate::policy::state::PolicyState;
use crate::policy::traits::TimedDecision;

/// Stable id under which this decision registers.
pub const UNBRIDLED_RAGE_DECISION_ID: &str = "builtin.unbridled_rage";

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
        super::gate_only_utility(self.really_fast_gate(state))
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
    fn utility_mirrors_the_gate() {
        // Delete-to-gate: flat positive when available (search fires at delay 0),
        // -inf during cooldown (search skips).
        let d = UnbridledRageDecision::new();
        assert!(d.utility(&fresh_state()) > 0.0);

        let mut on_cooldown = fresh_state();
        on_cooldown
            .self_side
            .cooldowns
            .insert(UNBRIDLED_RAGE_DECISION_ID.to_string(), 120.0);
        on_cooldown.time = 30.0;
        assert_eq!(d.utility(&on_cooldown), f64::NEG_INFINITY);
    }
}
