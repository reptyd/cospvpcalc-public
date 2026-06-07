//! Reference: status_drowsy
//!
//! Covers each testable bullet in the "Drowsy" entry. Each test body
//! starts with the [REF:status_drowsy] marker so the vitest coverage
//! gate (src/pages/referenceCoverage.test.ts) sees it.
//!
//! Engine path: `combat.rs:599-601` -
//! `current_simple_bite_cooldown_with_statuses` adds 0.35 to the
//! base multiplier when `Drowsy_Status` is present. Stacks do NOT
//! enter the multiplier formula, only `present / not present`.

use super::default_combatant;
use crate::combat::current_simple_bite_cooldown_with_statuses;
use crate::contracts::SimpleStatusInstance;
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
fn increases_bite_cooldown_by_thirty_five_percent() {
    // [REF:status_drowsy]
    // Bullet 1: "Drowsy increases bite cooldown by 35% while it is
    // active."
    let mut stats = default_combatant();
    stats.bite_cooldown = 2.0;

    let mut statuses: BTreeMap<String, SimpleStatusInstance> = BTreeMap::new();
    statuses.insert("Drowsy_Status".to_string(), instance(1.0));
    let cd = current_simple_bite_cooldown_with_statuses(&stats, stats.health, &statuses);
    assert!(
        (cd - 2.7).abs() < 1e-9,
        "Drowsy must add +35% to bite cooldown (2.0 × 1.35 = 2.7): got {cd}"
    );
}

#[test]
fn strength_does_not_stack() {
    // [REF:status_drowsy]
    // Bullets 2 + 3: "The strength of the effect does not stack." +
    // "Adding more Drowsy stacks does not make the effect stronger
    // or weaker."
    let mut stats = default_combatant();
    stats.bite_cooldown = 2.0;

    let stack_counts = [1.0, 5.0, 10.0, 100.0];
    let baseline = {
        let mut s: BTreeMap<String, SimpleStatusInstance> = BTreeMap::new();
        s.insert("Drowsy_Status".to_string(), instance(1.0));
        current_simple_bite_cooldown_with_statuses(&stats, stats.health, &s)
    };
    for stacks in stack_counts {
        let mut s: BTreeMap<String, SimpleStatusInstance> = BTreeMap::new();
        s.insert("Drowsy_Status".to_string(), instance(stacks));
        let cd = current_simple_bite_cooldown_with_statuses(&stats, stats.health, &s);
        assert!(
            (cd - baseline).abs() < 1e-9,
            "Drowsy at {stacks} stacks must yield identical cooldown to 1 stack: got {cd} vs baseline {baseline}"
        );
    }
}

#[test]
fn no_drowsy_present_means_baseline_cooldown() {
    // [REF:status_drowsy]
    // Inverse sanity: no Drowsy in the status map → multiplier 1.0
    // (no +35% bump).
    let mut stats = default_combatant();
    stats.bite_cooldown = 2.0;
    let statuses: BTreeMap<String, SimpleStatusInstance> = BTreeMap::new();
    let cd = current_simple_bite_cooldown_with_statuses(&stats, stats.health, &statuses);
    assert!(
        (cd - 2.0).abs() < 1e-9,
        "no Drowsy → unchanged 2.0 s cooldown: got {cd}"
    );
}
