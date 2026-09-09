//! Reference: status_paralyze
//!
//! Engine-only "Partial" status with polarity "negative" and
//! category "control" in the catalog. The engine recognises
//! Paralyze_Status by id for cleanse and cross-status interactions;
//! the Reference-level disable formula is not modeled yet.

#[test]
fn registered_as_fortify_removable_negative_status() {
    // [REF:status_paralyze]
    assert!(crate::statuses::is_fortify_removable_status("Paralyze_Status"));
}
