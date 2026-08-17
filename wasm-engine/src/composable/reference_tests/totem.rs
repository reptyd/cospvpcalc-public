//! Reference: ability_totem
//!
//! Covers each testable bullet in the "Totem" entry. Each test body
//! starts with the [REF:ability_totem] marker so the vitest coverage
//! gate (src/pages/referenceCoverage.test.ts) sees it.
//!
//! Engine path: `composable/phases/phase4.rs` (Phase 4o: Totem). On
//! activation: `totem_active_until = time + TOTEM_ACTIVE_WINDOW_SEC` (30),
//! `totem_next_tick_at = Some(time + 3.0)`, `totem_cooldown_until = time +
//! scale_active_cooldown(stats, TOTEM_COOLDOWN_SEC)`. A tick fires
//! every 3 s while `time <= totem_active_until`, applying Poison x 2 to the
//! defender.

use super::super::config::ComposableAbilityConfig;
use super::super::simulate_composable_matchup_with_trace;
use super::default_combatant;
use crate::contracts::{SimpleAbilityTimingMode, SimpleCombatantStats};
use crate::spec_constants::{TOTEM_ACTIVE_WINDOW_SEC, TOTEM_COOLDOWN_SEC};

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
fn cooldown_runs_the_length_the_entry_states() {
    // [REF:ability_totem]
    // Bullet 1: the cooldown the entry states, read from the generated
    // constant so the two cannot drift.
    // The cooldown is counted from activation; with only a 30 s active window
    // the second activation is gated by the cooldown and lands one
    // cooldown after the first (long after the window closes at 30 s).
    // A genuine mutual fight (both bite for real, huge HP pools) so the loop
    // keeps running with meaningful events all the way to the cooldown - a
    // sparse "totem vs passive dummy" sim ends as soon as the 30 s window's
    // ticks stop, before the cooldown could lapse.
    let mut attacker = passive_combatant(1_000_000.0);
    attacker.bite_cooldown = 1.0;
    attacker.damage = 100.0;
    let mut defender = passive_combatant(1_000_000.0);
    defender.bite_cooldown = 1.0;
    defender.damage = 100.0;

    let result = simulate_composable_matchup_with_trace(
        &attacker, &defender, None, None,
        SimpleAbilityTimingMode::ReallyFast,
        &totem_attacker_cfg(),
        320.0, true,
    );
    let log = result.combat_log.expect("trace");
    let activations: Vec<f64> = log
        .iter()
        .filter(|e| e.description.as_deref() == Some("Totem activated"))
        .map(|e| e.time)
        .collect();
    assert!(
        activations.len() >= 2,
        "Totem must fire at least twice in a 320 s window: {activations:?}"
    );
    let gap = activations[1] - activations[0];
    assert!(
        (gap - TOTEM_COOLDOWN_SEC).abs() < 1.0,
        "second Totem activation must land ~{TOTEM_COOLDOWN_SEC} s after the first, got {gap}: {activations:?}"
    );
}

#[test]
fn becomes_active_for_thirty_seconds_when_used() {
    // [REF:ability_totem]
    // Bullet 2: "When it is used, it becomes active for 30 seconds."
    // Engine: `totem_active_until = time + 30`. Poison applies on the 3 s
    // cadence only inside the window (t=3, 6, ..., 30), then stops until the
    // next activation one cooldown later - leaving a long poison-free gap.
    let mut attacker = passive_combatant(1_000.0);
    attacker.bite_cooldown = 5.0;
    attacker.damage = 1.0; // keep the loop alive through the post-window gap
    let defender = passive_combatant(10_000_000_000.0);
    let result = simulate_composable_matchup_with_trace(
        &attacker, &defender, None, None,
        SimpleAbilityTimingMode::ReallyFast,
        &totem_attacker_cfg(),
        320.0, true,
    );
    let log = result.combat_log.expect("trace");
    let poison_dot_times: Vec<f64> = log
        .iter()
        .filter(|e| {
            e.entry_type == "dot"
                && e.status_id.as_deref() == Some("Poison_Status")
                && e.attacker == "A"
        })
        .map(|e| e.time)
        .collect();
    let in_window = poison_dot_times
        .iter()
        .filter(|&&t| t <= TOTEM_ACTIVE_WINDOW_SEC + 5.0)
        .count();
    assert!(
        in_window >= 6,
        "Totem must drive sustained Poison inside its {TOTEM_ACTIVE_WINDOW_SEC} s window: only {in_window} ticks"
    );
    // The quiet stretch runs from the moment the window's Poison pile has
    // drained to the moment the cooldown lapses. The pile is two stacks every
    // three seconds for the whole window and sheds one stack every three, so it
    // takes about twice the window to clear; both bounds follow the constants
    // rather than being typed in against one particular cooldown.
    let gap_start = TOTEM_ACTIVE_WINDOW_SEC * 3.0 + 10.0;
    let gap_end = TOTEM_COOLDOWN_SEC - 10.0;
    let in_gap = poison_dot_times
        .iter()
        .filter(|&&t| (gap_start..=gap_end).contains(&t))
        .count();
    assert_eq!(
        in_gap, 0,
        "Totem window must close: no Poison between the window and the next activation, got {in_gap}"
    );
}

#[test]
fn applies_two_stacks_of_poison_every_three_seconds_while_active() {
    // [REF:ability_totem]
    // Bullet 3: "While it is active, it applies 2 stacks of an ailment every 3
    // seconds." The cadence is unchanged at 3 s; verify via the downstream
    // Poison DoT ticks the 2-stack applications produce on the defender during
    // the active window.
    let attacker = passive_combatant(1_000.0);
    let defender = passive_combatant(10_000_000_000.0);
    let result = simulate_composable_matchup_with_trace(
        &attacker, &defender, None, None,
        SimpleAbilityTimingMode::ReallyFast,
        &totem_attacker_cfg(),
        40.0, true,
    );
    let log = result.combat_log.expect("trace");
    let poison_dots: Vec<(f64, f64)> = log
        .iter()
        .filter(|e| {
            e.entry_type == "dot"
                && e.status_id.as_deref() == Some("Poison_Status")
                && e.attacker == "A"
        })
        .map(|e| (e.time, e.damage))
        .collect();
    // Counting ticks says nothing about how many stacks each application
    // carried - one stack per 3 s would produce the same number of them.
    // Poison's DoT scales with the stack count, so each tick's damage
    // reports the stacks standing at that moment: two land every 3 s and
    // one decays away, so the k-th tick (t = 3k + 6, the first one being
    // preceded by two applications) sits on 2(k + 2) - (k + 1) stacks.
    let applied_per_tick = 2.0;
    let rising: Vec<&(f64, f64)> = poison_dots
        .iter()
        .filter(|(t, _)| *t <= TOTEM_ACTIVE_WINDOW_SEC)
        .collect();
    assert!(
        rising.len() >= 6,
        "Totem must keep applying Poison across its active window: {poison_dots:?}"
    );
    for (k, (time, damage)) in rising.iter().enumerate() {
        let k = k as f64;
        let expected_stacks = applied_per_tick * (k + 2.0) - (k + 1.0);
        let expected = crate::statuses::compute_simple_dot_damage(
            defender.health,
            "Poison_Status",
            expected_stacks,
        );
        assert!(
            (damage - expected).abs() < 1e-6,
            "the Totem tick at t={time} must stand on {expected_stacks} Poison stacks \
             ({applied_per_tick} applied every 3 s, one decaying): expected {expected} damage, \
             got {damage} - all ticks {poison_dots:?}"
        );
    }
}
