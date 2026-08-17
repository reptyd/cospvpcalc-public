//! Engine <-> catalog registry parity guard.
//!
//! NOT tied to a single Reference entry - this is the structural gate that
//! the Aggressive_Status drift would have tripped.
//!
//! Every *timed* status the engine special-cases for a damage modifier, and
//! every timed status the Compare buff runtime injects, MUST be registered
//! in the effects registry - i.e. have a `NAME_TO_EFFECT_META` row backed by
//! a Modeled/Partial Reference entry (`src/engine/statusCatalog.ts` +
//! `src/pages/referenceContent.ts`, codegen'd into `effects_registry.rs`).
//!
//! A registered status draws its duration, polarity (Fortify cleanse), and
//! category from the catalog. An UNregistered one silently falls back to the
//! engine defaults (`status_decay_sec` => `unwrap_or(3.0)`, no polarity) -
//! which is exactly how `Aggressive_Status` became a 3-second buff that
//! Fortify wrongly treated as non-positive. This guard fails the build the
//! moment a new engine-applied timed status is added without a catalog row,
//! so effects / plushie / compare-only statuses can no longer "live without a
//! ref" and drift from their description.
//!
//! Deliberately excluded: `Storming_Status` - a permanent environmental
//! marker seeded `no_decay` with a hard-coded +10% incoming amplifier; it
//! does not read registry duration/polarity and is intentionally not
//! Fortify-cleansable (weather can't be cleansed). If Storming ever gains a
//! timed/cleansable form, add it here and give it a catalog row.
//!
//! Keep `ENGINE_TIMED_STATUS_IDS` in sync with the `match` arms in
//! `combat.rs` (`outgoing_damage_multiplier_from_statuses` /
//! `incoming_damage_pct_from_statuses`) and the `initialStatuses.push`
//! calls in `src/engine/compareBuffRuntime.ts`.

use crate::contracts::SimpleStatusInstance;
use crate::effects_registry::{is_known, polarity, stack_rule, Polarity, StackRule};
use crate::statuses::{apply_simple_status, status_is_stacking_none};

/// Timed statuses the engine / Compare runtime apply and that rely on the
/// catalog for duration + polarity + category.
const ENGINE_TIMED_STATUS_IDS: &[&str] = &[
    // Outgoing-damage modifiers (combat.rs outgoing_damage_multiplier_from_statuses).
    "Aggressive_Status",
    "Aggressive_Bear_Status",
    "Scared_Status",
    "Scared_Bear_Status",
    "Fear_Status",
    "Malices_Mark",
    "Aftershock",
    // Compare buff runtime timed injections (compareBuffRuntime.ts).
    "Muddy_Status",
    "Clean_Water_Status",
    "Refreshed_Status",
];

#[test]
fn every_engine_timed_status_is_registered_in_the_catalog() {
    for id in ENGINE_TIMED_STATUS_IDS {
        assert!(
            is_known(id),
            "status `{id}` is applied by the engine / Compare runtime but has \
             no effects-registry entry. Add a NAME_TO_EFFECT_META row + a \
             Modeled/Partial Reference entry (statusCatalog.ts + \
             referenceContent.ts) and re-run `npm run gen:registry`. \
             Unregistered statuses fall back to the 3-second / no-polarity \
             engine default - the Aggressive_Status drift.",
        );
    }
}

#[test]
fn damage_buff_debuff_polarity_matches_intent() {
    // Positive buffs must report Positive (so Fortify does NOT cleanse them);
    // negative debuffs must report Negative (so Fortify DOES).
    assert_eq!(polarity("Aggressive_Status"), Some(Polarity::Positive));
    assert_eq!(polarity("Aggressive_Bear_Status"), Some(Polarity::Positive));
    assert_eq!(polarity("Scared_Status"), Some(Polarity::Negative));
    assert_eq!(polarity("Scared_Bear_Status"), Some(Polarity::Negative));
    assert_eq!(polarity("Fear_Status"), Some(Polarity::Negative));
    assert_eq!(polarity("Malices_Mark"), Some(Polarity::Negative));
    assert_eq!(polarity("Aftershock"), Some(Polarity::Negative));

    // A positive buff is NOT Fortify-removable; a negative debuff is.
    assert!(!crate::statuses::is_fortify_removable_status("Aggressive_Status"));
    assert!(crate::statuses::is_fortify_removable_status("Scared_Status"));
}

/// The eight fixed-value statuses in the catalog (Aggressive, Aggressive
/// (Bear), Clean Water, Muddy, Refreshed, Scared, Scared (Bear), Sickly).
const NON_STACKING_STATUS_IDS: &[&str] = &[
    "Clean_Water_Status",
    "Muddy_Status",
    "Refreshed_Status",
    "Sickly_Status",
];

// The emote pair left this list when they were rebuilt as ten one-second
// stacks: the game grants them at `MaxStack = 10` and the magnitude never
// reads the count, so the stacks are the lifetime.
const EMOTE_STACKING_STATUS_IDS: &[&str] = &[
    "Aggressive_Status",
    "Aggressive_Bear_Status",
    "Scared_Status",
    "Scared_Bear_Status",
];

#[test]
fn non_stacking_rule_is_read_off_the_catalog() {
    for id in NON_STACKING_STATUS_IDS {
        assert_eq!(
            stack_rule(id),
            Some(StackRule::NonStacking),
            "catalog stackRule drifted for `{id}`",
        );
        assert!(
            status_is_stacking_none(id),
            "`{id}` is NonStacking in the catalog but the engine still stacks it",
        );
    }
    // A stacking status keeps piling up - the rule is per-status, not global.
    assert!(!status_is_stacking_none("Burn_Status"));
    for id in EMOTE_STACKING_STATUS_IDS {
        assert!(!status_is_stacking_none(id), "`{id}` should stack, one second per stack");
    }
}

#[test]
fn the_emote_buffs_are_ten_one_second_stacks() {
    for id in EMOTE_STACKING_STATUS_IDS {
        assert_eq!(crate::statuses::status_decay_sec(id), 1.0, "`{id}` decays a stack a second");
        assert_eq!(
            crate::effects_registry::default_max_stacks(id),
            Some(10.0),
            "`{id}` is capped at the ten the emote grants",
        );

        // Ten stacks a second apart is the ten-second window the entry states.
        let mut slot: Option<SimpleStatusInstance> = None;
        apply_simple_status(0.0, id, 10.0, &mut slot);
        let seeded = slot.expect("the emote seeds the status");
        assert_eq!(seeded.stacks, 10.0);
        assert!((seeded.remaining_sec - 10.0).abs() < 1e-9, "`{id}` runs 10 seconds");
    }
}

#[test]
fn re_applying_a_fixed_value_status_refreshes_instead_of_stacking() {
    for id in NON_STACKING_STATUS_IDS {
        let decay = crate::statuses::status_decay_sec(id);
        let mut slot: Option<SimpleStatusInstance> = None;
        apply_simple_status(0.0, id, 1.0, &mut slot);
        let first = slot.clone().expect("first application seeds the status");
        assert_eq!(first.stacks, 1.0);
        assert_eq!(first.next_decay_at, Some(decay));

        // Second dose, part-way through the first window: one stack still, and
        // the window restarts from now instead of the two adding up.
        apply_simple_status(decay / 2.0, id, 3.0, &mut slot);
        let second = slot.expect("re-application keeps the status");
        assert_eq!(
            second.stacks, 1.0,
            "`{id}` must stay at a single stack when re-applied",
        );
        assert_eq!(
            second.next_decay_at,
            Some(decay / 2.0 + decay),
            "`{id}` must restart its window on re-application",
        );
    }

    // Contrast: a stacking status adds up and keeps its original timer.
    let mut burn: Option<SimpleStatusInstance> = None;
    apply_simple_status(0.0, "Burn_Status", 1.0, &mut burn);
    apply_simple_status(1.0, "Burn_Status", 3.0, &mut burn);
    let burn = burn.expect("burn stays applied");
    assert_eq!(burn.stacks, 4.0);
    assert_eq!(burn.next_decay_at, Some(crate::statuses::status_decay_sec("Burn_Status")));
}
