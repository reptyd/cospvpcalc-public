//! Reference: status_broken_legs
//!
//! Engine-only "Partial" status with polarity "negative" in the
//! catalog. Distinct from Broken Bones (status_broken_bones) - the
//! engine has separate ids. Reference-level combat formula is not
//! modeled yet.

#[test]
fn registered_as_fortify_removable_negative_status() {
    // [REF:status_broken_legs]
    assert!(crate::statuses::is_fortify_removable_status("Broken_Legs_Status"));
}
