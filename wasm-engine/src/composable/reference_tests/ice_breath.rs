//! Reference: ability_ice_breath
//!
//! Covers each testable bullet in the "Ice Breath" entry. Each test
//! body starts with the [REF:ability_ice_breath] marker so the vitest
//! coverage gate (src/pages/referenceCoverage.test.ts) sees it.
//!
//! Source of truth for breath stats: data/breath_specs.runtime.json:162-174
//! (id="Ice_Breath", capacity 10 sec, regen 3.75, crit 0%, dps 1,
//! perHit "0.5% PER HIT", secondaries Slowed 40% no-stack +
//! Frostbite 75% / 0.5).

use super::super::config::ComposableAbilityConfig;
use super::super::simulate_composable_matchup_with_trace;
use super::{
    applied_status, assert_tick_stacks, default_breath, default_combatant,
    stacks_from_one_breath_tick,
};
use crate::combat::compute_simple_breath_damage_with_actor_and_target_statuses;
use crate::contracts::{SimpleAbilityTimingMode, SimpleBreathProfile, SimpleCombatantStats};
use crate::spec_constants::{ICE_BREATH_CRIT_MULTIPLIER, ICE_BREATH_PER_HIT_MULTIPLIER};
use std::collections::BTreeMap;

fn ice_breath_profile() -> SimpleBreathProfile {
    let mut breath = default_breath();
    // Per Reference text "* 0.5 * 1.0": the 0.5 is the per-tick fraction
    // (Ice Breath ticks 2 times per second with dps 1%/s, so per-tick
    // = 1/2 = 0.5) and the 1.0 is Ice Breath's 0% pseudo-crit (notes:
    // "Ice Breath has 0% crit, so its pseudo-crit multiplier is 1.0x.").
    breath.dps_pct = 1.0;
    breath.capacity = 10.0;
    breath.regen_rate = 3.75;
    breath.crit_chance_pct = 0.0;
    // Slowed 40% x 1 stack and Frostbite 75% x 0.5, as expected stacks
    // per tick.
    breath.special_statuses = vec![
        applied_status("Slow_Status", 0.4),
        applied_status("Frostbite_Status", 0.375),
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
    // [REF:ability_ice_breath]
    // Bullet 1: "Ice Breath deals damage 2 times per second while it is
    // firing." Capacity 10 seconds emits 20 ticks at t=0.5..10.0.
    let attacker = passive_combatant(1_000.0);
    let defender = passive_combatant(10_000_000.0);
    let breath = ice_breath_profile();
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
        "first Ice Breath tick must land at t=0.5, got {first}"
    );
    assert!(
        (last - 10.0).abs() < 1e-9,
        "last Ice Breath tick must land at t=10.0, got {last}"
    );
}

#[test]
fn capacity_is_ten_seconds_of_firing() {
    // [REF:ability_ice_breath]
    // Bullet 2: "Capacity is 10 seconds of firing - one second of continuous
    // fire spends 1 unit." Capacity is in seconds; with 2 ticks/s that is
    // exactly 20 ticks before the burst exhausts.
    let attacker = passive_combatant(1_000.0);
    let defender = passive_combatant(10_000_000.0);
    let breath = ice_breath_profile();
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
        "first Ice Breath burst must exhaust after 10 s of firing (20 ticks): {burst_ticks:?}"
    );
}

#[test]
fn damage_formula_matches_spec() {
    // [REF:ability_ice_breath]
    // Bullets 3+4: "Breath damage per tick is calculated as (((target max HP ×
    // (1 + min(attacker effective weight / defender effective weight, 3))) /
    // 2) / 100) × 0.5 × 1.0 × (1 - breath resistance)." The 0.5 is the
    // per-tick percent (dps 1 / 2 ticks/sec); 1.0 is the 0% pseudo-crit.
    // Encoded as dps_pct=1, crit_chance_pct=0.
    let mut attacker = default_combatant();
    attacker.weight = 200.0;
    let mut defender = default_combatant();
    defender.health = 4_000.0;
    defender.weight = 100.0;
    defender.breath_resistance = 0.20;
    let breath = ice_breath_profile();

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
    let expected = base
        * ICE_BREATH_PER_HIT_MULTIPLIER
        * ICE_BREATH_CRIT_MULTIPLIER
        * (1.0 - defender.breath_resistance);
    assert!(
        (actual - expected).abs() < 1e-9,
        "Ice Breath per-tick damage mismatch: expected {expected}, got {actual}"
    );
}

#[test]
fn applies_both_secondary_statuses() {
    // [REF:ability_ice_breath]
    // Bullet 5: "Every damage tick applies 0.4 stacks of Slowed and
    // 0.375 stacks of Frostbite - the model does not roll Slowed's 40%
    // chance with no stacking or Frostbite's 75% chance for 0.5 stacks,
    // it applies the average of each roll."
    let attacker = passive_combatant(1_000.0);
    let defender = passive_combatant(10_000_000.0);
    let breath = ice_breath_profile();
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
    let frostbite_present = log
        .iter()
        .any(|e| e.status_id.as_deref() == Some("Frostbite_Status"));
    assert!(
        frostbite_present,
        "Ice Breath must apply Frostbite_Status as a secondary effect"
    );
    let slow_present = log
        .iter()
        .any(|e| e.status_id.as_deref() == Some("Slow_Status"));
    assert!(
        slow_present,
        "Ice Breath must apply Slow_Status - the engine id for the listed Slowed - as a secondary effect"
    );
}

#[test]
fn each_tick_applies_the_stacks_the_entry_states() {
    // [REF:ability_ice_breath]
    // "Every damage tick applies 0.4 stacks of Slowed and 0.375 stacks of
    // Frostbite". Both arrive in the test above; these are the sizes.
    let applied = stacks_from_one_breath_tick(&ice_breath_profile());
    assert_tick_stacks(&applied, "Slow_Status", 0.4);
    assert_tick_stacks(&applied, "Frostbite_Status", 0.375);
}
