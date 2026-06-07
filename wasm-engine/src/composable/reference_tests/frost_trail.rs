//! Reference: ability_frost_trail
//!
//! Covers each testable bullet in the "Frost Trail" entry. Each test
//! body starts with the [REF:ability_frost_trail] marker so the vitest
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
    // [REF:ability_frost_trail]
    let attacker = passive_combatant(1_000.0);
    let defender = passive_combatant(10_000.0);
    let mut cfg = ComposableAbilityConfig::default();
    cfg.attacker_frost_trail_value = 50.0;
    let result = simulate_composable_matchup_with_trace(
        &attacker, &defender, None, None,
        SimpleAbilityTimingMode::Fast,
        &cfg, 10.0, true,
    );
    let log = result.combat_log.expect("trace log");
    let frostbite_present = log
        .iter()
        .any(|e| e.status_id.as_deref() == Some("Frostbite_Status"));
    assert!(
        !frostbite_present,
        "Frost Trail must not apply Frostbite while owner HP stays above threshold"
    );
}

#[test]
fn applies_frostbite_to_opponent_below_threshold() {
    // [REF:ability_frost_trail]
    let attacker = passive_combatant(1_000.0);
    let defender = passive_combatant(10_000.0);
    let mut cfg = ComposableAbilityConfig::default();
    cfg.attacker_frost_trail_value = 100.0; // always active.
    let result = simulate_composable_matchup_with_trace(
        &attacker, &defender, None, None,
        SimpleAbilityTimingMode::Fast,
        &cfg, 5.0, true,
    );
    let log = result.combat_log.expect("trace log");
    let frostbite_present = log
        .iter()
        .any(|e| e.status_id.as_deref() == Some("Frostbite_Status"));
    assert!(
        frostbite_present,
        "Frost Trail must apply Frostbite_Status to the opponent while active"
    );
    assert!(
        result.final_hp_b < defender.health,
        "Frost Trail must deal damage to the opponent (2% of max HP per second)"
    );
}

#[test]
fn override_flips_no_move_facetank_off_while_trail_active() {
    // [REF:ability_frost_trail]
    // Bullet: "While any of the owner's trail abilities is active, No Move
    // Facetank is automatically overridden off; the previous setting is
    // restored when the override clears."
    //
    // Same shape as the Flame Trail override test: pre-load Frostbite on
    // the trail owner, run with always-active Frost Trail vs no-trail
    // baseline, assert override suppresses persistent decay so DoT
    // contribution is greater under the trail. Cross-reference:
    // `compare_no_move_facetank` for the underlying mechanic.
    let mut a = default_combatant();
    a.health = 1_000.0;
    a.weight = 100.0;
    a.damage = 0.0;
    a.bite_cooldown = 1000.0;
    a.starting_statuses = vec![applied_status("Frostbite_Status", 4.0)];
    let mut b = default_combatant();
    b.health = 10_000_000.0;
    b.weight = 100.0;
    b.damage = 1.0;
    b.bite_cooldown = 5.0;

    // Note: Frostbite isn't a damage DoT - it modifies bite cooldown via
    // remaining_sec/3 ceil. We assert override impact via remaining
    // Frostbite stacks on A at sim end: under the trail, decay is
    // suppressed and stacks are higher than baseline.
    let baseline_cfg = ComposableAbilityConfig::default();
    let baseline_run = simulate_composable_matchup_with_trace(
        &a, &b, None, None,
        SimpleAbilityTimingMode::SemiIdeal,
        &baseline_cfg, 7.0, true,
    );
    let mut trail_cfg = ComposableAbilityConfig::default();
    trail_cfg.attacker_frost_trail_value = 100.0;
    let trail_run = simulate_composable_matchup_with_trace(
        &a, &b, None, None,
        SimpleAbilityTimingMode::SemiIdeal,
        &trail_cfg, 7.0, true,
    );
    // Defender bites A every 5 s with 1 dmg → tiny HP loss; both runs end
    // very near full HP. Compare via Frostbite stacks decayed: each run's
    // log of natural-decay events on A. Override path emits zero decay
    // events for Frostbite; baseline emits at least one.
    let baseline_log = baseline_run.combat_log.expect("baseline trace");
    let trail_log = trail_run.combat_log.expect("trail trace");
    let count_decays = |log: &[crate::contracts::CombatLogEntry]| -> usize {
        log.iter()
            .filter(|e| {
                e.status_id.as_deref() == Some("Frostbite_Status")
                    && e.attacker == "A"
                    && e.description.as_deref().is_some_and(|d| {
                        // emit_status_decay_log emits "<status> naturally
                        // decayed" or "<status> naturally expired" for both
                        // partial and full decay events.
                        d.contains("naturally")
                    })
            })
            .count()
    };
    let baseline_decays = count_decays(&baseline_log);
    let trail_decays = count_decays(&trail_log);
    assert!(
        baseline_decays > 0,
        "baseline (no trail) must record at least one Frostbite decay event in 7 s"
    );
    assert!(
        trail_decays < baseline_decays,
        "Frost Trail override must suppress Frostbite decay events: \
         trail decays={trail_decays}, baseline decays={baseline_decays}"
    );
}
