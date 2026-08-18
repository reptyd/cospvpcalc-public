//! Reference: status_spring_water
//!
//! Covers every testable bullet in the "Spring Water" entry. Each test body
//! must contain the [REF:status_spring_water] marker so the vitest coverage
//! gate sees it - the gate reads the marker only from a file that asserts, so
//! a body carrying nothing but the marker still counts as uncovered.

use super::meter_drain_over_one_interval;

#[test]
fn stretches_the_thirst_interval_by_one_point_three() {
    // [REF:status_spring_water]
    // Bullet 1: "Spring Water stretches the interval between thirst units by
    // 1.3x, so thirst drains about 23% slower."
    let (_, thirst) = meter_drain_over_one_interval(&["Spring_Water_Status"]);
    assert!(
        (thirst - 1.0 / 1.3).abs() < 1e-9,
        "one interval must cost 1/1.3 of a unit: got {thirst}"
    );
    let slower_pct = (1.0 - thirst) * 100.0;
    assert!(
        (slower_pct - 23.0).abs() < 0.1,
        "the entry rounds that to 23% slower: got {slower_pct}%"
    );
}

#[test]
fn leaves_hunger_alone() {
    // [REF:status_spring_water]
    // Bullet 2: "It does not touch hunger."
    let (hunger, _) = meter_drain_over_one_interval(&["Spring_Water_Status"]);
    assert!(
        (hunger - 1.0).abs() < 1e-9,
        "hunger must drain at the plain rate: got {hunger}"
    );
}
