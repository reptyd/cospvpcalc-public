//! The hunger and thirst meters. Both run the same math on the same appetite
//! number - the game aliases `ThirstAppetite` to `Appetite` - so everything
//! here is written once and called twice, once per meter.
//!
//! Units: a meter is in appetite units (not %). Fill% = value / base * 100.
//! A meter stops at zero. What an empty bar would have gone on to consume is
//! carried separately as a deficit, and the starving effects read their stack
//! count from that.

pub const COMPARE_DEFAULT_STARTING_HUNGER: f64 = 100.0;
pub const COMPARE_DEFAULT_APPETITE_BASE: f64 = 100.0;
pub const COMPARE_GOURMANDIZER_FULL_BONUS_FILL_PCT: f64 = 125.0;
pub const COMPARE_GOURMANDIZER_MAX_WEIGHT_BONUS_PCT: f64 = 15.0;
/// `HUNGER_RATE` / `THIRST_RATE` in the game: one appetite unit every 36 s.
pub const COMPARE_METER_DRAIN_UNITS_PER_SEC: f64 = 1.0 / 36.0;
/// Gourmandizer's own wording: an overfilled bar "drains twice as fast".
pub const COMPARE_GOURMANDIZER_OVERFILL_DRAIN_MULTIPLIER: f64 = 2.0;
pub const COMPARE_REFLUX_HUNGER_COST_FRACTION: f64 = 0.25;

/// `Hungry` / `Thirsty`: 0.5% of max HP per stack on every ailment tick,
/// floored at 1. Both are unblockable and stop health regeneration outright.
pub const STARVING_DAMAGE_PCT_MAX_HP: f64 = 0.5;
pub const STARVING_DAMAGE_FLOOR: f64 = 1.0;

/// Disease multiplies the game's `Hunger` stat, which counts seconds per unit,
/// by `0.8 - 0.015 per stack`. Our meters count units per second, so the drain
/// multiplier is the reciprocal.
const DISEASE_INTERVAL_BASE: f64 = 0.8;
const DISEASE_INTERVAL_PER_STACK: f64 = 0.015;
/// The game's factor turns negative past 53 stacks, which no fight reaches.
/// Clamping keeps a pathological stack count from reversing the drain.
const DISEASE_INTERVAL_FLOOR: f64 = 0.05;

pub const DEFILED_GROUND_INTERVAL_LEVEL_1: f64 = 1.2;
pub const DEFILED_GROUND_INTERVAL_LEVEL_2: f64 = 1.5;
pub const DEFILED_GROUND_INTERVAL_LEVEL_3: f64 = 1.8;

/// Normalizes a *starting* meter value, which cannot begin in deficit.
pub fn normalize_compare_hunger(value: f64) -> f64 {
    if !value.is_finite() {
        return COMPARE_DEFAULT_STARTING_HUNGER;
    }
    value.max(0.0)
}

pub fn normalize_compare_appetite_base(value: f64) -> f64 {
    if !value.is_finite() {
        return COMPARE_DEFAULT_APPETITE_BASE;
    }
    value.max(1.0)
}

pub fn get_gourmandizer_fill_pct(current_hunger: f64, appetite_base: f64) -> f64 {
    if !current_hunger.is_finite() {
        return 0.0;
    }
    let b = normalize_compare_appetite_base(appetite_base);
    (current_hunger / b) * 100.0
}

pub fn disease_hunger_drain_multiplier(stacks: f64) -> f64 {
    if !stacks.is_finite() || stacks <= 0.0 {
        return 1.0;
    }
    let interval =
        (DISEASE_INTERVAL_BASE - stacks * DISEASE_INTERVAL_PER_STACK).max(DISEASE_INTERVAL_FLOOR);
    1.0 / interval
}

/// Stacks of `Hungry` / `Thirsty` on an empty meter. An empty bar is one
/// stack, and every further unit the creature would have consumed is another,
/// so at the base rate a stack arrives every 36 s the bar stays at zero, and
/// sooner under anything that speeds the drain up.
pub fn starving_stacks(meter: f64, deficit: f64) -> f64 {
    if !meter.is_finite() || meter > 0.0 {
        return 0.0;
    }
    if !deficit.is_finite() || deficit <= 0.0 {
        return 1.0;
    }
    1.0 + deficit.floor()
}

/// Which meter a lookup is about. The two share every formula and differ only
/// in which registry channel and which side field they read.
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Meter {
    Hunger,
    Thirst,
}

/// Composes every status-borne multiplier on a meter's seconds-per-unit
/// interval. The game states these as interval multipliers, so above 1 is a
/// slower drain; our meters count units per second, so the caller divides.
///
/// Disease is not here: its factor is `0.8 - 0.015 per stack`, the only one
/// that scales with the stack count, and it keeps its own helper.
pub fn meter_interval_multiplier_from_statuses(
    statuses: &std::collections::BTreeMap<String, crate::contracts::SimpleStatusInstance>,
    meter: Meter,
) -> f64 {
    let mut multiplier = 1.0_f64;
    for status_id in statuses.keys() {
        let value = match meter {
            Meter::Hunger => crate::effects_registry::hunger_interval_multiplier(status_id),
            Meter::Thirst => crate::effects_registry::thirst_interval_multiplier(status_id),
        };
        if let Some(value) = value {
            if value > 0.0 {
                multiplier *= value;
            }
        }
    }
    multiplier
}

pub fn starving_damage(max_hp: f64, stacks: f64) -> f64 {
    if stacks <= 0.0 {
        return 0.0;
    }
    (max_hp * (STARVING_DAMAGE_PCT_MAX_HP / 100.0) * stacks).max(STARVING_DAMAGE_FLOOR)
}

/// The owner's drain multiplier from standing on their own contaminated land.
/// The game states it as a multiplier on the seconds-per-unit interval -
/// `Defiler1/2/3` carry 1.2 / 1.5 / 1.8 - so the drain is its reciprocal, and
/// the levels come out at 16.7% / 33.3% / 44.4% less consumption.
///
/// The opponent-side weakness is the Sickly ailment, which states its own
/// interval multiplier in the status registry; it reaches the drain that way
/// rather than through here.
pub fn defiled_ground_owner_drain_multiplier(level: i32) -> f64 {
    if level <= 0 {
        return 1.0;
    }
    let interval = match level.clamp(1, 3) {
        1 => DEFILED_GROUND_INTERVAL_LEVEL_1,
        2 => DEFILED_GROUND_INTERVAL_LEVEL_2,
        _ => DEFILED_GROUND_INTERVAL_LEVEL_3,
    };
    1.0 / interval
}

/// Advances one meter by `delta_sec`, returning the raw result. A bar that
/// runs out comes back negative and the caller splits that into a bar at zero
/// and a deficit; see `advance_side_hunger`.
///
/// Gourmandizer's penalty is a step, not a ramp - the game applies a flat
/// double drain the instant fill passes 100% and nothing below it. When the
/// interval straddles that boundary the two rates are integrated separately,
/// so the crossing costs the same wall-clock either way.
pub fn advance_compare_hunger(
    current_hunger: f64,
    appetite_base: f64,
    delta_sec: f64,
    disease_stacks: f64,
    overfilled_drains_faster: bool,
    consumption_multiplier: f64,
) -> f64 {
    let hunger = if current_hunger.is_finite() {
        current_hunger
    } else {
        COMPARE_DEFAULT_STARTING_HUNGER
    };
    let base = normalize_compare_appetite_base(appetite_base);
    if !delta_sec.is_finite() || delta_sec <= 0.0 {
        return hunger;
    }
    let base_drain = delta_sec
        * COMPARE_METER_DRAIN_UNITS_PER_SEC
        * disease_hunger_drain_multiplier(disease_stacks)
        * consumption_multiplier.max(0.0);
    if !overfilled_drains_faster || hunger <= base {
        return hunger - base_drain;
    }
    let overfill = hunger - base;
    let overfill_drain = base_drain * COMPARE_GOURMANDIZER_OVERFILL_DRAIN_MULTIPLIER;
    if overfill > overfill_drain {
        return hunger - overfill_drain;
    }
    let normal_drain_after_crossing =
        base_drain - overfill / COMPARE_GOURMANDIZER_OVERFILL_DRAIN_MULTIPLIER;
    base - normal_drain_after_crossing.max(0.0)
}

/// Reflux cast cost. TS: `state.compareAppetiteBase * 0.25`.
pub fn reflux_hunger_cost(appetite_base: f64) -> f64 {
    normalize_compare_appetite_base(appetite_base) * COMPARE_REFLUX_HUNGER_COST_FRACTION
}

/// Compare-only Gourmandizer weight factor from *current* hunger (dynamic).
/// Returns a multiplicative factor >= 1.0 (e.g. 1.15 at 125% fill). Mirrors TS
/// `getGourmandizerWeightBonusPct`. Used when the hunger rule is active so
/// the weight bonus follows the shrinking fill% as appetite drains.
pub fn gourmandizer_weight_factor_from_hunger(current_hunger: f64, appetite_base: f64) -> f64 {
    let fill_pct = get_gourmandizer_fill_pct(current_hunger, appetite_base);
    if fill_pct <= COMPARE_DEFAULT_STARTING_HUNGER {
        return 1.0;
    }
    let capped = fill_pct.min(COMPARE_GOURMANDIZER_FULL_BONUS_FILL_PCT);
    let progress = (capped - COMPARE_DEFAULT_STARTING_HUNGER)
        / (COMPARE_GOURMANDIZER_FULL_BONUS_FILL_PCT - COMPARE_DEFAULT_STARTING_HUNGER);
    1.0 + (COMPARE_GOURMANDIZER_MAX_WEIGHT_BONUS_PCT / 100.0) * progress
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn one_unit_every_thirty_six_seconds() {
        let out = advance_compare_hunger(100.0, 100.0, 36.0, 0.0, false, 1.0);
        assert!((out - 99.0).abs() < 1e-9, "got {}", out);
    }

    #[test]
    fn disease_accelerates_drain_by_the_reciprocal_of_the_game_interval() {
        let base = advance_compare_hunger(100.0, 100.0, 36.0, 0.0, false, 1.0);
        let sick = advance_compare_hunger(100.0, 100.0, 36.0, 5.0, false, 1.0);
        assert!(sick < base, "disease should drain faster ({sick} vs {base})");
        // Game: Hunger x (0.8 - 0.015 x 5) = x0.725 on an interval.
        assert!((disease_hunger_drain_multiplier(5.0) - 1.0 / 0.725).abs() < 1e-9);
        assert_eq!(disease_hunger_drain_multiplier(0.0), 1.0);
        assert!(
            disease_hunger_drain_multiplier(1000.0).is_finite(),
            "a pathological stack count must not reverse the drain"
        );
    }

    #[test]
    fn overfill_drains_twice_as_fast_while_above_base() {
        // 120 -> 120 - 2 x baseDrain = 118 after 36 s on the default base.
        let out = advance_compare_hunger(120.0, 100.0, 36.0, 0.0, true, 1.0);
        assert!((out - 118.0).abs() < 1e-9, "got {}", out);
    }

    #[test]
    fn the_overfill_step_costs_the_same_wall_clock_either_way() {
        // Crossing 100 inside one interval must land where two intervals split
        // at the boundary would: 0.5 units of overfill burn in a quarter of the
        // 36 s, and the rest drains at the plain rate.
        let one_shot = advance_compare_hunger(100.5, 100.0, 36.0, 0.0, true, 1.0);
        let crossing = advance_compare_hunger(100.5, 100.0, 9.0, 0.0, true, 1.0);
        let split = advance_compare_hunger(crossing, 100.0, 27.0, 0.0, true, 1.0);
        assert!((crossing - 100.0).abs() < 1e-9, "crossing landed at {crossing}");
        assert!((one_shot - split).abs() < 1e-9, "{one_shot} vs {split}");
    }

    #[test]
    fn an_empty_meter_keeps_counting_down() {
        let out = advance_compare_hunger(0.0, 100.0, 36.0, 0.0, false, 1.0);
        assert!((out - -1.0).abs() < 1e-9, "got {out}");
    }

    #[test]
    fn starving_stacks_step_once_per_unit_of_deficit() {
        assert_eq!(starving_stacks(0.5, 0.0), 0.0);
        assert_eq!(starving_stacks(0.0, 0.0), 1.0);
        assert_eq!(starving_stacks(0.0, 0.5), 1.0);
        assert_eq!(starving_stacks(0.0, 1.0), 2.0);
        assert_eq!(starving_stacks(0.0, 2.5), 3.0);
    }

    #[test]
    fn starving_damage_is_half_a_percent_per_stack_with_a_floor() {
        assert!((starving_damage(1000.0, 1.0) - 5.0).abs() < 1e-9);
        assert!((starving_damage(1000.0, 3.0) - 15.0).abs() < 1e-9);
        assert_eq!(starving_damage(1000.0, 0.0), 0.0);
        // Under 200 max HP the flat floor takes over.
        assert_eq!(starving_damage(100.0, 1.0), STARVING_DAMAGE_FLOOR);
    }

    #[test]
    fn defiled_ground_level_reduces_drain_by_the_reciprocal_of_the_interval() {
        for (level, interval) in [
            (1, DEFILED_GROUND_INTERVAL_LEVEL_1),
            (2, DEFILED_GROUND_INTERVAL_LEVEL_2),
            (3, DEFILED_GROUND_INTERVAL_LEVEL_3),
        ] {
            let got = defiled_ground_owner_drain_multiplier(level);
            assert!(
                (got - 1.0 / interval).abs() < 1e-9,
                "level {level} must drain at 1/{interval}: got {got}"
            );
        }
        assert_eq!(defiled_ground_owner_drain_multiplier(0), 1.0, "no ground, no change");
        assert_eq!(
            defiled_ground_owner_drain_multiplier(9),
            defiled_ground_owner_drain_multiplier(3),
            "levels past 3 clamp"
        );
    }

    #[test]
    fn gourmandizer_weight_factor_125_is_1_15() {
        assert!((gourmandizer_weight_factor_from_hunger(125.0, 100.0) - 1.15).abs() < 1e-9);
        assert_eq!(gourmandizer_weight_factor_from_hunger(100.0, 100.0), 1.0);
        assert_eq!(gourmandizer_weight_factor_from_hunger(90.0, 100.0), 1.0);
    }

    #[test]
    fn reflux_cost_is_25pct_of_base() {
        assert!((reflux_hunger_cost(100.0) - 25.0).abs() < 1e-9);
        assert!((reflux_hunger_cost(200.0) - 50.0).abs() < 1e-9);
    }
}
