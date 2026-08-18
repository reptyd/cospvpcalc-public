//! Reference: status_ashy_lungs
//!
//! Engine-only "Partial" status with polarity "negative" in the
//! catalog. The engine recognises Ashy_Lungs by id for cleanse and
//! cross-status interactions; the Reference-level combat formula is
//! not modeled yet.

#[test]
fn registered_as_fortify_removable_negative_status() {
    // [REF:status_ashy_lungs]
    assert!(crate::statuses::is_fortify_removable_status("Ashy_Lungs"));
}
