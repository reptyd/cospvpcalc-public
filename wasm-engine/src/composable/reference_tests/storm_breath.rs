//! Reference: ability_storm_breath
//!
//! Covers each testable bullet in the "Storm Breath" entry. Each test
//! body starts with the [REF:ability_storm_breath] marker so the
//! vitest coverage gate (src/pages/referenceCoverage.test.ts) sees it.
//!
//! Source of truth for breath stats: data/breath_specs.runtime.json:299-311
//! (id="Storm_Breath", capacity 20 sec, regen 1.75, crit 0%, dps 0.002,
//! perHit "0.001% PER HIT", secondaries Slowed 35% no-stack and
//! Blurred Vision 40% no-stack - both out-of-model).

use super::super::config::ComposableAbilityConfig;
use super::super::simulate_composable_matchup_with_trace;
use super::{default_breath, default_combatant};
use crate::combat::compute_simple_breath_damage_with_actor_and_target_statuses;
use crate::contracts::{SimpleAbilityTimingMode, SimpleBreathProfile, SimpleCombatantStats};
use std::collections::BTreeMap;

fn storm_breath_profile() -> SimpleBreathProfile {
    let mut breath = default_breath();
    // Per Reference text "* 0.001 * 1.0": dps 0.002 / 2 ticks/sec =
    // 0.001 per-tick; 1.0 = 0% pseudo-crit.
    breath.dps_pct = 0.002;
    breath.capacity = 20.0;
    breath.regen_rate = 1.75;
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
    // [REF:ability_storm_breath]
    // Bullet 1: "Storm Breath deals damage 2 times per second while
    // it is firing."
    let attacker = passive_combatant(1_000.0);
    let defender = passive_combatant(10_000_000.0);
    let breath = storm_breath_profile();
    let result = simulate_composable_matchup_with_trace(
        &attacker, &defender, Some(&breath), None,
        SimpleAbilityTimingMode::Fast,
        &ComposableAbilityConfig::default(),
        20.5, true,
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
        "expected 40 breath ticks (20 s capacity × 2/s) before exhaustion: {breath_ticks:?}"
    );
}

#[test]
fn capacity_is_twenty_seconds_of_firing() {
    // [REF:ability_storm_breath]
    // Bullet 2: "Storm Breath has capacity 20."
    let attacker = passive_combatant(1_000.0);
    let defender = passive_combatant(10_000_000.0);
    let breath = storm_breath_profile();
    let result = simulate_composable_matchup_with_trace(
        &attacker, &defender, Some(&breath), None,
        SimpleAbilityTimingMode::Fast,
        &ComposableAbilityConfig::default(),
        22.0, true,
    );
    let log = result.combat_log.expect("trace log");
    let burst_ticks: Vec<f64> = log
        .iter()
        .filter(|e| e.entry_type == "breath" && e.attacker == "A" && e.time <= 21.0 + 1e-9)
        .map(|e| e.time)
        .collect();
    assert_eq!(
        burst_ticks.len(),
        40,
        "first Storm Breath burst must exhaust after 20 s of firing (40 ticks): {burst_ticks:?}"
    );
}

#[test]
fn damage_formula_matches_spec() {
    // [REF:ability_storm_breath]
    // Bullet 3: "Breath damage per tick is calculated as
    // (((target max HP * ((attacker effective weight / defender effective
    // weight) + 1)) / 2) / 100) * 0.001 * 1.0 * (1 - breath resistance)."
    let mut attacker = default_combatant();
    attacker.weight = 200.0;
    let mut defender = default_combatant();
    defender.health = 4_000.0;
    defender.weight = 100.0;
    defender.breath_resistance = 0.20;
    let breath = storm_breath_profile();

    let mut chain = 0.0;
    let actual = compute_simple_breath_damage_with_actor_and_target_statuses(
        &attacker, &defender, &breath, &mut chain,
        &BTreeMap::new(), &BTreeMap::new(),
    );
    let weight_ratio = attacker.weight / defender.weight;
    let base = (defender.health * (1.0 + weight_ratio)) / 2.0 / 100.0;
    let expected = base * 0.001 * 1.0 * (1.0 - defender.breath_resistance);
    assert!(
        (actual - expected).abs() < 1e-12,
        "Storm Breath per-tick damage mismatch: expected {expected}, got {actual}"
    );
}

#[test]
fn slowed_and_blurred_vision_secondaries_out_of_model() {
    // [REF:ability_storm_breath]
    // Bullet 4: "Its listed secondary effects are Slowed at 35% chance
    // with no stacking and Blurred Vision at 40% chance with no stacking."
    // Notes: "currently out of model." → engine must NOT emit either
    // status during a Storm Breath burst.
    let attacker = passive_combatant(1_000.0);
    let defender = passive_combatant(10_000_000.0);
    let breath = storm_breath_profile();
    let result = simulate_composable_matchup_with_trace(
        &attacker, &defender, Some(&breath), None,
        SimpleAbilityTimingMode::Fast,
        &ComposableAbilityConfig::default(),
        20.5, true,
    );
    let log = result.combat_log.expect("trace log");
    let slow_present = log
        .iter()
        .any(|e| e.status_id.as_deref() == Some("Slow_Status"));
    let blurred_present = log
        .iter()
        .any(|e| e.status_id.as_deref() == Some("Blurred_Vision_Status"));
    assert!(
        !slow_present,
        "Storm Breath must NOT emit Slow_Status (per Reference Notes: out of model)"
    );
    assert!(
        !blurred_present,
        "Storm Breath must NOT emit Blurred_Vision_Status (per Reference Notes: out of model)"
    );
}
