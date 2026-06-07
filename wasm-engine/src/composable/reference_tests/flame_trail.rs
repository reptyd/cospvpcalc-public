//! Reference: ability_flame_trail
//!
//! Covers each testable bullet in the "Flame Trail" entry. Each test
//! body starts with the [REF:ability_flame_trail] marker so the vitest
//! coverage gate (src/pages/referenceCoverage.test.ts) sees it.

use super::super::config::ComposableAbilityConfig;
use super::super::simulate_composable_matchup_with_trace;
use super::{applied_status, default_combatant};
use crate::contracts::{SimpleAbilityTimingMode, SimpleCombatantStats};

fn passive_combatant(max_hp: f64) -> SimpleCombatantStats {
    let mut c = default_combatant();
    c.health = max_hp;
    c.damage = 0.0;
    c.bite_cooldown = 1000.0;
    c
}

#[test]
fn does_not_apply_above_hp_threshold() {
    // [REF:ability_flame_trail]
    // Threshold 50% means trail only fires when owner's HP <= 50% of
    // max. With both sides passive at full HP, trail never activates.
    let attacker = passive_combatant(1_000.0);
    let defender = passive_combatant(10_000.0);
    let mut cfg = ComposableAbilityConfig::default();
    cfg.attacker_flame_trail_value = 50.0;
    let result = simulate_composable_matchup_with_trace(
        &attacker,
        &defender,
        None,
        None,
        SimpleAbilityTimingMode::Fast,
        &cfg,
        10.0,
        true,
    );
    let log = result.combat_log.expect("trace log");
    let burn_present = log
        .iter()
        .any(|e| e.status_id.as_deref() == Some("Burn_Status"));
    assert!(
        !burn_present,
        "Flame Trail must not apply Burn while owner HP stays above threshold"
    );
}

#[test]
fn applies_burn_to_opponent_below_threshold() {
    // [REF:ability_flame_trail]
    // Attacker has Flame Trail at 100% (always-active). Defender is
    // passive. Within the simulation window the engine must emit at
    // least one Burn application via the trail tick.
    let attacker = passive_combatant(1_000.0);
    let defender = passive_combatant(10_000.0);
    let mut cfg = ComposableAbilityConfig::default();
    cfg.attacker_flame_trail_value = 100.0; // always active.
    let result = simulate_composable_matchup_with_trace(
        &attacker,
        &defender,
        None,
        None,
        SimpleAbilityTimingMode::Fast,
        &cfg,
        5.0,
        true,
    );
    let log = result.combat_log.expect("trace log");
    let burn_present = log
        .iter()
        .any(|e| e.status_id.as_deref() == Some("Burn_Status"));
    assert!(
        burn_present,
        "Flame Trail must apply Burn_Status to the opponent while active"
    );
    assert!(
        result.final_hp_b < defender.health,
        "Flame Trail must deal damage to the opponent (2% of max HP per second)"
    );
}

#[test]
fn override_flips_no_move_facetank_off_while_trail_active() {
    // [REF:ability_flame_trail]
    // Bullet: "While any of the owner's trail abilities is active, No Move
    // Facetank is automatically overridden off; the previous setting is
    // restored when the override clears."
    //
    // Engine path: `any_trail_or_step_active_for_side` flips
    // `trails_facetank_override_active` per tick (Phase 2.5);
    // `effective_block_persistent_decay` ORs the override into the user
    // config. Cross-reference: `compare_no_move_facetank` entry - NMF off
    // means the persistent PvP statuses (Poison/Burn/Bleed/Corrosion/
    // Necropoison/Frostbite) stop naturally decaying.
    //
    // Setup: A starts with 4 starting Burn stacks. With Flame Trail
    // value=100 (always-active) the override is on at every tick. With
    // user config block=false (default = decay normally) the override
    // suppresses Burn decay → A takes more total Burn DoT damage than the
    // baseline (no trail). Defender pressure keeps the loop alive.
    let mut a = default_combatant();
    a.health = 1_000.0;
    a.weight = 100.0;
    a.damage = 0.0;
    a.bite_cooldown = 1000.0;
    a.starting_statuses = vec![applied_status("Burn_Status", 4.0)];
    let mut b = default_combatant();
    b.health = 10_000_000.0;
    b.weight = 100.0;
    b.damage = 1.0;
    b.bite_cooldown = 5.0;

    let baseline_cfg = ComposableAbilityConfig::default();
    let baseline = simulate_composable_matchup_with_trace(
        &a,
        &b,
        None,
        None,
        SimpleAbilityTimingMode::SemiIdeal,
        &baseline_cfg,
        7.0,
        false,
    );
    let mut trail_cfg = ComposableAbilityConfig::default();
    trail_cfg.attacker_flame_trail_value = 100.0; // always active
    let trail_run = simulate_composable_matchup_with_trace(
        &a,
        &b,
        None,
        None,
        SimpleAbilityTimingMode::SemiIdeal,
        &trail_cfg,
        7.0,
        false,
    );
    assert!(
        trail_run.damage_dealt_b > baseline.damage_dealt_b,
        "override must suppress Burn decay so DoT delivers more total damage to A: \
         trail dmg_to_A={} vs baseline dmg_to_A={}",
        trail_run.damage_dealt_b,
        baseline.damage_dealt_b,
    );
}
