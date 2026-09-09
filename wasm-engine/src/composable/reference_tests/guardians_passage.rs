//! Reference: ability_guardians_passage
//!
//! Covers each testable bullet in the "Guardians Passage" entry. Each test body
//! starts with the [REF:ability_guardians_passage] marker so the vitest coverage
//! gate (src/pages/referenceCoverage.test.ts) sees it.
//!
//! Engine path: `composable/phases/phase4.rs` (Phase 4p0). On activation:
//! `guardians_passage_cooldown_until = time + scale_active_cooldown(stats,
//! GUARDIANS_PASSAGE_COOLDOWN_SEC)` and `apply_guardian_seal` puts
//! GUARDIANS_PASSAGE_SEAL_STACKS stacks of Guardian_Seal_Status on the user.

use super::super::config::ComposableAbilityConfig;
use super::super::damage_pipeline::GUARDIAN_SEAL_STATUS;
use super::super::simulate_composable_matchup_with_trace;
use super::default_combatant;
use crate::contracts::{SimpleAbilityTimingMode, SimpleCombatantStats};
use crate::spec_constants::{GUARDIANS_PASSAGE_COOLDOWN_SEC, GUARDIANS_PASSAGE_SEAL_STACKS};

fn brawler(max_hp: f64) -> SimpleCombatantStats {
    let mut c = default_combatant();
    c.health = max_hp;
    c.damage = 100.0;
    c.bite_cooldown = 1.0;
    c
}

fn passage_attacker_cfg() -> ComposableAbilityConfig {
    let mut cfg = ComposableAbilityConfig::default();
    cfg.attacker_guardians_passage = true;
    cfg
}

/// Every "Guardians Passage activated" entry the trace holds, in order.
fn activation_times(log: &[crate::contracts::CombatLogEntry]) -> Vec<f64> {
    log.iter()
        .filter(|e| e.description.as_deref() == Some("Guardians Passage activated"))
        .map(|e| e.time)
        .collect()
}

#[test]
fn cooldown_runs_the_length_the_entry_states() {
    // [REF:ability_guardians_passage]
    // Bullet 1: "Guardians Passage has a 300 second cooldown."
    // Both sides bite for real out of huge pools so the loop keeps running past
    // the cooldown; the gap between the first two activations is the cooldown.
    let attacker = brawler(50_000_000.0);
    let defender = brawler(50_000_000.0);

    let result = simulate_composable_matchup_with_trace(
        &attacker, &defender, None, None,
        SimpleAbilityTimingMode::ReallyFast,
        &passage_attacker_cfg(),
        GUARDIANS_PASSAGE_COOLDOWN_SEC + 60.0, true,
    );
    let log = result.combat_log.expect("trace");
    let activations = activation_times(&log);
    assert!(
        activations.len() >= 2,
        "Guardians Passage must fire at least twice past one cooldown: {activations:?}"
    );
    let gap = activations[1] - activations[0];
    assert!(
        (gap - GUARDIANS_PASSAGE_COOLDOWN_SEC).abs() < 1.0,
        "the second use must land ~{GUARDIANS_PASSAGE_COOLDOWN_SEC} s after the first, got {gap}: {activations:?}"
    );
}

#[test]
fn applies_the_seal_stacks_the_entry_states() {
    // [REF:ability_guardians_passage]
    // Bullet 2: "Using it applies 3 stacks of Guardian's Seal to the user."
    // The status-apply log carries the stack count the ability handed out.
    let attacker = brawler(50_000_000.0);
    let defender = brawler(50_000_000.0);

    let result = simulate_composable_matchup_with_trace(
        &attacker, &defender, None, None,
        SimpleAbilityTimingMode::ReallyFast,
        &passage_attacker_cfg(),
        20.0, true,
    );
    let log = result.combat_log.expect("trace");
    let applied: Vec<&str> = log
        .iter()
        .filter(|e| {
            e.status_id.as_deref() == Some(GUARDIAN_SEAL_STATUS)
                && e.description.as_deref().is_some_and(|d| d.contains("applied"))
        })
        .map(|e| e.description.as_deref().unwrap_or(""))
        .collect();
    assert!(
        !applied.is_empty(),
        "using Guardians Passage must seal the user: no Guardian's Seal in the trace"
    );
    let stacks = format!("({})", GUARDIANS_PASSAGE_SEAL_STACKS as i64);
    assert!(
        applied[0].contains(&stacks),
        "the first seal must carry {GUARDIANS_PASSAGE_SEAL_STACKS} stacks, got {:?}",
        applied[0]
    );
}

#[test]
fn the_side_without_the_ability_never_seals_itself() {
    // [REF:ability_guardians_passage]
    // The config gate is per side: with only the attacker's flag set, nothing
    // seals B. Guards against a gate read from the wrong side.
    let attacker = brawler(50_000_000.0);
    let defender = brawler(50_000_000.0);

    let result = simulate_composable_matchup_with_trace(
        &attacker, &defender, None, None,
        SimpleAbilityTimingMode::ReallyFast,
        &passage_attacker_cfg(),
        60.0, true,
    );
    let log = result.combat_log.expect("trace");
    let sealed_b = log.iter().any(|e| {
        e.status_id.as_deref() == Some(GUARDIAN_SEAL_STATUS) && e.hp_side == "B"
    });
    assert!(!sealed_b, "B does not carry Guardians Passage and must never be sealed");
}

#[test]
fn using_it_takes_three_quarters_of_the_users_pool() {
    // [REF:ability_guardians_passage]
    let mut user = brawler(1_000_000.0);
    user.damage = 0.0;
    user.stamina = 100.0;
    user.stamina_regen = 0.0;
    let mut opponent = brawler(1_000_000.0);
    opponent.damage = 0.0;
    opponent.stamina = 100.0;
    opponent.stamina_regen = 0.0;

    let mut cfg = passage_attacker_cfg();
    cfg.stamina_enabled = true;
    let debug = simulate_composable_matchup_with_trace(
        &user, &opponent, None, None,
        SimpleAbilityTimingMode::Ideal,
        &cfg,
        10.0, true,
    )
    .debug
    .expect("side snapshots");
    assert_eq!(debug.a.stamina, 25.0, "the user arrives exhausted, at a quarter of a 100 pool");
    assert_eq!(debug.b.stamina, 100.0, "and the other side keeps its full 100");
}

#[test]
fn a_fight_that_does_not_model_stamina_pays_nothing_for_it() {
    // [REF:ability_guardians_passage]
    let mut user = brawler(1_000_000.0);
    user.damage = 0.0;
    user.stamina = 100.0;
    user.stamina_regen = 0.0;

    let debug = simulate_composable_matchup_with_trace(
        &user, &user, None, None,
        SimpleAbilityTimingMode::Ideal,
        &passage_attacker_cfg(),
        10.0, true,
    )
    .debug
    .expect("side snapshots");
    assert_eq!(debug.a.stamina, 100.0);
}
