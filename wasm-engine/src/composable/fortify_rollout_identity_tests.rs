//! Decision-identity gate for the Fortify rollout's sweep pruning
//! ([`super::posture_policy::FORTIFY_ROLLOUT_SHORT_CIRCUIT`]).
//!
//! The pruning is an early exit over the SAME candidate sequence, in the same
//! order, on the same inputs - it stops scoring candidates once the verdict is
//! already decided. So the two flag states must commit the IDENTICAL Fortify
//! fire timeline and the identical fight, down to the trace log. Each case runs
//! one matchup both ways in a single process and asserts exactly that, then
//! reports the forks the pruning saved.
//!
//! The synthetic cases cover the fire regimes the rollout has to get right
//! (multi-fire at the 480 s cap, single fire, both sides, draw, never-fires)
//! plus the shapes the `reference_tests::fortify` entry pins. The meta-pool
//! case is the honest Best Builds row that motivated the optimization; it is
//! `#[ignore]`d because a 480 s rollout fight is multi-second even in release.

use super::fortify_rollout_bridge::{
    set_fortify_rollout_override, set_fortify_short_circuit_override, take_rollout_cost,
};
use super::loop_iter::AbilityPolicyMode;
use super::reference_tests::default_combatant;
use super::toggle_replay_bridge::set_toggle_rollout_override;
use super::{simulate_composable_matchup_with_trace_control, DefensivePinControl};
use crate::composable::config::ComposableAbilityConfig;
use crate::contracts::{
    BestBuildsMatchupSummary, SimpleAbilityTimingMode, SimpleAppliedStatus, SimpleBreathProfile,
    SimpleCombatantStats,
};
use serde::Deserialize;

struct Case {
    name: String,
    attacker: SimpleCombatantStats,
    defender: SimpleCombatantStats,
    attacker_breath: Option<SimpleBreathProfile>,
    defender_breath: Option<SimpleBreathProfile>,
    policy: SimpleAbilityTimingMode,
    config: ComposableAbilityConfig,
    max_time_sec: f64,
}

struct Run {
    fires_a: Vec<f64>,
    fires_b: Vec<f64>,
    summary: BestBuildsMatchupSummary,
    forks: u64,
    decisions: u64,
}

/// Fortify activation times per side, read out of the trace log.
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

/// One full fight with both rollouts engaged and the sweep pruning forced
/// `prune`, plus the rollout's fork / decision tally for that fight.
fn run_case(c: &Case, prune: bool) -> Run {
    set_fortify_rollout_override(Some(true));
    set_toggle_rollout_override(Some(true));
    set_fortify_short_circuit_override(Some(prune));
    let _ = take_rollout_cost();
    let summary = simulate_composable_matchup_with_trace_control(
        &c.attacker,
        &c.defender,
        c.attacker_breath.as_ref(),
        c.defender_breath.as_ref(),
        c.policy,
        &c.config,
        c.max_time_sec,
        true,
        DefensivePinControl::default(),
        AbilityPolicyMode::Normal,
        None,
        None,
        None,
    );
    let (forks, decisions) = take_rollout_cost();
    set_fortify_short_circuit_override(None);
    set_fortify_rollout_override(None);
    set_toggle_rollout_override(None);
    let (fires_a, fires_b) = fortify_fires(&summary);
    Run { fires_a, fires_b, summary, forks, decisions }
}

/// Run `c` both ways and assert the pruned sweep decided the identical fight.
/// Returns `(full-sweep forks, pruned forks, decisions)` for the cost report.
fn assert_decision_identical(c: &Case) -> (u64, u64, u64) {
    let full = run_case(c, false);
    let pruned = run_case(c, true);

    assert_eq!(
        (&full.fires_a, &full.fires_b),
        (&pruned.fires_a, &pruned.fires_b),
        "{}: pruned sweep shifted the committed Fortify fire timeline",
        c.name
    );
    assert_eq!(
        (full.summary.winner, full.summary.death_time_a, full.summary.death_time_b),
        (pruned.summary.winner, pruned.summary.death_time_a, pruned.summary.death_time_b),
        "{}: pruned sweep changed the fight outcome",
        c.name
    );
    assert_eq!(
        format!("{:?}", strip_log(&full.summary)),
        format!("{:?}", strip_log(&pruned.summary)),
        "{}: pruned sweep changed a summary field",
        c.name
    );
    assert!(
        format!("{:?}", full.summary.combat_log) == format!("{:?}", pruned.summary.combat_log),
        "{}: summary fields match but the trace log diverged - the fights are not identical",
        c.name
    );
    assert_eq!(full.decisions, pruned.decisions, "{}: decision count moved", c.name);
    assert!(
        pruned.forks <= full.forks,
        "{}: pruning must not add forks (full={} pruned={})",
        c.name,
        full.forks,
        pruned.forks
    );
    println!(
        "  {:<34} decisions={:<5} forks {:>7} -> {:>7} ({:.2}x)  fires A={:?} B={:?}",
        c.name,
        full.decisions,
        full.forks,
        pruned.forks,
        full.forks as f64 / pruned.forks.max(1) as f64,
        full.fires_a,
        full.fires_b
    );
    (full.forks, pruned.forks, full.decisions)
}

/// The summary minus its trace log and its work meter: the log is stripped to
/// keep the field comparison readable, and `work_units` is the COST of deciding,
/// which the pruning is supposed to change. Everything the fight produced is
/// still compared.
fn strip_log(s: &BestBuildsMatchupSummary) -> BestBuildsMatchupSummary {
    let mut out = s.clone();
    out.combat_log = None;
    out.work_units = 0;
    out
}

fn report(label: &str, cases: &[Case]) {
    println!("\n=== Fortify sweep pruning: decision identity + cost ({label}) ===");
    let (mut full_total, mut pruned_total) = (0_u64, 0_u64);
    for c in cases {
        let (full, pruned, _) = assert_decision_identical(c);
        full_total += full;
        pruned_total += pruned;
    }
    println!(
        "  TOTAL forks {full_total} -> {pruned_total} ({:.2}x fewer inner replays, identical decisions)",
        full_total as f64 / pruned_total.max(1) as f64
    );
}

// ---------------------------------------------------------------------------
// Synthetic corpus - the fire regimes plus the reference-entry shapes.
// ---------------------------------------------------------------------------

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

fn passive_combatant(max_hp: f64) -> SimpleCombatantStats {
    let mut c = default_combatant();
    c.health = max_hp;
    c.damage = 0.0;
    c.bite_cooldown = 1000.0;
    c
}

fn case(
    name: &str,
    attacker: SimpleCombatantStats,
    defender: SimpleCombatantStats,
    config: ComposableAbilityConfig,
    max_time_sec: f64,
) -> Case {
    Case {
        name: name.to_string(),
        attacker,
        defender,
        attacker_breath: None,
        defender_breath: None,
        policy: SimpleAbilityTimingMode::Ideal,
        config,
        max_time_sec,
    }
}

fn defender_fortify() -> ComposableAbilityConfig {
    let mut cfg = ComposableAbilityConfig::default();
    cfg.defender_fortify = true;
    cfg
}

fn attacker_fortify() -> ComposableAbilityConfig {
    let mut cfg = ComposableAbilityConfig::default();
    cfg.attacker_fortify = true;
    cfg
}

fn both_fortify() -> ComposableAbilityConfig {
    let mut cfg = ComposableAbilityConfig::default();
    cfg.attacker_fortify = true;
    cfg.defender_fortify = true;
    cfg
}

fn fire_regime_cases() -> Vec<Case> {
    vec![
        // Multi-fire at the BB cap - the longest decision sequence, and the one
        // the pin-replay suite proves the rollout must reproduce exactly.
        case(
            "multi-fire/480s",
            combatant(60_000.0, 900.0, 2.0, 0.0, &[("Bleed_Status", 3.0), ("Radiation_Status", 3.0)]),
            combatant(120_000.0, 700.0, 2.0, 40.0, &[]),
            defender_fortify(),
            480.0,
        ),
        case(
            "single-fire/bleed+rad",
            combatant(11_800.0, 1_360.0, 2.0, 0.0, &[("Bleed_Status", 3.0), ("Radiation_Status", 3.0)]),
            combatant(20_000.0, 820.0, 2.0, 25.0, &[]),
            defender_fortify(),
            90.0,
        ),
        case(
            "single-fire/radiation-only",
            combatant(12_000.0, 1_200.0, 2.0, 0.0, &[("Radiation_Status", 4.0)]),
            combatant(16_000.0, 820.0, 2.0, 0.0, &[]),
            defender_fortify(),
            90.0,
        ),
        case(
            "both-sides",
            combatant(17_000.0, 1_050.0, 2.0, 18.0, &[("Bleed_Status", 3.0)]),
            combatant(17_000.0, 1_050.0, 2.0, 18.0, &[("Bleed_Status", 3.0)]),
            both_fortify(),
            90.0,
        ),
        case(
            "draw",
            combatant(30_000.0, 700.0, 2.0, 20.0, &[("Bleed_Status", 2.0)]),
            combatant(30_000.0, 700.0, 2.0, 20.0, &[("Bleed_Status", 2.0)]),
            both_fortify(),
            90.0,
        ),
        case(
            "never-fires/dot-free",
            combatant(14_000.0, 1_100.0, 2.0, 0.0, &[]),
            combatant(20_000.0, 820.0, 2.0, 25.0, &[]),
            defender_fortify(),
            90.0,
        ),
    ]
}

/// The shapes `reference_tests::fortify` pins, run through the precision modes
/// the rollout actually serves (the entry's own tests use ReallyFast, which
/// resolves on its gate and never enters the rollout).
fn reference_shape_cases() -> Vec<Case> {
    let mut cases = Vec::new();

    let mut sustained_a = passive_combatant(1_000_000.0);
    sustained_a.damage = 50.0;
    sustained_a.bite_cooldown = 2.0;
    let mut sustained_b = passive_combatant(1_000_000.0);
    sustained_b.damage = 1.0;
    sustained_b.bite_cooldown = 1.0;
    sustained_b.on_hit_statuses = vec![SimpleAppliedStatus {
        status_id: "Bleed_Status".to_string(),
        stacks: 3.0,
        ..Default::default()
    }];

    let mut fear_a = passive_combatant(1_000_000.0);
    fear_a.damage = 50.0;
    fear_a.bite_cooldown = 2.0;
    fear_a.weight = 1_000.0;
    fear_a.starting_statuses = vec![SimpleAppliedStatus {
        status_id: "Fear_Status".to_string(),
        stacks: 10.0,
        ..Default::default()
    }];
    let mut fear_b = passive_combatant(1_000_000.0);
    fear_b.weight = 100.0;

    let mut pile_a = passive_combatant(500_000.0);
    pile_a.damage = 300.0;
    pile_a.bite_cooldown = 1.3;
    pile_a.weight = 44_900.0;
    pile_a.starting_statuses = vec![SimpleAppliedStatus {
        status_id: "Fear_Status".to_string(),
        stacks: 10.0,
        ..Default::default()
    }];
    let mut pile_b = passive_combatant(200_000.0);
    pile_b.damage = 200.0;
    pile_b.bite_cooldown = 2.0;
    pile_b.weight = 20_000.0;
    pile_b.on_hit_statuses = vec![SimpleAppliedStatus {
        status_id: "Bleed_Status".to_string(),
        stacks: 1.0,
        ..Default::default()
    }];

    for mode in [
        SimpleAbilityTimingMode::SemiIdeal,
        SimpleAbilityTimingMode::Ideal,
        SimpleAbilityTimingMode::Extreme,
    ] {
        for (label, a, b, max_time) in [
            ("ref/sustained-dot", &sustained_a, &sustained_b, 120.0),
            ("ref/fear-only", &fear_a, &fear_b, 30.0),
            ("ref/fear-pile", &pile_a, &pile_b, 60.0),
        ] {
            cases.push(Case {
                name: format!("{label}/{mode:?}"),
                attacker: a.clone(),
                defender: b.clone(),
                attacker_breath: None,
                defender_breath: None,
                policy: mode,
                config: attacker_fortify(),
                max_time_sec: max_time,
            });
        }
    }
    cases
}

#[test]
fn pruned_sweep_decides_the_identical_fight() {
    report("fire regimes", &fire_regime_cases());
}

#[test]
fn pruned_sweep_decides_the_identical_fight_on_reference_shapes() {
    report("reference_tests::fortify shapes", &reference_shape_cases());
}

// ---------------------------------------------------------------------------
// Meta-pool corpus: the honest Best Builds row that motivated the optimization.
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct CorpusCase {
    name: String,
    attacker: SimpleCombatantStats,
    defender: SimpleCombatantStats,
    #[serde(rename = "attackerBreath", default)]
    attacker_breath: Option<SimpleBreathProfile>,
    #[serde(rename = "defenderBreath", default)]
    defender_breath: Option<SimpleBreathProfile>,
    #[serde(rename = "abilityPolicy")]
    ability_policy: String,
    #[serde(rename = "abilityConfig")]
    ability_config: ComposableAbilityConfig,
    #[serde(rename = "maxTimeSec")]
    max_time_sec: f64,
}

fn policy_from_str(s: &str) -> SimpleAbilityTimingMode {
    match s {
        "ideal" => SimpleAbilityTimingMode::Ideal,
        "extreme" => SimpleAbilityTimingMode::Extreme,
        "fast" => SimpleAbilityTimingMode::Fast,
        "reallyFast" => SimpleAbilityTimingMode::ReallyFast,
        _ => SimpleAbilityTimingMode::SemiIdeal,
    }
}

/// The four Fortify-carrying opponents of the honest Best Builds row, captured
/// as the exact engine arguments the TS bridge hands the WASM (source Velkhyra
/// V5 Damage+Bite Powerful 2x Void, `ideal`, 480 s). Inputs only - nothing here
/// pins a live game number as an expectation; the assertion is off-vs-on
/// equality. Regenerate with `npx tsx scratch_fortify_identity.ts <label>
/// --dump-corpus` after a roster refresh.
fn meta_pool_cases() -> Vec<Case> {
    let json = include_str!("../../fixtures/fortify_rollout_corpus.json");
    let cases: Vec<CorpusCase> =
        serde_json::from_str(json).expect("parse fortify_rollout_corpus");
    assert!(!cases.is_empty(), "fortify_rollout_corpus must not be empty");
    cases
        .into_iter()
        .map(|c| Case {
            name: c.name,
            attacker: c.attacker,
            defender: c.defender,
            attacker_breath: c.attacker_breath,
            defender_breath: c.defender_breath,
            policy: policy_from_str(&c.ability_policy),
            config: c.ability_config,
            max_time_sec: c.max_time_sec,
        })
        .collect()
}

/// `#[ignore]`: four 480 s rollout fights run twice each. Run with
/// `cargo test --lib --release fortify_rollout_identity -- --ignored --nocapture`.
#[test]
#[ignore = "480 s meta-pool fights; run explicitly with --release --ignored --nocapture"]
fn pruned_sweep_decides_the_identical_fight_on_meta_pool() {
    report("meta pool (Velkhyra V5 vs the replay opponents)", &meta_pool_cases());
}
