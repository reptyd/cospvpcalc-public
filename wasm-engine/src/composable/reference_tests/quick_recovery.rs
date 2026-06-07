//! Reference: ability_quick_recovery
//!
//! Covers each testable bullet in the "Quick Recovery" entry. Each
//! test body starts with the [REF:ability_quick_recovery] marker so
//! the vitest coverage gate (src/pages/referenceCoverage.test.ts)
//! sees it.
//!
//! Engine path: `combat::effective_hp_regen_multiplier`. The
//! `quick_recovery_hp_ratio_threshold` stat (typically 0.4) drives the
//! linear ramp from 1x at full HP to 2x at threshold-and-below.
//! Multiplier formula:
//!   capped = max(threshold, min(hp_ratio, 1.0))
//!   progress = (1 - capped) / (1 - threshold)
//!   bonus = clamp(progress, 0, 1)
//!   multiplier = (status_multiplier) * (1 + bonus)

use super::default_combatant;
use crate::combat::effective_hp_regen_multiplier;
use crate::contracts::SimpleCombatantStats;
use std::collections::BTreeMap;

const THRESHOLD: f64 = 0.4;

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
    // `effective_hp_regen_multiplier`. With the field set to its
    // typical 0.4 threshold and HP at full, the bonus is 0 (passive,
    // not active).
    let stats = quick_recovery_combatant();
    let statuses = BTreeMap::new();
    let mult_full = effective_hp_regen_multiplier(&stats, stats.health, &statuses);
    assert!(
        (mult_full - 1.0).abs() < 1e-9,
        "Quick Recovery multiplier at full HP must be 1.0 (passive baseline): got {mult_full}"
    );
}

#[test]
fn bonus_scales_linearly_with_hp_below_full() {
    // [REF:ability_quick_recovery]
    // Bullet 2: "Its regeneration bonus scales linearly as the user's
    // HP gets lower."
    // Sample three intermediate HP ratios between threshold (0.4) and
    // full (1.0). Multiplier values must lie on a straight line:
    //   ratio=0.7 → mult=1.5, ratio=0.55 → mult=1.75, ratio=0.85 → mult=1.25.
    // Formula: 1 + (1 - ratio) / (1 - threshold), clamped.
    let stats = quick_recovery_combatant();
    let statuses = BTreeMap::new();
    let cases = [
        (0.85, 1.25_f64),
        (0.70, 1.50),
        (0.55, 1.75),
    ];
    for (ratio, expected) in cases {
        let hp = stats.health * ratio;
        let actual = effective_hp_regen_multiplier(&stats, hp, &statuses);
        assert!(
            (actual - expected).abs() < 1e-9,
            "QR multiplier at hp_ratio={ratio} must equal {expected} (linear ramp): got {actual}"
        );
    }
}

#[test]
fn bonus_starts_increasing_immediately_below_full_hp() {
    // [REF:ability_quick_recovery]
    // Bullet 3: "It starts increasing below 100% HP."
    // The smallest dip below maxHP must already raise the multiplier
    // above 1.0 (the engine has no dead zone).
    let stats = quick_recovery_combatant();
    let statuses = BTreeMap::new();
    let just_below_full = stats.health - 0.001; // 99.9999% HP
    let mult = effective_hp_regen_multiplier(&stats, just_below_full, &statuses);
    assert!(
        mult > 1.0 && mult < 1.0001,
        "QR multiplier just below full HP must be slightly above 1.0: got {mult}"
    );
}

#[test]
fn reaches_maximum_at_or_below_forty_percent_hp() {
    // [REF:ability_quick_recovery]
    // Bullet 4: "It reaches its maximum effect at 40% HP and below."
    // Multiplier must equal 2.0 at hp_ratio=0.4 and stay at 2.0 for
    // any lower HP (engine clamps via capped=max(threshold, hp_ratio)).
    let stats = quick_recovery_combatant();
    let statuses = BTreeMap::new();
    let at_threshold = effective_hp_regen_multiplier(&stats, stats.health * 0.4, &statuses);
    let below_threshold = effective_hp_regen_multiplier(&stats, stats.health * 0.2, &statuses);
    let near_zero = effective_hp_regen_multiplier(&stats, 1.0, &statuses);
    assert!(
        (at_threshold - 2.0).abs() < 1e-9,
        "QR multiplier at exactly 40% HP must be 2.0: got {at_threshold}"
    );
    assert!(
        (below_threshold - 2.0).abs() < 1e-9,
        "QR multiplier at 20% HP must stay capped at 2.0: got {below_threshold}"
    );
    assert!(
        (near_zero - 2.0).abs() < 1e-9,
        "QR multiplier near 0 HP must stay capped at 2.0: got {near_zero}"
    );
}

#[test]
fn ramps_one_to_two_from_full_hp_to_forty_percent() {
    // [REF:ability_quick_recovery]
    // Bullet 5: "In the current model, the multiplier scales from 1x
    // at full HP to 2x at 40% HP or lower."
    // Combined endpoint check: full HP → 1.0, threshold HP → 2.0.
    let stats = quick_recovery_combatant();
    let statuses = BTreeMap::new();
    let full = effective_hp_regen_multiplier(&stats, stats.health, &statuses);
    let threshold_hp = effective_hp_regen_multiplier(&stats, stats.health * THRESHOLD, &statuses);
    assert!(
        (full - 1.0).abs() < 1e-9,
        "QR multiplier at 100% HP must be 1.0: got {full}"
    );
    assert!(
        (threshold_hp - 2.0).abs() < 1e-9,
        "QR multiplier at 40% HP must be 2.0: got {threshold_hp}"
    );
}
