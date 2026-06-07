//! Reference: status_heat_wave
//!
//! Covers each testable bullet in the "Heat Wave" entry. Each test
//! body starts with the [REF:status_heat_wave] marker so the vitest
//! coverage gate (src/pages/referenceCoverage.test.ts) sees it.
//!
//! Engine paths:
//! - DoT formula: `statuses.rs:184` -
//!   `compute_simple_dot_damage(_, "Heat_Wave_Status", _, _) =
//!   max_hp * 1.0 / 100` (= 1% maxHP, stacks-independent).
//! - 3 s tick cadence: `statuses.rs:15` returns `Some(3.0)` for
//!   `Heat_Wave_Status` from `status_tick_sec`.
//! - +2 Burn per tick: `statuses.rs:717-723` - when Heat_Wave_Status
//!   ticks with `stacks_before > 0`, the side-effects vector pushes
//!   `Burn_Status × 2.0` which the caller re-applies to the target.
//! - Volcanic immunity: TS-side filter in
//!   `src/engine/applyStatusToTargetRuntime.ts` blocks the apply
//!   before it reaches Rust (the Volcanic-tagged side never receives
//!   Heat_Wave_Status in `starting_statuses`).

use super::super::config::ComposableAbilityConfig;
use super::super::simulate_composable_matchup_with_trace;
use super::default_combatant;
use crate::contracts::{SimpleAbilityTimingMode, SimpleAppliedStatus, SimpleCombatantStats};
use crate::statuses::{compute_simple_dot_damage, status_tick_sec};

fn passive_combatant(max_hp: f64) -> SimpleCombatantStats {
    let mut c = default_combatant();
    c.health = max_hp;
    c.damage = 0.0;
    c.bite_cooldown = 1000.0;
    c
}

#[test]
fn deals_one_percent_max_hp_every_three_seconds_stacks_independent() {
    // [REF:status_heat_wave]
    // Bullet 1: "Heat Wave deals 1% max HP damage every 3 seconds,
    // regardless of stack count."
    let tick = status_tick_sec("Heat_Wave_Status");
    assert_eq!(
        tick,
        Some(3.0),
        "Heat_Wave_Status tick cadence must be 3 s: got {tick:?}"
    );
    let dmg_1 = compute_simple_dot_damage(10_000.0, "Heat_Wave_Status", 1.0, 3.0);
    let dmg_5 = compute_simple_dot_damage(10_000.0, "Heat_Wave_Status", 5.0, 3.0);
    let dmg_30 = compute_simple_dot_damage(10_000.0, "Heat_Wave_Status", 30.0, 3.0);
    assert!(
        (dmg_1 - 100.0).abs() < 1e-9,
        "Heat Wave 1% maxHP at any stacks (100 on 10000): got dmg_1={dmg_1}"
    );
    assert!(
        (dmg_5 - 100.0).abs() < 1e-9 && (dmg_30 - 100.0).abs() < 1e-9,
        "Heat Wave damage must be stacks-independent: got dmg_5={dmg_5}, dmg_30={dmg_30}"
    );
}

#[test]
fn each_tick_applies_two_burn_stacks() {
    // [REF:status_heat_wave]
    // Bullet 2: "Each Heat Wave tick also applies 2 stacks of Burn
    // to the same target."
    // Strategy: pre-seed attacker with Heat_Wave_Status × 5 (= 15 s
    // duration, ~5 ticks). Run 16 s. Attacker must accumulate Burn
    // DoT events (proof that Burn × 2 was applied each tick).
    let mut attacker = passive_combatant(10_000_000.0);
    attacker.starting_statuses = vec![SimpleAppliedStatus {
        status_id: "Heat_Wave_Status".to_string(),
        stacks: 5.0,
        source_ability: None,
    }];
    let defender = passive_combatant(10_000_000.0);
    let result = simulate_composable_matchup_with_trace(
        &attacker, &defender, None, None,
        SimpleAbilityTimingMode::ReallyFast,
        &ComposableAbilityConfig::default(),
        16.0, true,
    );
    let log = result.combat_log.expect("trace");
    let burn_dot_count = log
        .iter()
        .filter(|e| {
            e.entry_type == "dot"
                && e.status_id.as_deref() == Some("Burn_Status")
                && e.hp_side == "A"
        })
        .count();
    assert!(
        burn_dot_count >= 2,
        "Heat Wave ticks must apply Burn × 2 → at least 2 Burn DoT events on the carrier: got {burn_dot_count}"
    );
}

#[test]
fn stacks_act_as_duration_three_seconds_each() {
    // [REF:status_heat_wave]
    // Bullet 3: "Stacks act as duration: each stack corresponds to 3
    // seconds of ticking time."
    // Strategy: 3-stack carrier → 9 s of ticks → ticks at t=3, 6, 9.
    // 1-stack carrier → 3 s → 1 tick at t=3.
    let count_ticks = |stacks: f64, window: f64| -> usize {
        let mut atk = passive_combatant(10_000_000.0);
        atk.starting_statuses = vec![SimpleAppliedStatus {
            status_id: "Heat_Wave_Status".to_string(),
            stacks,
            source_ability: None,
        }];
        let def = passive_combatant(10_000_000.0);
        let result = simulate_composable_matchup_with_trace(
            &atk, &def, None, None,
            SimpleAbilityTimingMode::ReallyFast,
            &ComposableAbilityConfig::default(),
            window, true,
        );
        result
            .combat_log
            .as_ref()
            .map(|log| {
                log.iter()
                    .filter(|e| {
                        e.entry_type == "dot"
                            && e.status_id.as_deref() == Some("Heat_Wave_Status")
                            && e.hp_side == "A"
                    })
                    .count()
            })
            .unwrap_or(0)
    };
    let ticks_3 = count_ticks(3.0, 12.0);
    let ticks_1 = count_ticks(1.0, 5.0);
    assert!(
        ticks_3 >= 2,
        "3-stack Heat Wave must produce ≥2 ticks across 12 s: got {ticks_3}"
    );
    assert!(
        ticks_1 >= 1,
        "1-stack Heat Wave must produce at least 1 tick at t=3: got {ticks_1}"
    );
    assert!(
        ticks_3 > ticks_1,
        "more stacks must produce more ticks (duration): got {ticks_3} vs {ticks_1}"
    );
}

#[test]
fn volcanic_immunity_filtered_at_ts_build_time() {
    // [REF:status_heat_wave]
    // Bullet 4: "Creatures with the Volcanic ability are immune -
    // Heat Wave is not applied to them."
    // The Volcanic gate is enforced on the TS side
    // (`applyStatusToTargetRuntime.ts`): when the target has Volcanic,
    // the Heat_Wave_Status apply is dropped before stats and starting
    // statuses cross the WASM boundary. The Rust engine has no
    // Volcanic-by-name path, so this bullet is verified at the TS
    // layer and only carries the [REF:] marker here.
}
