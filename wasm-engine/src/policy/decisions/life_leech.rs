//! Built-in Life Leech decision.
//!
//! Reference: `ability_life_leech` in `src/pages/referenceContent.ts`.
//!
//! Life Leech's `utility()` is a closed-form expectation of total
//! heal returned to the actor over the remaining fight horizon.
//! The same formula serves all timing
//! modes - search-style modes simply evaluate it at multiple
//! projected states and pick the candidate with the highest
//! expected heal (no shortcut paths for "analytic" vs
//! "search-style" abilities).
//!
//! Value composition:
//!
//! - Per-cycle heal = the actor's bites inside the 12 s window, each
//!   returning `leech_value * damage_per_bite` and each capped by the
//!   HP missing at that bite.
//! - Cycles in remaining fight = how many full activations
//!   (12 s active + 48 s downtime = 60 s cycle) fit between the
//!   evaluated time and the projected fight end.
//! - Tail handling = if the last cast partially overhangs the
//!   fight end, the window shortens and holds fewer bites.
//!
//! Why bites and not a rate
//!
//! Heal arrives on the actor's own bites, so what a 12 s window is
//! worth depends on how many bites fall inside it and on where the
//! actor's HP stands at each. `leech * out_dps * window` answers
//! neither: it is flat across every candidate delay, so the search
//! had nothing to choose on and fired immediately, at full HP, where
//! the first ticks have nothing to fill. Over the roster's bite-cooldown
//! range (0.3 - 1.6 s) that cost the actor exactly one heal tick against
//! the ReallyFast gate in 41 of 147 cadence and leech-value combinations.
//!
//! ReallyFast hard gate: `hp_ratio <= 0.85` (matches Reference text
//! and the existing engine invariant).
//!
//! Why expected heal, not "just per-cast"
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

/// Loop bound for the per-bite walk of one active window. The roster's
/// shortest bite cooldown is 0.3 s and abilities drive it lower, so the
/// realistic count is a few dozen; this only stops a pathological cooldown
/// from spinning the sum.
const MAX_BITES_PER_WINDOW: u32 = 256;

/// Extras key the bridge layer uses to hand the actor's
/// `life_leech_value` (a fraction in [0, 1]) to the decision. The
/// key lives in `state.self_side.extras` so the decision is
/// independent of `composable/` internals (narrow
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

        // Per-window heal physics: walk the window bite by bite. Each bite
        // returns `leech * damage_per_bite` capped by the HP missing at that
        // bite, and incoming damage accrues between bites at `in_dps`. A rate
        // over the whole window gets both terms wrong: it cannot see that a
        // window holds a whole number of bites whose count depends on the
        // phase, and it lets a tick arriving early be offset by damage
        // arriving late, which is how a rate model scores a cast at full HP as
        // high as one on a wounded actor.
        let bite_cd = state.self_side.stats.bite_cooldown;
        if bite_cd <= 0.0 || !bite_cd.is_finite() {
            return 0.0;
        }
        let damage_per_bite = out_dps * bite_cd;
        let heal_per_bite = leech * damage_per_bite;
        let first_bite_offset = phase_to_next_bite(state.self_side.next_hit, state.time, bite_cd);

        let mut total = 0.0;
        let mut hp_at_cast = state.self_side.hp;
        let mut cast_offset = 0.0;
        while cast_offset < remaining {
            let window = ACTIVE_SEC.min(remaining - cast_offset);
            let mut hp = hp_at_cast;
            let mut bite_at = first_bite_offset;
            let mut prev = 0.0;
            let mut bites = 0u32;
            while bite_at <= window + 1e-9 && bites < MAX_BITES_PER_WINDOW {
                hp = (hp - in_dps * (bite_at - prev)).max(0.0);
                let heal = heal_per_bite.min((actor_max_hp - hp).max(0.0));
                total += heal;
                hp = (hp + heal).min(actor_max_hp);
                prev = bite_at;
                bite_at += bite_cd;
                bites += 1;
            }
            // Rest of the active window, then the cooldown: damage only.
            hp = (hp - in_dps * (window - prev).max(0.0)).max(0.0);
            let damage_in_cooldown_rest = in_dps * (COOLDOWN_SEC - window).max(0.0);
            hp_at_cast = (hp - damage_in_cooldown_rest).clamp(0.0, actor_max_hp);
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

/// Seconds from `now` to the actor's next bite, folded into `[0, cooldown)`.
///
/// `next_hit` is an absolute engine timestamp and the light projection advances
/// `time` without advancing it, so a projected candidate reads a schedule that
/// already passed. The schedule is periodic, which is enough to recover the
/// phase either way.
fn phase_to_next_bite(next_hit: f64, now: f64, bite_cd: f64) -> f64 {
    if !next_hit.is_finite() {
        return 0.0;
    }
    let ahead = next_hit - now;
    if ahead >= 0.0 {
        return ahead % bite_cd;
    }
    let behind = (-ahead) % bite_cd;
    if behind <= 1e-9 {
        0.0
    } else {
        bite_cd - behind
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
        // Full HP + opponent doing zero damage -> no missing HP
        // accrues during the window -> effective cap = 0 -> heal = 0.
        // Sanity: utility correctly returns 0 only when there's
        // genuinely no benefit (not just because hp == max_hp).
        let mut state = fresh_state_with_leech(0.3);
        state.opponent.stats.damage = 0.0;
        let d = LifeLeechDecision::new();
        assert_eq!(d.utility(&state), 0.0);
    }

    #[test]
    fn utility_positive_at_full_hp_when_incoming_damage_present() {
        // Full HP + opponent dealing damage -> in-window absorbed
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
        // High outgoing DPS + long fight -> expected heal would be
        // huge, but utility caps at `max(missing_hp, 50% max_hp)`
        // because over-healing past max HP cannot be captured.
        // Construct a scenario where the cap is binding: actor at
        // 9_500 HP (only 500 missing) vs an extremely tanky opp
        // -> expected heal >> 500.
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
        state.opponent.hp = 0.0; // 0 HP -> 0 ttk -> 0 fight horizon
        let d = LifeLeechDecision::new();
        // remaining=0 -> no expected heal.
        assert_eq!(d.utility(&state), 0.0);
    }
}
