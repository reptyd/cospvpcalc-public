//! Reference: ability_harden
//!
//! Covers each testable bullet in the "Harden" entry. Each test body
//! starts with the [REF:ability_harden] marker so the vitest coverage
//! gate (src/pages/referenceCoverage.test.ts) sees it.
//!
//! The engine timer assignment lives in `composable/mod.rs:1965-1981`
//! (Phase 3b2). The 1.25x regen multiplier composition is in
//! `combat::effective_hp_regen_multiplier_with_actives`. The 1.35x
//! weight factor is in `active_runtime::with_active_weight_bonuses`.

use super::super::config::ComposableAbilityConfig;
use super::super::{simulate_composable_matchup, simulate_composable_matchup_with_trace};
use super::{applied_status, default_combatant};
use crate::active_runtime::with_active_weight_bonuses;
use crate::contracts::{SimpleAbilityTimingMode, SimpleCombatantStats};

fn harden_attacker_config() -> ComposableAbilityConfig {
    let mut cfg = ComposableAbilityConfig::default();
    cfg.attacker_harden = true;
    cfg
}

fn passive_combatant(max_hp: f64) -> SimpleCombatantStats {
    let mut c = default_combatant();
    c.health = max_hp;
    c.damage = 0.0;
    c.bite_cooldown = 1000.0;
    c
}

fn harden_activation_times(
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
                && e.description.as_deref() == Some("Harden activated")
        })
        .map(|e| e.time)
        .collect()
}

#[test]
fn lasts_thirty_seconds_during_active_window() {
    // [REF:ability_harden]
    // Bullet 1: "Harden lasts for 30 seconds."
    // Engine assigns `harden_active_until = activation_time + 30.0`
    // (composable/mod.rs:1970). The active-state effects from
    // `with_active_weight_bonuses` apply while time < harden_active_until
    // and disappear at the boundary, so the duration claim is observable
    // by sweeping `time` across t=30 with a fixed `harden_active_until`.
    let attacker = passive_combatant(1_000.0);
    let original_weight = attacker.weight;
    let harden_active_until = 30.0;

    let inside = with_active_weight_bonuses(&attacker, 0.0, harden_active_until, 0.0, 29.999);
    let boundary = with_active_weight_bonuses(&attacker, 0.0, harden_active_until, 0.0, 30.0);
    let after = with_active_weight_bonuses(&attacker, 0.0, harden_active_until, 0.0, 30.001);

    assert!(
        (inside.weight - original_weight * 1.35).abs() < 1e-9,
        "Harden weight bonus must apply just before the 30 s boundary: expected {}, got {}",
        original_weight * 1.35,
        inside.weight,
    );
    assert!(
        (boundary.weight - original_weight).abs() < 1e-9,
        "Harden weight bonus must clear at the 30 s boundary: expected {original_weight}, got {}",
        boundary.weight,
    );
    assert!(
        (after.weight - original_weight).abs() < 1e-9,
        "Harden weight bonus must remain cleared past the 30 s boundary: expected {original_weight}, got {}",
        after.weight,
    );
}

#[test]
fn cooldown_one_hundred_twenty_seconds() {
    // [REF:ability_harden]
    // Bullet 2: "Its base cooldown is 120 seconds."
    // First activation lands at t=0 (ReallyFast policy fires Harden as
    // soon as it is available); the cooldown gate in
    // composable/mod.rs:1967 blocks the next activation until
    // t = first + 120 s. A slow biter keeps the event loop alive past
    // the cooldown boundary so the second firing is reachable.
    let attacker = passive_combatant(1_000_000.0);
    let mut defender = passive_combatant(1_000_000.0);
    defender.damage = 1.0;
    defender.bite_cooldown = 5.0;

    let activations = harden_activation_times(&attacker, &defender, &harden_attacker_config(), 200.0);
    assert!(
        activations.len() >= 2,
        "Harden must fire at least twice in a 200 s window: {activations:?}"
    );
    let gap = activations[1] - activations[0];
    assert!(
        (gap - 120.0).abs() < 1.0,
        "second Harden activation must land ~120 s after the first, got {gap}: {activations:?}"
    );
}

#[test]
fn weight_bonus_is_thirty_five_percent_during_active_window() {
    // [REF:ability_harden]
    // Bullet 3: "While Harden is active, the user's effective combat
    // weight is multiplied by 1.35x."
    // active_runtime::with_active_weight_bonuses applies the 1.35
    // multiplier while time < harden_active_until.
    let attacker = passive_combatant(1_000.0);
    let original_weight = attacker.weight;
    let harden_active_until = 100.0;

    let inside = with_active_weight_bonuses(&attacker, 0.0, harden_active_until, 0.0, 0.0);
    let outside = with_active_weight_bonuses(&attacker, 0.0, harden_active_until, 0.0, 100.0);

    assert!(
        (inside.weight - original_weight * 1.35).abs() < 1e-9,
        "Harden weight bonus must be 35% during the active window: expected {}, got {}",
        original_weight * 1.35,
        inside.weight,
    );
    assert!(
        (outside.weight - original_weight).abs() < 1e-9,
        "Harden weight bonus must clear once the active window ends: expected {original_weight}, got {}",
        outside.weight,
    );
}

#[test]
fn active_window_multiplies_passive_regen_by_one_point_two_five() {
    // [REF:ability_harden]
    // Bullet 4: "While Harden is active, passive health regeneration
    // is multiplied by 1.25x."
    // Pin HP at the t=15 regen tick to be identical across both runs.
    // Damage source is starting Poison_Status (weight-independent and
    // does not modify regen multiplier; Bleed_Status is unsuitable
    // because it disables regen entirely per
    // hp_regen_multiplier_from_statuses). Both sides have 0 melee
    // damage and very long bite cooldowns, so Harden's weight bonus
    // does not change incoming damage. With 20 Poison stacks the
    // attacker has taken enough damage by t=15 that the regen heal
    // does not cap at max HP in either run, isolating the 1.25x
    // multiplier. Mirrors the regression test
    // composable::tests::harden_active_window_multiplies_passive_regen_by_one_point_two_five.
    let mut attacker = passive_combatant(10_000.0);
    attacker.health_regen = 2.0;
    attacker.starting_statuses = vec![applied_status("Poison_Status", 20.0)];
    let defender = passive_combatant(10_000.0);

    let baseline_config = ComposableAbilityConfig::default();
    let baseline = simulate_composable_matchup(
        &attacker,
        &defender,
        None,
        None,
        SimpleAbilityTimingMode::SemiIdeal,
        &baseline_config,
        16.0,
    );

    let harden_config = harden_attacker_config();
    let harden = simulate_composable_matchup(
        &attacker,
        &defender,
        None,
        None,
        SimpleAbilityTimingMode::SemiIdeal,
        &harden_config,
        16.0,
    );

    assert!(
        baseline.regen_healed_a > 0.0,
        "baseline must have non-zero regen heal to compare a ratio (got {})",
        baseline.regen_healed_a,
    );
    let ratio = harden.regen_healed_a / baseline.regen_healed_a;
    assert!(
        (ratio - 1.25).abs() < 1e-6,
        "harden/baseline regen ratio = {} (harden={}, baseline={}); expected 1.25",
        ratio,
        harden.regen_healed_a,
        baseline.regen_healed_a,
    );
}
