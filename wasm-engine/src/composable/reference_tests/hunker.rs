//! Reference: ability_hunker
//!
//! Covers each testable bullet in the "Hunker" entry. Each test body
//! starts with the [REF:ability_hunker] marker so the vitest coverage
//! gate (src/pages/referenceCoverage.test.ts) sees it.
//!
//! Engine path: helpers in `actives.rs` (`apply_hunker_to_damage`,
//! `apply_hunker_to_incoming`, `resolve_hunker_effect_starts_at`,
//! `is_hunker_effect_active`). Live engine read sites: melee phases 10/11
//! in `composable/mod.rs:4767-4810, 5117-5157` and the breath damage
//! path in `composable/breath.rs:115`.

use super::super::config::ComposableAbilityConfig;
use super::super::simulate_composable_matchup;
use super::{default_breath, default_combatant};
use crate::actives::{
    apply_hunker_to_damage, apply_hunker_to_incoming, is_hunker_effect_active,
    resolve_hunker_effect_starts_at, HUNKER_EFFECT_DELAY_SEC,
};
use crate::contracts::{SimpleAbilityTimingMode, SimpleCombatantStats};

fn passive_combatant(max_hp: f64) -> SimpleCombatantStats {
    let mut c = default_combatant();
    c.health = max_hp;
    c.damage = 0.0;
    c.bite_cooldown = 1000.0;
    c
}

fn hunker_attacker(max_hp: f64, hunker_pct: f64, bite_damage: f64) -> SimpleCombatantStats {
    let mut c = default_combatant();
    c.health = max_hp;
    c.damage = bite_damage;
    c.bite_cooldown = 1.0;
    c.hunker_reduction_pct = hunker_pct;
    c
}

#[test]
fn outgoing_melee_damage_halved_when_on() {
    // [REF:ability_hunker]
    // Bullet 1: "While Hunker is on, the user's melee damage multiplier
    // is reduced to 0.5x."
    // `apply_hunker_to_damage(damage, true) == damage * 0.5`.
    let raw = 200.0_f64;
    let off = apply_hunker_to_damage(raw, false);
    let on = apply_hunker_to_damage(raw, true);
    assert!(
        (off - raw).abs() < 1e-9,
        "Hunker off must not change outgoing melee damage: expected {raw}, got {off}"
    );
    assert!(
        (on - raw * 0.5).abs() < 1e-9,
        "Hunker on must halve outgoing melee damage: expected {}, got {on}",
        raw * 0.5
    );
}

#[test]
fn incoming_damage_reduced_by_hunker_value_percent() {
    // [REF:ability_hunker]
    // Bullet 2: "While Hunker is on, incoming direct damage is reduced
    // by the creature's Hunker value."
    // `apply_hunker_to_incoming(damage, pct, true) == damage * (1 - pct/100)`.
    let raw = 100.0_f64;
    let off = apply_hunker_to_incoming(raw, 25.0, false);
    let on = apply_hunker_to_incoming(raw, 25.0, true);
    assert!(
        (off - raw).abs() < 1e-9,
        "Hunker off must not change incoming damage: expected {raw}, got {off}"
    );
    assert!(
        (on - raw * 0.75).abs() < 1e-9,
        "Hunker 25 on must reduce incoming damage by 25%: expected {}, got {on}",
        raw * 0.75
    );
}

#[test]
fn example_hunker_forty_reduces_incoming_by_forty_percent() {
    // [REF:ability_hunker]
    // Bullet 3: "For example, Hunker 40 reduces incoming direct damage
    // by 40%."
    let raw = 250.0_f64;
    let on = apply_hunker_to_incoming(raw, 40.0, true);
    assert!(
        (on - raw * 0.6).abs() < 1e-9,
        "Hunker 40 on must yield 60% of incoming damage: expected {}, got {on}",
        raw * 0.6
    );
}

#[test]
fn incoming_reduction_applies_to_both_bite_and_breath() {
    // [REF:ability_hunker]
    // Bullet 4: "This incoming reduction applies to direct bite damage
    // and direct breath damage."
    // Two simulations isolating each damage path:
    // (a) Bite-only attacker → defender's outgoing bite to A is reduced.
    // (b) Breath-only attacker → defender's outgoing breath to A is reduced.
    // In both cases A holds Hunker; final HP under Hunker must exceed
    // the no-Hunker baseline (less damage taken).
    let mut a = hunker_attacker(10_000.0, 30.0, 0.0);
    a.bite_cooldown = 1000.0;

    // (a) Bite path
    let mut bite_b = passive_combatant(10_000_000.0);
    bite_b.damage = 100.0;
    bite_b.bite_cooldown = 1.0;

    let baseline_cfg = ComposableAbilityConfig::default();
    let baseline_bite = simulate_composable_matchup(
        &a, &bite_b, None, None,
        SimpleAbilityTimingMode::ReallyFast,
        &baseline_cfg, 5.0,
    );
    let mut hunker_cfg = ComposableAbilityConfig::default();
    hunker_cfg.attacker_hunker = true;
    let hunker_bite = simulate_composable_matchup(
        &a, &bite_b, None, None,
        SimpleAbilityTimingMode::ReallyFast,
        &hunker_cfg, 5.0,
    );
    assert!(
        hunker_bite.final_hp_a > baseline_bite.final_hp_a,
        "Hunker must reduce incoming BITE damage: hunker hp_a={}, baseline hp_a={}",
        hunker_bite.final_hp_a, baseline_bite.final_hp_a,
    );

    // (b) Breath path
    let mut breath_b = passive_combatant(10_000_000.0);
    breath_b.weight = 100.0;
    let mut breath = default_breath();
    breath.dps_pct = 1.0;
    breath.capacity = 5.0;
    breath.regen_rate = 1.0;
    breath.crit_chance_pct = 0.0;

    let baseline_breath = simulate_composable_matchup(
        &a, &breath_b, None, Some(&breath),
        SimpleAbilityTimingMode::ReallyFast,
        &baseline_cfg, 5.0,
    );
    let hunker_breath = simulate_composable_matchup(
        &a, &breath_b, None, Some(&breath),
        SimpleAbilityTimingMode::ReallyFast,
        &hunker_cfg, 5.0,
    );
    assert!(
        hunker_breath.final_hp_a > baseline_breath.final_hp_a,
        "Hunker must reduce incoming BREATH damage: hunker hp_a={}, baseline hp_a={}",
        hunker_breath.final_hp_a, baseline_breath.final_hp_a,
    );
}

#[test]
fn stays_on_without_active_window_or_cooldown() {
    // [REF:ability_hunker]
    // Bullet 5: "Hunker does not use a timed active window or a cooldown.
    // It stays on until the policy turns it off or actives are disabled."
    // `is_hunker_effect_active(true, 0.0, t)` is true at t=0, t=100, and
    // t=10_000 with no cooldown gating. The flag has no expiry timer.
    assert!(
        is_hunker_effect_active(true, 0.0, 0.0),
        "Hunker effect must be active at t=0 immediately after first toggle"
    );
    assert!(
        is_hunker_effect_active(true, 0.0, 100.0),
        "Hunker effect must remain active at t=100 with no cooldown gating"
    );
    assert!(
        is_hunker_effect_active(true, 0.0, 10_000.0),
        "Hunker effect must remain active at t=10_000 — no timed window"
    );
    assert!(
        !is_hunker_effect_active(false, 0.0, 0.0),
        "Hunker off must not register as active even at t=0"
    );
}

#[test]
fn re_toggle_takes_five_seconds_to_take_hold() {
    // [REF:ability_hunker]
    // Bullet 6: "If Hunker is turned off and then back on, the new
    // Hunker effect takes 5 seconds to take hold; the very first
    // activation in a fight has no delay."
    // `resolve_hunker_effect_starts_at` returns `current_time` for the
    // first activation (`prior_activation_count == 0`) and
    // `current_time + HUNKER_EFFECT_DELAY_SEC` for any later flip
    // (`prior_activation_count > 0`).
    let now = 12.0_f64;
    let first = resolve_hunker_effect_starts_at(
        false, // previous_hunker_on
        true,  // next_hunker_on
        now,   // current_time
        f64::INFINITY, // current_effect_starts_at (unused on first toggle)
        0,     // prior_activation_count
    );
    assert!(
        (first - now).abs() < 1e-9,
        "first activation must take effect immediately at current time: expected {now}, got {first}"
    );
    let second = resolve_hunker_effect_starts_at(
        false,
        true,
        now,
        f64::INFINITY,
        1, // prior toggles ≥ 1 → 5 s delay
    );
    let expected = now + HUNKER_EFFECT_DELAY_SEC;
    assert!(
        (second - expected).abs() < 1e-9,
        "re-toggle must take 5 s to take hold: expected {expected}, got {second}"
    );
    // Sanity: the 5 s constant matches the bullet's text exactly.
    assert!(
        (HUNKER_EFFECT_DELAY_SEC - 5.0).abs() < 1e-9,
        "HUNKER_EFFECT_DELAY_SEC must equal 5.0 to match the Reference bullet, got {HUNKER_EFFECT_DELAY_SEC}"
    );
}
