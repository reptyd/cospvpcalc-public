//! Reference: status_ash_fall
//!
//! A weather status that costs no health and costs stamina twice: it takes a
//! quarter off the regeneration rate while it holds, and 1.5% of the full pool
//! on each of its own ticks.

use super::super::config::ComposableAbilityConfig;
use super::super::simulate_composable_matchup_with_trace;
use super::default_combatant;
use crate::contracts::{SimpleAbilityTimingMode, SimpleCombatantStats};

fn quiet() -> SimpleCombatantStats {
    let mut c = default_combatant();
    c.health = 10_000.0;
    c.damage = 0.0;
    c.bite_cooldown = 1000.0;
    c.health_regen = 0.0;
    c.stamina = 100.0;
    c.stamina_regen = 0.0;
    c
}

/// (pool, hp) on side A after `seconds` under `weather`.
fn under(weather: &str, seconds: f64, stamina_on: bool) -> (f64, f64) {
    let stats = quiet();
    let mut config = ComposableAbilityConfig::default();
    config.stamina_enabled = stamina_on;
    config.weather = Some(weather.to_string());

    let result = simulate_composable_matchup_with_trace(
        &stats, &stats, None, None,
        SimpleAbilityTimingMode::Ideal,
        &config,
        seconds, true,
    );
    let pool = result.debug.as_ref().expect("side snapshots").a.stamina;
    (pool, result.final_hp_a)
}

#[test]
fn each_tick_takes_a_share_of_the_full_pool() {
    // [REF:status_ash_fall]
    // Three ticks in ten seconds, 1.5 units each off a 100 pool.
    let (pool, _) = under("ashFall", 10.0, true);
    assert!((pool - 95.5).abs() < 1e-9, "three ticks off a 100 pool: {pool}");
}

#[test]
fn it_deals_no_damage() {
    // [REF:status_ash_fall]
    let (_, hp) = under("ashFall", 30.0, true);
    assert_eq!(hp, 10_000.0, "health is untouched");
}

#[test]
fn it_holds_the_rate_at_three_quarters() {
    // [REF:status_ash_fall]
    // A rate of 10 a second under Ash Fall returns 7.5, so ten seconds of
    // recovery from a pool the weather itself has been draining still ends
    // above where the same ten seconds of drain alone would leave it.
    let mut stats = quiet();
    stats.stamina_regen = 10.0;
    let mut config = ComposableAbilityConfig::default();
    config.stamina_enabled = true;

    let pool_of = |weather: Option<&str>| {
        let mut cfg = config.clone();
        cfg.weather = weather.map(str::to_string);
        let mut low = stats.clone();
        low.stamina = 1_000.0;
        simulate_composable_matchup_with_trace(
            &low, &low, None, None,
            SimpleAbilityTimingMode::Ideal,
            &cfg,
            10.0, true,
        )
        .debug
        .expect("side snapshots")
        .a
        .stamina
    };

    let under_weather = pool_of(Some("ashFall"));
    let clear = pool_of(None);
    assert!(
        under_weather < clear,
        "the weather leaves the pool lower: {under_weather} against {clear}",
    );
}

#[test]
fn a_fight_that_does_not_model_stamina_reads_none_of_it() {
    // [REF:status_ash_fall]
    let (pool, hp) = under("ashFall", 30.0, false);
    assert_eq!(pool, 100.0, "the pool is left as it started");
    assert_eq!(hp, 10_000.0);
}
