//! Reference: ability_life_of_the_forest
//!
//! The ability grants an overshield - a bar above health that takes damage
//! before health does - sized by the plants standing inside its radius when it
//! fires.

use super::super::config::ComposableAbilityConfig;
use super::super::damage_pipeline::absorb_with_overshield;
use super::super::simulate_composable_matchup_with_trace;
use super::default_combatant;
use crate::composable::side::CombatSide;
use crate::contracts::{SimpleAbilityTimingMode, SimpleCombatantStats};

fn quiet(health: f64) -> SimpleCombatantStats {
    let mut s = default_combatant();
    s.health = health;
    s.damage = 0.0;
    s.health_regen = 0.0;
    s
}

/// The shield after `seconds` of a fight in which nobody deals damage.
fn shield_after(plants: f64, seconds: f64) -> f64 {
    let mut config = ComposableAbilityConfig::default();
    config.attacker_life_of_the_forest_plants = plants;
    shield_after_config(&config, seconds)
}

fn shield_after_config(config: &ComposableAbilityConfig, seconds: f64) -> f64 {
    let stats = quiet(1000.0);
    simulate_composable_matchup_with_trace(
        &stats, &stats, None, None,
        SimpleAbilityTimingMode::Ideal,
        config,
        seconds, true,
    )
    .debug
    .expect("side snapshots")
    .a
    .overshield
}

#[test]
fn one_percent_of_maximum_health_a_plant() {
    // [REF:ability_life_of_the_forest]
    assert!((shield_after(1.0, 1.0) - 10.0).abs() < 1e-9, "one plant on a 1000 pool");
    assert!((shield_after(3.0, 1.0) - 30.0).abs() < 1e-9);
    assert!((shield_after(5.0, 1.0) - 50.0).abs() < 1e-9);
}

#[test]
fn no_plants_leaves_it_inert() {
    // [REF:ability_life_of_the_forest]
    assert_eq!(shield_after(0.0, 10.0), 0.0);
}

#[test]
fn a_sixth_plant_adds_nothing() {
    // [REF:ability_life_of_the_forest]
    assert!((shield_after(9.0, 1.0) - 50.0).abs() < 1e-9, "the count stops at five");
}

#[test]
fn it_fires_again_every_thirty_seconds_up_to_the_ceiling() {
    // [REF:ability_life_of_the_forest]
    // Five plants is 5% a firing, and 20% is the ceiling, so four firings reach
    // it and the fifth adds nothing.
    assert!((shield_after(5.0, 91.0) - 200.0).abs() < 1e-9, "four firings on a 1000 pool");
    assert!((shield_after(5.0, 200.0) - 200.0).abs() < 1e-9, "and it stops there");
}

#[test]
fn the_bar_takes_damage_before_health_does() {
    // [REF:ability_life_of_the_forest]
    let stats = quiet(1000.0);
    let mut side = CombatSide::new(&stats, None);
    side.overshield = 50.0;

    assert_eq!(absorb_with_overshield(&mut side, 20.0), 0.0, "a small hit reaches health as nothing");
    assert_eq!(side.overshield, 30.0);

    assert_eq!(absorb_with_overshield(&mut side, 100.0), 70.0, "a large one reaches it as the remainder");
    assert_eq!(side.overshield, 0.0);

    assert_eq!(absorb_with_overshield(&mut side, 40.0), 40.0, "and an empty bar takes nothing");
}

#[test]
fn one_firing_is_all_a_single_activation_gives() {
    // [REF:ability_life_of_the_forest]
    let mut config = ComposableAbilityConfig::default();
    config.attacker_life_of_the_forest_plants = 5.0;
    config.attacker_life_of_the_forest_once = true;

    assert!((shield_after_config(&config, 1.0) - 50.0).abs() < 1e-9, "the opening firing lands");
    assert!(
        (shield_after_config(&config, 200.0) - 50.0).abs() < 1e-9,
        "and no later firing follows it",
    );
}

#[test]
fn a_drawn_count_stays_inside_the_range_and_varies_with_the_seed() {
    // [REF:ability_life_of_the_forest]
    // Five plants is 5% a firing, so four firings would reach the 20% ceiling.
    // A drawn count lands at or under that, and above nothing over a long
    // enough fight for the zero draws to be outnumbered.
    let mut config = ComposableAbilityConfig::default();
    config.attacker_life_of_the_forest_random = true;

    let mut seen = Vec::new();
    for seed in 0..8u32 {
        config.life_of_the_forest_seed = f64::from(seed) + 1.0;
        let shield = shield_after_config(&config, 200.0);
        assert!((0.0..=200.0 + 1e-9).contains(&shield), "inside the range: {shield}");
        seen.push(shield);
    }
    assert!(seen.iter().any(|&s| s > 0.0), "a draw eventually counts a plant");
    assert!(
        seen.iter().any(|&s| (s - seen[0]).abs() > 1e-9),
        "and two seeds do not draw the same sequence",
    );
}

#[test]
fn a_drawn_count_reads_no_fixed_figure() {
    // [REF:ability_life_of_the_forest]
    // The two settings are one choice: with the draw on, the figure beside it
    // is unread, so the same seed gives the same shield whatever it says.
    let mut config = ComposableAbilityConfig::default();
    config.attacker_life_of_the_forest_random = true;
    config.life_of_the_forest_seed = 7.0;
    let drawn = shield_after_config(&config, 200.0);

    config.attacker_life_of_the_forest_plants = 5.0;
    assert!((shield_after_config(&config, 200.0) - drawn).abs() < 1e-9);
}
