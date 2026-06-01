//! Reference: status_aftershock
//!
//! Engine-only "Partial" status with polarity "negative" in the
//! catalog. The engine recognises Aftershock by id for cleanse and
//! cross-status interactions; the Reference-level combat formula is
//! not modeled yet. After Item 2 the catalog drives Fortify cleanse
//! polarity (Phase 5c) and no hardcoded fallback list remains.

#[test]
fn registered_as_fortify_removable_negative_status() {
    // [REF:status_aftershock]
    assert!(crate::statuses::is_fortify_removable_status("Aftershock"));
}
