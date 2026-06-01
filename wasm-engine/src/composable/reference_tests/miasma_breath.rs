//! Reference: ability_miasma_breath
//!
//! Covers each testable bullet in the "Miasma Breath" entry. Each test
//! body starts with the [REF:ability_miasma_breath] marker so the
//! vitest coverage gate (src/pages/referenceCoverage.test.ts) sees it.
//!
//! Source of truth for breath stats: data/breath_specs.runtime.json:194-206
//! (id="Miasma_Breath", capacity 10 sec, regen 2.5, crit 25%, dps 0.5,
//! perHit "0.25% PER HIT", self-heal 0.5%/tick).
//!
//! Engine path: `composable/breath.rs:407-412` — when
//! `breath.special_kind == Some("miasma")`, the engine fires standard
//! breath damage (`fire_breath_damage`) AND additionally heals the
//! actor for `self_heal_pct % maxHP`. The heal trace event is
//! "Miasma Breath heal" (composable/mod.rs:367).

use super::super::config::ComposableAbilityConfig;
use super::super::simulate_composable_matchup_with_trace;
use super::{default_breath, default_combatant};
use crate::combat::compute_simple_breath_damage_with_actor_and_target_statuses;
use crate::contracts::{SimpleAbilityTimingMode, SimpleBreathProfile, SimpleCombatantStats};
use std::collections::BTreeMap;

fn miasma_breath_profile() -> SimpleBreathProfile {
    let mut breath = default_breath();
    // Per Reference text "* 0.25 * 1.25": 0.25 is per-tick fraction
    // (dps 0.5 / 2 ticks/sec = 0.25%) and 1.25 is the 25% pseudo-crit.
    breath.dps_pct = 0.5;
    breath.capacity = 10.0;
    breath.regen_rate = 2.5;
    breath.crit_chance_pct = 25.0;
    breath.special_kind = Some("miasma".to_string());
    breath.self_heal_pct = 0.5; // 0.5% maxHP heal per tick
    breath
}

fn passive_combatant(max_hp: f64) -> SimpleCombatantStats {
    let mut c = default_combatant();
    c.health = max_hp;
    c.damage = 0.0;
    c.bite_cooldown = 1000.0;
    c
}

#[test]
fn ticks_two_times_per_second_while_firing() {
    // [REF:ability_miasma_breath]
    // Bullet 1: "Miasma Breath deals damage 2 times per second while it
    // is firing." Capacity 10 (seconds) emits 20 ticks at t=0.5..10.0.
    let attacker = passive_combatant(1_000.0);
    let defender = passive_combatant(10_000_000.0);
    let breath = miasma_breath_profile();
    let result = simulate_composable_matchup_with_trace(
        &attacker, &defender,
        Some(&breath), None,
        SimpleAbilityTimingMode::Fast,
        &ComposableAbilityConfig::default(),
        10.5, true,
    );
    let log = result.combat_log.expect("trace log");
    let breath_ticks: Vec<f64> = log
        .iter()
        .filter(|e| e.entry_type == "breath" && e.attacker == "A")
        .map(|e| e.time)
        .collect();
    assert_eq!(
        breath_ticks.len(),
        20,
        "expected 20 breath ticks (10 s capacity × 2/s) before exhaustion: {breath_ticks:?}"
    );
}

#[test]
fn capacity_is_ten_seconds_of_firing() {
    // [REF:ability_miasma_breath]
    // Bullet 2: "Miasma Breath has capacity 10."
    // 10 s × 2 ticks/s = 20 ticks before the burst exhausts.
    let attacker = passive_combatant(1_000.0);
    let defender = passive_combatant(10_000_000.0);
    let breath = miasma_breath_profile();
    let result = simulate_composable_matchup_with_trace(
        &attacker, &defender,
        Some(&breath), None,
        SimpleAbilityTimingMode::Fast,
        &ComposableAbilityConfig::default(),
        12.0, true,
    );
    let log = result.combat_log.expect("trace log");
    let burst_ticks: Vec<f64> = log
        .iter()
        .filter(|e| e.entry_type == "breath" && e.attacker == "A" && e.time <= 11.0 + 1e-9)
        .map(|e| e.time)
        .collect();
    assert_eq!(
        burst_ticks.len(),
        20,
        "first Miasma Breath burst must exhaust after 10 s of firing (20 ticks): {burst_ticks:?}"
    );
}

#[test]
fn damage_formula_matches_spec() {
    // [REF:ability_miasma_breath]
    // Bullets 3+4: "Breath damage per tick is calculated as
    // (((target max HP * ((attacker effective weight / defender effective
    // weight) + 1)) / 2) / 100) * 0.25 * 1.25 * (1 - breath resistance)."
    // 0.25 = dps 0.5 / 2 ticks; 1.25 = 25% pseudo-crit. Encoded as
    // dps_pct=0.5, crit_chance_pct=25.
    let mut attacker = default_combatant();
    attacker.weight = 200.0;
    let mut defender = default_combatant();
    defender.health = 4_000.0;
    defender.weight = 100.0;
    defender.breath_resistance = 0.20;
    let breath = miasma_breath_profile();

    let mut chain = 0.0;
    let actual = compute_simple_breath_damage_with_actor_and_target_statuses(
        &attacker, &defender, &breath, &mut chain,
        &BTreeMap::new(), &BTreeMap::new(),
    );
    let weight_ratio = attacker.weight / defender.weight;
    let base = (defender.health * (1.0 + weight_ratio)) / 2.0 / 100.0;
    let expected = base * 0.25 * 1.125 * (1.0 - defender.breath_resistance);
    assert!(
        (actual - expected).abs() < 1e-9,
        "Miasma Breath per-tick damage mismatch: expected {expected}, got {actual}"
    );
}

#[test]
fn heals_user_two_times_per_second_while_firing() {
    // [REF:ability_miasma_breath]
    // Bullet 5: "Miasma Breath also heals the user 2 times per second
    // while it is firing."
    // To observe heal events, wound the attacker first (defender
    // pressure) so the heal does not clamp at full HP. Heal trace
    // event description = "Miasma Breath heal".
    let mut attacker = passive_combatant(1_000.0);
    attacker.bite_cooldown = 1000.0;
    let mut defender = passive_combatant(10_000_000.0);
    defender.damage = 100.0;
    defender.bite_cooldown = 0.4; // wound A before first miasma tick at t=0.5
    let breath = miasma_breath_profile();

    let result = simulate_composable_matchup_with_trace(
        &attacker, &defender,
        Some(&breath), None,
        SimpleAbilityTimingMode::Fast,
        &ComposableAbilityConfig::default(),
        3.0, true,
    );
    let log = result.combat_log.expect("trace log");
    let heal_times: Vec<f64> = log
        .iter()
        .filter(|e| e.description.as_deref() == Some("Miasma Breath heal"))
        .map(|e| e.time)
        .collect();
    assert!(
        heal_times.len() >= 5,
        "expected at least 5 Miasma heal ticks in 3 s window, got: {heal_times:?}"
    );
    for pair in heal_times.windows(2) {
        let gap = pair[1] - pair[0];
        assert!(
            (gap - 0.5).abs() < 1e-9,
            "Miasma Breath heal tick spacing must be 0.5 s, got {gap}: {heal_times:?}"
        );
    }
}

#[test]
fn each_healing_tick_restores_half_percent_max_hp() {
    // [REF:ability_miasma_breath]
    // Bullet 6: "Each healing tick restores 0.5% of the user's max HP."
    // Wound the attacker enough that the heal does not clamp at full
    // HP, then assert the per-tick `healing` field equals 0.5% of maxHP.
    let mut attacker = passive_combatant(1_000.0);
    attacker.bite_cooldown = 1000.0;
    let mut defender = passive_combatant(10_000_000.0);
    defender.damage = 100.0;
    defender.bite_cooldown = 0.4;
    let breath = miasma_breath_profile();
    let result = simulate_composable_matchup_with_trace(
        &attacker, &defender,
        Some(&breath), None,
        SimpleAbilityTimingMode::Fast,
        &ComposableAbilityConfig::default(),
        2.0, true,
    );
    let log = result.combat_log.expect("trace log");
    let heals: Vec<&_> = log
        .iter()
        .filter(|e| e.description.as_deref() == Some("Miasma Breath heal"))
        .collect();
    assert!(
        !heals.is_empty(),
        "Miasma Breath must emit at least one heal event when the user is wounded"
    );
    let heal_amount = heals[0].healing.unwrap_or(0.0);
    let expected_per_tick = attacker.health * (breath.self_heal_pct / 100.0);
    assert!(
        (heal_amount - expected_per_tick).abs() < 1e-6,
        "per-tick heal must equal max HP × self_heal_pct / 100 = {expected_per_tick}, got {heal_amount}"
    );
}
