//! Reference: status_satiated
//!
//! Covers every testable bullet in the "Satiated" entry. Each test body
//! must contain the [REF:status_satiated] marker so the vitest coverage gate
//! sees it - the gate reads the marker only from a file that asserts, so
//! a body carrying nothing but the marker still counts as uncovered.

use super::meter_drain_over_one_interval;

#[test]
fn stretches_the_hunger_interval_by_one_point_three() {
    // [REF:status_satiated]
    // Bullet 1: "Satiated stretches the interval between hunger units by 1.3x,
    // so hunger drains about 23% slower."
    let (hunger, _) = meter_drain_over_one_interval(&["Satiated_Status"]);
    assert!(
        (hunger - 1.0 / 1.3).abs() < 1e-9,
        "one interval must cost 1/1.3 of a unit: got {hunger}"
    );
    let slower_pct = (1.0 - hunger) * 100.0;
    assert!(
        (slower_pct - 23.0).abs() < 0.1,
        "the entry rounds that to 23% slower: got {slower_pct}%"
    );
}

#[test]
fn leaves_thirst_alone() {
    // [REF:status_satiated]
    // Bullet 2: "It does not touch thirst."
    let (_, thirst) = meter_drain_over_one_interval(&["Satiated_Status"]);
    assert!(
        (thirst - 1.0).abs() < 1e-9,
        "thirst must drain at the plain rate: got {thirst}"
    );
}
