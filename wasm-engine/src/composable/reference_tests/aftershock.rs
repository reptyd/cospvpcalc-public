//! Reference: status_aftershock
//!
//! Aftershock is a negative, stacking status that reduces the afflicted
//! side's outgoing melee damage by a flat 20% while present (stacks extend
//! the duration, not the magnitude). It reaches the opponent via Yolk Bomb
//! (Zeoarex) and Lich Mark (Garluhmoat). The runtime magnitude lives in
//! `combat::outgoing_damage_multiplier_from_statuses`; the catalog row drives its
//! negative polarity (Fortify cleanse) and stat_debuff category.

use crate::contracts::SimpleStatusInstance;
use crate::spec_constants::AFTERSHOCK_OUTGOING_DAMAGE_REDUCTION_PCT;
use std::collections::BTreeMap;

fn instance(stacks: f64) -> SimpleStatusInstance {
    SimpleStatusInstance {
        stacks,
        next_tick_at: None,
        next_decay_at: None,
        remaining_sec: 3.0,
        stack_value_mode: None,
        lich_mark_owned_stacks: None,
        no_decay: false,
        resolved_scalars: None,
    }
}

#[test]
fn registered_as_fortify_removable_negative_debuff() {
    // [REF:status_aftershock]
    assert!(crate::statuses::is_fortify_removable_status("Aftershock"));
    assert_eq!(
        crate::effects_registry::polarity("Aftershock"),
        Some(crate::effects_registry::Polarity::Negative),
    );
    assert_eq!(
        crate::effects_registry::category("Aftershock"),
        Some(crate::effects_registry::Category::StatDebuff),
    );
}

#[test]
fn reduces_outgoing_damage_by_20_pct_flat_across_stacks() {
    // [REF:status_aftershock]
    // Flat -20% while present, independent of stack count (stacks only extend
    // the duration). The afflicted side's outgoing damage is read from
    // combat::outgoing_damage_multiplier_from_statuses, like Scared/Aggressive.
    for stacks in [1.0, 4.0, 9.0] {
        let mut statuses: BTreeMap<String, SimpleStatusInstance> = BTreeMap::new();
        statuses.insert("Aftershock".to_string(), instance(stacks));
        let mult = crate::combat::outgoing_damage_multiplier_from_statuses(&statuses);
        let expected = 1.0 - AFTERSHOCK_OUTGOING_DAMAGE_REDUCTION_PCT / 100.0;
        assert!(
            (mult - expected).abs() < 1e-9,
            "Aftershock must give a flat -{AFTERSHOCK_OUTGOING_DAMAGE_REDUCTION_PCT}% outgoing damage at {stacks} stacks, got x{mult}",
        );
    }
}
