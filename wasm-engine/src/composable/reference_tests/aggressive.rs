//! Reference: compare_aggressive / status_aggressive / status_aggressive_bear
//!
//! The Aggressive emote is a positive Compare buff: +25% outgoing melee
//! damage for 10 seconds (Bear-plushie variant +37.5%). The Compare
//! toggle injects the starting status in TS
//! (`src/engine/compareBuffRuntime.ts`); the Rust engine reads the flat
//! damage modifier from `combat::outgoing_damage_pct_from_statuses` and
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
fn lasts_ten_seconds_not_the_three_second_default() {
    // [REF:status_aggressive]
    // Catalog defaultDurationSec = 10, so the engine's per-status decay
    // helper returns 10.0 - NOT the 3.0 fallback used by unregistered
    // statuses. This is the exact bug the catalog row fixes.
    assert_eq!(
        crate::effects_registry::default_duration_sec("Aggressive_Status"),
        Some(10.0),
    );
    assert_eq!(crate::statuses::status_decay_sec("Aggressive_Status"), 10.0);

    // [REF:status_aggressive_bear]
    assert_eq!(
        crate::effects_registry::default_duration_sec("Aggressive_Bear_Status"),
        Some(10.0),
    );
    assert_eq!(
        crate::statuses::status_decay_sec("Aggressive_Bear_Status"),
        10.0,
    );
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
        (crate::combat::outgoing_damage_pct_from_statuses(&base) - 25.0).abs() < 1e-9,
        "Aggressive must give +25% outgoing damage",
    );

    // Bear variant: 25 * 1.1 + 10 = 37.5.
    let mut bear: BTreeMap<String, SimpleStatusInstance> = BTreeMap::new();
    bear.insert("Aggressive_Bear_Status".to_string(), instance());
    assert!(
        (crate::combat::outgoing_damage_pct_from_statuses(&bear) - 37.5).abs() < 1e-9,
        "Aggressive (Bear) must give +37.5% outgoing damage (25 * 1.1 + 10)",
    );
}
