//! Reference: ability_ash_breath
//!
//! Covers each testable bullet in the "Ash Breath" entry. Each test body
//! starts with the [REF:ability_ash_breath] marker so the vitest coverage
//! gate (src/pages/referenceCoverage.test.ts) sees it.
//!
//! Source of truth for breath stats: data/breath_specs.runtime.json
//! (id="Ash_Breath", capacity 20 sec, regen 2, crit 25%, dps 0.1, perHit
//! "0.05% PER HIT", ailments Ashy Lungs 100% / 0.5, Ash Fall 10% / 2,
//! Burn 20% / 1).

use super::super::config::ComposableAbilityConfig;
use super::super::simulate_composable_matchup_with_trace;
use super::{applied_status, default_breath, default_combatant, stacks_from_one_breath_tick};
use crate::combat::compute_simple_breath_damage_with_actor_and_target_statuses;
use crate::contracts::{SimpleAbilityTimingMode, SimpleBreathProfile, SimpleCombatantStats};
use crate::spec_constants::{ASH_BREATH_CRIT_MULTIPLIER, ASH_BREATH_PER_HIT_MULTIPLIER};
use std::collections::BTreeMap;

fn ash_breath_profile() -> SimpleBreathProfile {
    let mut breath = default_breath();
    breath.dps_pct = 0.1;
    breath.capacity = 20.0;
    breath.regen_rate = 2.0;
    breath.crit_chance_pct = 25.0;
    breath.chain = 100.0;
    breath.chain_max_stacks = 10.0;
    breath.special_statuses = vec![
        applied_status("Ashy_Lungs", 0.5),
        applied_status("Ash_Fall_Status", 0.2),
        applied_status("Burn_Status", 0.2),
    ];
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
fn capacity_is_twenty_seconds_of_firing_at_two_ticks_a_second() {
    // [REF:ability_ash_breath]
    let attacker = passive_combatant(1_000.0);
    let defender = passive_combatant(10_000_000.0);
    let result = simulate_composable_matchup_with_trace(
        &attacker, &defender,
        Some(&ash_breath_profile()), None,
        SimpleAbilityTimingMode::Fast,
        &ComposableAbilityConfig::default(),
        20.5, true,
    );
    let log = result.combat_log.expect("trace log");
    let ticks: Vec<f64> = log
        .iter()
        .filter(|e| e.entry_type == "breath" && e.attacker == "A")
        .map(|e| e.time)
        .collect();
    assert_eq!(
        ticks.len(),
        40,
        "20 s of capacity at 2 ticks a second is 40 ticks: {ticks:?}",
    );
}

#[test]
fn damage_formula_matches_spec() {
    // [REF:ability_ash_breath]
    let mut attacker = default_combatant();
    attacker.weight = 200.0;
    let mut defender = default_combatant();
    defender.health = 4_000.0;
    defender.weight = 100.0;
    defender.breath_resistance = 0.20;
    let breath = ash_breath_profile();

    let mut chain = 0.0;
    let actual = compute_simple_breath_damage_with_actor_and_target_statuses(
        &attacker, &defender, &breath, &mut chain,
        &BTreeMap::new(), &BTreeMap::new(),
    );
    let weight_ratio = attacker.weight / defender.weight;
    let base = (defender.health * (1.0 + weight_ratio)) / 2.0 / 100.0;
    let expected = base
        * ASH_BREATH_PER_HIT_MULTIPLIER
        * ASH_BREATH_CRIT_MULTIPLIER
        * (1.0 - defender.breath_resistance);
    assert!(
        (actual - expected).abs() < 1e-9,
        "Ash Breath per-tick damage mismatch: expected {expected}, got {actual}",
    );
}

#[test]
fn one_tick_lands_all_three_ailments_at_their_average() {
    // [REF:ability_ash_breath]
    let landed = stacks_from_one_breath_tick(&ash_breath_profile());
    let stacks = |id: &str| landed.get(id).copied().unwrap_or(0.0);
    assert!((stacks("Ashy_Lungs") - 0.5).abs() < 1e-9, "Ashy Lungs at 100% of half a stack");
    assert!((stacks("Ash_Fall_Status") - 0.2).abs() < 1e-9, "Ash Fall at 10% of two stacks");
    assert!((stacks("Burn_Status") - 0.2).abs() < 1e-9, "Burn at 20% of one stack");
}
