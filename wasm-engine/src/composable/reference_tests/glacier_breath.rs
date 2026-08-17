//! Reference: ability_glacier_breath
//!
//! Covers each testable bullet in the "Glacier Breath" entry. Each test
//! body starts with the [REF:ability_glacier_breath] marker so the
//! vitest coverage gate (src/pages/referenceCoverage.test.ts) sees it.

use super::super::breath::{breath_burst_model_enabled, set_breath_burst_model_override};
use super::super::config::ComposableAbilityConfig;
use super::super::simulate_composable_matchup_with_trace;
use super::{
    applied_status, assert_tick_stacks, default_breath, default_combatant,
    stacks_from_one_breath_tick,
};
use crate::combat::{breath_chain_advance, compute_simple_breath_damage_with_actor_and_target_statuses};
use crate::contracts::{SimpleAbilityTimingMode, SimpleBreathProfile, SimpleCombatantStats};
use std::collections::BTreeMap;

fn glacier_breath_profile() -> SimpleBreathProfile {
    let mut breath = default_breath();
    breath.dps_pct = 1.0;
    breath.capacity = 10.0;
    breath.regen_rate = 1.8;
    breath.crit_chance_pct = 35.0;
    breath.chain = 5.0;
    breath.chain_max_stacks = 10.0;
    // Slowed, Injury 1 stack and Freeze, as expected stacks per tick - the
    // same figures the shipped profile carries.
    breath.special_statuses = vec![
        applied_status("Slow_Status", 0.15),
        applied_status("Injury_Status", 0.3),
        applied_status("Freeze_Status", 0.05),
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
fn chain_multiplier_ramps_one_to_one_point_five() {
    // [REF:ability_glacier_breath]
    // The chain multiplier is read with the current stack count and then
    // incremented, so tick i uses (i - 1) stacks: the first tick is 1.0x
    // (0 stacks) and the multiplier reaches 1.5x at 10 stacks (tick 11).
    let attacker = default_combatant();
    let mut defender = default_combatant();
    defender.health = 2_000.0;
    defender.weight = 100.0;
    defender.breath_resistance = 0.0;
    let breath = glacier_breath_profile();
    // BREATH_BURST_MODEL: the compute read is pure (the increment moved to the
    // landed-hit site), so drive the flag on and advance the chain manually
    // between calls. The per-tick damage values are unchanged.
    set_breath_burst_model_override(Some(true));
    assert!(breath_burst_model_enabled());
    let mut chain_stacks = 0.0;
    for i in 1..=11 {
        let d = compute_simple_breath_damage_with_actor_and_target_statuses(
            &attacker, &defender, &breath, &mut chain_stacks,
            &BTreeMap::new(), &BTreeMap::new(),
        );
        breath_chain_advance(&mut chain_stacks, &breath);
        let weight_ratio = attacker.weight / defender.weight;
        let base = (defender.health * (1.0 + weight_ratio)) / 2.0 / 100.0
            * breath.dps_pct * 0.5 * (1.0 + breath.crit_chance_pct / 100.0 * 0.5);
        let expected = base * (1.0 + (breath.chain / 100.0) * (i - 1) as f64);
        assert!(
            (d - expected).abs() < 1e-9,
            "tick {i} expected {expected}, got {d}"
        );
    }
    set_breath_burst_model_override(None);
}

#[test]
fn capacity_is_ten_seconds_with_two_ticks_per_second() {
    // [REF:ability_glacier_breath]
    let attacker = passive_combatant(1_000.0);
    let defender = passive_combatant(10_000_000.0);
    let breath = glacier_breath_profile();
    let result = simulate_composable_matchup_with_trace(
        &attacker, &defender, Some(&breath), None,
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
        "expected 20 breath ticks for capacity=10 s: {breath_ticks:?}"
    );
}

#[test]
fn each_tick_applies_the_stacks_the_entry_states() {
    // [REF:ability_glacier_breath]
    // "Every damage tick applies 0.15 stacks of Slowed, 0.3 stacks of Injury
    // and 0.05 stacks of Freeze".
    let applied = stacks_from_one_breath_tick(&glacier_breath_profile());
    assert_tick_stacks(&applied, "Slow_Status", 0.15);
    assert_tick_stacks(&applied, "Injury_Status", 0.3);
    assert_tick_stacks(&applied, "Freeze_Status", 0.05);
}
