//! Cost reports for a real Best Builds fight, over the captured meta-pool
//! corpus (`fixtures/fortify_rollout_corpus.json` - the exact engine arguments
//! the TS bridge hands the WASM for an honest Best Builds row).
//!
//! - `ideal_cost_profile` splits an `ideal` fight between the two engaged
//!   rollouts and the fight itself, which is what says where an optimizer run's
//!   time actually goes.
//! - `setup_vs_loop_cost_profile` splits a fight between its per-fight setup and
//!   its per-iteration cost, so a change to the iteration body can be priced.
//! - `summary_identity_dump` prints every summary in full, including the trace
//!   log, so a change meant to be behaviour-preserving can be diffed against the
//!   build before it.
//!
//! All `#[ignore]`d; run with
//! `cargo test --lib --release <name> -- --ignored --nocapture`.

use std::time::Instant;

use super::fortify_rollout_bridge::{set_fortify_rollout_override, take_rollout_cost};
use super::toggle_replay_bridge::set_toggle_rollout_override;
use super::work_meter;
use crate::composable::config::ComposableAbilityConfig;
use crate::contracts::{
    SimpleAbilityTimingMode, SimpleBreathProfile, SimpleCombatantStats,
};
use serde::Deserialize;

#[derive(Deserialize)]
struct CorpusCase {
    name: String,
    attacker: SimpleCombatantStats,
    defender: SimpleCombatantStats,
    #[serde(rename = "attackerBreath")]
    attacker_breath: Option<SimpleBreathProfile>,
    #[serde(rename = "defenderBreath")]
    defender_breath: Option<SimpleBreathProfile>,
    #[serde(rename = "abilityConfig")]
    ability_config: ComposableAbilityConfig,
    #[serde(rename = "maxTimeSec")]
    max_time_sec: f64,
}

fn corpus() -> Vec<CorpusCase> {
    serde_json::from_str(include_str!("../../fixtures/fortify_rollout_corpus.json"))
        .expect("parse fortify_rollout_corpus")
}

struct Run {
    ms: f64,
    iters: u64,
    forks: u64,
    decisions: u64,
    winner: String,
}

fn run_case_at(
    c: &CorpusCase,
    policy: SimpleAbilityTimingMode,
    fortify: bool,
    toggle: bool,
    max_time_sec: f64,
    reps: u32,
) -> Run {
    set_fortify_rollout_override(Some(fortify));
    set_toggle_rollout_override(Some(toggle));
    let _ = take_rollout_cost();
    let before = work_meter::engine_iters();
    let started = Instant::now();
    let mut winner = String::new();
    for _ in 0..reps {
        let summary = super::simulate_composable_matchup(
            &c.attacker,
            &c.defender,
            c.attacker_breath.as_ref(),
            c.defender_breath.as_ref(),
            policy,
            &c.ability_config,
            max_time_sec,
        );
        winner = format!("{:?}", summary.winner);
    }
    let ms = started.elapsed().as_secs_f64() * 1000.0 / f64::from(reps);
    let iters = work_meter::engine_iters().saturating_sub(before) / u64::from(reps);
    let (forks, decisions) = take_rollout_cost();
    set_fortify_rollout_override(None);
    set_toggle_rollout_override(None);
    Run { ms, iters, forks: forks / u64::from(reps), decisions: decisions / u64::from(reps), winner }
}

/// Separates the per-fight fixed cost (input clones, `CombatSide::new`,
/// `populate_combat_sides_and_flags`, summary assembly) from the per-iteration
/// cost, by running the same matchup at a horizon short enough to be almost all
/// setup and again at the real horizon.
#[test]
#[ignore = "profile; run with --release --ignored --nocapture"]
fn setup_vs_loop_cost_profile() {
    println!("{:<20} {:>10} {:>8} {:>10} {:>8} {:>12} {:>10}", "case", "setupMs", "setupIt", "fullMs", "fullIt", "usPerIter", "setupShare");
    for c in &corpus() {
        let short = run_case_at(c, SimpleAbilityTimingMode::ReallyFast, false, false, 0.05, 200);
        let full = run_case_at(c, SimpleAbilityTimingMode::ReallyFast, false, false, c.max_time_sec, 20);
        let extra_iters = full.iters.saturating_sub(short.iters).max(1);
        let per_iter_us = (full.ms - short.ms) * 1000.0 / extra_iters as f64;
        println!(
            "{:<20} {:>10.3} {:>8} {:>10.3} {:>8} {:>12.2} {:>9.0}%",
            &c.name[..c.name.len().min(20)],
            short.ms, short.iters, full.ms, full.iters, per_iter_us,
            short.ms / full.ms * 100.0,
        );
    }
}

fn run_case(c: &CorpusCase, policy: SimpleAbilityTimingMode, fortify: bool, toggle: bool) -> Run {
    set_fortify_rollout_override(Some(fortify));
    set_toggle_rollout_override(Some(toggle));
    let _ = take_rollout_cost();
    let before = work_meter::engine_iters();
    let started = Instant::now();
    let summary = super::simulate_composable_matchup(
        &c.attacker,
        &c.defender,
        c.attacker_breath.as_ref(),
        c.defender_breath.as_ref(),
        policy,
        &c.ability_config,
        c.max_time_sec,
    );
    let ms = started.elapsed().as_secs_f64() * 1000.0;
    let iters = work_meter::engine_iters().saturating_sub(before);
    let (forks, decisions) = take_rollout_cost();
    set_fortify_rollout_override(None);
    set_toggle_rollout_override(None);
    Run { ms, iters, forks, decisions, winner: format!("{:?}", summary.winner) }
}

/// `#[ignore]`: several 480 s rollout fights. Release only.
#[test]
#[ignore = "profile; run with --release --ignored --nocapture"]
fn ideal_cost_profile() {
    let cases = corpus();
    println!(
        "{:<34} {:>12} {:>10} {:>9} {:>9} {:>9} {:>8}",
        "case / mode", "ms", "iters", "forks", "decis", "us/iter", "winner"
    );
    let mut totals = [0.0f64; 4];
    for c in &cases {
        let modes: [(&str, SimpleAbilityTimingMode, bool, bool); 4] = [
            ("ideal  (both rollouts)", SimpleAbilityTimingMode::Ideal, true, true),
            ("ideal  (no fortify roll)", SimpleAbilityTimingMode::Ideal, false, true),
            ("ideal  (no rollouts)", SimpleAbilityTimingMode::Ideal, false, false),
            ("reallyFast (no rollouts)", SimpleAbilityTimingMode::ReallyFast, false, false),
        ];
        for (idx, (label, policy, fortify, toggle)) in modes.iter().enumerate() {
            let r = run_case(c, *policy, *fortify, *toggle);
            totals[idx] += r.ms;
            println!(
                "{:<34} {:>12.1} {:>10} {:>9} {:>9} {:>9.2} {:>8}",
                format!("{} / {}", &c.name[..c.name.len().min(14)], label),
                r.ms,
                r.iters,
                r.forks,
                r.decisions,
                if r.iters > 0 { r.ms * 1000.0 / r.iters as f64 } else { 0.0 },
                r.winner,
            );
        }
    }
    println!(
        "TOTALS ms: both={:.0} noFortifyRollout={:.0} noRollouts={:.0} reallyFast={:.0}",
        totals[0], totals[1], totals[2], totals[3]
    );
    println!(
        "fortify rollout share = {:.1}%   all-rollout share = {:.1}%",
        (totals[0] - totals[1]) / totals[0] * 100.0,
        (totals[0] - totals[2]) / totals[0] * 100.0,
    );
}

/// Full-summary dump for an off-vs-on byte-identity diff of an engine change.
/// Prints one JSON line per (case, policy); compare two builds' output with a
/// plain text diff.
#[test]
#[ignore = "identity dump; run with --release --ignored --nocapture"]
fn summary_identity_dump() {
    for c in &corpus() {
        for policy in [
            SimpleAbilityTimingMode::ReallyFast,
            SimpleAbilityTimingMode::Fast,
            SimpleAbilityTimingMode::SemiIdeal,
            SimpleAbilityTimingMode::Ideal,
        ] {
            let summary = super::simulate_composable_matchup_with_trace(
                &c.attacker,
                &c.defender,
                c.attacker_breath.as_ref(),
                c.defender_breath.as_ref(),
                policy,
                &c.ability_config,
                c.max_time_sec,
                true,
            );
            println!(
                "{} {:?} {}",
                c.name,
                policy,
                serde_json::to_string(&summary).expect("serialize summary"),
            );
        }
    }
}
