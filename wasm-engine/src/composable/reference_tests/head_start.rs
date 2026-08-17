//! Reference: compare_head_start
//!
//! Covers each testable bullet in the "Head Start" entry. Each test
//! body starts with the [REF:compare_head_start] marker so the vitest
//! coverage gate (src/pages/referenceCoverage.test.ts) sees it.
//!
//! Engine path: per-side `attacker_head_start_sec` / `defender_head_start_sec`
//! on `ComposableAbilityConfig`. `attacker_head_start_sec = N` gives the
//! ATTACKER (side A) the opening, so the DEFENDER (side B) stands inert while
//! `time + 1e-9 < N`. The scheduler fold (`phases/scheduler.rs`) masks the
//! inert side's own action timers to INFINITY; the bite / breath / posture /
//! active-ability / self-destruct firing sites additionally suppress the inert
//! side. Passive evolution (regen / status decay / status ticks) is never
//! masked, so the inert side stays a live target.

use super::super::config::ComposableAbilityConfig;
use super::super::simulate_composable_matchup_with_trace;
use super::default_combatant;
use crate::contracts::{SimpleAbilityTimingMode, SimpleAppliedStatus, SimpleCombatantStats};

fn melee_combatant(max_hp: f64, damage: f64, bite_cooldown: f64) -> SimpleCombatantStats {
    let mut c = default_combatant();
    c.health = max_hp;
    c.damage = damage;
    c.bite_cooldown = bite_cooldown;
    c
}

#[test]
fn opponent_deals_no_damage_during_window_but_still_takes_bites() {
    // [REF:compare_head_start]
    // Bullets 1-3: the enabled creature gets an N-second opening during
    // which the opponent stands inert (no attacks), yet the opponent
    // still takes the enabled creature's bites.
    //
    // attacker_head_start_sec = 5 -> defender (B) is inert in [0, 5).
    // Both sides hit hard on a fast cadence, so absent the window B would
    // be landing bites well before t=5.
    let attacker = melee_combatant(1_000_000.0, 200.0, 1.0);
    let defender = melee_combatant(1_000_000.0, 200.0, 1.0);

    let mut cfg = ComposableAbilityConfig::default();
    cfg.attacker_head_start_sec = 5.0;

    let result = simulate_composable_matchup_with_trace(
        &attacker, &defender, None, None,
        SimpleAbilityTimingMode::ReallyFast,
        &cfg,
        4.0, true,
    );
    let log = result.combat_log.expect("trace");

    let b_bites_in_window = log
        .iter()
        .filter(|e| e.entry_type == "bite" && e.attacker == "B" && e.time + 1e-9 < 5.0)
        .count();
    assert_eq!(
        b_bites_in_window, 0,
        "the inert defender must land no bites during the attacker's head start: got {b_bites_in_window}"
    );

    let a_bites_in_window = log
        .iter()
        .filter(|e| e.entry_type == "bite" && e.attacker == "A" && e.time + 1e-9 < 5.0)
        .count();
    assert!(
        a_bites_in_window >= 1,
        "the enabled attacker must still bite the inert defender during the window: got {a_bites_in_window}"
    );
}

#[test]
fn defensive_on_bite_reaction_still_fires_while_inert() {
    // [REF:compare_head_start]
    // Bullet 3: the opponent still takes the enabled creature's bites and
    // its passive/defensive on-being-bitten reactions still fire.
    //
    // attacker_head_start_sec = 5 -> defender (B) inert. B carries a
    // defensive on-hit-taken status (Bleed): when A bites B, B applies
    // Bleed to A even though B itself is standing inert.
    let attacker = melee_combatant(1_000_000.0, 200.0, 1.0);
    let mut defender = melee_combatant(1_000_000.0, 200.0, 1.0);
    defender.on_hit_taken_statuses = vec![SimpleAppliedStatus {
        status_id: "Bleed_Status".to_string(),
        stacks: 2.0,
        source_ability: Some("Defensive Bleed".to_string()),
        ..Default::default()
    }];

    let mut cfg = ComposableAbilityConfig::default();
    cfg.attacker_head_start_sec = 5.0;

    let result = simulate_composable_matchup_with_trace(
        &attacker, &defender, None, None,
        SimpleAbilityTimingMode::ReallyFast,
        &cfg,
        4.0, true,
    );
    let log = result.combat_log.expect("trace");

    let defensive_apply_on_a = log.iter().find(|e| {
        e.status_id.as_deref() == Some("Bleed_Status")
            && e.hp_side == "A"
            && e.time + 1e-9 < 5.0
            && e.description.as_deref().is_some_and(|d| d.contains("applied"))
    });
    assert!(
        defensive_apply_on_a.is_some(),
        "the inert defender's defensive on-being-bitten reaction must still apply Bleed to the attacker during the window"
    );
}

#[test]
fn opponent_resumes_acting_after_window() {
    // [REF:compare_head_start]
    // Bullets 2 + 5: after N seconds the opponent acts normally.
    // attacker_head_start_sec = 3 -> defender (B) inert in [0, 3). Run to
    // 8 s and assert B lands at least one bite at t >= 3.
    let attacker = melee_combatant(1_000_000_000.0, 50.0, 1.0);
    let defender = melee_combatant(1_000_000_000.0, 50.0, 1.0);

    let mut cfg = ComposableAbilityConfig::default();
    cfg.attacker_head_start_sec = 3.0;

    let result = simulate_composable_matchup_with_trace(
        &attacker, &defender, None, None,
        SimpleAbilityTimingMode::ReallyFast,
        &cfg,
        8.0, true,
    );
    let log = result.combat_log.expect("trace");

    let b_bite_after_window = log
        .iter()
        .find(|e| e.entry_type == "bite" && e.attacker == "B" && e.time >= 3.0 - 1e-9);
    assert!(
        b_bite_after_window.is_some(),
        "the defender must resume biting once the head start window ends (t >= 3)"
    );
    // And none before the window closes.
    let b_bite_in_window = log
        .iter()
        .any(|e| e.entry_type == "bite" && e.attacker == "B" && e.time + 1e-9 < 3.0);
    assert!(
        !b_bite_in_window,
        "the defender must not bite before the window closes"
    );
}

#[test]
fn inert_side_regen_still_runs_during_window() {
    // [REF:compare_head_start]
    // Bullet 5: the inert side is still a live target - its regeneration
    // keeps running during the window.
    //
    // attacker_head_start_sec = 6 -> defender (B) inert. B has regen and is
    // pre-wounded by A's bites. With the defender first-tick-regen rule the
    // first regen tick fires at t=2 (inside the window). A regen event for
    // B proves passive state evolution is unmasked while B stands inert.
    let attacker = melee_combatant(1_000_000.0, 100.0, 0.5);
    let mut defender = default_combatant();
    defender.health = 1_000.0;
    defender.damage = 50.0;
    defender.bite_cooldown = 1.0;
    defender.health_regen = 5.0;

    let mut cfg = ComposableAbilityConfig::default();
    cfg.attacker_head_start_sec = 6.0;
    cfg.defender_compare_first_tick_regen = true;
    cfg.defender_compare_first_tick_delay_sec = 2.0;

    let result = simulate_composable_matchup_with_trace(
        &attacker, &defender, None, None,
        SimpleAbilityTimingMode::ReallyFast,
        &cfg,
        4.0, true,
    );
    let log = result.combat_log.expect("trace");

    let b_regen_in_window = log.iter().find(|e| {
        e.description.as_deref() == Some("Natural regen")
            && e.attacker == "B"
            && e.time + 1e-9 < 6.0
    });
    assert!(
        b_regen_in_window.is_some(),
        "the inert defender's regen must still tick during the head start window"
    );
}

#[test]
fn non_aligned_cadence_resumes_at_boundary_without_freezing() {
    // [REF:compare_head_start]
    // Regression (user-reported "Morthorax freezes at t = N"): the inert side's
    // bite timer is masked out of the scheduler fold during the window, so the
    // engine never snaps `time` exactly onto it. The other tests in this file
    // all use a 1.0s cadence that happens to land the active side's bites on
    // integer seconds - exactly where the inert timer sits - so the per-phase
    // rearm gate (an exact-time match) kept firing by luck. With a cadence the
    // active side never lands on (0.7 vs 1.3; neither divides the 2.0s window),
    // the masked timer froze in the past; the instant the window lifted it
    // pinned `next_time` below `time` every iteration and the +1us scheduler
    // fallback crawled to the cap - the fight "stopped" at t = N and never
    // progressed. The fix parks the suppressed timer on the window boundary and
    // lands the loop there, so the side resumes cleanly at N.
    let attacker = melee_combatant(1_000_000.0, 200.0, 0.7);
    let defender = melee_combatant(1_000_000.0, 200.0, 1.3);

    let mut cfg = ComposableAbilityConfig::default();
    cfg.attacker_head_start_sec = 2.0;

    let result = simulate_composable_matchup_with_trace(
        &attacker, &defender, None, None,
        SimpleAbilityTimingMode::ReallyFast,
        &cfg,
        3.0, true,
    );
    let log = result.combat_log.expect("trace");

    // No defender bite before the window closes.
    let b_bite_in_window = log
        .iter()
        .any(|e| e.entry_type == "bite" && e.attacker == "B" && e.time + 1e-9 < 2.0);
    assert!(!b_bite_in_window, "the defender must not bite during the head start window");

    // The defender resumes at the boundary - not a cooldown later, and crucially
    // not never (the freeze left it at INFINITY).
    let first_b_bite = log
        .iter()
        .filter(|e| e.entry_type == "bite" && e.attacker == "B")
        .map(|e| e.time)
        .fold(f64::INFINITY, f64::min);
    assert!(
        first_b_bite.is_finite(),
        "the defender must resume biting once the window lifts (the fight froze instead)"
    );
    assert!(
        (first_b_bite - 2.0).abs() <= 1e-6,
        "the defender must resume exactly at the window boundary N = 2.0, got {first_b_bite}"
    );

    // The fight kept progressing past the boundary instead of stalling on a
    // crawl: the attacker's natural 0.7s cadence keeps landing bites after N.
    let a_bite_after_window = log
        .iter()
        .filter(|e| e.entry_type == "bite" && e.attacker == "A" && e.time > 2.0 + 1e-9)
        .count();
    assert!(
        a_bite_after_window >= 1,
        "the attacker must keep biting past the boundary (a crawl would freeze every event)"
    );
}

#[test]
fn both_sides_head_start_resume_at_their_own_boundaries() {
    // [REF:compare_head_start]
    // Both creatures enable Head Start with different windows and non-aligned
    // cadences. Each side is inert until its OWN window closes, then resumes -
    // exercising the symmetric park-on-boundary path for A and B at once
    // (defender_head_start_sec masks A, attacker_head_start_sec masks B).
    let attacker = melee_combatant(1_000_000.0, 200.0, 0.7);
    let defender = melee_combatant(1_000_000.0, 200.0, 1.1);

    let mut cfg = ComposableAbilityConfig::default();
    cfg.attacker_head_start_sec = 2.0; // B inert in [0, 2)
    cfg.defender_head_start_sec = 1.5; // A inert in [0, 1.5)

    let result = simulate_composable_matchup_with_trace(
        &attacker, &defender, None, None,
        SimpleAbilityTimingMode::ReallyFast,
        &cfg,
        4.0, true,
    );
    let log = result.combat_log.expect("trace");

    let first_a_bite = log
        .iter()
        .filter(|e| e.entry_type == "bite" && e.attacker == "A")
        .map(|e| e.time)
        .fold(f64::INFINITY, f64::min);
    let first_b_bite = log
        .iter()
        .filter(|e| e.entry_type == "bite" && e.attacker == "B")
        .map(|e| e.time)
        .fold(f64::INFINITY, f64::min);

    assert!(
        (first_a_bite - 1.5).abs() <= 1e-6,
        "attacker (inert until 1.5) must resume at its own boundary, got {first_a_bite}"
    );
    assert!(
        (first_b_bite - 2.0).abs() <= 1e-6,
        "defender (inert until 2.0) must resume at its own boundary, got {first_b_bite}"
    );
}

#[test]
fn head_start_with_posture_policy_resumes_without_freezing() {
    // [REF:compare_head_start]
    // The scheduler park now MUTATES posture_next_decision_at (previously the
    // mask was a read-only view). The posture policy re-runs the scheduler in
    // its replay projections, so a head-start + posture-policy run must still
    // resolve to a finite, progressing fight - no freeze, inert side resumes.
    let attacker = melee_combatant(1_000_000.0, 200.0, 0.7);
    let defender = melee_combatant(1_000_000.0, 200.0, 1.3);

    let mut cfg = ComposableAbilityConfig::default();
    cfg.attacker_head_start_sec = 2.0;
    cfg.attacker_posture_policy_enabled = true;
    cfg.defender_posture_policy_enabled = true;

    let result = simulate_composable_matchup_with_trace(
        &attacker, &defender, None, None,
        SimpleAbilityTimingMode::ReallyFast,
        &cfg,
        6.0, true,
    );
    let log = result.combat_log.expect("trace");

    // Defender resumes biting at or after the boundary (the fight progressed
    // past N rather than freezing), and never bites inside the window.
    let b_bites: Vec<f64> = log
        .iter()
        .filter(|e| e.entry_type == "bite" && e.attacker == "B")
        .map(|e| e.time)
        .collect();
    assert!(
        b_bites.iter().any(|&t| t >= 2.0 - 1e-9),
        "defender must resume biting at/after the window under a posture policy"
    );
    assert!(
        !b_bites.iter().any(|&t| t + 1e-9 < 2.0),
        "defender must not bite during the window under a posture policy"
    );
    // And the attacker keeps acting well past the boundary (no crawl freeze).
    assert!(
        log.iter().any(|e| e.entry_type == "bite" && e.attacker == "A" && e.time > 4.0),
        "the fight must keep progressing past the window under a posture policy"
    );
}

#[test]
fn zero_head_start_byte_identical_with_posture_policy() {
    // [REF:compare_head_start]
    // Byte-identity invariant extended to a richer config: with both posture
    // policies enabled and an on-hit status in play, head_start_sec = 0 must
    // still be byte-identical to the same config with no Head Start - the park
    // block and boundary injection must be exact no-ops when both windows are 0.
    let attacker = melee_combatant(80_000.0, 150.0, 1.1);
    let mut defender = melee_combatant(90_000.0, 110.0, 1.4);
    defender.on_hit_taken_statuses = vec![SimpleAppliedStatus {
        status_id: "Bleed_Status".to_string(),
        stacks: 2.0,
        source_ability: Some("Defensive Bleed".to_string()),
        ..Default::default()
    }];

    let mut base = ComposableAbilityConfig::default();
    base.attacker_posture_policy_enabled = true;
    base.defender_posture_policy_enabled = true;

    let mut with_zero = base.clone();
    with_zero.attacker_head_start_sec = 0.0;
    with_zero.defender_head_start_sec = 0.0;

    let run = |cfg: &ComposableAbilityConfig| {
        simulate_composable_matchup_with_trace(
            &attacker, &defender, None, None,
            SimpleAbilityTimingMode::ReallyFast,
            cfg,
            30.0, true,
        )
    };
    assert_eq!(
        run(&with_zero), run(&base),
        "head_start_sec = 0 must be byte-identical to the same posture-policy config with no Head Start"
    );
}

#[test]
fn zero_head_start_is_byte_identical_to_default() {
    // [REF:compare_head_start]
    // Hard invariant: head_start_sec = 0 (the default) leaves the inert
    // window empty, so the mask is a no-op and the fight is byte-identical
    // to a run with no Head Start configured at all.
    let attacker = melee_combatant(50_000.0, 120.0, 1.3);
    let mut defender = melee_combatant(60_000.0, 90.0, 1.7);
    defender.on_hit_taken_statuses = vec![SimpleAppliedStatus {
        status_id: "Bleed_Status".to_string(),
        stacks: 1.0,
        source_ability: Some("Defensive Bleed".to_string()),
        ..Default::default()
    }];

    let mut cfg_zero = ComposableAbilityConfig::default();
    cfg_zero.attacker_head_start_sec = 0.0;
    cfg_zero.defender_head_start_sec = 0.0;

    let with_zero = simulate_composable_matchup_with_trace(
        &attacker, &defender, None, None,
        SimpleAbilityTimingMode::ReallyFast,
        &cfg_zero,
        30.0, true,
    );
    let baseline = simulate_composable_matchup_with_trace(
        &attacker, &defender, None, None,
        SimpleAbilityTimingMode::ReallyFast,
        &ComposableAbilityConfig::default(),
        30.0, true,
    );
    assert_eq!(
        with_zero, baseline,
        "head_start_sec = 0 must be byte-identical to a default-config run"
    );
}
