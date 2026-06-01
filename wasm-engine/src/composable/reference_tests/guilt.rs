//! Reference: ability_guilt
//!
//! Covers each testable bullet in the "Guilt" entry. Each test body
//! starts with the [REF:ability_guilt] marker so the vitest coverage
//! gate (src/pages/referenceCoverage.test.ts) sees it.
//!
//! Engine wiring: Guilt is a passive damageTakenMultiplier ability. The
//! TS data layer (data/special_abilities.runtime.json:77-81) defines
//! `Guilt: { type: damageTakenMultiplier, when: onBeingBitten,
//! multiplier: 0.5 }`. `rustBestBuildsRuntime.ts:373-385` folds Guilt's
//! 0.5 multiplier into the `damageTakenMultiplierOnBeingBitten` field
//! sent to Rust, which then applies it inside
//! `combat::compute_melee_damage_per_hit*`. Breath damage paths
//! (`combat::compute_simple_breath_damage_with_actor_and_target_statuses`)
//! intentionally do not consume the same field.

use super::super::config::ComposableAbilityConfig;
use super::super::simulate_composable_matchup_with_trace;
use super::{default_breath, default_combatant};
use crate::combat::{
    compute_melee_damage_per_hit_with_actor_and_target_statuses,
    compute_simple_breath_damage_with_actor_and_target_statuses,
};
use crate::contracts::{SimpleAbilityTimingMode, SimpleBreathProfile, SimpleCombatantStats};
use std::collections::BTreeMap;

fn passive_combatant(max_hp: f64) -> SimpleCombatantStats {
    let mut c = default_combatant();
    c.health = max_hp;
    c.damage = 0.0;
    c.bite_cooldown = 1000.0;
    c
}

fn haunt_like_breath_profile() -> SimpleBreathProfile {
    let mut breath = default_breath();
    breath.dps_pct = 1.0;
    breath.capacity = 5.0;
    breath.regen_rate = 1.0;
    breath.crit_chance_pct = 0.0;
    breath
}

#[test]
fn reduces_incoming_bite_damage_by_fifty_percent() {
    // [REF:ability_guilt]
    // Bullet 1: "Guilt reduces incoming bite damage by 50%."
    // The defender holds Guilt, so its
    // `damage_taken_multiplier_on_being_bitten` is 0.5. Per-bite damage
    // from `compute_melee_damage_per_hit` must scale by 0.5 vs the same
    // matchup with no Guilt (multiplier = 1.0).
    let attacker = {
        let mut c = default_combatant();
        c.damage = 100.0;
        c
    };
    let mut baseline_defender = default_combatant();
    baseline_defender.damage_taken_multiplier_on_being_bitten = 1.0;
    let mut guilt_defender = default_combatant();
    guilt_defender.damage_taken_multiplier_on_being_bitten = 0.5;

    let baseline_damage = compute_melee_damage_per_hit_with_actor_and_target_statuses(
        &attacker,
        &baseline_defender,
        attacker.health,
        &BTreeMap::new(),
        &BTreeMap::new(),
    );
    let guilt_damage = compute_melee_damage_per_hit_with_actor_and_target_statuses(
        &attacker,
        &guilt_defender,
        attacker.health,
        &BTreeMap::new(),
        &BTreeMap::new(),
    );
    assert!(baseline_damage > 0.0, "baseline bite damage must be positive");
    let ratio = guilt_damage / baseline_damage;
    assert!(
        (ratio - 0.5).abs() < 1e-9,
        "Guilt must halve bite damage: ratio={ratio} (guilt={guilt_damage}, baseline={baseline_damage})"
    );
}

#[test]
fn does_not_reduce_breath_damage() {
    // [REF:ability_guilt]
    // Bullet 2: "It does not reduce damage from breaths."
    // The breath damage path `compute_simple_breath_damage_*` does not
    // consult `damage_taken_multiplier_on_being_bitten`; per-tick damage
    // must be identical whether the defender has Guilt (0.5) or not.
    let mut attacker = default_combatant();
    attacker.weight = 200.0;
    let mut baseline_defender = default_combatant();
    baseline_defender.weight = 100.0;
    baseline_defender.damage_taken_multiplier_on_being_bitten = 1.0;
    let mut guilt_defender = default_combatant();
    guilt_defender.weight = 100.0;
    guilt_defender.damage_taken_multiplier_on_being_bitten = 0.5;

    let breath = haunt_like_breath_profile();
    let mut chain_baseline = 0.0;
    let mut chain_guilt = 0.0;
    let baseline = compute_simple_breath_damage_with_actor_and_target_statuses(
        &attacker,
        &baseline_defender,
        &breath,
        &mut chain_baseline,
        &BTreeMap::new(),
        &BTreeMap::new(),
    );
    let with_guilt = compute_simple_breath_damage_with_actor_and_target_statuses(
        &attacker,
        &guilt_defender,
        &breath,
        &mut chain_guilt,
        &BTreeMap::new(),
        &BTreeMap::new(),
    );
    assert!(baseline > 0.0, "baseline breath damage must be positive");
    assert!(
        (baseline - with_guilt).abs() < 1e-9,
        "Guilt must not change breath damage: baseline={baseline}, with_guilt={with_guilt}"
    );

    // End-to-end check: damage dealt through the live composable engine
    // is equal whether the defender has Guilt or not (the breath path
    // never multiplies by `damage_taken_multiplier_on_being_bitten`).
    let mut breath_attacker = passive_combatant(1_000.0);
    breath_attacker.weight = 200.0;
    let cfg = ComposableAbilityConfig::default();

    let baseline_run = simulate_composable_matchup_with_trace(
        &breath_attacker,
        &baseline_defender,
        Some(&breath),
        None,
        SimpleAbilityTimingMode::Fast,
        &cfg,
        2.0,
        false,
    );
    let guilt_run = simulate_composable_matchup_with_trace(
        &breath_attacker,
        &guilt_defender,
        Some(&breath),
        None,
        SimpleAbilityTimingMode::Fast,
        &cfg,
        2.0,
        false,
    );
    assert!(
        (baseline_run.damage_dealt_a - guilt_run.damage_dealt_a).abs() < 1e-6,
        "Guilt must not reduce breath damage in the live engine: baseline={}, guilt={}",
        baseline_run.damage_dealt_a,
        guilt_run.damage_dealt_a,
    );
}
