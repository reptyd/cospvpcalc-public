//! Reference: ability_drowsy_area
//!
//! Covers each testable bullet in the "Drowsy Area" entry. Each test body
//! starts with the [REF:ability_drowsy_area] marker so the vitest coverage
//! gate (src/pages/referenceCoverage.test.ts) sees it.
//!
//! The "applies 5 Drowsy immediately" stack count is verified by source
//! inspection of composable/mod.rs:2941-2942 (and the symmetric defender
//! block at mod.rs:2957-2958): the activation block calls
//! apply_incoming_statuses_to_target_with_fortify_immunity with
//! `stacks: 5.0` for `Drowsy_Status`. The runtime tests below cover the
//! qualitative behavior the bullets imply.

use super::super::config::ComposableAbilityConfig;
use super::super::simulate_composable_matchup_with_trace;
use super::default_combatant;
use crate::contracts::{SimpleAbilityTimingMode, SimpleCombatantStats};

fn drowsy_area_attacker_config() -> ComposableAbilityConfig {
    let mut cfg = ComposableAbilityConfig::default();
    cfg.attacker_drowsy_area = true;
    cfg
}

fn biting_attacker(damage: f64, bite_cd: f64) -> SimpleCombatantStats {
    let mut c = default_combatant();
    c.health = 1_000.0;
    c.damage = damage;
    c.bite_cooldown = bite_cd;
    c
}

fn passive_combatant(max_hp: f64) -> SimpleCombatantStats {
    let mut c = default_combatant();
    c.health = max_hp;
    c.damage = 0.0;
    c.bite_cooldown = 1000.0;
    c
}

fn drowsy_area_activation_times(
    cfg: &ComposableAbilityConfig,
    policy: SimpleAbilityTimingMode,
    max_time_sec: f64,
) -> Vec<f64> {
    let attacker = biting_attacker(1.0, 5.0);
    let defender = passive_combatant(10_000_000.0);
    let result = simulate_composable_matchup_with_trace(
        &attacker, &defender, None, None, policy, cfg, max_time_sec, true,
    );
    let log = result.combat_log.expect("trace log requested");
    log.iter()
        .filter(|e| {
            e.entry_type == "ability"
                && e.attacker == "A"
                && e.description.as_deref() == Some("Drowsy Area activated")
        })
        .map(|e| e.time)
        .collect()
}

#[test]
fn fires_immediately_when_available() {
    // [REF:ability_drowsy_area]
    let times = drowsy_area_activation_times(
        &drowsy_area_attacker_config(),
        SimpleAbilityTimingMode::Fast,
        2.0,
    );
    let first = *times.first().expect("Drowsy Area must activate");
    assert!(
        first.abs() < 1e-6,
        "first Drowsy Area activation must land at t=0, got {first}"
    );
}

#[test]
fn cooldown_sixty_seconds() {
    // [REF:ability_drowsy_area]
    let times = drowsy_area_activation_times(
        &drowsy_area_attacker_config(),
        SimpleAbilityTimingMode::Fast,
        180.0,
    );
    assert!(
        times.len() >= 2,
        "Drowsy Area must fire at least twice in a 180 s window: {times:?}"
    );
    let gap = times[1] - times[0];
    assert!(
        (gap - 60.0).abs() < 1e-6,
        "second Drowsy Area activation must be 60 s after the first, got {gap}: {times:?}"
    );
}

#[test]
fn activates_immediately_under_all_policies() {
    // [REF:ability_drowsy_area]
    let cfg = drowsy_area_attacker_config();
    for mode in [
        SimpleAbilityTimingMode::ReallyFast,
        SimpleAbilityTimingMode::Fast,
        SimpleAbilityTimingMode::SemiIdeal,
        SimpleAbilityTimingMode::Ideal,
        SimpleAbilityTimingMode::Extreme,
    ] {
        let times = drowsy_area_activation_times(&cfg, mode, 5.0);
        let first = *times
            .first()
            .unwrap_or_else(|| panic!("first activation under {mode:?}: log empty"));
        assert!(
            first.abs() < 1e-6,
            "Drowsy Area must activate at t=0 under {mode:?}, got {first}"
        );
    }
}
