//! Built-in Adrenaline decision.
//!
//! Reference: `ability_adrenaline` in `src/pages/referenceContent.ts`.
//!
//! Adrenaline is a pure outgoing buff (1.2x bite damage) for 30 s on a 90 s
//! cooldown, with no cost and no defensive component. Reference
//! policyDifferences state it "activates as soon as it is available across all
//! timing policy modes" - firing as early as possible strictly dominates any
//! delayed window.
//!
//! There is therefore no timing to search: the decision reduces to its gate. A
//! measurement sweep (`composable::policy_gate_classification`) confirmed
//! `Ideal == ReallyFast == Extreme` on real matchups, so `utility` delegates to
//! the ReallyFast gate (fire whenever available) via
//! [`gate_only_utility`](super::gate_only_utility). Every mode fires at the same
//! instant and there is no hand-authored value formula to rot on a rebalance.

use crate::policy::state::PolicyState;
use crate::policy::traits::TimedDecision;

/// Stable id under which this decision registers.
pub const ADRENALINE_DECISION_ID: &str = "builtin.adrenaline";

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
        super::gate_only_utility(self.really_fast_gate(state))
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
    fn utility_mirrors_the_gate() {
        // Delete-to-gate: utility is a flat positive when the gate fires (so the
        // search fires at delay 0) and -inf when it declines (so the search skips).
        let d = AdrenalineDecision::new();
        assert!(d.utility(&fresh_state()) > 0.0);

        let mut on_cooldown = fresh_state();
        on_cooldown
            .self_side
            .cooldowns
            .insert(ADRENALINE_DECISION_ID.to_string(), 90.0);
        on_cooldown.time = 30.0;
        assert_eq!(d.utility(&on_cooldown), f64::NEG_INFINITY);
    }
}
