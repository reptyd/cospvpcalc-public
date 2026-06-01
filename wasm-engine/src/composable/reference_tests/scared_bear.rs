//! Reference: status_scared_bear
//!
//! Bear-plushie variant of Scared. Reduces outgoing damage by 40%
//! multiplicatively for 10 seconds (softer than plain Scared's
//! -50%). Catalog records polarity "negative" + category
//! "stat_debuff"; Fortify cleanse picks it up via polarity.

#[test]
fn registered_as_fortify_removable_negative_status() {
    // [REF:status_scared_bear]
    assert!(crate::statuses::is_fortify_removable_status(
        "Scared_Bear_Status"
    ));
}
