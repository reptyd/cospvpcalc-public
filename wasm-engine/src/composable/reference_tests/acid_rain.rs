//! Reference: status_acid_rain
//!
//! Covers each testable bullet in the "Acid Rain" entry (a weather
//! cataclysm). Each test body starts with the [REF:status_acid_rain]
//! marker so the vitest coverage gate (src/pages/referenceCoverage.test.ts)
//! sees it.
//!
//! Engine paths:
//! - DoT formula: `statuses.rs` —
//!   `compute_simple_dot_damage(_, "Acid_Rain_Status", _, _) =
//!   max_hp * 3.0 / 100` (= 3% maxHP, stacks-independent).
//! - 3 s tick cadence: `status_tick_sec("Acid_Rain_Status")` returns
//!   `Some(3.0)` from the generated `effects_registry`.
//! - +2 Poison per tick: `statuses.rs` — when Acid_Rain_Status ticks
//!   with `stacks_before > 0`, the side-effects vector pushes
//!   `Poison_Status × 2.0` which the caller re-applies to the target.
//! - Weather seeding + permanence: `composable/setup.rs` seeds a single
//!   `no_decay` stack on each non-immune side when `config.weather ==
//!   "acidRain"`; the stack persists for the whole fight (no decay) while
//!   the tick keeps firing.

use super::super::config::ComposableAbilityConfig;
use super::super::simulate_composable_matchup_with_trace;
use super::default_combatant;
use crate::contracts::{SimpleAbilityTimingMode, SimpleCombatantStats};
use crate::statuses::{compute_simple_dot_damage, status_tick_sec};

fn passive_combatant(max_hp: f64) -> SimpleCombatantStats {
    let mut c = default_combatant();
    c.health = max_hp;
    c.damage = 0.0;
    c.bite_cooldown = 1000.0;
    c
}

fn acid_rain_config() -> ComposableAbilityConfig {
    ComposableAbilityConfig {
        weather: Some("acidRain".to_string()),
        ..Default::default()
    }
}

#[test]
fn deals_three_percent_max_hp_every_three_seconds_stacks_independent() {
    // [REF:status_acid_rain]
    // Bullet 1: "Acid Rain deals 3% max HP damage every 3 seconds,
    // regardless of stack count."
    let tick = status_tick_sec("Acid_Rain_Status");
    assert_eq!(
        tick,
        Some(3.0),
        "Acid_Rain_Status tick cadence must be 3 s: got {tick:?}"
    );
    let dmg_1 = compute_simple_dot_damage(10_000.0, "Acid_Rain_Status", 1.0, 3.0);
    let dmg_5 = compute_simple_dot_damage(10_000.0, "Acid_Rain_Status", 5.0, 3.0);
    let dmg_30 = compute_simple_dot_damage(10_000.0, "Acid_Rain_Status", 30.0, 3.0);
    assert!(
        (dmg_1 - 300.0).abs() < 1e-9,
        "Acid Rain 3% maxHP at any stacks (300 on 10000): got dmg_1={dmg_1}"
    );
    assert!(
        (dmg_5 - 300.0).abs() < 1e-9 && (dmg_30 - 300.0).abs() < 1e-9,
        "Acid Rain damage must be stacks-independent: got dmg_5={dmg_5}, dmg_30={dmg_30}"
    );
}

#[test]
fn weather_seeds_acid_rain_on_both_sides_and_applies_poison() {
    // [REF:status_acid_rain]
    // Bullets 2 + 4: "Each Acid Rain tick also applies 2 stacks of
    // Poison" and "No creature is immune — Acid Rain applies to every
    // creature on the field." With config.weather="acidRain" and no
    // immunity flags, BOTH sides must show Acid Rain ticks AND the
    // resulting Poison ticks.
    let attacker = passive_combatant(10_000_000.0);
    let defender = passive_combatant(10_000_000.0);
    let result = simulate_composable_matchup_with_trace(
        &attacker,
        &defender,
        None,
        None,
        SimpleAbilityTimingMode::ReallyFast,
        &acid_rain_config(),
        30.0,
        true,
    );
    let log = result.combat_log.expect("trace");
    let count = |status: &str, side: &str| -> usize {
        log.iter()
            .filter(|e| {
                e.entry_type == "dot"
                    && e.status_id.as_deref() == Some(status)
                    && e.hp_side == side
            })
            .count()
    };
    for side in ["A", "B"] {
        assert!(
            count("Acid_Rain_Status", side) >= 5,
            "Acid Rain must tick repeatedly on side {side} (≥5 over 30 s): got {}",
            count("Acid_Rain_Status", side)
        );
        assert!(
            count("Poison_Status", side) >= 2,
            "Acid Rain must apply Poison (≥2 Poison ticks) on side {side}: got {}",
            count("Poison_Status", side)
        );
    }
}

#[test]
fn weather_acid_rain_is_a_single_permanent_stack() {
    // [REF:status_acid_rain]
    // Bullet 3 + note: "As a weather effect it is a single permanent
    // stack for the whole fight." A normal 1-stack DoT would decay after
    // one 3 s interval; the weather stack must keep ticking far beyond
    // that. Late ticks (after several decay windows) prove permanence.
    let attacker = passive_combatant(10_000_000.0);
    let defender = passive_combatant(10_000_000.0);
    let result = simulate_composable_matchup_with_trace(
        &attacker,
        &defender,
        None,
        None,
        SimpleAbilityTimingMode::ReallyFast,
        &acid_rain_config(),
        60.0,
        true,
    );
    let log = result.combat_log.expect("trace");
    let late_ticks = log
        .iter()
        .filter(|e| {
            e.entry_type == "dot"
                && e.status_id.as_deref() == Some("Acid_Rain_Status")
                && e.hp_side == "A"
                && e.time >= 30.0
        })
        .count();
    assert!(
        late_ticks >= 5,
        "permanent Acid Rain must still tick after t=30 s: got {late_ticks} late ticks"
    );
}
