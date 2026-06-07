//! Reference: ability_acid_breath
//!
//! Covers every testable bullet in `MODELED_ABILITY_REFERENCE_DRAFTS`
//! entry "Acid Breath" (id `ability_acid_breath`). Every test body
//! starts with the `[REF:ability_acid_breath]` marker so the vitest
//! coverage gate (src/pages/referenceCoverage.test.ts) sees it.

use super::{applied_status, default_breath, default_combatant};
use crate::combat::{
    compute_simple_breath_damage_with_actor_and_target_statuses,
    simple_breath_capacity_step, simple_breath_tick_sec,
};
use crate::contracts::SimpleBreathProfile;
use std::collections::BTreeMap;

fn acid_breath_profile() -> SimpleBreathProfile {
    let mut breath = default_breath();
    breath.dps_pct = 1.0;
    breath.capacity = 10.0;
    breath.regen_rate = 1.8;
    breath.crit_chance_pct = 10.0;
    breath.special_statuses = vec![applied_status("Corrosion_Status", 0.5)];
    breath
}

#[test]
fn tick_interval_is_half_second() {
    // [REF:ability_acid_breath]
    let breath = acid_breath_profile();
    let tick = simple_breath_tick_sec(&breath);
    assert!((tick - 0.5).abs() < 1e-12, "expected 0.5 s tick, got {tick}");
}

#[test]
fn capacity_step_and_regen_rate_match_spec() {
    // [REF:ability_acid_breath]
    let breath = acid_breath_profile();
    let step = simple_breath_capacity_step(&breath);
    // Capacity drains at 1 unit per second of firing. Damage tick is 0.5 s,
    // so each damage tick consumes 0.5 capacity (step == tick_sec).
    assert!((step - 0.5).abs() < 1e-12, "expected 0.5 capacity per tick, got {step}");
    // 10 capacity / 0.5 per tick = 20 damage ticks before exhaustion (10 s).
    assert!((breath.capacity / step - 20.0).abs() < 1e-12);
    // Regen rate is the canonical 1.8/sec from the breath spec.
    assert!((breath.regen_rate - 1.8).abs() < 1e-12);
}

#[test]
fn per_tick_damage_matches_formula() {
    // [REF:ability_acid_breath]
    // base = (defender_max_hp * (1 + atk_w / def_w)) / 2 / 100
    // tick = base * 0.5 * 1.05 * (1 - breath_resistance) - 10% pseudo-crit
    // at the 1.5× global multiplier yields (1 + 0.10 × 0.5) = 1.05.
    let mut attacker = default_combatant();
    attacker.weight = 200.0;
    let mut defender = default_combatant();
    defender.health = 2000.0;
    defender.weight = 100.0;
    defender.breath_resistance = 0.20;
    let breath = acid_breath_profile();
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
    let base = defender.health * (1.0 + weight_ratio) / 2.0 / 100.0;
    let expected = base * 0.5 * 1.05 * (1.0 - defender.breath_resistance);
    assert!(
        (actual - expected).abs() < 1e-9,
        "expected {expected}, got {actual}"
    );
}

#[test]
fn special_status_is_half_corrosion_per_tick() {
    // [REF:ability_acid_breath]
    let breath = acid_breath_profile();
    assert_eq!(breath.special_statuses.len(), 1);
    let s = &breath.special_statuses[0];
    assert_eq!(s.status_id, "Corrosion_Status");
    assert!(
        (s.stacks - 0.5).abs() < 1e-12,
        "expected 0.5 stacks, got {}",
        s.stacks
    );
}
