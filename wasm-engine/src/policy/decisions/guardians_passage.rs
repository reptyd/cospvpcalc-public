//! Built-in Guardians Passage decision.
//!
//! Reference: `ability_guardians_passage` in `src/pages/referenceContent.ts`.
//!
//! Guardians Passage seals the user for a fixed 9 seconds on a 300 second
//! cooldown. What the seal is worth is the damage that lands inside those
//! 9 seconds, so a later cast is worth more only if the opponent hits harder
//! later - and a cast held back can be lost to the end of the fight entirely.
//! A measurement sweep (`composable::policy_gate_classification`) put it on the
//! spread of strong opponents: the seal changed the outcome in 12 of 36 cells,
//! and in none of them did Ideal or Extreme differ from ReallyFast on the winner
//! or on either death timestamp. The search only ever reproduced the gate, so
//! `utility` delegates to it via [`gate_only_utility`](super::gate_only_utility)
//! and there is no value formula to rot.

use crate::policy::state::PolicyState;
use crate::policy::traits::TimedDecision;

/// Stable id under which this decision registers.
pub const GUARDIANS_PASSAGE_DECISION_ID: &str = "builtin.guardians_passage";

/// Built-in Guardians Passage timed decision.
#[derive(Debug, Default, Clone)]
pub struct GuardiansPassageDecision;

impl GuardiansPassageDecision {
    pub fn new() -> Self {
        Self
    }
}

impl TimedDecision for GuardiansPassageDecision {
    fn id(&self) -> &str {
        GUARDIANS_PASSAGE_DECISION_ID
    }

    fn utility(&self, state: &PolicyState) -> f64 {
        super::gate_only_utility(self.really_fast_gate(state))
    }

    fn is_available(&self, state: &PolicyState) -> bool {
        state
            .self_side
            .is_idle_for(state.time, GUARDIANS_PASSAGE_DECISION_ID)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::policy::testing::default_state as fresh_state;

    #[test]
    fn id_is_in_builtin_namespace() {
        assert_eq!(
            GuardiansPassageDecision::new().id(),
            "builtin.guardians_passage"
        );
    }

    #[test]
    fn available_off_cooldown() {
        assert!(GuardiansPassageDecision::new().is_available(&fresh_state()));
    }

    #[test]
    fn unavailable_during_cooldown() {
        let mut state = fresh_state();
        state
            .self_side
            .cooldowns
            .insert(GUARDIANS_PASSAGE_DECISION_ID.to_string(), 300.0);
        state.time = 120.0;
        assert!(!GuardiansPassageDecision::new().is_available(&state));
    }

    #[test]
    fn utility_mirrors_the_gate() {
        let d = GuardiansPassageDecision::new();
        assert!(d.utility(&fresh_state()) > 0.0);

        let mut on_cooldown = fresh_state();
        on_cooldown
            .self_side
            .cooldowns
            .insert(GUARDIANS_PASSAGE_DECISION_ID.to_string(), 300.0);
        on_cooldown.time = 120.0;
        assert_eq!(d.utility(&on_cooldown), f64::NEG_INFINITY);
    }
}
