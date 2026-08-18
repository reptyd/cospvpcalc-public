//! Reference: ability_lightning_breath
//!
//! Covers each testable bullet in the "Lightning Breath" entry. Each
//! test body starts with the [REF:ability_lightning_breath] marker so
//! the vitest coverage gate (src/pages/referenceCoverage.test.ts)
//! sees it.
//!
//! Source of truth for breath stats: data/breath_specs.runtime.json:177-191
//! (id="Lightning_Breath", capacity 5 sec, regen 12, crit 50%, dps 3,
//! perHit "1.5% PER HIT", chain 25, chainMaxStacks 5, secondary Shock
//! 50% no-stacking).

use super::super::breath::{breath_burst_model_enabled, set_breath_burst_model_override};
use super::super::config::ComposableAbilityConfig;
use super::super::simulate_composable_matchup_with_trace;
use super::{
    applied_status, assert_tick_stacks, default_breath, default_combatant,
    stacks_from_one_breath_tick,
};
use crate::combat::{breath_chain_advance, compute_simple_breath_damage_with_actor_and_target_statuses};
use crate::contracts::{SimpleAbilityTimingMode, SimpleBreathProfile, SimpleCombatantStats};
use crate::spec_constants::{LIGHTNING_BREATH_CRIT_MULTIPLIER, LIGHTNING_BREATH_PER_HIT_MULTIPLIER};
use std::collections::BTreeMap;

fn lightning_breath_profile() -> SimpleBreathProfile {
    let mut breath = default_breath();
    // Per Reference text "* 1.5 * 1.5": the first 1.5 is the per-tick
    // fraction (Lightning Breath ticks 2 times per second with dps
    // 3%/s, so per-tick = 3/2 = 1.5%) and the second 1.5 is the 50%
    // pseudo-crit. Encoded as dps_pct=3, crit_chance_pct=50; the
    // engine yields `dps_pct * 0.5 * (1 + crit_chance_pct/100)`.
    breath.dps_pct = 3.0;
    breath.capacity = 5.0;
    breath.regen_rate = 12.0;
    breath.crit_chance_pct = 50.0;
    // chain=25 (interpreted as percent points per stack => 0.25 per
    // stack), chain_max_stacks=5. Engine: damage *= 1 + (chain/100) x
    // current_stacks; stacks ramp +1 per tick up to chain_max_stacks.
    breath.chain = 25.0;
    breath.chain_max_stacks = 5.0;
    // Shock 50% x 1 stack, as expected stacks per tick.
    breath.special_statuses = vec![applied_status("Shock_Status", 0.5)];
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
    // [REF:ability_lightning_breath]
    // Bullet 1: "Lightning Breath deals damage 2 times per second
    // while it is firing." Capacity 5 (seconds) emits 10 ticks at
    // t=0.5..5.0.
    let attacker = passive_combatant(1_000.0);
    let defender = passive_combatant(10_000_000.0);
    let breath = lightning_breath_profile();
    let result = simulate_composable_matchup_with_trace(
        &attacker, &defender,
        Some(&breath), None,
        SimpleAbilityTimingMode::Fast,
        &ComposableAbilityConfig::default(),
        5.5, true,
    );
    let log = result.combat_log.expect("trace log");
    let breath_ticks: Vec<f64> = log
        .iter()
        .filter(|e| e.entry_type == "breath" && e.attacker == "A")
        .map(|e| e.time)
        .collect();
    assert_eq!(
        breath_ticks.len(),
        10,
        "expected 10 breath ticks (5 s capacity × 2/s) before exhaustion: {breath_ticks:?}"
    );
    let first = breath_ticks[0];
    let last = breath_ticks[breath_ticks.len() - 1];
    assert!(
        (first - 0.5).abs() < 1e-9,
        "first Lightning Breath tick must land at t=0.5, got {first}"
    );
    assert!(
        (last - 5.0).abs() < 1e-9,
        "last Lightning Breath tick must land at t=5.0, got {last}"
    );
}

#[test]
fn capacity_is_five_seconds_of_firing() {
    // [REF:ability_lightning_breath]
    // Bullet 2: "Capacity is 5 seconds of firing - one second of continuous
    // fire spends 1 unit." Capacity is in seconds; with 2 ticks/s that is
    // exactly 10 ticks before the burst exhausts and waits for regen.
    let attacker = passive_combatant(1_000.0);
    let defender = passive_combatant(10_000_000.0);
    let breath = lightning_breath_profile();
    let result = simulate_composable_matchup_with_trace(
        &attacker, &defender,
        Some(&breath), None,
        SimpleAbilityTimingMode::Fast,
        &ComposableAbilityConfig::default(),
        7.0, true,
    );
    let log = result.combat_log.expect("trace log");
    let burst_ticks: Vec<f64> = log
        .iter()
        .filter(|e| e.entry_type == "breath" && e.attacker == "A" && e.time <= 6.0 + 1e-9)
        .map(|e| e.time)
        .collect();
    // The breath re-bursts after emptying (a ~1 s regen gap), so count only
    // the first contiguous run of ticks (<= one 0.5 s tick apart).
    let first_burst = if burst_ticks.is_empty() {
        0
    } else {
        1 + burst_ticks
            .windows(2)
            .take_while(|w| w[1] - w[0] <= 0.5 + 1e-9)
            .count()
    };
    assert_eq!(
        first_burst,
        10,
        "first Lightning Breath burst must exhaust after 5 s of firing (10 ticks): {burst_ticks:?}"
    );
}

#[test]
fn damage_formula_matches_spec() {
    // [REF:ability_lightning_breath]
    // Bullet 4: "Breath damage per tick is calculated as (((target max HP × (1
    // + min(attacker effective weight / defender effective weight, 3))) / 2) /
    // 100) × 1.5 × 1.25 × chain multiplier × (1 - breath resistance)." First
    // chained tick: stacks=0 -> chain multiplier = 1.0.
    let mut attacker = default_combatant();
    attacker.weight = 200.0;
    let mut defender = default_combatant();
    defender.health = 4_000.0;
    defender.weight = 100.0;
    defender.breath_resistance = 0.20;
    let breath = lightning_breath_profile();

    let mut chain = 0.0;
    let actual = compute_simple_breath_damage_with_actor_and_target_statuses(
        &attacker, &defender, &breath, &mut chain,
        &BTreeMap::new(), &BTreeMap::new(),
    );
    let weight_ratio = attacker.weight / defender.weight;
    let base = (defender.health * (1.0 + weight_ratio)) / 2.0 / 100.0;
    // First tick: chain multiplier is read at 0 stacks -> 1.0.
    // dps_pct=3 -> 3 x 0.5 = 1.5; 50% pseudo-crit at 1.5x global crit
    // -> 1 + 0.50 x 0.5 = 1.25; first chained tick at stacks=0 ->
    // chain multiplier 1.0. Total: 1.5 x 1.25 x 1.0 = 1.875.
    let expected = base
        * LIGHTNING_BREATH_PER_HIT_MULTIPLIER
        * LIGHTNING_BREATH_CRIT_MULTIPLIER
        * 1.0
        * (1.0 - defender.breath_resistance);
    assert!(
        (actual - expected).abs() < 1e-9,
        "Lightning Breath first-tick damage mismatch: expected {expected}, got {actual}"
    );
}

#[test]
fn chain_multiplier_ramps_one_to_two_point_two_five() {
    // [REF:ability_lightning_breath]
    // Bullets 5 + 6: "Each breath tick applies the multiplier 1 + (0.25 ×
    // current chain stacks) and then adds 1 chain stack, up to 5 stacks." +
    // "That means the first chained tick is 1.0x (0 stacks) and the multiplier
    // ramps up to 2.25x at 5 stacks."
    let attacker = default_combatant();
    let mut defender = default_combatant();
    defender.health = 2_000.0;
    defender.weight = 100.0;
    defender.breath_resistance = 0.0;
    let breath = lightning_breath_profile();
    let weight_ratio = attacker.weight / defender.weight;
    let base = (defender.health * (1.0 + weight_ratio)) / 2.0 / 100.0
        * breath.dps_pct
        * 0.5
        * (1.0 + breath.crit_chance_pct / 100.0 * 0.5);

    // BREATH_BURST_MODEL: compute read is pure; advance the chain manually
    // between calls. Per-tick damages are unchanged (only the increment site
    // moved).
    set_breath_burst_model_override(Some(true));
    assert!(breath_burst_model_enabled());
    let mut chain = 0.0;
    let mut damages = Vec::new();
    for _ in 0..6 {
        let d = compute_simple_breath_damage_with_actor_and_target_statuses(
            &attacker, &defender, &breath, &mut chain,
            &BTreeMap::new(), &BTreeMap::new(),
        );
        damages.push(d);
        breath_chain_advance(&mut chain, &breath);
    }
    set_breath_burst_model_override(None);
    // Tick 1: stacks=0 -> 1.0, tick 2: 1.25, ..., tick 6: stacks=5 -> 2.25.
    let expected = [1.0_f64, 1.25, 1.5, 1.75, 2.0, 2.25];
    for (i, (got, want)) in damages.iter().zip(expected.iter()).enumerate() {
        let want_damage = base * want;
        assert!(
            (got - want_damage).abs() < 1e-9,
            "tick {} chain multiplier mismatch: expected {want}x ({want_damage}), got {got}",
            i + 1
        );
    }
}

#[test]
fn chain_caps_at_five_stacks() {
    // [REF:ability_lightning_breath]
    // Bullet 5: "...up to 5 stacks..." - the chain stack counter saturates at
    // 5; a sixth tick uses the same 1 + 0.25x5 = 2.25 multiplier.
    let attacker = default_combatant();
    let mut defender = default_combatant();
    defender.health = 2_000.0;
    defender.weight = 100.0;
    defender.breath_resistance = 0.0;
    let breath = lightning_breath_profile();

    // BREATH_BURST_MODEL: compute read is pure; advance the chain manually
    // between calls so the cap in the moved increment is exercised.
    set_breath_burst_model_override(Some(true));
    assert!(breath_burst_model_enabled());
    let mut chain = 0.0;
    // Burn through 5 ticks to ramp to cap.
    for _ in 0..5 {
        compute_simple_breath_damage_with_actor_and_target_statuses(
            &attacker, &defender, &breath, &mut chain,
            &BTreeMap::new(), &BTreeMap::new(),
        );
        breath_chain_advance(&mut chain, &breath);
    }
    // Sixth and seventh ticks must yield the same capped damage.
    let sixth = compute_simple_breath_damage_with_actor_and_target_statuses(
        &attacker, &defender, &breath, &mut chain,
        &BTreeMap::new(), &BTreeMap::new(),
    );
    breath_chain_advance(&mut chain, &breath);
    let seventh = compute_simple_breath_damage_with_actor_and_target_statuses(
        &attacker, &defender, &breath, &mut chain,
        &BTreeMap::new(), &BTreeMap::new(),
    );
    breath_chain_advance(&mut chain, &breath);
    set_breath_burst_model_override(None);
    assert!(
        (sixth - seventh).abs() < 1e-9,
        "Lightning Breath chain must cap at 5 stacks: tick 6 = {sixth}, tick 7 = {seventh}"
    );
    // Sanity: capped damage is base x 2.25 (1 + 0.25 x 5).
    let weight_ratio = attacker.weight / defender.weight;
    let base = (defender.health * (1.0 + weight_ratio)) / 2.0 / 100.0
        * breath.dps_pct
        * 0.5
        * (1.0 + breath.crit_chance_pct / 100.0 * 0.5);
    let expected_cap = base * 2.25;
    assert!(
        (sixth - expected_cap).abs() < 1e-9,
        "capped chain damage must equal base × 2.25: expected {expected_cap}, got {sixth}"
    );
}

#[test]
fn applies_shock_secondary_status() {
    // [REF:ability_lightning_breath]
    // Bullet 8: "Every damage tick applies 0.5 stacks of Shock - the
    // model does not roll Shock's 50% chance with no stacking, it
    // applies the average of that roll."
    let attacker = passive_combatant(1_000.0);
    let defender = passive_combatant(10_000_000.0);
    let breath = lightning_breath_profile();
    let result = simulate_composable_matchup_with_trace(
        &attacker, &defender,
        Some(&breath), None,
        SimpleAbilityTimingMode::Fast,
        &ComposableAbilityConfig::default(),
        5.0, true,
    );
    let log = result.combat_log.expect("trace log");
    let shock_present = log
        .iter()
        .any(|e| e.status_id.as_deref() == Some("Shock_Status"));
    assert!(
        shock_present,
        "Lightning Breath must apply Shock_Status while firing"
    );
}

#[test]
fn each_tick_applies_the_shock_stacks_the_entry_states() {
    // [REF:ability_lightning_breath]
    // "Every damage tick applies 0.5 stacks of Shock".
    let applied = stacks_from_one_breath_tick(&lightning_breath_profile());
    assert_tick_stacks(&applied, "Shock_Status", 0.5);
}
