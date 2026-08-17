//! Built-in Cocoon decision.
//!
//! Cocoon is a 3-phase defensive ability: 5 s lockdown (Ph1) + 5 s
//! invincibility & heal (Ph2) + 20 s +15% damage buff (Ph3), 120 s cooldown.
//! Triggers at HP <= 70%.
//!
//! `is_available()` enforces the cooldown gate, no current phase, and the 70 %
//! HP trigger. Every timing mode fires as soon as that gate passes: a
//! measurement sweep (`composable::policy_gate_classification`) confirmed
//! `Ideal == ReallyFast == Extreme` on real matchups, including an adversarial
//! probe where the earlier hand `utility()` refused a cast whose 5 s Ph1
//! lockdown was projected to be lethal - that survival skip changed the outcome
//! in 0 of 54 cells (a doomed actor dies whether it cocoons or not). So
//! `utility` delegates to the gate via
//! [`gate_only_utility`](super::gate_only_utility) with no value formula to rot.

use crate::policy::state::PolicyState;
use crate::policy::traits::TimedDecision;

/// Stable id under which this decision registers.
pub const COCOON_DECISION_ID: &str = "builtin.cocoon";

const HP_TRIGGER_RATIO: f64 = 0.70;

/// Built-in Cocoon timed decision.
#[derive(Debug, Default, Clone)]
pub struct CocoonDecision;

impl CocoonDecision {
    pub fn new() -> Self {
        Self
    }
}

impl TimedDecision for CocoonDecision {
    fn id(&self) -> &str {
        COCOON_DECISION_ID
    }

    fn utility(&self, state: &PolicyState) -> f64 {
        super::gate_only_utility(self.really_fast_gate(state))
    }

    fn is_available(&self, state: &PolicyState) -> bool {
        state.self_side.is_idle_for(state.time, COCOON_DECISION_ID)
            && state.self_side.hp_ratio() <= HP_TRIGGER_RATIO
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::policy::testing::default_state;

    #[test]
    fn id_is_in_builtin_namespace() {
        assert_eq!(CocoonDecision::new().id(), "builtin.cocoon");
    }

    #[test]
    fn unavailable_above_seventy_percent_hp() {
        let mut state = default_state();
        state.self_side.hp = 8_000.0; // 80%
        assert!(!CocoonDecision::new().is_available(&state));
    }

    #[test]
    fn available_at_seventy_percent_hp_or_below() {
        let mut state = default_state();
        state.self_side.hp = 7_000.0;
        assert!(CocoonDecision::new().is_available(&state));
        state.self_side.hp = 1_000.0;
        assert!(CocoonDecision::new().is_available(&state));
    }

    #[test]
    fn really_fast_gate_fires_when_available() {
        let mut state = default_state();
        state.self_side.hp = 5_000.0;
        assert_eq!(CocoonDecision::new().really_fast_gate(&state), Some(true));
    }

    #[test]
    fn utility_mirrors_the_gate() {
        // Delete-to-gate: flat positive once the HP gate passes (search fires at
        // delay 0), -inf above the 70 % trigger (search skips).
        let d = CocoonDecision::new();
        let mut wounded = default_state();
        wounded.self_side.hp = 5_000.0;
        assert!(d.utility(&wounded) > 0.0);

        let mut healthy = default_state();
        healthy.self_side.hp = 9_000.0; // 90% > trigger
        assert_eq!(d.utility(&healthy), f64::NEG_INFINITY);
    }
}
