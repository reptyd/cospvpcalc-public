//! Reference: ability_virus_breath
//!
//! Covers each testable bullet in the "Virus Breath" entry. Each test
//! body starts with the [REF:ability_virus_breath] marker so the
//! vitest coverage gate (src/pages/referenceCoverage.test.ts) sees it.
//!
//! Source of truth for breath stats: data/breath_specs.runtime.json:329-341
//! (id="Virus_Breath", capacity 20, regen 1.5, crit 0%, dps 0.5,
//! perHit "0.25% PER HIT", secondary Bleed probability=75% stacks=1).
//! TS bridge `getRustBreathSpecialStatuses` collapses the pseudo-proc
//! to 0.75 expected stacks per tick.

use super::super::config::ComposableAbilityConfig;
use super::super::simulate_composable_matchup_with_trace;
use super::{applied_status, default_breath, default_combatant};
use crate::combat::compute_simple_breath_damage_with_actor_and_target_statuses;
use crate::contracts::{SimpleAbilityTimingMode, SimpleBreathProfile, SimpleCombatantStats};
use std::collections::BTreeMap;

fn virus_breath_profile() -> SimpleBreathProfile {
    let mut breath = default_breath();
    // dps 0.5 → engine internal *0.5 → 0.25 per tick. crit 0 → 1.0x
    // pseudo-crit. Bleed 75% × 1 stack collapses to 0.75 expected
    // stacks per tick.
    breath.dps_pct = 0.5;
    breath.capacity = 20.0;
    breath.regen_rate = 1.5;
    breath.crit_chance_pct = 0.0;
    breath.special_statuses = vec![applied_status("Bleed_Status", 0.75)];
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
    // [REF:ability_virus_breath]
    // Bullet 1: "Virus Breath deals damage 2 times per second while
    // it is firing."
    let attacker = passive_combatant(1_000.0);
    let defender = passive_combatant(10_000_000.0);
    let breath = virus_breath_profile();
    let result = simulate_composable_matchup_with_trace(
        &attacker, &defender, Some(&breath), None,
        SimpleAbilityTimingMode::Fast,
        &ComposableAbilityConfig::default(),
        21.0, true,
    );
    let log = result.combat_log.expect("trace log");
    let breath_ticks: Vec<f64> = log
        .iter()
        .filter(|e| e.entry_type == "breath" && e.attacker == "A")
        .map(|e| e.time)
        .collect();
    assert_eq!(
        breath_ticks.len(),
        40,
        "expected 40 breath ticks (20 s capacity × 2/s) before exhaustion: {breath_ticks:?}"
    );
}

#[test]
fn capacity_is_twenty_seconds_of_firing() {
    // [REF:ability_virus_breath]
    // Bullet 2: "Virus Breath has capacity 20 (20 seconds of firing).
    // Capacity drains at 1 unit per second of firing regardless of
    // damage tick frequency."
    let attacker = passive_combatant(1_000.0);
    let defender = passive_combatant(10_000_000.0);
    let breath = virus_breath_profile();
    let result = simulate_composable_matchup_with_trace(
        &attacker, &defender, Some(&breath), None,
        SimpleAbilityTimingMode::Fast,
        &ComposableAbilityConfig::default(),
        22.0, true,
    );
    let log = result.combat_log.expect("trace log");
    let burst_ticks: Vec<f64> = log
        .iter()
        .filter(|e| e.entry_type == "breath" && e.attacker == "A" && e.time <= 21.0 + 1e-9)
        .map(|e| e.time)
        .collect();
    assert_eq!(
        burst_ticks.len(),
        40,
        "first Virus Breath burst must exhaust after 20 s of firing (40 ticks): {burst_ticks:?}"
    );
}

#[test]
fn damage_formula_matches_spec() {
    // [REF:ability_virus_breath]
    // Bullet 3: "Breath damage per tick is calculated as
    // (((target max HP * ((attacker effective weight / defender effective
    // weight) + 1)) / 2) / 100) * 0.25 * 1.0 * (1 - breath resistance)."
    let mut attacker = default_combatant();
    attacker.weight = 200.0;
    let mut defender = default_combatant();
    defender.health = 4_000.0;
    defender.weight = 100.0;
    defender.breath_resistance = 0.20;
    let breath = virus_breath_profile();

    let mut chain = 0.0;
    let actual = compute_simple_breath_damage_with_actor_and_target_statuses(
        &attacker, &defender, &breath, &mut chain,
        &BTreeMap::new(), &BTreeMap::new(),
    );
    let weight_ratio = attacker.weight / defender.weight;
    let base = (defender.health * (1.0 + weight_ratio)) / 2.0 / 100.0;
    let expected = base * 0.25 * 1.0 * (1.0 - defender.breath_resistance);
    assert!(
        (actual - expected).abs() < 1e-9,
        "Virus Breath per-tick damage mismatch: expected {expected}, got {actual}"
    );
}

#[test]
fn listed_secondary_is_bleed_at_zero_point_seven_five_per_tick() {
    // [REF:ability_virus_breath]
    // Bullet 5 + Notes 2: "Its listed secondary effect is Bleed at
    // 75% chance for 1 stack." + "Its Bleed application uses
    // pseudo-procs, so 1 stack at 75% chance becomes 0.75 expected
    // stacks per tick."
    let breath = virus_breath_profile();
    assert_eq!(breath.special_statuses.len(), 1);
    let s = &breath.special_statuses[0];
    assert_eq!(s.status_id, "Bleed_Status");
    assert!(
        (s.stacks - 0.75).abs() < 1e-12,
        "expected 0.75 expected Bleed stacks per tick, got {}",
        s.stacks
    );

    // Sanity: Bleed DoT must actually fire while Virus Breath is
    // burning, proving the special_statuses payload reaches the
    // defender via the breath path.
    let attacker = passive_combatant(1_000.0);
    let defender = passive_combatant(10_000_000.0);
    let result = simulate_composable_matchup_with_trace(
        &attacker, &defender, Some(&breath), None,
        SimpleAbilityTimingMode::Fast,
        &ComposableAbilityConfig::default(),
        21.0, true,
    );
    let log = result.combat_log.expect("trace log");
    let bleed_dots = log
        .iter()
        .filter(|e| {
            e.entry_type == "dot"
                && e.status_id.as_deref() == Some("Bleed_Status")
                && e.attacker == "A"
        })
        .count();
    assert!(
        bleed_dots >= 1,
        "Virus Breath must produce Bleed DoT ticks during a 20 s burst: got {bleed_dots}"
    );
}

#[test]
fn pseudo_crit_multiplier_is_one_point_zero() {
    // [REF:ability_virus_breath]
    // Notes 1: "Virus Breath has 0% crit, so its pseudo-crit
    // multiplier is 1.0x."
    // Verify by reading the per-tick damage with crit_chance_pct = 0
    // and confirming it equals base × 0.25 × 1.0 × (1-res) - the
    // formula has no extra crit factor when chance is 0.
    let mut attacker = default_combatant();
    attacker.weight = 100.0;
    let mut defender = default_combatant();
    defender.health = 4_000.0;
    defender.weight = 100.0;
    let breath = virus_breath_profile();
    assert!(
        breath.crit_chance_pct.abs() < 1e-12,
        "Virus Breath profile must carry 0% crit per spec: got {}",
        breath.crit_chance_pct
    );

    let mut chain = 0.0;
    let actual = compute_simple_breath_damage_with_actor_and_target_statuses(
        &attacker, &defender, &breath, &mut chain,
        &BTreeMap::new(), &BTreeMap::new(),
    );
    let base = (defender.health * 2.0) / 2.0 / 100.0;
    let expected = base * 0.25 * 1.0;
    assert!(
        (actual - expected).abs() < 1e-9,
        "0% crit must yield 1.0x multiplier (no crit boost): expected {expected}, got {actual}"
    );
}
