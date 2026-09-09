//! Built-in Rewind decision.
//!
//! Reference: `ability_rewind` in `src/pages/referenceContent.ts`.
//!
//! Rewind is a one-shot defensive: 100 s cooldown, heals the actor's HP toward
//! its value ~9 s in the past, capped at 50 % maxHP. Game Rewind restores HP
//! only - statuses are NOT rolled back. Two-part mechanic:
//!
//! 1. Decision (this file) - should the actor fire Rewind now?
//! 2. Restoration (engine) - when fired, the engine looks up the 9-s-ago
//!    snapshot in `CombatSide::rewind_history` and heals HP toward it.
//!
//! Per the framework split, this file owns ONLY the decision. Restoration
//! mechanics stay in `abilities::rewind_breath::apply_rewind_restoration`,
//! invoked with an explicit `should_activate: bool` from the bridge.
//!
//! Delete-to-gate
//!
//! The decision reduces to its gate: fire once HP <= 75 % (the ReallyFast
//! threshold) and the 9-s-ago snapshot would actually restore HP
//! (`restored_hp_delta > 0`). A measurement sweep
//! (`composable::policy_gate_classification`) confirmed that routing the
//! precision modes through this gate flips 0 winners across the full divergence
//! regime - 63/63 cells where the earlier `restored_hp_delta` utility fired
//! above the 75 % gate, plus the main table. So `utility` delegates to the gate
//! via [`gate_only_utility`](super::gate_only_utility) with no value formula to
//! rot.
//!
//! The gate reads the delta SIGN: a non-positive delta means the snapshot is at
//! or below current HP, so firing restores nothing while burning the 100 s
//! cooldown - and, because `apply_rewind_restoration` passes a negative delta
//! through, it would heal HP *backward* toward the lower past value. Requiring
//! `delta > 0` suppresses that strictly-wasteful (self-harming) recast. It can
//! only remove casts, never add them, so it stays within the "0 winner change"
//! the sweep measured for the below-75 % regime.

use crate::policy::state::{PolicyState, PolicyValue};
use crate::policy::traits::TimedDecision;

/// Stable id under which this decision registers.
pub const REWIND_DECISION_ID: &str = "builtin.rewind";

/// Extras key the bridge fills with the snapshot's restored-HP delta (post-cap,
/// in HP units). The decision uses only its PRESENCE (a snapshot exists) as an
/// availability signal; the numeric value is no longer read.
pub const RESTORED_HP_DELTA_KEY: &str = "builtin.rewind.restored_hp_delta";

/// ReallyFast hard gate: HP ratio at or below 75 %.
const REALLY_FAST_MAX_HP_RATIO: f64 = 0.75;

/// Built-in Rewind timed decision.
#[derive(Debug, Default, Clone)]
pub struct RewindDecision;

impl RewindDecision {
    pub fn new() -> Self {
        Self
    }
}

impl TimedDecision for RewindDecision {
    fn id(&self) -> &str {
        REWIND_DECISION_ID
    }

    fn utility(&self, state: &PolicyState) -> f64 {
        super::gate_only_utility(self.really_fast_gate(state))
    }

    fn is_available(&self, state: &PolicyState) -> bool {
        state.self_side.is_idle_for(state.time, REWIND_DECISION_ID)
            // No snapshot delta extras populated -> bridge couldn't find
            // a 9-s-ago snapshot -> not eligible.
            && state.self_side.extras.contains_key(RESTORED_HP_DELTA_KEY)
    }

    fn really_fast_gate(&self, state: &PolicyState) -> Option<bool> {
        if !self.is_available(state) {
            return Some(false);
        }
        // Only fire when the snapshot would actually restore HP. A non-positive
        // delta heals backward (or not at all) yet still burns the 100 s
        // cooldown - never worth it, so gate it out regardless of how wounded
        // the actor is.
        let restores_hp = state
            .self_side
            .extras
            .get(RESTORED_HP_DELTA_KEY)
            .and_then(PolicyValue::as_number)
            .is_some_and(|delta| delta > 0.0);
        Some(restores_hp && state.self_side.hp_ratio() <= REALLY_FAST_MAX_HP_RATIO)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::policy::state::{PolicyState, PolicyValue};
    use crate::policy::testing::default_state;

    fn fresh_state_with_snapshot(restored_hp: f64) -> PolicyState {
        let mut s = default_state();
        s.self_side
            .extras
            .insert(RESTORED_HP_DELTA_KEY.to_string(), PolicyValue::Number(restored_hp));
        s
    }

    #[test]
    fn id_is_in_builtin_namespace() {
        assert_eq!(RewindDecision::new().id(), "builtin.rewind");
    }

    #[test]
    fn unavailable_when_no_snapshot_extras() {
        let mut state = default_state();
        state.self_side.hp = 5_000.0;
        let d = RewindDecision::new();
        assert!(!d.is_available(&state));
    }

    #[test]
    fn unavailable_during_cooldown() {
        let mut state = fresh_state_with_snapshot(2_000.0);
        state.self_side.hp = 5_000.0;
        state
            .self_side
            .cooldowns
            .insert(REWIND_DECISION_ID.to_string(), 100.0);
        state.time = 50.0;
        let d = RewindDecision::new();
        assert!(!d.is_available(&state));
    }

    #[test]
    fn really_fast_gate_fires_at_or_below_seventy_five_percent_hp() {
        let mut state = fresh_state_with_snapshot(1_000.0);
        state.self_side.hp = 7_500.0; // 75 %
        let d = RewindDecision::new();
        assert_eq!(d.really_fast_gate(&state), Some(true));
        state.self_side.hp = 4_000.0;
        assert_eq!(d.really_fast_gate(&state), Some(true));
    }

    #[test]
    fn really_fast_gate_skips_above_seventy_five_percent_hp() {
        let mut state = fresh_state_with_snapshot(500.0);
        state.self_side.hp = 9_000.0; // 90 %
        let d = RewindDecision::new();
        assert_eq!(d.really_fast_gate(&state), Some(false));
    }

    #[test]
    fn really_fast_gate_skips_when_snapshot_would_not_restore_hp() {
        // Wounded (below 75 %) but the 9-s-ago snapshot is at or below current
        // HP: firing restores nothing (delta 0) or heals backward (delta < 0),
        // so the gate must skip regardless of the wound.
        let d = RewindDecision::new();
        for delta in [0.0, -1_500.0] {
            let mut state = fresh_state_with_snapshot(delta);
            state.self_side.hp = 4_000.0; // 40 %
            assert_eq!(
                d.really_fast_gate(&state),
                Some(false),
                "delta {delta} restores no HP; gate must not burn the cooldown",
            );
        }
    }

    #[test]
    fn utility_mirrors_the_gate() {
        // Delete-to-gate: flat positive once the gate fires (HP <= 75 % with a
        // restoring snapshot; search fires at delay 0), -inf when it skips.
        let d = RewindDecision::new();
        let mut wounded = fresh_state_with_snapshot(1_000.0);
        wounded.self_side.hp = 4_000.0; // 40 %, delta +1000
        assert!(d.utility(&wounded) > 0.0);

        let mut healthy = fresh_state_with_snapshot(1_000.0);
        healthy.self_side.hp = 9_000.0; // 90 % > gate
        assert_eq!(d.utility(&healthy), f64::NEG_INFINITY);

        let mut wounded_no_gain = fresh_state_with_snapshot(-500.0);
        wounded_no_gain.self_side.hp = 4_000.0; // 40 % but delta < 0
        assert_eq!(d.utility(&wounded_no_gain), f64::NEG_INFINITY);
    }
}
