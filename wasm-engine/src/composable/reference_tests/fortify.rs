//! Reference: ability_fortify
//!
//! Covers each testable bullet in the "Fortify" entry. Each test body
//! starts with the [REF:ability_fortify] marker so the vitest coverage
//! gate (src/pages/referenceCoverage.test.ts) sees it.
//!
//! The full removable-status list (Bleed, Burn, Corrosion, …, Radiation)
//! and the policy heuristics (15-stack threshold for ReallyFast, etc.)
//! are exercised by the broader composable::tests::*_fortify_* suite.
//! These tests focus on the core timing and weight-bonus invariants.

use super::super::config::ComposableAbilityConfig;
use super::super::simulate_composable_matchup_with_trace;
use super::default_combatant;
use crate::active_runtime::with_active_weight_bonuses;
use crate::contracts::{SimpleAbilityTimingMode, SimpleAppliedStatus, SimpleCombatantStats};

fn fortify_attacker_config() -> ComposableAbilityConfig {
    let mut cfg = ComposableAbilityConfig::default();
    cfg.attacker_fortify = true;
    cfg
}

fn passive_combatant(max_hp: f64) -> SimpleCombatantStats {
    let mut c = default_combatant();
    c.health = max_hp;
    c.damage = 0.0;
    c.bite_cooldown = 1000.0;
    c
}

fn fortify_activation_times(
    attacker: &SimpleCombatantStats,
    defender: &SimpleCombatantStats,
    cfg: &ComposableAbilityConfig,
    max_time_sec: f64,
) -> Vec<f64> {
    let result = simulate_composable_matchup_with_trace(
        attacker,
        defender,
        None,
        None,
        SimpleAbilityTimingMode::ReallyFast,
        cfg,
        max_time_sec,
        true,
    );
    let log = result.combat_log.expect("trace log requested");
    log.iter()
        .filter(|e| {
            e.entry_type == "ability"
                && e.attacker == "A"
                && e.description.as_deref() == Some("Fortify activated")
        })
        .map(|e| e.time)
        .collect()
}

#[test]
fn fires_at_t_zero_with_severe_starting_status() {
    // [REF:ability_fortify]
    // Attacker carries 20 Bleed stacks (>= 15 ReallyFast threshold).
    // Fortify activates at t=0.
    let mut attacker = passive_combatant(1_000.0);
    attacker.starting_statuses = vec![SimpleAppliedStatus {
        status_id: "Bleed_Status".to_string(),
        stacks: 20.0,
        source_ability: None,
    }];
    let defender = passive_combatant(10_000.0);
    let activations = fortify_activation_times(&attacker, &defender, &fortify_attacker_config(), 1.0);
    let first = *activations
        .first()
        .expect("Fortify must activate at t=0 with 20 starting Bleed stacks");
    assert!(
        first.abs() < 1e-6,
        "first Fortify activation must land at t=0, got {first}"
    );
}

#[test]
fn cooldown_ninety_seconds() {
    // [REF:ability_fortify]
    // Steady damage keeps re-applying Bleed via on-hit; Fortify fires once,
    // cleanses, then the second activation is gated by the 90 s cooldown.
    let mut attacker = passive_combatant(10_000.0);
    attacker.starting_statuses = vec![SimpleAppliedStatus {
        status_id: "Bleed_Status".to_string(),
        stacks: 20.0,
        source_ability: None,
    }];
    let mut defender = passive_combatant(1_000_000.0);
    defender.damage = 1.0;
    defender.bite_cooldown = 0.5;
    defender.on_hit_statuses = vec![SimpleAppliedStatus {
        status_id: "Bleed_Status".to_string(),
        stacks: 1.0,
        source_ability: None,
    }];
    let activations = fortify_activation_times(&attacker, &defender, &fortify_attacker_config(), 200.0);
    assert!(
        activations.len() >= 2,
        "Fortify must fire at least twice in a 200 s window: {activations:?}"
    );
    let gap = activations[1] - activations[0];
    assert!(
        (gap - 90.0).abs() < 1.0,
        "second Fortify activation must be ~90 s after the first, got {gap}: {activations:?}"
    );
}

#[test]
fn weight_bonus_is_five_percent_during_immunity_window() {
    // [REF:ability_fortify]
    // active_runtime::with_active_weight_bonuses returns the stats with
    // weight × 1.05 while time < fortify_weight_bonus_until.
    let attacker = passive_combatant(1_000.0);
    let original_weight = attacker.weight;
    let fortify_weight_bonus_until = 9.0;
    let inside = with_active_weight_bonuses(&attacker, fortify_weight_bonus_until, 0.0, 0.0, 0.0);
    let outside = with_active_weight_bonuses(&attacker, fortify_weight_bonus_until, 0.0, 0.0, 10.0);
    assert!(
        (inside.weight - original_weight * 1.05).abs() < 1e-9,
        "Fortify weight bonus must be 5% during immunity window: expected {}, got {}",
        original_weight * 1.05,
        inside.weight
    );
    assert!(
        (outside.weight - original_weight).abs() < 1e-9,
        "Fortify weight bonus must clear after the 9 s window: expected {original_weight}, got {}",
        outside.weight
    );
}
