//! Reference: ability_rock_breath
//!
//! Covers each testable bullet in the "Rock Breath" entry. Each test
//! body starts with the [REF:ability_rock_breath] marker so the vitest
//! coverage gate (src/pages/referenceCoverage.test.ts) sees it.
//!
//! Source of truth for breath stats: data/breath_specs.runtime.json:224-236
//! (id="Rock_Breath", capacity 10 sec, regen 3.5, crit 10%, dps 2,
//! perHit "1% PER HIT", secondaries Injury 10%/2 + Shredded Wings
//! 10%/2 - both out-of-model).

use super::super::config::ComposableAbilityConfig;
use super::super::simulate_composable_matchup_with_trace;
use super::{default_breath, default_combatant};
use crate::combat::compute_simple_breath_damage_with_actor_and_target_statuses;
use crate::contracts::{SimpleAbilityTimingMode, SimpleBreathProfile, SimpleCombatantStats};
use std::collections::BTreeMap;

fn rock_breath_profile() -> SimpleBreathProfile {
    let mut breath = default_breath();
    // Per Reference text "* 1.0 * 1.1": 1.0 = per-tick fraction
    // (dps 2 / 2 ticks/sec = 1%); 1.1 = 10% pseudo-crit.
    breath.dps_pct = 2.0;
    breath.capacity = 10.0;
    breath.regen_rate = 3.5;
    breath.crit_chance_pct = 10.0;
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
    // [REF:ability_rock_breath]
    // Bullet 1: "Rock Breath deals damage 2 times per second while it
    // is firing." Capacity 10 (seconds) emits 20 ticks at t=0.5..10.0.
    let attacker = passive_combatant(1_000.0);
    let defender = passive_combatant(10_000_000.0);
    let breath = rock_breath_profile();
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
    // [REF:ability_rock_breath]
    // Bullet 2: "Rock Breath has capacity 10."
    let attacker = passive_combatant(1_000.0);
    let defender = passive_combatant(10_000_000.0);
    let breath = rock_breath_profile();
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
        "first Rock Breath burst must exhaust after 10 s of firing (20 ticks): {burst_ticks:?}"
    );
}

#[test]
fn damage_formula_matches_spec() {
    // [REF:ability_rock_breath]
    // Bullets 3+4: "Breath damage per tick is calculated as
    // (((target max HP * ((attacker effective weight / defender effective
    // weight) + 1)) / 2) / 100) * 1.0 * 1.1 * (1 - breath resistance)."
    let mut attacker = default_combatant();
    attacker.weight = 200.0;
    let mut defender = default_combatant();
    defender.health = 4_000.0;
    defender.weight = 100.0;
    defender.breath_resistance = 0.20;
    let breath = rock_breath_profile();

    let mut chain = 0.0;
    let actual = compute_simple_breath_damage_with_actor_and_target_statuses(
        &attacker, &defender, &breath, &mut chain,
        &BTreeMap::new(), &BTreeMap::new(),
    );
    let weight_ratio = attacker.weight / defender.weight;
    let base = (defender.health * (1.0 + weight_ratio)) / 2.0 / 100.0;
    let expected = base * 1.0 * 1.05 * (1.0 - defender.breath_resistance);
    assert!(
        (actual - expected).abs() < 1e-9,
        "Rock Breath per-tick damage mismatch: expected {expected}, got {actual}"
    );
}

#[test]
fn injury_and_shredded_wings_secondaries_out_of_model() {
    // [REF:ability_rock_breath]
    // Bullet 5: "Its listed secondary effects are Injury at 10% chance
    // for 2 stacks and Shredded Wings at 10% chance for 2 stacks."
    // Notes: "currently out of model." → engine must NOT emit
    // Injury_Status or Shredded_Wings during a Rock Breath burst.
    let attacker = passive_combatant(1_000.0);
    let defender = passive_combatant(10_000_000.0);
    let breath = rock_breath_profile();
    let result = simulate_composable_matchup_with_trace(
        &attacker, &defender,
        Some(&breath), None,
        SimpleAbilityTimingMode::Fast,
        &ComposableAbilityConfig::default(),
        10.5, true,
    );
    let log = result.combat_log.expect("trace log");
    let injury_present = log
        .iter()
        .any(|e| e.status_id.as_deref() == Some("Injury_Status"));
    let shredded_wings_present = log
        .iter()
        .any(|e| e.status_id.as_deref() == Some("Shredded_Wings"));
    assert!(
        !injury_present,
        "Rock Breath must NOT emit Injury_Status (per Reference Notes: out of model)"
    );
    assert!(
        !shredded_wings_present,
        "Rock Breath must NOT emit Shredded_Wings (per Reference Notes: out of model)"
    );
}
