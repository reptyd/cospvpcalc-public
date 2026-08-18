//! Reference: status_sickly
//!
//! Modeled status: reduces passive health regen by 20%
//! multiplicatively while active. After Phase 5d + Item 2 the
//! Sickly regen modifier flows through the registry (-20% flat
//! healthRegenPct add_pct), so hp_regen_multiplier_from_statuses
//! returns 0.80 when only Sickly_Status is active.

use crate::combat::hp_regen_multiplier_from_statuses;
use crate::contracts::SimpleStatusInstance;
use crate::spec_constants::SICKLY_REGEN_REDUCTION_PCT;
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
    let expected = 1.0 - SICKLY_REGEN_REDUCTION_PCT / 100.0;
    assert!(
        (multiplier - expected).abs() < 1e-9,
        "Sickly_Status alone must give {expected} regen multiplier: got {multiplier}"
    );
}

#[test]
fn registered_as_fortify_removable_negative_status() {
    // [REF:status_sickly]
    assert!(crate::statuses::is_fortify_removable_status("Sickly_Status"));
}

#[test]
fn sickly_is_a_persistent_do_not_heal_while_moving_status() {
    // [REF:status_sickly]
    // Sickly carries the game's DoesNotHealWhileMoving flag, so as a
    // decaying ailment it is held while moving under No Move Facetank.
    assert!(crate::statuses::is_persistent_pvp_status("Sickly_Status"));
}

#[test]
fn permanent_sickly_never_decays_but_a_decaying_one_would() {
    // [REF:status_sickly]
    // Defiled Ground applies Sickly via seed_permanent_status (no_decay,
    // next_decay_at = None), so it must not strip even after a long window.
    // A manually-armed decaying instance loses a stack on its window -
    // proving it is the permanent seeding, not the status id, that holds it.
    let mut permanent: BTreeMap<String, SimpleStatusInstance> = BTreeMap::new();
    crate::statuses::seed_permanent_status(0.0, &mut permanent, "Sickly_Status");
    crate::statuses::update_simple_status_durations_full(30.0, &mut permanent, false, None, 1.0, 1.0);
    let perm_stacks = permanent.get("Sickly_Status").map(|s| s.stacks).unwrap_or(0.0);
    assert!(
        (perm_stacks - 1.0).abs() < 1e-9,
        "permanent (Defiled Ground) Sickly must keep its stack: got {perm_stacks}"
    );

    let mut decaying: BTreeMap<String, SimpleStatusInstance> = BTreeMap::new();
    decaying.insert(
        "Sickly_Status".to_string(),
        SimpleStatusInstance {
            stacks: 5.0,
            next_tick_at: Some(6.0),
            next_decay_at: Some(3.0),
            remaining_sec: 15.0,
            stack_value_mode: None,
            lich_mark_owned_stacks: None,
            no_decay: false,
            resolved_scalars: None,
        },
    );
    crate::statuses::update_simple_status_durations_full(3.0, &mut decaying, false, None, 1.0, 1.0);
    let dec_stacks = decaying.get("Sickly_Status").map(|s| s.stacks).unwrap_or(0.0);
    assert!(dec_stacks < 5.0, "a decaying Sickly must strip a stack on its window: got {dec_stacks}");
}
