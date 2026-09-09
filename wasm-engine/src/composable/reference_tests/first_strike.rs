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

#[test]
fn the_timeline_stamps_the_deactivation_with_the_bite_that_caused_it() {
    // [REF:ability_first_strike]
    // The gate is HP, and HP changes on a bite. The entry has to carry that
    // bite's moment: a diff run at the top of the next iteration, once the
    // scheduler has moved the clock on, would show the passive turning off at
    // the next event instead - here, five seconds late.
    //
    // A bites never (a 1000 s cooldown) and does not regenerate, so after B's
    // bite the next event on the schedule is B's next bite. That gap is the
    // five seconds.
    let mut attacker = default_combatant();
    attacker.first_strike_pct = 0.25;
    attacker.first_strike_hp_ratio_threshold = 0.75;
    attacker.health = 1000.0;
    attacker.health_regen = 0.0;
    attacker.damage = 0.0;
    attacker.bite_cooldown = 1000.0;

    let mut defender = default_combatant();
    defender.health = 1_000_000.0;
    defender.health_regen = 0.0;
    // 130 a bite: two bites leave 740 of 1000, which is under the 75% gate.
    defender.damage = 130.0;
    defender.bite_cooldown = 5.0;
    defender.weight = attacker.weight;

    let result = crate::composable::simulate_composable_matchup_with_trace(
        &attacker, &defender, None, None,
        crate::contracts::SimpleAbilityTimingMode::Ideal,
        &crate::composable::config::ComposableAbilityConfig::default(),
        30.0, true,
    );
    let log = result.combat_log.expect("trace");
    let off = log
        .iter()
        .find(|e| e.description.as_deref() == Some("First Strike deactivated"))
        .expect("the passive turned off during the fight");
    // The bite that crossed the gate, found by the HP it left behind rather
    // than by the entry under test - otherwise a late entry would match the
    // late bite and the test would pass on the defect it exists for.
    let gate = attacker.health * 0.75;
    let bites: Vec<(f64, f64)> = log
        .iter()
        .filter(|e| e.entry_type == "bite" && e.attacker == "B")
        .map(|e| (e.time, e.hp_after))
        .collect();
    let crossing = bites
        .iter()
        .find(|(_, hp)| *hp < gate)
        .expect("a bite took the side under the gate")
        .0;
    assert!(
        (off.time - crossing).abs() < 1e-9,
        "the entry must carry the crossing bite's moment: entry at {}, crossed at {crossing}, bites {:?}",
        off.time,
        bites,
    );
    assert!(
        off.actor_hp_after < gate,
        "and the HP on the entry is the HP that crossed the gate: {}",
        off.actor_hp_after,
    );
    // The scenario has to be able to tell the two readings apart, or this test
    // passes on the defect it exists for: there must be a later event for a
    // deferred reading to have stamped instead.
    let later = bites.iter().any(|(t, _)| *t > crossing + 1e-9);
    assert!(
        later,
        "the crossing bite must not be the last event, or a late reading would look the same: {:?}",
        bites,
    );
}
