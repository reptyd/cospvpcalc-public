//! Reference: status_bleed
//!
//! Covers each testable bullet in the "Bleed" entry. Each test body
//! starts with the [REF:status_bleed] marker so the vitest coverage
//! gate (src/pages/referenceCoverage.test.ts) sees it.
//!
//! Engine paths:
//! - DoT damage formula: `statuses.rs:182` —
//!   `compute_simple_dot_damage(_, "Bleed_Status", stacks, tick_sec) =
//!   2.0 * stacks * tick_sec`.
//! - Regen block: `combat.rs:391` —
//!   `hp_regen_multiplier_from_statuses` returns 0.0 the moment
//!   `Bleed_Status` is present in the status map.

use crate::combat::hp_regen_multiplier_from_statuses;
use crate::contracts::SimpleStatusInstance;
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
fn deals_two_damage_per_stack_per_second() {
    // [REF:status_bleed]
    // Bullet 1: "Bleed deals 2 damage per stack per second while it
    // is active."
    // Engine formula: `2.0 * stacks * tick_sec`. With tick_sec=3 and
    // stacks=5, the per-tick damage = 30 (= 2 * 5 * 3).
    let dmg_3s_5_stacks = compute_simple_dot_damage(1_000.0, "Bleed_Status", 5.0, 3.0);
    assert!(
        (dmg_3s_5_stacks - 30.0).abs() < 1e-9,
        "5 Bleed stacks over a 3 s tick must deal 30 damage (2/stack/sec): got {dmg_3s_5_stacks}"
    );
    // Per-second rate: 1 stack over 1s tick → 2 damage.
    let dmg_1s_1_stack = compute_simple_dot_damage(1_000.0, "Bleed_Status", 1.0, 1.0);
    assert!(
        (dmg_1s_1_stack - 2.0).abs() < 1e-9,
        "1 Bleed stack over a 1 s tick must deal 2 damage: got {dmg_1s_1_stack}"
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
    // Bullet 3: "Bleed stacks increase the damage directly."
    // Engine: damage scales linearly in `stacks` (no diminishing
    // factor), so 10 stacks = 2x of 5 stacks at any tick interval.
    let dmg_5 = compute_simple_dot_damage(1_000.0, "Bleed_Status", 5.0, 3.0);
    let dmg_10 = compute_simple_dot_damage(1_000.0, "Bleed_Status", 10.0, 3.0);
    let ratio = dmg_10 / dmg_5;
    assert!(
        (ratio - 2.0).abs() < 1e-12,
        "10 Bleed stacks must deal exactly 2x of 5 stacks: got ratio {ratio}"
    );
}
