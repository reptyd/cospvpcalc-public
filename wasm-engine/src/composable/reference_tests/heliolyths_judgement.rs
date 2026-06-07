//! Reference: ability_heliolyths_judgement
//!
//! Covers each testable bullet in the "Heliolyth's Judgement" entry. Each
//! test body starts with the [REF:ability_heliolyths_judgement] marker so
//! the vitest coverage gate (src/pages/referenceCoverage.test.ts) sees it.

use super::super::config::ComposableAbilityConfig;
use super::super::simulate_composable_matchup_with_trace;
use super::{default_breath, default_combatant};
use crate::contracts::{SimpleAbilityTimingMode, SimpleBreathProfile, SimpleCombatantStats};

fn heliolyths_judgement_profile() -> SimpleBreathProfile {
    let mut breath = default_breath();
    breath.dps_pct = 3.2;
    // Capacity = 10 seconds of firing under the 1-cap-per-second model.
    // Damage ticks 2/sec → 20 ticks per full capacity, 10 s total duration
    // (matches the in-game observation the spec was derived from).
    breath.capacity = 10.0;
    breath.regen_rate = 0.0;
    breath.crit_chance_pct = 0.0;
    breath.special_kind = Some("heliolyth_judgement".to_string());
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
        attacker,
        defender,
        Some(breath),
        None,
        SimpleAbilityTimingMode::SemiIdeal,
        &ComposableAbilityConfig::default(),
        max_time_sec,
        true,
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
fn ticks_two_times_per_second() {
    // [REF:ability_heliolyths_judgement]
    let attacker = passive_combatant(1_000.0);
    let defender = passive_combatant(10_000.0);
    let breath = heliolyths_judgement_profile();
    let (times, _) = breath_tick_times(&attacker, &defender, &breath, 20.0);
    assert_eq!(times.len(), 20, "first capacity batch should fire 20 ticks: {times:?}");
    for window in times.windows(2) {
        let dt = window[1] - window[0];
        assert!((dt - 0.5).abs() < 1e-9, "tick gap is not 0.5 s: {dt}");
    }
}

#[test]
fn per_tick_damage_is_one_point_six_percent_of_max_hp() {
    // [REF:ability_heliolyths_judgement]
    let max_hp = 10_000.0;
    let attacker = passive_combatant(1_000.0);
    let defender = passive_combatant(max_hp);
    let breath = heliolyths_judgement_profile();
    let (_, final_hp_b) = breath_tick_times(&attacker, &defender, &breath, 20.0);
    let expected = max_hp - 20.0 * 0.016 * max_hp;
    assert!(
        (final_hp_b - expected).abs() < 1e-6,
        "expected final HP {expected}, got {final_hp_b}"
    );
}

#[test]
fn ignores_breath_resistance_and_weight_scaling() {
    // [REF:ability_heliolyths_judgement]
    let max_hp = 10_000.0;
    let attacker = passive_combatant(1_000.0);
    let breath = heliolyths_judgement_profile();

    let mut def_baseline = passive_combatant(max_hp);
    def_baseline.weight = 100.0;
    def_baseline.breath_resistance = 0.0;
    let (_, hp_baseline) = breath_tick_times(&attacker, &def_baseline, &breath, 20.0);

    let mut def_wrenched = passive_combatant(max_hp);
    def_wrenched.weight = 100_000.0;
    def_wrenched.breath_resistance = 0.95;
    let (_, hp_wrenched) = breath_tick_times(&attacker, &def_wrenched, &breath, 20.0);

    assert!(
        (hp_baseline - hp_wrenched).abs() < 1e-6,
        "breath resistance and weight ratio must not change damage: \
         baseline={hp_baseline}, wrenched={hp_wrenched}"
    );
}

#[test]
fn capacity_is_ten_seconds_and_fires_until_empty() {
    // [REF:ability_heliolyths_judgement]
    let attacker = passive_combatant(1_000.0);
    let defender = passive_combatant(10_000.0);
    let breath = heliolyths_judgement_profile();
    // Window long enough for the first capacity (10 s of firing → 20
    // damage ticks at 0.5 s spacing) to fully empty but well shorter
    // than the 120 s cooldown - so we observe exactly the one batch.
    let (times, _) = breath_tick_times(&attacker, &defender, &breath, 60.0);
    assert_eq!(times.len(), 20, "expected exactly one full capacity: {times:?}");
}

#[test]
fn three_second_startup_delay() {
    // [REF:ability_heliolyths_judgement]
    let attacker = passive_combatant(1_000.0);
    let defender = passive_combatant(10_000.0);
    let breath = heliolyths_judgement_profile();
    let (times, _) = breath_tick_times(&attacker, &defender, &breath, 20.0);
    let first = *times.first().expect("at least one tick");
    // Startup delay 3.0 s + tick interval 0.5 s = first tick at 3.5 s.
    assert!((first - 3.5).abs() < 1e-9, "first tick at {first}, expected 3.5 s");
}

#[test]
fn one_hundred_twenty_second_cooldown() {
    // [REF:ability_heliolyths_judgement]
    let attacker = passive_combatant(1_000.0);
    // Defender HP large enough to survive two full batches (32% × 2 = 64%).
    let defender = passive_combatant(100_000.0);
    let breath = heliolyths_judgement_profile();

    // No second batch should start before 100 s - the cooldown is 120 s.
    let (early, _) = breath_tick_times(&attacker, &defender, &breath, 100.0);
    assert_eq!(
        early.len(),
        20,
        "second batch must not start before the 120 s cooldown elapses: {early:?}"
    );

    // After 200 s the cooldown has long expired and a second batch must
    // have fired. We don't assert exact gap timing - only that the cooldown
    // is finite and the engine re-engages once it expires.
    let (late, _) = breath_tick_times(&attacker, &defender, &breath, 200.0);
    assert!(
        late.len() > 20,
        "second batch must fire after the cooldown expires: only {} ticks",
        late.len()
    );
}
