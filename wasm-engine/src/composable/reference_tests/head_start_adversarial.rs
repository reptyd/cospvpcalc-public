//! Head Start edge-case regression coverage, beyond the core
//! [REF:compare_head_start] cases in `head_start.rs`. Guards the
//! scheduler-centralized timer park against the failure classes that motivated
//! it: residual freeze / crawl (breath on the inert side, active abilities on
//! either side, a window past the horizon), wrong resume, byte-identity break
//! under a rich config, and posture-policy replay desync - the scheduler now
//! mutates the parked timers and the policy re-runs the scheduler in its
//! projections.

use super::super::config::ComposableAbilityConfig;
use super::super::simulate_composable_matchup_with_trace;
use super::{applied_status, default_breath, default_combatant};
use crate::contracts::{
    SimpleAbilityTimingMode, SimpleAppliedStatus, SimpleBreathProfile, SimpleCombatantStats,
};

fn melee_combatant(max_hp: f64, damage: f64, bite_cooldown: f64) -> SimpleCombatantStats {
    let mut c = default_combatant();
    c.health = max_hp;
    c.damage = damage;
    c.bite_cooldown = bite_cooldown;
    c
}

fn simple_breath() -> SimpleBreathProfile {
    let mut b = default_breath();
    b.dps_pct = 1.0;
    b.capacity = 20.0;
    b.regen_rate = 1.8;
    b
}

// ---------------------------------------------------------------------------
// Class 1: residual freeze / crawl
// ---------------------------------------------------------------------------

#[test]
fn breath_inert_side_resumes_at_boundary_non_aligned() {
    // The inert side has BREATH (not just bites) on a cadence that never
    // lands on the window boundary. The scheduler parks `next_breath` along
    // with `next_hit`; verify the fight progresses and B's first breath tick
    // lands at or after N (never inside the window, never frozen).
    let attacker = melee_combatant(5_000_000.0, 200.0, 0.7);
    let mut defender = melee_combatant(5_000_000.0, 50.0, 1.3);
    defender.breath_resistance = 0.0;

    let mut cfg = ComposableAbilityConfig::default();
    cfg.attacker_head_start_sec = 2.0; // B inert in [0, 2)

    let result = simulate_composable_matchup_with_trace(
        &attacker,
        &defender,
        None,
        Some(&simple_breath()), // B breathes
        SimpleAbilityTimingMode::ReallyFast,
        &cfg,
        6.0,
        true,
    );
    let log = result.combat_log.expect("trace");

    // No B breath tick inside the window.
    let b_breath_in_window = log
        .iter()
        .any(|e| e.entry_type == "breath" && e.attacker == "B" && e.time + 1e-9 < 2.0);
    assert!(
        !b_breath_in_window,
        "inert defender must not breathe during the head start window"
    );

    // A keeps biting/breathing past the boundary => the fight did not freeze.
    let a_events_after = log
        .iter()
        .filter(|e| e.attacker == "A" && e.time > 2.0 + 1e-9)
        .count();
    assert!(
        a_events_after >= 1,
        "attacker must keep acting past the boundary (crawl/freeze would stop all events)"
    );
}

#[test]
fn active_ability_on_active_side_does_not_freeze() {
    // The ACTIVE side (A) has Toxic Trap. Head start makes B inert. The
    // active-ability timers belong to A, so they should fire; verify the
    // fight runs to completion without stalling.
    let attacker = melee_combatant(2_000_000.0, 150.0, 0.7);
    let defender = melee_combatant(2_000_000.0, 150.0, 1.3);

    let mut cfg = ComposableAbilityConfig::default();
    cfg.attacker_head_start_sec = 2.0;
    cfg.attacker_toxic_trap = true;

    let result = simulate_composable_matchup_with_trace(
        &attacker,
        &defender,
        None,
        None,
        SimpleAbilityTimingMode::ReallyFast,
        &cfg,
        10.0,
        true,
    );
    let log = result.combat_log.expect("trace");
    // The trace must reach near the horizon (not freeze at t=2). Use the max
    // event time as a liveness proxy.
    let max_t = log.iter().map(|e| e.time).fold(0.0_f64, f64::max);
    assert!(
        max_t > 5.0,
        "fight must progress well past the window (max event time {max_t}, expected > 5)"
    );
}

#[test]
fn active_ability_on_inert_side_does_not_freeze() {
    // The INERT side (B) has Toxic Trap. Its active-ability timers are masked
    // during the window. This is the spot most likely to leak a stale
    // zero-initialized timer (toxic_trap_next_tick_at) into the fold once the
    // window lifts. Verify no freeze.
    let attacker = melee_combatant(2_000_000.0, 150.0, 0.7);
    let defender = melee_combatant(2_000_000.0, 150.0, 1.3);

    let mut cfg = ComposableAbilityConfig::default();
    cfg.attacker_head_start_sec = 2.0; // B inert
    cfg.defender_toxic_trap = true; // ability on inert side

    let result = simulate_composable_matchup_with_trace(
        &attacker,
        &defender,
        None,
        None,
        SimpleAbilityTimingMode::ReallyFast,
        &cfg,
        10.0,
        true,
    );
    let log = result.combat_log.expect("trace");
    let max_t = log.iter().map(|e| e.time).fold(0.0_f64, f64::max);
    assert!(
        max_t > 5.0,
        "fight with active ability on the inert side must progress past the window (max {max_t})"
    );
}

#[test]
fn posture_policy_both_sides_with_head_start_terminates() {
    // Posture policy on BOTH sides + asymmetric head start + non-aligned
    // cadences. This exercises the replay path (decide_via_replay clones state
    // and re-runs the scheduler, which now MUTATES the parked timers). Verify
    // a coherent, finite, non-frozen result.
    let attacker = melee_combatant(80_000.0, 200.0, 0.7);
    let defender = melee_combatant(80_000.0, 200.0, 1.3);

    let mut cfg = ComposableAbilityConfig::default();
    cfg.attacker_head_start_sec = 2.0;
    cfg.defender_head_start_sec = 1.5;
    cfg.attacker_posture_policy_enabled = true;
    cfg.attacker_posture_policy_regen_aware = true;
    cfg.defender_posture_policy_enabled = true;
    cfg.defender_posture_policy_regen_aware = true;

    let result = simulate_composable_matchup_with_trace(
        &attacker,
        &defender,
        None,
        None,
        SimpleAbilityTimingMode::ReallyFast,
        &cfg,
        30.0,
        true,
    );
    // No panic / hang is the primary assertion. Also check a finite duration.
    assert!(
        result.max_time_sec.is_finite(),
        "max_time_sec must be finite"
    );
    let log = result.combat_log.expect("trace");
    let max_t = log.iter().map(|e| e.time).fold(0.0_f64, f64::max);
    assert!(
        max_t > 3.0,
        "posture+head-start fight must progress past both windows (max {max_t})"
    );
}

#[test]
fn head_start_larger_than_horizon_does_not_hang() {
    // Head start window (10s) exceeds the fight horizon (4s). B is inert for
    // the entire simulation. Must terminate cleanly.
    let attacker = melee_combatant(1_000_000.0, 200.0, 0.7);
    let defender = melee_combatant(1_000_000.0, 200.0, 1.3);

    let mut cfg = ComposableAbilityConfig::default();
    cfg.attacker_head_start_sec = 10.0;

    let result = simulate_composable_matchup_with_trace(
        &attacker,
        &defender,
        None,
        None,
        SimpleAbilityTimingMode::ReallyFast,
        &cfg,
        4.0,
        true,
    );
    let log = result.combat_log.expect("trace");
    // B never bites (inert the whole time).
    let b_bite = log.iter().any(|e| e.entry_type == "bite" && e.attacker == "B");
    assert!(!b_bite, "B must never bite when inert for the whole fight");
    // A still bites.
    let a_bite = log.iter().any(|e| e.entry_type == "bite" && e.attacker == "A");
    assert!(a_bite, "A must still bite while B is inert for the whole fight");
}

#[test]
fn tiny_head_start_resumes_immediately() {
    // A 0.001s head start - far shorter than any bite cooldown. B's opening
    // bite (due at t=0) is suppressed and parked on the boundary, so it fires
    // at 0.001: resume is continuous as the window shrinks toward zero.
    let attacker = melee_combatant(1_000_000.0, 200.0, 0.7);
    let defender = melee_combatant(1_000_000.0, 200.0, 1.3);

    let mut cfg = ComposableAbilityConfig::default();
    cfg.attacker_head_start_sec = 0.001;

    let result = simulate_composable_matchup_with_trace(
        &attacker,
        &defender,
        None,
        None,
        SimpleAbilityTimingMode::ReallyFast,
        &cfg,
        4.0,
        true,
    );
    let log = result.combat_log.expect("trace");
    let first_b_bite = log
        .iter()
        .filter(|e| e.entry_type == "bite" && e.attacker == "B")
        .map(|e| e.time)
        .fold(f64::INFINITY, f64::min);
    assert!(
        first_b_bite.is_finite(),
        "B must resume after the tiny window (got freeze)"
    );
    assert!(
        (first_b_bite - 0.001).abs() <= 1e-6,
        "B must resume on the tiny window boundary (0.001), got {first_b_bite}"
    );
}

// ---------------------------------------------------------------------------
// Class 3: byte-identity (rich config)
// ---------------------------------------------------------------------------

#[test]
fn zero_head_start_byte_identical_rich_config() {
    // head_start = 0 with breath + active ability + posture policy + on-hit
    // statuses must be byte-identical to the same config without the
    // (zero-valued) head-start fields touched.
    let attacker = melee_combatant(50_000.0, 120.0, 1.3);
    let mut defender = melee_combatant(60_000.0, 90.0, 1.7);
    defender.on_hit_taken_statuses = vec![SimpleAppliedStatus {
        status_id: "Bleed_Status".to_string(),
        stacks: 1.0,
        source_ability: Some("Defensive Bleed".to_string()),
        ..Default::default()
    }];

    let attacker_breath = simple_breath();
    let defender_breath = {
        let mut b = simple_breath();
        b.special_statuses = vec![applied_status("Burn_Status", 0.5)];
        b
    };

    let mut base = ComposableAbilityConfig::default();
    base.attacker_toxic_trap = true;
    base.attacker_posture_policy_enabled = true;
    base.attacker_posture_policy_regen_aware = true;
    base.defender_posture_policy_enabled = true;

    let mut cfg_zero = base.clone();
    cfg_zero.attacker_head_start_sec = 0.0;
    cfg_zero.defender_head_start_sec = 0.0;

    let with_zero = simulate_composable_matchup_with_trace(
        &attacker,
        &defender,
        Some(&attacker_breath),
        Some(&defender_breath),
        SimpleAbilityTimingMode::ReallyFast,
        &cfg_zero,
        30.0,
        true,
    );
    let baseline = simulate_composable_matchup_with_trace(
        &attacker,
        &defender,
        Some(&attacker_breath),
        Some(&defender_breath),
        SimpleAbilityTimingMode::ReallyFast,
        &base,
        30.0,
        true,
    );
    assert_eq!(
        with_zero, baseline,
        "head_start = 0 must be byte-identical with breath + active + posture + on-hit statuses"
    );
}

// ---------------------------------------------------------------------------
// Class 4: determinism (same input -> same output, posture+head-start)
// ---------------------------------------------------------------------------

#[test]
fn posture_head_start_is_deterministic() {
    let attacker = melee_combatant(80_000.0, 200.0, 0.7);
    let defender = melee_combatant(80_000.0, 200.0, 1.3);

    let mut cfg = ComposableAbilityConfig::default();
    cfg.attacker_head_start_sec = 2.0;
    cfg.defender_head_start_sec = 1.5;
    cfg.attacker_posture_policy_enabled = true;
    cfg.attacker_posture_policy_regen_aware = true;
    cfg.defender_posture_policy_enabled = true;

    let run = || {
        simulate_composable_matchup_with_trace(
            &attacker,
            &defender,
            None,
            None,
            SimpleAbilityTimingMode::ReallyFast,
            &cfg,
            30.0,
            true,
        )
    };
    assert_eq!(run(), run(), "posture + head start must be deterministic");
}

// ---------------------------------------------------------------------------
// Class 2: wrong resume - active side must NOT be suppressed during window
// ---------------------------------------------------------------------------

#[test]
fn active_side_with_posture_not_suppressed_during_window() {
    // A (active) has posture policy; B is inert under A's window. A's posture
    // decisions and bites must keep happening during [0, N). Verify A bites
    // inside the window.
    let attacker = melee_combatant(1_000_000.0, 200.0, 0.7);
    let defender = melee_combatant(1_000_000.0, 200.0, 1.3);

    let mut cfg = ComposableAbilityConfig::default();
    cfg.attacker_head_start_sec = 3.0;
    cfg.attacker_posture_policy_enabled = true;

    let result = simulate_composable_matchup_with_trace(
        &attacker,
        &defender,
        None,
        None,
        SimpleAbilityTimingMode::ReallyFast,
        &cfg,
        6.0,
        true,
    );
    let log = result.combat_log.expect("trace");
    let a_bites_in_window = log
        .iter()
        .filter(|e| e.entry_type == "bite" && e.attacker == "A" && e.time + 1e-9 < 3.0)
        .count();
    assert!(
        a_bites_in_window >= 1,
        "active side A must keep biting during its own head-start window even with posture policy on"
    );
}
