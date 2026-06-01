//! Reference: ability_cursed_sigil
//!
//! Covers each testable bullet in the "Cursed Sigil" entry. Each test
//! body starts with the [REF:ability_cursed_sigil] marker so the vitest
//! coverage gate (src/pages/referenceCoverage.test.ts) sees it.

use super::super::config::ComposableAbilityConfig;
use super::super::simulate_composable_matchup_with_trace;
use super::default_combatant;
use crate::contracts::{SimpleAbilityTimingMode, SimpleCombatantStats};

const SIGIL_STACKS: f64 = 5.0;

fn cursed_sigil_attacker_config() -> ComposableAbilityConfig {
    let mut cfg = ComposableAbilityConfig::default();
    cfg.attacker_cursed_sigil_stacks = SIGIL_STACKS;
    cfg
}

fn passive_combatant(max_hp: f64) -> SimpleCombatantStats {
    let mut c = default_combatant();
    c.health = max_hp;
    c.damage = 1.0;
    c.bite_cooldown = 5.0; // small bite to keep the loop progressing.
    c
}

fn cursed_sigil_activation_times(
    cfg: &ComposableAbilityConfig,
    policy: SimpleAbilityTimingMode,
    max_time_sec: f64,
) -> Vec<f64> {
    let attacker = passive_combatant(1_000.0);
    let defender = passive_combatant(10_000_000.0);
    let result = simulate_composable_matchup_with_trace(
        &attacker, &defender, None, None, policy, cfg, max_time_sec, true,
    );
    let log = result.combat_log.expect("trace log requested");
    log.iter()
        .filter(|e| {
            e.entry_type == "ability"
                && e.attacker == "A"
                && e.description.as_deref() == Some("Cursed Sigil activated")
        })
        .map(|e| e.time)
        .collect()
}

#[test]
fn fires_immediately_when_config_carries_stacks() {
    // [REF:ability_cursed_sigil]
    // The "applies Bad Omen immediately" and "stacks based on creature's
    // Cursed Sigil value" claims are verified by source inspection of
    // composable/mod.rs:2886-2901: the activation block applies
    // Bad_Omen_Status with stacks = config.attacker_cursed_sigil_stacks
    // unconditionally at activation time. The runtime test below
    // verifies the activation event fires at t=0 when the config field
    // carries a non-zero value.
    let times = cursed_sigil_activation_times(
        &cursed_sigil_attacker_config(),
        SimpleAbilityTimingMode::Fast,
        1.0,
    );
    let first = *times.first().expect("Cursed Sigil must activate when stacks > 0");
    assert!(
        first.abs() < 1e-6,
        "first Cursed Sigil activation must land at t=0, got {first}"
    );
}

#[test]
fn cooldown_eighty_five_seconds() {
    // [REF:ability_cursed_sigil]
    let times = cursed_sigil_activation_times(
        &cursed_sigil_attacker_config(),
        SimpleAbilityTimingMode::Fast,
        200.0,
    );
    assert!(
        times.len() >= 2,
        "Cursed Sigil must fire at least twice in a 200 s window: {times:?}"
    );
    let gap = times[1] - times[0];
    assert!(
        (gap - 85.0).abs() < 1e-6,
        "second Cursed Sigil activation must be 85 s after the first, got {gap}: {times:?}"
    );
}

#[test]
fn activates_immediately_under_all_policies() {
    // [REF:ability_cursed_sigil]
    let cfg = cursed_sigil_attacker_config();
    for mode in [
        SimpleAbilityTimingMode::ReallyFast,
        SimpleAbilityTimingMode::Fast,
        SimpleAbilityTimingMode::SemiIdeal,
        SimpleAbilityTimingMode::Ideal,
        SimpleAbilityTimingMode::Extreme,
    ] {
        let times = cursed_sigil_activation_times(&cfg, mode, 5.0);
        let first = *times
            .first()
            .unwrap_or_else(|| panic!("first activation under {mode:?}: log empty"));
        assert!(
            first.abs() < 1e-6,
            "Cursed Sigil must activate at t=0 under {mode:?}, got {first}"
        );
    }
}
