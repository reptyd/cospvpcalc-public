//! Reference: ability_sand_breath
//!
//! Covers each testable bullet in the "Sand Breath" entry. Each test
//! body starts with the [REF:ability_sand_breath] marker so the vitest
//! coverage gate (src/pages/referenceCoverage.test.ts) sees it.
//!
//! Source of truth for breath stats: data/breath_specs.runtime.json:239-251
//! (id="Sand_Breath", capacity 10 sec, regen 1.8, crit 0%, dps 0.5,
//! perHit "0.25% PER HIT", secondaries Blurred Vision 100% no-stack +
//! Tunnel Vision 50% no-stack — both out-of-model).

use super::super::config::ComposableAbilityConfig;
use super::super::simulate_composable_matchup_with_trace;
use super::{default_breath, default_combatant};
use crate::combat::compute_simple_breath_damage_with_actor_and_target_statuses;
use crate::contracts::{SimpleAbilityTimingMode, SimpleBreathProfile, SimpleCombatantStats};
use std::collections::BTreeMap;

fn sand_breath_profile() -> SimpleBreathProfile {
    let mut breath = default_breath();
    breath.dps_pct = 0.5;
    breath.capacity = 10.0;
    breath.regen_rate = 1.8;
    breath.crit_chance_pct = 0.0;
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
fn ticks_two_times_per_second_while_firing() {
    // [REF:ability_sand_breath]
    // Bullet 1: "Sand Breath deals damage 2 times per second while it
    // is firing."
    let attacker = passive_combatant(1_000.0);
    let defender = passive_combatant(10_000_000.0);
    let breath = sand_breath_profile();
    let result = simulate_composable_matchup_with_trace(
        &attacker, &defender,
        Some(&breath), None,
        SimpleAbilityTimingMode::Fast,
        &ComposableAbilityConfig::default(),
        10.5, true,
    );
    let log = result.combat_log.expect("trace log");
    let breath_ticks: Vec<f64> = log
        .iter()
        .filter(|e| e.entry_type == "breath" && e.attacker == "A")
        .map(|e| e.time)
        .collect();
    assert_eq!(
        breath_ticks.len(),
        20,
        "expected 20 breath ticks (10 s capacity × 2/s) before exhaustion: {breath_ticks:?}"
    );
}

#[test]
fn capacity_is_ten_seconds_of_firing() {
    // [REF:ability_sand_breath]
    // Bullet 2: "Sand Breath has capacity 10."
    let attacker = passive_combatant(1_000.0);
    let defender = passive_combatant(10_000_000.0);
    let breath = sand_breath_profile();
    let result = simulate_composable_matchup_with_trace(
        &attacker, &defender,
        Some(&breath), None,
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
        burst_ticks.len(),
        20,
        "first Sand Breath burst must exhaust after 10 s of firing (20 ticks): {burst_ticks:?}"
    );
}

#[test]
fn damage_formula_matches_spec() {
    // [REF:ability_sand_breath]
    // Bullets 3+4: "Breath damage per tick is calculated as
    // (((target max HP * ((attacker effective weight / defender effective
    // weight) + 1)) / 2) / 100) * 0.25 * 1.0 * (1 - breath resistance)."
    let mut attacker = default_combatant();
    attacker.weight = 200.0;
    let mut defender = default_combatant();
    defender.health = 4_000.0;
    defender.weight = 100.0;
    defender.breath_resistance = 0.20;
    let breath = sand_breath_profile();

    let mut chain = 0.0;
    let actual = compute_simple_breath_damage_with_actor_and_target_statuses(
        &attacker, &defender, &breath, &mut chain,
        &BTreeMap::new(), &BTreeMap::new(),
    );
    let weight_ratio = attacker.weight / defender.weight;
    let base = (defender.health * (1.0 + weight_ratio)) / 2.0 / 100.0;
    let expected = base * 0.25 * 1.0 * (1.0 - defender.breath_resistance);
    assert!(
        (actual - expected).abs() < 1e-9,
        "Sand Breath per-tick damage mismatch: expected {expected}, got {actual}"
    );
}

#[test]
fn blurred_vision_and_tunnel_vision_secondaries_out_of_model() {
    // [REF:ability_sand_breath]
    // Bullet 5: "Its listed secondary effects are Blurred Vision at
    // 100% chance with no stacking and Tunnel Vision at 50% chance
    // with no stacking."
    // Notes: "currently out of model." → engine must NOT emit either
    // status during a Sand Breath burst.
    let attacker = passive_combatant(1_000.0);
    let defender = passive_combatant(10_000_000.0);
    let breath = sand_breath_profile();
    let result = simulate_composable_matchup_with_trace(
        &attacker, &defender,
        Some(&breath), None,
        SimpleAbilityTimingMode::Fast,
        &ComposableAbilityConfig::default(),
        10.5, true,
    );
    let log = result.combat_log.expect("trace log");
    let blurred_present = log
        .iter()
        .any(|e| e.status_id.as_deref() == Some("Blurred_Vision_Status"));
    let tunnel_present = log
        .iter()
        .any(|e| e.status_id.as_deref() == Some("Tunnel_Vision_Status"));
    assert!(
        !blurred_present,
        "Sand Breath must NOT emit Blurred_Vision_Status (per Reference Notes: out of model)"
    );
    assert!(
        !tunnel_present,
        "Sand Breath must NOT emit Tunnel_Vision_Status (per Reference Notes: out of model)"
    );
}
