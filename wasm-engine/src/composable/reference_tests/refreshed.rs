//! Reference: compare_refreshed, status_refreshed
//!
//! After Phase 3 migration the Refreshed Compare buff toggle pushes a
//! `Refreshed_Status` init status (remaining_sec=180) on the TS side;
//! the Rust regen tick reads it via `hp_regen_multiplier_from_statuses`
//! (combat.rs) and applies a +5% multiplicative bonus while present.

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
fn refreshed_status_boosts_regen_by_five_percent() {
    // [REF:compare_refreshed]
    // [REF:status_refreshed]
    let mut statuses: BTreeMap<String, SimpleStatusInstance> = BTreeMap::new();
    statuses.insert("Refreshed_Status".to_string(), make_status(180.0));
    let multiplier = hp_regen_multiplier_from_statuses(&statuses);
    assert!(
        (multiplier - 1.05).abs() < 1e-9,
        "Refreshed_Status alone must give 1.05 regen multiplier: got {multiplier}"
    );
}

#[test]
fn clean_water_and_refreshed_stack_multiplicatively() {
    // [REF:compare_refreshed]
    // [REF:status_refreshed]
    // The two temp-buff statuses are independent: 1.20 * 1.05 = 1.26.
    let mut statuses: BTreeMap<String, SimpleStatusInstance> = BTreeMap::new();
    statuses.insert("Clean_Water_Status".to_string(), make_status(180.0));
    statuses.insert("Refreshed_Status".to_string(), make_status(180.0));
    let multiplier = hp_regen_multiplier_from_statuses(&statuses);
    let expected = 1.20 * 1.05;
    assert!(
        (multiplier - expected).abs() < 1e-9,
        "Clean Water + Refreshed must give {expected} regen multiplier: got {multiplier}"
    );
}
