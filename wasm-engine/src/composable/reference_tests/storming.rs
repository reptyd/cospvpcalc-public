//! Reference: compare_storming
//!
//! Covers the "Storming" buff-menu debuff. Each test body starts with the
//! [REF:compare_storming] marker so the vitest coverage gate sees it.
//!
//! Engine paths:
//! - Incoming-damage marker: `combat.rs` —
//!   `incoming_damage_pct_from_statuses` returns +10 for `Storming_Status`.
//! - Applied to bites in `compute_melee_damage_per_hit_with_actor_and_target_statuses`
//!   and to breath in `compute_simple_breath_damage_with_actor_and_target_statuses`.
//! - Permanent marker seeded at setup (`composable/setup.rs`) when
//!   `config.attacker_storming` / `defender_storming` is set; the
//!   terrestrial-self / aquatic-opponent gate is resolved on the TS side.

use super::{default_breath, default_combatant};
use crate::combat::{
    compute_melee_damage_per_hit_with_actor_and_target_statuses,
    compute_simple_breath_damage_with_actor_and_target_statuses,
    incoming_damage_pct_from_statuses,
};
use crate::contracts::SimpleStatusInstance;
use std::collections::BTreeMap;

fn storming_statuses() -> BTreeMap<String, SimpleStatusInstance> {
    let mut map = BTreeMap::new();
    map.insert(
        "Storming_Status".to_string(),
        SimpleStatusInstance {
            stacks: 1.0,
            next_tick_at: None,
            next_decay_at: None,
            remaining_sec: 0.0,
            stack_value_mode: None,
            lich_mark_owned_stacks: None,
            no_decay: true,
            resolved_scalars: None,
        },
    );
    map
}

#[test]
fn storming_status_contributes_ten_percent_incoming() {
    // [REF:compare_storming]
    assert!(
        (incoming_damage_pct_from_statuses(&storming_statuses()) - 10.0).abs() < 1e-9,
        "Storming_Status must contribute +10% incoming damage"
    );
    assert!(
        incoming_damage_pct_from_statuses(&BTreeMap::new()).abs() < 1e-9,
        "no statuses → no incoming amplifier"
    );
}

#[test]
fn storming_amplifies_bite_damage_by_ten_percent() {
    // [REF:compare_storming]
    let attacker = default_combatant();
    let defender = default_combatant();
    let empty = BTreeMap::new();
    let base = compute_melee_damage_per_hit_with_actor_and_target_statuses(
        &attacker, &defender, attacker.health, &empty, &empty,
    );
    let with_storming = compute_melee_damage_per_hit_with_actor_and_target_statuses(
        &attacker, &defender, attacker.health, &empty, &storming_statuses(),
    );
    assert!(
        base > 0.0 && (with_storming - base * 1.1).abs() < 1e-6,
        "Storming must amplify bite damage by exactly 10%: base={base}, with_storming={with_storming}"
    );
}

#[test]
fn storming_amplifies_breath_damage_by_ten_percent() {
    // [REF:compare_storming]
    let attacker = default_combatant();
    let defender = default_combatant();
    let mut breath = default_breath();
    breath.dps_pct = 20.0;
    let empty = BTreeMap::new();
    let mut chain_a = 0.0;
    let mut chain_b = 0.0;
    let base = compute_simple_breath_damage_with_actor_and_target_statuses(
        &attacker, &defender, &breath, &mut chain_a, &empty, &empty,
    );
    let with_storming = compute_simple_breath_damage_with_actor_and_target_statuses(
        &attacker, &defender, &breath, &mut chain_b, &empty, &storming_statuses(),
    );
    assert!(
        base > 0.0 && (with_storming - base * 1.1).abs() < 1e-6,
        "Storming must amplify breath damage by exactly 10%: base={base}, with_storming={with_storming}"
    );
}
