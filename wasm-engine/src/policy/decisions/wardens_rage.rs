//! Built-in Warden's Rage toggle decision.
//!
//! Reference: `ability_wardens_rage` in `src/pages/referenceContent.ts`.
//!
//! Warden's Rage is a toggle with state:
//!
//! - HP-scaling stacks: `stacks = wardens_rage_stacks_from_hp_ratio(hp / max_hp)`
//!   - 0 stacks at 100% HP, 100 stacks at <= 50% HP, linear in
//!   between.
//! - Damage multiplier while ON: `1 + 7.5 * stacks/100`. At 100
//!   stacks the actor deals 8.5x bite damage.
//! - Natural regen disabled while ON.
//! - 30 s cooldown counted from turn-ON; toggling OFF is free, but
//!   re-toggling ON requires the cooldown to have elapsed since
//!   the last turn-ON.
//! - Stacks "stick" after toggling OFF - the multiplier the actor
//!   was wearing remains on subsequent bites until the next
//!   activation refreshes the stack count.
//!
//! Replaces the prior `decide_warden_rage_by_search` (full nested
//! sims per candidate timing) with an analytic delta. Reference
//! policyDifferences:
//!
//! - ReallyFast: always on. Engine wires this via
//!   `really_fast_default = Some(true)` and the matching
//!   `AlwaysOnIfEligibleTogglePolicy` for the ReallyFast/Fast modes.
//! - Fast: same shape (Reference describes a "simpler non-precision
//!   decision path"; the new framework's Fast policy reuses the
//!   ReallyFast-style policy and returns the same default).
//! - Precision: utility-driven. The decision compares damage gain
//!   from being ON over a horizon vs lost passive regen over the
//!   same horizon, signed.

use crate::combat::wardens_rage_stacks_from_hp_ratio;
use crate::policy::state::{PolicyState, PolicyValue};
use crate::policy::traits::ToggleDecision;

/// Stable id under which this decision registers.
pub const WARDEN_RAGE_DECISION_ID: &str = "builtin.wardens_rage";

/// Bridge fills this extras key with `Bool(true|false)` reflecting
/// the actor's CURRENT toggle state. Decision reads it in
/// `is_eligible` to grandfather "stay on" through the cooldown
/// (cooldown only gates fresh turn-ons).
pub const CURRENT_STATE_EXTRA_KEY: &str = "builtin.wardens_rage.on";

/// Horizon over which on/off value delta is evaluated.
const VALUE_HORIZON_SEC: f64 = 12.0;

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

    fn on_off_delta(&self, state: &PolicyState) -> f64 {
        let actor = &state.self_side;
        let max_hp = actor.stats.health.max(1.0);
        let hp_ratio = (actor.hp / max_hp).clamp(0.0, 1.0);
        let stacks = wardens_rage_stacks_from_hp_ratio(hp_ratio);
        let buff_multiplier = 1.0 + 7.5 * (stacks as f64 / 100.0);
        let extra_factor = (buff_multiplier - 1.0).max(0.0);

        // Damage gain over horizon if ON.
        let dmg_gain = actor.bite_dps() * extra_factor * VALUE_HORIZON_SEC;

        // Regen lost over horizon if ON. Regen ticks at 15 s cadence.
        let regen_ticks = (VALUE_HORIZON_SEC / 15.0).max(0.0);
        let regen_per_tick = max_hp * (actor.stats.health_regen / 100.0).max(0.0);
        let regen_loss = regen_per_tick * regen_ticks;

        dmg_gain - regen_loss
    }

    fn is_eligible(&self, state: &PolicyState) -> bool {
        // Currently ON → engine may keep it on regardless of cooldown.
        let currently_on = state
            .self_side
            .extras
            .get(CURRENT_STATE_EXTRA_KEY)
            .and_then(PolicyValue::as_bool)
            .unwrap_or(false);
        // OFF → cooldown gate for fresh re-activation.
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
    use crate::policy::state::{PolicyState, PolicyValue};
    use crate::policy::testing::default_state;

    /// Warden's Rage utility tests need non-zero passive regen so the
    /// "regen lost while ON" term is observable; the bare default
    /// gives a 0-regen actor and most positive cases would degenerate.
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
    fn delta_zero_at_full_hp_when_no_regen_loss() {
        let mut state = fresh_state();
        state.self_side.stats.health_regen = 0.0;
        let d = WardensRageDecision::new();
        // hp = max → 0 stacks → buff_mult = 1.0 → dmg_gain = 0; regen_loss = 0.
        let delta = d.on_off_delta(&state);
        assert!(delta.abs() < 1e-9, "0 stacks at full HP → delta = 0: got {delta}");
    }

    #[test]
    fn delta_strongly_positive_when_low_hp() {
        let mut state = fresh_state();
        state.self_side.hp = 5_000.0; // 50 % HP → 100 stacks → 8.5x buff.
        let d = WardensRageDecision::new();
        assert!(d.on_off_delta(&state) > 0.0);
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
        // OFF → ineligible.
        assert!(!d.is_eligible(&state));
        // ON → eligible (engine may choose to stay on through cooldown).
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
        assert_eq!(wardens_rage_stacks_from_hp_ratio(1.0), 0);
        assert_eq!(wardens_rage_stacks_from_hp_ratio(0.5), 100);
        assert_eq!(wardens_rage_stacks_from_hp_ratio(0.4), 100);
        assert_eq!(wardens_rage_stacks_from_hp_ratio(0.75), 50);
    }
}
