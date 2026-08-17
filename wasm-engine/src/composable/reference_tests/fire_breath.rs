//! Reference: ability_fire_breath
//!
//! Covers each testable bullet in the "Fire Breath" entry. Each test body
//! starts with the [REF:ability_fire_breath] marker so the vitest coverage
//! gate (src/pages/referenceCoverage.test.ts) sees it.

use super::super::config::ComposableAbilityConfig;
use super::super::simulate_composable_matchup_with_trace;
use super::{
    applied_status, assert_tick_stacks, default_breath, default_combatant,
    stacks_from_one_breath_tick,
};
use crate::combat::compute_simple_breath_damage_with_actor_and_target_statuses;
use crate::contracts::{SimpleAbilityTimingMode, SimpleBreathProfile, SimpleCombatantStats};
use crate::spec_constants::{FIRE_BREATH_CRIT_MULTIPLIER, FIRE_BREATH_PER_HIT_MULTIPLIER};
use std::collections::BTreeMap;

fn fire_breath_profile() -> SimpleBreathProfile {
    let mut breath = default_breath();
    // Per Reference text "* 0.5 * 1.125": the 0.5 is the per-tick fraction
    // (breath ticks 2 times per second) and the 1.125 is Fire Breath's 25%
    // pseudo-crit folded against the global 1.5x crit (2026-05-19: lowered
    // from 2x to 1.5x). Encoded as dps_pct=1.0, crit_chance_pct=25.0;
    // the engine yields `* dps_pct * 0.5 * (1 + crit_chance_pct/100 * 0.5)`.
    breath.dps_pct = 1.0;
    breath.capacity = 20.0;
    breath.regen_rate = 1.8;
    breath.crit_chance_pct = 25.0;
    // Burn 75% x 0.5 = 0.375 deterministic per tick.
    breath.special_statuses = vec![applied_status("Burn_Status", 0.375)];
    breath
}

fn passive_combatant(max_hp: f64) -> SimpleCombatantStats {
    let mut c = default_combatant();
    c.health = max_hp;
    c.damage = 0.0;
    c.bite_cooldown = 1000.0;
    c
}

#[test]
fn damage_formula_matches_spec() {
    // [REF:ability_fire_breath]
    let mut attacker = default_combatant();
    attacker.weight = 200.0;
    let mut defender = default_combatant();
    defender.health = 2_000.0;
    defender.weight = 100.0;
    defender.breath_resistance = 0.20;
    let breath = fire_breath_profile();
    let mut chain = 0.0;
    let actual = compute_simple_breath_damage_with_actor_and_target_statuses(
        &attacker,
        &defender,
        &breath,
        &mut chain,
        &BTreeMap::new(),
        &BTreeMap::new(),
    );
    let weight_ratio = attacker.weight / defender.weight;
    let base = (defender.health * (1.0 + weight_ratio)) / 2.0 / 100.0;
    let expected = base
        * FIRE_BREATH_PER_HIT_MULTIPLIER
        * FIRE_BREATH_CRIT_MULTIPLIER
        * (1.0 - defender.breath_resistance);
    assert!(
        (actual - expected).abs() < 1e-9,
        "Fire Breath per-tick damage mismatch: expected {expected}, got {actual}"
    );
}

#[test]
fn breath_weight_ratio_caps_at_three_to_one() {
    // [REF:ability_fire_breath]
    // The breath weight scaling is capped at a 3:1 ratio, identical to the
    // melee weight formula. A 5:1 attacker must produce the same per-tick
    // damage as a 3:1 attacker, and strictly less than the uncapped 5:1 value.
    let breath = fire_breath_profile();
    let mut defender = default_combatant();
    defender.health = 2_000.0;
    defender.weight = 100.0;

    let breath_damage = |attacker_weight: f64| {
        let mut attacker = default_combatant();
        attacker.weight = attacker_weight;
        let mut chain = 0.0;
        compute_simple_breath_damage_with_actor_and_target_statuses(
            &attacker, &defender, &breath, &mut chain, &BTreeMap::new(), &BTreeMap::new(),
        )
    };

    let at_cap = breath_damage(300.0); // ratio 3:1
    let over_cap = breath_damage(500.0); // ratio 5:1 -> clamped to 3:1
    assert!(
        (over_cap - at_cap).abs() < 1e-9,
        "5:1 breath must clamp to the 3:1 value: at_cap={at_cap}, over_cap={over_cap}"
    );

    // Sanity: the uncapped 5:1 value would be larger, so the cap actually bites.
    let uncapped_5to1 = {
        let base = (defender.health * (1.0 + 5.0)) / 2.0 / 100.0;
        base * FIRE_BREATH_PER_HIT_MULTIPLIER * FIRE_BREATH_CRIT_MULTIPLIER
    };
    assert!(
        over_cap < uncapped_5to1 - 1e-9,
        "the cap must reduce the 5:1 value below its uncapped magnitude: capped={over_cap}, uncapped={uncapped_5to1}"
    );
}

#[test]
fn capacity_is_twenty_seconds_with_two_ticks_per_second() {
    // [REF:ability_fire_breath]
    // Capacity 20 = 20 seconds of firing. Damage ticks 2/sec -> 40 ticks
    // before exhaustion, spanning t=0.5..20.0.
    let attacker = passive_combatant(1_000.0);
    let defender = passive_combatant(10_000_000.0);
    let breath = fire_breath_profile();
    let result = simulate_composable_matchup_with_trace(
        &attacker,
        &defender,
        Some(&breath),
        None,
        SimpleAbilityTimingMode::Fast,
        &ComposableAbilityConfig::default(),
        20.5,
        true,
    );
    let log = result.combat_log.expect("trace log");
    let breath_ticks: Vec<f64> = log
        .iter()
        .filter(|e| e.entry_type == "breath" && e.attacker == "A")
        .map(|e| e.time)
        .collect();
    assert_eq!(
        breath_ticks.len(),
        40,
        "expected exactly 40 breath ticks before capacity exhausts: {breath_ticks:?}"
    );
}

#[test]
fn applies_burn_secondary_status() {
    // [REF:ability_fire_breath]
    let attacker = passive_combatant(1_000.0);
    let defender = passive_combatant(10_000_000.0);
    let breath = fire_breath_profile();
    let result = simulate_composable_matchup_with_trace(
        &attacker,
        &defender,
        Some(&breath),
        None,
        SimpleAbilityTimingMode::Fast,
        &ComposableAbilityConfig::default(),
        5.0,
        true,
    );
    let log = result.combat_log.expect("trace log");
    let burn_present = log
        .iter()
        .any(|e| e.status_id.as_deref() == Some("Burn_Status"));
    assert!(
        burn_present,
        "Fire Breath must apply Burn_Status as a secondary effect"
    );
}

#[test]
fn each_tick_applies_the_burn_stacks_the_entry_states() {
    // [REF:ability_fire_breath]
    // "Every damage tick applies 0.375 stacks of Burn". The tick landing at all
    // is the test above; this is how much of it lands.
    let applied = stacks_from_one_breath_tick(&fire_breath_profile());
    assert_tick_stacks(&applied, "Burn_Status", 0.375);
}
