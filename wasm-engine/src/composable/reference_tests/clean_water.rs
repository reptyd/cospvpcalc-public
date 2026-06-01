//! Reference: compare_clean_water, status_clean_water
//!
//! After Phase 3 migration the Clean Water Compare buff toggle pushes
//! a `Clean_Water_Status` init status (remaining_sec=180) on the TS
//! side; the Rust regen tick reads it via
//! `hp_regen_multiplier_from_statuses` (combat.rs) and applies a
//! +20% multiplicative bonus while present.

use crate::combat::hp_regen_multiplier_from_statuses;
use crate::contracts::SimpleStatusInstance;
use std::collections::BTreeMap;

fn make_status(remaining_sec: f64) -> SimpleStatusInstance {
    SimpleStatusInstance {
        stacks: 1.0,
        next_tick_at: None,
        next_decay_at: None,
        remaining_sec,
        stack_value_mode: None,
        lich_mark_owned_stacks: None,
        no_decay: false,
        resolved_scalars: None,
    }
}

#[test]
fn clean_water_status_boosts_regen_by_twenty_percent() {
    // [REF:compare_clean_water]
    // [REF:status_clean_water]
    let mut statuses: BTreeMap<String, SimpleStatusInstance> = BTreeMap::new();
    statuses.insert("Clean_Water_Status".to_string(), make_status(180.0));
    let multiplier = hp_regen_multiplier_from_statuses(&statuses);
    assert!(
        (multiplier - 1.20).abs() < 1e-9,
        "Clean_Water_Status alone must give 1.20 regen multiplier: got {multiplier}"
    );
}

#[test]
fn no_clean_water_status_means_no_clean_water_bonus() {
    // [REF:compare_clean_water]
    // [REF:status_clean_water]
    let statuses: BTreeMap<String, SimpleStatusInstance> = BTreeMap::new();
    let multiplier = hp_regen_multiplier_from_statuses(&statuses);
    assert!(
        (multiplier - 1.0).abs() < 1e-9,
        "Empty statuses must give 1.0 regen multiplier: got {multiplier}"
    );
}
