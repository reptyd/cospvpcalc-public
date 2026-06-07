//! Built-in Hunters Curse decision.
//!
//! Reference: `ability_hunters_curse` in `src/pages/referenceContent.ts`.
//!
//! Hunters Curse trades a 50 % maxHP upfront cost for 2× bite damage
//! over 30 s on a 120 s cooldown. Unique among the buffs migrated so
//! far in that the cost is non-trivial - the decision engine must
//! gate firing on **survival** (won't the cost + incoming damage in
//! the active window kill the actor before it kills the opponent?).
//!
//! Implementation:
//!
//! - `utility()` is the expected extra outgoing damage during the
//!   active window IF the survival check passes, otherwise
//!   `f64::NEG_INFINITY` - precision modes that compare candidate
//!   utilities skip negative-infinity scores naturally.
//! - `really_fast_gate()` returns `Some(true)` whenever
//!   `is_available` (no survival check) - Reference: ReallyFast /
//!   Fast fire on cooldown without survival math, the 1 HP floor in
//!   `apply_hunters_curse_self_cost` keeps the engine from suiciding.
//! - The 1 HP floor on the cost is enforced by the engine itself
//!   (`apply_hunters_curse_self_cost`); the decision only needs to
//!   gate on whether the *combat-effective* survival holds.

use crate::policy::state::PolicyState;
use crate::policy::traits::TimedDecision;

/// Stable id under which this decision registers.
pub const HUNTERS_CURSE_DECISION_ID: &str = "builtin.hunters_curse";

/// Active duration of one Hunters Curse cast.
pub const ACTIVE_SEC: f64 = 30.0;

/// Bite damage multiplier while Hunters Curse is active.
const BUFF_MULTIPLIER: f64 = 2.0;

/// Fraction of max HP the cast deducts upfront.
const HP_COST_RATIO: f64 = 0.5;

/// Survival buffer (HP) - the actor must finish the active window
/// strictly above this to satisfy the gate.
const END_WINDOW_SAFETY_HP: f64 = 1.0;

/// Built-in Hunters Curse timed decision.
#[derive(Debug, Default, Clone)]
pub struct HuntersCurseDecision;

impl HuntersCurseDecision {
    pub fn new() -> Self {
        Self
    }
}

impl TimedDecision for HuntersCurseDecision {
    fn id(&self) -> &str {
        HUNTERS_CURSE_DECISION_ID
    }

    fn utility(&self, state: &PolicyState) -> f64 {
        if !self.is_available(state) {
            return 0.0;
        }
        let actor = &state.self_side;
        let max_hp = actor.stats.health.max(1.0);
        // The 1 HP floor in the engine's `apply_hunters_curse_self_cost`
        // means the cast itself can never kill the actor - at worst the
        // actor lands at 1 HP. The survival concern this decision
        // models is the *active window*, not the cast.
        let hp_after_cost = (actor.hp - max_hp * HP_COST_RATIO).max(1.0);

        let out_dps = actor.bite_dps();
        if out_dps <= 0.0 {
            return f64::NEG_INFINITY;
        }
        let in_dps = state.opponent.bite_dps();

        // Survival check: actor must survive the buffed window.
        let buffed_out_dps = out_dps * BUFF_MULTIPLIER;
        let ttk_with_hc = (state.opponent.hp / buffed_out_dps).min(ACTIVE_SEC);
        if in_dps > 0.0
            && hp_after_cost < in_dps * ttk_with_hc + END_WINDOW_SAFETY_HP
        {
            // Precision-mode utility-skip - see module docstring.
            return f64::NEG_INFINITY;
        }

        // Value: extra outgoing damage during the active window.
        // Strictly decreasing in `delay` because both `ttk_with_hc`
        // and `state.opponent.hp` shrink.
        out_dps * (BUFF_MULTIPLIER - 1.0) * ttk_with_hc
    }

    fn is_available(&self, state: &PolicyState) -> bool {
        state.self_side.is_idle_for(state.time, HUNTERS_CURSE_DECISION_ID)
    }

    // really_fast_gate uses the trait default (fire when available).
    // Reference: ReallyFast / Fast fire HC on cooldown without a
    // survival check; the engine's 1 HP floor in
    // `apply_hunters_curse_self_cost` keeps the cast non-fatal.
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::policy::testing::default_state as fresh_state;

    #[test]
    fn id_is_in_builtin_namespace() {
        assert_eq!(HuntersCurseDecision::new().id(), "builtin.hunters_curse");
    }

    #[test]
    fn really_fast_gate_fires_when_available() {
        let state = fresh_state();
        let d = HuntersCurseDecision::new();
        assert_eq!(d.really_fast_gate(&state), Some(true));
    }

    #[test]
    fn unavailable_during_cooldown() {
        let mut state = fresh_state();
        state
            .self_side
            .cooldowns
            .insert(HUNTERS_CURSE_DECISION_ID.to_string(), 120.0);
        state.time = 30.0;
        let d = HuntersCurseDecision::new();
        assert!(!d.is_available(&state));
    }

    /// At low HP the engine's 1 HP floor on cost prevents the cast
    /// itself from killing - but the active-window survival check
    /// still rejects the candidate because surviving 30 s at 1 HP is
    /// effectively impossible against any non-trivial opponent.
    /// Precision-mode skip; ReallyFast / Fast bypass via the gate.
    #[test]
    fn precision_skips_at_post_floor_hp_because_window_kills() {
        let mut state = fresh_state();
        state.self_side.hp = 4_000.0; // 50 % cost would naively go below 0; engine floors at 1
        let u = HuntersCurseDecision::new().utility(&state);
        assert!(
            u.is_infinite() && u < 0.0,
            "post-floor HP fails active-window survival check → -∞: got {u}"
        );
    }

    #[test]
    fn utility_skip_when_actor_cannot_survive_window() {
        let mut state = fresh_state();
        state.self_side.hp = 5_500.0; // 5000 cost → 500 left
        // Big incoming DPS that depletes 500 HP in <30 s.
        state.opponent.stats.damage = 1_000.0;
        state.opponent.stats.bite_cooldown = 1.0;
        state.opponent.hp = 1_000_000.0; // long ttk
        let d = HuntersCurseDecision::new();
        let u = d.utility(&state);
        assert!(u < 0.0, "utility must signal skip when survival fails: got {u}");
    }

    #[test]
    fn utility_positive_when_cost_and_survival_hold() {
        let mut state = fresh_state();
        state.self_side.hp = 9_500.0;
        state.opponent.hp = 1_000_000.0; // long fight
        state.opponent.stats.damage = 30.0; // gentle incoming DPS
        let d = HuntersCurseDecision::new();
        let u = d.utility(&state);
        assert!(u > 0.0, "healthy actor against weak opp must yield positive utility: got {u}");
    }

    #[test]
    fn utility_zero_when_decision_not_available_at_all() {
        let mut state = fresh_state();
        state
            .self_side
            .cooldowns
            .insert(HUNTERS_CURSE_DECISION_ID.to_string(), 120.0);
        state.time = 30.0;
        let d = HuntersCurseDecision::new();
        assert_eq!(d.utility(&state), 0.0);
    }
}
