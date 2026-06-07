//! Reference: status_fear
//!
//! Covers each testable bullet in the "Fear" entry. Each test body
//! starts with the [REF:status_fear] marker so the vitest coverage
//! gate (src/pages/referenceCoverage.test.ts) sees it.
//!
//! Engine path: `combat.rs:131-143` `outgoing_damage_pct_from_statuses`
//! sums per-status pcts, returning -45 when `Fear_Status` is present.
//! That sum feeds melee/breath multiplier as `1 + sum/100`. Stacks do
//! NOT enter the formula - only `present / not present`.

use super::default_combatant;
use crate::combat::compute_melee_damage_per_hit_with_actor_and_target_statuses;
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
fn reduces_outgoing_damage_by_forty_five_percent() {
    // [REF:status_fear]
    // Bullet 1: "Fear reduces outgoing damage by 45% while it is
    // active."
    let mut atk = default_combatant();
    atk.damage = 100.0;
    let def = default_combatant();
    let mut atk_st: BTreeMap<String, SimpleStatusInstance> = BTreeMap::new();
    atk_st.insert("Fear_Status".to_string(), instance(1.0));
    let baseline = compute_melee_damage_per_hit_with_actor_and_target_statuses(
        &atk, &def, atk.health, &BTreeMap::new(), &BTreeMap::new(),
    );
    let with_fear = compute_melee_damage_per_hit_with_actor_and_target_statuses(
        &atk, &def, atk.health, &atk_st, &BTreeMap::new(),
    );
    let ratio = with_fear / baseline;
    assert!(
        (ratio - 0.55).abs() < 1e-9,
        "Fear must multiply outgoing damage by 0.55 (-45%): got ratio {ratio} (with={with_fear}, base={baseline})"
    );
}

#[test]
fn strength_does_not_stack() {
    // [REF:status_fear]
    // Bullets 2 + 3: "The strength of the effect does not stack." +
    // "Adding more Fear stacks does not make the effect stronger or
    // weaker."
    let mut atk = default_combatant();
    atk.damage = 100.0;
    let def = default_combatant();
    let stack_counts = [1.0, 5.0, 10.0, 100.0];
    let baseline_dmg = {
        let mut s: BTreeMap<String, SimpleStatusInstance> = BTreeMap::new();
        s.insert("Fear_Status".to_string(), instance(1.0));
        compute_melee_damage_per_hit_with_actor_and_target_statuses(
            &atk, &def, atk.health, &s, &BTreeMap::new(),
        )
    };
    for stacks in stack_counts {
        let mut s: BTreeMap<String, SimpleStatusInstance> = BTreeMap::new();
        s.insert("Fear_Status".to_string(), instance(stacks));
        let dmg = compute_melee_damage_per_hit_with_actor_and_target_statuses(
            &atk, &def, atk.health, &s, &BTreeMap::new(),
        );
        assert!(
            (dmg - baseline_dmg).abs() < 1e-9,
            "Fear at {stacks} stacks must yield identical outgoing damage to 1 stack: got {dmg} vs baseline {baseline_dmg}"
        );
    }
}

#[test]
fn no_fear_present_means_unchanged_outgoing_damage() {
    // [REF:status_fear]
    // Inverse sanity: empty status map → 1.0x multiplier.
    let mut atk = default_combatant();
    atk.damage = 100.0;
    let def = default_combatant();
    let dmg = compute_melee_damage_per_hit_with_actor_and_target_statuses(
        &atk, &def, atk.health, &BTreeMap::new(), &BTreeMap::new(),
    );
    let baseline = atk.damage;
    assert!(
        dmg > 0.0 && (dmg - baseline).abs() < 1e-9,
        "no Fear → unchanged outgoing damage: got {dmg}, base {baseline}"
    );
}
