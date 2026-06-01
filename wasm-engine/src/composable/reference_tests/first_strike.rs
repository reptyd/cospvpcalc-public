//! Reference: ability_first_strike
//!
//! Covers each testable bullet in the "First Strike" entry. Each test
//! body starts with the [REF:ability_first_strike] marker so the vitest
//! coverage gate (src/pages/referenceCoverage.test.ts) sees it.

use super::default_combatant;
use crate::combat::compute_melee_damage_per_hit_with_actor_and_target_statuses;
use std::collections::BTreeMap;

#[test]
fn multiplies_outgoing_damage_above_hp_threshold() {
    // [REF:ability_first_strike]
    // First Strike value 0.25, threshold 0.75. At full HP, outgoing
    // damage is multiplied by 1 + 0.25 = 1.25.
    let mut attacker = default_combatant();
    attacker.first_strike_pct = 0.25;
    attacker.first_strike_hp_ratio_threshold = 0.75;
    attacker.damage = 100.0;
    let defender = default_combatant();
    let no_statuses = BTreeMap::new();

    let with_fs = compute_melee_damage_per_hit_with_actor_and_target_statuses(
        &attacker,
        &defender,
        attacker.health,
        &no_statuses,
        &no_statuses,
    );
    let mut attacker_no_fs = attacker.clone();
    attacker_no_fs.first_strike_pct = 0.0;
    let without_fs = compute_melee_damage_per_hit_with_actor_and_target_statuses(
        &attacker_no_fs,
        &defender,
        attacker_no_fs.health,
        &no_statuses,
        &no_statuses,
    );
    let ratio = with_fs / without_fs;
    assert!(
        (ratio - 1.25).abs() < 1e-9,
        "First Strike must scale outgoing damage by 1.25x at full HP: with={with_fs}, without={without_fs}, ratio={ratio}"
    );
}

#[test]
fn does_not_apply_below_hp_threshold() {
    // [REF:ability_first_strike]
    let mut attacker = default_combatant();
    attacker.first_strike_pct = 0.25;
    attacker.first_strike_hp_ratio_threshold = 0.75;
    attacker.damage = 100.0;
    let defender = default_combatant();
    let no_statuses = BTreeMap::new();

    let attacker_hp_below = attacker.health * 0.5; // 50% < 75% threshold.
    let with_fs = compute_melee_damage_per_hit_with_actor_and_target_statuses(
        &attacker,
        &defender,
        attacker_hp_below,
        &no_statuses,
        &no_statuses,
    );
    let mut attacker_no_fs = attacker.clone();
    attacker_no_fs.first_strike_pct = 0.0;
    let without_fs = compute_melee_damage_per_hit_with_actor_and_target_statuses(
        &attacker_no_fs,
        &defender,
        attacker_hp_below,
        &no_statuses,
        &no_statuses,
    );
    assert!(
        (with_fs - without_fs).abs() < 1e-9,
        "First Strike must not apply below the HP threshold: with={with_fs}, without={without_fs}"
    );
}
