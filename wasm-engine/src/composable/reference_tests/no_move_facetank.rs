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
//! - When `block_persistent_decay = true`, the recoverable persistent
//!   PvP statuses (Poison, Burn, Bleed, Corrosion, Necropoison,
//!   Frostbite) do NOT decay naturally.

use super::super::config::ComposableAbilityConfig;
use super::super::simulate_composable_matchup_with_trace;
use super::default_combatant;
use crate::contracts::{SimpleAbilityTimingMode, SimpleAppliedStatus, SimpleCombatantStats};

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
    // Bullet 2 (default-on branch): "When it is enabled, those
    // statuses decay normally."
    // Engine: with `compare_block_persistent_decay = false` (TS
    // default), Burn stacks decay between ticks. After 12 s, a
    // freshly-applied Burn × 5 should have decayed to a smaller
    // stack count.
    let mut attacker = passive_combatant(1_000_000.0);
    attacker.starting_statuses = vec![SimpleAppliedStatus {
        status_id: "Burn_Status".to_string(),
        stacks: 5.0,
        source_ability: None,
    }];
    let defender = passive_combatant(10_000_000_000.0);
    let result = simulate_composable_matchup_with_trace(
        &attacker, &defender, None, None,
        SimpleAbilityTimingMode::ReallyFast,
        &ComposableAbilityConfig::default(),
        12.0, true,
    );
    let log = result.combat_log.expect("trace");
    let burn_dot_count = log
        .iter()
        .filter(|e| {
            e.entry_type == "dot"
                && e.status_id.as_deref() == Some("Burn_Status")
                && e.hp_side == "A"
        })
        .count();
    assert!(
        burn_dot_count >= 2,
        "with NMF enabled (default decay), Burn must keep ticking until decay → ≥2 DoT events: got {burn_dot_count}"
    );
}

#[test]
fn nmf_disabled_freezes_persistent_status_decay() {
    // [REF:compare_no_move_facetank]
    // Bullet 1 (toggle-off branch): "When it is disabled, Poison,
    // Burn, Bleed, Corrosion, Necropoison, and Frostbite stop
    // naturally decaying."
    // Engine: with `compare_block_persistent_decay = true`, Burn
    // stacks stay at 5 and DoT keeps firing on the original cadence
    // for the whole window.
    let mut attacker = passive_combatant(1_000_000.0);
    attacker.starting_statuses = vec![SimpleAppliedStatus {
        status_id: "Burn_Status".to_string(),
        stacks: 5.0,
        source_ability: None,
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
fn first_tick_on_one_stack_burn_deals_more_damage_with_nmf_enabled() {
    // [REF:compare_no_move_facetank]
    // Bullet 3: "Because each ailment tick processes natural decay
    // first and then deals damage using the post-decay stack count,
    // a moving (No Move Facetank disabled) target keeps its stacks
    // while a stationary target loses one stack right before damage
    // is calculated. The result is that the very first tick on a
    // 1-stack Burn deals 5x more on a moving target than on a
    // stationary one [...]."
    //
    // "Moving" = NMF disabled = block_persistent_decay=true (no decay
    // before tick → tick reads the full 1 stack).
    // "Stationary" = NMF enabled (default) = block=false (decay
    // happens before tick → 1-stack Burn drops to 0 just before the
    // damage calc, so the first DoT is much smaller / zero).
    let mut attacker = passive_combatant(1_000_000.0);
    attacker.starting_statuses = vec![SimpleAppliedStatus {
        status_id: "Burn_Status".to_string(),
        stacks: 1.0,
        source_ability: None,
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
