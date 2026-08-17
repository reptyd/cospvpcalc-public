//! Reference: compare_aggressive / status_aggressive / status_aggressive_bear
//!
//! The Aggressive emote is a positive Compare buff: +25% outgoing melee
//! damage for 10 seconds (Bear-plushie variant +37.5%). The Compare
//! toggle injects the starting status in TS
//! (`src/engine/compareBuffRuntime.ts`); the Rust engine reads the flat
//! damage modifier from `combat::outgoing_damage_multiplier_from_statuses` and
//! the 10-second duration + positive polarity from the effects registry
//! (catalog row in `statusCatalog.ts`, codegen'd into `effects_registry.rs`).
//!
//! Regression guard: before the catalog rows existed, `Aggressive_Status`
//! had no registry entry, so `status_decay_sec` fell through to the
//! 3-second engine default (`unwrap_or(3.0)`) and
//! `is_fortify_removable_status` mis-read its polarity. These tests pin
//! the 10-second duration, the positive polarity, and the magnitude so
//! the drift can't return.

use crate::contracts::SimpleStatusInstance;
use crate::spec_constants::{AGGRESSIVE_MAX_STACKS, AGGRESSIVE_DURATION_SEC, AGGRESSIVE_OUTGOING_DAMAGE_INCREASE_PCT};
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
fn lasts_ten_seconds_as_ten_one_second_stacks() {
    // [REF:status_aggressive] [REF:status_aggressive_bear]
    // The emote grants ten stacks a second apart. Ten of them is the
    // ten-second window the entry states, and the per-stack second is what
    // keeps the engine off its 3.0 fallback for an unregistered status -
    // the bug the catalog row was added to fix.
    for id in ["Aggressive_Status", "Aggressive_Bear_Status"] {
        assert_eq!(crate::statuses::status_decay_sec(id), 1.0);
        let mut slot: Option<SimpleStatusInstance> = None;
        crate::statuses::apply_simple_status(0.0, id, AGGRESSIVE_MAX_STACKS, &mut slot);
        let seeded = slot.expect("the emote seeds the status");
        assert_eq!(seeded.stacks, AGGRESSIVE_MAX_STACKS);
        assert!((seeded.remaining_sec - AGGRESSIVE_DURATION_SEC).abs() < 1e-9);
    }
}

#[test]
fn classified_as_positive_buff_fortify_does_not_cleanse() {
    // [REF:status_aggressive]
    assert_eq!(
        crate::effects_registry::polarity("Aggressive_Status"),
        Some(crate::effects_registry::Polarity::Positive),
    );
    assert_eq!(
        crate::effects_registry::category("Aggressive_Status"),
        Some(crate::effects_registry::Category::StatBuff),
    );
    // Positive polarity => Fortify must NOT strip the buff (it only
    // cleanses negatives).
    assert!(!crate::statuses::is_fortify_removable_status("Aggressive_Status"));
    assert!(!crate::statuses::is_fortify_removable_status(
        "Aggressive_Bear_Status"
    ));
}

#[test]
fn outgoing_damage_modifier_is_plus_25_and_bear_plus_37_5() {
    // [REF:compare_aggressive]
    let mut base: BTreeMap<String, SimpleStatusInstance> = BTreeMap::new();
    base.insert("Aggressive_Status".to_string(), instance());
    assert!(
        (crate::combat::outgoing_damage_multiplier_from_statuses(&base)
            - (1.0 + AGGRESSIVE_OUTGOING_DAMAGE_INCREASE_PCT / 100.0))
            .abs()
            < 1e-9,
        "Aggressive must give +{AGGRESSIVE_OUTGOING_DAMAGE_INCREASE_PCT}% outgoing damage",
    );

    // Bear variant: 25 * 1.1 + 10 = 37.5.
    let mut bear: BTreeMap<String, SimpleStatusInstance> = BTreeMap::new();
    bear.insert("Aggressive_Bear_Status".to_string(), instance());
    let bear_expected = AGGRESSIVE_OUTGOING_DAMAGE_INCREASE_PCT * 1.1 + 10.0;
    assert!(
        (crate::combat::outgoing_damage_multiplier_from_statuses(&bear)
            - (1.0 + bear_expected / 100.0))
            .abs()
            < 1e-9,
        "Aggressive (Bear) must give +{bear_expected}% outgoing damage (25 * 1.1 + 10)",
    );
}

fn aggressive_at_decay_10(status_id: &str) -> BTreeMap<String, SimpleStatusInstance> {
    let mut m = BTreeMap::new();
    m.insert(
        status_id.to_string(),
        SimpleStatusInstance {
            stacks: 1.0,
            next_tick_at: None,
            // Seeded to expire on its 10-second decay tick (the Compare toggle
            // injects remainingSec=10 in compareBuffRuntime.ts).
            next_decay_at: Some(10.0),
            remaining_sec: 10.0,
            stack_value_mode: None,
            lich_mark_owned_stacks: None,
            no_decay: false,
            resolved_scalars: None,
        },
    );
    m
}

#[test]
fn persists_whole_fight_while_stationary_decays_when_moving() {
    // [REF:status_aggressive] [REF:compare_no_move_facetank]
    // "Stacks do not decrease until the player moves." While stationary
    // (No Move Facetank enabled => effective block_persistent_decay == false)
    // the buff is held for the whole fight; while moving (facetank off =>
    // block == true) it expires on its 10-second decay tick as before.
    let mut stationary = aggressive_at_decay_10("Aggressive_Status");
    crate::statuses::update_simple_status_durations_full(15.0, &mut stationary, false, None, 1.0, 1.0);
    assert!(
        stationary.contains_key("Aggressive_Status"),
        "Aggressive must persist while stationary (No Move Facetank enabled)",
    );

    let mut moving = aggressive_at_decay_10("Aggressive_Status");
    crate::statuses::update_simple_status_durations_full(15.0, &mut moving, true, None, 1.0, 1.0);
    assert!(
        !moving.contains_key("Aggressive_Status"),
        "Aggressive must expire at its 10-second window while moving (facetank off)",
    );

    // [REF:status_aggressive_bear] Bear variant follows the same rule.
    let mut bear_stationary = aggressive_at_decay_10("Aggressive_Bear_Status");
    crate::statuses::update_simple_status_durations_full(15.0, &mut bear_stationary, false, None, 1.0, 1.0);
    assert!(
        bear_stationary.contains_key("Aggressive_Bear_Status"),
        "Aggressive (Bear) must persist while stationary",
    );
    let mut bear_moving = aggressive_at_decay_10("Aggressive_Bear_Status");
    crate::statuses::update_simple_status_durations_full(15.0, &mut bear_moving, true, None, 1.0, 1.0);
    assert!(
        !bear_moving.contains_key("Aggressive_Bear_Status"),
        "Aggressive (Bear) must expire at 10s while moving",
    );
}
