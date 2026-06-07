//! Reference: ability_spirit_glare
//!
//! Covers each testable bullet in the "Spirit Glare" entry. Each test
//! body starts with the [REF:ability_spirit_glare] marker so the
//! vitest coverage gate (src/pages/referenceCoverage.test.ts) sees it.
//!
//! Engine path: `breath.special_kind = Some("spirit_glare")` routes
//! through the auto-fire branch (`composable/breath.rs:29-55`). Spirit
//! Glare has no startup delay (default 0 for "spirit_glare" subtype),
//! ticks at 2/sec for the standard 10 s capacity, and uses the 120 s
//! auto-fire cooldown instead of breath regen. Each damage tick
//! applies Burn × 1 + Fear × 1 to the target via the breath path.

use super::super::config::ComposableAbilityConfig;
use super::super::simulate_composable_matchup_with_trace;
use super::{applied_status, default_breath, default_combatant};
use crate::combat::compute_simple_breath_damage_with_actor_and_target_statuses;
use crate::contracts::{SimpleAbilityTimingMode, SimpleBreathProfile, SimpleCombatantStats};
use std::collections::BTreeMap;

fn spirit_glare_profile() -> SimpleBreathProfile {
    let mut breath = default_breath();
    // Per Reference text "* 1.0 * 1.0": dps 2 / 2 ticks/sec = 1.0
    // per-tick; 1.0 = 0% pseudo-crit.
    breath.dps_pct = 2.0;
    breath.capacity = 10.0;
    breath.regen_rate = 0.0;
    breath.crit_chance_pct = 0.0;
    breath.special_kind = Some("spirit_glare".to_string());
    // Spirit Glare has no startup delay (default 0 in the auto-fire
    // helper). 120 s auto-fire cooldown is the engine default for
    // auto-fire breaths.
    breath.auto_fire_delay_sec = 0.0;
    breath.auto_fire_cooldown_sec = 120.0;
    // Per-tick secondaries: Burn × 1 and Fear × 1.
    breath.special_statuses = vec![
        applied_status("Burn_Status", 1.0),
        applied_status("Fear_Status", 1.0),
    ];
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
    // [REF:ability_spirit_glare]
    // Bullet 1: "Spirit Glare deals damage 2 times per second while
    // it is firing."
    let attacker = passive_combatant(1_000.0);
    let defender = passive_combatant(10_000_000.0);
    let breath = spirit_glare_profile();
    let (times, _) = breath_tick_times(&attacker, &defender, &breath, 11.0);
    assert_eq!(
        times.len(), 20,
        "expected 20 ticks (10 s capacity × 2/s): {times:?}"
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
    // [REF:ability_spirit_glare]
    // Bullets 2 + 3: "Breath damage per tick is calculated as
    // (((target max HP * ((attacker effective weight / defender effective
    // weight) + 1)) / 2) / 100) * 1.0 * 1.0 * (1 - breath resistance)."
    let mut attacker = default_combatant();
    attacker.weight = 200.0;
    let mut defender = default_combatant();
    defender.health = 4_000.0;
    defender.weight = 100.0;
    defender.breath_resistance = 0.20;
    let breath = spirit_glare_profile();

    let mut chain = 0.0;
    let actual = compute_simple_breath_damage_with_actor_and_target_statuses(
        &attacker, &defender, &breath, &mut chain,
        &BTreeMap::new(), &BTreeMap::new(),
    );
    let weight_ratio = attacker.weight / defender.weight;
    let base = (defender.health * (1.0 + weight_ratio)) / 2.0 / 100.0;
    let expected = base * 1.0 * 1.0 * (1.0 - defender.breath_resistance);
    assert!(
        (actual - expected).abs() < 1e-9,
        "Spirit Glare per-tick damage mismatch: expected {expected}, got {actual}"
    );
}

#[test]
fn capacity_is_ten_seconds_and_fires_until_empty() {
    // [REF:ability_spirit_glare]
    // Bullet 4: "Spirit Glare has capacity 10 (10 seconds of firing)
    // and, once started, it continues firing until that capacity is
    // emptied."
    // 60 s window: long enough for one full burst (no startup delay
    // + 10 s firing = 10 s) but well shorter than the 120 s cooldown.
    let attacker = passive_combatant(1_000.0);
    let defender = passive_combatant(10_000_000.0);
    let breath = spirit_glare_profile();
    let (times, _) = breath_tick_times(&attacker, &defender, &breath, 60.0);
    assert_eq!(
        times.len(), 20,
        "expected exactly one full capacity (no second batch within 60 s): {times:?}"
    );
}

#[test]
fn no_startup_delay() {
    // [REF:ability_spirit_glare]
    // Bullet 5: "It has no startup delay."
    // First damage tick lands at t=0.5 (the 0.5 s tick interval) -
    // not at t=3.5 (Solar Beam's 3 s startup) or any later boundary.
    let attacker = passive_combatant(1_000.0);
    let defender = passive_combatant(10_000_000.0);
    let breath = spirit_glare_profile();
    let (times, _) = breath_tick_times(&attacker, &defender, &breath, 5.0);
    let first = *times.first().expect("at least one tick");
    assert!(
        (first - 0.5).abs() < 1e-9,
        "first tick at {first}, expected 0.5 s (no startup delay)"
    );
}

#[test]
fn one_hundred_twenty_second_cooldown() {
    // [REF:ability_spirit_glare]
    // Bullet 6: "It has a 120 second cooldown instead of normal breath
    // regeneration."
    let attacker = passive_combatant(1_000.0);
    let defender = passive_combatant(100_000_000.0);
    let breath = spirit_glare_profile();
    let (early, _) = breath_tick_times(&attacker, &defender, &breath, 100.0);
    assert_eq!(
        early.len(), 20,
        "second batch must not start before the 120 s cooldown elapses: {} ticks",
        early.len()
    );
    let (late, _) = breath_tick_times(&attacker, &defender, &breath, 200.0);
    assert!(
        late.len() > 20,
        "second batch must fire after the cooldown expires: only {} ticks",
        late.len()
    );
}

#[test]
fn each_damage_tick_applies_one_burn_and_one_fear() {
    // [REF:ability_spirit_glare]
    // Bullet 7: "Each damage tick also applies 1 stack of Burn and
    // 1 stack of Fear."
    // The breath path applies `special_statuses` per tick. Verify both
    // Burn_Status and Fear_Status appear in the trace post-firing.
    let attacker = passive_combatant(1_000.0);
    let defender = passive_combatant(10_000_000.0);
    let breath = spirit_glare_profile();
    let result = simulate_composable_matchup_with_trace(
        &attacker, &defender, Some(&breath), None,
        SimpleAbilityTimingMode::SemiIdeal,
        &ComposableAbilityConfig::default(),
        5.0, true,
    );
    let log = result.combat_log.expect("trace log");
    let burn_present = log
        .iter()
        .any(|e| e.status_id.as_deref() == Some("Burn_Status"));
    let fear_present = log
        .iter()
        .any(|e| e.status_id.as_deref() == Some("Fear_Status"));
    assert!(
        burn_present,
        "Spirit Glare must apply Burn_Status as a per-tick secondary"
    );
    assert!(
        fear_present,
        "Spirit Glare must apply Fear_Status as a per-tick secondary"
    );
}
