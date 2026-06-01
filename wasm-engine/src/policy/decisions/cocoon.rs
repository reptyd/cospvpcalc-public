//! Built-in Cocoon decision.
//!
//! Cocoon is a 3-phase defensive ability: 5 s lockdown (Ph1) +
//! 5 s invincibility & heal (Ph2) + 20 s +15% damage buff (Ph3),
//! 120 s cooldown. Triggers at HP <= 70%.
//!
//! - Fast / ReallyFast: fire whenever available + HP gate passes.
//! - Precision: also survival check — opp DPS over Ph1 lockdown
//!   must not kill the actor (with 5% maxHP safety margin).
//!
//! Implementation:
//!
//! - `is_available()` enforces cooldown gate, no current phase, and
//!   the 70 % HP trigger. Mode-agnostic — every timing mode sees
//!   the same eligibility set.
//! - `utility()` returns positive when the Ph1 survival check passes,
//!   `f64::NEG_INFINITY` when projected damage during the lockdown
//!   would kill the actor. Precision modes (which compare scores)
//!   skip negative-infinity candidates naturally.
//! - `really_fast_gate()` returns `Some(true)` whenever `is_available`
//!   — ReallyFast / Fast bypass the survival check by design
//!   (Reference: "fire whenever available + HP gate passes"), so the
//!   gate ignores utility magnitude.

use crate::policy::state::PolicyState;
use crate::policy::traits::TimedDecision;

/// Stable id under which this decision registers.
pub const COCOON_DECISION_ID: &str = "builtin.cocoon";

const HP_TRIGGER_RATIO: f64 = 0.70;
const PH1_DURATION_SEC: f64 = 5.0;
const SAFETY_MARGIN_RATIO: f64 = 0.05;

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
        let max_hp = state.self_side.stats.health.max(1.0);

        // Survival check: opp DPS during Ph1 must not kill us.
        let in_dps = state.opponent.bite_dps();
        let projected_damage = in_dps * PH1_DURATION_SEC;
        if state.self_side.hp <= projected_damage + max_hp * SAFETY_MARGIN_RATIO {
            // Precision modes compare candidate utilities; -∞ ensures
            // any other available candidate (or "skip") wins, while
            // ReallyFast / Fast still bypass utility via really_fast_gate.
            return f64::NEG_INFINITY;
        }

        // Value: Cocoon's heal (+30 % maxHP at Ph2 exit) plus buff
        // (15 % damage × 20 s active). The active window is capped
        // by remaining fight horizon so a delayed cast that overhangs
        // the fight end gets less buff value.
        let out_dps = state.self_side.bite_dps();
        let remaining = state.remaining_fight_sec(out_dps, in_dps);
        let buff_window = 20.0_f64.min(remaining);
        max_hp * 0.30 + out_dps * 0.15 * buff_window
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
    fn utility_skip_when_ph1_incoming_kills_actor() {
        let mut state = default_state();
        state.self_side.hp = 500.0; // 5% HP
        // Opp DPS huge → 5 s of Ph1 pre-heal would kill actor.
        state.opponent.stats.damage = 1_000.0;
        state.opponent.stats.bite_cooldown = 0.5;
        let u = CocoonDecision::new().utility(&state);
        assert!(u < 0.0, "fatal Ph1 must skip: got {u}");
    }

    #[test]
    fn utility_positive_when_survival_holds() {
        let mut state = default_state();
        state.self_side.hp = 5_000.0;
        state.opponent.stats.damage = 50.0;
        let u = CocoonDecision::new().utility(&state);
        assert!(u > 0.0, "positive utility on healthy survivor: got {u}");
    }

    #[test]
    fn really_fast_gate_fires_when_available() {
        let mut state = default_state();
        state.self_side.hp = 5_000.0;
        assert_eq!(CocoonDecision::new().really_fast_gate(&state), Some(true));
    }
}
