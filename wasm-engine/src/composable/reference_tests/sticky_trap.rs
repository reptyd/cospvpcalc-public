//! Reference: ability_sticky_trap, status_sticky_trap
//!
//! Two related Reference entries: the ability (out-of-model) and
//! the engine status it would apply. The Rust engine has no
//! sticky_trap ability path; the Sticky_Trap_Status id is
//! recognised for cleanse / cross-status interactions and the
//! catalog records it as polarity "negative" + category "control"
//! so Fortify picks it up via the registry path.

#[test]
fn status_is_fortify_removable_negative() {
    // [REF:status_sticky_trap]
    assert!(crate::statuses::is_fortify_removable_status(
        "Sticky_Trap_Status"
    ));
}
