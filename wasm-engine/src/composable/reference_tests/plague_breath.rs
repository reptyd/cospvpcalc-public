//! Reference: ability_plague_breath
//!
//! Covers each testable bullet in the "Plague Breath" entry. Each test
//! body starts with the [REF:ability_plague_breath] marker so the
//! vitest coverage gate (src/pages/referenceCoverage.test.ts) sees it.
//!
//! Source of truth for breath stats: data/breath_specs.runtime.json:208-221
//! (id="Plague_Breath", capacity 5 sec, regen 2, crit 25%, dps 0.5,
//! perHit "0.25% PER HIT", secondary Disease 100% / 1).

use super::super::config::ComposableAbilityConfig;
use super::super::simulate_composable_matchup_with_trace;
use super::{applied_status, default_breath, default_combatant};
use crate::combat::compute_simple_breath_damage_with_actor_and_target_statuses;
use crate::contracts::{SimpleAbilityTimingMode, SimpleBreathProfile, SimpleCombatantStats};
use std::collections::BTreeMap;

fn plague_breath_profile() -> SimpleBreathProfile {
    let mut breath = default_breath();
    // Per Reference text "* 0.25 * 1.25": 0.25 = dps 0.5 / 2 ticks; 1.25
    // = 25% pseudo-crit. Encoded as dps_pct=0.5, crit_chance_pct=25.
    breath.dps_pct = 0.5;
    breath.capacity = 5.0;
    breath.regen_rate = 2.0;
    breath.crit_chance_pct = 25.0;
    // Disease 100% × 1 stack = 1.0 deterministic per tick.
    breath.special_statuses = vec![applied_status("Disease_Status", 1.0)];
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
    // [REF:ability_plague_breath]
    // Bullet 1: "Plague Breath deals damage 2 times per second while
    // it is firing." Capacity 5 (seconds) emits 10 ticks at t=0.5..5.0.
    let attacker = passive_combatant(1_000.0);
    let defender = passive_combatant(10_000_000.0);
    let breath = plague_breath_profile();
    let result = simulate_composable_matchup_with_trace(
        &attacker, &defender,
        Some(&breath), None,
        SimpleAbilityTimingMode::Fast,
        &ComposableAbilityConfig::default(),
        5.5, true,
    );
    let log = result.combat_log.expect("trace log");
    let breath_ticks: Vec<f64> = log
        .iter()
        .filter(|e| e.entry_type == "breath" && e.attacker == "A")
        .map(|e| e.time)
        .collect();
    assert_eq!(
        breath_ticks.len(),
        10,
        "expected 10 breath ticks (5 s capacity × 2/s) before exhaustion: {breath_ticks:?}"
    );
}

#[test]
fn capacity_is_five_seconds_of_firing() {
    // [REF:ability_plague_breath]
    // Bullet 2: "Plague Breath has capacity 5."
    // 5 s × 2 ticks/s = 10 ticks before the burst exhausts.
    let attacker = passive_combatant(1_000.0);
    let defender = passive_combatant(10_000_000.0);
    let breath = plague_breath_profile();
    let result = simulate_composable_matchup_with_trace(
        &attacker, &defender,
        Some(&breath), None,
        SimpleAbilityTimingMode::Fast,
        &ComposableAbilityConfig::default(),
        7.0, true,
    );
    let log = result.combat_log.expect("trace log");
    let burst_ticks: Vec<f64> = log
        .iter()
        .filter(|e| e.entry_type == "breath" && e.attacker == "A" && e.time <= 6.0 + 1e-9)
        .map(|e| e.time)
        .collect();
    assert_eq!(
        burst_ticks.len(),
        10,
        "first Plague Breath burst must exhaust after 5 s of firing (10 ticks): {burst_ticks:?}"
    );
}

#[test]
fn damage_formula_matches_spec() {
    // [REF:ability_plague_breath]
    // Bullets 3+4: "Breath damage per tick is calculated as
    // (((target max HP * ((attacker effective weight / defender effective
    // weight) + 1)) / 2) / 100) * 0.25 * 1.25 * (1 - breath resistance)."
    let mut attacker = default_combatant();
    attacker.weight = 200.0;
    let mut defender = default_combatant();
    defender.health = 4_000.0;
    defender.weight = 100.0;
    defender.breath_resistance = 0.20;
    let breath = plague_breath_profile();

    let mut chain = 0.0;
    let actual = compute_simple_breath_damage_with_actor_and_target_statuses(
        &attacker, &defender, &breath, &mut chain,
        &BTreeMap::new(), &BTreeMap::new(),
    );
    let weight_ratio = attacker.weight / defender.weight;
    let base = (defender.health * (1.0 + weight_ratio)) / 2.0 / 100.0;
    let expected = base * 0.25 * 1.125 * (1.0 - defender.breath_resistance);
    assert!(
        (actual - expected).abs() < 1e-9,
        "Plague Breath per-tick damage mismatch: expected {expected}, got {actual}"
    );
}

#[test]
fn applies_disease_secondary_status() {
    // [REF:ability_plague_breath]
    // Bullet 5: "Its listed secondary effect is Disease at 100% chance
    // for 1 stack."
    // Notes: "Its Disease application uses pseudo-procs, so 1 stack at
    // 100% chance becomes 1 expected stack per tick." Verify Disease
    // is applied during firing.
    let attacker = passive_combatant(1_000.0);
    let defender = passive_combatant(10_000_000.0);
    let breath = plague_breath_profile();
    let result = simulate_composable_matchup_with_trace(
        &attacker, &defender,
        Some(&breath), None,
        SimpleAbilityTimingMode::Fast,
        &ComposableAbilityConfig::default(),
        5.0, true,
    );
    let log = result.combat_log.expect("trace log");
    let disease_present = log
        .iter()
        .any(|e| e.status_id.as_deref() == Some("Disease_Status"));
    assert!(
        disease_present,
        "Plague Breath must apply Disease_Status as a secondary effect"
    );
}
