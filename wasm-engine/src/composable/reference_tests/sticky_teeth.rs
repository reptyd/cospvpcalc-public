//! Reference: status_sticky_teeth
//!
//! Covers each testable bullet in the "Sticky Teeth" entry. Each
//! test body starts with the [REF:status_sticky_teeth] marker so
//! the vitest coverage gate (src/pages/referenceCoverage.test.ts)
//! sees it.
//!
//! Engine path: `combat.rs:596-598` -
//! `current_simple_bite_cooldown_with_statuses` adds 0.65 to the
//! base multiplier when `Sticky_Teeth_Status` is present. Stacks do
//! NOT enter the multiplier formula, only `present / not present`.

use super::default_combatant;
use crate::combat::current_simple_bite_cooldown_with_statuses;
use crate::contracts::SimpleStatusInstance;
use crate::spec_constants::STICKY_TEETH_BITE_COOLDOWN_INCREASE_PCT;
use std::collections::BTreeMap;

fn instance(stacks: f64) -> SimpleStatusInstance {
    SimpleStatusInstance {
        stacks,
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
fn increases_bite_cooldown_by_sixty_five_percent() {
    // [REF:status_sticky_teeth]
    // Bullet 1: "Sticky Teeth increases bite cooldown by 65% while
    // it is active."
    let mut stats = default_combatant();
    stats.bite_cooldown = 2.0;

    let mut statuses: BTreeMap<String, SimpleStatusInstance> = BTreeMap::new();
    statuses.insert("Sticky_Teeth_Status".to_string(), instance(1.0));
    let cd = current_simple_bite_cooldown_with_statuses(&stats, stats.health, &statuses);
    let expected = 2.0 * (1.0 + STICKY_TEETH_BITE_COOLDOWN_INCREASE_PCT / 100.0);
    assert!(
        (cd - expected).abs() < 1e-9,
        "Sticky Teeth must add +{STICKY_TEETH_BITE_COOLDOWN_INCREASE_PCT}% to bite cooldown (2.0 × {} = {expected}): got {cd}",
        1.0 + STICKY_TEETH_BITE_COOLDOWN_INCREASE_PCT / 100.0
    );
}

#[test]
fn strength_does_not_stack() {
    // [REF:status_sticky_teeth]
    // Bullet 3: "The number of stacks only affects how long Sticky Teeth
    // lasts."
    let mut stats = default_combatant();
    stats.bite_cooldown = 2.0;

    let cooldown_at = |stacks: f64| -> f64 {
        let mut s: BTreeMap<String, SimpleStatusInstance> = BTreeMap::new();
        s.insert("Sticky_Teeth_Status".to_string(), instance(stacks));
        current_simple_bite_cooldown_with_statuses(&stats, stats.health, &s)
    };
    let baseline = cooldown_at(1.0);
    for stacks in [1.0, 5.0, 10.0, 100.0] {
        let cd = cooldown_at(stacks);
        assert!(
            (cd - baseline).abs() < 1e-9,
            "Sticky Teeth at {stacks} stacks must yield identical cooldown to 1 stack: got {cd} vs baseline {baseline}"
        );
    }
}

#[test]
fn no_sticky_teeth_present_means_baseline_cooldown() {
    // [REF:status_sticky_teeth]
    // Inverse sanity: empty status map -> 1.0x multiplier.
    let mut stats = default_combatant();
    stats.bite_cooldown = 2.0;
    let statuses: BTreeMap<String, SimpleStatusInstance> = BTreeMap::new();
    let cd = current_simple_bite_cooldown_with_statuses(&stats, stats.health, &statuses);
    assert!(
        (cd - 2.0).abs() < 1e-9,
        "no Sticky Teeth → unchanged 2.0 s cooldown: got {cd}"
    );
}
