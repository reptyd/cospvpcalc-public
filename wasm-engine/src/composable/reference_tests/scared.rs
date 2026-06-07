//! Reference: status_scared
//!
//! Modeled status applied by the Compare buff toggle (and other ability
//! paths). Multiplicatively reduces outgoing damage by 50% for 10
//! seconds. Catalog records polarity "negative" + category "stat_debuff"
//! with the damage modifier in machine-readable form; Fortify cleanse
//! picks it up via polarity. Magnitude lives in combat.rs
//! (Scared_Status => -50.0); duration in the registry (defaultDurationSec=10).

use crate::contracts::SimpleStatusInstance;
use std::collections::BTreeMap;

fn instance() -> SimpleStatusInstance {
    SimpleStatusInstance {
        stacks: 1.0,
        next_tick_at: None,
        next_decay_at: None,
        remaining_sec: 10.0,
        stack_value_mode: None,
        lich_mark_owned_stacks: None,
        no_decay: false,
        resolved_scalars: None,
    }
}

#[test]
fn registered_as_fortify_removable_negative_status() {
    // [REF:status_scared]
    assert!(crate::statuses::is_fortify_removable_status("Scared_Status"));
}

#[test]
fn reduces_outgoing_damage_by_fifty_percent() {
    // [REF:status_scared]
    // Bullet: "Scared reduces outgoing melee damage by 50% multiplicatively."
    let mut statuses: BTreeMap<String, SimpleStatusInstance> = BTreeMap::new();
    statuses.insert("Scared_Status".to_string(), instance());
    assert!(
        (crate::combat::outgoing_damage_pct_from_statuses(&statuses) - (-50.0)).abs() < 1e-9,
        "Scared must give -50% outgoing damage",
    );
}

#[test]
fn lasts_ten_seconds_not_the_three_second_default() {
    // [REF:status_scared]
    // Default duration is 10 seconds (catalog defaultDurationSec=10).
    assert_eq!(crate::statuses::status_decay_sec("Scared_Status"), 10.0);
}
