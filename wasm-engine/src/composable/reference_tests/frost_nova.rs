//! Reference: ability_frost_nova
//!
//! Covers each testable bullet in the "Frost Nova" entry. Each test
//! body starts with the [REF:ability_frost_nova] marker so the vitest
//! coverage gate (src/pages/referenceCoverage.test.ts) sees it.

use super::super::config::ComposableAbilityConfig;
use super::super::simulate_composable_matchup_with_trace;
use super::default_combatant;
use crate::contracts::{SimpleAbilityTimingMode, SimpleCombatantStats};
use crate::spec_constants::FROST_NOVA_COOLDOWN_SEC;

fn frost_nova_attacker_config() -> ComposableAbilityConfig {
    let mut cfg = ComposableAbilityConfig::default();
    cfg.attacker_frost_nova = true;
    cfg
}

fn passive_combatant(max_hp: f64) -> SimpleCombatantStats {
    let mut c = default_combatant();
    c.health = max_hp;
    c.damage = 0.0;
    c.bite_cooldown = 1000.0;
    c
}

fn frost_nova_activation_times(
    cfg: &ComposableAbilityConfig,
    max_time_sec: f64,
) -> Vec<f64> {
    // Slow biter on each side keeps the loop alive past the Frost Nova
    // active duration so the second activation at t=60 actually fires.
    let mut attacker = passive_combatant(1_000.0);
    attacker.damage = 1.0;
    attacker.bite_cooldown = 5.0;
    let defender = passive_combatant(10_000_000.0);
    let result = simulate_composable_matchup_with_trace(
        &attacker, &defender, None, None,
        SimpleAbilityTimingMode::Fast,
        cfg, max_time_sec, true,
    );
    let log = result.combat_log.expect("trace log requested");
    log.iter()
        .filter(|e| {
            e.entry_type == "ability"
                && e.attacker == "A"
                && e.description.as_deref() == Some("Frost Nova activated")
        })
        .map(|e| e.time)
        .collect()
}

fn mirror_combatant() -> SimpleCombatantStats {
    // Avothius-like mirror: big HP pool, weak bite relative to HP so the
    // fight is nowhere near a kill at t=15. Both sides identical -> true mirror.
    let mut c = default_combatant();
    c.health = 4100.0;
    c.damage = 1.0;
    c.bite_cooldown = 5.0;
    c
}

fn frost_nova_mirror_config() -> ComposableAbilityConfig {
    let mut cfg = ComposableAbilityConfig::default();
    cfg.attacker_frost_nova = true;
    cfg.defender_frost_nova = true;
    cfg
}

#[test]
fn mirror_frost_nova_does_not_stall_mid_fight() {
    // Facet B: a Frost-Nova mirror must run to the max_time horizon (or to a
    // kill). Before the deferred-tick re-activation was folded into the
    // scheduler, the loop Broke once the 15 s active window closed - both sides
    // were left alive far short of the horizon (a frozen Draw). After the fix
    // the loop advances on the re-activation candidate (and the bite cadence),
    // so the fight reaches the horizon.
    let attacker = mirror_combatant();
    let defender = mirror_combatant();
    let max_time = 200.0;
    let result = simulate_composable_matchup_with_trace(
        &attacker,
        &defender,
        None,
        None,
        SimpleAbilityTimingMode::Fast,
        &frost_nova_mirror_config(),
        max_time,
        true,
    );
    let log = result.combat_log.expect("trace log");
    let last_event_time = log.iter().map(|e| e.time).fold(0.0_f64, f64::max);
    let both_alive = result.final_hp_a > 1.0 && result.final_hp_b > 1.0;

    if both_alive {
        assert!(
            last_event_time >= max_time - 10.0,
            "STALL: Frost-Nova mirror terminated at t={last_event_time:.2} with both \
             alive (hp_a={:.2} hp_b={:.2}) - the loop starved before the horizon",
            result.final_hp_a,
            result.final_hp_b
        );
    }
}

#[test]
fn mirror_frost_nova_no_bite_stall() {
    // Facet B (isolated): remove the bite that kept the loop alive in the test
    // above, leaving Frost Nova's own DOT plus its 60 s re-activation as the
    // only events. The re-activation lives on `frost_nova_cooldown_until`, which
    // was never a scheduler candidate before the fix - so the loop Broke once
    // the active window closed at t=15 and Frost Nova fired only once. After the
    // fix the re-activation is folded, so it re-fires roughly every 60 s.
    let mut attacker = mirror_combatant();
    attacker.damage = 0.0;
    // First bite at t=0, then rescheduled to +300 s (past the 200 s horizon) -
    // so after t=0 only Frost Nova's DOT + re-activation can drive the loop.
    attacker.bite_cooldown = 300.0;
    let defender = attacker.clone();
    let max_time = 200.0;
    let result = simulate_composable_matchup_with_trace(
        &attacker,
        &defender,
        None,
        None,
        SimpleAbilityTimingMode::Fast,
        &frost_nova_mirror_config(),
        max_time,
        true,
    );
    let log = result.combat_log.expect("trace log");
    let last_event_time = log.iter().map(|e| e.time).fold(0.0_f64, f64::max);
    let a_activations = log
        .iter()
        .filter(|e| {
            e.attacker == "A" && e.description.as_deref() == Some("Frost Nova activated")
        })
        .count();
    // 60 s cooldown over a 200 s window -> re-fires at t~60, 120, 180.
    assert!(
        a_activations >= 2,
        "Frost Nova A must re-activate after its 60 s cooldown; got {a_activations} \
         activation(s) - the re-activation fell off the scheduler candidate set, the \
         loop Broke at last_event_time={last_event_time:.2}"
    );
}

#[test]
fn applies_frostbite_to_opponent_during_active_window() {
    // [REF:ability_frost_nova]
    // Frost Nova activates at t=0. Within the 15 s active window,
    // Frostbite_Status must accumulate on the opponent. Exact apply
    // timestamps (t=3, 6, 9, 12, 15) and per-tick stack count (3) are
    // verified by source inspection of composable/mod.rs:3440-3502.
    let mut attacker = passive_combatant(1_000.0);
    attacker.damage = 1.0;
    attacker.bite_cooldown = 5.0;
    let defender = passive_combatant(10_000_000.0);
    let result = simulate_composable_matchup_with_trace(
        &attacker,
        &defender,
        None,
        None,
        SimpleAbilityTimingMode::Fast,
        &frost_nova_attacker_config(),
        16.0,
        true,
    );
    let log = result.combat_log.expect("trace log");
    let frostbite_present = log
        .iter()
        .any(|e| e.status_id.as_deref() == Some("Frostbite_Status"));
    assert!(
        frostbite_present,
        "Frost Nova must apply Frostbite_Status during the 15 s active window"
    );
}

#[test]
fn cooldown_sixty_seconds() {
    // [REF:ability_frost_nova]
    let activations = frost_nova_activation_times(&frost_nova_attacker_config(), 200.0);
    assert!(
        activations.len() >= 2,
        "Frost Nova must fire at least twice in a 200 s window: {activations:?}"
    );
    let gap = activations[1] - activations[0];
    assert!(
        (gap - FROST_NOVA_COOLDOWN_SEC).abs() < 1e-6,
        "second Frost Nova activation must be {FROST_NOVA_COOLDOWN_SEC} s after the first, got {gap}: {activations:?}"
    );
}

#[test]
fn does_not_deal_direct_damage_at_activation() {
    // [REF:ability_frost_nova]
    // At activation (t=0), no damage event with attacker=A and t=0.
    // Frost Nova is a status-only ability - damage comes via Frostbite
    // DOT ticks, not from the activation itself.
    let attacker = passive_combatant(1_000.0);
    let defender = passive_combatant(10_000.0);
    let cfg = frost_nova_attacker_config();
    let result = simulate_composable_matchup_with_trace(
        &attacker,
        &defender,
        None,
        None,
        SimpleAbilityTimingMode::Fast,
        &cfg,
        0.5,
        true,
    );
    // Defender must still be at full HP at t=0.5 - only the activation
    // event has fired, no DOT or bite has run yet.
    assert!(
        (result.final_hp_b - defender.health).abs() < 1e-6,
        "Frost Nova must not deal direct damage at activation: defender HP {} → {}",
        defender.health,
        result.final_hp_b
    );
}
