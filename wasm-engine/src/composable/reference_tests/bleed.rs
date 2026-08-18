//! Reference: status_bleed
//!
//! Covers each testable bullet in the "Bleed" entry. Each test body
//! starts with the [REF:status_bleed] marker so the vitest coverage
//! gate (src/pages/referenceCoverage.test.ts) sees it.
//!
//! Engine paths:
//! - DoT damage formula: `statuses.rs` -
//!   `compute_simple_dot_damage(_, "Bleed_Status", stacks) = 2.0 * stacks`.
//!   Flat per TICK, never scaled by the tick interval or elapsed time.
//! - Regen block: `combat.rs` -
//!   `hp_regen_multiplier_from_statuses` returns 0.0 the moment
//!   `Bleed_Status` is present in the status map.

use crate::combat::hp_regen_multiplier_from_statuses;
use crate::contracts::SimpleStatusInstance;
use crate::spec_constants::BLEED_DAMAGE_PER_STACK_PER_TICK;
use crate::statuses::compute_simple_dot_damage;
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
fn deals_two_flat_damage_per_stack_per_tick() {
    // [REF:status_bleed]
    // Bullet 1: "Bleed ticks every 3 seconds and deals 2 flat damage per
    // stack on each tick ... The 2 is per tick, not per second." The
    // damage depends only on the stack count - never on how long the tick
    // covered.
    let rate = BLEED_DAMAGE_PER_STACK_PER_TICK;
    let dmg_5 = compute_simple_dot_damage(1_000.0, "Bleed_Status", 5.0);
    assert!(
        (dmg_5 - rate * 5.0).abs() < 1e-9,
        "5 Bleed stacks must deal {} flat per tick ({rate}/stack): got {dmg_5}",
        rate * 5.0
    );
    let dmg_1 = compute_simple_dot_damage(1_000.0, "Bleed_Status", 1.0);
    assert!(
        (dmg_1 - rate).abs() < 1e-9,
        "1 Bleed stack must deal {rate} flat per tick: got {dmg_1}"
    );
}

#[test]
fn blocks_natural_health_regeneration_completely() {
    // [REF:status_bleed]
    // Bullet 2: "Bleed blocks natural health regeneration completely."
    // Engine: `hp_regen_multiplier_from_statuses` early-returns 0.0
    // when Bleed_Status is present.
    let mut statuses: BTreeMap<String, SimpleStatusInstance> = BTreeMap::new();
    statuses.insert("Bleed_Status".to_string(), instance(1.0));
    let mult = hp_regen_multiplier_from_statuses(&statuses);
    assert!(
        mult == 0.0,
        "Bleed must zero out regen multiplier: got {mult}"
    );
}

#[test]
fn stacks_increase_damage_directly() {
    // [REF:status_bleed]
    // Bullet 1: "Bleed ticks every 3 seconds and deals 2 flat damage per
    // stack on each tick." Engine: damage scales linearly in `stacks` (no diminishing
    // factor), so 10 stacks = 2x of 5 stacks.
    let dmg_5 = compute_simple_dot_damage(1_000.0, "Bleed_Status", 5.0);
    let dmg_10 = compute_simple_dot_damage(1_000.0, "Bleed_Status", 10.0);
    let ratio = dmg_10 / dmg_5;
    assert!(
        (ratio - 2.0).abs() < 1e-12,
        "10 Bleed stacks must deal exactly 2x of 5 stacks: got ratio {ratio}"
    );
}
