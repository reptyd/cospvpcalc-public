//! Reference: ability_cloud_breath
//!
//! Covers each testable bullet in the "Cloud Breath" entry. Each test body
//! starts with the [REF:ability_cloud_breath] marker so the vitest coverage
//! gate (src/pages/referenceCoverage.test.ts) sees it.

use super::super::config::ComposableAbilityConfig;
use super::super::simulate_composable_matchup_with_trace;
use super::{default_breath, default_combatant};
use crate::contracts::{SimpleAbilityTimingMode, SimpleBreathProfile, SimpleCombatantStats};

fn cloud_breath_profile() -> SimpleBreathProfile {
    let mut breath = default_breath();
    breath.dps_pct = 0.0;
    breath.capacity = 15.0;
    breath.regen_rate = 1.3;
    breath.crit_chance_pct = 0.0;
    breath.special_kind = Some("cloud".to_string());
    breath.self_heal_pct = 1.0;
    breath
}

fn passive_combatant(max_hp: f64) -> SimpleCombatantStats {
    let mut c = default_combatant();
    c.health = max_hp;
    c.damage = 0.0;
    c.bite_cooldown = 1000.0;
    c
}

#[test]
fn deals_no_damage_to_target() {
    // [REF:ability_cloud_breath]
    let attacker = passive_combatant(1_000.0);
    let defender = passive_combatant(10_000.0);
    let breath = cloud_breath_profile();
    let result = simulate_composable_matchup_with_trace(
        &attacker,
        &defender,
        Some(&breath),
        None,
        SimpleAbilityTimingMode::Fast,
        &ComposableAbilityConfig::default(),
        10.0,
        false,
    );
    assert!(
        (result.final_hp_b - defender.health).abs() < 1e-6,
        "Cloud Breath must not damage the target: defender HP {} → {}",
        defender.health,
        result.final_hp_b
    );
}

#[test]
fn heals_owner_via_breath_log_when_wounded() {
    // [REF:ability_cloud_breath]
    // Wound the attacker (defender bites it) so heal applies and a heal
    // event is pushed to the trace log. Without prior wounding, the heal
    // is clamped at full HP and no event is emitted.
    let mut attacker = passive_combatant(1_000.0);
    attacker.bite_cooldown = 1000.0;
    let mut defender = passive_combatant(10_000.0);
    defender.damage = 50.0;
    defender.bite_cooldown = 0.4; // bite before first cloud-breath tick at t=0.5
    let breath = cloud_breath_profile();
    let result = simulate_composable_matchup_with_trace(
        &attacker,
        &defender,
        Some(&breath),
        None,
        SimpleAbilityTimingMode::Fast,
        &ComposableAbilityConfig::default(),
        2.0,
        true,
    );
    let log = result.combat_log.expect("trace log");
    let heals: Vec<&_> = log
        .iter()
        .filter(|e| e.description.as_deref() == Some("Cloud Breath heal"))
        .collect();
    assert!(
        !heals.is_empty(),
        "Cloud Breath must emit at least one heal event when the owner is wounded"
    );
    let heal_amount = heals[0].healing.unwrap_or(0.0);
    let expected_per_second = attacker.health * (breath.self_heal_pct / 100.0);
    assert!(
        (heal_amount - expected_per_second).abs() < 1e-6,
        "per-second self-heal must equal max HP × self_heal_pct / 100 = {expected_per_second}, got {heal_amount}"
    );
}

#[test]
fn capacity_and_tick_rate_via_muddy_cadence() {
    // [REF:ability_cloud_breath]
    // Per-tick muddy progress = 0.2176, the uptime-calibrated stand-in for
    // the listed 40% roll (breath.rs::cloud_breath_muddy_proc_fraction).
    // Fire ticks at 0.5 s (capacity 15 = 15 s of firing, so the breath is
    // still firing through this window). Sequence:
    //   t=0.5: progress 0.2176
    //   t=1.0: 0.4352
    //   t=1.5: 0.6528
    //   t=2.0: 0.8704
    //   t=2.5: 1.0880 -> apply Muddy, reset to 0.0880
    //   t=3.0: 0.3056
    //   t=3.5: 0.5232
    //   t=4.0: 0.7408
    //   t=4.5: 0.9584
    //   t=5.0: 1.1760 -> apply Muddy, reset to 0.1760
    //   t=5.5: 0.3936
    // Expected Muddy applications within the 5.5 s window: 2, at t=2.5 and 5.0.
    let attacker = passive_combatant(1_000.0);
    let defender = passive_combatant(10_000.0);
    let breath = cloud_breath_profile();
    let result = simulate_composable_matchup_with_trace(
        &attacker,
        &defender,
        Some(&breath),
        None,
        SimpleAbilityTimingMode::Fast,
        &ComposableAbilityConfig::default(),
        5.5,
        true,
    );
    let log = result.combat_log.expect("trace log");
    let muddy_times: Vec<f64> = log
        .iter()
        .filter(|e| {
            e.status_id.as_deref() == Some("Muddy_Status")
                && e.description
                    .as_deref()
                    .is_some_and(|d| d.contains("applied"))
        })
        .map(|e| e.time)
        .collect();
    let expected = [2.5_f64, 5.0];
    assert_eq!(
        muddy_times.len(),
        expected.len(),
        "expected exactly {} Muddy applications in the first capacity burst, got {muddy_times:?}",
        expected.len()
    );
    for (got, want) in muddy_times.iter().zip(expected.iter()) {
        assert!(
            (got - want).abs() < 1e-9,
            "Muddy apply time mismatch: expected {want}, got {got}"
        );
    }
}
