//! Reference: ability_seedling_mist
//!
//! A charge, then a mist that lasts a fixed time and heals every creature
//! inside it, which in a fight is the user and the opponent. Same shape as
//! Reflux and Lance, and the three entries state it the same way.

use super::super::config::ComposableAbilityConfig;
use super::super::simulate_composable_matchup_with_trace;
use super::default_combatant;
use crate::contracts::{SimpleAbilityTimingMode, SimpleCombatantStats};
use crate::spec_constants::{
    SEEDLING_MIST_AREA_DELAY_SEC, SEEDLING_MIST_CHARGE_SEC, SEEDLING_MIST_COOLDOWN_SEC,
    SEEDLING_MIST_DURATION_SEC, SEEDLING_MIST_HEAL_PCT_MAX_HP, SEEDLING_MIST_TICK_INTERVAL_SEC,
};

/// The moment the mist appears, measured from a charge started at t=0.
const MIST_AT: f64 = SEEDLING_MIST_CHARGE_SEC + SEEDLING_MIST_AREA_DELAY_SEC;

fn quiet(max_hp: f64) -> SimpleCombatantStats {
    let mut c = default_combatant();
    c.health = max_hp;
    c.damage = 0.0;
    c.bite_cooldown = 1000.0;
    c.health_regen = 0.0;
    c
}

fn mist_config() -> ComposableAbilityConfig {
    let mut cfg = ComposableAbilityConfig::default();
    cfg.attacker_seedling_mist = true;
    cfg
}

fn mist_run(seconds: f64, a_max_hp: f64, b_max_hp: f64) -> Vec<crate::contracts::CombatLogEntry> {
    let attacker = quiet(a_max_hp);
    let defender = quiet(b_max_hp);
    let result = simulate_composable_matchup_with_trace(
        &attacker, &defender, None, None,
        SimpleAbilityTimingMode::Fast,
        &mist_config(),
        seconds, true,
    );
    result.combat_log.expect("trace")
}

#[test]
fn the_mist_lasts_five_seconds_and_ticks_a_second_apart() {
    // [REF:ability_seedling_mist]
    // Bullets 2 + 3 + 4 + 5 + 6: "The charge takes 2.5 seconds."
    // "The mist appears 0.8 seconds after the charge completes, a figure we chose."
    // "The mist lasts 5 seconds."
    // "Its ticks are 1 second apart."
    // "The first tick lands 1 second after the mist appears."
    let log = mist_run(20.0, 3_000.0, 20_000.0);
    let times: Vec<f64> = log
        .iter()
        .filter(|e| e.description.as_deref() == Some("Seedling Mist tick") && e.hp_side == "A")
        .map(|e| e.time)
        .collect();
    let expected_count =
        (SEEDLING_MIST_DURATION_SEC / SEEDLING_MIST_TICK_INTERVAL_SEC).round() as usize;
    assert_eq!(
        times.len(), expected_count,
        "a mist of {SEEDLING_MIST_DURATION_SEC} s at {SEEDLING_MIST_TICK_INTERVAL_SEC} s a tick \
         carries {expected_count} ticks: {times:?}"
    );
    assert!(
        (times[0] - (MIST_AT + SEEDLING_MIST_TICK_INTERVAL_SEC)).abs() < 1e-9,
        "the first tick lands {SEEDLING_MIST_TICK_INTERVAL_SEC} s after the mist appears, at t={}: got {}",
        MIST_AT + SEEDLING_MIST_TICK_INTERVAL_SEC, times[0]
    );
    assert!(
        (times[times.len() - 1] - (MIST_AT + SEEDLING_MIST_DURATION_SEC)).abs() < 1e-9,
        "the last tick lands at the mist's expiry, at t={}: got {}",
        MIST_AT + SEEDLING_MIST_DURATION_SEC, times[times.len() - 1]
    );
    for pair in times.windows(2) {
        let gap = pair[1] - pair[0];
        assert!(
            (gap - SEEDLING_MIST_TICK_INTERVAL_SEC).abs() < 1e-9,
            "tick spacing must be {SEEDLING_MIST_TICK_INTERVAL_SEC} s, got {gap}: {times:?}"
        );
    }
}

#[test]
fn one_tick_heals_three_percent_of_the_healed_creatures_own_maximum() {
    // [REF:ability_seedling_mist]
    // Bullets 7 + 8: "Each tick heals a creature by 3% of that creature's own
    // maximum health."
    // "Each tick heals the user and the opponent alike."
    let log = mist_run(20.0, 3_000.0, 20_000.0);
    let heals = |side: &str| -> Vec<f64> {
        log.iter()
            .filter(|e| e.description.as_deref() == Some("Seedling Mist tick") && e.hp_side == side)
            .filter_map(|e| e.healing)
            .collect()
    };
    let expect_a = 3_000.0 * SEEDLING_MIST_HEAL_PCT_MAX_HP / 100.0;
    let expect_b = 20_000.0 * SEEDLING_MIST_HEAL_PCT_MAX_HP / 100.0;
    assert!(!heals("A").is_empty(), "the user is healed");
    assert_eq!(heals("A").len(), heals("B").len(), "both sides are healed the same number of times");
    for got in heals("A") {
        assert!((got - expect_a).abs() < 1e-9, "user tick {got} against {expect_a}");
    }
    for got in heals("B") {
        assert!((got - expect_b).abs() < 1e-9, "opponent tick {got} against {expect_b}");
    }
}

#[test]
fn the_cooldown_runs_from_the_start_of_the_charge() {
    // [REF:ability_seedling_mist]
    // Bullets 9 + 10: "The cooldown is 120 seconds."
    // "The cooldown begins at the start of the charge."
    let log = mist_run(130.0, 3_000.0, 20_000.0);
    let charges: Vec<f64> = log
        .iter()
        .filter(|e| e.description.as_deref() == Some("Seedling Mist charge started"))
        .map(|e| e.time)
        .collect();
    assert_eq!(charges.len(), 2, "two charges must start inside 130 s: {charges:?}");
    assert!(
        (charges[1] - SEEDLING_MIST_COOLDOWN_SEC).abs() < 1e-6,
        "the second charge must start at t={SEEDLING_MIST_COOLDOWN_SEC}: got {}",
        charges[1]
    );
}

#[test]
fn the_ability_cooldown_multiplier_moves_that_cooldown() {
    // [REF:ability_seedling_mist]
    // Bullet 11: "That cooldown is multiplied by the user's ability cooldown
    // multiplier."
    let mut attacker = quiet(3_000.0);
    attacker.active_cooldown_multiplier = 0.5;
    let defender = quiet(20_000.0);
    let result = simulate_composable_matchup_with_trace(
        &attacker, &defender, None, None,
        SimpleAbilityTimingMode::Fast,
        &mist_config(),
        70.0, true,
    );
    let log = result.combat_log.expect("trace");
    let charges: Vec<f64> = log
        .iter()
        .filter(|e| e.description.as_deref() == Some("Seedling Mist charge started"))
        .map(|e| e.time)
        .collect();
    assert_eq!(
        charges.len(), 2,
        "a halved cooldown must fit two charges inside 70 s: {charges:?}"
    );
    assert!(
        (charges[1] - SEEDLING_MIST_COOLDOWN_SEC * 0.5).abs() < 1e-6,
        "a 0.5x multiplier must put the second charge at t={}: got {}",
        SEEDLING_MIST_COOLDOWN_SEC * 0.5, charges[1]
    );
}

#[test]
fn a_mist_left_off_heals_nobody() {
    // [REF:ability_seedling_mist]
    // Bullet 1: "Seedling Mist is off by default."
    let attacker = quiet(3_000.0);
    let defender = quiet(20_000.0);
    let result = simulate_composable_matchup_with_trace(
        &attacker, &defender, None, None,
        SimpleAbilityTimingMode::Fast,
        &ComposableAbilityConfig::default(),
        20.0, true,
    );
    let log = result.combat_log.expect("trace");
    assert!(!log.iter().any(|e| e.description.as_deref() == Some("Seedling Mist tick")));
}
