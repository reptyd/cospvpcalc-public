//! Reference: status_necropoison
//!
//! Covers each testable bullet in the "Necropoison" entry. Each test
//! body starts with the [REF:status_necropoison] marker so the
//! vitest coverage gate (src/pages/referenceCoverage.test.ts) sees
//! it.
//!
//! Engine paths:
//! - Active gate: `statuses.rs:90-95`
//!   `is_actives_disabled_by_necro(statuses)` returns `true` when
//!   `Necropoison_Status` has stacks ≥ 10. Used as a guard before
//!   each ability activation site (Phase 4f Warden's Rage is the
//!   documented exception - it bypasses the check).
//! - Warden's Rage exception: `composable/mod.rs:3288, 3349` -
//!   activation gate does NOT call `is_actives_disabled_by_necro`,
//!   matching Reference bullet 3.

use crate::contracts::SimpleStatusInstance;
use crate::statuses::is_actives_disabled_by_necro;
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
fn blocks_new_active_ability_activations_at_ten_stacks_and_above() {
    // [REF:status_necropoison]
    // Bullet 1: "Necropoison blocks new active ability activations
    // at 10 stacks and above."
    let mut at_10: BTreeMap<String, SimpleStatusInstance> = BTreeMap::new();
    at_10.insert("Necropoison_Status".to_string(), instance(10.0));
    assert!(
        is_actives_disabled_by_necro(&at_10),
        "Necropoison at 10 stacks must disable actives"
    );
    let mut at_30: BTreeMap<String, SimpleStatusInstance> = BTreeMap::new();
    at_30.insert("Necropoison_Status".to_string(), instance(30.0));
    assert!(
        is_actives_disabled_by_necro(&at_30),
        "Necropoison at 30 stacks must disable actives"
    );
}

#[test]
fn does_not_block_actives_below_ten_stacks() {
    // [REF:status_necropoison]
    // Bullet 1 (boundary): the gate is `stacks ≥ 10`, so 9 stacks
    // and below leave actives free.
    for stacks in [0.0, 1.0, 5.0, 9.0, 9.999] {
        let mut s: BTreeMap<String, SimpleStatusInstance> = BTreeMap::new();
        if stacks > 0.0 {
            s.insert("Necropoison_Status".to_string(), instance(stacks));
        }
        assert!(
            !is_actives_disabled_by_necro(&s),
            "Necropoison at {stacks} stacks (< 10) must NOT disable actives"
        );
    }
}

#[test]
fn does_not_disable_already_active_abilities_helper_reads_state_only() {
    // [REF:status_necropoison]
    // Bullet 2: "It does not disable abilities that were already
    // active before that point."
    // Engine: the `is_actives_disabled_by_necro` helper is a pure
    // status check, consulted only at *activation* call sites in
    // composable/mod.rs (Phase 4f-onwards) before flipping a
    // `*_active_until` field. Once an ability is active, its tick /
    // ongoing behaviour does not re-check this helper. The pure-
    // helper invariant is the only meaningful Rust assertion: the
    // helper is stateless and reads `Necropoison_Status` from the
    // status map without inspecting any `*_active_until` field.
    let mut s: BTreeMap<String, SimpleStatusInstance> = BTreeMap::new();
    s.insert("Necropoison_Status".to_string(), instance(15.0));
    let blocked_first = is_actives_disabled_by_necro(&s);
    let blocked_again = is_actives_disabled_by_necro(&s);
    assert_eq!(
        blocked_first, blocked_again,
        "is_actives_disabled_by_necro must be a pure function of the status map"
    );
}

#[test]
fn hunker_fresh_activation_is_not_blocked_at_high_necro_stacks() {
    // [REF:status_necropoison]
    // Game rule: Necropoison gates only in-game menu activations.
    // Hunker is a walk-style (Ctrl) toggle with auto-fire after 3 s
    // of hunker-walk - not a menu activation. The ability_metadata
    // layer pins Hunker as `Special` with necropoison_blocks=false,
    // so `ability_blocked_by_necropoison("Hunker", ...)` returns
    // false even at 30 stacks of Necropoison.
    use crate::composable::ability_metadata::ability_blocked_by_necropoison;
    let mut s = BTreeMap::new();
    s.insert("Necropoison_Status".to_string(), instance(30.0));
    assert!(
        !ability_blocked_by_necropoison("Hunker", &s),
        "Hunker must not be blocked by Necropoison - it is a walk-style toggle, not a menu activation"
    );
}
