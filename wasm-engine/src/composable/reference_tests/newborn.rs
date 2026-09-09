//! Reference: status_newborn
//!
//! Covers every testable bullet in the "Newborn" entry. Each test body
//! must contain the [REF:status_newborn] marker so the vitest coverage gate
//! sees it - the gate reads the marker only from a file that asserts, so
//! a body carrying nothing but the marker still counts as uncovered.

use super::meter_drain_over_one_interval;

#[test]
fn raises_health_regeneration_by_half() {
    // [REF:status_newborn]
    // Bullet 1: "Newborn raises passive health regeneration by 50%."
    assert_eq!(
        crate::effects_registry::regen_modifier_pct("Newborn_Status"),
        Some(50.0)
    );
}

#[test]
fn stretches_both_intervals_by_one_and_a_quarter() {
    // [REF:status_newborn]
    // Bullet 2: "It stretches both drain intervals by 1.25x, so hunger and
    // thirst drain about 20% slower."
    let (hunger, thirst) = meter_drain_over_one_interval(&["Newborn_Status"]);
    for (label, drained) in [("hunger", hunger), ("thirst", thirst)] {
        assert!(
            (drained - 1.0 / 1.25).abs() < 1e-9,
            "{label} must cost 1/1.25 of a unit per interval: got {drained}"
        );
        let slower_pct = (1.0 - drained) * 100.0;
        assert!(
            (slower_pct - 20.0).abs() < 0.1,
            "the entry rounds that to 20% slower: got {slower_pct}%"
        );
    }
}
