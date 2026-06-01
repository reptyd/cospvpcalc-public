//! Reference: ability_frost_nova
//!
//! Covers each testable bullet in the "Frost Nova" entry. Each test
//! body starts with the [REF:ability_frost_nova] marker so the vitest
//! coverage gate (src/pages/referenceCoverage.test.ts) sees it.

use super::super::config::ComposableAbilityConfig;
use super::super::simulate_composable_matchup_with_trace;
use super::default_combatant;
use crate::contracts::{SimpleAbilityTimingMode, SimpleCombatantStats};

fn frost_nova_attacker_config() -> ComposableAbilityConfig {
    let mut cfg = ComposableAbilityConfig::default();
    cfg.attacker_frost_nova = true;
    cfg
}

fn passive_combatant(max_hp: f64) -> SimpleCombatantStats {
    let mut c = default_combatant();
    c.health = max_hp;
    c.damage = 0.0;
    c.bite_cooldown = 1000.0;
    c
}

fn frost_nova_activation_times(
    cfg: &ComposableAbilityConfig,
    max_time_sec: f64,
) -> Vec<f64> {
    // Slow biter on each side keeps the loop alive past the Frost Nova
    // active duration so the second activation at t=60 actually fires.
    let mut attacker = passive_combatant(1_000.0);
    attacker.damage = 1.0;
    attacker.bite_cooldown = 5.0;
    let defender = passive_combatant(10_000_000.0);
    let result = simulate_composable_matchup_with_trace(
        &attacker, &defender, None, None,
        SimpleAbilityTimingMode::Fast,
        cfg, max_time_sec, true,
    );
    let log = result.combat_log.expect("trace log requested");
    log.iter()
        .filter(|e| {
            e.entry_type == "ability"
                && e.attacker == "A"
                && e.description.as_deref() == Some("Frost Nova activated")
        })
        .map(|e| e.time)
        .collect()
}

#[test]
fn applies_frostbite_to_opponent_during_active_window() {
    // [REF:ability_frost_nova]
    // Frost Nova activates at t=0. Within the 15 s active window,
    // Frostbite_Status must accumulate on the opponent. Exact apply
    // timestamps (t=3, 6, 9, 12, 15) and per-tick stack count (3) are
    // verified by source inspection of composable/mod.rs:3440-3502.
    let mut attacker = passive_combatant(1_000.0);
    attacker.damage = 1.0;
    attacker.bite_cooldown = 5.0;
    let defender = passive_combatant(10_000_000.0);
    let result = simulate_composable_matchup_with_trace(
        &attacker,
        &defender,
        None,
        None,
        SimpleAbilityTimingMode::Fast,
        &frost_nova_attacker_config(),
        16.0,
        true,
    );
    let log = result.combat_log.expect("trace log");
    let frostbite_present = log
        .iter()
        .any(|e| e.status_id.as_deref() == Some("Frostbite_Status"));
    assert!(
        frostbite_present,
        "Frost Nova must apply Frostbite_Status during the 15 s active window"
    );
}

#[test]
fn cooldown_sixty_seconds() {
    // [REF:ability_frost_nova]
    let activations = frost_nova_activation_times(&frost_nova_attacker_config(), 200.0);
    assert!(
        activations.len() >= 2,
        "Frost Nova must fire at least twice in a 200 s window: {activations:?}"
    );
    let gap = activations[1] - activations[0];
    assert!(
        (gap - 60.0).abs() < 1e-6,
        "second Frost Nova activation must be 60 s after the first, got {gap}: {activations:?}"
    );
}

#[test]
fn does_not_deal_direct_damage_at_activation() {
    // [REF:ability_frost_nova]
    // At activation (t=0), no damage event with attacker=A and t=0.
    // Frost Nova is a status-only ability — damage comes via Frostbite
    // DOT ticks, not from the activation itself.
    let attacker = passive_combatant(1_000.0);
    let defender = passive_combatant(10_000.0);
    let cfg = frost_nova_attacker_config();
    let result = simulate_composable_matchup_with_trace(
        &attacker,
        &defender,
        None,
        None,
        SimpleAbilityTimingMode::Fast,
        &cfg,
        0.5,
        true,
    );
    // Defender must still be at full HP at t=0.5 — only the activation
    // event has fired, no DOT or bite has run yet.
    assert!(
        (result.final_hp_b - defender.health).abs() < 1e-6,
        "Frost Nova must not deal direct damage at activation: defender HP {} → {}",
        defender.health,
        result.final_hp_b
    );
}
