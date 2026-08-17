//! Reference: compare_use_hunger_rules
//!
//! Covers each testable bullet in the "Use hunger rules" entry. Each
//! test body starts with the [REF:compare_use_hunger_rules] marker
//! so the vitest coverage gate (src/pages/referenceCoverage.test.ts)
//! sees it.
//!
//! Engine path: `wasm-engine/src/compare_hunger.rs`. Hunger and thirst run the
//! same helpers on the same appetite number, so one set of tests covers both.

use crate::compare_hunger::{
    advance_compare_hunger, disease_hunger_drain_multiplier, reflux_hunger_cost, starving_damage,
    starving_stacks, COMPARE_GOURMANDIZER_OVERFILL_DRAIN_MULTIPLIER,
    COMPARE_METER_DRAIN_UNITS_PER_SEC, COMPARE_REFLUX_HUNGER_COST_FRACTION,
};
use crate::spec_constants::{
    APPETITE_DRAIN_SEC_PER_UNIT, GOURMANDIZER_OVERFILL_DRAIN_MULTIPLIER,
    STARVING_DAMAGE_PCT_MAX_HP,
};

#[test]
fn appetite_drains_one_unit_every_thirty_six_seconds() {
    // [REF:compare_use_hunger_rules]
    // "Hunger drains by 1 appetite unit every 36 seconds." Thirst is sized by
    // the same appetite number and drains at the same rate.
    let units_per_sec = COMPARE_METER_DRAIN_UNITS_PER_SEC;
    assert!(
        (units_per_sec - 1.0 / APPETITE_DRAIN_SEC_PER_UNIT).abs() < 1e-12,
        "base drain rate must be 1/{APPETITE_DRAIN_SEC_PER_UNIT} unit per second: got {units_per_sec}"
    );
    let after = advance_compare_hunger(100.0, 100.0, APPETITE_DRAIN_SEC_PER_UNIT, 0.0, false, 1.0);
    assert!(
        (after - 99.0).abs() < 1e-9,
        "one drain interval on 100 must yield 99: got {after}"
    );
}

#[test]
fn disease_accelerates_drain() {
    // [REF:compare_use_hunger_rules]
    // "Disease drains both meters faster: each meter's seconds-per-unit
    // interval is multiplied by 0.8 - 0.015 x stacks."
    assert!(
        (disease_hunger_drain_multiplier(0.0) - 1.0).abs() < 1e-12,
        "no Disease must leave the drain alone"
    );
    let with_1 = disease_hunger_drain_multiplier(1.0);
    let with_5 = disease_hunger_drain_multiplier(5.0);
    assert!(
        (with_1 - 1.0 / (0.8 - 0.015)).abs() < 1e-12,
        "1 Disease stack must invert the 0.785 interval: got {with_1}"
    );
    assert!(
        (with_5 - 1.0 / (0.8 - 5.0 * 0.015)).abs() < 1e-12,
        "5 Disease stacks must invert the 0.725 interval: got {with_5}"
    );
    assert!(
        (with_1 - 1.27).abs() < 0.01 && (with_5 - 1.38).abs() < 0.01,
        "the entry rounds these to 1.27x and 1.38x: got {with_1} and {with_5}"
    );
}

#[test]
fn gourmandizer_overfill_drains_twice_as_fast_as_a_step() {
    // [REF:compare_use_hunger_rules]
    // "Gourmandizer drains an overfilled bar 2x faster, at any fill above 100%
    // rather than in proportion to it."
    let multiplier = COMPARE_GOURMANDIZER_OVERFILL_DRAIN_MULTIPLIER;
    assert!(
        (multiplier - GOURMANDIZER_OVERFILL_DRAIN_MULTIPLIER).abs() < 1e-12,
        "overfill multiplier must be {GOURMANDIZER_OVERFILL_DRAIN_MULTIPLIER}: got {multiplier}"
    );
    let step = APPETITE_DRAIN_SEC_PER_UNIT;
    let with_overfill = advance_compare_hunger(125.0, 100.0, step, 0.0, true, 1.0);
    let no_overfill = advance_compare_hunger(125.0, 100.0, step, 0.0, false, 1.0);
    assert!(
        (with_overfill - 123.0).abs() < 1e-9,
        "one interval of overfill drain on 125 must remove 2 units: got {with_overfill}"
    );
    assert!(
        (no_overfill - 124.0).abs() < 1e-9,
        "one interval of plain drain on 125 must remove 1 unit: got {no_overfill}"
    );
    // A step, not a ramp: every fill that stays overfilled for the whole
    // interval pays the same doubled rate, however close to 100 it sits.
    let barely = advance_compare_hunger(103.0, 100.0, step, 0.0, true, 1.0);
    assert!(
        (barely - 101.0).abs() < 1e-9,
        "barely overfilled must pay the same doubled rate: got {barely}"
    );
    // Only a fill that runs out of overfill mid-interval pays less, and it
    // pays exactly for the part of the interval it was still overfilled.
    let crossing = advance_compare_hunger(101.0, 100.0, step, 0.0, true, 1.0);
    assert!(
        (crossing - 99.5).abs() < 1e-9,
        "1 unit of overfill burns in half an interval, then the plain rate takes over: got {crossing}"
    );
}

#[test]
fn an_empty_meter_gathers_a_stack_every_drain_interval() {
    // [REF:compare_use_hunger_rules]
    // "Every 36 seconds after a bar reaches zero the creature gains another
    // stack of Hungry or Thirsty. Anything that drains the bar faster brings
    // the next stack sooner."
    assert_eq!(starving_stacks(0.5, 0.0), 0.0, "a meter with anything left is fine");
    assert_eq!(starving_stacks(0.0, 0.0), 1.0);
    assert_eq!(starving_stacks(0.0, 1.0), 2.0);
    assert_eq!(starving_stacks(0.0, 2.0), 3.0);

    // The bar itself stays at zero the whole way down; only the deficit moves.
    let mut side = crate::composable::side::CombatSide::new(
        &crate::composable::reference_tests::default_combatant(),
        None,
    );
    side.compare_hunger_rule_enabled = true;
    side.compare_appetite_base = 100.0;
    side.compare_hunger = 0.0;
    side.compare_thirst = 100.0;
    for expected in 1..=3 {
        crate::composable::status_helpers::advance_side_hunger(
            &mut side,
            APPETITE_DRAIN_SEC_PER_UNIT * (expected - 1) as f64,
        );
        assert_eq!(
            starving_stacks(side.compare_hunger, side.compare_hunger_deficit),
            expected as f64,
            "stack {expected} should arrive after {} drain intervals",
            expected - 1
        );
        assert_eq!(side.compare_hunger, 0.0, "an empty bar must not read below zero");
    }
}

#[test]
fn starving_deals_half_a_percent_of_max_health_per_stack() {
    // [REF:compare_use_hunger_rules]
    // "Hungry and Thirsty each deal 0.5% of max health per stack every 3
    // seconds, and neither tick deals less than 1 damage."
    let per_stack = 10_000.0 * STARVING_DAMAGE_PCT_MAX_HP / 100.0;
    assert!((starving_damage(10_000.0, 1.0) - per_stack).abs() < 1e-9);
    assert!((starving_damage(10_000.0, 4.0) - per_stack * 4.0).abs() < 1e-9);
    assert_eq!(starving_damage(10_000.0, 0.0), 0.0, "a full meter deals nothing");
    assert_eq!(
        starving_damage(50.0, 1.0),
        1.0,
        "the flat floor takes over on a small health pool"
    );
}

#[test]
fn reflux_costs_twenty_five_percent_of_appetite_base() {
    // [REF:compare_use_hunger_rules]
    // "Reflux costs 25 percentage points of the full appetite meter, and
    // cannot fire below that cost."
    let fraction = COMPARE_REFLUX_HUNGER_COST_FRACTION;
    assert!(
        (fraction - 0.25).abs() < 1e-12,
        "Reflux cost fraction must be 0.25: got {fraction}"
    );
    let cost_100 = reflux_hunger_cost(100.0);
    let cost_200 = reflux_hunger_cost(200.0);
    assert!(
        (cost_100 - 25.0).abs() < 1e-12,
        "Reflux cost on 100 base must be 25: got {cost_100}"
    );
    assert!(
        (cost_200 - 50.0).abs() < 1e-12,
        "Reflux cost on 200 base must be 50: got {cost_200}"
    );
}

#[test]
fn a_full_bar_costs_the_fight_nothing() {
    // [REF:compare_use_hunger_rules]
    // "Both meters run for the whole fight, and the only setting is how full
    // each one starts."
    //
    // Running them by default only holds if a full bar is inert over a real
    // fight, which is what makes the setting safe to leave alone: the smallest
    // appetite in the game is 40 units and the longest fight drains 480/36 =
    // 13.3, so nothing starves and the result is the same byte for byte.
    use crate::composable::simulate_composable_matchup;
    use crate::composable::ComposableAbilityConfig;
    use crate::contracts::SimpleAbilityTimingMode;
    use crate::composable::reference_tests::default_combatant;

    let mut attacker = default_combatant();
    attacker.health = 5_000.0;
    attacker.health_regen = 5.0;
    let defender = attacker.clone();

    let mut with_meters = ComposableAbilityConfig {
        attacker_compare_hunger_rule: true,
        defender_compare_hunger_rule: true,
        ..Default::default()
    };
    with_meters.attacker_compare_appetite_base = 40.0;
    with_meters.defender_compare_appetite_base = 40.0;

    let off = simulate_composable_matchup(
        &attacker, &defender, None, None,
        SimpleAbilityTimingMode::Fast, &ComposableAbilityConfig::default(), 480.0,
    );
    let on = simulate_composable_matchup(
        &attacker, &defender, None, None,
        SimpleAbilityTimingMode::Fast, &with_meters, 480.0,
    );
    assert_eq!(on.winner, off.winner, "a full bar must not change the winner");
    assert_eq!(
        on.final_hp_a, off.final_hp_a,
        "a full bar must not change the health left"
    );
    assert_eq!(on.final_hp_b, off.final_hp_b);
    assert_eq!(on.ttk_a_to_b, off.ttk_a_to_b, "nor the time to kill");
}

#[test]
fn reflux_spends_from_the_meter_at_the_creatures_own_appetite() {
    // [REF:compare_use_hunger_rules]
    // Bullet 12, against a real appetite rather than the 100-unit default: the
    // cost is a quarter of the bar, so a bigger creature pays more units for
    // the same quarter.
    use crate::composable::reference_tests::default_combatant;
    use crate::composable::{simulate_composable_matchup, ComposableAbilityConfig};
    use crate::contracts::SimpleAbilityTimingMode;

    let mut attacker = default_combatant();
    attacker.health = 50_000.0;
    let defender = attacker.clone();

    // Appetite 200: a cast costs 50 units, so three casts need 150 of the bar.
    let mut plenty = ComposableAbilityConfig {
        attacker_reflux: true,
        attacker_compare_hunger_rule: true,
        ..Default::default()
    };
    plenty.attacker_compare_appetite_base = 200.0;

    // Same fight, but the bar opens with less than one cast in it.
    let mut starved = plenty.clone();
    starved.attacker_compare_starting_hunger = 10.0;

    let rich = simulate_composable_matchup(
        &attacker, &defender, None, None,
        SimpleAbilityTimingMode::Ideal, &plenty, 300.0,
    );
    let poor = simulate_composable_matchup(
        &attacker, &defender, None, None,
        SimpleAbilityTimingMode::Ideal, &starved, 300.0,
    );
    assert!(
        rich.damage_dealt_a > poor.damage_dealt_a,
        "a full bar must buy Reflux casts a near-empty one cannot: full={}, empty={}",
        rich.damage_dealt_a,
        poor.damage_dealt_a
    );
}
