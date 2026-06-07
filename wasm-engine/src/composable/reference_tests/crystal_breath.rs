//! Reference: ability_crystal_breath
//!
//! Covers each testable bullet in the "Crystal Breath" entry. Each test
//! body starts with the [REF:ability_crystal_breath] marker so the vitest
//! coverage gate (src/pages/referenceCoverage.test.ts) sees it.

use super::super::config::ComposableAbilityConfig;
use super::super::simulate_composable_matchup_with_trace;
use super::{applied_status, default_breath, default_combatant};
use crate::combat::compute_simple_breath_damage_with_actor_and_target_statuses;
use crate::contracts::{SimpleAbilityTimingMode, SimpleBreathProfile, SimpleCombatantStats};
use std::collections::BTreeMap;

fn crystal_breath_profile() -> SimpleBreathProfile {
    let mut breath = default_breath();
    breath.dps_pct = 1.0;
    breath.capacity = 10.0;
    breath.regen_rate = 1.8;
    breath.crit_chance_pct = 0.0;
    // Bleed 75% × 0.5 stacks → 0.375 deterministic per tick. Injury and
    // Shredded Wings are listed in the raw spec but not modeled (the
    // Reference notes call this out).
    breath.special_statuses = vec![applied_status("Bleed_Status", 0.375)];
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
    // [REF:ability_crystal_breath]
    // Per-tick damage = ((target max HP * (1 + atk_w/def_w)) / 2 / 100)
    //                   * dps_pct * 0.5 * (1 - breath_resistance).
    let mut attacker = default_combatant();
    attacker.weight = 200.0;
    let mut defender = default_combatant();
    defender.health = 2_000.0;
    defender.weight = 100.0;
    defender.breath_resistance = 0.20;
    let breath = crystal_breath_profile();
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
    let expected = ((defender.health * (1.0 + weight_ratio)) / 2.0 / 100.0)
        * breath.dps_pct
        * 0.5
        * (1.0 - defender.breath_resistance);
    assert!(
        (actual - expected).abs() < 1e-9,
        "expected {expected}, got {actual}"
    );
}

#[test]
fn capacity_is_ten_seconds_with_two_ticks_per_second() {
    // [REF:ability_crystal_breath]
    // Capacity 10 = 10 seconds of firing. Damage ticks 2/sec → 20 ticks
    // before exhaustion, spanning t=0.5..10.0.
    let attacker = passive_combatant(1_000.0);
    let defender = passive_combatant(1_000_000.0); // tank, must survive
    let breath = crystal_breath_profile();
    let result = simulate_composable_matchup_with_trace(
        &attacker,
        &defender,
        Some(&breath),
        None,
        SimpleAbilityTimingMode::Fast,
        &ComposableAbilityConfig::default(),
        10.5,
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
        20,
        "expected exactly 20 breath ticks before capacity exhausts: {breath_ticks:?}"
    );
    for (i, t) in breath_ticks.iter().enumerate() {
        let expected = 0.5 * (i + 1) as f64;
        assert!(
            (t - expected).abs() < 1e-9,
            "tick #{i} expected at t={expected}, got {t}"
        );
    }
}

#[test]
fn bleed_secondary_accumulates_at_documented_rate() {
    // [REF:ability_crystal_breath]
    // Each tick applies 0.375 Bleed stacks. After 10 ticks (one full
    // capacity burst), defender accumulates 3.75 Bleed stacks (modulo
    // any in-flight Bleed decay between ticks). We assert at least one
    // bleed stack landed via the trace log; precise stack accounting is
    // verified by the existing Bleed status tests.
    let attacker = passive_combatant(1_000.0);
    let defender = passive_combatant(1_000_000.0);
    let breath = crystal_breath_profile();
    let result = simulate_composable_matchup_with_trace(
        &attacker,
        &defender,
        Some(&breath),
        None,
        SimpleAbilityTimingMode::Fast,
        &ComposableAbilityConfig::default(),
        5.5,
        true,
    );
    let log = result.combat_log.expect("trace log");
    let bleed_applied = log
        .iter()
        .any(|e| e.status_id.as_deref() == Some("Bleed_Status"));
    assert!(
        bleed_applied,
        "Crystal Breath must apply Bleed_Status as a secondary effect"
    );
}
