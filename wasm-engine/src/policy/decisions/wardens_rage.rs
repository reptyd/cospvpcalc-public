//! Built-in Warden's Rage toggle decision.
//!
//! Reference: `ability_wardens_rage` in `src/pages/referenceContent.ts`.
//!
//! This decision drives the MANUAL (policy / RF) controller. Warden's
//! Rage is one switch with two controllers; the passive controller
//! (damage -> on, full-HP -> off) runs mechanically on top in the
//! post-tick phase. State:
//!
//! - HP-scaling value: `wardens_rage_stacks_from_hp_ratio(hp / max_hp)`
//!   = game `GetRageValue`: 1 at 100% HP, 100 at <= 50% HP.
//! - Damage multiplier while ON: `wardens_rage_multiplier(value)`
//!   = game `max(1, value/100 * 8.5)`. At value 100 the actor deals
//!   8.5x bite damage.
//! - Natural regen disabled while ON.
//! - 30 s cooldown counted from manual turn-ON; manual OFF is free,
//!   but re-toggling ON requires the cooldown to have elapsed since
//!   the last manual turn-ON.
//! - The value is zeroed on every off-transition; the multiplier is
//!   1.0 whenever the switch is off.
//!
//! This type carries only the pi-zero ("always on if eligible") surface -
//! `really_fast_default` + the stateful `is_eligible` (cooldown gate
//! for fresh manual turn-ons, grandfathering a current hold). Reference
//! policyDifferences:
//!
//! - ReallyFast / Fast: always on. Engine wires this via
//!   `really_fast_default = Some(true)` and the matching
//!   `AlwaysOnIfEligibleTogglePolicy`.
//! - Precision: decided by the engine-replay `toggle_replay_bridge`
//!   behind `TOGGLE_ROLLOUT` (hold vs harvest vs off-always). The old
//!   analytic damage-gain-vs-regen-loss delta was blind to the
//!   buffered-regen harvest and was removed.

use crate::policy::state::{PolicyState, PolicyValue};
use crate::policy::traits::ToggleDecision;

/// Stable id under which this decision registers.
pub const WARDEN_RAGE_DECISION_ID: &str = "builtin.wardens_rage";

/// Bridge fills this extras key with `Bool(true|false)` reflecting
/// the actor's CURRENT toggle state. Decision reads it in
/// `is_eligible` to grandfather "stay on" through the cooldown
/// (cooldown only gates fresh turn-ons).
pub const CURRENT_STATE_EXTRA_KEY: &str = "builtin.wardens_rage.on";

/// Built-in Warden's Rage toggle decision.
#[derive(Debug, Default, Clone)]
pub struct WardensRageDecision;

impl WardensRageDecision {
    pub fn new() -> Self {
        Self
    }
}

impl ToggleDecision for WardensRageDecision {
    fn id(&self) -> &str {
        WARDEN_RAGE_DECISION_ID
    }

    fn is_eligible(&self, state: &PolicyState) -> bool {
        // Currently ON -> engine may keep it on regardless of cooldown.
        let currently_on = state
            .self_side
            .extras
            .get(CURRENT_STATE_EXTRA_KEY)
            .and_then(PolicyValue::as_bool)
            .unwrap_or(false);
        // OFF -> cooldown gate for fresh re-activation.
        currently_on || state.self_side.is_idle_for(state.time, WARDEN_RAGE_DECISION_ID)
    }

    fn really_fast_default(&self, _state: &PolicyState) -> Option<bool> {
        // ReallyFast / Fast: always ON when eligible. Reference
        // text: "Really fast turns Warden's Rage on immediately
        // and keeps it active."
        Some(true)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::combat::wardens_rage_stacks_from_hp_ratio;
    use crate::policy::state::{PolicyState, PolicyValue};
    use crate::policy::testing::default_state;

    /// Warden's Rage eligibility tests: a wounded actor with passive
    /// regen so the cooldown / grandfather branches are exercised.
    fn fresh_state() -> PolicyState {
        let mut s = default_state();
        s.self_side.stats.health_regen = 5.0;
        s.opponent.stats.health_regen = 5.0;
        s
    }

    #[test]
    fn id_is_in_builtin_namespace() {
        assert_eq!(WardensRageDecision::new().id(), "builtin.wardens_rage");
    }

    #[test]
    fn really_fast_default_is_always_on() {
        let state = fresh_state();
        let d = WardensRageDecision::new();
        assert_eq!(d.really_fast_default(&state), Some(true));
    }

    #[test]
    fn currently_on_overrides_cooldown_eligibility() {
        let mut state = fresh_state();
        state
            .self_side
            .cooldowns
            .insert(WARDEN_RAGE_DECISION_ID.to_string(), 30.0);
        state.time = 5.0;
        // Cooldown not elapsed.
        let d = WardensRageDecision::new();
        // OFF -> ineligible.
        assert!(!d.is_eligible(&state));
        // ON -> eligible (engine may choose to stay on through cooldown).
        state
            .self_side
            .extras
            .insert(CURRENT_STATE_EXTRA_KEY.to_string(), PolicyValue::Bool(true));
        assert!(d.is_eligible(&state));
    }

    #[test]
    fn cooldown_gate_after_turn_off_blocks_re_activation() {
        let mut state = fresh_state();
        state
            .self_side
            .cooldowns
            .insert(WARDEN_RAGE_DECISION_ID.to_string(), 30.0);
        state.time = 10.0;
        state
            .self_side
            .extras
            .insert(CURRENT_STATE_EXTRA_KEY.to_string(), PolicyValue::Bool(false));
        let d = WardensRageDecision::new();
        assert!(!d.is_eligible(&state));
    }

    #[test]
    fn stacks_helper_matches_canonical_formula() {
        // Game GetRageValue = ceil(clamp(map(hp, 0.5..1 -> 100..1), 1, 100)).
        assert_eq!(wardens_rage_stacks_from_hp_ratio(1.0), 1);
        assert_eq!(wardens_rage_stacks_from_hp_ratio(0.5), 100);
        assert_eq!(wardens_rage_stacks_from_hp_ratio(0.4), 100);
        assert_eq!(wardens_rage_stacks_from_hp_ratio(0.75), 51);
    }
}
