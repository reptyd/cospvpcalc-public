//! Reference: status_frostbite
//!
//! Covers each testable bullet in the "Frostbite" entry. Each test
//! body starts with the [REF:status_frostbite] marker so the vitest
//! coverage gate (src/pages/referenceCoverage.test.ts) sees it.
//!
//! Engine path: `combat.rs:602-607` -
//! `current_simple_bite_cooldown_with_statuses` reads
//! `Frostbite_Status` and adds `0.02 * effective_stacks` to the
//! multiplier, where `effective_stacks = ceil(remaining_sec / 3)`.

use super::default_combatant;
use crate::combat::current_simple_bite_cooldown_with_statuses;
use crate::contracts::SimpleStatusInstance;
use std::collections::BTreeMap;

fn frostbite_with_stacks(stacks: f64) -> SimpleStatusInstance {
    // remaining_sec = stacks * 3 → effective_stacks = stacks
    SimpleStatusInstance {
        stacks,
        next_tick_at: None,
        next_decay_at: None,
        remaining_sec: stacks * 3.0,
        stack_value_mode: None,
        lich_mark_owned_stacks: None,
        no_decay: false,
        resolved_scalars: None,
    }
}

#[test]
fn increases_bite_cooldown_by_two_percent_per_stack() {
    // [REF:status_frostbite]
    // Bullet 1: "Frostbite increases bite cooldown by 2% per stack
    // while it is active."
    let mut stats = default_combatant();
    stats.bite_cooldown = 2.0;

    // 1 stack → +2% → 2.04 s
    let mut s1: BTreeMap<String, SimpleStatusInstance> = BTreeMap::new();
    s1.insert("Frostbite_Status".to_string(), frostbite_with_stacks(1.0));
    let cd_1 = current_simple_bite_cooldown_with_statuses(&stats, stats.health, &s1);
    assert!(
        (cd_1 - 2.04).abs() < 1e-9,
        "1 Frostbite stack must yield 2.0 × 1.02 = 2.04 s cooldown: got {cd_1}"
    );

    // 10 stacks → +20% → 2.4 s
    let mut s10: BTreeMap<String, SimpleStatusInstance> = BTreeMap::new();
    s10.insert("Frostbite_Status".to_string(), frostbite_with_stacks(10.0));
    let cd_10 = current_simple_bite_cooldown_with_statuses(&stats, stats.health, &s10);
    assert!(
        (cd_10 - 2.4).abs() < 1e-9,
        "10 Frostbite stacks must yield 2.0 × 1.20 = 2.4 s cooldown: got {cd_10}"
    );
}

#[test]
fn strength_scales_directly_with_stacks() {
    // [REF:status_frostbite]
    // Bullet 2: "Its strength scales directly with stacks."
    let mut stats = default_combatant();
    stats.bite_cooldown = 1.0;

    let cooldown_at = |stacks: f64| -> f64 {
        let mut s: BTreeMap<String, SimpleStatusInstance> = BTreeMap::new();
        s.insert("Frostbite_Status".to_string(), frostbite_with_stacks(stacks));
        current_simple_bite_cooldown_with_statuses(&stats, stats.health, &s)
    };
    let c1 = cooldown_at(1.0);
    let c5 = cooldown_at(5.0);
    let c10 = cooldown_at(10.0);
    // Cooldown deltas above the 1.0 base must be linear in stacks:
    // (c10 - 1) / (c5 - 1) = 10/5 = 2.0; (c5 - 1) / (c1 - 1) = 5/1 = 5.0.
    let r_5_1 = (c5 - 1.0) / (c1 - 1.0);
    let r_10_5 = (c10 - 1.0) / (c5 - 1.0);
    assert!(
        (r_5_1 - 5.0).abs() < 1e-9,
        "5/1 stacks delta ratio must be 5.0: got {r_5_1}"
    );
    assert!(
        (r_10_5 - 2.0).abs() < 1e-9,
        "10/5 stacks delta ratio must be 2.0: got {r_10_5}"
    );
}
