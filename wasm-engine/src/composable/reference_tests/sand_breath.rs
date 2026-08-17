//! Reference: ability_sand_breath
//!
//! Covers each testable bullet in the "Sand Breath" entry. Each test
//! body starts with the [REF:ability_sand_breath] marker so the vitest
//! coverage gate (src/pages/referenceCoverage.test.ts) sees it.
//!
//! Source of truth for breath stats: data/breath_specs.runtime.json:239-251
//! (id="Sand_Breath", capacity 10 sec, regen 1.8, crit 0%, dps 0.5,
//! perHit "0.25% PER HIT", secondaries Blurred Vision 100% no-stack +
//! Tunnel Vision 50% no-stack).

use super::super::config::ComposableAbilityConfig;
use super::super::simulate_composable_matchup_with_trace;
use super::{
    applied_status, assert_tick_stacks, default_breath, default_combatant,
    stacks_from_one_breath_tick,
};
use crate::combat::compute_simple_breath_damage_with_actor_and_target_statuses;
use crate::contracts::{SimpleAbilityTimingMode, SimpleBreathProfile, SimpleCombatantStats};
use crate::spec_constants::{SAND_BREATH_CRIT_MULTIPLIER, SAND_BREATH_PER_HIT_MULTIPLIER};
use std::collections::BTreeMap;

fn sand_breath_profile() -> SimpleBreathProfile {
    let mut breath = default_breath();
    breath.dps_pct = 0.5;
    breath.capacity = 10.0;
    breath.regen_rate = 1.8;
    breath.crit_chance_pct = 0.0;
    // Blurred Vision 100% x 1 stack and Tunnel Vision 50% x 1 stack, as
    // expected stacks per tick.
    breath.special_statuses = vec![
        applied_status("Blurred_Vision_Status", 1.0),
        applied_status("Tunnel_Vision_Status", 0.5),
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
    // Bullet 2: "Capacity is 10 seconds of firing - one second of continuous
    // fire spends 1 unit."
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
    // The breath re-bursts after emptying (a ~1 s regen gap), so count only
    // the first contiguous run of ticks (<= one 0.5 s tick apart).
    let first_burst = if burst_ticks.is_empty() {
        0
    } else {
        1 + burst_ticks
            .windows(2)
            .take_while(|w| w[1] - w[0] <= 0.5 + 1e-9)
            .count()
    };
    assert_eq!(
        first_burst,
        20,
        "first Sand Breath burst must exhaust after 10 s of firing (20 ticks): {burst_ticks:?}"
    );
}

#[test]
fn damage_formula_matches_spec() {
    // [REF:ability_sand_breath]
    // Bullets 3+4: "Breath damage per tick is calculated as (((target max HP ×
    // (1 + min(attacker effective weight / defender effective weight, 3))) /
    // 2) / 100) × 0.25 × 1.0 × (1 - breath resistance)."
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
    let expected = base
        * SAND_BREATH_PER_HIT_MULTIPLIER
        * SAND_BREATH_CRIT_MULTIPLIER
        * (1.0 - defender.breath_resistance);
    assert!(
        (actual - expected).abs() < 1e-9,
        "Sand Breath per-tick damage mismatch: expected {expected}, got {actual}"
    );
}

#[test]
fn applies_blurred_vision_and_tunnel_vision_secondaries() {
    // [REF:ability_sand_breath]
    // Bullet 5: "Every damage tick applies 1 stack of Blurred Vision and
    // 0.5 stacks of Tunnel Vision - the model does not roll Blurred
    // Vision's 100% chance with no stacking or Tunnel Vision's 50%
    // chance with no stacking, it applies the average of each roll."
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
        blurred_present,
        "Sand Breath must apply Blurred_Vision_Status while firing"
    );
    assert!(
        tunnel_present,
        "Sand Breath must apply Tunnel_Vision_Status while firing"
    );
}

#[test]
fn each_tick_applies_the_stacks_the_entry_states() {
    // [REF:ability_sand_breath]
    // "Every damage tick applies 1 stack of Blurred Vision and 0.5 stacks of
    // Tunnel Vision".
    let applied = stacks_from_one_breath_tick(&sand_breath_profile());
    assert_tick_stacks(&applied, "Blurred_Vision_Status", 1.0);
    assert_tick_stacks(&applied, "Tunnel_Vision_Status", 0.5);
}
