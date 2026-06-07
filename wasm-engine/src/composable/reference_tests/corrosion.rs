//! Reference: status_corrosion
//!
//! Covers each testable bullet in the "Corrosion" entry. Each test
//! body starts with the [REF:status_corrosion] marker so the vitest
//! coverage gate (src/pages/referenceCoverage.test.ts) sees it.
//!
//! Engine paths:
//! - DoT formula: `statuses.rs:181` -
//!   `compute_simple_dot_damage(_, "Corrosion_Status", _, _) =
//!   max_hp * 0.5 / 100` (= 0.5% max HP, stacks-independent).
//! - 3 s tick cadence: `statuses.rs:14` returns `Some(3.0)` for
//!   `Corrosion_Status` from `status_tick_sec`.
//! - Weight reduction: `combat.rs:13-23` -
//!   `corrosion_weight_multiplier` returns `(100 - (7.5 + stacks)) /
//!    100` clamped to >= 0, with the inner `(7.5 + stacks).min(97.5)`
//!   capping the reduction at 97.5%.
//! - Offensive scaling: `combat.rs:32-44`
//!   `direct_attack_weight_scale` returns `(1 + min(ratio, 3)) / 2`
//!   clamped to >= 1, applied to `Corrosion_Status` via
//!   `is_weight_scaled_direct_attack_offensive_ailment_status`.

use super::default_combatant;
use crate::combat::{
    corrosion_weight_multiplier, direct_attack_weight_scale,
    is_weight_scaled_direct_attack_offensive_ailment_status,
};
use crate::contracts::SimpleStatusInstance;
use crate::statuses::{compute_simple_dot_damage, status_tick_sec};
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
fn deals_zero_point_five_percent_max_hp_every_three_seconds() {
    // [REF:status_corrosion]
    // Bullet 1: "Corrosion deals 0.5% max HP damage every 3 seconds."
    let tick = status_tick_sec("Corrosion_Status");
    assert_eq!(
        tick,
        Some(3.0),
        "Corrosion_Status tick cadence must be 3 s: got {tick:?}"
    );
    let dmg_1 = compute_simple_dot_damage(10_000.0, "Corrosion_Status", 1.0, 3.0);
    let dmg_5 = compute_simple_dot_damage(10_000.0, "Corrosion_Status", 5.0, 3.0);
    let dmg_20 = compute_simple_dot_damage(10_000.0, "Corrosion_Status", 20.0, 3.0);
    assert!(
        (dmg_1 - 50.0).abs() < 1e-9,
        "Corrosion at any stack count must deal 0.5% maxHP (50 on 10000): got dmg_1={dmg_1}"
    );
    assert!(
        (dmg_5 - 50.0).abs() < 1e-9 && (dmg_20 - 50.0).abs() < 1e-9,
        "Corrosion damage must be stacks-independent: got dmg_5={dmg_5}, dmg_20={dmg_20}"
    );
}

#[test]
fn weight_reduction_starts_at_seven_point_five_percent_and_grows_one_per_stack() {
    // [REF:status_corrosion]
    // Bullet 3: "Its weight reduction starts at 7.5% and increases by
    // 1% per stack."
    // Plus Notes 1: "1 Corrosion stack gives 8.5% weight reduction,
    // because the effect starts at 7.5% and then adds 1% per stack."
    let cases = [
        (1.0, 0.915),  // 7.5 + 1.0 = 8.5% reduction → 0.915 multiplier
        (2.0, 0.905),  // 9.5%
        (10.0, 0.825), // 17.5%
        (50.0, 0.425), // 57.5%
    ];
    for (stacks, expected) in cases {
        let mut statuses: BTreeMap<String, SimpleStatusInstance> = BTreeMap::new();
        statuses.insert("Corrosion_Status".to_string(), instance(stacks));
        let mult = corrosion_weight_multiplier(&statuses);
        assert!(
            (mult - expected).abs() < 1e-9,
            "{stacks} Corrosion stacks must yield {expected}x weight: got {mult}"
        );
    }
}

#[test]
fn weight_reduction_caps_at_ninety_seven_point_five_percent() {
    // [REF:status_corrosion]
    // Bullet 4: "That reduction is capped at 97.5%."
    // Engine clamps `(7.5 + stacks).min(97.5)` so a 100-stack input
    // still yields 0.025x weight (= 1 - 0.975).
    let mut statuses: BTreeMap<String, SimpleStatusInstance> = BTreeMap::new();
    statuses.insert("Corrosion_Status".to_string(), instance(200.0));
    let mult = corrosion_weight_multiplier(&statuses);
    assert!(
        (mult - 0.025).abs() < 1e-9,
        "Corrosion weight reduction must clamp at 97.5% (multiplier 0.025): got {mult}"
    );
}

#[test]
fn no_weight_reduction_without_corrosion() {
    // [REF:status_corrosion]
    // Inverse: empty status map → 1.0x weight (no Corrosion present).
    let statuses: BTreeMap<String, SimpleStatusInstance> = BTreeMap::new();
    let mult = corrosion_weight_multiplier(&statuses);
    assert!(
        (mult - 1.0).abs() < 1e-12,
        "no Corrosion → 1.0x weight: got {mult}"
    );
}

#[test]
fn offensive_payload_scales_stacks_by_weight_ratio() {
    // [REF:status_corrosion]
    // Bullets 5 + 6: "When Corrosion is applied through an offensive
    // direct attack payload, its applied stacks scale upward by
    // max(1, (1 + min(attackerWeight / defenderWeight, 3)) / 2)." +
    // "equal weight gives 1.0x stacks, a 2:1 weight advantage gives
    // 1.5x stacks, and any 3:1 or larger advantage gives 2.0x stacks."
    assert!(
        is_weight_scaled_direct_attack_offensive_ailment_status("Corrosion_Status"),
        "Corrosion must be tagged as a weight-scaled offensive ailment"
    );

    let mut atk = default_combatant();
    let mut def = default_combatant();

    // Equal weights → 1.0x.
    atk.weight = 100.0;
    def.weight = 100.0;
    let scale_eq = direct_attack_weight_scale(&atk, &def, &BTreeMap::new(), &BTreeMap::new());
    assert!(
        (scale_eq - 1.0).abs() < 1e-9,
        "equal-weight scale must be 1.0x: got {scale_eq}"
    );

    // 2:1 → 1.5x.
    atk.weight = 200.0;
    let scale_2 = direct_attack_weight_scale(&atk, &def, &BTreeMap::new(), &BTreeMap::new());
    assert!(
        (scale_2 - 1.5).abs() < 1e-9,
        "2:1 weight scale must be 1.5x: got {scale_2}"
    );

    // 3:1 → 2.0x.
    atk.weight = 300.0;
    let scale_3 = direct_attack_weight_scale(&atk, &def, &BTreeMap::new(), &BTreeMap::new());
    assert!(
        (scale_3 - 2.0).abs() < 1e-9,
        "3:1 weight scale must be 2.0x: got {scale_3}"
    );

    // 5:1 → still 2.0x (cap).
    atk.weight = 500.0;
    let scale_5 = direct_attack_weight_scale(&atk, &def, &BTreeMap::new(), &BTreeMap::new());
    assert!(
        (scale_5 - 2.0).abs() < 1e-9,
        "5:1 weight scale must clamp to 2.0x cap: got {scale_5}"
    );
}

#[test]
fn lighter_attacker_floors_at_one_x_no_downward_scaling() {
    // [REF:status_corrosion]
    // Bullet 7: "If the attacker is lighter than the target, the
    // applied stacks stay at 1.0x instead of scaling downward."
    let mut atk = default_combatant();
    let mut def = default_combatant();
    atk.weight = 50.0;
    def.weight = 200.0; // attacker 4x lighter
    let scale = direct_attack_weight_scale(&atk, &def, &BTreeMap::new(), &BTreeMap::new());
    assert!(
        (scale - 1.0).abs() < 1e-9,
        "lighter attacker must floor at 1.0x scale (no downward scaling): got {scale}"
    );
}
