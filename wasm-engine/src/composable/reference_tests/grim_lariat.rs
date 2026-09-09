//! Reference: ability_grim_lariat
//!
//! Covers each testable bullet in the "Grim Lariat" entry. Each test
//! body starts with the [REF:ability_grim_lariat] marker so the
//! vitest coverage gate (src/pages/referenceCoverage.test.ts) sees it.
//!
//! The "applies 8 Heartbroken" stack count and "50% of user damage"
//! values are verified by source inspection of composable/mod.rs:
//! 3966 (`attacker.damage * 0.5`) and mod.rs:3976-3977 (`stacks: 8.0`).

use super::super::config::ComposableAbilityConfig;
use super::super::simulate_composable_matchup_with_trace;
use super::default_combatant;
use crate::contracts::{SimpleAbilityTimingMode, SimpleCombatantStats};
use crate::spec_constants::{
    GRIM_LARIAT_COOLDOWN_SEC, GRIM_LARIAT_DAMAGE_PCT_USER_DAMAGE, GRIM_LARIAT_HEARTBROKEN_STACKS,
};

fn grim_lariat_attacker_config() -> ComposableAbilityConfig {
    let mut cfg = ComposableAbilityConfig::default();
    cfg.attacker_grim_lariat = true;
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

fn grim_lariat_activation_times(
    cfg: &ComposableAbilityConfig,
    policy: SimpleAbilityTimingMode,
    max_time_sec: f64,
) -> Vec<f64> {
    let attacker = biting_attacker(50.0, 5.0);
    let defender = passive_combatant(10_000_000.0);
    let result = simulate_composable_matchup_with_trace(
        &attacker, &defender, None, None, policy, cfg, max_time_sec, true,
    );
    let log = result.combat_log.expect("trace log requested");
    log.iter()
        .filter(|e| {
            e.entry_type == "ability"
                && e.attacker == "A"
                && e.description.as_deref() == Some("Grim Lariat activated")
        })
        .map(|e| e.time)
        .collect()
}

#[test]
fn fires_immediately_when_available() {
    // [REF:ability_grim_lariat]
    let times = grim_lariat_activation_times(
        &grim_lariat_attacker_config(),
        SimpleAbilityTimingMode::Fast,
        2.0,
    );
    let first = *times.first().expect("Grim Lariat must activate");
    assert!(
        first.abs() < 1e-6,
        "first Grim Lariat activation must land at t=0, got {first}"
    );
}

#[test]
fn cooldown_sixty_seconds() {
    // [REF:ability_grim_lariat]
    let times = grim_lariat_activation_times(
        &grim_lariat_attacker_config(),
        SimpleAbilityTimingMode::Fast,
        180.0,
    );
    assert!(
        times.len() >= 2,
        "Grim Lariat must fire at least twice in a 180 s window: {times:?}"
    );
    let gap = times[1] - times[0];
    assert!(
        (gap - GRIM_LARIAT_COOLDOWN_SEC).abs() < 1e-6,
        "second Grim Lariat activation must be {GRIM_LARIAT_COOLDOWN_SEC} s after the first, got {gap}: {times:?}"
    );
}

#[test]
fn activates_immediately_under_all_policies() {
    // [REF:ability_grim_lariat]
    let cfg = grim_lariat_attacker_config();
    for mode in [
        SimpleAbilityTimingMode::ReallyFast,
        SimpleAbilityTimingMode::Fast,
        SimpleAbilityTimingMode::SemiIdeal,
        SimpleAbilityTimingMode::Ideal,
        SimpleAbilityTimingMode::Extreme,
    ] {
        let times = grim_lariat_activation_times(&cfg, mode, 5.0);
        let first = *times
            .first()
            .unwrap_or_else(|| panic!("first activation under {mode:?}: log empty"));
        assert!(
            first.abs() < 1e-6,
            "Grim Lariat must activate at t=0 under {mode:?}, got {first}"
        );
    }
}

#[test]
fn burst_damage_is_fifty_percent_of_user_damage() {
    // [REF:ability_grim_lariat]
    // Bullet 1: "Grim Lariat deals damage equal to 50% of the user's
    // current damage." Isolate the burst by differencing a Grim Lariat
    // run against a no-ability baseline: both deal the same t=0 melee
    // bite, so the extra opponent damage in the Grim Lariat run is
    // exactly the burst = user.damage x 50%.
    let attacker = biting_attacker(200.0, 1000.0); // single t=0 bite in a 1 s window
    let defender = passive_combatant(10_000_000.0);
    let with_lariat = simulate_composable_matchup_with_trace(
        &attacker, &defender, None, None,
        SimpleAbilityTimingMode::Fast,
        &grim_lariat_attacker_config(),
        1.0, true,
    );
    let baseline = simulate_composable_matchup_with_trace(
        &attacker, &defender, None, None,
        SimpleAbilityTimingMode::Fast,
        &ComposableAbilityConfig::default(),
        1.0, true,
    );
    let burst = baseline.final_hp_b - with_lariat.final_hp_b;
    let expected = attacker.damage * (GRIM_LARIAT_DAMAGE_PCT_USER_DAMAGE / 100.0);
    assert!(
        (burst - expected).abs() < 1e-6,
        "Grim Lariat burst must deal {GRIM_LARIAT_DAMAGE_PCT_USER_DAMAGE}% of user damage = {expected}, got {burst}"
    );
}

#[test]
fn applies_eight_heartbroken_stacks() {
    // [REF:ability_grim_lariat]
    // Bullet 3: "It also applies 8 stacks of Heartbroken." The status apply
    // trace records the before/after stack count in `detail`. On a fresh
    // opponent (0 prior stacks) the apply event reads "0 -> 8 stacks", which
    // directly witnesses the configured stack count.
    let attacker = biting_attacker(200.0, 1000.0);
    let defender = passive_combatant(10_000_000.0);
    let result = simulate_composable_matchup_with_trace(
        &attacker, &defender, None, None,
        SimpleAbilityTimingMode::Fast,
        &grim_lariat_attacker_config(),
        1.0, true,
    );
    let log = result.combat_log.expect("trace log requested");
    let apply = log
        .iter()
        .find(|e| {
            e.status_id.as_deref() == Some("Heartbroken_Status")
                && e.description.as_deref().is_some_and(|d| d.starts_with("Grim Lariat applied"))
        })
        .expect("Grim Lariat must emit a Heartbroken apply event");
    let expected_detail = format!("0 -> {} stacks", GRIM_LARIAT_HEARTBROKEN_STACKS);
    assert_eq!(
        apply.detail.as_deref(),
        Some(expected_detail.as_str()),
        "Grim Lariat must apply {GRIM_LARIAT_HEARTBROKEN_STACKS} Heartbroken stacks: detail={:?}",
        apply.detail
    );
}
