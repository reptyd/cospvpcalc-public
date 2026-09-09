//! Reference: ability_reflux
//!
//! Covers each testable bullet in the "Reflux" entry. Each test body
//! starts with the [REF:ability_reflux] marker so the vitest coverage
//! gate (src/pages/referenceCoverage.test.ts) sees it.
//!
//! Engine path: `phases/phase4.rs`, the Phase 4n block - Reflux arms a 5 s
//! charge, the puddle appears 0.8 s after it ends with a 5% maxHP hit and 2
//! Slowed, and lasts 10 s, ticking 1.5% maxHP + 0.5 Corrosion once a
//! second. The cooldown runs 120 s from the start of the charge.
//!
//! Trace event descriptions: "Reflux charge started", "Reflux impact",
//! "Reflux puddle tick". The impact event's `detail` string documents
//! the secondary Slow apply ("5% maxHP direct hit + Slow 2") - that's
//! the observable channel for the impact-Slow regression test below
//! (the engine's `apply_incoming_statuses_to_target_with_fortify_immunity`
//! does not push a separate combat_log entry for the Slow status).

use super::super::config::ComposableAbilityConfig;
use super::super::sandbox::{SandboxAutomationMode, SandboxRuntime};
use super::super::{simulate_composable_matchup, simulate_composable_matchup_with_trace};
use super::default_combatant;
use crate::contracts::{SimpleAbilityTimingMode, SimpleCombatantStats};
use crate::spec_constants::{
    REFLUX_AREA_DELAY_SEC, REFLUX_CHARGE_SEC, REFLUX_COOLDOWN_SEC, REFLUX_DURATION_SEC,
    REFLUX_PRIMARY_PCT_MAX_HP, REFLUX_SECONDARY_PCT_MAX_HP, REFLUX_TICK_INTERVAL_SEC,
};

/// The moment the puddle appears, measured from a charge started at t=0.
const PUDDLE_AT: f64 = REFLUX_CHARGE_SEC + REFLUX_AREA_DELAY_SEC;

fn passive_combatant(max_hp: f64) -> SimpleCombatantStats {
    let mut c = default_combatant();
    c.health = max_hp;
    c.damage = 0.0;
    c.bite_cooldown = 1000.0;
    c
}

fn reflux_attacker_cfg() -> ComposableAbilityConfig {
    let mut cfg = ComposableAbilityConfig::default();
    cfg.attacker_reflux = true;
    cfg
}

fn puddle_ticks(sim_seconds: f64, defender_max_hp: f64) -> Vec<crate::contracts::CombatLogEntry> {
    let attacker = passive_combatant(1_000.0);
    let defender = passive_combatant(defender_max_hp);
    let result = simulate_composable_matchup_with_trace(
        &attacker, &defender, None, None,
        SimpleAbilityTimingMode::ReallyFast,
        &reflux_attacker_cfg(),
        sim_seconds, true,
    );
    result
        .combat_log
        .expect("trace log")
        .into_iter()
        .filter(|e| e.description.as_deref() == Some("Reflux puddle tick"))
        .collect()
}

#[test]
fn the_charge_takes_five_seconds_and_the_puddle_follows_zero_point_eight_later() {
    // [REF:ability_reflux]
    // Bullets 1 + 2: "The charge takes 5 seconds."
    // "The puddle appears 0.8 seconds after the charge completes, a figure we chose."
    // With ReallyFast the charge starts at t=0, so nothing has touched the
    // opponent before t=5.8 and the hit has landed just after it.
    let attacker = passive_combatant(1_000.0);
    let defender = passive_combatant(10_000.0);

    let before = simulate_composable_matchup(
        &attacker, &defender, None, None,
        SimpleAbilityTimingMode::ReallyFast,
        &reflux_attacker_cfg(),
        PUDDLE_AT - 0.01,
    );
    assert!(
        (before.final_hp_b - defender.health).abs() < 1e-6,
        "no Reflux damage allowed before t={PUDDLE_AT}: defender HP {} → {}",
        defender.health, before.final_hp_b
    );
    let after = simulate_composable_matchup(
        &attacker, &defender, None, None,
        SimpleAbilityTimingMode::ReallyFast,
        &reflux_attacker_cfg(),
        PUDDLE_AT + 0.001,
    );
    assert!(
        after.final_hp_b < defender.health,
        "the Reflux hit must land at t={PUDDLE_AT}: HP {} unchanged",
        after.final_hp_b
    );
}

#[test]
fn the_hit_deals_five_percent_of_the_opponents_maximum_health() {
    // [REF:ability_reflux]
    // Bullet 3: "When the puddle appears, the opponent takes damage equal to
    // 5% of the opponent's maximum health."
    let attacker = passive_combatant(1_000.0);
    let defender = passive_combatant(10_000.0);
    let result = simulate_composable_matchup_with_trace(
        &attacker, &defender, None, None,
        SimpleAbilityTimingMode::ReallyFast,
        &reflux_attacker_cfg(),
        PUDDLE_AT + 0.5, true,
    );
    let log = result.combat_log.expect("trace log");
    let impact = log
        .iter()
        .find(|e| e.description.as_deref() == Some("Reflux impact"))
        .expect("Reflux impact event must appear in trace");
    let expected = defender.health * REFLUX_PRIMARY_PCT_MAX_HP / 100.0;
    assert!(
        (impact.damage - expected).abs() < 1e-6,
        "the Reflux hit must deal {REFLUX_PRIMARY_PCT_MAX_HP}% of the opponent's maximum health: expected {expected}, got {}",
        impact.damage
    );
    assert!(
        (impact.time - PUDDLE_AT).abs() < 1e-6,
        "the hit lands when the puddle appears, at t={PUDDLE_AT}: got {}",
        impact.time
    );
}

#[test]
fn the_puddle_applies_two_slowed_when_it_appears() {
    // [REF:ability_reflux]
    // Bullet 4: "The puddle applies 2 stacks of Slowed to the opponent when it
    // appears."
    // The status apply itself does not push a combat_log entry, but the engine
    // emits a "Reflux impact" ability event whose `detail` field documents the
    // secondary Slow apply ("5% maxHP direct hit + Slow 2"). That detail is the
    // observable channel.
    let attacker = passive_combatant(1_000.0);
    let defender = passive_combatant(10_000.0);
    let result = simulate_composable_matchup_with_trace(
        &attacker, &defender, None, None,
        SimpleAbilityTimingMode::ReallyFast,
        &reflux_attacker_cfg(),
        PUDDLE_AT + 0.5, true,
    );
    let log = result.combat_log.expect("trace log");
    let impact = log
        .iter()
        .find(|e| e.description.as_deref() == Some("Reflux impact"))
        .expect("Reflux impact event must appear in trace");
    let detail = impact.detail.as_deref().unwrap_or("");
    assert!(
        detail.contains("Slow 2"),
        "the Reflux impact event must document the secondary Slow 2 apply via the detail field: detail={detail:?}"
    );
}

#[test]
fn the_puddle_applies_exactly_two_slowed_stacks() {
    // [REF:ability_reflux]
    // Bullet 4 on the count: "The puddle applies 2 stacks of Slowed to the
    // opponent when it appears." The detail string the test above reads is a
    // literal the engine writes out; the stacks are a second, separate literal,
    // so the two can stop agreeing. This reads the stacks off the opponent
    // instead, one step past the impact and before anything has decayed.
    let mut rt = SandboxRuntime::new(
        passive_combatant(1_000.0),
        passive_combatant(10_000.0),
        None,
        None,
        reflux_attacker_cfg(),
        SimpleAbilityTimingMode::ReallyFast,
        SandboxAutomationMode::SemiAuto,
        120.0,
        true,
    );
    rt.step_to_time(PUDDLE_AT + 0.001);
    let slowed = rt
        .snapshot_view()
        .side_b
        .statuses
        .iter()
        .find(|s| s.id == "Slow_Status")
        .map(|s| s.stacks)
        .unwrap_or(0.0);
    assert!(
        (slowed - 2.0).abs() < 1e-9,
        "the Reflux impact must apply 2 stacks of Slowed, got {slowed}"
    );
}

#[test]
fn the_puddle_lasts_ten_seconds_and_ticks_a_second_apart() {
    // [REF:ability_reflux]
    // Bullets 5 + 6 + 7: "The puddle lasts 10 seconds."
    // "Its ticks are 1 second apart."
    // "The first tick lands 1 second after the puddle appears."
    // A puddle that lasts its whole duration ticks on every second of it,
    // the last one at its expiry: with the puddle at t=5.8 the ticks land at
    // t=6.8, 7.8, ..., 15.8, and nothing ticks after that.
    let ticks = puddle_ticks(30.0, 10_000_000.0);
    let times: Vec<f64> = ticks.iter().map(|e| e.time).collect();
    let expected_count = (REFLUX_DURATION_SEC / REFLUX_TICK_INTERVAL_SEC).round() as usize;
    assert_eq!(
        times.len(), expected_count,
        "a puddle of {REFLUX_DURATION_SEC} s at {REFLUX_TICK_INTERVAL_SEC} s a tick carries \
         {expected_count} ticks: {times:?}"
    );
    assert!(
        (times[0] - (PUDDLE_AT + REFLUX_TICK_INTERVAL_SEC)).abs() < 1e-9,
        "the first tick lands {REFLUX_TICK_INTERVAL_SEC} s after the puddle appears: got {}",
        times[0]
    );
    assert!(
        (times[times.len() - 1] - (PUDDLE_AT + REFLUX_DURATION_SEC)).abs() < 1e-9,
        "the last tick lands at the puddle's expiry, at t={}: got {}",
        PUDDLE_AT + REFLUX_DURATION_SEC, times[times.len() - 1]
    );
    for pair in times.windows(2) {
        let gap = pair[1] - pair[0];
        assert!(
            (gap - REFLUX_TICK_INTERVAL_SEC).abs() < 1e-9,
            "tick spacing must be {REFLUX_TICK_INTERVAL_SEC} s, got {gap}: {times:?}"
        );
    }
}

#[test]
fn each_tick_deals_one_point_five_percent_and_applies_half_a_stack_of_corrosion() {
    // [REF:ability_reflux]
    // Bullets 8 + 9: "Each tick deals damage equal to 1.5% of the opponent's
    // maximum health."
    // "Each tick applies 0.5 stacks of Corrosion to the opponent."
    //
    // Per-tick magnitude is read off the per-event damage field in the trace:
    // the engine pushes one "Reflux puddle tick" event per tick with
    // `damage = applied_puddle`, where applied_puddle = defender.health x
    // 0.015 (clamped by remaining HP and the unbreakable cap, neither of which
    // fires here). Corrosion is applied through
    // `apply_incoming_statuses_to_target_with_fortify_immunity`, which pushes
    // no apply event; it is a DoT status, so its own ticks DO appear in the
    // trace and are the observable proof it accumulated.
    let defender_max_hp = 10_000_000.0;
    let ticks = puddle_ticks(30.0, defender_max_hp);
    assert!(!ticks.is_empty(), "the Reflux puddle must produce tick events");
    let expected_per_tick = defender_max_hp * REFLUX_SECONDARY_PCT_MAX_HP / 100.0;
    for tick in &ticks {
        assert!(
            (tick.damage - expected_per_tick).abs() < 1e-6,
            "each tick must deal {REFLUX_SECONDARY_PCT_MAX_HP}% of maximum health = {expected_per_tick}: got {}",
            tick.damage
        );
    }

    let attacker = passive_combatant(1_000.0);
    let defender = passive_combatant(defender_max_hp);
    let result = simulate_composable_matchup_with_trace(
        &attacker, &defender, None, None,
        SimpleAbilityTimingMode::ReallyFast,
        &reflux_attacker_cfg(),
        30.0, true,
    );
    let log = result.combat_log.expect("trace log");
    let corrosion_dot_ticks = log
        .iter()
        .filter(|e| {
            e.entry_type == "dot"
                && e.status_id.as_deref() == Some("Corrosion_Status")
                && e.time > PUDDLE_AT + 1e-9
        })
        .count();
    assert!(
        corrosion_dot_ticks > 0,
        "each puddle tick must apply Corrosion - verified via downstream Corrosion DoT ticks: \
         got {corrosion_dot_ticks} DoT ticks"
    );
}

#[test]
fn the_user_takes_nothing_from_its_own_puddle() {
    // [REF:ability_reflux]
    // Bullets 10 + 11: "The puddle deals no damage to the user."
    // "The puddle applies no Corrosion to the user."
    let mut rt = SandboxRuntime::new(
        passive_combatant(50_000.0),
        passive_combatant(10_000_000.0),
        None,
        None,
        reflux_attacker_cfg(),
        SimpleAbilityTimingMode::ReallyFast,
        SandboxAutomationMode::SemiAuto,
        120.0,
        true,
    );
    let hp_before = rt.snapshot_view().side_a.hp;
    rt.step_to_time(PUDDLE_AT + REFLUX_DURATION_SEC + 0.5);
    let view = rt.snapshot_view();
    assert!(
        view.side_a.hp >= hp_before - 1e-9,
        "the user must lose no health to its own puddle: {hp_before} → {}",
        view.side_a.hp
    );
    assert!(
        !view.side_a.statuses.iter().any(|s| s.id == "Corrosion_Status"),
        "the user must carry no Corrosion from its own puddle"
    );
}

#[test]
fn the_cooldown_runs_one_hundred_twenty_seconds_from_the_start_of_the_charge() {
    // [REF:ability_reflux]
    // Bullets 14 + 15: "The cooldown is 120 seconds."
    // "The cooldown begins at the start of the charge."
    // The first charge starts at t=0, so the second starts at t=120 - not at
    // t=125.8, which is where a cooldown counted from the puddle would put it.
    let attacker = passive_combatant(1_000.0);
    let defender = passive_combatant(100_000_000.0);
    let result = simulate_composable_matchup_with_trace(
        &attacker, &defender, None, None,
        SimpleAbilityTimingMode::ReallyFast,
        &reflux_attacker_cfg(),
        130.0, true,
    );
    let log = result.combat_log.expect("trace log");
    let charge_starts: Vec<f64> = log
        .iter()
        .filter(|e| e.description.as_deref() == Some("Reflux charge started"))
        .map(|e| e.time)
        .collect();
    assert_eq!(
        charge_starts.len(), 2,
        "two charges must start inside 130 s: {charge_starts:?}"
    );
    assert!(
        (charge_starts[1] - REFLUX_COOLDOWN_SEC).abs() < 1e-6,
        "the second charge must start at t={REFLUX_COOLDOWN_SEC}: got {}",
        charge_starts[1]
    );
}

#[test]
fn the_ability_cooldown_multiplier_moves_that_cooldown() {
    // [REF:ability_reflux]
    // Bullet 16: "That cooldown is multiplied by the user's ability cooldown
    // multiplier."
    let mut attacker = passive_combatant(1_000.0);
    attacker.active_cooldown_multiplier = 0.5;
    let defender = passive_combatant(100_000_000.0);
    let result = simulate_composable_matchup_with_trace(
        &attacker, &defender, None, None,
        SimpleAbilityTimingMode::ReallyFast,
        &reflux_attacker_cfg(),
        70.0, true,
    );
    let log = result.combat_log.expect("trace log");
    let charge_starts: Vec<f64> = log
        .iter()
        .filter(|e| e.description.as_deref() == Some("Reflux charge started"))
        .map(|e| e.time)
        .collect();
    assert_eq!(
        charge_starts.len(), 2,
        "a halved cooldown must fit two charges inside 70 s: {charge_starts:?}"
    );
    assert!(
        (charge_starts[1] - REFLUX_COOLDOWN_SEC * 0.5).abs() < 1e-6,
        "a 0.5x multiplier must put the second charge at t={}: got {}",
        REFLUX_COOLDOWN_SEC * 0.5, charge_starts[1]
    );
}
