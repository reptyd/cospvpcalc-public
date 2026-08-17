//! Reference: status_scared
//!
//! Modeled status applied by the Compare buff toggle (and other ability
//! paths). Multiplicatively reduces outgoing damage by 50% for 10
//! seconds. Catalog records polarity "negative" + category "stat_debuff"
//! with the damage modifier in machine-readable form; Fortify cleanse
//! picks it up via polarity. Magnitude lives in combat.rs
//! (Scared_Status => -50.0); duration in the registry (defaultDurationSec=10).

use crate::contracts::SimpleStatusInstance;
use crate::spec_constants::{SCARED_MAX_STACKS, SCARED_DURATION_SEC, SCARED_OUTGOING_DAMAGE_REDUCTION_PCT};
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
    // Bullet 1: "Scared reduces outgoing melee damage by 50% multiplicatively
    // while active."
    let mut statuses: BTreeMap<String, SimpleStatusInstance> = BTreeMap::new();
    statuses.insert("Scared_Status".to_string(), instance());
    assert!(
        (crate::combat::outgoing_damage_multiplier_from_statuses(&statuses)
            - (1.0 - SCARED_OUTGOING_DAMAGE_REDUCTION_PCT / 100.0))
            .abs()
            < 1e-9,
        "Scared must give -{SCARED_OUTGOING_DAMAGE_REDUCTION_PCT}% outgoing damage",
    );
}

#[test]
fn lasts_ten_seconds_as_ten_one_second_stacks() {
    // [REF:status_scared]
    // The emote grants ten stacks that come off one a second, so the window
    // is the stack count and not a single long instance. The magnitude is
    // flat either way - `outgoing_damage_multiplier_from_statuses` reads the
    // id, never the count.
    let mut slot: Option<crate::contracts::SimpleStatusInstance> = None;
    crate::statuses::apply_simple_status(0.0, "Scared_Status", SCARED_MAX_STACKS, &mut slot);
    let seeded = slot.expect("the emote seeds Scared");
    assert_eq!(seeded.stacks, SCARED_MAX_STACKS);
    assert!((seeded.remaining_sec - SCARED_DURATION_SEC).abs() < 1e-9);
    assert_eq!(crate::statuses::status_decay_sec("Scared_Status"), 1.0);
}
