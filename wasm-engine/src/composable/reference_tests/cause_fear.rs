//! Reference: ability_cause_fear
//!
//! Covers each testable bullet in the "Cause Fear" entry. Each test body
//! starts with the [REF:ability_cause_fear] marker so the vitest coverage
//! gate (src/pages/referenceCoverage.test.ts) sees it.
//!
//! The "applies 10 Fear immediately" bullet is verified by inspecting the
//! source: the Cause Fear activation block at composable/mod.rs hardcodes
//! `stacks: 10.0` for `Fear_Status` (mod.rs:3927 attacker side, mod.rs:3944
//! defender side). The runtime tests below verify the qualitative behavior
//! the bullet implies (the ability fires, the cooldown is 120 s, and
//! activation timing does not depend on the policy mode).

use super::super::config::ComposableAbilityConfig;
use super::super::simulate_composable_matchup_with_trace;
use super::default_combatant;
use crate::contracts::{SimpleAbilityTimingMode, SimpleCombatantStats};

fn cause_fear_attacker_config() -> ComposableAbilityConfig {
    let mut cfg = ComposableAbilityConfig::default();
    cfg.attacker_cause_fear = true;
    cfg
}

fn passive_combatant(max_hp: f64) -> SimpleCombatantStats {
    let mut c = default_combatant();
    c.health = max_hp;
    c.damage = 0.0;
    c.bite_cooldown = 1000.0;
    c
}

fn cause_fear_activation_times(
    cfg: &ComposableAbilityConfig,
    policy: SimpleAbilityTimingMode,
    max_time_sec: f64,
) -> Vec<f64> {
    // Give attacker a slow bite so the simulation has scheduled events to
    // process up to max_time. Without bite events the loop has nothing to
    // wake on between Cause Fear cooldowns and may terminate early.
    let mut attacker = passive_combatant(1_000.0);
    attacker.damage = 1.0;
    attacker.bite_cooldown = 5.0;
    let defender = passive_combatant(10_000_000.0);
    let result = simulate_composable_matchup_with_trace(
        &attacker, &defender, None, None, policy, cfg, max_time_sec, true,
    );
    let log = result.combat_log.expect("trace log requested");
    log.iter()
        .filter(|e| {
            e.entry_type == "ability"
                && e.attacker == "A"
                && e.description.as_deref() == Some("Cause Fear activated")
        })
        .map(|e| e.time)
        .collect()
}

#[test]
fn fires_immediately_when_available() {
    // [REF:ability_cause_fear]
    let times = cause_fear_activation_times(
        &cause_fear_attacker_config(),
        SimpleAbilityTimingMode::Fast,
        2.0,
    );
    let first = *times.first().expect("Cause Fear must activate at least once");
    assert!(
        first.abs() < 1e-6,
        "first Cause Fear activation must land at t=0, got {first}"
    );
}

#[test]
fn cooldown_one_hundred_twenty_seconds() {
    // [REF:ability_cause_fear]
    let times = cause_fear_activation_times(
        &cause_fear_attacker_config(),
        SimpleAbilityTimingMode::Fast,
        300.0,
    );
    assert!(
        times.len() >= 2,
        "Cause Fear must fire at least twice in a 300 s window: {times:?}"
    );
    let gap = times[1] - times[0];
    assert!(
        (gap - 120.0).abs() < 1e-6,
        "second Cause Fear activation must be 120 s after the first, got {gap}: {times:?}"
    );
}

#[test]
fn activates_immediately_under_all_policies() {
    // [REF:ability_cause_fear]
    let cfg = cause_fear_attacker_config();
    for mode in [
        SimpleAbilityTimingMode::ReallyFast,
        SimpleAbilityTimingMode::Fast,
        SimpleAbilityTimingMode::SemiIdeal,
        SimpleAbilityTimingMode::Ideal,
        SimpleAbilityTimingMode::Extreme,
    ] {
        let times = cause_fear_activation_times(&cfg, mode, 5.0);
        let first = *times
            .first()
            .unwrap_or_else(|| panic!("first activation under {mode:?}: log empty"));
        assert!(
            first.abs() < 1e-6,
            "Cause Fear must activate at t=0 under {mode:?}, got {first}"
        );
    }
}
