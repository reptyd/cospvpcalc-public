//! Reference: ability_guilt
//!
//! Covers each testable bullet in the "Guilt" entry. Each test body
//! starts with the [REF:ability_guilt] marker so the vitest coverage
//! gate (src/pages/referenceCoverage.test.ts) sees it.
//!
//! Engine wiring: Guilt is a passive all-damage reducer (game
//! `Guilt.OnDamage -> x0.5` fires on every direct damage type). The TS data
//! layer defines `Guilt: { type: damageTakenMultiplier, multiplier: 0.5 }`;
//! `rustBestBuildsRuntime.ts` folds it into BOTH the bite channel
//! (`damageTakenMultiplierOnBeingBitten`) and the breath channel
//! (`damageTakenMultiplierOnBreath`). The bite path applies its field inside
//! `combat::compute_melee_damage_per_hit*`; the breath path applies its field
//! inside `combat::compute_simple_breath_damage_with_actor_and_target_statuses`.

use super::super::config::ComposableAbilityConfig;
use super::super::simulate_composable_matchup_with_trace;
use super::{default_breath, default_combatant};
use crate::combat::{
    compute_melee_damage_per_hit_with_actor_and_target_statuses,
    compute_simple_breath_damage_with_actor_and_target_statuses,
};
use crate::contracts::{SimpleAbilityTimingMode, SimpleBreathProfile, SimpleCombatantStats};
use crate::spec_constants::GUILT_INCOMING_DAMAGE_REDUCTION_PCT;
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
    // Bullet 1: "Guilt reduces incoming damage by 50%." (bite channel)
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
    let expected_ratio = 1.0 - GUILT_INCOMING_DAMAGE_REDUCTION_PCT / 100.0;
    assert!(
        (ratio - expected_ratio).abs() < 1e-9,
        "Guilt must reduce bite damage by {GUILT_INCOMING_DAMAGE_REDUCTION_PCT}% (ratio {expected_ratio}): ratio={ratio} (guilt={guilt_damage}, baseline={baseline_damage})"
    );
}

#[test]
fn reduces_incoming_breath_damage_by_fifty_percent() {
    // [REF:ability_guilt]
    // Bullet 2: "The reduction covers direct bite damage and direct breath
    // damage alike." The breath path `compute_simple_breath_damage_*` now
    // consults `damage_taken_multiplier_on_breath`; per-tick damage must scale
    // by 0.5 when the defender holds Guilt.
    let mut attacker = default_combatant();
    attacker.weight = 200.0;
    let mut baseline_defender = default_combatant();
    baseline_defender.weight = 100.0;
    baseline_defender.damage_taken_multiplier_on_breath = 1.0;
    let mut guilt_defender = default_combatant();
    guilt_defender.weight = 100.0;
    guilt_defender.damage_taken_multiplier_on_breath = 0.5;

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
    let ratio = with_guilt / baseline;
    let expected_ratio = 1.0 - GUILT_INCOMING_DAMAGE_REDUCTION_PCT / 100.0;
    assert!(
        (ratio - expected_ratio).abs() < 1e-9,
        "Guilt must reduce breath damage by {GUILT_INCOMING_DAMAGE_REDUCTION_PCT}% (ratio {expected_ratio}): ratio={ratio} (guilt={with_guilt}, baseline={baseline})"
    );

    // End-to-end check: breath damage dealt through the live composable engine
    // is halved when the defender holds Guilt (the breath path multiplies by
    // `damage_taken_multiplier_on_breath`).
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
    assert!(baseline_run.damage_dealt_a > 0.0, "baseline breath run must deal damage");
    let run_ratio = guilt_run.damage_dealt_a / baseline_run.damage_dealt_a;
    assert!(
        (run_ratio - expected_ratio).abs() < 1e-6,
        "Guilt must halve breath damage in the live engine: baseline={}, guilt={}, ratio={run_ratio}",
        baseline_run.damage_dealt_a,
        guilt_run.damage_dealt_a,
    );
}
