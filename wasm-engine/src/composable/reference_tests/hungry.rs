//! Reference: status_hungry
//!
//! Covers every testable bullet in the "Hungry" entry. Each test body
//! must contain the [REF:status_hungry] marker so the vitest coverage gate
//! sees it - the gate reads the marker only from a file that asserts, so
//! a body carrying nothing but the marker still counts as uncovered.

use super::default_combatant;
use crate::combat::hp_regen_multiplier_from_statuses;
use crate::compare_hunger::{starving_stacks, COMPARE_METER_DRAIN_UNITS_PER_SEC};
use crate::composable::side::CombatSide;
use crate::composable::status_helpers::advance_side_hunger;
use crate::statuses::{compute_simple_dot_damage, status_tick_sec};

const DRAIN_INTERVAL_SEC: f64 = 1.0 / COMPARE_METER_DRAIN_UNITS_PER_SEC;

fn starving_side(starting_hunger: f64) -> CombatSide {
    let mut side = CombatSide::new(&default_combatant(), None);
    side.compare_hunger_rule_enabled = true;
    side.compare_appetite_base = 100.0;
    side.compare_hunger = starting_hunger;
    side.compare_thirst = 100.0;
    side
}

fn hungry_stacks(side: &CombatSide) -> f64 {
    side.statuses
        .get("Hungry_Status")
        .map(|i| i.stacks)
        .unwrap_or(0.0)
}

#[test]
fn arrives_when_the_meter_empties_and_leaves_when_it_does_not() {
    // [REF:status_hungry]
    // "Hungry lands the moment the hunger meter reaches zero and is removed
    // the moment the meter is no longer empty."
    let mut side = starving_side(1.0);
    advance_side_hunger(&mut side, DRAIN_INTERVAL_SEC / 2.0);
    assert_eq!(hungry_stacks(&side), 0.0, "half a unit left is not empty");

    advance_side_hunger(&mut side, DRAIN_INTERVAL_SEC);
    assert!(hungry_stacks(&side) > 0.0, "an empty meter must be Hungry");

    // Refilling lifts it outright - the status tracks the meter rather than
    // decaying on its own clock.
    side.compare_hunger = 50.0;
    advance_side_hunger(&mut side, DRAIN_INTERVAL_SEC + 1.0);
    assert_eq!(hungry_stacks(&side), 0.0, "a refilled meter must drop Hungry");
}

#[test]
fn one_stack_when_it_empties_and_another_per_unit_below_zero() {
    // [REF:status_hungry]
    // "Every 36 seconds after the bar reaches zero the creature gains another
    // stack."
    let mut side = starving_side(0.0);
    advance_side_hunger(&mut side, 0.0);
    assert_eq!(hungry_stacks(&side), 1.0, "empty means one stack");
    for expected in 2..=4 {
        advance_side_hunger(&mut side, DRAIN_INTERVAL_SEC * (expected - 1) as f64);
        assert_eq!(
            hungry_stacks(&side),
            expected as f64,
            "stack {expected} should arrive one drain interval after the last"
        );
    }
}

#[test]
fn deals_half_a_percent_of_max_health_per_stack_every_three_seconds() {
    // [REF:status_hungry]
    // "Each stack deals 0.5% max HP every 3 seconds." / "A tick never
    // deals less than 1 damage."
    assert_eq!(status_tick_sec("Hungry_Status"), Some(3.0));
    let one = compute_simple_dot_damage(10_000.0, "Hungry_Status", 1.0);
    let three = compute_simple_dot_damage(10_000.0, "Hungry_Status", 3.0);
    assert!((one - 50.0).abs() < 1e-9, "1 stack on 10000 max HP: got {one}");
    assert!((three - 150.0).abs() < 1e-9, "3 stacks must scale: got {three}");
    assert_eq!(
        compute_simple_dot_damage(100.0, "Hungry_Status", 1.0),
        1.0,
        "the flat floor takes over below 200 max HP"
    );
}

#[test]
fn stops_health_regeneration_at_any_stack_count() {
    // [REF:status_hungry]
    // "Health regeneration stops entirely while Hungry is present, at any
    // stack count."
    let mut side = starving_side(0.0);
    advance_side_hunger(&mut side, 0.0);
    assert_eq!(hp_regen_multiplier_from_statuses(&side.statuses), 0.0);

    advance_side_hunger(&mut side, DRAIN_INTERVAL_SEC * 5.0);
    assert!(hungry_stacks(&side) > 1.0);
    assert_eq!(
        hp_regen_multiplier_from_statuses(&side.statuses),
        0.0,
        "more stacks cannot un-zero an already zeroed multiplier"
    );
}

#[test]
fn nothing_can_block_it() {
    // [REF:status_hungry]
    // "The damage is unblockable - no block stat or resistance reduces it."
    // The block and resist layer lives inside status application, and nothing
    // applies Hungry - the engine writes the count straight from the meter. So
    // the stack count on the side is the raw deficit, with nothing taken off.
    let mut side = starving_side(0.0);
    for interval in 0..4 {
        advance_side_hunger(&mut side, DRAIN_INTERVAL_SEC * interval as f64);
        assert_eq!(
            hungry_stacks(&side),
            starving_stacks(side.compare_hunger, side.compare_hunger_deficit),
            "after {interval} intervals the count must be the untouched deficit"
        );
    }
}

#[test]
fn a_creature_with_no_hunger_meter_never_gets_it() {
    // [REF:status_hungry]
    // "Photovore creatures have no hunger meter and never get Hungry."
    let mut side = starving_side(0.0);
    side.compare_has_hunger = false;
    advance_side_hunger(&mut side, DRAIN_INTERVAL_SEC * 10.0);
    assert_eq!(hungry_stacks(&side), 0.0, "no meter, no starving");
    assert_eq!(
        side.compare_hunger, 0.0,
        "and the meter it does not own must not move"
    );
}

#[test]
fn its_damage_actually_ticks_in_a_fight() {
    // [REF:status_hungry]
    // The damage bullet, end to end: a side whose meter starts empty must lose health
    // to the tick, not merely carry the status. The engine writes the status
    // outside the normal apply path, so its first tick has to be booked at
    // creation or nothing ever fires.
    use crate::composable::simulate_composable_matchup;
    use crate::composable::ComposableAbilityConfig;
    use crate::contracts::SimpleAbilityTimingMode;

    let mut attacker = default_combatant();
    attacker.health = 100_000.0;
    attacker.damage = 0.0;
    attacker.health_regen = 0.0;
    let defender = attacker.clone();

    let mut config = ComposableAbilityConfig {
        attacker_compare_hunger_rule: true,
        attacker_compare_appetite_base: 1.0,
        ..Default::default()
    };
    // 0 reads as "unset" and starts the meter full, so open with a sliver:
    // half a unit empties in 18 s and the rest of the fight starves.
    config.attacker_compare_starting_hunger = 0.5;

    let out = simulate_composable_matchup(
        &attacker,
        &defender,
        None,
        None,
        SimpleAbilityTimingMode::Fast,
        &config,
        120.0,
    );
    assert!(
        out.final_hp_a < out.max_hp_a,
        "an empty meter must cost health over 120 s: {} of {}",
        out.final_hp_a,
        out.max_hp_a
    );
}
