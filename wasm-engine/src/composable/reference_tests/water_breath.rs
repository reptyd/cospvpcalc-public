//! Reference: ability_water_breath
//!
//! Covers each testable bullet in the "Water Breath" entry. Each test
//! body starts with the [REF:ability_water_breath] marker so the
//! vitest coverage gate (src/pages/referenceCoverage.test.ts) sees it.
//!
//! Source of truth for breath stats: data/breath_specs.runtime.json:344-356
//! (id="Water_Breath", capacity 10, regen 2.5, crit 20%, dps 1.5,
//! perHit "0.75% PER HIT", secondary Blurred Vision probability=60%
//! no-stack).

use super::super::config::ComposableAbilityConfig;
use super::super::simulate_composable_matchup_with_trace;
use super::{
    applied_status, assert_tick_stacks, default_breath, default_combatant,
    stacks_from_one_breath_tick,
};
use crate::combat::compute_simple_breath_damage_with_actor_and_target_statuses;
use crate::contracts::{SimpleAbilityTimingMode, SimpleBreathProfile, SimpleCombatantStats};
use crate::spec_constants::{WATER_BREATH_CRIT_MULTIPLIER, WATER_BREATH_PER_HIT_MULTIPLIER};
use std::collections::BTreeMap;

fn water_breath_profile() -> SimpleBreathProfile {
    let mut breath = default_breath();
    breath.dps_pct = 1.5;
    breath.capacity = 10.0;
    breath.regen_rate = 2.5;
    breath.crit_chance_pct = 20.0;
    // Blurred Vision 60% x 1 stack, as expected stacks per tick.
    breath.special_statuses = vec![applied_status("Blurred_Vision_Status", 0.6)];
    breath
}

fn passive_combatant(max_hp: f64) -> SimpleCombatantStats {
    let mut c = default_combatant();
    c.health = max_hp;
    c.damage = 0.0;
    c.bite_cooldown = 1000.0;
    c
}

/// Length of the first contiguous breath burst: the run of ticks no more than
/// one 0.5 s tick apart. Once the meter empties it spends a tick regenerating
/// (a ~1 s gap) and then re-bursts, so trailing re-burst ticks are excluded.
fn first_burst_len(ticks: &[f64]) -> usize {
    if ticks.is_empty() {
        return 0;
    }
    1 + ticks
        .windows(2)
        .take_while(|w| w[1] - w[0] <= 0.5 + 1e-9)
        .count()
}

#[test]
fn ticks_two_times_per_second_while_firing() {
    // [REF:ability_water_breath]
    // Bullet 1: "Water Breath deals damage 2 times per second while
    // it is firing."
    let attacker = passive_combatant(1_000.0);
    let defender = passive_combatant(10_000_000.0);
    let breath = water_breath_profile();
    let result = simulate_composable_matchup_with_trace(
        &attacker, &defender, Some(&breath), None,
        SimpleAbilityTimingMode::Fast,
        &ComposableAbilityConfig::default(),
        11.0, true,
    );
    let log = result.combat_log.expect("trace log");
    let breath_ticks: Vec<f64> = log
        .iter()
        .filter(|e| e.entry_type == "breath" && e.attacker == "A")
        .map(|e| e.time)
        .collect();
    assert_eq!(
        first_burst_len(&breath_ticks),
        20,
        "expected 20 breath ticks (10 s capacity × 2/s) before exhaustion: {breath_ticks:?}"
    );
}

#[test]
fn capacity_is_ten_seconds_of_firing() {
    // [REF:ability_water_breath]
    // Bullet 2: "Capacity is 10 seconds of firing - one second of continuous
    // fire spends 1 unit."
    let attacker = passive_combatant(1_000.0);
    let defender = passive_combatant(10_000_000.0);
    let breath = water_breath_profile();
    let result = simulate_composable_matchup_with_trace(
        &attacker, &defender, Some(&breath), None,
        SimpleAbilityTimingMode::Fast,
        &ComposableAbilityConfig::default(),
        12.0, true,
    );
    let log = result.combat_log.expect("trace log");
    let burst_ticks: Vec<f64> = log
        .iter()
        .filter(|e| e.entry_type == "breath" && e.attacker == "A" && e.time <= 11.0 + 1e-9)
        .map(|e| e.time)
        .collect();
    assert_eq!(
        first_burst_len(&burst_ticks),
        20,
        "first Water Breath burst must exhaust after 10 s of firing (20 ticks): {burst_ticks:?}"
    );
}

#[test]
fn damage_formula_matches_spec() {
    // [REF:ability_water_breath]
    // Bullet 4: "Breath damage per tick is calculated as (((target max HP × (1
    // + min(attacker effective weight / defender effective weight, 3))) / 2) /
    // 100) × 0.75 × 1.1 × (1 - breath resistance)."
    let mut attacker = default_combatant();
    attacker.weight = 200.0;
    let mut defender = default_combatant();
    defender.health = 4_000.0;
    defender.weight = 100.0;
    defender.breath_resistance = 0.20;
    let breath = water_breath_profile();

    let mut chain = 0.0;
    let actual = compute_simple_breath_damage_with_actor_and_target_statuses(
        &attacker, &defender, &breath, &mut chain,
        &BTreeMap::new(), &BTreeMap::new(),
    );
    let weight_ratio = attacker.weight / defender.weight;
    let base = (defender.health * (1.0 + weight_ratio)) / 2.0 / 100.0;
    let expected = base
        * WATER_BREATH_PER_HIT_MULTIPLIER
        * WATER_BREATH_CRIT_MULTIPLIER
        * (1.0 - defender.breath_resistance);
    assert!(
        (actual - expected).abs() < 1e-9,
        "Water Breath per-tick damage mismatch: expected {expected}, got {actual}"
    );
}

#[test]
fn pseudo_crit_multiplier_is_one_point_one() {
    // [REF:ability_water_breath]
    // Notes 1: "Water Breath uses a 20% pseudo-crit, so its crit
    // multiplier is 1.1x instead of random crit rolls."
    // (20% x 1.5x global crit -> 1 + 0.20 x 0.5 = 1.10)
    let mut attacker = default_combatant();
    attacker.weight = 100.0;
    let mut defender = default_combatant();
    defender.health = 4_000.0;
    defender.weight = 100.0;
    let crit = water_breath_profile();
    let mut no_crit = water_breath_profile();
    no_crit.crit_chance_pct = 0.0;

    let mut chain_a = 0.0;
    let mut chain_b = 0.0;
    let crit_dmg = compute_simple_breath_damage_with_actor_and_target_statuses(
        &attacker, &defender, &crit, &mut chain_a,
        &BTreeMap::new(), &BTreeMap::new(),
    );
    let no_crit_dmg = compute_simple_breath_damage_with_actor_and_target_statuses(
        &attacker, &defender, &no_crit, &mut chain_b,
        &BTreeMap::new(), &BTreeMap::new(),
    );
    let ratio = crit_dmg / no_crit_dmg;
    assert!(
        (ratio - 1.1).abs() < 1e-9,
        "20% pseudo-crit at 1.5× must multiply per-tick damage by exactly 1.1: got ratio {ratio}"
    );
}

#[test]
fn applies_blurred_vision_secondary() {
    // [REF:ability_water_breath]
    // Bullet 5: "Every damage tick applies 0.6 stacks of Blurred Vision
    // - the model does not roll Blurred Vision's 60% chance with no
    // stacking, it applies the average of that roll."
    let attacker = passive_combatant(1_000.0);
    let defender = passive_combatant(10_000_000.0);
    let breath = water_breath_profile();
    let result = simulate_composable_matchup_with_trace(
        &attacker, &defender, Some(&breath), None,
        SimpleAbilityTimingMode::Fast,
        &ComposableAbilityConfig::default(),
        11.0, true,
    );
    let log = result.combat_log.expect("trace log");
    let blurred_present = log
        .iter()
        .any(|e| e.status_id.as_deref() == Some("Blurred_Vision_Status"));
    assert!(
        blurred_present,
        "Water Breath must apply Blurred_Vision_Status while firing"
    );
}

#[test]
fn each_tick_applies_the_blurred_vision_stacks_the_entry_states() {
    // [REF:ability_water_breath]
    // "Every damage tick applies 0.6 stacks of Blurred Vision".
    let applied = stacks_from_one_breath_tick(&water_breath_profile());
    assert_tick_stacks(&applied, "Blurred_Vision_Status", 0.6);
}
