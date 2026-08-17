//! Reference: ability_quick_recovery
//!
//! Covers each testable bullet in the "Quick Recovery" entry. Each
//! test body starts with the [REF:ability_quick_recovery] marker so
//! the vitest coverage gate (src/pages/referenceCoverage.test.ts)
//! sees it.
//!
//! Engine path: `combat::effective_hp_regen_multiplier`. The
//! `quick_recovery_hp_ratio_threshold` stat (typically 0.4) gates the
//! boost: above the gate there is no boost; below it the multiplier
//! ramps linearly from 1x at the gate to 2x at 0 HP (game
//! DATA_AilmentData QuickRecovery.OnGet: `map(hp_ratio, 0, gate, 2, 1)`).
//! Multiplier formula:
//!   if hp_ratio >= threshold: 1.0
//!   else: 1 + (threshold - hp_ratio) / threshold   (clamped to [1, 2])

use super::default_combatant;
use crate::combat::effective_hp_regen_multiplier;
use crate::contracts::SimpleCombatantStats;
use crate::spec_constants::{QUICK_RECOVERY_HP_GATE_PCT, QUICK_RECOVERY_MAX_MULTIPLIER};
use std::collections::BTreeMap;

const THRESHOLD: f64 = QUICK_RECOVERY_HP_GATE_PCT / 100.0;

fn quick_recovery_combatant() -> SimpleCombatantStats {
    let mut c = default_combatant();
    c.health = 1_000.0;
    c.quick_recovery_hp_ratio_threshold = THRESHOLD;
    c
}

#[test]
fn is_a_passive_ability() {
    // [REF:ability_quick_recovery]
    // Bullet 1: "Quick Recovery is a passive ability."
    // Engine: Quick Recovery has no activation / cooldown timer; it is
    // expressed entirely through `quick_recovery_hp_ratio_threshold`
    // on `SimpleCombatantStats` and read every regen tick by
    // `effective_hp_regen_multiplier`. At full HP the bonus is 0.
    let stats = quick_recovery_combatant();
    let statuses = BTreeMap::new();
    let mult_full = effective_hp_regen_multiplier(&stats, stats.health, &statuses);
    assert!(
        (mult_full - 1.0).abs() < 1e-9,
        "Quick Recovery multiplier at full HP must be 1.0 (passive baseline): got {mult_full}"
    );
}

#[test]
fn no_boost_above_the_forty_percent_gate() {
    // [REF:ability_quick_recovery]
    // Bullet 2: the boost applies ONLY below 40% HP. Above the gate the
    // multiplier stays at 1.0 - no dead-zone ramp above the gate.
    let stats = quick_recovery_combatant();
    let statuses = BTreeMap::new();
    for ratio in [1.0, 0.85, 0.7, 0.55, 0.41] {
        let mult = effective_hp_regen_multiplier(&stats, stats.health * ratio, &statuses);
        assert!(
            (mult - 1.0).abs() < 1e-9,
            "QR multiplier at hp_ratio={ratio} (above the 40% gate) must be 1.0: got {mult}"
        );
    }
}

#[test]
fn bonus_scales_linearly_below_the_gate() {
    // [REF:ability_quick_recovery]
    // Bullet 3: below 40% HP the multiplier scales linearly with how low
    // the HP is. Formula: 1 + (threshold - ratio) / threshold.
    //   ratio=0.30 -> 1.25, ratio=0.20 -> 1.50, ratio=0.10 -> 1.75.
    let stats = quick_recovery_combatant();
    let statuses = BTreeMap::new();
    let cases = [(0.30, 1.25_f64), (0.20, 1.50), (0.10, 1.75)];
    for (ratio, expected) in cases {
        let actual = effective_hp_regen_multiplier(&stats, stats.health * ratio, &statuses);
        assert!(
            (actual - expected).abs() < 1e-9,
            "QR multiplier at hp_ratio={ratio} must equal {expected} (linear ramp below the gate): got {actual}"
        );
    }
}

#[test]
fn no_boost_at_the_gate_boundary() {
    // [REF:ability_quick_recovery]
    // Bullet 4 (lower endpoint): at exactly 40% HP the boost is 1x - the
    // ramp starts there, it does not already peak there.
    let stats = quick_recovery_combatant();
    let statuses = BTreeMap::new();
    let at_gate = effective_hp_regen_multiplier(&stats, stats.health * THRESHOLD, &statuses);
    assert!(
        (at_gate - 1.0).abs() < 1e-9,
        "QR multiplier at exactly 40% HP must be 1.0 (bottom of the ramp): got {at_gate}"
    );
}

#[test]
fn reaches_maximum_only_at_zero_hp() {
    // [REF:ability_quick_recovery]
    // Bullet 4 (upper endpoint): the multiplier reaches its maximum (2x)
    // at 0 HP, and is strictly below the max just above 0 HP.
    let stats = quick_recovery_combatant();
    let statuses = BTreeMap::new();
    let at_zero = effective_hp_regen_multiplier(&stats, 0.0, &statuses);
    assert!(
        (at_zero - QUICK_RECOVERY_MAX_MULTIPLIER).abs() < 1e-9,
        "QR multiplier at 0 HP must be {QUICK_RECOVERY_MAX_MULTIPLIER}: got {at_zero}"
    );
    // Just above 0 HP it has not yet reached the max (unlike the old model,
    // which clamped to the max across the whole sub-gate band).
    let near_zero = effective_hp_regen_multiplier(&stats, stats.health * 0.2, &statuses);
    assert!(
        near_zero < QUICK_RECOVERY_MAX_MULTIPLIER,
        "QR multiplier at 20% HP must be below the {QUICK_RECOVERY_MAX_MULTIPLIER} max (still ramping): got {near_zero}"
    );
}
