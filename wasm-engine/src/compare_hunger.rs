//! Compare-only "Use Hunger Rules" subsystem. Mirrors TS
//! `src/engine/compareHungerMath.ts` + the drain-tick / Reflux-gate
//! integration points in `stateTickRuntime.ts` and `specialEventsRuntime.ts`.
//!
//! Units: `hunger` is in appetite units (not %). Fill% = hunger / base * 100.
//! `appetite_base` defaults to 100, which makes units ≈ % for typical input.

pub const COMPARE_DEFAULT_STARTING_HUNGER: f64 = 100.0;
pub const COMPARE_DEFAULT_APPETITE_BASE: f64 = 100.0;
pub const COMPARE_GOURMANDIZER_FULL_BONUS_FILL_PCT: f64 = 125.0;
pub const COMPARE_GOURMANDIZER_MAX_WEIGHT_BONUS_PCT: f64 = 15.0;
pub const COMPARE_HUNGER_DRAIN_UNITS_PER_SEC: f64 = 1.0 / 30.0;
pub const COMPARE_GOURMANDIZER_OVERFILL_DRAIN_MULTIPLIER: f64 = 1.5;
pub const COMPARE_REFLUX_HUNGER_COST_FRACTION: f64 = 0.25;

pub const DEFILED_GROUND_WEAKNESS_CONSUMPTION_INCREASE_PCT: f64 = 20.0;

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
    let h = normalize_compare_hunger(current_hunger);
    let b = normalize_compare_appetite_base(appetite_base);
    (h / b) * 100.0
}

/// Disease accelerates hunger drain: +1.5% per stack on top of a 15% base bump.
/// TS: compareHungerMath.ts `getDiseaseHungerDrainMultiplier`.
pub fn disease_hunger_drain_multiplier(stacks: f64) -> f64 {
    if !stacks.is_finite() || stacks <= 0.0 {
        return 1.0;
    }
    1.15 + stacks * 0.015
}

/// Returns 1 when no Defiled Ground level is set (`level <= 0`), otherwise
/// combines the owner's consumption reduction (20/50/80% @ level 1/2/3) with
/// the opponent-weakness +20% bump when applicable. TS:
/// compareDefiledGroundData.ts `getDefiledGroundConsumptionMultiplier`.
pub fn defiled_ground_consumption_multiplier(level: i32, weakness_enabled: bool) -> f64 {
    if level <= 0 {
        // TS parity: when ownerLevel is null but weakness is still on (e.g. the
        // opponent side is afflicted), the caller passes weaknessEnabled=true
        // with level=0 → 1.2×. Preserves `state.compareDefiledGroundWeaknessEnabled
        // ? 1.2 : 1` branch in stateTickRuntime.ts:327.
        return if weakness_enabled { 1.2 } else { 1.0 };
    }
    let capped = level.clamp(1, 3);
    let reduction_pct: f64 = match capped {
        1 => 20.0,
        2 => 50.0,
        _ => 80.0,
    };
    let owner = 1.0 - reduction_pct / 100.0;
    let weakness = if weakness_enabled {
        1.0 + DEFILED_GROUND_WEAKNESS_CONSUMPTION_INCREASE_PCT / 100.0
    } else {
        1.0
    };
    owner * weakness
}

/// Core drain formula. Mirrors `advanceCompareHunger` in
/// compareHungerMath.ts:58-88.
pub fn advance_compare_hunger(
    current_hunger: f64,
    appetite_base: f64,
    delta_sec: f64,
    disease_stacks: f64,
    overfilled_drains_faster: bool,
    consumption_multiplier: f64,
) -> f64 {
    let hunger = normalize_compare_hunger(current_hunger);
    let base = normalize_compare_appetite_base(appetite_base);
    if !delta_sec.is_finite() || delta_sec <= 0.0 || hunger <= 0.0 {
        return hunger;
    }
    let base_drain = delta_sec
        * COMPARE_HUNGER_DRAIN_UNITS_PER_SEC
        * disease_hunger_drain_multiplier(disease_stacks)
        * consumption_multiplier.max(0.0);
    if !overfilled_drains_faster || hunger <= base {
        return (hunger - base_drain).max(0.0);
    }
    let overfill = hunger - base;
    let overfill_drain = base_drain * COMPARE_GOURMANDIZER_OVERFILL_DRAIN_MULTIPLIER;
    if overfill > overfill_drain {
        return (hunger - overfill_drain).max(0.0);
    }
    let normal_drain_after_crossing =
        base_drain - overfill / COMPARE_GOURMANDIZER_OVERFILL_DRAIN_MULTIPLIER;
    (base - normal_drain_after_crossing.max(0.0)).max(0.0)
}

/// Reflux cast cost. TS: `state.compareAppetiteBase * 0.25`.
pub fn reflux_hunger_cost(appetite_base: f64) -> f64 {
    normalize_compare_appetite_base(appetite_base) * COMPARE_REFLUX_HUNGER_COST_FRACTION
}

/// Compare-only Gourmandizer weight factor from *current* hunger (dynamic).
/// Returns a multiplicative factor ≥ 1.0 (e.g. 1.15 at 125% fill). Mirrors TS
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
    fn drain_rate_matches_ts() {
        // 30s at base drain rate should remove exactly 1 unit.
        let out = advance_compare_hunger(100.0, 100.0, 30.0, 0.0, false, 1.0);
        assert!((out - 99.0).abs() < 1e-9, "got {}", out);
    }

    #[test]
    fn disease_accelerates_drain() {
        let base = advance_compare_hunger(100.0, 100.0, 30.0, 0.0, false, 1.0);
        let sick = advance_compare_hunger(100.0, 100.0, 30.0, 5.0, false, 1.0);
        assert!(sick < base, "disease should drain faster ({} vs {})", sick, base);
    }

    #[test]
    fn overfill_drains_1_5x_while_above_base() {
        // 120 → 120 - 1.5*baseDrain = 120 - 1.5*1 = 118.5 after 30s with default appetite base.
        let out = advance_compare_hunger(120.0, 100.0, 30.0, 0.0, true, 1.0);
        assert!((out - 118.5).abs() < 1e-9, "got {}", out);
    }

    #[test]
    fn overfill_transition_crosses_base_smoothly() {
        // 100.5 hunger, baseDrain=1 over 30s → overfill=0.5, overfillDrain=1.5>overfill
        // normalDrainAfterCrossing = 1 - 0.5/1.5 = 0.6667; result = 100 - 0.6667 = 99.3333
        let out = advance_compare_hunger(100.5, 100.0, 30.0, 0.0, true, 1.0);
        assert!((out - (100.0 - (1.0 - 0.5 / 1.5))).abs() < 1e-9, "got {}", out);
    }

    #[test]
    fn zero_hunger_never_recovers() {
        let out = advance_compare_hunger(0.0, 100.0, 30.0, 0.0, false, 1.0);
        assert_eq!(out, 0.0);
    }

    #[test]
    fn defiled_ground_level_reduces_drain() {
        let lvl2 = defiled_ground_consumption_multiplier(2, false);
        assert!((lvl2 - 0.5).abs() < 1e-9); // 50% reduction
        let lvl3_weak = defiled_ground_consumption_multiplier(3, true);
        assert!((lvl3_weak - 0.2 * 1.2).abs() < 1e-9);
    }

    #[test]
    fn weakness_only_multiplier_is_1_2() {
        assert!((defiled_ground_consumption_multiplier(0, true) - 1.2).abs() < 1e-9);
        assert_eq!(defiled_ground_consumption_multiplier(0, false), 1.0);
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
