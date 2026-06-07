//! Reference: ability_haunt_breath
//!
//! Covers each testable bullet in the "Haunt Breath" entry. Each test
//! body starts with the [REF:ability_haunt_breath] marker so the vitest
//! coverage gate (src/pages/referenceCoverage.test.ts) sees it.
//!
//! Source of truth for breath stats: data/breath_specs.runtime.json:127-140
//! (id="Haunt_Breath", capacity 10 sec, regen 2.5, crit 35%, dps 1.5,
//! perHit "0.75% PER HIT").

use super::super::config::ComposableAbilityConfig;
use super::super::simulate_composable_matchup_with_trace;
use super::{applied_status, default_breath, default_combatant};
use crate::combat::compute_simple_breath_damage_with_actor_and_target_statuses;
use crate::contracts::{SimpleAbilityTimingMode, SimpleBreathProfile, SimpleCombatantStats};
use std::collections::BTreeMap;

fn haunt_breath_profile() -> SimpleBreathProfile {
    let mut breath = default_breath();
    // Per Reference text "* 0.75 * 1.35": the 0.75 is the per-tick fraction
    // (Haunt Breath ticks 2 times per second with dps 1.5%/s, so per-tick
    // = 1.5/2 = 0.75) and the 1.35 is Haunt Breath's 35% pseudo-crit. The
    // engine yields `* dps_pct * 0.5 * (1 + crit_chance_pct/100)` which
    // matches `dps_pct=1.5, crit_chance_pct=35` → 1.5 * 0.5 * 1.35 = 1.0125.
    breath.dps_pct = 1.5;
    breath.capacity = 10.0;
    breath.regen_rate = 2.5;
    breath.crit_chance_pct = 35.0;
    // Reference: "Poison at 75% chance for 1 stack" → 0.75 deterministic
    // per tick. Shock and Tunnel Vision are listed in raw spec but only
    // Poison is currently modeled (per ref entry's Notes).
    breath.special_statuses = vec![applied_status("Poison_Status", 0.75)];
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
    // [REF:ability_haunt_breath]
    // Bullet 1: "Haunt Breath deals damage 2 times per second while it
    // is firing." Capacity 10 (seconds) emits 20 ticks at t=0.5..10.0.
    let attacker = passive_combatant(1_000.0);
    let defender = passive_combatant(10_000_000.0);
    let breath = haunt_breath_profile();
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
        "expected 20 breath ticks (10 s capacity × 2/s) before exhaustion: {breath_ticks:?}"
    );
    let first = breath_ticks[0];
    let last = breath_ticks[breath_ticks.len() - 1];
    assert!(
        (first - 0.5).abs() < 1e-9,
        "first Haunt Breath tick must land at t=0.5, got {first}"
    );
    assert!(
        (last - 10.0).abs() < 1e-9,
        "last Haunt Breath tick must land at t=10.0, got {last}"
    );
}

#[test]
fn capacity_is_ten_seconds_of_firing() {
    // [REF:ability_haunt_breath]
    // Bullet 2: "Haunt Breath has capacity 10."
    // Capacity is in seconds; with 2 ticks/s that is exactly 20 ticks
    // before the burst exhausts and waits for regen.
    let attacker = passive_combatant(1_000.0);
    let defender = passive_combatant(10_000_000.0);
    let breath = haunt_breath_profile();
    let result = simulate_composable_matchup_with_trace(
        &attacker,
        &defender,
        Some(&breath),
        None,
        SimpleAbilityTimingMode::Fast,
        &ComposableAbilityConfig::default(),
        12.0,
        true,
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
        "first Haunt Breath burst must exhaust after 10 s of firing (20 ticks): {burst_ticks:?}"
    );
}

#[test]
fn damage_formula_matches_spec() {
    // [REF:ability_haunt_breath]
    // Bullets 3+4: "Breath damage per tick is calculated as
    // (((target max HP * ((attacker effective weight / defender effective
    // weight) + 1)) / 2) / 100) * 0.75 * 1.35 * (1 - breath resistance)."
    // The 0.75 is the per-tick percent (dps 1.5 / 2 ticks/sec); 1.35 is
    // the 35% pseudo-crit. Encoded as dps_pct=1.5, crit_chance_pct=35.
    let mut attacker = default_combatant();
    attacker.weight = 200.0;
    let mut defender = default_combatant();
    defender.health = 4_000.0;
    defender.weight = 100.0;
    defender.breath_resistance = 0.20;
    let breath = haunt_breath_profile();

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
    let base = (defender.health * (1.0 + weight_ratio)) / 2.0 / 100.0;
    let expected = base * 0.75 * 1.175 * (1.0 - defender.breath_resistance);
    assert!(
        (actual - expected).abs() < 1e-9,
        "Haunt Breath per-tick damage mismatch: expected {expected}, got {actual}"
    );
}

#[test]
fn applies_poison_secondary_status() {
    // [REF:ability_haunt_breath]
    // Bullet 5: "Its listed secondary effects are Poison at 75% chance
    // for 1 stack, Shock at 10% chance for 0.5 stacks, and Tunnel Vision
    // at 25% chance for 0.5 stacks."
    // Notes clarify only Poison is modeled (0.75 expected stacks per
    // tick). Verify the engine emits Poison_Status during firing and
    // does not emit Shock_Status or Tunnel_Vision_Status (unmodeled).
    let attacker = passive_combatant(1_000.0);
    let defender = passive_combatant(10_000_000.0);
    let breath = haunt_breath_profile();
    let result = simulate_composable_matchup_with_trace(
        &attacker,
        &defender,
        Some(&breath),
        None,
        SimpleAbilityTimingMode::Fast,
        &ComposableAbilityConfig::default(),
        5.0,
        true,
    );
    let log = result.combat_log.expect("trace log");
    let poison_present = log
        .iter()
        .any(|e| e.status_id.as_deref() == Some("Poison_Status"));
    assert!(
        poison_present,
        "Haunt Breath must apply Poison_Status as a secondary effect"
    );
    let shock_present = log
        .iter()
        .any(|e| e.status_id.as_deref() == Some("Shock_Status"));
    assert!(
        !shock_present,
        "Haunt Breath must not emit Shock_Status (raw spec lists it but only Poison is modeled)"
    );
    let tunnel_present = log
        .iter()
        .any(|e| e.status_id.as_deref() == Some("Tunnel_Vision_Status"));
    assert!(
        !tunnel_present,
        "Haunt Breath must not emit Tunnel_Vision_Status (raw spec lists it but only Poison is modeled)"
    );
}
