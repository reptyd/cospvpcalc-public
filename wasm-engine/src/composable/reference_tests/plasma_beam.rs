//! Reference: ability_plasma_beam
//!
//! Plasma Beam is a discrete-charge beam (special_kind = "plasma_beam"):
//! 3 charges at fight start, each fires 3 ticks at 2/sec (capacity 1.5),
//! 0.8-second startup delay per charge, a 2.5-second recast cooldown
//! measured from each charge's start, and 1 charge regenerates every 40
//! seconds (capped at 3). dps_pct=2.0, crit_chance_pct=35 (folded into
//! the global 1.5x crit -> 1.175x factor). Slowed (P=100, single stack)
//! lands on every tick.
//!
//! On the 0.5-second breath grid the 0.8 startup rounds up to a first
//! tick at t=1.5 and the 2.5 recast coincides with the natural
//! charge cadence, so the tick timings below are unchanged by those two
//! values - only the crit factor moves damage totals.
//!
//! Engine entry point: `composable/breath.rs::tick_breath_plasma`.

use super::super::config::ComposableAbilityConfig;
use super::super::simulate_composable_matchup_with_trace;
use super::{
    applied_status, assert_tick_stacks, default_breath, default_combatant,
    stacks_from_one_breath_tick,
};
use crate::combat::compute_simple_breath_damage_with_actor_and_target_statuses;
use crate::contracts::{SimpleAbilityTimingMode, SimpleBreathProfile, SimpleCombatantStats};
use crate::spec_constants::{PLASMA_BEAM_CRIT_MULTIPLIER, PLASMA_BEAM_PER_HIT_MULTIPLIER};
use std::collections::BTreeMap;

fn plasma_beam_profile() -> SimpleBreathProfile {
    let mut breath = default_breath();
    // dps_pct=2 -> per-tick = base x 2.0 x 0.5 = base x 1.0 (no crit yet).
    // crit_chance_pct=35 at the global 1.5x crit -> 1 + 0.35 x 0.5 = 1.175.
    breath.dps_pct = 2.0;
    breath.capacity = 1.5; // 3 ticks x 0.5 capacity/tick = one charge
    breath.regen_rate = 0.0; // unused for plasma_beam - charges replace the standard regen
    breath.crit_chance_pct = 35.0;
    breath.special_kind = Some("plasma_beam".to_string());
    breath.auto_fire_delay_sec = 0.8; // 0.8 s startup per charge
    breath.auto_fire_cooldown_sec = 2.5; // 2.5 s recast from each charge's start
    breath.charges_max = 3.0; // 3 charges at start
    breath.charge_regen_sec = 40.0; // 1 charge / 40 s
    breath.special_statuses = vec![applied_status("Slow_Status", 1.0)];
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
fn per_tick_damage_matches_formula() {
    // [REF:ability_plasma_beam]
    // Bullet 7: "Breath damage per tick is calculated as (((target max HP × (1
    // + min(attacker effective weight / defender effective weight, 3))) / 2) /
    // 100) × 2.0 × 0.5 × 1.175 × (1 - breath resistance)." 35% pseudo-crit at
    // the global 1.5x crit folds to 1.175.
    let mut attacker = default_combatant();
    attacker.weight = 200.0;
    let mut defender = default_combatant();
    defender.health = 4_000.0;
    defender.weight = 100.0;
    defender.breath_resistance = 0.20;
    let breath = plasma_beam_profile();
    let mut chain = 0.0;
    let actual = compute_simple_breath_damage_with_actor_and_target_statuses(
        &attacker, &defender, &breath, &mut chain,
        &BTreeMap::new(), &BTreeMap::new(),
    );
    let weight_ratio = attacker.weight / defender.weight;
    let base = (defender.health * (1.0 + weight_ratio)) / 2.0 / 100.0;
    let expected = base
        * PLASMA_BEAM_PER_HIT_MULTIPLIER
        * 0.5
        * PLASMA_BEAM_CRIT_MULTIPLIER
        * (1.0 - defender.breath_resistance);
    assert!(
        (actual - expected).abs() < 1e-9,
        "Plasma Beam per-tick damage mismatch: expected {expected}, got {actual}"
    );
}

#[test]
fn first_charge_fires_three_ticks_after_startup() {
    // [REF:ability_plasma_beam]
    // First scheduler call lands at t=0.5 (the standard 2-Hz breath
    // tick); that's when step 2 of `tick_breath_plasma` consumes the
    // first charge, refills capacity to 1.5, and arms the 0.8 s startup
    // delay (delay_until = 0.5 + 0.8 = 1.3). On the 0.5 s grid the next
    // call at t=1.0 is still inside the delay; the first damage tick
    // lands at t=1.5, followed by 2.0 and 2.5.
    let attacker = passive_combatant(1_000.0);
    let defender = passive_combatant(10_000_000.0);
    let breath = plasma_beam_profile();
    let result = simulate_composable_matchup_with_trace(
        &attacker, &defender,
        Some(&breath), None,
        SimpleAbilityTimingMode::Fast,
        &ComposableAbilityConfig::default(),
        2.9, // just past the third tick of the first charge
        true,
    );
    let log = result.combat_log.expect("trace log");
    let breath_ticks: Vec<f64> = log
        .iter()
        .filter(|e| e.entry_type == "breath" && e.attacker == "A")
        .map(|e| e.time)
        .collect();
    assert_eq!(
        breath_ticks.len(),
        3,
        "first charge must emit exactly 3 ticks before t=3.0: {breath_ticks:?}"
    );
    assert!(
        (breath_ticks[0] - 1.5).abs() < 1e-9,
        "first Plasma tick must land at t=1.5 (0.5 s first scheduler step + 0.8 s startup, rounded up to the 0.5 s grid), got {}",
        breath_ticks[0]
    );
    assert!(
        (breath_ticks[2] - 2.5).abs() < 1e-9,
        "third Plasma tick must land at t=2.5, got {}",
        breath_ticks[2]
    );
}

#[test]
fn three_charges_fire_on_the_recast_cadence() {
    // [REF:ability_plasma_beam]
    // All 3 starting charges fire in sequence, each gated by the 2.5 s
    // recast measured from the previous charge's start. On the 0.5 s
    // scheduler that recast coincides with the natural startup+firing
    // cadence, so the expected ticks are:
    //   charge 1 (starts t=0.5, delay->1.5): 1.5, 2.0, 2.5
    //   charge 2 (starts t=3.0, delay->4.0): 4.0, 4.5, 5.0
    //   charge 3 (starts t=5.5, delay->6.5): 6.5, 7.0, 7.5
    // Total: 9 ticks within 7.5 s; nothing further until the 40 s
    // charge regen kicks in.
    let attacker = passive_combatant(1_000.0);
    let defender = passive_combatant(10_000_000.0);
    let breath = plasma_beam_profile();
    let result = simulate_composable_matchup_with_trace(
        &attacker, &defender,
        Some(&breath), None,
        SimpleAbilityTimingMode::Fast,
        &ComposableAbilityConfig::default(),
        9.0,
        true,
    );
    let log = result.combat_log.expect("trace log");
    let breath_ticks: Vec<f64> = log
        .iter()
        .filter(|e| e.entry_type == "breath" && e.attacker == "A")
        .map(|e| e.time)
        .collect();
    assert_eq!(
        breath_ticks.len(),
        9,
        "3 starting charges must emit 9 ticks total within 9 s: {breath_ticks:?}"
    );
    // First charge window (<=2.5 s) holds exactly 3 ticks.
    let charge1: Vec<f64> = breath_ticks.iter().copied().filter(|&t| t <= 2.5 + 1e-9).collect();
    assert_eq!(
        charge1.len(),
        3,
        "first charge must emit 3 ticks ending by t=2.5: {breath_ticks:?}"
    );
    // After the 9th tick (t=7.5), no further ticks until ~t=41.5.
    assert!(
        (breath_ticks[8] - 7.5).abs() < 1e-9,
        "ninth tick (end of charge 3) must land at t=7.5, got {}",
        breath_ticks[8]
    );
}

#[test]
fn after_all_charges_spent_waits_forty_seconds_for_next_charge() {
    // [REF:ability_plasma_beam]
    // The 40 s charge-regen timer starts when the very first charge is
    // consumed (t=0.5 in the scheduler). At t=40.5 the timer fires, +1
    // charge, capacity refills, and the 1 s startup delay arms. First
    // regen-charge tick lands at t=41.5.
    let attacker = passive_combatant(1_000.0);
    let defender = passive_combatant(10_000_000.0);
    let breath = plasma_beam_profile();
    let result = simulate_composable_matchup_with_trace(
        &attacker, &defender,
        Some(&breath), None,
        SimpleAbilityTimingMode::Fast,
        &ComposableAbilityConfig::default(),
        45.0,
        true,
    );
    let log = result.combat_log.expect("trace log");
    let breath_ticks: Vec<f64> = log
        .iter()
        .filter(|e| e.entry_type == "breath" && e.attacker == "A")
        .map(|e| e.time)
        .collect();
    // 9 ticks in first 8 s, then nothing until ~t=41.5.
    let burst_ticks = breath_ticks.iter().take_while(|&&t| t <= 10.0).count();
    assert_eq!(
        burst_ticks, 9,
        "first 10 s must contain exactly 9 ticks (3 charges): {breath_ticks:?}"
    );
    let regen_ticks: Vec<f64> = breath_ticks.iter().copied().filter(|&t| t > 10.0).collect();
    assert!(
        !regen_ticks.is_empty(),
        "must fire again after the 40 s charge regen: {breath_ticks:?}"
    );
    let first_regen_tick = regen_ticks[0];
    assert!(
        (40.5..=42.5).contains(&first_regen_tick),
        "first regen-charge tick must land in the [40.5, 42.5] window (1 s startup after the 40 s regen): got {first_regen_tick}"
    );
}

#[test]
fn applies_slowed_and_deals_no_damage_over_time() {
    // [REF:ability_plasma_beam]
    // Bullet 8: Slowed is the only listed secondary and its 100% chance
    // is not rolled, so it lands as 1 expected stack per tick. Slowed
    // carries no tick damage, so a burst produces no DOT events.
    let breath = plasma_beam_profile();
    assert_eq!(
        breath.special_statuses.len(),
        1,
        "Plasma Beam carries Slowed alone, got {:?}",
        breath.special_statuses
    );
    let attacker = passive_combatant(1_000.0);
    let defender = passive_combatant(10_000_000.0);
    let result = simulate_composable_matchup_with_trace(
        &attacker, &defender,
        Some(&breath), None,
        SimpleAbilityTimingMode::Fast,
        &ComposableAbilityConfig::default(),
        9.0,
        true,
    );
    let log = result.combat_log.expect("trace log");
    assert!(
        log.iter().any(|e| e.status_id.as_deref() == Some("Slow_Status")),
        "Plasma Beam must apply Slow_Status while firing"
    );
    let dot_count = log
        .iter()
        .filter(|e| e.entry_type == "dot" && e.attacker == "A")
        .count();
    assert_eq!(
        dot_count, 0,
        "Plasma Beam must not produce DOT events: got {dot_count}"
    );
}

#[test]
fn each_tick_applies_the_slowed_stacks_the_entry_states() {
    // [REF:ability_plasma_beam]
    // "Every damage tick applies 1 stack of Slowed".
    let applied = stacks_from_one_breath_tick(&plasma_beam_profile());
    assert_tick_stacks(&applied, "Slow_Status", 1.0);
}
