//! Reference: ability_breath_resistance
//!
//! Covers each testable bullet in the "Breath Resistance" entry. Each
//! test body starts with the [REF:ability_breath_resistance] marker so
//! the vitest coverage gate (src/pages/referenceCoverage.test.ts) sees it.

use super::super::config::ComposableAbilityConfig;
use super::super::simulate_composable_matchup_with_trace;
use super::{applied_status, default_breath, default_combatant};
use crate::combat::compute_simple_breath_damage_with_actor_and_target_statuses;
use crate::contracts::{SimpleAbilityTimingMode, SimpleBreathProfile};
use std::collections::BTreeMap;

fn standard_breath() -> SimpleBreathProfile {
    let mut breath = default_breath();
    breath.dps_pct = 1.0;
    breath.capacity = 10.0;
    breath.regen_rate = 1.8;
    breath
}

#[test]
fn raw_damage_formula_matches_spec() {
    // [REF:ability_breath_resistance]
    // Raw = ((target max HP * (1 + atk_weight / def_weight)) / 2 / 100) * dps_pct * 0.5
    let mut attacker = default_combatant();
    attacker.weight = 200.0;
    let mut defender = default_combatant();
    defender.health = 2_000.0;
    defender.weight = 100.0;
    defender.breath_resistance = 0.0;
    let breath = standard_breath();
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
    let expected =
        ((defender.health * (1.0 + weight_ratio)) / 2.0 / 100.0) * breath.dps_pct * 0.5;
    assert!(
        (actual - expected).abs() < 1e-9,
        "raw breath damage formula mismatch: expected {expected}, got {actual}"
    );
}

#[test]
fn final_damage_scales_by_one_minus_resistance() {
    // [REF:ability_breath_resistance]
    let mut attacker = default_combatant();
    attacker.weight = 100.0;
    let mut defender = default_combatant();
    defender.health = 2_000.0;
    defender.weight = 100.0;
    let breath = standard_breath();

    defender.breath_resistance = 0.0;
    let mut chain = 0.0;
    let raw = compute_simple_breath_damage_with_actor_and_target_statuses(
        &attacker,
        &defender,
        &breath,
        &mut chain,
        &BTreeMap::new(),
        &BTreeMap::new(),
    );

    for resistance in [0.25_f64, 0.5, 0.95] {
        defender.breath_resistance = resistance;
        let mut chain = 0.0;
        let actual = compute_simple_breath_damage_with_actor_and_target_statuses(
            &attacker,
            &defender,
            &breath,
            &mut chain,
            &BTreeMap::new(),
            &BTreeMap::new(),
        );
        let expected = raw * (1.0 - resistance);
        assert!(
            (actual - expected).abs() < 1e-9,
            "breath resistance {resistance}: expected {expected}, got {actual}"
        );
    }
}

#[test]
fn does_not_block_breath_applied_statuses() {
    // [REF:ability_breath_resistance]
    let mut attacker = default_combatant();
    attacker.health = 1_000.0;
    attacker.bite_cooldown = 1000.0;
    attacker.damage = 0.0;

    let mut defender = default_combatant();
    defender.health = 100_000.0;
    defender.bite_cooldown = 1000.0;
    defender.damage = 0.0;
    defender.breath_resistance = 0.95;

    let mut breath = standard_breath();
    breath.special_statuses = vec![applied_status("Burn_Status", 2.0)];

    let result = simulate_composable_matchup_with_trace(
        &attacker,
        &defender,
        Some(&breath),
        None,
        SimpleAbilityTimingMode::Fast,
        &ComposableAbilityConfig::default(),
        4.0,
        true,
    );

    let log = result.combat_log.as_ref().expect("trace log requested");
    let burn_applied = log.iter().any(|e| {
        e.status_id.as_deref() == Some("Burn_Status")
            && e.description
                .as_deref()
                .is_some_and(|d| d.contains("applied"))
    });
    assert!(
        burn_applied,
        "Burn_Status must still be applied to the defender despite 0.95 breath resistance"
    );
    assert!(
        result.final_hp_b < defender.health,
        "some breath damage must still land (the 5% that breath resistance allows through)"
    );
}
