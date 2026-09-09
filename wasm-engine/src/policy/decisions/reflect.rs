//! Built-in Reflect decision.
//!
//! Reference: `ability_reflect` in `src/pages/referenceContent.ts`.
//!
//! Reflect has a fixed 6 s active window and a 45 s cooldown. Both the
//! damage-block and the reflected-damage components scale with how much incoming
//! damage lands during the window, so an earlier recast weakly dominates: it
//! covers more of the fight tail and its value never overhangs the fight end.
//!
//! There is therefore no timing to search: the decision reduces to its gate
//! ("recast as soon as it is available again"). A measurement sweep
//! (`composable::policy_gate_classification`) confirmed
//! `Ideal == ReallyFast == Extreme` on real matchups, so `utility` delegates to
//! the ReallyFast gate via [`gate_only_utility`](super::gate_only_utility) -
//! every mode fires at the same instant with no value formula to rot.

use crate::policy::state::PolicyState;
use crate::policy::traits::TimedDecision;

/// Stable id under which this decision registers.
pub const REFLECT_DECISION_ID: &str = "builtin.reflect";

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
        super::gate_only_utility(self.really_fast_gate(state))
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
    fn utility_mirrors_the_gate() {
        // Delete-to-gate: flat positive when available (search fires at delay 0),
        // -inf during cooldown (search skips). Opponent DPS no longer gates it -
        // Reflect recasts whenever available, matching ReallyFast.
        let d = ReflectDecision::new();
        assert!(d.utility(&fresh_state()) > 0.0);

        let mut on_cooldown = fresh_state();
        on_cooldown
            .self_side
            .cooldowns
            .insert(REFLECT_DECISION_ID.to_string(), 60.0);
        on_cooldown.time = 30.0;
        assert_eq!(d.utility(&on_cooldown), f64::NEG_INFINITY);
    }
}
