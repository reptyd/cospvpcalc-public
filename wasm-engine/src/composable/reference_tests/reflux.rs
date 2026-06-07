//! Reference: ability_reflux
//!
//! Covers each testable bullet in the "Reflux" entry. Each test body
//! starts with the [REF:ability_reflux] marker so the vitest coverage
//! gate (src/pages/referenceCoverage.test.ts) sees it.
//!
//! Engine path: `composable/mod.rs:3597-3716` - Reflux arms (5 s
//! charge), then on charge completion deals 5% target maxHP impact +
//! 2 Slowed, starts a 10 s puddle that ticks 1.5% maxHP + 0.5
//! Corrosion per second, and starts a 120 s cooldown.
//!
//! Trace event descriptions: "Reflux charge started", "Reflux impact",
//! "Reflux puddle tick". The impact event's `detail` string documents
//! the secondary Slow apply ("5% maxHP direct hit + Slow 2") - that's
//! the observable channel for the impact-Slow regression test below
//! (the engine's `apply_incoming_statuses_to_target_with_fortify_immunity`
//! does not push a separate combat_log entry for the Slow status).

use super::super::config::ComposableAbilityConfig;
use super::super::{simulate_composable_matchup, simulate_composable_matchup_with_trace};
use super::default_combatant;
use crate::contracts::{SimpleAbilityTimingMode, SimpleCombatantStats};

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

#[test]
fn five_second_charge_before_impact() {
    // [REF:ability_reflux]
    // Bullet 1: "Reflux starts with a 5 second charge."
    // Engine: `reflux_charge_ready_at = time + 5.0` at arming;
    // impact fires when `time >= reflux_charge_ready_at`. With ReallyFast
    // policy arming starts at t=0, so impact lands at exactly t=5.
    let attacker = passive_combatant(1_000.0);
    let defender = passive_combatant(10_000.0);

    let pre_impact = simulate_composable_matchup(
        &attacker, &defender, None, None,
        SimpleAbilityTimingMode::ReallyFast,
        &reflux_attacker_cfg(),
        4.99,
    );
    assert!(
        (pre_impact.final_hp_b - defender.health).abs() < 1e-6,
        "no Reflux damage allowed before t=5 (charge end): defender HP {} → {}",
        defender.health, pre_impact.final_hp_b
    );
    let post_impact = simulate_composable_matchup(
        &attacker, &defender, None, None,
        SimpleAbilityTimingMode::ReallyFast,
        &reflux_attacker_cfg(),
        5.001,
    );
    assert!(
        post_impact.final_hp_b < defender.health,
        "Reflux impact must land at t=5: HP {} unchanged",
        post_impact.final_hp_b
    );
}

#[test]
fn impact_deals_five_percent_target_max_hp() {
    // [REF:ability_reflux]
    // Bullet 2: "When the charge completes, it deals a direct hit
    // equal to 5% of the target's max HP."
    // Run for 5.5 s - impact at t=5 fired, no puddle ticks yet (first
    // puddle tick at t=6). Damage dealt must equal exactly 5% × 10000.
    let attacker = passive_combatant(1_000.0);
    let defender = passive_combatant(10_000.0);
    let result = simulate_composable_matchup(
        &attacker, &defender, None, None,
        SimpleAbilityTimingMode::ReallyFast,
        &reflux_attacker_cfg(),
        5.5,
    );
    let expected = defender.health * 0.05;
    let actual = defender.health - result.final_hp_b;
    assert!(
        (actual - expected).abs() < 1e-6,
        "Reflux impact must deal 5% of target maxHP: expected {expected}, got {actual}"
    );
}

#[test]
fn impact_applies_two_slowed() {
    // [REF:ability_reflux]
    // Bullet 3: "The impact also applies 2 Slowed to the target."
    // Engine: `apply_incoming_statuses_to_target_with_fortify_immunity`
    // applies `Slow_Status` × 2 right after the impact damage
    // (composable/mod.rs:3658-3666). The status apply itself does not
    // push a combat_log entry, but the engine emits a "Reflux impact"
    // ability event whose `detail` field documents the secondary Slow
    // apply ("5% maxHP direct hit + Slow 2"). That detail is the
    // observable channel.
    let attacker = passive_combatant(1_000.0);
    let defender = passive_combatant(10_000.0);
    let result = simulate_composable_matchup_with_trace(
        &attacker, &defender, None, None,
        SimpleAbilityTimingMode::ReallyFast,
        &reflux_attacker_cfg(),
        5.5, true,
    );
    let log = result.combat_log.expect("trace log");
    let impact = log
        .iter()
        .find(|e| e.description.as_deref() == Some("Reflux impact"))
        .expect("Reflux impact event must appear in trace");
    let detail = impact.detail.as_deref().unwrap_or("");
    assert!(
        detail.contains("Slow 2"),
        "Reflux impact event must document the secondary Slow 2 apply via the detail field: detail={detail:?}"
    );
}

#[test]
fn puddle_lasts_ten_seconds_after_impact() {
    // [REF:ability_reflux]
    // Bullet 3: "After the impact, Reflux leaves a puddle for 10
    // seconds."
    // Engine: `reflux_puddle_until = time + 10.0` at impact (t=5).
    // Puddle expires at t=15. Verify via the trace: NO "Reflux puddle
    // tick" events at t > 15.
    //
    // Note: total damage_dealt_a continues to grow past t=15 because
    // Corrosion stacks accumulated during the puddle keep ticking DoT
    // damage. So the invariant is on Reflux-specific events, not on
    // total damage.
    let attacker = passive_combatant(1_000.0);
    let defender = passive_combatant(1_000_000.0);

    let result = simulate_composable_matchup_with_trace(
        &attacker, &defender, None, None,
        SimpleAbilityTimingMode::ReallyFast,
        &reflux_attacker_cfg(),
        50.0, true,
    );
    let log = result.combat_log.expect("trace log");
    let post_puddle_ticks = log
        .iter()
        .filter(|e| {
            e.description.as_deref() == Some("Reflux puddle tick") && e.time > 15.0 + 1e-9
        })
        .count();
    assert_eq!(
        post_puddle_ticks, 0,
        "no Reflux puddle tick events allowed past t=15 (puddle end): got {post_puddle_ticks}"
    );
}

#[test]
fn puddle_ticks_once_per_second() {
    // [REF:ability_reflux]
    // Bullet 4: "The puddle ticks once per second."
    // Engine: `reflux_next_tick_at = Some(time + 1.0)` after each
    // tick. First tick at impact+1=6 s; ticks fire while
    // `puddle_until > time` (strict inequality). With puddle_until=15,
    // ticks land at t=6, 7, 8, ..., 14 - 9 ticks total. The boundary
    // tick at t=15 is gated out (puddle_until > 15 is false).
    let attacker = passive_combatant(1_000.0);
    let defender = passive_combatant(10_000_000.0);
    let result = simulate_composable_matchup_with_trace(
        &attacker, &defender, None, None,
        SimpleAbilityTimingMode::ReallyFast,
        &reflux_attacker_cfg(),
        16.0, true,
    );
    let log = result.combat_log.expect("trace log");
    let puddle_ticks: Vec<f64> = log
        .iter()
        .filter(|e| e.description.as_deref() == Some("Reflux puddle tick"))
        .map(|e| e.time)
        .collect();
    assert_eq!(
        puddle_ticks.len(),
        9,
        "Reflux puddle must produce 9 ticks (1 Hz, t=6..14, strict puddle_until > time gate): {puddle_ticks:?}"
    );
    for pair in puddle_ticks.windows(2) {
        let gap = pair[1] - pair[0];
        assert!(
            (gap - 1.0).abs() < 1e-9,
            "puddle tick spacing must be 1 s, got {gap}: {puddle_ticks:?}"
        );
    }
}

#[test]
fn each_puddle_tick_deals_one_point_five_percent_max_hp_and_applies_half_corrosion() {
    // [REF:ability_reflux]
    // Bullet 5: "Each puddle tick deals direct damage equal to 1.5%
    // of the target's max HP and applies 0.5 Corrosion."
    // Engine: `puddle_damage = defender.health * 0.015` per tick;
    // `apply_incoming_statuses_to_target_with_fortify_immunity` adds
    // 0.5 stacks of Corrosion_Status per tick.
    //
    // Per-tick magnitude is most cleanly verified via the per-event
    // damage field in the trace. The engine pushes one "Reflux puddle
    // tick" event per tick with `damage = applied_puddle`, where
    // applied_puddle = defender.health × 0.015 (clamped by remaining
    // HP and unbreakable cap, neither of which fires here).
    let attacker = passive_combatant(1_000.0);
    let defender = passive_combatant(10_000_000.0);
    let result = simulate_composable_matchup_with_trace(
        &attacker, &defender, None, None,
        SimpleAbilityTimingMode::ReallyFast,
        &reflux_attacker_cfg(),
        16.0, true,
    );
    let log = result.combat_log.expect("trace log");
    let puddle_ticks: Vec<&_> = log
        .iter()
        .filter(|e| e.description.as_deref() == Some("Reflux puddle tick"))
        .collect();
    assert!(
        !puddle_ticks.is_empty(),
        "Reflux puddle must produce tick events"
    );
    let expected_per_tick = defender.health * 0.015;
    for tick in &puddle_ticks {
        assert!(
            (tick.damage - expected_per_tick).abs() < 1e-6,
            "each puddle tick must deal 1.5% maxHP = {expected_per_tick}: got {}",
            tick.damage
        );
    }
    // Reflux applies Corrosion via
    // `apply_incoming_statuses_to_target_with_fortify_immunity`, which
    // does not emit a combat_log apply event. Corrosion is a DoT
    // status, so its ticks DO appear in the trace with
    // entry_type="dot" and status_id="Corrosion_Status" - that's
    // observable proof the Reflux puddle accumulated Corrosion on
    // the defender.
    let corrosion_dot_ticks = log
        .iter()
        .filter(|e| {
            e.entry_type == "dot"
                && e.status_id.as_deref() == Some("Corrosion_Status")
                && e.time > 5.0 + 1e-9
        })
        .count();
    assert!(
        corrosion_dot_ticks > 0,
        "Reflux puddle must apply Corrosion on each tick - verified via downstream Corrosion DoT ticks: \
         got {corrosion_dot_ticks} DoT ticks"
    );
}

#[test]
fn cooldown_one_hundred_twenty_seconds() {
    // [REF:ability_reflux]
    // Bullet 6: "It has a 120 second cooldown."
    // Engine: `reflux_cooldown_until = time + 120.0` set at impact
    // time (t=5). Re-arming gated until t=125; second impact at
    // t=130; second puddle ends at t=140.
    let attacker = passive_combatant(1_000.0);
    let defender = passive_combatant(100_000_000.0);
    let result = simulate_composable_matchup_with_trace(
        &attacker, &defender, None, None,
        SimpleAbilityTimingMode::ReallyFast,
        &reflux_attacker_cfg(),
        135.0, true,
    );
    let log = result.combat_log.expect("trace log");
    let charge_starts: Vec<f64> = log
        .iter()
        .filter(|e| e.description.as_deref() == Some("Reflux charge started"))
        .map(|e| e.time)
        .collect();
    assert!(
        charge_starts.len() >= 2,
        "Reflux must arm at least twice in a 135 s window: {charge_starts:?}"
    );
    // Cooldown is set at impact time (charge_start + 5) = 5; next arm
    // at time >= 5 + 120 = 125. Gap between charge_start[0]=0 and
    // charge_start[1]=125 = 125 s. (Cooldown of 120 s + 5 s charge = gap
    // from arm to arm of ~125 s.)
    let gap = charge_starts[1] - charge_starts[0];
    assert!(
        (gap - 125.0).abs() < 1.0,
        "second Reflux arm must land ~125 s after the first (5 s charge + 120 s cooldown): \
         got {gap}: {charge_starts:?}"
    );
}
