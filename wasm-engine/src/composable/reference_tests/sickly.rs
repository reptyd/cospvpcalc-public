//! Reference: status_sickly
//!
//! Modeled status: reduces passive health regen by 20%
//! multiplicatively while active. After Phase 5d + Item 2 the
//! Sickly regen modifier flows through the registry (-20% flat
//! healthRegenPct add_pct), so hp_regen_multiplier_from_statuses
//! returns 0.80 when only Sickly_Status is active.

use crate::combat::hp_regen_multiplier_from_statuses;
use crate::contracts::SimpleStatusInstance;
use std::collections::BTreeMap;

fn make_status() -> SimpleStatusInstance {
    SimpleStatusInstance {
        stacks: 1.0,
        next_tick_at: None,
        next_decay_at: None,
        remaining_sec: 100.0,
        stack_value_mode: None,
        lich_mark_owned_stacks: None,
        no_decay: false,
        resolved_scalars: None,
    }
}

#[test]
fn sickly_status_reduces_regen_by_twenty_percent() {
    // [REF:status_sickly]
    let mut statuses: BTreeMap<String, SimpleStatusInstance> = BTreeMap::new();
    statuses.insert("Sickly_Status".to_string(), make_status());
    let multiplier = hp_regen_multiplier_from_statuses(&statuses);
    assert!(
        (multiplier - 0.80).abs() < 1e-9,
        "Sickly_Status alone must give 0.80 regen multiplier: got {multiplier}"
    );
}

#[test]
fn registered_as_fortify_removable_negative_status() {
    // [REF:status_sickly]
    assert!(crate::statuses::is_fortify_removable_status("Sickly_Status"));
}
