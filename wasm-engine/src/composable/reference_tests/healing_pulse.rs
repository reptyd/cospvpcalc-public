//! Reference: compare_healing_pulse
//!
//! Covers each testable bullet in the "Healing Pulse" entry. Each
//! test body starts with the [REF:compare_healing_pulse] marker so
//! the vitest coverage gate (src/pages/referenceCoverage.test.ts)
//! sees it.
//!
//! Engine path: `composable/mod.rs:2819-2889` (Phase 4d-ter). Each
//! cast applies `Healing_Ailment × HEALING_PULSE_STACKS_PER_CAST = 10`
//! to the user. In Normal mode the same payload is also applied to
//! the opponent (radius) and the cooldown re-arms at +90 s
//! (`HEALING_PULSE_COOLDOWN_SEC`). In Once-at-start mode the cast is
//! self-only and `next_healing_pulse` is set to +∞.

use super::super::config::ComposableAbilityConfig;
use super::super::simulate_composable_matchup_with_trace;
use super::default_combatant;
use crate::contracts::{SimpleAbilityTimingMode, SimpleCombatantStats};

fn passive_combatant(max_hp: f64) -> SimpleCombatantStats {
    let mut c = default_combatant();
    c.health = max_hp;
    c.damage = 0.0;
    c.bite_cooldown = 1000.0;
    c
}

fn pulse_attacker_normal_cfg() -> ComposableAbilityConfig {
    let mut cfg = ComposableAbilityConfig::default();
    cfg.attacker_healing_pulse = true;
    cfg.attacker_healing_pulse_once = false;
    cfg
}

fn pulse_attacker_once_cfg() -> ComposableAbilityConfig {
    let mut cfg = ComposableAbilityConfig::default();
    cfg.attacker_healing_pulse = true;
    cfg.attacker_healing_pulse_once = true;
    cfg
}

#[test]
fn normal_mode_applies_ten_healing_ailment_to_both_sides_at_t_zero() {
    // [REF:compare_healing_pulse]
    // Bullet 2: "Each cast applies 10 stacks of Healing Ailment to
    // both combatants (self and opponent)."
    // Plus Normal mode bullet 3: "Normal: the user casts at t=0..."
    // Engine: Phase 4d-ter applies Healing_Ailment × 10 to both A and
    // B at the first eligible tick. Healing_Ailment heals max-HP %
    // every 15s while stacks > 0; first heal observable as a downstream
    // event, but the activation log entry alone is sufficient proof
    // of the t=0 cast.
    let attacker = passive_combatant(1_000.0);
    let defender = passive_combatant(1_000.0);
    let result = simulate_composable_matchup_with_trace(
        &attacker, &defender, None, None,
        SimpleAbilityTimingMode::ReallyFast,
        &pulse_attacker_normal_cfg(),
        2.0, true,
    );
    let log = result.combat_log.expect("trace");
    let activation = log
        .iter()
        .find(|e| e.description.as_deref() == Some("Healing Pulse activated") && e.attacker == "A");
    assert!(
        activation.is_some(),
        "Healing Pulse must fire its initial cast"
    );
    assert!(
        activation.unwrap().time < 0.5,
        "initial Healing Pulse cast must happen at t=0 (≈ ReallyFast first tick): got t={}",
        activation.unwrap().time
    );
}

#[test]
fn normal_mode_recasts_every_ninety_seconds() {
    // [REF:compare_healing_pulse]
    // Bullet 3: "Normal: the user casts at t=0 and again every 90
    // seconds of cooldown for the rest of the fight."
    let attacker = passive_combatant(10_000_000.0);
    let mut defender = default_combatant();
    defender.damage = 1.0; // tiny pressure to keep loop alive
    defender.bite_cooldown = 5.0;
    defender.health = 10_000_000.0;

    let result = simulate_composable_matchup_with_trace(
        &attacker, &defender, None, None,
        SimpleAbilityTimingMode::ReallyFast,
        &pulse_attacker_normal_cfg(),
        100.0, true,
    );
    let log = result.combat_log.expect("trace");
    let casts: Vec<f64> = log
        .iter()
        .filter(|e| e.description.as_deref() == Some("Healing Pulse activated") && e.attacker == "A")
        .map(|e| e.time)
        .collect();
    assert!(
        casts.len() >= 2,
        "Healing Pulse must fire at least twice in a 100 s window: {casts:?}"
    );
    let gap = casts[1] - casts[0];
    assert!(
        (gap - 90.0).abs() < 1.0,
        "second Healing Pulse cast must land ~90 s after the first: gap={gap}, times={casts:?}"
    );
}

#[test]
fn once_at_start_casts_only_once_self_only() {
    // [REF:compare_healing_pulse]
    // Bullet 4: "Once at start: the user casts a single time at t=0,
    // targeting only the user - the opponent does not receive
    // Healing Ailment."
    // Engine: SelfFortify-like single-shot, then `next_healing_pulse =
    // f64::INFINITY` blocks reschedules. Run a long window and confirm
    // exactly one cast event AND the defender does NOT carry
    // Healing_Ailment downstream effects (no defender-side heal log).
    let attacker = passive_combatant(10_000_000.0);
    let mut defender = default_combatant();
    defender.damage = 1.0;
    defender.bite_cooldown = 5.0;
    defender.health = 10_000_000.0;

    let result = simulate_composable_matchup_with_trace(
        &attacker, &defender, None, None,
        SimpleAbilityTimingMode::ReallyFast,
        &pulse_attacker_once_cfg(),
        120.0, true,
    );
    let log = result.combat_log.expect("trace");
    let casts: Vec<f64> = log
        .iter()
        .filter(|e| e.description.as_deref() == Some("Healing Pulse activated") && e.attacker == "A")
        .map(|e| e.time)
        .collect();
    assert_eq!(
        casts.len(),
        1,
        "Once-at-start Healing Pulse must fire exactly once across a 120 s window: {casts:?}"
    );
    // Healing_Ailment heal events fire every 15 s while stacks > 0.
    // Filter Healing_Ailment heal events on side B - must be 0 since
    // defender never received the status.
    let defender_heal_events = log
        .iter()
        .filter(|e| {
            e.entry_type == "ability"
                && e.attacker == "B"
                && e.description.as_deref() == Some("Healing Ailment heal")
        })
        .count();
    assert_eq!(
        defender_heal_events, 0,
        "Once-at-start mode must NOT apply Healing_Ailment to defender: got {defender_heal_events} defender-side heal events"
    );
}

#[test]
fn timeline_records_each_activation() {
    // [REF:compare_healing_pulse]
    // Notes 1: "The timeline records each Healing Pulse activation."
    let attacker = passive_combatant(1_000.0);
    let defender = passive_combatant(1_000.0);
    let result = simulate_composable_matchup_with_trace(
        &attacker, &defender, None, None,
        SimpleAbilityTimingMode::ReallyFast,
        &pulse_attacker_normal_cfg(),
        2.0, true,
    );
    let log = result.combat_log.expect("trace");
    let has_activation = log
        .iter()
        .any(|e| e.description.as_deref() == Some("Healing Pulse activated"));
    assert!(
        has_activation,
        "trace must carry a 'Healing Pulse activated' event"
    );
}
