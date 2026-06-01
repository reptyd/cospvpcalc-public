//! Reference: status_muddy
//!
//! Muddy_Status is applied by the Cloud Breath path, the Mud Pile
//! Compare rule, and (after Phase 3) the Muddy buff toggle. The Rust
//! regen tick reads the status via `hp_regen_multiplier_from_statuses`
//! (combat.rs) and applies a +25% multiplicative bonus while present.

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
fn muddy_status_boosts_regen_by_twenty_five_percent() {
    // [REF:status_muddy]
    let mut statuses: BTreeMap<String, SimpleStatusInstance> = BTreeMap::new();
    statuses.insert("Muddy_Status".to_string(), make_status(90.0));
    let multiplier = hp_regen_multiplier_from_statuses(&statuses);
    assert!(
        (multiplier - 1.25).abs() < 1e-9,
        "Muddy_Status alone must give 1.25 regen multiplier: got {multiplier}"
    );
}

#[test]
fn muddy_stacks_multiplicatively_with_clean_water() {
    // [REF:status_muddy]
    // Muddy (+25%) and Clean Water (+20%) are independent multipliers:
    // 1.25 * 1.20 = 1.50.
    let mut statuses: BTreeMap<String, SimpleStatusInstance> = BTreeMap::new();
    statuses.insert("Muddy_Status".to_string(), make_status(90.0));
    statuses.insert("Clean_Water_Status".to_string(), make_status(180.0));
    let multiplier = hp_regen_multiplier_from_statuses(&statuses);
    let expected = 1.25 * 1.20;
    assert!(
        (multiplier - expected).abs() < 1e-9,
        "Muddy + Clean Water must give {expected} regen multiplier: got {multiplier}"
    );
}
