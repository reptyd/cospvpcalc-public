//! Reference: compare_use_hunger_rules
//!
//! Covers each testable bullet in the "Use hunger rules" entry. Each
//! test body starts with the [REF:compare_use_hunger_rules] marker
//! so the vitest coverage gate (src/pages/referenceCoverage.test.ts)
//! sees it.
//!
//! Engine path: `wasm-engine/src/compare_hunger.rs`. The toggle
//! itself (`attacker_compare_hunger_rule` flag) is a simple gate that
//! enables the per-tick `advance_compare_hunger` call. The numeric
//! bullets each map to a helper:
//! - 1 unit / 30 s base drain → `COMPARE_HUNGER_DRAIN_UNITS_PER_SEC = 1/30`.
//! - Disease acceleration → `disease_hunger_drain_multiplier`.
//! - Gourmandizer overfill 1.5x → `COMPARE_GOURMANDIZER_OVERFILL_DRAIN_MULTIPLIER`.
//! - Reflux 25% cost → `reflux_hunger_cost`.

use crate::compare_hunger::{
    advance_compare_hunger, disease_hunger_drain_multiplier, reflux_hunger_cost,
    COMPARE_GOURMANDIZER_OVERFILL_DRAIN_MULTIPLIER, COMPARE_HUNGER_DRAIN_UNITS_PER_SEC,
    COMPARE_REFLUX_HUNGER_COST_FRACTION,
};

#[test]
fn appetite_drains_one_unit_every_thirty_seconds() {
    // [REF:compare_use_hunger_rules]
    // Bullet 2: "Appetite drains by 1 unit every 30 seconds."
    let units_per_sec = COMPARE_HUNGER_DRAIN_UNITS_PER_SEC;
    assert!(
        (units_per_sec - 1.0 / 30.0).abs() < 1e-12,
        "base drain rate must be 1/30 unit per second: got {units_per_sec}"
    );
    // Sanity via the integrator: 30 s of base drain at 100 hunger /
    // 100 base must remove exactly 1 unit (no Disease, no overfill).
    let after = advance_compare_hunger(100.0, 100.0, 30.0, 0.0, false, 1.0);
    assert!(
        (after - 99.0).abs() < 1e-9,
        "30 s of base drain on 100 hunger must yield 99: got {after}"
    );
}

#[test]
fn disease_accelerates_drain() {
    // [REF:compare_use_hunger_rules]
    // Bullet 3: "Disease makes appetite drain faster."
    // Engine: `disease_hunger_drain_multiplier(stacks) = 1.15 + stacks * 0.015`.
    let baseline = disease_hunger_drain_multiplier(0.0);
    let with_5 = disease_hunger_drain_multiplier(5.0);
    let with_20 = disease_hunger_drain_multiplier(20.0);
    assert!(
        (baseline - 1.0).abs() < 1e-12,
        "0 Disease stacks must yield 1.0x drain (no acceleration): got {baseline}"
    );
    assert!(
        (with_5 - 1.225).abs() < 1e-12,
        "5 Disease stacks must yield 1.225x drain (1.15 + 5*0.015): got {with_5}"
    );
    assert!(
        with_20 > with_5,
        "more Disease stacks must accelerate drain further: 20={with_20} vs 5={with_5}"
    );
}

#[test]
fn gourmandizer_overfill_drains_one_point_five_times_faster() {
    // [REF:compare_use_hunger_rules]
    // Bullet 4: "Gourmandizer overfill above 100% drains 1.5x faster."
    let multiplier = COMPARE_GOURMANDIZER_OVERFILL_DRAIN_MULTIPLIER;
    assert!(
        (multiplier - 1.5).abs() < 1e-12,
        "overfill multiplier constant must be 1.5: got {multiplier}"
    );
    // Sanity via the integrator: 30 s drain on 125 hunger / 100 base
    // with overfill enabled must remove 1.5 units (vs 1.0 without).
    let with_overfill = advance_compare_hunger(125.0, 100.0, 30.0, 0.0, true, 1.0);
    let no_overfill = advance_compare_hunger(125.0, 100.0, 30.0, 0.0, false, 1.0);
    assert!(
        (with_overfill - (125.0 - 1.5)).abs() < 1e-9,
        "30 s overfill drain on 125 must remove 1.5 units → 123.5: got {with_overfill}"
    );
    assert!(
        (no_overfill - 124.0).abs() < 1e-9,
        "30 s base drain on 125 (no overfill) must remove 1.0 unit → 124.0: got {no_overfill}"
    );
}

#[test]
fn reflux_costs_twenty_five_percent_of_appetite_base() {
    // [REF:compare_use_hunger_rules]
    // Bullet 5: "Reflux spends 25 percentage points of the full
    // appetite meter on cast start and cannot start below that cost."
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
