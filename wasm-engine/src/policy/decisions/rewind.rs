//! Built-in Rewind decision.
//!
//! Reference: `ability_rewind` in `src/pages/referenceContent.ts`.
//!
//! Rewind is a one-shot defensive: 100 s cooldown, restores the
//! actor's HP and statuses to their state ~9 s in the past, capped
//! at 25 % maxHP healing. Two-part mechanic:
//!
//! 1. **Decision** (this file) — should the actor fire Rewind now?
//! 2. **Restoration** (engine) — when fired, the engine looks up
//!    the 9-s-ago snapshot in `CombatSide::rewind_history` and
//!    overwrites HP / statuses.
//!
//! Per the new framework split (pillar 6), this file owns ONLY the
//! decision. Restoration mechanics stay in
//! `abilities::rewind_breath::apply_rewind_if_ready`, which is now
//! invoked with an explicit `should_activate: bool` from the bridge.
//!
//! ## Utility model
//!
//! The bridge pre-computes the snapshot's HP and status-count
//! deltas relative to the current state and stuffs them into
//! `extras` so the decision stays a pure function of state:
//!
//! - `builtin.rewind.restored_hp_delta` — number, the HP gained if
//!   Rewind fires now (post-cap).
//! - `builtin.rewind.restored_status_delta` — number, current
//!   status count minus snapshot status count (positive ⇒ Rewind
//!   would clear at least that many statuses).
//!
//! `utility()` combines the two; ReallyFast gate is the
//! Reference-canonical 75 % HP threshold.

use crate::policy::state::{PolicyState, PolicyValue};
use crate::policy::traits::TimedDecision;

/// Stable id under which this decision registers.
pub const REWIND_DECISION_ID: &str = "builtin.rewind";

/// Extras key the bridge fills with the snapshot's restored-HP
/// delta (post-cap, in HP units).
pub const RESTORED_HP_DELTA_KEY: &str = "builtin.rewind.restored_hp_delta";

/// Extras key the bridge fills with the count delta (current
/// statuses minus snapshot statuses). Positive values mean Rewind
/// would strip that many statuses from the actor.
pub const RESTORED_STATUS_DELTA_KEY: &str = "builtin.rewind.restored_status_delta";

/// ReallyFast hard gate: HP ratio at or below 75 %.
const REALLY_FAST_MAX_HP_RATIO: f64 = 0.75;

/// Per-status notional value (HP-equivalent) for the count-delta
/// contribution. Cleansing one negative status is roughly the
/// same value as `STATUS_VALUE_HP_EQUIV` HP recovered. The
/// constant is intentionally conservative — overestimating leads
/// Ideal to fire too aggressively on low-pressure scenarios.
const STATUS_VALUE_HP_EQUIV: f64 = 50.0;

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
        let hp_delta = state
            .self_side
            .extras
            .get(RESTORED_HP_DELTA_KEY)
            .and_then(PolicyValue::as_number)
            .unwrap_or(0.0);
        let status_delta = state
            .self_side
            .extras
            .get(RESTORED_STATUS_DELTA_KEY)
            .and_then(PolicyValue::as_number)
            .unwrap_or(0.0);
        let status_value = status_delta.max(0.0) * STATUS_VALUE_HP_EQUIV;
        // `hp_delta` can be negative — actor was at lower HP 9 s ago,
        // so Rewind would heal *backwards*. The engine layer caps
        // positive deltas at +25 % maxHP before writing the extras;
        // negatives pass through unbounded so precision-mode search
        // ranks them strongly negative and picks "skip" naturally.
        hp_delta + status_value
    }

    fn is_available(&self, state: &PolicyState) -> bool {
        state.self_side.is_idle_for(state.time, REWIND_DECISION_ID)
            // No snapshot delta extras populated → bridge couldn't find
            // a 9-s-ago snapshot → not eligible.
            && state.self_side.extras.contains_key(RESTORED_HP_DELTA_KEY)
    }

    fn really_fast_gate(&self, state: &PolicyState) -> Option<bool> {
        if !self.is_available(state) {
            return Some(false);
        }
        let hp_ratio = state.self_side.hp_ratio();
        if hp_ratio <= REALLY_FAST_MAX_HP_RATIO {
            Some(true)
        } else {
            Some(false)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::policy::state::{PolicyState, PolicyValue};
    use crate::policy::testing::default_state;

    fn fresh_state_with_snapshot(restored_hp: f64, status_delta: f64) -> PolicyState {
        let mut s = default_state();
        s.self_side
            .extras
            .insert(RESTORED_HP_DELTA_KEY.to_string(), PolicyValue::Number(restored_hp));
        s.self_side.extras.insert(
            RESTORED_STATUS_DELTA_KEY.to_string(),
            PolicyValue::Number(status_delta),
        );
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
        let mut state = fresh_state_with_snapshot(2_000.0, 1.0);
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
        let mut state = fresh_state_with_snapshot(1_000.0, 0.0);
        state.self_side.hp = 7_500.0; // 75 %
        let d = RewindDecision::new();
        assert_eq!(d.really_fast_gate(&state), Some(true));
        state.self_side.hp = 4_000.0;
        assert_eq!(d.really_fast_gate(&state), Some(true));
    }

    #[test]
    fn really_fast_gate_skips_above_seventy_five_percent_hp() {
        let mut state = fresh_state_with_snapshot(500.0, 0.0);
        state.self_side.hp = 9_000.0; // 90 %
        let d = RewindDecision::new();
        assert_eq!(d.really_fast_gate(&state), Some(false));
    }

    #[test]
    fn utility_combines_hp_and_status_deltas() {
        let d = RewindDecision::new();
        let u = d.utility(&fresh_state_with_snapshot(1_000.0, 2.0));
        // hp_delta = 1000, status_delta = 2 ⇒ 2 * 50 = 100
        assert!((u - 1_100.0).abs() < 1e-9, "got {u}");
    }

    #[test]
    fn utility_negative_when_hp_delta_negative_and_no_status_help() {
        let d = RewindDecision::new();
        let u = d.utility(&fresh_state_with_snapshot(-500.0, 0.0));
        assert!(u < 0.0, "got {u}");
    }
}
