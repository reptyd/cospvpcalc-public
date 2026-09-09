//! Reference: approx_breath_pseudo_crits_and_pseudo_procs
//!
//! The three ways a breath resolves the chances the game rolls - its crit
//! chance, and the chance on each ailment it carries - read through a whole
//! fight rather than through the resolver alone.

use super::super::config::{ComposableAbilityConfig, SimpleBreathRollMode};
use super::super::simulate_composable_matchup_with_trace;
use super::{default_breath, default_combatant};
use crate::contracts::{
    SimpleAbilityTimingMode, SimpleAppliedStatus, SimpleBreathProfile, SimpleCombatantStats,
};

fn quiet(max_hp: f64) -> SimpleCombatantStats {
    let mut c = default_combatant();
    c.health = max_hp;
    c.damage = 0.0;
    c.bite_cooldown = 1000.0;
    c.health_regen = 0.0;
    c
}

/// A breath that crits a quarter of the time and lands one Burn stack a fifth
/// of the time, stated as the chance and the payload rather than the product.
fn chancy_breath() -> SimpleBreathProfile {
    let mut breath = default_breath();
    breath.dps_pct = 0.5;
    breath.capacity = 100.0;
    breath.regen_rate = 1.0;
    breath.crit_chance_pct = 25.0;
    breath.special_statuses = vec![SimpleAppliedStatus {
        status_id: "Burn_Status".to_string(),
        stacks: 1.0,
        probability_pct: Some(20.0),
        ..Default::default()
    }];
    breath
}

fn config(mode: SimpleBreathRollMode) -> ComposableAbilityConfig {
    let mut cfg = ComposableAbilityConfig::default();
    cfg.attacker_breath_roll_mode = mode;
    cfg
}

/// Damage dealt to the defender over `seconds` of the attacker breathing.
fn damage_over(mode: SimpleBreathRollMode, seconds: f64) -> f64 {
    let attacker = quiet(1_000_000.0);
    let defender = quiet(1_000_000_000.0);
    let result = simulate_composable_matchup_with_trace(
        &attacker, &defender, Some(&chancy_breath()), None,
        SimpleAbilityTimingMode::Fast,
        &config(mode),
        seconds, true,
    );
    1_000_000_000.0 - result.final_hp_b
}

#[test]
fn pseudo_and_even_land_the_same_damage_over_a_whole_number_of_cycles() {
    // [REF:approx_breath_pseudo_crits_and_pseudo_procs]
    // A quarter chance repeats every four ticks, and the breath ticks twice a
    // second, so twenty seconds is ten whole cycles.
    let pseudo = damage_over(SimpleBreathRollMode::Pseudo, 20.0);
    let even = damage_over(SimpleBreathRollMode::Even, 20.0);
    assert!(pseudo > 0.0);
    assert!(
        (pseudo - even).abs() / pseudo < 0.02,
        "the two totals agree over whole cycles: {pseudo} against {even}",
    );
}

#[test]
fn a_single_tick_differs_between_pseudo_and_even() {
    // [REF:approx_breath_pseudo_crits_and_pseudo_procs]
    // The first tick of a 25% crit chance does not crit under `Even` and
    // takes a quarter of a crit's extra damage under `Pseudo`, so the two
    // differ on a single tick even where their totals over a cycle agree.
    let pseudo = damage_over(SimpleBreathRollMode::Pseudo, 0.5);
    let even = damage_over(SimpleBreathRollMode::Even, 0.5);
    assert!(pseudo > even, "{pseudo} against {even}");
}

#[test]
fn a_drawn_run_varies_with_its_seed() {
    // [REF:approx_breath_pseudo_crits_and_pseudo_procs]
    let attacker = quiet(1_000_000.0);
    let defender = quiet(1_000_000_000.0);
    let damage = |seed: f64| {
        let mut cfg = config(SimpleBreathRollMode::Random);
        cfg.breath_roll_seed = seed;
        let result = simulate_composable_matchup_with_trace(
            &attacker, &defender, Some(&chancy_breath()), None,
            SimpleAbilityTimingMode::Fast,
            &cfg,
            20.0, true,
        );
        1_000_000_000.0 - result.final_hp_b
    };
    let first = damage(1.0);
    let second = damage(2.0);
    assert!(first > 0.0 && second > 0.0);
    assert!((first - second).abs() > 1e-9, "two seeds do not draw the same run");
}

#[test]
fn the_even_pattern_lands_the_ailment_whole_rather_than_in_fractions() {
    // [REF:approx_breath_pseudo_crits_and_pseudo_procs]
    let attacker = quiet(1_000_000.0);
    let defender = quiet(1_000_000_000.0);
    let burn_applications = |mode: SimpleBreathRollMode| {
        simulate_composable_matchup_with_trace(
            &attacker, &defender, Some(&chancy_breath()), None,
            SimpleAbilityTimingMode::Fast,
            &config(mode),
            10.0, true,
        )
        .combat_log
        .expect("trace")
        .iter()
        .filter(|e| e.status_id.as_deref() == Some("Burn_Status"))
        .count()
    };
    let even = burn_applications(SimpleBreathRollMode::Even);
    let pseudo = burn_applications(SimpleBreathRollMode::Pseudo);
    assert!(
        even < pseudo,
        "the even pattern applies on a fifth of the ticks, pseudo on every one: {even} against {pseudo}",
    );
    assert!(even > 0, "and it does apply");
}
