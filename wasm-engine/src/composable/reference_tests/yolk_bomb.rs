//! Reference: ability_yolk_bomb
//!
//! Covers each testable bullet in the "Yolk Bomb" entry. Each test
//! body starts with the [REF:ability_yolk_bomb] marker so the vitest
//! coverage gate (src/pages/referenceCoverage.test.ts) sees it.
//!
//! Engine path: `composable/mod.rs:2539-2585` (Phase 4y) - per-side
//! activation gated by `next_yolk_bomb <= time` and
//! `time >= yolk_bomb_cooldown_until`. Effect dispatch lives in
//! `composable/abilities.rs:144-202` (`apply_yolk_bomb`) backed by
//! `resolve_yolk_bomb_routing`. Constants:
//! `YOLK_BOMB_SLOW_STACKS = 2.0`, `YOLK_BOMB_VALUE_STACKS = 4.0`,
//! `YOLK_BOMB_FORTIFY_DURATION_SEC = 12.0`. Cooldown: 30 s.
//!
//! Status apply inside `apply_yolk_bomb` goes through the non-tracing
//! `apply_incoming_statuses_to_target_with_fortify_immunity` helper,
//! so the apply itself does not push to combat_log. Stack-count
//! claims are verified by inspecting BTreeMap state after a direct
//! call; cooldown is verified via the simulation trace.

use super::super::apply_yolk_bomb;
use super::super::config::ComposableAbilityConfig;
use super::super::simulate_composable_matchup_with_trace;
use super::default_combatant;
use crate::contracts::{SimpleAbilityTimingMode, SimpleCombatantStats, SimpleStatusInstance};
use std::collections::BTreeMap;

fn passive_combatant(max_hp: f64) -> SimpleCombatantStats {
    let mut c = default_combatant();
    c.health = max_hp;
    c.damage = 0.0;
    c.bite_cooldown = 1000.0;
    c
}

fn yolk_bomb_attacker_cfg(value: &str) -> ComposableAbilityConfig {
    let mut cfg = ComposableAbilityConfig::default();
    cfg.attacker_yolk_bomb = true;
    cfg.attacker_yolk_bomb_value = Some(value.to_string());
    cfg
}

#[test]
fn harmful_value_applies_two_slow_plus_four_value_stacks_to_opponent() {
    // [REF:ability_yolk_bomb]
    // Bullet 1 + 2 (harmful branch): "Yolk Bomb applies 2 stacks of
    // Slowed plus 4 stacks of the status chosen by its value." +
    // "harmful values route it to the opponent."
    // Use "Burn" (harmful) - engine routes Slowed × 2 + Burn × 4 to
    // defender.
    let attacker = passive_combatant(1_000.0);
    let defender = passive_combatant(10_000.0);
    let mut atk_st: BTreeMap<String, SimpleStatusInstance> = BTreeMap::new();
    let mut def_st: BTreeMap<String, SimpleStatusInstance> = BTreeMap::new();
    let mut atk_fortify_immune = 0.0;
    let mut atk_fortify_weight = 0.0;
    apply_yolk_bomb(
        0.0, Some("Burn"),
        &attacker, &defender,
        attacker.health, defender.health,
        &mut atk_st, &mut def_st,
        0.0, 0.0,
        &mut atk_fortify_immune, &mut atk_fortify_weight,
    );
    let slow = def_st.get("Slow_Status").map(|s| s.stacks).unwrap_or(0.0);
    let burn = def_st.get("Burn_Status").map(|s| s.stacks).unwrap_or(0.0);
    assert!(
        (slow - 2.0).abs() < 1e-9,
        "Yolk Bomb (Burn) must apply 2 stacks of Slow_Status to defender: got {slow}"
    );
    assert!(
        (burn - 4.0).abs() < 1e-9,
        "Yolk Bomb (Burn) must apply 4 stacks of Burn_Status to defender: got {burn}"
    );
    // Attacker side untouched.
    assert!(
        !atk_st.contains_key("Slow_Status"),
        "harmful Yolk Bomb must NOT apply Slow_Status to user"
    );
    assert!(
        !atk_st.contains_key("Burn_Status"),
        "harmful Yolk Bomb must NOT apply value-status to user"
    );
}

#[test]
fn beneficial_value_routes_full_effect_to_user() {
    // [REF:ability_yolk_bomb]
    // Bullet 2 (beneficial branch): "Beneficial values route the full
    // effect to the user."
    // Use "Healing Pulse" - engine routes Slowed × 2 + Healing_Pulse_Status × 4
    // to attacker.
    let attacker = passive_combatant(1_000.0);
    let defender = passive_combatant(10_000.0);
    let mut atk_st: BTreeMap<String, SimpleStatusInstance> = BTreeMap::new();
    let mut def_st: BTreeMap<String, SimpleStatusInstance> = BTreeMap::new();
    let mut atk_fortify_immune = 0.0;
    let mut atk_fortify_weight = 0.0;
    apply_yolk_bomb(
        0.0, Some("Healing Pulse"),
        &attacker, &defender,
        attacker.health, defender.health,
        &mut atk_st, &mut def_st,
        0.0, 0.0,
        &mut atk_fortify_immune, &mut atk_fortify_weight,
    );
    let slow = atk_st.get("Slow_Status").map(|s| s.stacks).unwrap_or(0.0);
    let heal = atk_st
        .get("Healing_Pulse_Status")
        .map(|s| s.stacks)
        .unwrap_or(0.0);
    assert!(
        (slow - 2.0).abs() < 1e-9,
        "Yolk Bomb (Healing Pulse) must apply 2 stacks of Slow_Status to user: got {slow}"
    );
    assert!(
        (heal - 4.0).abs() < 1e-9,
        "Yolk Bomb (Healing Pulse) must apply 4 stacks of Healing_Pulse_Status to user: got {heal}"
    );
    // Defender untouched.
    assert!(
        def_st.is_empty(),
        "beneficial Yolk Bomb must NOT touch defender's statuses"
    );
}

#[test]
fn fortify_value_grants_immunity_window_instead_of_status() {
    // [REF:ability_yolk_bomb]
    // Bullet 3: "When the value is Fortify, Yolk Bomb grants the
    // standard Fortify immunity window for its duration instead of
    // applying a status."
    // Engine: SelfFortify branch sets `fortify_immune_until = time + 12.0`
    // and weight bonus, then applies Slow_Status × 2 to user only -
    // no Fortify status is added to attacker's statuses.
    let attacker = passive_combatant(1_000.0);
    let defender = passive_combatant(10_000.0);
    let mut atk_st: BTreeMap<String, SimpleStatusInstance> = BTreeMap::new();
    let mut def_st: BTreeMap<String, SimpleStatusInstance> = BTreeMap::new();
    let mut atk_fortify_immune = 0.0;
    let mut atk_fortify_weight = 0.0;
    apply_yolk_bomb(
        0.0, Some("Fortify"),
        &attacker, &defender,
        attacker.health, defender.health,
        &mut atk_st, &mut def_st,
        0.0, 0.0,
        &mut atk_fortify_immune, &mut atk_fortify_weight,
    );
    // Immunity window granted: 0 + 12 = 12.
    assert!(
        (atk_fortify_immune - 12.0).abs() < 1e-9,
        "Yolk Bomb (Fortify) must set fortify_immune_until to time + 12: got {atk_fortify_immune}"
    );
    assert!(
        (atk_fortify_weight - 12.0).abs() < 1e-9,
        "Yolk Bomb (Fortify) must set fortify_weight_bonus_until to time + 12: got {atk_fortify_weight}"
    );
    // No Fortify-named status applied.
    let fortify_status = atk_st
        .keys()
        .find(|k| k.contains("Fortify"))
        .cloned();
    assert!(
        fortify_status.is_none(),
        "Yolk Bomb (Fortify) must NOT apply a Fortify status - got {fortify_status:?}"
    );
    // Slowed × 2 still applied to user.
    let slow = atk_st.get("Slow_Status").map(|s| s.stacks).unwrap_or(0.0);
    assert!(
        (slow - 2.0).abs() < 1e-9,
        "Yolk Bomb (Fortify) must still apply 2 stacks of Slow_Status to user: got {slow}"
    );
}

#[test]
fn cooldown_thirty_seconds() {
    // [REF:ability_yolk_bomb]
    // Bullet 4: "It has a 30 second cooldown."
    let attacker = passive_combatant(1_000_000.0);
    let mut defender = default_combatant();
    defender.health = 10_000_000.0;
    defender.damage = 1.0; // tiny pressure to keep loop alive
    defender.bite_cooldown = 5.0;

    let result = simulate_composable_matchup_with_trace(
        &attacker, &defender, None, None,
        SimpleAbilityTimingMode::ReallyFast,
        &yolk_bomb_attacker_cfg("Burn"),
        40.0, true,
    );
    let log = result.combat_log.expect("trace");
    let activations: Vec<f64> = log
        .iter()
        .filter(|e| e.description.as_deref() == Some("Yolk Bomb activated"))
        .map(|e| e.time)
        .collect();
    assert!(
        activations.len() >= 2,
        "Yolk Bomb must fire at least twice in a 40 s window: {activations:?}"
    );
    let gap = activations[1] - activations[0];
    assert!(
        (gap - 30.0).abs() < 1.0,
        "second Yolk Bomb activation must land ~30 s after the first: gap={gap}, times={activations:?}"
    );
}
