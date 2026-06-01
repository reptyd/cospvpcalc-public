//! Reference: ability_energy_breath
//!
//! Covers each testable bullet in the "Energy Breath" entry. Each test
//! body starts with the [REF:ability_energy_breath] marker so the vitest
//! coverage gate (src/pages/referenceCoverage.test.ts) sees it.

use super::super::config::ComposableAbilityConfig;
use super::super::simulate_composable_matchup_with_trace;
use super::{default_breath, default_combatant};
use crate::combat::compute_simple_breath_damage_with_actor_and_target_statuses;
use crate::contracts::{SimpleAbilityTimingMode, SimpleBreathProfile, SimpleCombatantStats};
use std::collections::BTreeMap;

fn energy_breath_profile() -> SimpleBreathProfile {
    let mut breath = default_breath();
    breath.dps_pct = 0.45; // 0.225 per-tick after the * 0.5 factor.
    breath.capacity = 8.0;
    breath.regen_rate = 1.8;
    breath.crit_chance_pct = 0.0;
    breath.special_kind = Some("energy".to_string());
    breath.chain = 100.0; // multiplier ramp factor: 1 + 1.0 × stacks.
    breath.chain_max_stacks = 10.0;
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
fn chain_multiplier_ramps_two_to_eleven_over_ten_ticks() {
    // [REF:ability_energy_breath]
    // Per-tick multiplier on chained damage = 1 + (chain/100) × stacks.
    // chain_stacks starts at 0 and increments by 1 each tick (capped at
    // chain_max_stacks). So the per-tick chain factor for ticks 1..=10
    // is 2, 3, 4, …, 11. Subsequent ticks stay at 11.
    let attacker = default_combatant();
    let mut defender = default_combatant();
    defender.health = 2_000.0;
    defender.weight = 100.0;
    defender.breath_resistance = 0.0;
    let breath = energy_breath_profile();
    let mut chain_stacks = 0.0;
    let mut damages = Vec::new();
    for _ in 0..10 {
        let d = compute_simple_breath_damage_with_actor_and_target_statuses(
            &attacker,
            &defender,
            &breath,
            &mut chain_stacks,
            &BTreeMap::new(),
            &BTreeMap::new(),
        );
        damages.push(d);
    }
    let weight_ratio = attacker.weight / defender.weight;
    let base = (defender.health * (1.0 + weight_ratio)) / 2.0 / 100.0 * breath.dps_pct * 0.5;
    for (i, d) in damages.iter().enumerate() {
        let stacks = (i + 1) as f64; // chain_stacks after the i-th tick.
        let expected = base * (1.0 + (breath.chain / 100.0) * stacks);
        assert!(
            (d - expected).abs() < 1e-9,
            "tick {} expected damage {expected} (stacks={stacks}), got {d}",
            i + 1
        );
    }
    // Eleventh tick: chain caps at 10, damage = base × 11.
    let extra = compute_simple_breath_damage_with_actor_and_target_statuses(
        &attacker,
        &defender,
        &breath,
        &mut chain_stacks,
        &BTreeMap::new(),
        &BTreeMap::new(),
    );
    let expected_capped = base * (1.0 + (breath.chain / 100.0) * breath.chain_max_stacks);
    assert!(
        (extra - expected_capped).abs() < 1e-9,
        "post-cap damage expected {expected_capped} (stacks capped at {}), got {extra}",
        breath.chain_max_stacks
    );
}

#[test]
fn capacity_is_eight_seconds_with_two_ticks_per_second() {
    // [REF:ability_energy_breath]
    // Capacity 8 = 8 seconds of firing. Damage ticks 2/sec → 16 ticks
    // before exhaustion, spanning t=0.5..8.0.
    let attacker = passive_combatant(1_000.0);
    let defender = passive_combatant(10_000_000.0);
    let breath = energy_breath_profile();
    let result = simulate_composable_matchup_with_trace(
        &attacker,
        &defender,
        Some(&breath),
        None,
        SimpleAbilityTimingMode::Fast,
        &ComposableAbilityConfig::default(),
        8.5,
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
        16,
        "expected exactly 16 breath ticks before capacity exhausts: {breath_ticks:?}"
    );
}
