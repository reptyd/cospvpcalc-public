//! Reference: compare_poison_area
//!
//! Covers each testable bullet in the "Poison Area" entry. Each test
//! body starts with the [REF:compare_poison_area] marker so the
//! vitest coverage gate (src/pages/referenceCoverage.test.ts) sees it.
//!
//! Engine path: `composable/mod.rs:2503-2536` (Phase 4c-bis). Each
//! activation applies Poison_Status × 5 to the opponent and re-arms
//! the cooldown to `time + scale_active_cooldown(stats, 15.0)`.

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

fn poison_area_attacker_cfg() -> ComposableAbilityConfig {
    let mut cfg = ComposableAbilityConfig::default();
    cfg.attacker_poison_area = true;
    cfg
}

#[test]
fn applies_five_stacks_of_poison_to_opponent_on_activation() {
    // [REF:compare_poison_area]
    // Bullet 2: "Each activation applies 5 stacks of Poison to the
    // opponent."
    // Apply path is non-tracing - verify via downstream Poison DoT
    // presence on defender after the first activation at t=0.
    let attacker = passive_combatant(1_000_000.0);
    let defender = passive_combatant(10_000_000_000.0);
    let result = simulate_composable_matchup_with_trace(
        &attacker, &defender, None, None,
        SimpleAbilityTimingMode::ReallyFast,
        &poison_area_attacker_cfg(),
        4.0, true,
    );
    let log = result.combat_log.expect("trace");
    let activation = log
        .iter()
        .find(|e| e.description.as_deref() == Some("Poison Area activated") && e.attacker == "A");
    assert!(
        activation.is_some(),
        "Poison Area must fire its initial activation"
    );
    let poison_dots = log
        .iter()
        .filter(|e| {
            e.entry_type == "dot"
                && e.status_id.as_deref() == Some("Poison_Status")
                && e.hp_side == "B"
        })
        .count();
    assert!(
        poison_dots >= 1,
        "Poison Area's 5-stack apply must produce Poison DoT on defender within 4 s: got {poison_dots}"
    );
}

#[test]
fn cooldown_fifteen_seconds() {
    // [REF:compare_poison_area]
    // Bullet 3: "The ability has a 15-second cooldown that is scaled
    // by the usual active cooldown multiplier."
    let attacker = passive_combatant(1_000_000.0);
    let defender = passive_combatant(10_000_000_000.0);
    let result = simulate_composable_matchup_with_trace(
        &attacker, &defender, None, None,
        SimpleAbilityTimingMode::ReallyFast,
        &poison_area_attacker_cfg(),
        20.0, true,
    );
    let log = result.combat_log.expect("trace");
    let activations: Vec<f64> = log
        .iter()
        .filter(|e| e.description.as_deref() == Some("Poison Area activated") && e.attacker == "A")
        .map(|e| e.time)
        .collect();
    assert!(
        activations.len() >= 2,
        "Poison Area must fire at least twice in a 20 s window: {activations:?}"
    );
    let gap = activations[1] - activations[0];
    assert!(
        (gap - 15.0).abs() < 1.0,
        "second Poison Area activation must land ~15 s after the first: gap={gap}, times={activations:?}"
    );
}

#[test]
fn cooldown_scaled_by_active_cooldown_multiplier() {
    // [REF:compare_poison_area]
    // Bullet 3 (scaling clause): the 15 s cooldown is multiplied by
    // `active_cooldown_multiplier`. With 0.5x multiplier, the second
    // activation lands ~7.5 s after the first.
    let mut attacker = passive_combatant(1_000_000.0);
    attacker.active_cooldown_multiplier = 0.5;
    let defender = passive_combatant(10_000_000_000.0);
    let result = simulate_composable_matchup_with_trace(
        &attacker, &defender, None, None,
        SimpleAbilityTimingMode::ReallyFast,
        &poison_area_attacker_cfg(),
        15.0, true,
    );
    let log = result.combat_log.expect("trace");
    let activations: Vec<f64> = log
        .iter()
        .filter(|e| e.description.as_deref() == Some("Poison Area activated") && e.attacker == "A")
        .map(|e| e.time)
        .collect();
    assert!(
        activations.len() >= 2,
        "Poison Area with 0.5x cooldown multiplier must fire ≥2 times in 15 s: {activations:?}"
    );
    let gap = activations[1] - activations[0];
    assert!(
        (gap - 7.5).abs() < 1.0,
        "0.5x multiplier must scale 15 s cooldown to ~7.5 s: gap={gap}, times={activations:?}"
    );
}
