//! Reference: status_scared
//!
//! Modeled status applied by the Compare buff toggle (and other
//! ability paths). Multiplicatively reduces outgoing damage by 50%
//! for 10 seconds. Catalog records polarity "negative" + category
//! "stat_debuff" with the damage modifier in machine-readable form;
//! Fortify cleanse picks it up via polarity (Phase 5c).

#[test]
fn registered_as_fortify_removable_negative_status() {
    // [REF:status_scared]
    assert!(crate::statuses::is_fortify_removable_status("Scared_Status"));
}
