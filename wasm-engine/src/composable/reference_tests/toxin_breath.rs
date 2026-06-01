//! Reference: ability_toxin_breath
//!
//! Covers each testable bullet in the "Toxin Breath" entry. Each test
//! body starts with the [REF:ability_toxin_breath] marker so the
//! vitest coverage gate (src/pages/referenceCoverage.test.ts) sees it.
//!
//! Source of truth for breath stats: data/breath_specs.runtime.json:314-326
//! (id="Toxin_Breath", capacity 15, regen 2.5, crit 5%, dps 0.5,
//! perHit "0.25% PER HIT", secondary Poison probability=75% stacks=0.75).
//! TS bridge `getRustBreathSpecialStatuses` (rustBestBuildsRuntime.ts:584)
//! collapses the pseudo-proc to 0.5625 expected stacks per tick.

use super::super::config::ComposableAbilityConfig;
use super::super::simulate_composable_matchup_with_trace;
use super::{applied_status, default_breath, default_combatant};
use crate::combat::compute_simple_breath_damage_with_actor_and_target_statuses;
use crate::contracts::{SimpleAbilityTimingMode, SimpleBreathProfile, SimpleCombatantStats};
use std::collections::BTreeMap;

fn toxin_breath_profile() -> SimpleBreathProfile {
    let mut breath = default_breath();
    // Spec dps 0.5 → engine multiplies by 0.5 internally to get 0.25 per
    // tick. crit 5% → ×1.05 pseudo-crit. Poison 75% × 0.75 stacks
    // collapses to 0.5625 expected stacks per tick.
    breath.dps_pct = 0.5;
    breath.capacity = 15.0;
    breath.regen_rate = 2.5;
    breath.crit_chance_pct = 5.0;
    breath.special_statuses = vec![applied_status("Poison_Status", 0.5625)];
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
    // [REF:ability_toxin_breath]
    // Bullet 1: "Toxin Breath deals damage 2 times per second while it
    // is firing."
    // Engine: per-tick cadence 0.5 s. With capacity 15, expect 30 ticks
    // before exhaustion.
    let attacker = passive_combatant(1_000.0);
    let defender = passive_combatant(10_000_000.0);
    let breath = toxin_breath_profile();
    let result = simulate_composable_matchup_with_trace(
        &attacker, &defender, Some(&breath), None,
        SimpleAbilityTimingMode::Fast,
        &ComposableAbilityConfig::default(),
        16.0, true,
    );
    let log = result.combat_log.expect("trace log");
    let breath_ticks: Vec<f64> = log
        .iter()
        .filter(|e| e.entry_type == "breath" && e.attacker == "A")
        .map(|e| e.time)
        .collect();
    assert_eq!(
        breath_ticks.len(),
        30,
        "expected 30 breath ticks (15 s capacity × 2/s) before exhaustion: {breath_ticks:?}"
    );
}

#[test]
fn capacity_is_fifteen_seconds_of_firing() {
    // [REF:ability_toxin_breath]
    // Bullet 2: "Toxin Breath has capacity 15."
    // Engine: capacity drains at 1 unit per second of firing → 15 s of
    // continuous firing before exhaustion.
    let attacker = passive_combatant(1_000.0);
    let defender = passive_combatant(10_000_000.0);
    let breath = toxin_breath_profile();
    let result = simulate_composable_matchup_with_trace(
        &attacker, &defender, Some(&breath), None,
        SimpleAbilityTimingMode::Fast,
        &ComposableAbilityConfig::default(),
        17.0, true,
    );
    let log = result.combat_log.expect("trace log");
    let burst_ticks: Vec<f64> = log
        .iter()
        .filter(|e| e.entry_type == "breath" && e.attacker == "A" && e.time <= 16.0 + 1e-9)
        .map(|e| e.time)
        .collect();
    assert_eq!(
        burst_ticks.len(),
        30,
        "first Toxin Breath burst must exhaust after 15 s of firing (30 ticks): {burst_ticks:?}"
    );
}

#[test]
fn damage_formula_matches_spec() {
    // [REF:ability_toxin_breath]
    // Bullet 3: "Breath damage per tick is calculated as
    // (((target max HP * ((attacker effective weight / defender effective
    // weight) + 1)) / 2) / 100) * 0.25 * 1.05 * (1 - breath resistance)."
    let mut attacker = default_combatant();
    attacker.weight = 200.0;
    let mut defender = default_combatant();
    defender.health = 4_000.0;
    defender.weight = 100.0;
    defender.breath_resistance = 0.20;
    let breath = toxin_breath_profile();

    let mut chain = 0.0;
    let actual = compute_simple_breath_damage_with_actor_and_target_statuses(
        &attacker, &defender, &breath, &mut chain,
        &BTreeMap::new(), &BTreeMap::new(),
    );
    let weight_ratio = attacker.weight / defender.weight;
    let base = (defender.health * (1.0 + weight_ratio)) / 2.0 / 100.0;
    let expected = base * 0.25 * 1.025 * (1.0 - defender.breath_resistance);
    assert!(
        (actual - expected).abs() < 1e-9,
        "Toxin Breath per-tick damage mismatch: expected {expected}, got {actual}"
    );
}

#[test]
fn listed_secondary_is_poison_at_zero_point_five_six_two_five_per_tick() {
    // [REF:ability_toxin_breath]
    // Bullet 5 + Notes 2: "Its listed secondary effect is Poison at
    // 75% chance for 0.75 stacks." + "Its Poison application uses
    // pseudo-procs, so 0.75 stacks at 75% chance becomes 0.5625
    // expected stacks per tick."
    // The TS bridge collapses probability × stacks into a single
    // deterministic apply per tick. Verify (a) the breath profile
    // carries Poison_Status × 0.5625 and (b) Poison DoT actually
    // lands on the defender during a sustained burn.
    let breath = toxin_breath_profile();
    assert_eq!(breath.special_statuses.len(), 1);
    let s = &breath.special_statuses[0];
    assert_eq!(s.status_id, "Poison_Status");
    assert!(
        (s.stacks - 0.5625).abs() < 1e-12,
        "expected 0.5625 expected Poison stacks per tick, got {}",
        s.stacks
    );

    // Sanity: Poison DoT must actually fire while Toxin Breath is
    // burning, proving the special_statuses payload reaches the
    // defender via the breath path.
    let attacker = passive_combatant(1_000.0);
    let defender = passive_combatant(10_000_000.0);
    let result = simulate_composable_matchup_with_trace(
        &attacker, &defender, Some(&breath), None,
        SimpleAbilityTimingMode::Fast,
        &ComposableAbilityConfig::default(),
        16.0, true,
    );
    let log = result.combat_log.expect("trace log");
    let poison_dots = log
        .iter()
        .filter(|e| {
            e.entry_type == "dot"
                && e.status_id.as_deref() == Some("Poison_Status")
                && e.attacker == "A"
        })
        .count();
    assert!(
        poison_dots >= 1,
        "Toxin Breath must produce Poison DoT ticks during a 15 s burst: got {poison_dots}"
    );
}

#[test]
fn pseudo_crit_multiplier_is_one_point_zero_two_five() {
    // [REF:ability_toxin_breath]
    // Notes 1: "Toxin Breath uses a 5% pseudo-crit, so its crit
    // multiplier is 1.025x instead of random crit rolls."
    // Verify by comparing Toxin's per-tick damage to a 0%-crit clone:
    // ratio must be exactly 1.025 (5% chance × 1.5× crit = 1 + 0.05×0.5).
    let mut attacker = default_combatant();
    attacker.weight = 100.0;
    let mut defender = default_combatant();
    defender.health = 4_000.0;
    defender.weight = 100.0;
    let crit = toxin_breath_profile();
    let mut no_crit = toxin_breath_profile();
    no_crit.crit_chance_pct = 0.0;

    let mut chain_a = 0.0;
    let mut chain_b = 0.0;
    let crit_dmg = compute_simple_breath_damage_with_actor_and_target_statuses(
        &attacker, &defender, &crit, &mut chain_a,
        &BTreeMap::new(), &BTreeMap::new(),
    );
    let no_crit_dmg = compute_simple_breath_damage_with_actor_and_target_statuses(
        &attacker, &defender, &no_crit, &mut chain_b,
        &BTreeMap::new(), &BTreeMap::new(),
    );
    let ratio = crit_dmg / no_crit_dmg;
    assert!(
        (ratio - 1.025).abs() < 1e-9,
        "5% pseudo-crit at 1.5× must multiply per-tick damage by exactly 1.025: got ratio {ratio}"
    );
}
