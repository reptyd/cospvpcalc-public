//! Throwaway measurement harness (issue: Fortify cleanse value - status-only
//! projection vs full-engine value). NOT shipped logic. Drives the private
//! `simulate_composable_matchup_with_trace_control` seam with a single-shot
//! forced-Fortify schedule to pin Fortify ON at a grid of times, on a
//! high-regen tank vs a Bleed(-100% regen)+Radiation bruiser near-tie. Run:
//!   cargo test --lib fortify_oracle -- --nocapture --ignored

use super::{simulate_composable_matchup_with_trace_control, DefensivePinControl, PinnedDefensiveSchedule};
use crate::composable::config::ComposableAbilityConfig;
use crate::contracts::{
    SimpleAbilityTimingMode, SimpleAppliedStatus, SimpleCombatantStats, Winner,
};

const MAX_TIME: f64 = 90.0;

// ---- Repro knobs (tuned for a Fortify-OFF near-tie with A dying first) ----
const HEALTH_A: f64 = 20_000.0; // tank carrier
const HEALTH_REGEN_A: f64 = 25.0; // % max-hp per 15s tick at full multiplier
const DAMAGE_A: f64 = 820.0;
const BITE_CD_A: f64 = 2.0;

const HEALTH_B: f64 = 11_800.0; // bleeder bruiser
const DAMAGE_B: f64 = 1_360.0;
const BITE_CD_B: f64 = 2.0;
const BLEED_STACKS_PER_BITE: f64 = 3.0;
const RADIATION_STACKS_PER_BITE: f64 = 3.0;

const WEIGHT: f64 = 1_000.0; // equal -> weight_ratio 1.0 -> bite deals exactly `damage`

fn carrier() -> SimpleCombatantStats {
    SimpleCombatantStats {
        health: HEALTH_A,
        weight: WEIGHT,
        damage: DAMAGE_A,
        bite_cooldown: BITE_CD_A,
        health_regen: HEALTH_REGEN_A,
        ..Default::default()
    }
}

fn bleeder() -> SimpleCombatantStats {
    SimpleCombatantStats {
        health: HEALTH_B,
        weight: WEIGHT,
        damage: DAMAGE_B,
        bite_cooldown: BITE_CD_B,
        health_regen: 0.0,
        on_hit_statuses: vec![
            SimpleAppliedStatus {
                status_id: "Bleed_Status".to_string(),
                stacks: BLEED_STACKS_PER_BITE,
                ..Default::default()
            },
            SimpleAppliedStatus {
                status_id: "Radiation_Status".to_string(),
                stacks: RADIATION_STACKS_PER_BITE,
                ..Default::default()
            },
        ],
        ..Default::default()
    }
}

#[derive(Debug, Clone)]
struct RunResult {
    winner: Winner,
    death_a: Option<f64>,
    death_b: Option<f64>,
    final_hp_a: f64,
    final_hp_b: f64,
    hp_a_at_b_death: f64,
    hp_b_at_a_death: f64,
    regen_healed_a: f64,
    regen_ticks_a: u32,
    fortify_fire_times: Vec<f64>,
    dot_to_a_bleed: f64,
    dot_to_a_radiation: f64,
}

fn run(fortify_enabled: bool, timing: SimpleAbilityTimingMode, forced_at: Option<f64>) -> RunResult {
    run_ctl(fortify_enabled, timing, forced_at, false)
}

/// `suppress_self_policy`: skip the Fortify self-timing policy so a forced grid
/// measures the forced time in isolation (pure oracle).
fn run_ctl(
    fortify_enabled: bool,
    timing: SimpleAbilityTimingMode,
    forced_at: Option<f64>,
    suppress_self_policy: bool,
) -> RunResult {
    let a = carrier();
    let b = bleeder();
    let mut cfg = ComposableAbilityConfig::default();
    cfg.attacker_fortify = fortify_enabled;

    let summary = simulate_composable_matchup_with_trace_control(
        &a,
        &b,
        None,
        None,
        timing,
        &cfg,
        MAX_TIME,
        true, // record_trace so we can read Fortify fire times + DoT breakdown
        DefensivePinControl {
            attacker: PinnedDefensiveSchedule::fortify_forced_once(forced_at),
            defender: PinnedDefensiveSchedule::default(),
            suppress_self_policy,
        },
        super::loop_iter::AbilityPolicyMode::Normal,
        None,
        None,
        None,
    );

    let mut fortify_fire_times = Vec::new();
    let mut dot_to_a_bleed = 0.0;
    let mut dot_to_a_radiation = 0.0;
    if let Some(log) = &summary.combat_log {
        for e in log {
            if e.attacker == "A"
                && e.description.as_deref() == Some("Fortify activated")
            {
                fortify_fire_times.push(e.time);
            }
            if e.entry_type == "dot" && e.hp_side == "A" {
                match e.status_id.as_deref() {
                    Some("Bleed_Status") => dot_to_a_bleed += e.damage,
                    Some("Radiation_Status") => dot_to_a_radiation += e.damage,
                    _ => {}
                }
            }
        }
    }

    RunResult {
        winner: summary.winner,
        death_a: summary.death_time_a,
        death_b: summary.death_time_b,
        final_hp_a: summary.final_hp_a,
        final_hp_b: summary.final_hp_b,
        hp_a_at_b_death: summary.hp_a_at_b_death,
        hp_b_at_a_death: summary.hp_b_at_a_death,
        regen_healed_a: summary.regen_healed_a,
        regen_ticks_a: summary.regen_ticks_a,
        fortify_fire_times,
        dot_to_a_bleed,
        dot_to_a_radiation,
    }
}

fn winner_str(w: &Winner) -> &'static str {
    match w {
        Winner::A => "A (carrier)",
        Winner::B => "B (bleeder)",
        Winner::Draw => "Draw",
    }
}

fn fmt_opt(x: Option<f64>) -> String {
    match x {
        Some(v) => format!("{:.3}", v),
        None => "  -  ".to_string(),
    }
}

#[test]
#[ignore = "measurement harness; run explicitly with --ignored --nocapture"]
fn fortify_oracle_experiment() {
    println!("\n================ FORTIFY CLEANSE ORACLE EXPERIMENT ================");
    println!(
        "Carrier A: hp={HEALTH_A} regen={HEALTH_REGEN_A}%/15s dmg={DAMAGE_A} cd={BITE_CD_A}s (Fortify)"
    );
    println!(
        "Bleeder B: hp={HEALTH_B} dmg={DAMAGE_B} cd={BITE_CD_B}s on-hit=Bleed{BLEED_STACKS_PER_BITE}+Rad{RADIATION_STACKS_PER_BITE}"
    );
    println!("Both weight={WEIGHT} (ratio 1.0). max_time={MAX_TIME}s\n");

    // (a) Fortify OFF / disabled.
    let off = run(false, SimpleAbilityTimingMode::Ideal, None);
    println!("--- (a) Fortify OFF ------------------------------------------------");
    print_row("OFF", &off);
    println!(
        "     regen_healed_A={:.1} over {} ticks | Bleed DoT eaten by A={:.1} | Rad DoT eaten by A={:.1}",
        off.regen_healed_a, off.regen_ticks_a, off.dot_to_a_bleed, off.dot_to_a_radiation
    );

    // (b) current Fortify hand policy - self-timed, all modes.
    println!("\n--- (b) Current Fortify policy (self-timed, per mode) --------------");
    let modes = [
        ("ReallyFast", SimpleAbilityTimingMode::ReallyFast),
        ("Fast", SimpleAbilityTimingMode::Fast),
        ("SemiIdeal", SimpleAbilityTimingMode::SemiIdeal),
        ("Ideal", SimpleAbilityTimingMode::Ideal),
        ("Extreme", SimpleAbilityTimingMode::Extreme),
    ];
    let mut latest_mode = SimpleAbilityTimingMode::Ideal;
    let mut latest_fire = f64::NEG_INFINITY;
    for (name, m) in modes {
        let r = run(true, m, None);
        let fire = r.fortify_fire_times.first().copied();
        println!(
            "  {:<11} fire={:<8} winner={:<12} regen_healed_A={:.1}",
            name,
            fire.map(|t| format!("{:.1}", t)).unwrap_or_else(|| "never".to_string()),
            winner_str(&r.winner),
            r.regen_healed_a
        );
        // For the forced grid we want the mode whose self-policy fires LATEST
        // (or never), so forcing pre-empts it and the grid is uncontaminated.
        let effective = fire.unwrap_or(f64::INFINITY);
        if effective > latest_fire {
            latest_fire = effective;
            latest_mode = m;
        }
    }
    let _ideal = run(true, SimpleAbilityTimingMode::Ideal, None);

    // (c) Forced-Fortify grid - PURE ORACLE. Self-timing policy suppressed
    // (cfg(test)-only hook) so each forced time is measured in isolation with no
    // self-policy pre-emption. `fired@` = actual Fortify fire time (forced fires
    // only when a cleansable status exists, so very-early forces land on the
    // first Bleed).
    let _ = (latest_mode, latest_fire); // (diagnostic already printed above)
    println!("\n--- (c) Forced Fortify grid — PURE ORACLE (self-policy suppressed) --");
    println!(
        "  t_force | fired@ | winner       | death_A death_B | hpA@Bdeath hpB@Adeath | regenHealA"
    );
    let mut best_t: Option<f64> = None;
    let mut best_margin = f64::NEG_INFINITY;
    let mut flip_ts: Vec<f64> = Vec::new();
    for i in 0..=40 {
        let t = i as f64;
        let r = run_ctl(true, SimpleAbilityTimingMode::Ideal, Some(t), true);
        let actual_fire = r.fortify_fire_times.first().copied();
        let flipped = matches!(r.winner, Winner::A);
        if flipped {
            flip_ts.push(t);
            // Winner-optimality proxy: A's surviving pool (larger = more robust).
            let margin = r.final_hp_a.max(r.hp_a_at_b_death);
            if margin > best_margin {
                best_margin = margin;
                best_t = Some(t);
            }
        }
        println!(
            "   {:>5.0}  | {:>6} | {:<12} | {:>6} {:>6} | {:>9.1} {:>9.1} | {:>9.1}",
            t,
            actual_fire.map(|f| format!("{:.1}", f)).unwrap_or_else(|| "none".to_string()),
            winner_str(&r.winner),
            fmt_opt(r.death_a),
            fmt_opt(r.death_b),
            r.hp_a_at_b_death,
            r.hp_b_at_a_death,
            r.regen_healed_a,
        );
    }
    println!(
        "\n  Winner-FLIP forced times (A wins as pure oracle): {:?}",
        flip_ts
    );

    // (d) Decompose at t*.
    if let Some(tstar) = best_t {
        let fire = run_ctl(true, SimpleAbilityTimingMode::Ideal, Some(tstar), true);
        println!("\n--- (d) Decomposition at t* = {tstar:.0}s -------------------------------");
        println!("  Fortify actually fired at: {:?}", fire.fortify_fire_times);
        println!(
            "  Winner {} -> {}",
            winner_str(&off.winner),
            winner_str(&fire.winner)
        );
        let regen_restored = fire.regen_healed_a - off.regen_healed_a;
        let bleed_dot_delta = off.dot_to_a_bleed - fire.dot_to_a_bleed;
        let rad_dot_delta = off.dot_to_a_radiation - fire.dot_to_a_radiation;
        println!(
            "  regen_healed_A:  OFF={:.1}  FIRE={:.1}  -> REGEN RESTORED = {:.1} HP ({} vs {} ticks)",
            off.regen_healed_a, fire.regen_healed_a, regen_restored, off.regen_ticks_a, fire.regen_ticks_a
        );
        println!(
            "  Bleed DoT to A:  OFF={:.1}  FIRE={:.1}  -> net DoT delta = {:.1} HP",
            off.dot_to_a_bleed, fire.dot_to_a_bleed, bleed_dot_delta
        );
        println!(
            "  Rad   DoT to A:  OFF={:.1}  FIRE={:.1}  -> net DoT delta = {:.1} HP",
            off.dot_to_a_radiation, fire.dot_to_a_radiation, rad_dot_delta
        );
        let regen_share = if regen_restored + bleed_dot_delta.abs() > 0.0 {
            100.0 * regen_restored / (regen_restored + bleed_dot_delta.max(0.0))
        } else {
            0.0
        };
        println!(
            "  => REGEN-restored / (regen + bleed-DoT-removed) = {:.1}%  (regen-dominated if >>50%)",
            regen_share
        );
    } else {
        println!("\n--- (d) No forced time flipped the winner to A. Repro needs retuning. ---");
    }
    println!("==================================================================\n");
}

/// Milestone gate: with `FORTIFY_ROLLOUT` ON, the bounded engine rollout must
/// FIRE Fortify at a time inside the oracle flip window [6, 15] on this
/// cross-subsystem repro and thereby flip the winner from B (Fortify OFF) to A.
/// This reproduces the forced-Fortify oracle's flip window as an EMERGENT
/// decision (no scripted force), so it proves the rollout resolves timing on
/// its own. Reports the chosen fire time, winner, and per-decision replay cost.
#[test]
fn fortify_rollout_fires_in_window_and_flips_winner() {
    // Baseline sanity: Fortify OFF => B (bleeder) wins the near-tie.
    let off = run(false, SimpleAbilityTimingMode::Ideal, None);
    assert!(
        matches!(off.winner, Winner::B),
        "repro sanity: Fortify OFF should let B win, got {}",
        winner_str(&off.winner)
    );

    // Fortify ON, activation decided by the bounded engine rollout.
    super::fortify_rollout_bridge::set_fortify_rollout_override(Some(true));
    let on = run(true, SimpleAbilityTimingMode::Ideal, None);
    let (forks, decisions) = super::fortify_rollout_bridge::take_rollout_cost();
    super::fortify_rollout_bridge::set_fortify_rollout_override(None);

    let fire = on.fortify_fire_times.first().copied();
    println!(
        "ROLLOUT: winner={} fire={} | forks={forks} decisions={decisions} per-decision={:.1}",
        winner_str(&on.winner),
        fire.map(|t| format!("{t:.2}s")).unwrap_or_else(|| "never".to_string()),
        forks as f64 / (decisions.max(1) as f64),
    );

    let fire = fire.expect("rollout must fire Fortify at least once");
    assert!(
        (6.0..=15.0).contains(&fire),
        "rollout Fortify fire time {fire:.2}s must land in the oracle flip window [6, 15]"
    );
    assert!(
        matches!(on.winner, Winner::A),
        "rollout must flip the winner to A (carrier), got {}",
        winner_str(&on.winner)
    );
}

fn print_row(label: &str, r: &RunResult) {
    println!(
        "  {:<11} winner={:<12} death_A={} death_B={} finalHP_A={:.1} finalHP_B={:.1} hpA@Bdeath={:.1} hpB@Adeath={:.1}",
        label,
        winner_str(&r.winner),
        fmt_opt(r.death_a),
        fmt_opt(r.death_b),
        r.final_hp_a,
        r.final_hp_b,
        r.hp_a_at_b_death,
        r.hp_b_at_a_death,
    );
}

// ===========================================================================
// Broad ROLLOUT validation (Task 1): a matchup sweep that compares, per
// matchup, the Fortify winner under three policies -
//   CURRENT  = rollout flag OFF, Fortify self-timed at Ideal;
//   ROLLOUT  = rollout flag ON  (bounded engine fork decides activation);
//   ORACLE   = brute force: force Fortify at every t on a fine 0.5s grid
//              {0, 0.5, ..., 40} (self-policy suppressed so each forced time
//              is isolated) PLUS a never-cast baseline; the winner-optimal of
//              those is the ground-truth best Fortify play.
// Regimes swept: opponent status pressure {Bleed}, {Radiation}, {Bleed+Rad},
// {Fear}, {Bleed+Fear}, {none}; carrier regen {high, zero}; carrier HP
// {low..high}; near-tie shells vs clearly-decisive fights. Run:
//   cargo test --lib fortify_rollout_matchup_sweep -- --ignored --nocapture
// ===========================================================================

use super::fortify_rollout_bridge::{set_fortify_rollout_override, take_rollout_cost};

#[derive(Clone)]
struct MatchupSpec {
    name: &'static str,
    health_a: f64,
    regen_a: f64,
    damage_a: f64,
    bite_cd_a: f64,
    health_b: f64,
    damage_b: f64,
    bite_cd_b: f64,
    statuses: &'static [(&'static str, f64)],
    max_time: f64,
}

fn spec_carrier(m: &MatchupSpec) -> SimpleCombatantStats {
    SimpleCombatantStats {
        health: m.health_a,
        weight: WEIGHT,
        damage: m.damage_a,
        bite_cooldown: m.bite_cd_a,
        health_regen: m.regen_a,
        ..Default::default()
    }
}

fn spec_bleeder(m: &MatchupSpec) -> SimpleCombatantStats {
    SimpleCombatantStats {
        health: m.health_b,
        weight: WEIGHT,
        damage: m.damage_b,
        bite_cooldown: m.bite_cd_b,
        health_regen: 0.0,
        on_hit_statuses: m
            .statuses
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

fn run_spec(
    m: &MatchupSpec,
    fortify_enabled: bool,
    forced_at: Option<f64>,
    suppress_self_policy: bool,
) -> RunResult {
    let a = spec_carrier(m);
    let b = spec_bleeder(m);
    let mut cfg = ComposableAbilityConfig::default();
    cfg.attacker_fortify = fortify_enabled;

    let summary = simulate_composable_matchup_with_trace_control(
        &a,
        &b,
        None,
        None,
        SimpleAbilityTimingMode::Ideal,
        &cfg,
        m.max_time,
        true,
        DefensivePinControl {
            attacker: PinnedDefensiveSchedule::fortify_forced_once(forced_at),
            defender: PinnedDefensiveSchedule::default(),
            suppress_self_policy,
        },
        super::loop_iter::AbilityPolicyMode::Normal,
        None,
        None,
        None,
    );

    let mut fortify_fire_times = Vec::new();
    if let Some(log) = &summary.combat_log {
        for e in log {
            if e.attacker == "A" && e.description.as_deref() == Some("Fortify activated") {
                fortify_fire_times.push(e.time);
            }
        }
    }

    RunResult {
        winner: summary.winner,
        death_a: summary.death_time_a,
        death_b: summary.death_time_b,
        final_hp_a: summary.final_hp_a,
        final_hp_b: summary.final_hp_b,
        hp_a_at_b_death: summary.hp_a_at_b_death,
        hp_b_at_a_death: summary.hp_b_at_a_death,
        regen_healed_a: summary.regen_healed_a,
        regen_ticks_a: summary.regen_ticks_a,
        fortify_fire_times,
        dot_to_a_bleed: 0.0,
        dot_to_a_radiation: 0.0,
    }
}

/// Carrier-A preference order over outcomes: A win > Draw > B win.
fn winner_rank(w: &Winner) -> i32 {
    match w {
        Winner::A => 2,
        Winner::Draw => 1,
        Winner::B => 0,
    }
}

fn short_winner(w: &Winner) -> &'static str {
    match w {
        Winner::A => "A",
        Winner::B => "B",
        Winner::Draw => "Draw",
    }
}

struct OracleResult {
    winner: Winner,
    best_t: Option<f64>,
    death_a: Option<f64>,
    death_b: Option<f64>,
    flip_times: Vec<f64>,
}

/// Ground-truth best Fortify play: the winner-optimal outcome over a never-cast
/// baseline plus a forced-Fortify fire at every 0.5s grid point in [0, 40],
/// each measured in isolation (`suppress_self_policy`). Ties within the best
/// winner rank break toward the largest carrier survival margin.
fn compute_oracle(m: &MatchupSpec) -> OracleResult {
    let nc = run_spec(m, false, None, false);
    let mut best_rank = winner_rank(&nc.winner);
    let mut best_margin = nc.final_hp_a.max(nc.hp_a_at_b_death);
    let mut out = OracleResult {
        winner: nc.winner,
        best_t: None,
        death_a: nc.death_a,
        death_b: nc.death_b,
        flip_times: Vec::new(),
    };

    let mut i: i32 = 0;
    loop {
        let t = i as f64 * 0.5;
        if t > 40.0 + 1e-9 {
            break;
        }
        let r = run_spec(m, true, Some(t), true);
        if matches!(r.winner, Winner::A) {
            out.flip_times.push(t);
        }
        let rk = winner_rank(&r.winner);
        let margin = r.final_hp_a.max(r.hp_a_at_b_death);
        if rk > best_rank || (rk == best_rank && rk == 2 && margin > best_margin) {
            best_rank = rk;
            best_margin = margin;
            out.winner = r.winner;
            out.best_t = Some(t);
            out.death_a = r.death_a;
            out.death_b = r.death_b;
        }
        i += 1;
    }
    out
}

/// ~14 matchups, Fortify carrier on side A, spanning the regimes above.
const SWEEP_SPECS: &[MatchupSpec] = &[
    MatchupSpec {
        name: "bleedrad_neartie_reg+",
        health_a: 20_000.0, regen_a: 25.0, damage_a: 820.0, bite_cd_a: 2.0,
        health_b: 11_800.0, damage_b: 1_360.0, bite_cd_b: 2.0,
        statuses: &[("Bleed_Status", 3.0), ("Radiation_Status", 3.0)],
        max_time: 90.0,
    },
    MatchupSpec {
        name: "bleed_only_neartie_reg+",
        health_a: 20_000.0, regen_a: 25.0, damage_a: 820.0, bite_cd_a: 2.0,
        health_b: 11_800.0, damage_b: 1_360.0, bite_cd_b: 2.0,
        statuses: &[("Bleed_Status", 3.0)],
        max_time: 90.0,
    },
    MatchupSpec {
        name: "rad_only_neartie_reg+",
        health_a: 20_000.0, regen_a: 25.0, damage_a: 820.0, bite_cd_a: 2.0,
        health_b: 11_800.0, damage_b: 1_360.0, bite_cd_b: 2.0,
        statuses: &[("Radiation_Status", 3.0)],
        max_time: 90.0,
    },
    MatchupSpec {
        name: "bleedrad_neartie_reg0",
        health_a: 20_000.0, regen_a: 0.0, damage_a: 820.0, bite_cd_a: 2.0,
        health_b: 11_800.0, damage_b: 1_120.0, bite_cd_b: 2.0,
        statuses: &[("Bleed_Status", 3.0), ("Radiation_Status", 3.0)],
        max_time: 90.0,
    },
    MatchupSpec {
        name: "bleedrad_lowHP_reg+",
        health_a: 14_000.0, regen_a: 25.0, damage_a: 820.0, bite_cd_a: 2.0,
        health_b: 9_500.0, damage_b: 1_360.0, bite_cd_b: 2.0,
        statuses: &[("Bleed_Status", 3.0), ("Radiation_Status", 3.0)],
        max_time: 90.0,
    },
    MatchupSpec {
        name: "bleedrad_hiHP_reg+",
        health_a: 30_000.0, regen_a: 25.0, damage_a: 820.0, bite_cd_a: 2.0,
        health_b: 17_000.0, damage_b: 1_360.0, bite_cd_b: 2.0,
        statuses: &[("Bleed_Status", 3.0), ("Radiation_Status", 3.0)],
        max_time: 120.0,
    },
    MatchupSpec {
        name: "bleedrad_decisiveA",
        health_a: 45_000.0, regen_a: 25.0, damage_a: 1_100.0, bite_cd_a: 2.0,
        health_b: 9_000.0, damage_b: 1_000.0, bite_cd_b: 2.0,
        statuses: &[("Bleed_Status", 3.0), ("Radiation_Status", 3.0)],
        max_time: 120.0,
    },
    MatchupSpec {
        name: "bleedrad_decisiveB",
        health_a: 9_000.0, regen_a: 0.0, damage_a: 600.0, bite_cd_a: 2.0,
        health_b: 24_000.0, damage_b: 1_500.0, bite_cd_b: 2.0,
        statuses: &[("Bleed_Status", 3.0), ("Radiation_Status", 3.0)],
        max_time: 120.0,
    },
    MatchupSpec {
        name: "norem_even",
        health_a: 15_000.0, regen_a: 10.0, damage_a: 900.0, bite_cd_a: 2.0,
        health_b: 15_000.0, damage_b: 900.0, bite_cd_b: 2.0,
        statuses: &[],
        max_time: 90.0,
    },
    MatchupSpec {
        name: "norem_Awin",
        health_a: 22_000.0, regen_a: 10.0, damage_a: 1_050.0, bite_cd_a: 2.0,
        health_b: 12_000.0, damage_b: 900.0, bite_cd_b: 2.0,
        statuses: &[],
        max_time: 90.0,
    },
    MatchupSpec {
        name: "fear_neartie_reg0",
        health_a: 26_000.0, regen_a: 0.0, damage_a: 1_150.0, bite_cd_a: 2.0,
        health_b: 13_000.0, damage_b: 1_150.0, bite_cd_b: 2.0,
        statuses: &[("Fear_Status", 5.0)],
        max_time: 120.0,
    },
    MatchupSpec {
        name: "bleedfear_neartie",
        health_a: 22_000.0, regen_a: 15.0, damage_a: 980.0, bite_cd_a: 2.0,
        health_b: 12_000.0, damage_b: 1_150.0, bite_cd_b: 2.0,
        statuses: &[("Bleed_Status", 3.0), ("Fear_Status", 4.0)],
        max_time: 100.0,
    },
    MatchupSpec {
        name: "rad_only_reg0",
        health_a: 18_000.0, regen_a: 0.0, damage_a: 820.0, bite_cd_a: 2.0,
        health_b: 11_800.0, damage_b: 1_200.0, bite_cd_b: 2.0,
        statuses: &[("Radiation_Status", 3.0)],
        max_time: 90.0,
    },
    MatchupSpec {
        name: "fear_hiHP_tank",
        health_a: 34_000.0, regen_a: 0.0, damage_a: 1_050.0, bite_cd_a: 2.0,
        health_b: 15_000.0, damage_b: 1_200.0, bite_cd_b: 2.0,
        statuses: &[("Fear_Status", 5.0)],
        max_time: 140.0,
    },
];

#[test]
#[ignore = "broad rollout validation harness; run explicitly with --ignored --nocapture"]
fn fortify_rollout_matchup_sweep() {
    let specs = SWEEP_SPECS;

    println!("\n============ FORTIFY ROLLOUT — BROAD VALIDATION SWEEP ============");
    println!("Fortify carrier = side A on every matchup. Both weight={WEIGHT} (ratio 1.0).");
    println!("Grids: ORACLE forces Fortify at t in {{0,0.5,..,40}} + a never-cast run.\n");

    println!("--- Matchup configs ---");
    println!(
        "{:<24} {:>7} {:>6} {:>6} {:>3} | {:>7} {:>6} {:>3} | {:<20} {:>5}",
        "name", "HP_A", "regA", "dmgA", "cdA", "HP_B", "dmgB", "cdB", "opp on-hit", "maxT"
    );
    for m in specs {
        let st = if m.statuses.is_empty() {
            "(none)".to_string()
        } else {
            m.statuses
                .iter()
                .map(|(id, s)| format!("{}x{:.0}", id.trim_end_matches("_Status"), s))
                .collect::<Vec<_>>()
                .join("+")
        };
        println!(
            "{:<24} {:>7.0} {:>6.0} {:>6.0} {:>3.0} | {:>7.0} {:>6.0} {:>3.0} | {:<20} {:>5.0}",
            m.name, m.health_a, m.regen_a, m.damage_a, m.bite_cd_a,
            m.health_b, m.damage_b, m.bite_cd_b, st, m.max_time
        );
    }

    println!("\n--- Results (winner + death_A/death_B per policy) ---");
    println!(
        "{:<24} | {:<20} | {:<18} | {:<16} | {:<4} {:<4} {:<5} {:<3} | forks/dec | oracle-flip-window",
        "name", "CURRENT dA/dB", "ROLLOUT fire", "ORACLE t*", "R==O", "R<C", "REGR", "IMP"
    );

    let mut regressions = 0usize;
    let mut opt_matches = 0usize;
    let mut improvements = 0usize;
    let mut regression_lines: Vec<String> = Vec::new();
    let mut mismatch_lines: Vec<String> = Vec::new();
    let mut improvement_lines: Vec<String> = Vec::new();

    for m in specs {
        set_fortify_rollout_override(Some(false));
        let current = run_spec(m, true, None, false);

        set_fortify_rollout_override(Some(true));
        let _ = take_rollout_cost();
        let rollout = run_spec(m, true, None, false);
        let (forks, decisions) = take_rollout_cost();

        set_fortify_rollout_override(Some(false));
        let oracle = compute_oracle(m);
        set_fortify_rollout_override(None);

        let rc = winner_rank(&current.winner);
        let rr = winner_rank(&rollout.winner);
        let ro = winner_rank(&oracle.winner);
        let eq_oracle = rr == ro;
        let worse_current = rr < rc;
        let regression = rr < rc && rr < ro;

        if eq_oracle {
            opt_matches += 1;
        }
        if rr > rc {
            improvements += 1;
            improvement_lines.push(format!(
                "  {} : CURRENT={} -> ROLLOUT={} (== ORACLE={})",
                m.name,
                winner_str(&current.winner),
                winner_str(&rollout.winner),
                winner_str(&oracle.winner),
            ));
        }
        if regression {
            regressions += 1;
            regression_lines.push(format!(
                "  {} : CURRENT={} ROLLOUT={} ORACLE={} — rollout strictly worse than both",
                m.name,
                winner_str(&current.winner),
                winner_str(&rollout.winner),
                winner_str(&oracle.winner),
            ));
        }
        if !eq_oracle {
            mismatch_lines.push(format!(
                "  {} : ROLLOUT={} (dA={} dB={}) vs ORACLE={} (t*={} dA={} dB={}); CURRENT={}",
                m.name,
                winner_str(&rollout.winner),
                fmt_opt(rollout.death_a),
                fmt_opt(rollout.death_b),
                winner_str(&oracle.winner),
                oracle.best_t.map(|t| format!("{t:.1}")).unwrap_or_else(|| "never".into()),
                fmt_opt(oracle.death_a),
                fmt_opt(oracle.death_b),
                winner_str(&current.winner),
            ));
        }

        let cur_cell = format!(
            "{} {}/{}",
            short_winner(&current.winner),
            fmt_opt(current.death_a),
            fmt_opt(current.death_b)
        );
        let fire = rollout.fortify_fire_times.first().copied();
        let roll_cell = format!(
            "{} @{}",
            short_winner(&rollout.winner),
            fire.map(|t| format!("{t:.1}")).unwrap_or_else(|| "never".into())
        );
        let ora_cell = format!(
            "{} t*={}",
            short_winner(&oracle.winner),
            oracle.best_t.map(|t| format!("{t:.1}")).unwrap_or_else(|| "-".into())
        );
        let flip_window = if oracle.flip_times.is_empty() {
            "(no A-flip)".to_string()
        } else {
            format!(
                "[{:.1}..{:.1}] n={}",
                oracle.flip_times.first().copied().unwrap_or(0.0),
                oracle.flip_times.last().copied().unwrap_or(0.0),
                oracle.flip_times.len()
            )
        };

        println!(
            "{:<24} | {:<20} | {:<18} | {:<16} | {:<4} {:<4} {:<5} {:<3} | {:>4}/{:<3} | {}",
            m.name,
            cur_cell,
            roll_cell,
            ora_cell,
            if eq_oracle { "YES" } else { "NO" },
            if worse_current { "YES" } else { "-" },
            if regression { "REGR!" } else { "-" },
            if rr > rc { "IMP" } else { "-" },
            forks,
            decisions,
            flip_window,
        );
    }

    let n = specs.len();
    println!("\n================ TASK 1 SUMMARY ================");
    println!("Matchups: {n}");
    println!(
        "REGRESSIONS (rollout strictly worse than CURRENT and ORACLE): {regressions}   (MUST be 0)"
    );
    println!(
        "OPTIMALITY (rollout winner == oracle winner): {}/{} = {:.1}%",
        opt_matches,
        n,
        100.0 * opt_matches as f64 / n as f64
    );
    println!("IMPROVEMENTS (rollout beats CURRENT, matching oracle): {improvements}");

    if regression_lines.is_empty() {
        println!("\nNo regressions: ROLLOUT never lands strictly below CURRENT.");
    } else {
        println!("\n!!!!!! REGRESSIONS — THESE BLOCK FLIPPING THE FLAG !!!!!!");
        for l in &regression_lines {
            println!("{l}");
        }
    }
    if improvement_lines.is_empty() {
        println!("\nNo improvements over CURRENT on this set.");
    } else {
        println!("\nImprovements (rollout fixed a CURRENT mis-time):");
        for l in &improvement_lines {
            println!("{l}");
        }
    }
    if mismatch_lines.is_empty() {
        println!("\nNo optimality mismatches: ROLLOUT == ORACLE on every matchup.");
    } else {
        println!("\nOptimality mismatches (rollout != oracle — residual):");
        for l in &mismatch_lines {
            println!("{l}");
        }
    }
    println!("================================================\n");
}
