//! Reference: ability_plague_trail
//!
//! Covers each testable bullet in the "Plague Trail" entry. Each test
//! body starts with the [REF:ability_plague_trail] marker so the vitest
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
fn gated_by_trails_compare_only_toggle() {
    // [REF:ability_plague_trail]
    // Bullet 1: "In Compare, Plague Trail runs only with the Trails rule
    // turned on for the user." The Rust engine
    // treats `attacker_plague_trail_value = 0.0` as the trail being disabled
    // (TS bridge only forwards a non-zero value when the Trails toggle is on).
    // With value=0 no Disease event ever fires.
    let attacker = passive_combatant(1_000.0);
    let defender = passive_combatant(10_000.0);
    let cfg = ComposableAbilityConfig::default(); // value=0
    let result = simulate_composable_matchup_with_trace(
        &attacker, &defender, None, None,
        SimpleAbilityTimingMode::Fast,
        &cfg, 5.0, true,
    );
    let log = result.combat_log.expect("trace log");
    let disease_present = log
        .iter()
        .any(|e| e.status_id.as_deref() == Some("Disease_Status"));
    assert!(
        !disease_present,
        "with the Trails toggle off (value=0) Plague Trail must not fire"
    );
}

#[test]
fn does_not_apply_above_hp_threshold() {
    // [REF:ability_plague_trail]
    // Bullet 2: "Plague Trail activates while the user's current HP is at or
    // below the ability's value, read as a fraction of max HP - value 50 means
    // 50% HP." With both sides full HP and value=50%, the trail must not fire.
    let attacker = passive_combatant(1_000.0);
    let defender = passive_combatant(10_000.0);
    let mut cfg = ComposableAbilityConfig::default();
    cfg.attacker_plague_trail_value = 50.0;
    let result = simulate_composable_matchup_with_trace(
        &attacker, &defender, None, None,
        SimpleAbilityTimingMode::Fast,
        &cfg, 10.0, true,
    );
    let log = result.combat_log.expect("trace log");
    let disease_present = log
        .iter()
        .any(|e| e.status_id.as_deref() == Some("Disease_Status"));
    assert!(
        !disease_present,
        "Plague Trail must not apply Disease while owner HP stays above threshold"
    );
}

#[test]
fn applies_disease_to_opponent_below_threshold() {
    // [REF:ability_plague_trail]
    // Bullet 3: "While active, every 2 seconds the opponent takes damage equal
    // to 2% of their max HP." Always-active trail (value=100) must emit a
    // Disease_Status event and damage the opponent within the simulation
    // window.
    let attacker = passive_combatant(1_000.0);
    let defender = passive_combatant(10_000.0);
    let mut cfg = ComposableAbilityConfig::default();
    cfg.attacker_plague_trail_value = 100.0;
    let result = simulate_composable_matchup_with_trace(
        &attacker, &defender, None, None,
        SimpleAbilityTimingMode::Fast,
        &cfg, 5.0, true,
    );
    let log = result.combat_log.expect("trace log");
    let disease_present = log
        .iter()
        .any(|e| e.status_id.as_deref() == Some("Disease_Status"));
    assert!(
        disease_present,
        "Plague Trail must apply Disease_Status to the opponent while active"
    );
    assert!(
        result.final_hp_b < defender.health,
        "Plague Trail must deal damage to the opponent (2% max HP per tick)"
    );
}

#[test]
fn segment_is_eternal_while_threshold_holds() {
    // [REF:ability_plague_trail]
    // Bullet 6: "Only one trail segment is modeled, and it is treated as
    // eternal while the HP threshold holds. Segment despawn is not simulated."
    // Always-active trail (value=100) ticks every DAMAGE_TRAIL_TICK_SEC=2 s
    // for 2% maxHP each tick. The first tick is scheduled at t=2, so a 7 s
    // window observes ticks at t=2, 4, 6 = 3 ticks = 6% - no segment despawn
    // cuts the cadence short. The >=5% bound proves the segment kept ticking
    // past the first couple of hits (a single despawn would leave <=4%).
    let attacker = passive_combatant(1_000.0);
    let defender = passive_combatant(10_000_000.0);
    let mut cfg = ComposableAbilityConfig::default();
    cfg.attacker_plague_trail_value = 100.0;
    let result = simulate_composable_matchup_with_trace(
        &attacker, &defender, None, None,
        SimpleAbilityTimingMode::Fast,
        &cfg, 7.0, false,
    );
    let lost_pct = (defender.health - result.final_hp_b) / defender.health;
    assert!(
        lost_pct >= 0.05,
        "Plague Trail segment must keep ticking for the full window: defender lost {:.2}% maxHP (need >=5%)",
        lost_pct * 100.0
    );
}

#[test]
fn override_flips_no_move_facetank_off_while_trail_active() {
    // [REF:ability_plague_trail]
    // Bullet 8: "While any of the user's trail abilities is active, No Move
    // Facetank is forced off."
    //
    // Same shape as Flame/Frost Trail override tests: pre-load Burn on
    // the trail owner so the override's effect on persistent decay is
    // observable as additional Burn DoT damage to the owner.
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
        &a, &b, None, None,
        SimpleAbilityTimingMode::SemiIdeal,
        &baseline_cfg, 7.0, false,
    );
    let mut trail_cfg = ComposableAbilityConfig::default();
    trail_cfg.attacker_plague_trail_value = 100.0;
    let trail_run = simulate_composable_matchup_with_trace(
        &a, &b, None, None,
        SimpleAbilityTimingMode::SemiIdeal,
        &trail_cfg, 7.0, false,
    );
    assert!(
        trail_run.damage_dealt_b > baseline.damage_dealt_b,
        "Plague Trail override must suppress Burn decay so DoT delivers more total damage to A: \
         trail dmg_to_A={} vs baseline dmg_to_A={}",
        trail_run.damage_dealt_b,
        baseline.damage_dealt_b,
    );
}
