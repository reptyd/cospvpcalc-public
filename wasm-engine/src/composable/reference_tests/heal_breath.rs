//! Reference: ability_heal_breath
//!
//! Covers each testable bullet in the "Heal Breath" entry. Each test
//! body starts with the [REF:ability_heal_breath] marker so the vitest
//! coverage gate (src/pages/referenceCoverage.test.ts) sees it.
//!
//! Source of truth for breath stats: data/breath_specs.runtime.json:147-160
//! (id="Heal_Breath", capacity 10 sec, regen 5, crit 0%, dps 0%,
//! self-heal 3% maxHP, cleanse 0.5 stacks/tick).
//!
//! Engine path: when `breath.special_kind == Some("heal")` the
//! `composable::breath::handle_heal_breath` branch fires the per-tick
//! heal+cleanse and skips the damage path. The trace event description
//! is "Heal Breath heal" (composable/mod.rs:312-313). Cleanse priority
//! is encoded directly inside `statuses::heal_simple_status_stacks`.

use super::super::config::ComposableAbilityConfig;
use super::super::simulate_composable_matchup_with_trace;
use super::{default_breath, default_combatant};
use crate::contracts::{
    SimpleAbilityTimingMode, SimpleBreathProfile, SimpleCombatantStats,
    SimpleStatusInstance,
};
use crate::statuses::heal_simple_status_stacks;
use std::collections::BTreeMap;

fn heal_breath_profile() -> SimpleBreathProfile {
    let mut breath = default_breath();
    breath.dps_pct = 0.0;
    breath.capacity = 10.0;
    breath.regen_rate = 5.0;
    breath.crit_chance_pct = 0.0;
    breath.special_kind = Some("heal".to_string());
    breath.self_heal_pct = 3.0;
    breath.cleanse_stacks = 0.5;
    breath
}

fn passive_combatant(max_hp: f64) -> SimpleCombatantStats {
    let mut c = default_combatant();
    c.health = max_hp;
    c.damage = 0.0;
    c.bite_cooldown = 1000.0;
    c
}

fn status_instance(stacks: f64) -> SimpleStatusInstance {
    SimpleStatusInstance {
        stacks,
        next_tick_at: None,
        next_decay_at: Some(3.0),
        remaining_sec: 30.0,
        stack_value_mode: None,
        lich_mark_owned_stacks: None,
        no_decay: false,
        resolved_scalars: None,
    }
}

#[test]
fn deals_no_damage_to_target() {
    // [REF:ability_heal_breath]
    // Bullet 1: "Heal Breath deals no damage."
    // The "heal" special_kind branch in
    // `composable::breath::handle_heal_breath` skips damage entirely.
    let attacker = passive_combatant(1_000.0);
    let defender = passive_combatant(10_000.0);
    let breath = heal_breath_profile();
    let result = simulate_composable_matchup_with_trace(
        &attacker,
        &defender,
        Some(&breath),
        None,
        SimpleAbilityTimingMode::Fast,
        &ComposableAbilityConfig::default(),
        10.0,
        false,
    );
    assert!(
        (result.final_hp_b - defender.health).abs() < 1e-6,
        "Heal Breath must not damage the target: defender HP {} → {}",
        defender.health,
        result.final_hp_b
    );
    assert!(
        result.damage_dealt_a < 1e-9,
        "Heal Breath must contribute zero damage_dealt_a, got {}",
        result.damage_dealt_a
    );
}

#[test]
fn capacity_is_ten_seconds_of_firing() {
    // [REF:ability_heal_breath]
    // Bullet 2: "Heal Breath has capacity 10."
    // Capacity is in seconds. With the user wounded so each tick fires
    // a heal event, we must observe exactly 20 heal events in the first
    // burst (10 s × 2 ticks/s) before the burst exhausts.
    let mut attacker = passive_combatant(1_000_000.0);
    attacker.bite_cooldown = 1000.0;
    let mut defender = passive_combatant(10_000_000.0);
    defender.damage = 100.0;
    defender.bite_cooldown = 0.4; // wound user before first heal tick at t=0.5
    let breath = heal_breath_profile();
    let result = simulate_composable_matchup_with_trace(
        &attacker,
        &defender,
        Some(&breath),
        None,
        SimpleAbilityTimingMode::Fast,
        &ComposableAbilityConfig::default(),
        12.0,
        true,
    );
    let log = result.combat_log.expect("trace log");
    let burst_heals: Vec<f64> = log
        .iter()
        .filter(|e| {
            e.description.as_deref() == Some("Heal Breath heal") && e.time <= 11.0 + 1e-9
        })
        .map(|e| e.time)
        .collect();
    assert_eq!(
        burst_heals.len(),
        20,
        "first Heal Breath burst must exhaust after 10 s of firing (20 ticks): {burst_heals:?}"
    );
}

#[test]
fn ticks_two_times_per_second_while_firing() {
    // [REF:ability_heal_breath]
    // Bullet 3: "Heal Breath ticks 2 times per second while it is firing."
    // Tick spacing is 0.5 s; first tick lands at t=0.5.
    let mut attacker = passive_combatant(1_000_000.0);
    attacker.bite_cooldown = 1000.0;
    let mut defender = passive_combatant(10_000_000.0);
    defender.damage = 100.0;
    defender.bite_cooldown = 0.4;
    let breath = heal_breath_profile();
    let result = simulate_composable_matchup_with_trace(
        &attacker,
        &defender,
        Some(&breath),
        None,
        SimpleAbilityTimingMode::Fast,
        &ComposableAbilityConfig::default(),
        3.0,
        true,
    );
    let log = result.combat_log.expect("trace log");
    let heal_times: Vec<f64> = log
        .iter()
        .filter(|e| e.description.as_deref() == Some("Heal Breath heal"))
        .map(|e| e.time)
        .collect();
    assert!(
        heal_times.len() >= 5,
        "expected at least 5 heal ticks in 3 s window, got: {heal_times:?}"
    );
    assert!(
        (heal_times[0] - 0.5).abs() < 1e-9,
        "first Heal Breath tick must land at t=0.5, got {}",
        heal_times[0]
    );
    for pair in heal_times.windows(2) {
        let gap = pair[1] - pair[0];
        assert!(
            (gap - 0.5).abs() < 1e-9,
            "Heal Breath tick spacing must be 0.5 s, got {gap}: {heal_times:?}"
        );
    }
}

#[test]
fn each_tick_heals_three_percent_max_hp() {
    // [REF:ability_heal_breath]
    // Bullet 4: "Each tick heals the user for 3% of max HP."
    // Wound the attacker enough that the heal does not clamp at full
    // HP, then assert the per-tick `healing` field equals 3% of maxHP.
    let mut attacker = passive_combatant(1_000.0);
    attacker.bite_cooldown = 1000.0;
    let mut defender = passive_combatant(10_000_000.0);
    defender.damage = 200.0; // 20% of attacker maxHP per bite
    defender.bite_cooldown = 0.4;
    let breath = heal_breath_profile();
    let result = simulate_composable_matchup_with_trace(
        &attacker,
        &defender,
        Some(&breath),
        None,
        SimpleAbilityTimingMode::Fast,
        &ComposableAbilityConfig::default(),
        2.0,
        true,
    );
    let log = result.combat_log.expect("trace log");
    let heals: Vec<&_> = log
        .iter()
        .filter(|e| e.description.as_deref() == Some("Heal Breath heal"))
        .collect();
    assert!(
        !heals.is_empty(),
        "Heal Breath must emit at least one heal event when the owner is wounded"
    );
    let heal_amount = heals[0].healing.unwrap_or(0.0);
    let expected_per_tick = attacker.health * (breath.self_heal_pct / 100.0);
    assert!(
        (heal_amount - expected_per_tick).abs() < 1e-6,
        "per-tick heal must equal max HP × self_heal_pct / 100 = {expected_per_tick}, got {heal_amount}"
    );
}

#[test]
fn each_tick_removes_half_stack_of_negative_status() {
    // [REF:ability_heal_breath]
    // Bullet 5: "Each tick also removes 0.5 stacks of removable
    // negative statuses from the user."
    // Direct unit test of `heal_simple_status_stacks` (called from the
    // engine each tick with `breath.cleanse_stacks` as the budget).
    let mut statuses: BTreeMap<String, SimpleStatusInstance> = BTreeMap::new();
    statuses.insert("Poison_Status".to_string(), status_instance(4.0));
    heal_simple_status_stacks(0.0, &mut statuses, 0.5);
    let poison_stacks = statuses.get("Poison_Status").map(|s| s.stacks).unwrap_or(0.0);
    assert!(
        (poison_stacks - 3.5).abs() < 1e-9,
        "one cleanse pass must remove exactly 0.5 stacks: got {poison_stacks}"
    );
}

#[test]
fn cleanse_order_is_poison_then_burn_then_bleed_then_corrosion() {
    // [REF:ability_heal_breath]
    // Bullet 6: "That cleanse is not random. It works in a fixed order:
    // Poison, Burn, Bleed, then Corrosion."
    // Pre-load Poison with 0.3 stacks. The first cleanse pass has a
    // 0.5 budget: it removes all 0.3 Poison, then spends the remaining
    // 0.2 on Burn (next in order). Bleed and Corrosion are left
    // untouched until the next cleanse. Mirrors the loop in
    // `statuses::heal_simple_status_stacks` which iterates Poison →
    // Burn → Bleed → Corrosion in that exact order.
    let mut statuses: BTreeMap<String, SimpleStatusInstance> = BTreeMap::new();
    statuses.insert("Poison_Status".to_string(), status_instance(0.3));
    statuses.insert("Burn_Status".to_string(), status_instance(5.0));
    statuses.insert("Bleed_Status".to_string(), status_instance(5.0));
    statuses.insert("Corrosion_Status".to_string(), status_instance(5.0));

    heal_simple_status_stacks(0.0, &mut statuses, 0.5);

    let poison = statuses.get("Poison_Status").map(|s| s.stacks).unwrap_or(0.0);
    let burn = statuses.get("Burn_Status").map(|s| s.stacks).unwrap_or(0.0);
    let bleed = statuses.get("Bleed_Status").map(|s| s.stacks).unwrap_or(0.0);
    let corrosion = statuses.get("Corrosion_Status").map(|s| s.stacks).unwrap_or(0.0);

    assert!(
        poison < 1e-9,
        "Poison must be drained first (0.3 - 0.3 = 0): got {poison}"
    );
    assert!(
        (burn - 4.8).abs() < 1e-9,
        "Burn must absorb the leftover 0.2 cleanse after Poison drains: expected 4.8, got {burn}"
    );
    assert!(
        (bleed - 5.0).abs() < 1e-9,
        "Bleed must NOT be touched on the first cleanse (Poison+Burn absorbed the 0.5 budget): got {bleed}"
    );
    assert!(
        (corrosion - 5.0).abs() < 1e-9,
        "Corrosion must NOT be touched on the first cleanse: got {corrosion}"
    );
}
