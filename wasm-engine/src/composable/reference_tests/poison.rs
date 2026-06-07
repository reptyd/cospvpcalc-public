//! Reference: status_poison
//!
//! Covers each testable bullet in the "Poison" entry. Each test body
//! starts with the [REF:status_poison] marker so the vitest coverage
//! gate (src/pages/referenceCoverage.test.ts) sees it.
//!
//! Engine paths:
//! - DoT formula: `statuses.rs:179` -
//!   `compute_simple_dot_damage(_, "Poison_Status", stacks, _) =
//!   max_hp * (0.2 + 0.05 * stacks) / 100`.
//! - 3 s tick cadence: `statuses.rs:13` returns `Some(3.0)` for
//!   `Poison_Status` from `status_tick_sec`.

use crate::statuses::{compute_simple_dot_damage, status_tick_sec};

#[test]
fn deals_damage_every_three_seconds() {
    // [REF:status_poison]
    // Bullet 1: "Poison deals damage every 3 seconds."
    let tick = status_tick_sec("Poison_Status");
    assert_eq!(
        tick,
        Some(3.0),
        "Poison_Status tick cadence must be 3 s: got {tick:?}"
    );
}

#[test]
fn damage_starts_at_zero_point_two_percent_and_increases_by_zero_point_zero_five_per_stack() {
    // [REF:status_poison]
    // Bullet 2: "Its damage starts at 0.2% max HP and increases by
    // 0.05% per stack."
    // Engine: `max_hp * (0.2 + 0.05 * stacks) / 100`.
    let max_hp = 10_000.0;
    // post-decay 0 stacks → 0.2% base only = 20 dmg.
    let base = compute_simple_dot_damage(max_hp, "Poison_Status", 0.0, 3.0);
    assert!(
        (base - 20.0).abs() < 1e-9,
        "post-decay 0 Poison stacks must deal base 0.2% maxHP (20 on 10000): got {base}"
    );
    // 1 stack → 0.2% + 0.05% = 0.25% → 25 dmg.
    let one = compute_simple_dot_damage(max_hp, "Poison_Status", 1.0, 3.0);
    assert!(
        (one - 25.0).abs() < 1e-9,
        "1 Poison stack must deal 0.25% maxHP (25 on 10000): got {one}"
    );
    // 10 stacks → 0.2% + 0.5% = 0.7% → 70 dmg.
    let ten = compute_simple_dot_damage(max_hp, "Poison_Status", 10.0, 3.0);
    assert!(
        (ten - 70.0).abs() < 1e-9,
        "10 Poison stacks must deal 0.7% maxHP (70 on 10000): got {ten}"
    );
    // Linear-in-stacks check: (ten - base) / (one - base) = 10.
    let ratio = (ten - base) / (one - base);
    assert!(
        (ratio - 10.0).abs() < 1e-9,
        "per-stack contribution must scale linearly: got delta ratio {ratio}"
    );
}
