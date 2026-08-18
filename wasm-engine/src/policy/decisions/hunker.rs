//! Built-in Hunker toggle decision (pi-zero surface).
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
//! This type carries only the pi-zero ("always on if eligible") surface -
//! `really_fast_default` + `is_eligible`. Every mode's toggle policy
//! is `AlwaysOnIfEligibleTogglePolicy`, so under flag-off precision the
//! toggle is always-on when eligible. The precision on/off value is
//! decided by the engine-replay `toggle_replay_bridge` behind
//! `TOGGLE_ROLLOUT` (the old analytic on/off delta measured a
//! degenerate delta of ~0 and was removed).

use crate::policy::state::PolicyState;
use crate::policy::traits::ToggleDecision;

/// Stable id under which this decision registers.
pub const HUNKER_DECISION_ID: &str = "builtin.hunker";

/// `state.self_side.extras` key carrying the actor's current Hunker
/// on/off state. The Hunker phase forwards it as read-only context;
/// missing key => treated as `false` (default "off"). Mirrors the
/// `builtin.wardens_rage.on` pattern.
pub const CURRENTLY_ON_EXTRA_KEY: &str = "builtin.hunker.on";

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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::policy::state::PolicyState;
    use crate::policy::testing::default_state;

    /// Hunker scenario baseline: actor wears the typical 40 % damage
    /// reduction from the hunker stance config.
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
    fn always_eligible() {
        let state = fresh_state();
        let d = HunkerDecision::new();
        assert!(d.is_eligible(&state));
    }
}
