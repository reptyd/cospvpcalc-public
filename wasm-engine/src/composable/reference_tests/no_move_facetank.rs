//! Reference: compare_no_move_facetank
//!
//! Covers each testable bullet in the "No Move Facetank" entry. Each
//! test body starts with the [REF:compare_no_move_facetank] marker
//! so the vitest coverage gate (src/pages/referenceCoverage.test.ts)
//! sees it.
//!
//! Encoding chain (see `composable/mod.rs:293-313`):
//! - TS `compareNoMoveFacetank` flag inverts to Rust
//!   `compare_block_persistent_decay`. Default Rust value `false` =
//!   TS default `compareNoMoveFacetank=true` (decay active).
//! - When `block_persistent_decay = true`, the persistent PvP statuses
//!   (the game's DoesNotHealWhileMoving set: Poison, Burn, Bleed,
//!   Corrosion, Necropoison, Frostbite, Radiation, Hypothermia) do NOT
//!   decay naturally. Sickly shares that flag but its only source
//!   (Defiled Ground) applies it permanently, so it never decays.

use super::super::config::ComposableAbilityConfig;
use super::super::simulate_composable_matchup_with_trace;
use super::default_combatant;
use crate::contracts::{SimpleAbilityTimingMode, SimpleAppliedStatus, SimpleCombatantStats};
use crate::statuses::{compute_simple_dot_damage, status_decay_sec};

fn passive_combatant(max_hp: f64) -> SimpleCombatantStats {
    let mut c = default_combatant();
    c.health = max_hp;
    c.damage = 0.0;
    c.bite_cooldown = 1000.0;
    c
}

#[test]
fn nmf_enabled_default_lets_persistent_statuses_decay_naturally() {
    // [REF:compare_no_move_facetank]
    // Bullet 4 (default-on branch): "With it on, those statuses decay
    // normally." Engine: with `compare_block_persistent_decay = false` (TS
    // default), Burn sheds one stack every `status_decay_sec` and the tick
    // reads the post-decay count. Burn x 5 therefore produces exactly five
    // ticks whose damage steps down by one stack's worth each time, and the
    // stream ends once the last stack is gone - well inside the 20 s window.
    let stacks = 5.0_f64;
    let mut attacker = passive_combatant(1_000_000.0);
    attacker.starting_statuses = vec![SimpleAppliedStatus {
        status_id: "Burn_Status".to_string(),
        stacks,
        ..Default::default()
    }];
    let defender = passive_combatant(10_000_000_000.0);
    let result = simulate_composable_matchup_with_trace(
        &attacker, &defender, None, None,
        SimpleAbilityTimingMode::ReallyFast,
        &ComposableAbilityConfig::default(),
        20.0, true,
    );
    let log = result.combat_log.expect("trace");
    let burn: Vec<(f64, f64)> = log
        .iter()
        .filter(|e| {
            e.entry_type == "dot"
                && e.status_id.as_deref() == Some("Burn_Status")
                && e.hp_side == "A"
        })
        .map(|e| (e.time, e.damage))
        .collect();
    let decay_sec = status_decay_sec("Burn_Status");
    let expected: Vec<(f64, f64)> = (0..stacks as usize)
        .map(|i| {
            let post_decay = stacks - (i as f64 + 1.0);
            (
                decay_sec * (i as f64 + 1.0),
                compute_simple_dot_damage(attacker.health, "Burn_Status", post_decay),
            )
        })
        .collect();
    assert_eq!(
        burn.len(),
        expected.len(),
        "natural decay must retire Burn × {stacks} after {} ticks: got {burn:?}",
        expected.len()
    );
    for ((got_t, got_dmg), (want_t, want_dmg)) in burn.iter().zip(expected.iter()) {
        assert!(
            (got_t - want_t).abs() < 1e-9,
            "Burn tick cadence must follow the decay interval: expected {want_t}, got {got_t} \
             ({burn:?})"
        );
        assert!(
            (got_dmg - want_dmg).abs() < 1e-6,
            "Burn tick at t={got_t} must read the post-decay stack count \
             (expected {want_dmg}, got {got_dmg}): {burn:?}"
        );
    }
}

#[test]
fn nmf_disabled_freezes_persistent_status_decay() {
    // [REF:compare_no_move_facetank]
    // Bullet 3 (toggle-off branch): "With No Move Facetank off, those statuses
    // stop naturally decaying." Engine: with `compare_block_persistent_decay =
    // true`, Burn stacks stay at 5 and DoT keeps firing on the original
    // cadence for the whole window.
    let mut attacker = passive_combatant(1_000_000.0);
    attacker.starting_statuses = vec![SimpleAppliedStatus {
        status_id: "Burn_Status".to_string(),
        stacks: 5.0,
        ..Default::default()
    }];
    let defender = passive_combatant(10_000_000_000.0);
    let mut cfg = ComposableAbilityConfig::default();
    cfg.attacker_compare_block_persistent_decay = true;

    let with_block = simulate_composable_matchup_with_trace(
        &attacker, &defender, None, None,
        SimpleAbilityTimingMode::ReallyFast,
        &cfg,
        30.0, true,
    );
    let baseline = simulate_composable_matchup_with_trace(
        &attacker, &defender, None, None,
        SimpleAbilityTimingMode::ReallyFast,
        &ComposableAbilityConfig::default(),
        30.0, true,
    );
    let count = |result: &crate::contracts::BestBuildsMatchupSummary| -> usize {
        result
            .combat_log
            .as_ref()
            .map(|log| {
                log.iter()
                    .filter(|e| {
                        e.entry_type == "dot"
                            && e.status_id.as_deref() == Some("Burn_Status")
                            && e.hp_side == "A"
                    })
                    .count()
            })
            .unwrap_or(0)
    };
    let with_block_count = count(&with_block);
    let baseline_count = count(&baseline);
    assert!(
        with_block_count > baseline_count,
        "NMF-disabled (block_persistent_decay=true) must keep Burn alive longer → more DoT events than NMF-enabled baseline: got with_block={with_block_count}, baseline={baseline_count}"
    );
}

#[test]
fn nmf_disabled_freezes_hypothermia_decay() {
    // [REF:compare_no_move_facetank]
    // Hypothermia carries the game's DoesNotHealWhileMoving flag, so it
    // belongs to the persistent set: an ability-applied (decaying) stack
    // must be held while moving (NMF disabled) instead of decaying. Its
    // 0.75% max-HP DoT is stack-independent, so a held stack keeps ticking
    // for the whole window while a decaying one lapses once stacks hit 0.
    let mut attacker = passive_combatant(1_000_000.0);
    attacker.starting_statuses = vec![SimpleAppliedStatus {
        status_id: "Hypothermia_Status".to_string(),
        stacks: 5.0,
        ..Default::default()
    }];
    let defender = passive_combatant(10_000_000_000.0);
    let mut cfg = ComposableAbilityConfig::default();
    cfg.attacker_compare_block_persistent_decay = true;

    let count = |result: &crate::contracts::BestBuildsMatchupSummary| -> usize {
        result
            .combat_log
            .as_ref()
            .map(|log| {
                log.iter()
                    .filter(|e| {
                        e.entry_type == "dot"
                            && e.status_id.as_deref() == Some("Hypothermia_Status")
                            && e.hp_side == "A"
                    })
                    .count()
            })
            .unwrap_or(0)
    };
    let held = count(&simulate_composable_matchup_with_trace(
        &attacker, &defender, None, None,
        SimpleAbilityTimingMode::ReallyFast, &cfg, 30.0, true,
    ));
    let decaying = count(&simulate_composable_matchup_with_trace(
        &attacker, &defender, None, None,
        SimpleAbilityTimingMode::ReallyFast, &ComposableAbilityConfig::default(), 30.0, true,
    ));
    assert!(
        held > decaying,
        "NMF-disabled must hold Hypothermia stacks → more DoT ticks than the decaying baseline: held={held}, decaying={decaying}"
    );
}

#[test]
fn first_tick_on_one_stack_burn_deals_more_damage_with_nmf_enabled() {
    // [REF:compare_no_move_facetank]
    // Bullets 6 + 7 + 8: "Each ailment tick processes natural decay first and
    // then deals damage using the post-decay stack count." + "A moving target
    // therefore keeps its stacks, while a stationary target loses one stack
    // right before damage is calculated." + "The very first tick on a 1-stack
    // Burn deals 5x more on a moving target than on a stationary one."
    //
    // "Moving" = NMF disabled = block_persistent_decay=true (no decay
    // before tick -> tick reads the full 1 stack).
    // "Stationary" = NMF enabled (default) = block=false (decay
    // happens before tick -> 1-stack Burn drops to 0 just before the
    // damage calc, so the first DoT is much smaller / zero).
    let mut attacker = passive_combatant(1_000_000.0);
    attacker.starting_statuses = vec![SimpleAppliedStatus {
        status_id: "Burn_Status".to_string(),
        stacks: 1.0,
        ..Default::default()
    }];
    let defender = passive_combatant(10_000_000_000.0);

    let mut cfg_block = ComposableAbilityConfig::default();
    cfg_block.attacker_compare_block_persistent_decay = true;
    let moving = simulate_composable_matchup_with_trace(
        &attacker, &defender, None, None,
        SimpleAbilityTimingMode::ReallyFast,
        &cfg_block,
        4.0, true,
    );
    let stationary = simulate_composable_matchup_with_trace(
        &attacker, &defender, None, None,
        SimpleAbilityTimingMode::ReallyFast,
        &ComposableAbilityConfig::default(),
        4.0, true,
    );
    let first_burn_damage = |result: &crate::contracts::BestBuildsMatchupSummary| -> f64 {
        result
            .combat_log
            .as_ref()
            .and_then(|log| {
                log.iter()
                    .find(|e| {
                        e.entry_type == "dot"
                            && e.status_id.as_deref() == Some("Burn_Status")
                            && e.hp_side == "A"
                    })
                    .map(|e| e.damage)
            })
            .unwrap_or(0.0)
    };
    let moving_dmg = first_burn_damage(&moving);
    let stationary_dmg = first_burn_damage(&stationary);
    assert!(
        moving_dmg > stationary_dmg,
        "first 1-stack Burn DoT must hit harder on a moving target (NMF off) than a stationary one (NMF on): moving={moving_dmg}, stationary={stationary_dmg}"
    );
}

#[test]
fn a_persistent_status_reports_its_decay_to_the_timeline() {
    // [REF:compare_no_move_facetank]
    // The DOT tick strips the stack itself and used to report only the
    // damage, so Poison wearing off left no trace while Paralyze - which
    // decays a phase later - announced every step. Reading the fight back
    // meant watching a stack count that only ever climbed.
    let mut attacker = passive_combatant(100_000.0);
    attacker.starting_statuses = vec![SimpleAppliedStatus {
        status_id: "Poison_Status".to_string(),
        stacks: 5.0,
        ..Default::default()
    }];
    let defender = passive_combatant(100_000.0);
    let result = simulate_composable_matchup_with_trace(
        &attacker,
        &defender,
        None,
        None,
        SimpleAbilityTimingMode::ReallyFast,
        &ComposableAbilityConfig::default(),
        status_decay_sec("Poison_Status") * 3.0,
        true,
    );
    let decays: Vec<&crate::contracts::CombatLogEntry> = result
        .combat_log
        .as_ref()
        .expect("trace requested")
        .iter()
        .filter(|e| {
            e.status_id.as_deref() == Some("Poison_Status")
                && e.description.as_deref().is_some_and(|d| d.contains("naturally decayed"))
        })
        .collect();
    assert!(
        !decays.is_empty(),
        "Poison sheds stacks on the DOT path, and the timeline has to say so",
    );
    assert_eq!(
        decays[0].detail.as_deref(),
        Some("5 -> 4 stacks"),
        "the entry carries the transition, which is what the live stack count reads",
    );
}
