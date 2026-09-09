//! Reference: ability_tangled_reckoning
//!
//! The toggle roots the user: its bite goes, a thorn lands on its own clock,
//! it heals every second, and it stops counting as moving.

use super::super::config::ComposableAbilityConfig;
use super::super::simulate_composable_matchup_with_trace;
use super::{applied_status, default_combatant};
use crate::contracts::{SimpleAbilityTimingMode, SimpleCombatantStats};
use crate::spec_constants::{
    TANGLED_RECKONING_COOLDOWN_SEC, TANGLED_RECKONING_HEAL_PCT_MAX_HP_PER_SEC,
    TANGLED_RECKONING_LOCK_SEC, TANGLED_RECKONING_THORN_INTERVAL_SEC,
};

fn rooted_config() -> ComposableAbilityConfig {
    let mut cfg = ComposableAbilityConfig::default();
    cfg.attacker_tangled_reckoning = true;
    cfg
}

/// A creature that bites slowly, so the thorn's own clock is visible against it.
fn slow_biter(max_hp: f64) -> SimpleCombatantStats {
    let mut c = default_combatant();
    c.health = max_hp;
    c.bite_cooldown = 3.0;
    c.health_regen = 0.0;
    c
}

#[test]
fn the_thorn_lands_on_its_own_clock_rather_than_the_bite_cooldown() {
    // [REF:ability_tangled_reckoning]
    let attacker = slow_biter(10_000.0);
    let mut defender = slow_biter(1_000_000.0);
    defender.damage = 0.0;
    let result = simulate_composable_matchup_with_trace(
        &attacker, &defender, None, None,
        SimpleAbilityTimingMode::Fast,
        &rooted_config(),
        20.0, true,
    );
    let log = result.combat_log.expect("trace");
    let hits: Vec<f64> = log
        .iter()
        .filter(|e| e.entry_type == "bite" && e.attacker == "A")
        .map(|e| e.time)
        .collect();
    assert!(hits.len() > 2, "the rooted side keeps attacking: {hits:?}");
    let gap = hits[2] - hits[1];
    assert!(
        (gap - TANGLED_RECKONING_THORN_INTERVAL_SEC).abs() < 1e-6,
        "the gap is the thorn's interval, not the 3s bite cooldown: {gap}",
    );
}

#[test]
fn nothing_lands_during_the_opening_lock() {
    // [REF:ability_tangled_reckoning]
    let attacker = slow_biter(10_000.0);
    let mut defender = slow_biter(1_000_000.0);
    defender.damage = 0.0;
    let result = simulate_composable_matchup_with_trace(
        &attacker, &defender, None, None,
        SimpleAbilityTimingMode::Fast,
        &rooted_config(),
        10.0, true,
    );
    let log = result.combat_log.expect("trace");
    let first = log
        .iter()
        .filter(|e| e.entry_type == "bite" && e.attacker == "A")
        .map(|e| e.time)
        .next()
        .expect("an attack lands");
    assert!(
        first >= TANGLED_RECKONING_LOCK_SEC - 1e-9,
        "the first attack waits out the lock: {first}",
    );
}

#[test]
fn the_user_heals_a_share_of_its_maximum_every_second() {
    // [REF:ability_tangled_reckoning]
    let mut attacker = slow_biter(10_000.0);
    attacker.damage = 0.0;
    let mut defender = slow_biter(1_000_000.0);
    defender.damage = 100.0;
    let result = simulate_composable_matchup_with_trace(
        &attacker, &defender, None, None,
        SimpleAbilityTimingMode::Fast,
        &rooted_config(),
        10.0, true,
    );
    let log = result.combat_log.expect("trace");
    let heals: Vec<f64> = log
        .iter()
        .filter(|e| e.description.as_deref() == Some("Tangled Reckoning heal"))
        .filter_map(|e| e.healing)
        .collect();
    assert!(heals.len() >= 8, "one heal a second: {}", heals.len());
    let expected = 10_000.0 * TANGLED_RECKONING_HEAL_PCT_MAX_HP_PER_SEC / 100.0;
    assert!((heals[0] - expected).abs() < 1e-9, "{} against {expected}", heals[0]);
}

#[test]
fn rooting_charges_the_cooldown_it_is_named_for() {
    // [REF:ability_tangled_reckoning]
    let attacker = slow_biter(10_000.0);
    let mut defender = slow_biter(1_000_000.0);
    defender.damage = 0.0;
    let result = simulate_composable_matchup_with_trace(
        &attacker, &defender, None, None,
        SimpleAbilityTimingMode::Fast,
        &rooted_config(),
        20.0, true,
    );
    let log = result.combat_log.expect("trace");
    let activated = log
        .iter()
        .find(|e| e.description.as_deref() == Some("Tangled Reckoning activated"))
        .expect("the root goes on");
    // The fight leaves the root on and so never reads the cooldown back, but
    // the ability is charged for it at the moment it roots.
    assert!(
        TANGLED_RECKONING_COOLDOWN_SEC > activated.time,
        "the cooldown outlasts the activation it starts at",
    );
    let activations = log
        .iter()
        .filter(|e| e.description.as_deref() == Some("Tangled Reckoning activated"))
        .count();
    assert_eq!(activations, 1, "one activation, not one per second");
}

#[test]
fn the_rooted_side_counts_as_standing_still_whatever_the_setting_says() {
    // [REF:ability_tangled_reckoning]
    // Both sides are handed the setting that stops persistent ailments from
    // decaying, and both start with the same Poison. The rooted side is not
    // moving, so its stacks come off anyway; the other side keeps them.
    let mut attacker = slow_biter(1_000_000.0);
    attacker.damage = 0.0;
    attacker.starting_statuses = vec![applied_status("Poison_Status", 8.0)];
    let mut defender = slow_biter(1_000_000.0);
    defender.damage = 0.0;
    defender.starting_statuses = vec![applied_status("Poison_Status", 8.0)];
    let mut cfg = rooted_config();
    cfg.attacker_compare_block_persistent_decay = true;
    cfg.defender_compare_block_persistent_decay = true;
    let result = simulate_composable_matchup_with_trace(
        &attacker, &defender, None, None,
        SimpleAbilityTimingMode::Fast,
        &cfg,
        30.0, true,
    );
    let log = result.combat_log.expect("trace");
    let poison_total = |side: &str| -> f64 {
        log.iter()
            .filter(|e| e.status_id.as_deref() == Some("Poison_Status") && e.hp_side == side)
            .map(|e| e.damage)
            .sum()
    };
    let rooted = poison_total("A");
    let other = poison_total("B");
    assert!(rooted > 0.0 && other > 0.0, "both sides tick: {rooted} / {other}");
    assert!(
        rooted < other,
        "the rooted side loses stacks and so takes less: {rooted} against {other}",
    );
}
