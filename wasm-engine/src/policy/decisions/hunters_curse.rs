//! Built-in Hunters Curse decision.
//!
//! Reference: `ability_hunters_curse` in `src/pages/referenceContent.ts`.
//!
//! Hunters Curse trades a 50 % maxHP upfront cost for 2x bite damage
//! over 30 s on a 120 s cooldown. Unique among the buffs migrated so
//! far in that the cost is non-trivial - the decision engine must
//! gate firing on survival (won't the cost + incoming damage in
//! the active window kill the actor before it kills the opponent?).
//!
//! Implementation:
//!
//! - `is_available()` requires the actor to be at or above 50 % max HP
//!   (the game's CanUse gate) on top of the cooldown check.
//! - `utility()` is the expected extra outgoing damage during the
//!   active window IF the survival check passes, otherwise
//!   `f64::NEG_INFINITY` - precision modes that compare candidate
//!   utilities skip negative-infinity scores naturally.
//! - `really_fast_gate()` returns `Some(true)` whenever
//!   `is_available` (no survival check) - Reference: ReallyFast /
//!   Fast fire on cooldown without survival math. The cost is a flat
//!   50 % max HP with no floor, so firing at exactly 50 % HP is a
//!   self-kill.

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
        // Flat 50 % max HP cost, no floor. `is_available` already gates on
        // hp >= 50 % max, so this is >= 0 - exactly 0 at the boundary,
        // where the survival check below rejects the cast.
        let hp_after_cost = actor.hp - max_hp * HP_COST_RATIO;

        let out_dps = actor.bite_dps();
        if out_dps <= 0.0 {
            return f64::NEG_INFINITY;
        }
        let in_dps = state.opponent.bite_dps();

        // Survival check: reject the cast when the flat cost plus incoming
        // melee over the buffed window would leave the actor at or below the
        // safety buffer. The cost alone is lethal at exactly 50 % HP
        // (hp_after_cost == 0), so this must fire even against a zero-DPS
        // opponent - hence no `in_dps > 0` guard.
        let buffed_out_dps = out_dps * BUFF_MULTIPLIER;
        let ttk_with_hc = (state.opponent.hp / buffed_out_dps).min(ACTIVE_SEC);
        if hp_after_cost < in_dps * ttk_with_hc + END_WINDOW_SAFETY_HP {
            // Precision-mode utility-skip - see module docstring.
            return f64::NEG_INFINITY;
        }

        // Value: extra outgoing damage during the active window.
        // Strictly decreasing in `delay` because both `ttk_with_hc`
        // and `state.opponent.hp` shrink.
        out_dps * (BUFF_MULTIPLIER - 1.0) * ttk_with_hc
    }

    fn is_available(&self, state: &PolicyState) -> bool {
        let max_hp = state.self_side.stats.health.max(1.0);
        // Game CanUse: Hunters Curse is blocked below 50 % max HP.
        state.self_side.is_idle_for(state.time, HUNTERS_CURSE_DECISION_ID)
            && state.self_side.hp >= max_hp * HP_COST_RATIO
    }

    // really_fast_gate uses the trait default (fire when available).
    // Reference: ReallyFast / Fast fire HC on cooldown without a
    // survival check; is_available's 50 % HP gate keeps it from firing
    // when the flat cost would over-kill, though firing at exactly 50 %
    // is a permitted self-kill.
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

    /// Below 50 % max HP the game blocks Hunters Curse (CanUse), so the
    /// decision is unavailable and scores 0 - no cast is proposed.
    #[test]
    fn unavailable_below_fifty_percent_hp() {
        let mut state = fresh_state();
        state.self_side.hp = 4_000.0; // 40 % of the 10 000 max
        let d = HuntersCurseDecision::new();
        assert!(!d.is_available(&state), "HC must be unavailable below 50 % HP");
        assert_eq!(d.utility(&state), 0.0, "unavailable HC scores 0");
    }

    /// At exactly 50 % HP the ability is usable (the game permits it), but the
    /// flat 50 % cost leaves the actor at 0 HP, so precision modes' survival
    /// check rejects the cast with -infinity.
    #[test]
    fn precision_skips_at_fifty_percent_because_cost_kills() {
        let mut state = fresh_state();
        state.self_side.hp = 5_000.0; // exactly 50 % of the 10 000 max
        state.opponent.hp = 1_000_000.0; // long ttk keeps the active window open
        let d = HuntersCurseDecision::new();
        assert!(d.is_available(&state), "HC is usable at exactly 50 % HP");
        let u = d.utility(&state);
        assert!(
            u.is_infinite() && u < 0.0,
            "paying the flat cost at 50 % HP leaves 0 HP → survival check fails: got {u}"
        );
    }

    /// The flat cost self-kills at exactly 50 % HP regardless of incoming
    /// damage, so precision modes must skip even against a harmless (zero
    /// bite DPS) opponent - the survival check must not be gated on incoming
    /// damage being present.
    #[test]
    fn precision_skips_at_fifty_percent_even_against_a_harmless_opponent() {
        let mut state = fresh_state();
        state.self_side.hp = 5_000.0; // exactly 50 % of the 10_000 max
        state.opponent.stats.damage = 0.0; // zero bite DPS
        state.opponent.hp = 1_000_000.0;
        let d = HuntersCurseDecision::new();
        assert!(d.is_available(&state), "HC is usable at exactly 50 % HP");
        let u = d.utility(&state);
        assert!(
            u.is_infinite() && u < 0.0,
            "the flat cost self-kills at 50 % HP - precision must skip even with no incoming damage: got {u}"
        );
    }

    #[test]
    fn utility_skip_when_actor_cannot_survive_window() {
        let mut state = fresh_state();
        state.self_side.hp = 5_500.0; // 5000 cost -> 500 left
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
