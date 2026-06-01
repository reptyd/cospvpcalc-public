//! Reference: ability_solar_beam
//!
//! Covers each testable bullet in the "Solar Beam" entry. Each test
//! body starts with the [REF:ability_solar_beam] marker so the vitest
//! coverage gate (src/pages/referenceCoverage.test.ts) sees it.
//!
//! Source of truth for breath stats: data/breath_specs.runtime.json:254-266
//! (id="Solar_Beam", capacity 10 sec, regen 0, crit 0%, dps 3, perHit
//! "1.5% PER HIT", auto-fire with 3 s startup + 120 s cooldown).
//!
//! Engine path: `breath.special_kind = Some("solar_beam")` routes
//! through the auto-fire branch (`composable/breath.rs:29-55`) which
//! defaults the 3 s startup and 120 s cooldown when not overridden.

use super::super::config::ComposableAbilityConfig;
use super::super::simulate_composable_matchup_with_trace;
use super::{default_breath, default_combatant};
use crate::combat::compute_simple_breath_damage_with_actor_and_target_statuses;
use crate::contracts::{SimpleAbilityTimingMode, SimpleBreathProfile, SimpleCombatantStats};
use std::collections::BTreeMap;

fn solar_beam_profile() -> SimpleBreathProfile {
    let mut breath = default_breath();
    // Per Reference text "* 1.5 * 1.0": 1.5 = per-tick fraction (dps
    // 3 / 2 ticks/sec); 1.0 = 0% pseudo-crit.
    breath.dps_pct = 3.0;
    breath.capacity = 10.0;
    breath.regen_rate = 0.0;
    breath.crit_chance_pct = 0.0;
    breath.special_kind = Some("solar_beam".to_string());
    // Defaults are 3.0 / 120.0 — explicit here to make the test
    // self-documenting.
    breath.auto_fire_delay_sec = 3.0;
    breath.auto_fire_cooldown_sec = 120.0;
    breath
}

fn passive_combatant(max_hp: f64) -> SimpleCombatantStats {
    let mut c = default_combatant();
    c.health = max_hp;
    c.damage = 0.0;
    c.bite_cooldown = 1000.0;
    c
}

fn breath_tick_times(
    attacker: &SimpleCombatantStats,
    defender: &SimpleCombatantStats,
    breath: &SimpleBreathProfile,
    max_time_sec: f64,
) -> (Vec<f64>, f64) {
    let got = simulate_composable_matchup_with_trace(
        attacker, defender, Some(breath), None,
        SimpleAbilityTimingMode::SemiIdeal,
        &ComposableAbilityConfig::default(),
        max_time_sec, true,
    );
    let times: Vec<f64> = got
        .combat_log
        .as_ref()
        .expect("trace log requested")
        .iter()
        .filter(|entry| entry.entry_type == "breath" && entry.attacker == "A")
        .map(|entry| entry.time)
        .collect();
    (times, got.final_hp_b)
}

#[test]
fn ticks_two_times_per_second_while_firing() {
    // [REF:ability_solar_beam]
    // Bullet 1: "Solar Beam deals damage 2 times per second while it
    // is firing." Capacity 10 (seconds) emits 20 ticks at 0.5 s
    // spacing.
    let attacker = passive_combatant(1_000.0);
    let defender = passive_combatant(10_000_000.0);
    let breath = solar_beam_profile();
    let (times, _) = breath_tick_times(&attacker, &defender, &breath, 20.0);
    assert_eq!(
        times.len(), 20,
        "first capacity batch should fire 20 ticks: {times:?}"
    );
    for window in times.windows(2) {
        let dt = window[1] - window[0];
        assert!(
            (dt - 0.5).abs() < 1e-9,
            "tick gap is not 0.5 s: {dt}"
        );
    }
}

#[test]
fn damage_formula_matches_spec() {
    // [REF:ability_solar_beam]
    // Bullets 2 + 3: "Breath damage per tick is calculated as
    // (((target max HP * ((attacker effective weight / defender effective
    // weight) + 1)) / 2) / 100) * 1.5 * 1.0 * (1 - breath resistance)."
    // Solar Beam DOES use the standard weight + breath-resistance
    // scaling (unlike Heliolyth's Judgement which ignores them).
    let mut attacker = default_combatant();
    attacker.weight = 200.0;
    let mut defender = default_combatant();
    defender.health = 4_000.0;
    defender.weight = 100.0;
    defender.breath_resistance = 0.20;
    let breath = solar_beam_profile();

    let mut chain = 0.0;
    let actual = compute_simple_breath_damage_with_actor_and_target_statuses(
        &attacker, &defender, &breath, &mut chain,
        &BTreeMap::new(), &BTreeMap::new(),
    );
    let weight_ratio = attacker.weight / defender.weight;
    let base = (defender.health * (1.0 + weight_ratio)) / 2.0 / 100.0;
    let expected = base * 1.5 * 1.0 * (1.0 - defender.breath_resistance);
    assert!(
        (actual - expected).abs() < 1e-9,
        "Solar Beam per-tick damage mismatch: expected {expected}, got {actual}"
    );
}

#[test]
fn capacity_is_ten_seconds_and_fires_until_empty() {
    // [REF:ability_solar_beam]
    // Bullet 4: "Solar Beam has capacity 10 (10 seconds of firing)
    // and, once started, it continues firing until that capacity is
    // emptied."
    let attacker = passive_combatant(1_000.0);
    let defender = passive_combatant(10_000_000.0);
    let breath = solar_beam_profile();
    // 60 s window: long enough for one full capacity (3 s startup +
    // 10 s firing = 13 s) but well shorter than the 120 s cooldown
    // before re-arming. So we observe exactly one batch of 20 ticks.
    let (times, _) = breath_tick_times(&attacker, &defender, &breath, 60.0);
    assert_eq!(
        times.len(), 20,
        "expected exactly one full capacity (no second batch within 60 s): {times:?}"
    );
}

#[test]
fn three_second_startup_delay() {
    // [REF:ability_solar_beam]
    // Bullet 5a: "It has a 3 second startup delay before firing
    // begins."
    // Engine: auto_fire_delay_sec = 3.0. Plus the 0.5 s tick interval
    // = first tick lands at t=3.5.
    let attacker = passive_combatant(1_000.0);
    let defender = passive_combatant(10_000_000.0);
    let breath = solar_beam_profile();
    let (times, _) = breath_tick_times(&attacker, &defender, &breath, 20.0);
    let first = *times.first().expect("at least one tick");
    assert!(
        (first - 3.5).abs() < 1e-9,
        "first tick at {first}, expected 3.5 s"
    );
}

#[test]
fn one_hundred_twenty_second_cooldown() {
    // [REF:ability_solar_beam]
    // Bullet 5b: "It has a 120 second cooldown instead of normal
    // breath regeneration."
    // No second batch should start before t=120 s. After the first
    // batch ends at ~13 s, attacker waits the full cooldown before
    // re-arming.
    let attacker = passive_combatant(1_000.0);
    // Defender HP large enough to survive multiple full batches.
    let defender = passive_combatant(100_000_000.0);
    let breath = solar_beam_profile();

    let (early, _) = breath_tick_times(&attacker, &defender, &breath, 100.0);
    assert_eq!(
        early.len(), 20,
        "second batch must not start before the 120 s cooldown elapses: {} ticks at {early:?}",
        early.len()
    );

    // Past 200 s a second batch must have fired (cooldown long
    // expired and re-arm completes).
    let (late, _) = breath_tick_times(&attacker, &defender, &breath, 200.0);
    assert!(
        late.len() > 20,
        "second batch must fire after the cooldown expires: only {} ticks",
        late.len()
    );
}
