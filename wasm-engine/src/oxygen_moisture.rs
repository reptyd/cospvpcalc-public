//! Compare-only Oxygen / Moisture drain subsystem. A single global battle
//! setting (`oxygen_moisture_mode`) selects one of two mutually exclusive
//! environments applied to BOTH sides:
//!
//! - `"ground"` - each side drains its `moisture_time` pool by 1/sec; once
//!   empty it loses 5% max HP/sec, FLOORED at 50% max HP (drying out never
//!   kills).
//! - `"underwater"` - each side drains its `oxygen_time` pool by 1/sec; once
//!   empty it loses 5% max HP/sec with NO floor, so drowning is lethal and the
//!   normal death path fires.
//!
//! A side whose relevant-mode pool starts at 0 (or absent) is immune in that
//! mode: no drain, no damage. The drain/damage pause once the side is dead.
//!
//! The pool starts at the stat value and counts down one unit per simulated
//! second; the %maxHP damage begins the tick the pool reaches/sits at 0.

/// Drained per active per-second tick from the relevant mode pool.
pub const DRAIN_PER_SEC: f64 = 1.0;

/// Percent of max HP lost per second once the pool is depleted. Same shape as
/// the weather / hypothermia %maxHP DOT.
pub const DROWN_PCT_MAX_HP_PER_SEC: f64 = 5.0;

/// Ground (moisture) damage floor: HP can never be driven below this fraction
/// of max HP by drying out. Underwater (oxygen) has no floor.
pub const MOISTURE_FLOOR_FRAC: f64 = 0.50;

/// One per-second drain+damage tick for a side in the given mode.
///
/// `pool` is the side's remaining moisture/oxygen units (mutated in place).
/// Returns the HP-clamping result the caller applies to the side:
///   - `new_hp` is the post-damage HP (caller writes it back).
///   - For ground the floor is applied here (`new_hp >= 0.50 * max_hp`); for
///     underwater there is no floor and `new_hp` can reach 0, letting the
///     normal death path fire.
///
/// Decrement happens first (min 0); damage is applied only when the pool is
/// already depleted at tick start (i.e. it has reached 0 on a previous tick or
/// this side started at 0 - the latter is gated out by the caller, which never
/// arms a tick for an immune side). `lethal` selects oxygen (no floor) vs
/// moisture (floored).
pub fn tick(pool: &mut f64, hp: f64, max_hp: f64, lethal: bool) -> f64 {
    let depleted_at_tick_start = *pool <= 0.0;
    *pool = (*pool - DRAIN_PER_SEC).max(0.0);
    if !depleted_at_tick_start {
        return hp;
    }
    let damage = max_hp * DROWN_PCT_MAX_HP_PER_SEC / 100.0;
    let raw = hp - damage;
    if lethal {
        raw
    } else {
        // Drying out only ever subtracts: clamp to the floor, but never raise
        // HP. Another damage source (bite / breath / DOT) may have already
        // driven this side below 50% max HP - moisture must not heal it back
        // up to the floor.
        raw.max(max_hp * MOISTURE_FLOOR_FRAC).min(hp)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn drains_one_per_sec_before_damage() {
        let mut pool = 3.0;
        let hp = tick(&mut pool, 1000.0, 1000.0, true);
        assert_eq!(pool, 2.0);
        // Pool was > 0 at tick start, so no damage yet.
        assert_eq!(hp, 1000.0);
    }

    #[test]
    fn lethal_oxygen_has_no_floor() {
        let mut pool = 0.0;
        // 5% of 1000 = 50/sec; drive HP toward 0 with no floor.
        let mut hp = 100.0;
        hp = tick(&mut pool, hp, 1000.0, true);
        assert_eq!(hp, 50.0);
        hp = tick(&mut pool, hp, 1000.0, true);
        assert_eq!(hp, 0.0);
        hp = tick(&mut pool, hp, 1000.0, true);
        assert_eq!(hp, -50.0); // crosses 0 - caller's death path fires
    }

    #[test]
    fn moisture_floors_at_half_max_hp() {
        let mut pool = 0.0;
        let mut hp = 1000.0;
        for _ in 0..100 {
            hp = tick(&mut pool, hp, 1000.0, false);
        }
        assert_eq!(hp, 500.0); // never below 50% max HP
    }

    #[test]
    fn moisture_never_heals_a_side_already_below_floor() {
        // Another damage source already drove HP below the 50% floor; a
        // depleted-moisture tick must leave it alone, never heal it up.
        let mut pool = 0.0;
        let hp = tick(&mut pool, 200.0, 1000.0, false);
        assert_eq!(hp, 200.0);
    }

    #[test]
    fn moisture_clamps_to_floor_without_overshooting_into_a_heal() {
        // Just above the floor: the tick removes only the distance to the
        // floor (20), not the full 50, and never rebounds upward.
        let mut pool = 0.0;
        let hp = tick(&mut pool, 520.0, 1000.0, false);
        assert_eq!(hp, 500.0);
    }
}
