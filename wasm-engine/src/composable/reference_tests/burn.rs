//! Reference: status_burn
//!
//! Covers each testable bullet in the "Burn" entry. Each test body
//! starts with the [REF:status_burn] marker so the vitest coverage
//! gate (src/pages/referenceCoverage.test.ts) sees it.
//!
//! Engine paths:
//! - DoT formula: `statuses.rs:180` —
//!   `compute_simple_dot_damage(_, "Burn_Status", stacks, _) =
//!   max_hp * (0.025 + 0.1 * stacks) / 100`.
//! - 3 s tick cadence: `statuses.rs:13` returns `Some(3.0)` for
//!   `Burn_Status` from `status_tick_sec`.
//! - Decay-before-damage tick order: covered by the
//!   `compare_no_move_facetank` reference tests at
//!   `composable/reference_tests/no_move_facetank.rs`.
//! - Regen reduction: `combat.rs:396-398` —
//!   `hp_regen_multiplier_from_statuses` multiplies by
//!   `(1.0 - 0.1 * stacks)` clamped to >= 0.

use crate::combat::hp_regen_multiplier_from_statuses;
use crate::contracts::SimpleStatusInstance;
use crate::statuses::{compute_simple_dot_damage, status_tick_sec};
use std::collections::BTreeMap;

fn instance(stacks: f64) -> SimpleStatusInstance {
    SimpleStatusInstance {
        stacks,
        next_tick_at: None,
        next_decay_at: None,
        remaining_sec: 100.0,
        stack_value_mode: None,
        lich_mark_owned_stacks: None,
        no_decay: false,
        resolved_scalars: None,
    }
}

#[test]
fn deals_damage_every_three_seconds() {
    // [REF:status_burn]
    // Bullet 1: "Burn deals damage every 3 seconds."
    let tick = status_tick_sec("Burn_Status");
    assert_eq!(
        tick,
        Some(3.0),
        "Burn_Status tick cadence must be 3 s: got {tick:?}"
    );
}

#[test]
fn damage_formula_base_plus_per_stack() {
    // [REF:status_burn]
    // Bullet 2: "Its damage is 0.025% max HP base plus 0.1% per
    // remaining stack at the moment of the tick."
    let max_hp = 10_000.0;
    let one = compute_simple_dot_damage(max_hp, "Burn_Status", 1.0, 3.0);
    assert!(
        (one - 12.5).abs() < 1e-9,
        "1 Burn stack must deal 0.125% maxHP (12.5 on 10000): got {one}"
    );
    let zero = compute_simple_dot_damage(max_hp, "Burn_Status", 0.0, 3.0);
    assert!(
        (zero - 2.5).abs() < 1e-9,
        "post-decay 0 Burn stacks must deal base only (0.025% maxHP = 2.5 on 10000): got {zero}"
    );
    let ten = compute_simple_dot_damage(max_hp, "Burn_Status", 10.0, 3.0);
    assert!(
        (ten - 102.5).abs() < 1e-9,
        "10 Burn stacks must deal 1.025% maxHP (102.5 on 10000): got {ten}"
    );
}

#[test]
fn one_stack_moving_versus_stationary_five_x_ratio() {
    // [REF:status_burn]
    // Bullet 4: "On a stationary target a single Burn stack decays
    // to zero before damage is calculated, so the lone tick deals
    // only the base 0.025% max HP. On a moving target [...] the same
    // single stack deals 0.025% + 0.1% = 0.125% max HP — five times
    // the stationary value at one stack."
    let max_hp = 10_000.0;
    let stationary = compute_simple_dot_damage(max_hp, "Burn_Status", 0.0, 3.0);
    let moving = compute_simple_dot_damage(max_hp, "Burn_Status", 1.0, 3.0);
    let ratio = moving / stationary;
    assert!(
        (ratio - 5.0).abs() < 1e-9,
        "1-stack moving Burn must deal 5x of stationary at one stack: got ratio {ratio} (moving={moving}, stationary={stationary})"
    );
}

#[test]
fn ten_stack_moving_versus_stationary_gap_shrinks_to_about_one_point_one() {
    // [REF:status_burn]
    // Bullet 4 (tail): "The gap shrinks as stacks grow (about 1.1x at
    // ten stacks)."
    let max_hp = 10_000.0;
    let stationary = compute_simple_dot_damage(max_hp, "Burn_Status", 9.0, 3.0);
    let moving = compute_simple_dot_damage(max_hp, "Burn_Status", 10.0, 3.0);
    let ratio = moving / stationary;
    assert!(
        (ratio - 1.1).abs() < 0.02,
        "at ~10 stacks the moving/stationary ratio must shrink to ~1.1: got ratio {ratio}"
    );
}

#[test]
fn each_stack_reduces_regen_by_ten_percent() {
    // [REF:status_burn]
    // Bullet 5: "Each Burn stack also reduces natural health
    // regeneration by 10%."
    let cases = [(1.0, 0.9), (2.0, 0.8), (5.0, 0.5), (9.0, 0.1)];
    for (stacks, expected) in cases {
        let mut statuses: BTreeMap<String, SimpleStatusInstance> = BTreeMap::new();
        statuses.insert("Burn_Status".to_string(), instance(stacks));
        let mult = hp_regen_multiplier_from_statuses(&statuses);
        assert!(
            (mult - expected).abs() < 1e-9,
            "{stacks} Burn stacks must yield {expected}x regen multiplier: got {mult}"
        );
    }
}

#[test]
fn ten_stacks_fully_blocks_regen() {
    // [REF:status_burn]
    // Bullet 6: "At 10 Burn, natural health regeneration is fully
    // blocked."
    let mut statuses: BTreeMap<String, SimpleStatusInstance> = BTreeMap::new();
    statuses.insert("Burn_Status".to_string(), instance(10.0));
    let mult = hp_regen_multiplier_from_statuses(&statuses);
    assert!(
        mult == 0.0,
        "10 Burn stacks must zero out the regen multiplier (clamped at 0.0): got {mult}"
    );
}
