//! Reference: ability_aura
//!
//! Covers each testable bullet in the "Aura" entry. Each test body starts
//! with the [REF:ability_aura] marker so the vitest coverage gate
//! (src/pages/referenceCoverage.test.ts) sees it.

use super::super::config::ComposableAbilityConfig;
use super::super::simulate_composable_matchup_with_trace;
use super::default_combatant;
use crate::contracts::{SimpleAbilityTimingMode, SimpleCombatantStats};

fn aura_attacker_config() -> ComposableAbilityConfig {
    let mut cfg = ComposableAbilityConfig::default();
    cfg.attacker_aura_subtype = Some("Corrosion".to_string());
    cfg
}

fn passive_combatant(max_hp: f64) -> SimpleCombatantStats {
    let mut c = default_combatant();
    c.health = max_hp;
    c.damage = 0.0;
    c.bite_cooldown = 1000.0;
    c
}

fn aura_apply_times(
    attacker: &SimpleCombatantStats,
    defender: &SimpleCombatantStats,
    cfg: &ComposableAbilityConfig,
    policy: SimpleAbilityTimingMode,
    max_time_sec: f64,
) -> Vec<f64> {
    let result = simulate_composable_matchup_with_trace(
        attacker, defender, None, None, policy, cfg, max_time_sec, true,
    );
    let log = result.combat_log.expect("trace log requested");
    log.iter()
        .filter(|e| {
            e.status_id.as_deref() == Some("Corrosion_Status")
                && e.description
                    .as_deref()
                    .is_some_and(|d| d.contains("applied"))
        })
        .map(|e| e.time)
        .collect()
}

#[test]
fn ticks_every_three_seconds() {
    // [REF:ability_aura]
    let attacker = passive_combatant(1_000.0);
    let defender = passive_combatant(10_000.0);
    let cfg = aura_attacker_config();
    let times = aura_apply_times(&attacker, &defender, &cfg, SimpleAbilityTimingMode::Fast, 10.0);
    assert_eq!(
        times.len(),
        3,
        "expected aura applications at t=3, 6, 9 within 10 s window: {times:?}"
    );
    for window in times.windows(2) {
        let dt = window[1] - window[0];
        assert!(
            (dt - 3.0).abs() < 1e-9,
            "successive aura ticks should be 3 s apart, got {dt}: {times:?}"
        );
    }
}

#[test]
fn first_tick_three_seconds_after_start() {
    // [REF:ability_aura]
    let attacker = passive_combatant(1_000.0);
    let defender = passive_combatant(10_000.0);
    let cfg = aura_attacker_config();
    let times = aura_apply_times(&attacker, &defender, &cfg, SimpleAbilityTimingMode::Fast, 5.0);
    let first = *times.first().expect("at least one aura application");
    assert!(
        (first - 3.0).abs() < 1e-9,
        "first aura tick must land at 3.0 s, got {first}"
    );
}

#[test]
fn each_tick_applies_three_stacks() {
    // [REF:ability_aura]
    let attacker = passive_combatant(1_000.0);
    let defender = passive_combatant(10_000.0);
    let cfg = aura_attacker_config();
    let result = simulate_composable_matchup_with_trace(
        &attacker,
        &defender,
        None,
        None,
        SimpleAbilityTimingMode::Fast,
        &cfg,
        4.0,
        true,
    );
    let log = result.combat_log.expect("trace log");
    let first_apply = log
        .iter()
        .find(|e| {
            e.status_id.as_deref() == Some("Corrosion_Status")
                && e.description
                    .as_deref()
                    .is_some_and(|d| d.contains("applied"))
        })
        .expect("first aura application");
    let desc = first_apply.description.as_deref().expect("description");
    assert!(
        desc.contains("(3)"),
        "first aura application should report 3 stacks, got {desc}"
    );
}

#[test]
fn runs_under_all_timing_policy_modes() {
    // [REF:ability_aura]
    let attacker = passive_combatant(1_000.0);
    let defender = passive_combatant(10_000.0);
    let cfg = aura_attacker_config();
    for mode in [
        SimpleAbilityTimingMode::ReallyFast,
        SimpleAbilityTimingMode::Fast,
        SimpleAbilityTimingMode::SemiIdeal,
        SimpleAbilityTimingMode::Ideal,
        SimpleAbilityTimingMode::Extreme,
    ] {
        let times = aura_apply_times(&attacker, &defender, &cfg, mode, 10.0);
        assert_eq!(
            times.len(),
            3,
            "aura should tick 3 times in 10 s under {mode:?}: {times:?}"
        );
        let first = *times.first().expect("first tick");
        assert!(
            (first - 3.0).abs() < 1e-9,
            "first tick must be at 3.0 s under {mode:?}, got {first}"
        );
    }
}
