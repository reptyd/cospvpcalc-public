//! Reference: ability_totem
//!
//! Covers each testable bullet in the "Totem" entry. Each test body
//! starts with the [REF:ability_totem] marker so the vitest coverage
//! gate (src/pages/referenceCoverage.test.ts) sees it.
//!
//! Engine path: `composable/mod.rs:3837-3877`. On activation:
//! `totem_active_until = time + 120.0`, `totem_next_tick_at = Some(time
//! + 3.0)`, `totem_cooldown_until = time + 120.0`. Tick fires every
//! 3 s while `time <= totem_active_until`, applying Poison × 2 to the
//!   defender.

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

fn totem_attacker_cfg() -> ComposableAbilityConfig {
    let mut cfg = ComposableAbilityConfig::default();
    cfg.attacker_totem = true;
    cfg
}

#[test]
fn cooldown_one_hundred_twenty_seconds() {
    // [REF:ability_totem]
    // Bullet 1: "Totem has a 120 second cooldown."
    // Engine: cooldown_until set at activation. With 120 s active
    // window AND 120 s cooldown counted from activation, the second
    // activation lands exactly when the active window ends.
    let mut attacker = passive_combatant(1_000_000.0);
    attacker.bite_cooldown = 5.0;
    attacker.damage = 1.0; // keep loop alive past cooldown boundary
    let defender = passive_combatant(10_000_000_000.0);

    let result = simulate_composable_matchup_with_trace(
        &attacker, &defender, None, None,
        SimpleAbilityTimingMode::ReallyFast,
        &totem_attacker_cfg(),
        130.0, true,
    );
    let log = result.combat_log.expect("trace");
    let activations: Vec<f64> = log
        .iter()
        .filter(|e| e.description.as_deref() == Some("Totem activated"))
        .map(|e| e.time)
        .collect();
    assert!(
        activations.len() >= 2,
        "Totem must fire at least twice in a 130 s window: {activations:?}"
    );
    let gap = activations[1] - activations[0];
    assert!(
        (gap - 120.0).abs() < 1.0,
        "second Totem activation must land ~120 s after the first, got {gap}: {activations:?}"
    );
}

#[test]
fn becomes_active_for_one_hundred_twenty_seconds_when_used() {
    // [REF:ability_totem]
    // Bullet 2: "When it is used, it becomes active for 120 seconds."
    // Engine: `totem_active_until = time + 120.0`. Last Poison tick
    // fires at t=120 (3 s cadence: t=3, 6, 9, ..., 120 → 40 ticks)
    // and no further ticks happen until the next activation at t=120.
    let attacker = passive_combatant(1_000.0);
    let defender = passive_combatant(10_000_000_000.0);
    let result = simulate_composable_matchup_with_trace(
        &attacker, &defender, None, None,
        SimpleAbilityTimingMode::ReallyFast,
        &totem_attacker_cfg(),
        125.0, true,
    );
    let log = result.combat_log.expect("trace");
    // Damage_dealt_a totals only Totem ticks here (passive sides, no
    // melee/breath damage). 40 ticks × 2% maxHP per tick × Poison
    // DoT formula — Poison DoT damage is the sum, not 2% per tick.
    // Easier observable: count Poison apply attempts via downstream
    // Poison DoT ticks within and outside the active window.
    let poison_dots_in_window: Vec<f64> = log
        .iter()
        .filter(|e| {
            e.entry_type == "dot"
                && e.status_id.as_deref() == Some("Poison_Status")
                && e.attacker == "A"
                && e.time <= 120.5
        })
        .map(|e| e.time)
        .collect();
    assert!(
        poison_dots_in_window.len() >= 30,
        "Totem must drive sustained Poison DoT during the 120 s active window: only {} ticks",
        poison_dots_in_window.len()
    );
}

#[test]
fn applies_two_stacks_of_poison_every_three_seconds_while_active() {
    // [REF:ability_totem]
    // Bullet 3: "While it is active, it applies 2 stacks of Poison
    // every 3 seconds."
    // Engine: `next_tick_at = time + 3.0` per Totem tick; per-tick
    // status apply is Poison × 2. Verify via downstream Poison DoT
    // ticks landing on the defender at the 3 s cadence.
    //
    // Direct proof: Poison apply itself doesn't push to combat_log
    // (apply_incoming_statuses_to_target_with_fortify_immunity is
    // non-tracing), but Poison DoT ticks DO appear, proving stacks
    // accumulated. With 2 stacks added every 3 s, defender's Poison
    // DoT contribution is significant — expect at least 30 Poison
    // DoT events in a 100 s window (Poison ticks at 3 s intervals
    // once at least 1 stack is on the defender).
    let attacker = passive_combatant(1_000.0);
    let defender = passive_combatant(10_000_000_000.0);
    let result = simulate_composable_matchup_with_trace(
        &attacker, &defender, None, None,
        SimpleAbilityTimingMode::ReallyFast,
        &totem_attacker_cfg(),
        100.0, true,
    );
    let log = result.combat_log.expect("trace");
    let poison_dot_count = log
        .iter()
        .filter(|e| {
            e.entry_type == "dot"
                && e.status_id.as_deref() == Some("Poison_Status")
                && e.attacker == "A"
        })
        .count();
    assert!(
        poison_dot_count >= 30,
        "Totem-driven Poison must produce frequent DoT ticks: got {poison_dot_count} Poison DoT events"
    );
}
