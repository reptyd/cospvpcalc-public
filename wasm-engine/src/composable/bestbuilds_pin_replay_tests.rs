//! Pin-replay equivalence for the Best Builds redesign.
//!
//! The redesign drops the per-decision engine rollout for the top slice of
//! builds: it captures one representative build's committed defensive decisions
//! (Fortify fire timeline + each toggle's held-state timeline) with
//! [`super::capture_defensive_pin_schedule`], then re-runs the fight ONCE under
//! `GateOnly` with that schedule pinned - no rollout search. That is only sound
//! if the pinned replay reproduces the full-`ideal` fight exactly.
//!
//! These tests prove it end to end through the real capture + schedule seam,
//! and cover the case that broke the earlier single-time pin: a BB-length
//! (480 s) fight where Fortify fires several times. Each case asserts the ideal
//! and pinned summaries match field for field (winner, death times, damage,
//! final HP - exact f64 equality) and that the pinned path does ZERO rollout /
//! replay search.

use super::fortify_rollout_bridge::{set_fortify_rollout_override, take_rollout_cost};
use super::loop_iter::AbilityPolicyMode;
use super::toggle_replay_bridge::{set_toggle_rollout_override, take_replay_cost};
use super::{
    capture_defensive_pin_schedule, simulate_composable_matchup_with_trace_control,
    DefensivePinControl,
};
use crate::composable::config::ComposableAbilityConfig;
use crate::contracts::{
    BestBuildsMatchupSummary, SimpleAbilityTimingMode, SimpleAppliedStatus, SimpleCombatantStats,
    Winner,
};
use crate::policy::decisions::toggle_replay::HUNKER_REPLAY_DECISION_ID;

const WEIGHT: f64 = 1_000.0;

fn combatant(
    health: f64,
    damage: f64,
    bite_cd: f64,
    regen: f64,
    on_hit: &[(&str, f64)],
) -> SimpleCombatantStats {
    SimpleCombatantStats {
        health,
        weight: WEIGHT,
        damage,
        bite_cooldown: bite_cd,
        health_regen: regen,
        on_hit_statuses: on_hit
            .iter()
            .map(|(id, stacks)| SimpleAppliedStatus {
                status_id: (*id).to_string(),
                stacks: *stacks,
                ..Default::default()
            })
            .collect(),
        ..Default::default()
    }
}

#[derive(Debug, Clone, PartialEq)]
struct KeyFields {
    winner: Winner,
    death_a: Option<f64>,
    death_b: Option<f64>,
    damage_a: f64,
    damage_b: f64,
    final_hp_a: f64,
    final_hp_b: f64,
    hp_a_at_b_death: f64,
    hp_b_at_a_death: f64,
}

fn key_fields(s: &BestBuildsMatchupSummary) -> KeyFields {
    KeyFields {
        winner: s.winner,
        death_a: s.death_time_a,
        death_b: s.death_time_b,
        damage_a: s.damage_dealt_a,
        damage_b: s.damage_dealt_b,
        final_hp_a: s.final_hp_a,
        final_hp_b: s.final_hp_b,
        hp_a_at_b_death: s.hp_a_at_b_death,
        hp_b_at_a_death: s.hp_b_at_a_death,
    }
}

/// Fortify fire times per side, read out of the combat log.
fn fortify_fires(s: &BestBuildsMatchupSummary) -> (Vec<f64>, Vec<f64>) {
    let (mut a, mut b) = (Vec::new(), Vec::new());
    if let Some(log) = &s.combat_log {
        for e in log {
            if e.description.as_deref() == Some("Fortify activated") {
                match e.attacker.as_str() {
                    "A" => a.push(e.time),
                    "B" => b.push(e.time),
                    _ => {}
                }
            }
        }
    }
    (a, b)
}

fn with_rollouts_on<T>(f: impl FnOnce() -> T) -> T {
    set_fortify_rollout_override(Some(true));
    set_toggle_rollout_override(Some(true));
    let out = f();
    set_fortify_rollout_override(None);
    set_toggle_rollout_override(None);
    out
}

/// Full `ideal` reference fight with both rollouts engaged (trace on so Fortify
/// fire times are readable).
fn ideal_summary(
    a: &SimpleCombatantStats,
    b: &SimpleCombatantStats,
    cfg: &ComposableAbilityConfig,
    max_time: f64,
) -> BestBuildsMatchupSummary {
    with_rollouts_on(|| {
        simulate_composable_matchup_with_trace_control(
            a,
            b,
            None,
            None,
            SimpleAbilityTimingMode::Ideal,
            cfg,
            max_time,
            true,
            DefensivePinControl::default(),
            AbilityPolicyMode::Normal,
            None,
            None,
            None,
        )
    })
}

/// Capture the committed defensive schedule from a full `ideal` run.
fn capture(
    a: &SimpleCombatantStats,
    b: &SimpleCombatantStats,
    cfg: &ComposableAbilityConfig,
    max_time: f64,
) -> DefensivePinControl {
    with_rollouts_on(|| {
        capture_defensive_pin_schedule(a, b, None, None, SimpleAbilityTimingMode::Ideal, cfg, max_time)
    })
}

/// The cheap pinned replay: GateOnly, defensive decisions driven entirely by the
/// captured schedule. Asserts it does zero rollout / replay search.
fn pinned_replay(
    a: &SimpleCombatantStats,
    b: &SimpleCombatantStats,
    cfg: &ComposableAbilityConfig,
    max_time: f64,
    pins: DefensivePinControl,
) -> BestBuildsMatchupSummary {
    set_fortify_rollout_override(Some(false));
    set_toggle_rollout_override(Some(false));
    let _ = take_rollout_cost();
    let _ = take_replay_cost();
    let out = simulate_composable_matchup_with_trace_control(
        a,
        b,
        None,
        None,
        SimpleAbilityTimingMode::Ideal,
        cfg,
        max_time,
        false,
        pins,
        AbilityPolicyMode::GateOnly,
        None,
        None,
        None,
    );
    let (ff, fd) = take_rollout_cost();
    let (tf, td) = take_replay_cost();
    set_fortify_rollout_override(None);
    set_toggle_rollout_override(None);
    assert_eq!(
        (ff, fd, tf, td),
        (0, 0, 0, 0),
        "pinned GateOnly replay must do zero rollout/replay search \
         (fortify forks={ff} decisions={fd}, toggle forks={tf} decisions={td})"
    );
    out
}

/// End-to-end: ideal reference, capture, GateOnly pin-replay, assert equal.
fn prove_pin_reproduces_ideal(
    label: &str,
    a: &SimpleCombatantStats,
    b: &SimpleCombatantStats,
    cfg: &ComposableAbilityConfig,
    max_time: f64,
) -> (BestBuildsMatchupSummary, DefensivePinControl) {
    let ideal = ideal_summary(a, b, cfg, max_time);
    let pins = capture(a, b, cfg, max_time);
    let pinned = pinned_replay(a, b, cfg, max_time, pins.clone());
    assert_eq!(
        key_fields(&ideal),
        key_fields(&pinned),
        "{label}: pinned GateOnly replay diverged from full ideal"
    );
    (ideal, pins)
}

// ---------------------------------------------------------------------------
// The case the earlier single-time pin could not handle: a BB-length fight
// where Fortify fires several times. The schedule pin fixes it.
// ---------------------------------------------------------------------------

#[test]
fn multi_fire_fortify_pin_reproduces_ideal_at_bb_cap() {
    let a = combatant(60_000.0, 900.0, 2.0, 0.0, &[("Bleed_Status", 3.0), ("Radiation_Status", 3.0)]);
    let b = combatant(120_000.0, 700.0, 2.0, 40.0, &[]);
    let mut cfg = ComposableAbilityConfig::default();
    cfg.defender_fortify = true;
    let max_time = 480.0;

    let (ideal, pins) = prove_pin_reproduces_ideal("multi-fire/480s", &a, &b, &cfg, max_time);

    let (_, ideal_fires_b) = fortify_fires(&ideal);
    assert!(
        ideal_fires_b.len() >= 2,
        "480 s fixture must exercise the multi-fire regime (fires={ideal_fires_b:?})"
    );
    assert_eq!(
        pins.defender.fortify_fire_times(),
        ideal_fires_b,
        "captured schedule must pin every ideal Fortify fire, in order"
    );
    println!(
        "[multi-fire] ideal fired {}x at {:?}; schedule pin reproduced the full 480 s fight",
        ideal_fires_b.len(),
        ideal_fires_b
    );
}

// ---------------------------------------------------------------------------
// Single-fire regressions across winner=A / B / Draw and both-sides pinning.
// ---------------------------------------------------------------------------

#[test]
fn fortify_pin_reproduces_ideal_bleed_rad() {
    let a = combatant(11_800.0, 1_360.0, 2.0, 0.0, &[("Bleed_Status", 3.0), ("Radiation_Status", 3.0)]);
    let b = combatant(20_000.0, 820.0, 2.0, 25.0, &[]);
    let mut cfg = ComposableAbilityConfig::default();
    cfg.defender_fortify = true;
    let (ideal, pins) = prove_pin_reproduces_ideal("bleed+rad", &a, &b, &cfg, 90.0);
    let (_, fb) = fortify_fires(&ideal);
    assert_eq!(pins.defender.fortify_fire_times(), fb);
    println!("[bleed+rad] fire={fb:?} winner={:?}", ideal.winner);
}

#[test]
fn fortify_pin_reproduces_ideal_radiation_only() {
    let a = combatant(12_000.0, 1_200.0, 2.0, 0.0, &[("Radiation_Status", 4.0)]);
    let b = combatant(16_000.0, 820.0, 2.0, 0.0, &[]);
    let mut cfg = ComposableAbilityConfig::default();
    cfg.defender_fortify = true;
    let (ideal, _) = prove_pin_reproduces_ideal("rad-only", &a, &b, &cfg, 90.0);
    println!("[rad-only] winner={:?} dA={:?} dB={:?}", ideal.winner, ideal.death_time_a, ideal.death_time_b);
}

#[test]
fn fortify_pin_both_sides_reproduces_ideal() {
    let a = combatant(17_000.0, 1_050.0, 2.0, 18.0, &[("Bleed_Status", 3.0)]);
    let b = combatant(17_000.0, 1_050.0, 2.0, 18.0, &[("Bleed_Status", 3.0)]);
    let mut cfg = ComposableAbilityConfig::default();
    cfg.attacker_fortify = true;
    cfg.defender_fortify = true;
    let (ideal, pins) = prove_pin_reproduces_ideal("both-sides", &a, &b, &cfg, 90.0);
    let (fa, fb) = fortify_fires(&ideal);
    assert!(!fa.is_empty() && !fb.is_empty(), "both sides must fire Fortify (A={fa:?} B={fb:?})");
    assert_eq!(pins.attacker.fortify_fire_times(), fa);
    assert_eq!(pins.defender.fortify_fire_times(), fb);
    println!("[both-sides] A={fa:?} B={fb:?} winner={:?}", ideal.winner);
}

#[test]
fn fortify_pin_reproduces_ideal_draw() {
    let a = combatant(30_000.0, 700.0, 2.0, 20.0, &[("Bleed_Status", 2.0)]);
    let b = combatant(30_000.0, 700.0, 2.0, 20.0, &[("Bleed_Status", 2.0)]);
    let mut cfg = ComposableAbilityConfig::default();
    cfg.attacker_fortify = true;
    cfg.defender_fortify = true;
    let (ideal, _) = prove_pin_reproduces_ideal("draw", &a, &b, &cfg, 90.0);
    assert_eq!(ideal.winner, Winner::Draw, "draw fixture must actually draw");
    println!("[draw] winner={:?} finalHpA={} finalHpB={}", ideal.winner, ideal.final_hp_a, ideal.final_hp_b);
}

// ---------------------------------------------------------------------------
// DoT-free early-out: no removable stacks => the rollout never fires; the capture
// pins Fortify OFF and the replay reproduces the untouched fight.
// ---------------------------------------------------------------------------

#[test]
fn dot_free_source_pins_fortify_off_and_reproduces_ideal() {
    let a = combatant(14_000.0, 1_100.0, 2.0, 0.0, &[]);
    let b = combatant(20_000.0, 820.0, 2.0, 25.0, &[]);
    let mut cfg = ComposableAbilityConfig::default();
    cfg.defender_fortify = true;

    let (ideal, pins) = prove_pin_reproduces_ideal("dot-free", &a, &b, &cfg, 90.0);
    let (_, fb) = fortify_fires(&ideal);
    assert!(fb.is_empty(), "DoT-free source: Fortify must never fire (got {fb:?})");
    assert!(
        pins.defender.fortify_fire_times().is_empty(),
        "capture must pin Fortify OFF (empty timeline) for a DoT-free source"
    );
    println!("[dot-free] Fortify never fired; pinned OFF reproduces the fight");
}

// ---------------------------------------------------------------------------
// Toggle opponent (Hunker): the held-state timeline is captured and pinned
// through the same schedule.
// ---------------------------------------------------------------------------

#[test]
fn hunker_toggle_pin_reproduces_ideal() {
    let a = combatant(24_000.0, 1_150.0, 2.0, 0.0, &[]);
    let mut b = combatant(15_000.0, 900.0, 2.0, 12.0, &[]);
    b.hunker_reduction_pct = 50.0;
    let mut cfg = ComposableAbilityConfig::default();
    cfg.defender_hunker = true;

    let (ideal, pins) = prove_pin_reproduces_ideal("hunker", &a, &b, &cfg, 90.0);
    let pinned_answers = pins.defender.toggle_answer_count(HUNKER_REPLAY_DECISION_ID);
    assert!(
        pinned_answers > 0,
        "capture must pin the Hunker held-state timeline (got {pinned_answers} answers)"
    );
    println!(
        "[hunker] pinned {pinned_answers} Hunker answers; winner={:?} dB={:?}",
        ideal.winner, ideal.death_time_b
    );
}

// ---------------------------------------------------------------------------
// Speedup: full ideal (per-decision rollout) vs capture-once + cheap pin-replay.
// ---------------------------------------------------------------------------

#[test]
#[ignore = "benchmark: 480 s full rollout is multi-second; run explicitly with --ignored --nocapture"]
fn pin_gateonly_speedup_vs_ideal() {
    use std::time::Instant;

    let a = combatant(60_000.0, 900.0, 2.0, 0.0, &[("Bleed_Status", 3.0), ("Radiation_Status", 3.0)]);
    let b = combatant(120_000.0, 700.0, 2.0, 40.0, &[]);
    let mut cfg = ComposableAbilityConfig::default();
    cfg.defender_fortify = true;
    let max_time = 480.0;

    let pins = capture(&a, &b, &cfg, max_time);

    let reps = 3;
    let t0 = Instant::now();
    for _ in 0..reps {
        let _ = ideal_summary(&a, &b, &cfg, max_time);
    }
    let ideal_ms = t0.elapsed().as_secs_f64() * 1000.0 / reps as f64;

    let t1 = Instant::now();
    for _ in 0..reps {
        let _ = pinned_replay(&a, &b, &cfg, max_time, pins.clone());
    }
    let pinned_ms = t1.elapsed().as_secs_f64() * 1000.0 / reps as f64;

    println!(
        "[speedup/480s] ideal(rollout)={ideal_ms:.3} ms  pinned(GateOnly)={pinned_ms:.3} ms  speedup={:.1}x",
        ideal_ms / pinned_ms
    );
    assert!(
        pinned_ms < ideal_ms,
        "pinned GateOnly replay ({pinned_ms:.3} ms) must be cheaper than the full rollout ({ideal_ms:.3} ms)"
    );
}

// ---------------------------------------------------------------------------
// Cost attribution: which search actually produces the inner replays a
// Best Builds fight pays for. The screen avoids all of them (gate-only), so
// this is the price of the exact completion, and the answer decides where a
// speedup is worth building.
// ---------------------------------------------------------------------------

#[test]
#[ignore = "benchmark: several 480 s rollout fights; run with --release --ignored --nocapture"]
fn rollout_cost_attribution_at_bb_cap() {
    use std::time::Instant;

    let max_time = 480.0;
    let a = combatant(60_000.0, 900.0, 2.0, 0.0, &[("Bleed_Status", 3.0), ("Radiation_Status", 3.0)]);
    let mut b = combatant(120_000.0, 700.0, 2.0, 40.0, &[]);
    b.hunker_reduction_pct = 50.0;

    let mut fortify_only = ComposableAbilityConfig::default();
    fortify_only.defender_fortify = true;

    let mut hunker_only = ComposableAbilityConfig::default();
    hunker_only.defender_hunker = true;

    let mut warden_only = ComposableAbilityConfig::default();
    warden_only.defender_warden_rage = true;

    let mut everything = ComposableAbilityConfig::default();
    everything.defender_fortify = true;
    everything.defender_hunker = true;
    everything.defender_warden_rage = true;

    println!("
=== Rollout cost attribution (480 s, defender carries the abilities) ===");
    println!(
        "{:<22} {:>9} {:>7} {:>9} {:>7} {:>12} {:>10}",
        "config", "fortForks", "fortDec", "togForks", "togDec", "workUnits", "wall ms"
    );
    for (label, cfg) in [
        ("none", &ComposableAbilityConfig::default()),
        ("fortify", &fortify_only),
        ("hunker", &hunker_only),
        ("wardensRage", &warden_only),
        ("all three", &everything),
    ] {
        let _ = take_rollout_cost();
        let _ = take_replay_cost();
        let started = Instant::now();
        let summary = ideal_summary(&a, &b, cfg, max_time);
        let wall_ms = started.elapsed().as_secs_f64() * 1000.0;
        let (fort_forks, fort_decisions) = take_rollout_cost();
        let (toggle_forks, toggle_decisions) = take_replay_cost();
        println!(
            "{label:<22} {fort_forks:>9} {fort_decisions:>7} {toggle_forks:>9} {toggle_decisions:>7} {:>12} {wall_ms:>10.1}",
            summary.work_units,
        );
    }
}

/// Sweep the decision grid the toggle / posture rollouts run on. It produces
/// most of a fight's inner forks (720 of 856 with all three abilities on), so
/// this prices widening it and shows whether the fight it produces still
/// matches the shipped grid.
#[test]
#[ignore = "benchmark: several 480 s rollout fights; run with --release --ignored --nocapture"]
fn decision_grid_cost_and_fidelity() {
    use std::time::Instant;
    use super::posture_policy::set_decision_periodic_override;

    let max_time = 480.0;
    let a = combatant(60_000.0, 900.0, 2.0, 0.0, &[("Bleed_Status", 3.0), ("Radiation_Status", 3.0)]);
    let mut b = combatant(120_000.0, 700.0, 2.0, 40.0, &[]);
    b.hunker_reduction_pct = 50.0;

    let mut cfg = ComposableAbilityConfig::default();
    cfg.defender_fortify = true;
    cfg.defender_hunker = true;
    cfg.defender_warden_rage = true;

    println!("
=== Toggle / posture decision grid: cost vs. the shipped 5 s grid ===");
    println!(
        "{:<8} {:>9} {:>8} {:>10} {:>8} {:>10} {:>9} {:>10} {:>22}",
        "grid", "togForks", "togDec", "fortForks", "fortDec", "workUnits", "wall ms", "speedup", "fight"
    );
    let mut baseline_ms = 0.0_f64;
    let mut baseline_key: Option<KeyFields> = None;
    for grid in [5.0_f64, 10.0, 15.0, 20.0, 30.0] {
        set_decision_periodic_override(Some(grid));
        let _ = take_rollout_cost();
        let _ = take_replay_cost();
        let started = Instant::now();
        let summary = ideal_summary(&a, &b, &cfg, max_time);
        let wall_ms = started.elapsed().as_secs_f64() * 1000.0;
        let (fort_forks, fort_dec) = take_rollout_cost();
        let (tog_forks, tog_dec) = take_replay_cost();
        set_decision_periodic_override(None);

        let key = key_fields(&summary);
        if baseline_key.is_none() {
            baseline_ms = wall_ms;
            baseline_key = Some(key.clone());
        }
        let same = baseline_key.as_ref() == Some(&key);
        println!(
            "{grid:<8} {tog_forks:>9} {tog_dec:>8} {fort_forks:>10} {fort_dec:>8} {:>10} {wall_ms:>9.1} {:>9.1}x {:>22}",
            summary.work_units,
            baseline_ms / wall_ms,
            if same { "same".to_string() } else { format!("{:?}/{:?}", key.winner, key.death_b) },
        );
    }
}

