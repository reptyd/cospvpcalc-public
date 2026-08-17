//! Reference: ability_first_strike
//!
//! Covers each testable bullet in the "First Strike" entry. Each test
//! body starts with the [REF:ability_first_strike] marker so the vitest
//! coverage gate (src/pages/referenceCoverage.test.ts) sees it.

use super::default_combatant;
use crate::combat::compute_melee_damage_per_hit_with_actor_and_target_statuses;
use crate::spec_constants::FIRST_STRIKE_HP_GATE_PCT;
use std::collections::BTreeMap;

fn first_strike_applies_at_hp_ratio(hp_ratio: f64) -> bool {
    let mut attacker = default_combatant();
    attacker.first_strike_pct = 0.25;
    attacker.first_strike_hp_ratio_threshold = FIRST_STRIKE_HP_GATE_PCT / 100.0;
    attacker.damage = 100.0;
    let defender = default_combatant();
    let no_statuses = BTreeMap::new();
    let hp = attacker.health * hp_ratio;
    let with_fs = compute_melee_damage_per_hit_with_actor_and_target_statuses(
        &attacker, &defender, hp, &no_statuses, &no_statuses,
    );
    let mut attacker_no_fs = attacker.clone();
    attacker_no_fs.first_strike_pct = 0.0;
    let without_fs = compute_melee_damage_per_hit_with_actor_and_target_statuses(
        &attacker_no_fs, &defender, hp, &no_statuses, &no_statuses,
    );
    (with_fs - without_fs).abs() > 1e-9
}

#[test]
fn multiplies_outgoing_damage_above_hp_threshold() {
    // [REF:ability_first_strike]
    // First Strike value 0.25, threshold 0.75. At full HP, outgoing
    // damage is multiplied by 1 + 0.25 = 1.25.
    let mut attacker = default_combatant();
    attacker.first_strike_pct = 0.25;
    attacker.first_strike_hp_ratio_threshold = FIRST_STRIKE_HP_GATE_PCT / 100.0;
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
    attacker.first_strike_hp_ratio_threshold = FIRST_STRIKE_HP_GATE_PCT / 100.0;
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

#[test]
fn hp_gate_sits_at_seventy_five_percent() {
    // [REF:ability_first_strike]
    // Bullet 1: "First Strike applies while the user's HP is at or above 75%
    // of max HP." Bracket the gate magnitude: at one point just above 75% the
    // bonus applies, at one point just below it does not. Probing 0.01 either
    // side of FIRST_STRIKE_HP_GATE_PCT/100 pins the gate to 75% within +/-1
    // percentage point - moving the constant would flip one side.
    let gate = FIRST_STRIKE_HP_GATE_PCT / 100.0;
    assert!(
        first_strike_applies_at_hp_ratio(gate + 0.01),
        "First Strike must apply just above the {FIRST_STRIKE_HP_GATE_PCT}% HP gate"
    );
    assert!(
        !first_strike_applies_at_hp_ratio(gate - 0.01),
        "First Strike must NOT apply just below the {FIRST_STRIKE_HP_GATE_PCT}% HP gate"
    );
}
