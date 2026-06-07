//! Reference: ability_healing_step
//!
//! Covers each testable bullet in the "Healing Step" entry. Each test
//! body starts with the [REF:ability_healing_step] marker so the vitest
//! coverage gate (src/pages/referenceCoverage.test.ts) sees it.
//!
//! Engine path: `composable/mod.rs:2657-2733` (Phase 4d-bis, Healing
//! Step ticks). Trails-facetank override mirrored from TS in 08dfb6e -
//! see `effective_block_persistent_decay`.

use super::super::config::ComposableAbilityConfig;
use super::super::simulate_composable_matchup_with_trace;
use super::{applied_status, default_combatant};
use crate::contracts::{SimpleAbilityTimingMode, SimpleCombatantStats};

/// 1000 HP A and 1500 HP B with mid-range melee. Without Healing Step
/// A dies first; with Healing Step A's HP regularly drops below the 65%
/// gate and the heal fires multiple times. Mirrors the proven setup in
/// `composable::tests::healing_step_below_threshold_heals_and_shifts_outcome`.
fn matchup_with_steady_pressure() -> (SimpleCombatantStats, SimpleCombatantStats) {
    let mut a = default_combatant();
    a.health = 1_000.0;
    a.weight = 500.0;
    a.damage = 60.0;
    a.bite_cooldown = 1.0;
    let mut b = default_combatant();
    b.health = 1_500.0;
    b.weight = 500.0;
    b.damage = 55.0;
    b.bite_cooldown = 1.0;
    (a, b)
}

fn count_healing_step_ticks(log: &[crate::contracts::CombatLogEntry], side: &str) -> usize {
    log.iter()
        .filter(|e| {
            e.attacker == side && e.description.as_deref() == Some("Healing Step tick")
        })
        .count()
}

#[test]
fn gated_by_trails_compare_only_toggle() {
    // [REF:ability_healing_step]
    // Bullet 1: "Healing Step is a passive ability gated by the Trails
    // compare-only toggle."
    // The Rust engine treats `attacker_healing_step_value == 0.0` as the
    // step being disabled (TS bridge sets value to 0 when the Trails
    // toggle is off). With value=0 no Healing Step tick can fire even
    // when A is wounded under the 65% gate.
    let (a, b) = matchup_with_steady_pressure();
    let cfg = ComposableAbilityConfig::default(); // value=0
    let result = simulate_composable_matchup_with_trace(
        &a, &b, None, None,
        SimpleAbilityTimingMode::SemiIdeal,
        &cfg, 60.0, true,
    );
    let log = result.combat_log.expect("trace log");
    let ticks = count_healing_step_ticks(&log, "A");
    assert_eq!(
        ticks, 0,
        "with the Trails toggle off (value=0) Healing Step must not tick: got {ticks}"
    );
}

#[test]
fn does_not_activate_above_sixty_five_percent_max_hp() {
    // [REF:ability_healing_step]
    // Bullet 2: "It activates while the owner's current HP is at or
    // below 65% of max HP."
    // Tiny mutual damage keeps both sides above the gate. Step value
    // is non-zero, but no tick should fire.
    let mut a = default_combatant();
    a.health = 5_000.0;
    a.damage = 5.0;
    a.bite_cooldown = 2.0;
    let mut b = default_combatant();
    b.health = 200.0;
    b.damage = 1.0;
    b.bite_cooldown = 2.0;
    let mut cfg = ComposableAbilityConfig::default();
    cfg.attacker_healing_step_value = 5.0;
    let result = simulate_composable_matchup_with_trace(
        &a, &b, None, None,
        SimpleAbilityTimingMode::SemiIdeal,
        &cfg, 30.0, true,
    );
    let log = result.combat_log.expect("trace log");
    let ticks = count_healing_step_ticks(&log, "A");
    assert_eq!(
        ticks, 0,
        "Healing Step must not tick while owner HP > 65% max: got {ticks}"
    );
}

#[test]
fn heals_value_percent_of_max_hp_every_three_seconds() {
    // [REF:ability_healing_step]
    // Bullet 3: "While active, every 3 seconds the owner heals an amount
    // equal to the ability's value expressed as a percentage of max HP
    // (for example, value 5 heals 5% of max HP per tick)."
    // Steady-pressure setup drops A under the 65% gate; the engine fires
    // multiple heal ticks. Verify per-tick healing == value% × maxHP and
    // tick spacing == 3 s.
    let (a, b) = matchup_with_steady_pressure();
    let mut cfg = ComposableAbilityConfig::default();
    cfg.attacker_healing_step_value = 10.0; // 10% maxHP per tick = 100 HP
    let result = simulate_composable_matchup_with_trace(
        &a, &b, None, None,
        SimpleAbilityTimingMode::SemiIdeal,
        &cfg, 60.0, true,
    );
    let log = result.combat_log.expect("trace log");
    let heal_events: Vec<&_> = log
        .iter()
        .filter(|e| e.description.as_deref() == Some("Healing Step tick") && e.attacker == "A")
        .collect();
    assert!(
        heal_events.len() >= 2,
        "expected at least 2 Healing Step ticks, got {}",
        heal_events.len()
    );
    let expected_per_tick = a.health * 0.10;
    for ev in &heal_events {
        let healed = ev.healing.unwrap_or(0.0);
        assert!(
            (healed - expected_per_tick).abs() < 1e-6,
            "per-tick heal must equal value × maxHP / 100 = {expected_per_tick}, got {healed}"
        );
    }
    let times: Vec<f64> = heal_events.iter().map(|e| e.time).collect();
    for pair in times.windows(2) {
        let gap = pair[1] - pair[0];
        assert!(
            (gap - 3.0).abs() < 1e-9,
            "Healing Step tick spacing must be 3 s, got {gap}: {times:?}"
        );
    }
}

#[test]
fn segment_is_eternal_while_threshold_holds() {
    // [REF:ability_healing_step]
    // Bullet 4: "Only one segment is modeled and it is treated as
    // eternal while the HP threshold is met. Segment despawn and max
    // segment count are not simulated."
    // Steady-pressure setup keeps A under the gate intermittently
    // through a long window; multiple heal ticks must fire over 60 s
    // (no despawn cuts cadence short).
    let (a, b) = matchup_with_steady_pressure();
    let mut cfg = ComposableAbilityConfig::default();
    cfg.attacker_healing_step_value = 10.0;
    let result = simulate_composable_matchup_with_trace(
        &a, &b, None, None,
        SimpleAbilityTimingMode::SemiIdeal,
        &cfg, 60.0, true,
    );
    let log = result.combat_log.expect("trace log");
    let ticks = count_healing_step_ticks(&log, "A");
    assert!(
        ticks >= 4,
        "Healing Step segment must keep ticking through the long window: got {ticks}"
    );
}

#[test]
fn heals_only_the_owner() {
    // [REF:ability_healing_step]
    // Bullet 5: "Healing Step heals only the owner; packmate healing is
    // not modeled."
    // Only A has Healing Step. Both sides take crossfire damage in the
    // steady-pressure setup. The trace must contain "Healing Step tick"
    // events ONLY for side A.
    let (a, b) = matchup_with_steady_pressure();
    let mut cfg = ComposableAbilityConfig::default();
    cfg.attacker_healing_step_value = 10.0;
    let result = simulate_composable_matchup_with_trace(
        &a, &b, None, None,
        SimpleAbilityTimingMode::SemiIdeal,
        &cfg, 60.0, true,
    );
    let log = result.combat_log.expect("trace log");
    let a_ticks = count_healing_step_ticks(&log, "A");
    let b_ticks = count_healing_step_ticks(&log, "B");
    assert!(
        a_ticks > 0,
        "owner (A) must record Healing Step ticks"
    );
    assert_eq!(
        b_ticks, 0,
        "non-owner (B) must record zero Healing Step ticks: got {b_ticks}"
    );
}

#[test]
fn override_flips_no_move_facetank_off_while_step_active() {
    // [REF:ability_healing_step]
    // Bullet 6: "While any of the owner's trail or step abilities is
    // active, No Move Facetank is automatically overridden off; the
    // previous setting is restored when the override clears."
    //
    // Same pattern as Flame/Frost/Plague/Toxic Trail: pre-load Burn on
    // the step owner. Steady-pressure setup drops A under the 65% gate,
    // activating Healing Step → override applies → Burn stops decaying
    // → more total Burn DoT to A vs the same matchup without the step.
    let (mut a, b) = matchup_with_steady_pressure();
    a.starting_statuses = vec![applied_status("Burn_Status", 4.0)];

    let baseline_cfg = ComposableAbilityConfig::default();
    let baseline = simulate_composable_matchup_with_trace(
        &a, &b, None, None,
        SimpleAbilityTimingMode::SemiIdeal,
        &baseline_cfg, 30.0, false,
    );
    let mut step_cfg = ComposableAbilityConfig::default();
    step_cfg.attacker_healing_step_value = 10.0;
    let step_run = simulate_composable_matchup_with_trace(
        &a, &b, None, None,
        SimpleAbilityTimingMode::SemiIdeal,
        &step_cfg, 30.0, false,
    );
    assert!(
        step_run.damage_dealt_b > baseline.damage_dealt_b,
        "Healing Step override + heal must produce more total Burn DoT to A vs no-step baseline: \
         step dmg_to_A={} vs baseline dmg_to_A={}",
        step_run.damage_dealt_b,
        baseline.damage_dealt_b,
    );
}
