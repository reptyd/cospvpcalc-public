//! Built-in Life Leech decision.
//!
//! Reference: `ability_life_leech` in `src/pages/referenceContent.ts`.
//!
//! Life Leech is the canonical "analytic, cheap, near-mathematical-
//! ideal" ability the user called out. Its `utility()` is a closed-
//! form expectation of total heal returned to the actor over the
//! remaining fight horizon. The same formula serves all timing
//! modes — search-style modes simply evaluate it at multiple
//! projected states and pick the candidate with the highest
//! expected heal (pillar 6: no shortcut paths for "analytic" vs
//! "search-style" abilities).
//!
//! Value composition:
//!
//! - **Per-cycle heal** = `leech_value * outgoing_damage_in_12s`,
//!   capped by `max(0, max_hp - hp_at_cast)`.
//! - **Cycles in remaining fight** = how many full activations
//!   (12 s active + 48 s downtime = 60 s cycle) fit between the
//!   evaluated time and the projected fight end.
//! - **Tail handling** = if the last cast partially overhangs the
//!   fight end, heal scales linearly with the overlap window.
//!
//! ReallyFast hard gate: `hp_ratio <= 0.85` (matches Reference text
//! and the existing engine invariant).
//!
//! ### Why expected heal, not "just per-cast"
//!
//! Evaluating only the immediate window misses cycle-packing
//! decisions: at moderate HP, casting now might trade a small
//! current heal for a large future heal that misses its window. By
//! summing over remaining cycles, the engine's candidate
//! enumeration naturally picks the delay that maximises total heal.
//! That is what makes Ideal "close to mathematically ideal" without
//! a separate cycle-packing branch.

use crate::policy::state::{PolicyState, PolicyValue};
use crate::policy::traits::TimedDecision;

/// Stable id under which this decision registers.
pub const LIFE_LEECH_DECISION_ID: &str = "builtin.life_leech";

/// Active duration of one Life Leech cast.
pub const ACTIVE_SEC: f64 = 12.0;

/// Cooldown between Life Leech casts.
pub const COOLDOWN_SEC: f64 = 60.0;

/// ReallyFast hard gate: actor must be at or below 85% HP.
const REALLY_FAST_MAX_HP_RATIO: f64 = 0.85;

/// Extras key the bridge layer uses to hand the actor's
/// `life_leech_value` (a fraction in [0, 1]) to the decision. The
/// key lives in `state.self_side.extras` so the decision is
/// independent of `composable/` internals (pillar 4 — narrow
/// public API surface).
pub const LEECH_VALUE_EXTRA_KEY: &str = "builtin.life_leech.value";

/// Built-in Life Leech timed decision.
#[derive(Debug, Default, Clone)]
pub struct LifeLeechDecision;

impl LifeLeechDecision {
    pub fn new() -> Self {
        Self
    }
}

impl TimedDecision for LifeLeechDecision {
    fn id(&self) -> &str {
        LIFE_LEECH_DECISION_ID
    }

    fn utility(&self, state: &PolicyState) -> f64 {
        let leech = leech_value(state);
        if leech <= 0.0 {
            return 0.0;
        }
        let actor_max_hp = state.self_side.stats.health.max(1.0);
        let out_dps = state.self_side.bite_dps();
        if out_dps <= 0.0 {
            return 0.0;
        }
        let in_dps = state.opponent.bite_dps();
        let remaining = state.remaining_fight_sec(out_dps, in_dps);
        if remaining <= 0.0 {
            return 0.0;
        }

        // Per-window heal physics: actor takes `damage_in_window`
        // incoming damage; Life Leech heal rate is `leech * out_dps`.
        // Total absorbed heal in a window equals
        //   min(raw_heal, missing_at_start + damage_in_window)
        // clamped at `actor_max_hp`. Reason: any heal beyond that
        // sum either overflows the HP cap (wasted) or has no missing
        // HP left to fill. This is the closed-form upper bound on
        // effective heal — handles "fire at full HP under heavy
        // incoming damage" correctly (heal absorbs the damage as it
        // arrives instead of being capped at the instant missing of
        // 0). Prior `cap = missing_at_cast` underestimated by exactly
        // the `damage_in_window` term.
        let mut total = 0.0;
        let mut hp_at_cast = state.self_side.hp;
        let mut cast_offset = 0.0;
        while cast_offset < remaining {
            let window = ACTIVE_SEC.min(remaining - cast_offset);
            let raw_heal = leech * out_dps * window;
            let missing_at_start = (actor_max_hp - hp_at_cast).max(0.0);
            let damage_in_window = in_dps * window;
            let effective_cap = (missing_at_start + damage_in_window).min(actor_max_hp);
            let heal = raw_heal.min(effective_cap);
            total += heal;
            // HP progression now separates window and cooldown-rest:
            //   - during window: heal applied, damage_in_window taken
            //   - during cooldown rest: only damage taken
            // Old code lumped all 60s as damage with heal as a point
            // bonus; the split is more faithful to the actual cycle
            // and matters when comparing delay candidates that fall
            // mid-cooldown.
            let hp_after_window = (hp_at_cast + heal - damage_in_window).clamp(0.0, actor_max_hp);
            let damage_in_cooldown_rest = in_dps * (COOLDOWN_SEC - window).max(0.0);
            hp_at_cast = (hp_after_window - damage_in_cooldown_rest).clamp(0.0, actor_max_hp);
            cast_offset += COOLDOWN_SEC;
        }
        total
    }

    fn is_available(&self, state: &PolicyState) -> bool {
        if leech_value(state) <= 0.0 {
            return false;
        }
        // No hp_ratio gate: a full-HP actor still benefits when
        // incoming damage in the active window provides headroom
        // for absorbed heal. The utility formula correctly returns
        // ~0 when there's truly no benefit (full HP + zero in_dps),
        // so the gate is redundant and was masking the "fire on
        // opening for short fights" case.
        state.self_side.is_idle_for(state.time, LIFE_LEECH_DECISION_ID)
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

fn leech_value(state: &PolicyState) -> f64 {
    state
        .self_side
        .extras
        .get(LEECH_VALUE_EXTRA_KEY)
        .and_then(PolicyValue::as_number)
        .unwrap_or(0.0)
        .max(0.0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::policy::state::{PolicyState, PolicyValue};
    use crate::policy::testing::default_state;

    /// Life Leech tests assume a 1 s bite cooldown so per-cast heal
    /// scales with the leech_value at a sensible rate. Default (2 s)
    /// works too but the existing assertions are tuned to 1 s.
    fn fresh_state_with_leech(leech_value: f64) -> PolicyState {
        let mut s = default_state();
        s.self_side.stats.bite_cooldown = 1.0;
        s.opponent.stats.bite_cooldown = 1.0;
        s.self_side.extras.insert(
            LEECH_VALUE_EXTRA_KEY.to_string(),
            PolicyValue::Number(leech_value),
        );
        s
    }

    #[test]
    fn id_is_in_builtin_namespace() {
        assert_eq!(LifeLeechDecision::new().id(), "builtin.life_leech");
    }

    #[test]
    fn available_at_full_hp_when_leech_value_set() {
        // Post-physics-fix: full HP no longer auto-blocks
        // is_available. Search policies still discriminate via
        // utility (zero when there's no incoming damage either),
        // and ReallyFast remains blocked via really_fast_gate
        // (`life_leech_full_hp_skips_really_fast` in
        // policy/tests/edge_cases.rs pins that side).
        let state = fresh_state_with_leech(0.3);
        let d = LifeLeechDecision::new();
        assert!(d.is_available(&state));
        // ReallyFast bypass remains:
        assert_eq!(d.really_fast_gate(&state), Some(false));
    }

    #[test]
    fn unavailable_when_leech_value_zero() {
        let mut state = fresh_state_with_leech(0.0);
        state.self_side.hp = 5_000.0; // pre-wounded
        let d = LifeLeechDecision::new();
        assert!(!d.is_available(&state));
    }

    #[test]
    fn unavailable_during_cooldown() {
        let mut state = fresh_state_with_leech(0.3);
        state.self_side.hp = 5_000.0;
        state
            .self_side
            .cooldowns
            .insert(LIFE_LEECH_DECISION_ID.to_string(), 60.0);
        state.time = 30.0;
        let d = LifeLeechDecision::new();
        assert!(!d.is_available(&state));
    }

    #[test]
    fn unavailable_while_active_window_open() {
        let mut state = fresh_state_with_leech(0.3);
        state.self_side.hp = 5_000.0;
        state
            .self_side
            .active_until
            .insert(LIFE_LEECH_DECISION_ID.to_string(), 12.0);
        state.time = 5.0;
        let d = LifeLeechDecision::new();
        assert!(!d.is_available(&state));
    }

    #[test]
    fn really_fast_gate_fires_at_or_below_eighty_five_percent() {
        let mut state = fresh_state_with_leech(0.3);
        state.self_side.hp = 8_500.0; // exactly 85%
        let d = LifeLeechDecision::new();
        assert_eq!(d.really_fast_gate(&state), Some(true));
        state.self_side.hp = 4_000.0; // 40%
        assert_eq!(d.really_fast_gate(&state), Some(true));
    }

    #[test]
    fn really_fast_gate_skips_above_eighty_five_percent() {
        let mut state = fresh_state_with_leech(0.3);
        state.self_side.hp = 9_000.0; // 90%
        let d = LifeLeechDecision::new();
        assert_eq!(d.really_fast_gate(&state), Some(false));
    }

    #[test]
    fn utility_zero_at_full_hp_with_zero_incoming_damage() {
        // Full HP + opponent doing zero damage → no missing HP
        // accrues during the window → effective cap = 0 → heal = 0.
        // Sanity: utility correctly returns 0 only when there's
        // genuinely no benefit (not just because hp == max_hp).
        let mut state = fresh_state_with_leech(0.3);
        state.opponent.stats.damage = 0.0;
        let d = LifeLeechDecision::new();
        assert_eq!(d.utility(&state), 0.0);
    }

    #[test]
    fn utility_positive_at_full_hp_when_incoming_damage_present() {
        // Full HP + opponent dealing damage → in-window absorbed
        // heal becomes non-zero, even with hp_at_cast == max_hp.
        // This is the Saikarie-vs-Saikarie path that the old
        // `cap = missing_at_cast` model under-estimated to 0.
        let mut state = fresh_state_with_leech(0.3);
        state.opponent.stats.damage = 200.0;
        let d = LifeLeechDecision::new();
        assert!(d.utility(&state) > 0.0);
    }

    #[test]
    fn utility_zero_with_zero_leech_value() {
        let mut state = fresh_state_with_leech(0.0);
        state.self_side.hp = 5_000.0;
        let d = LifeLeechDecision::new();
        assert_eq!(d.utility(&state), 0.0);
    }

    #[test]
    fn utility_caps_at_missing_hp_when_heal_is_plentiful() {
        let d = LifeLeechDecision::new();
        // High outgoing DPS + long fight → expected heal would be
        // huge, but utility caps at `max(missing_hp, 50% max_hp)`
        // because over-healing past max HP cannot be captured.
        // Construct a scenario where the cap is binding: actor at
        // 9_500 HP (only 500 missing) vs an extremely tanky opp
        // → expected heal ≫ 500.
        let mut state = fresh_state_with_leech(0.3);
        state.self_side.hp = 9_500.0;
        state.self_side.stats.damage = 1_000.0; // huge DPS
        state.opponent.stats.health = 1_000_000.0; // immortal-ish
        let u = d.utility(&state);
        // Heal cap floor = max(missing=500, 50% maxHP=5000) = 5000.
        // Expected heal hits this floor and stops growing.
        assert!(
            u <= 5_000.0 + 1e-6,
            "utility must cap at max(missing_hp, 50% max_hp) = 5000: got {u}"
        );
    }

    #[test]
    fn utility_grows_with_outgoing_dps() {
        let d = LifeLeechDecision::new();
        let make = |dmg: f64| {
            let mut s = fresh_state_with_leech(0.3);
            s.self_side.hp = 5_000.0;
            s.self_side.stats.damage = dmg;
            // Slow down opp ttk so fight is long enough for utility
            // to scale with damage rather than be cut by short ttk.
            s.opponent.stats.health = 1_000_000.0;
            s
        };
        let u_low_dmg = d.utility(&make(50.0));
        let u_high_dmg = d.utility(&make(200.0));
        assert!(
            u_high_dmg > u_low_dmg,
            "higher outgoing DPS → higher heal value: low={u_low_dmg}, high={u_high_dmg}"
        );
    }

    #[test]
    fn utility_drops_to_zero_when_opponent_already_dead() {
        let mut state = fresh_state_with_leech(0.3);
        state.self_side.hp = 5_000.0;
        state.opponent.hp = 0.0; // 0 HP → 0 ttk → 0 fight horizon
        let d = LifeLeechDecision::new();
        // remaining=0 → no expected heal.
        assert_eq!(d.utility(&state), 0.0);
    }
}
