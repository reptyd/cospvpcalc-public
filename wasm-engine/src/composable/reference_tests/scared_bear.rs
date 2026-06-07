//! Reference: status_scared_bear
//!
//! Bear-plushie variant of Scared. Reduces outgoing damage by 45%
//! multiplicatively for 10 seconds (softer than plain Scared's -50%;
//! Bear formula -50 * 1.1 + 10 = -45). Catalog records polarity
//! "negative" + category "stat_debuff"; Fortify cleanse picks it up via
//! polarity. Magnitude lives in combat.rs (Scared_Bear_Status => -45.0).

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
    // [REF:status_scared_bear]
    assert!(crate::statuses::is_fortify_removable_status(
        "Scared_Bear_Status"
    ));
}

#[test]
fn reduces_outgoing_damage_by_45_percent() {
    // [REF:status_scared_bear]
    // -50 * 1.1 + 10 = -45 (softer than plain Scared's -50%). Guards the
    // stale -40% the description used to claim.
    let mut statuses: BTreeMap<String, SimpleStatusInstance> = BTreeMap::new();
    statuses.insert("Scared_Bear_Status".to_string(), instance());
    assert!(
        (crate::combat::outgoing_damage_pct_from_statuses(&statuses) - (-45.0)).abs() < 1e-9,
        "Scared (Bear) must give -45% outgoing damage",
    );
}
