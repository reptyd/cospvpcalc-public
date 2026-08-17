//! Reference: status_corrosion
//!
//! Covers each testable bullet in the "Corrosion" entry. Each test
//! body starts with the [REF:status_corrosion] marker so the vitest
//! coverage gate (src/pages/referenceCoverage.test.ts) sees it.
//!
//! Engine paths:
//! - DoT formula: `statuses.rs:181` -
//!   `compute_simple_dot_damage(_, "Corrosion_Status", _) =
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
use crate::spec_constants::{
    CORROSION_DOT_PCT_MAX_HP, CORROSION_MAX_STACKS, CORROSION_WEIGHT_REDUCTION_BASE_PCT,
    CORROSION_WEIGHT_REDUCTION_CAP_PCT, CORROSION_WEIGHT_REDUCTION_PER_STACK_PCT,
};
use crate::composable::status_helpers::apply_status_delta;
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
    let dmg_1 = compute_simple_dot_damage(10_000.0, "Corrosion_Status", 1.0);
    let dmg_5 = compute_simple_dot_damage(10_000.0, "Corrosion_Status", 5.0);
    let dmg_20 = compute_simple_dot_damage(10_000.0, "Corrosion_Status", 20.0);
    let expected = 10_000.0 * CORROSION_DOT_PCT_MAX_HP / 100.0;
    assert!(
        (dmg_1 - expected).abs() < 1e-9,
        "Corrosion at any stack count must deal {CORROSION_DOT_PCT_MAX_HP}% maxHP ({expected} on 10000): got dmg_1={dmg_1}"
    );
    assert!(
        (dmg_5 - expected).abs() < 1e-9 && (dmg_20 - expected).abs() < 1e-9,
        "Corrosion damage must be stacks-independent: got dmg_5={dmg_5}, dmg_20={dmg_20}"
    );
}

#[test]
fn weight_reduction_starts_at_seven_point_five_percent_and_grows_one_per_stack() {
    // [REF:status_corrosion]
    // Bullet 3: "Its weight reduction starts at 7.5% and increases by
    // 1% per stack."
    // Plus bullet 6: "1 Corrosion stack gives 8.5% weight reduction."
    let stack_cases = [1.0, 2.0, 10.0, 50.0];
    for stacks in stack_cases {
        let mut statuses: BTreeMap<String, SimpleStatusInstance> = BTreeMap::new();
        statuses.insert("Corrosion_Status".to_string(), instance(stacks));
        let mult = corrosion_weight_multiplier(&statuses);
        let expected = 1.0
            - (CORROSION_WEIGHT_REDUCTION_BASE_PCT
                + CORROSION_WEIGHT_REDUCTION_PER_STACK_PCT * stacks)
                / 100.0;
        assert!(
            (mult - expected).abs() < 1e-9,
            "{stacks} Corrosion stacks must yield {expected}x weight (1 - ({CORROSION_WEIGHT_REDUCTION_BASE_PCT} + {CORROSION_WEIGHT_REDUCTION_PER_STACK_PCT}×{stacks})/100): got {mult}"
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
    let expected = 1.0 - CORROSION_WEIGHT_REDUCTION_CAP_PCT / 100.0;
    assert!(
        (mult - expected).abs() < 1e-9,
        "Corrosion weight reduction must clamp at {CORROSION_WEIGHT_REDUCTION_CAP_PCT}% (multiplier {expected}): got {mult}"
    );
}

#[test]
fn stacks_stop_at_ninety() {
    // [REF:status_corrosion]
    // Bullet 5: "Corrosion stops stacking at 90 stacks, which is exactly
    // where its weight reduction reaches that cap."
    let mut statuses: BTreeMap<String, SimpleStatusInstance> = BTreeMap::new();
    for _ in 0..40 {
        apply_status_delta(0.0, &mut statuses, "Corrosion_Status", 5.0);
    }
    let stacks = statuses["Corrosion_Status"].stacks;
    assert!(
        (stacks - CORROSION_MAX_STACKS).abs() < 1e-9,
        "200 applied stacks must clamp to {CORROSION_MAX_STACKS}: got {stacks}"
    );
    let mult = corrosion_weight_multiplier(&statuses);
    let expected = 1.0 - CORROSION_WEIGHT_REDUCTION_CAP_PCT / 100.0;
    assert!(
        (mult - expected).abs() < 1e-9,
        "the capped stack count must still reach the {CORROSION_WEIGHT_REDUCTION_CAP_PCT}% weight reduction: got {mult}"
    );
}

#[test]
fn no_weight_reduction_without_corrosion() {
    // [REF:status_corrosion]
    // Inverse: empty status map -> 1.0x weight (no Corrosion present).
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
    // Bullets 7 + 8: "When Corrosion is applied through an offensive direct
    // attack payload, its applied stacks are multiplied by (1 + min(ratio, 3))
    // / 2, where ratio is attacker effective weight / defender effective
    // weight." + "equal weight gives 1.0x stacks, a 2:1 weight advantage gives
    // 1.5x stacks, and any 3:1 or larger advantage gives 2.0x stacks."
    assert!(
        is_weight_scaled_direct_attack_offensive_ailment_status("Corrosion_Status"),
        "Corrosion must be tagged as a weight-scaled offensive ailment"
    );

    let mut atk = default_combatant();
    let mut def = default_combatant();

    // Equal weights -> 1.0x.
    atk.weight = 100.0;
    def.weight = 100.0;
    let scale_eq = direct_attack_weight_scale(&atk, &def, &BTreeMap::new(), &BTreeMap::new());
    assert!(
        (scale_eq - 1.0).abs() < 1e-9,
        "equal-weight scale must be 1.0x: got {scale_eq}"
    );

    // 2:1 -> 1.5x.
    atk.weight = 200.0;
    let scale_2 = direct_attack_weight_scale(&atk, &def, &BTreeMap::new(), &BTreeMap::new());
    assert!(
        (scale_2 - 1.5).abs() < 1e-9,
        "2:1 weight scale must be 1.5x: got {scale_2}"
    );

    // 3:1 -> 2.0x.
    atk.weight = 300.0;
    let scale_3 = direct_attack_weight_scale(&atk, &def, &BTreeMap::new(), &BTreeMap::new());
    assert!(
        (scale_3 - 2.0).abs() < 1e-9,
        "3:1 weight scale must be 2.0x: got {scale_3}"
    );

    // 5:1 -> still 2.0x (cap).
    atk.weight = 500.0;
    let scale_5 = direct_attack_weight_scale(&atk, &def, &BTreeMap::new(), &BTreeMap::new());
    assert!(
        (scale_5 - 2.0).abs() < 1e-9,
        "5:1 weight scale must clamp to 2.0x cap: got {scale_5}"
    );
}

#[test]
fn a_lighter_attacker_lands_fewer_stacks() {
    // [REF:status_corrosion]
    // Bullet 9: "An attacker lighter than the target lands fewer stacks: at
    // half the target weight the factor is 0.75, at a quarter it is 0.625."
    let mut atk = default_combatant();
    let mut def = default_combatant();
    atk.weight = 50.0;
    def.weight = 200.0; // attacker 4x lighter
    let scale = direct_attack_weight_scale(&atk, &def, &BTreeMap::new(), &BTreeMap::new());
    assert!(
        (scale - 0.625).abs() < 1e-9,
        "a quarter-weight attacker scales by (1 + 0.25) / 2: got {scale}"
    );

    def.weight = 100.0;
    let even = direct_attack_weight_scale(&atk, &def, &BTreeMap::new(), &BTreeMap::new());
    assert!(even < 1.0, "still lighter, still below 1: got {even}");
}

#[test]
fn the_payload_ratio_reads_weight_through_corrosion() {
    // [REF:status_corrosion]
    // The ratio the payload scales by is between effective weights, and
    // Corrosion is what moves a weight during a fight. A defender carrying it
    // is lighter, so the same attacker lands more.
    let atk = default_combatant();
    let def = default_combatant();
    let empty: BTreeMap<String, SimpleStatusInstance> = BTreeMap::new();

    let even = direct_attack_weight_scale(&atk, &def, &empty, &empty);
    assert!((even - 1.0).abs() < 1e-12, "equal weights scale by 1: got {even}");

    let mut corroded_defender: BTreeMap<String, SimpleStatusInstance> = BTreeMap::new();
    corroded_defender.insert(
        "Corrosion_Status".to_string(),
        instance(40.0),
    );
    let against_corroded = direct_attack_weight_scale(&atk, &def, &empty, &corroded_defender);
    assert!(
        against_corroded > even,
        "a corroded defender is lighter, so the payload scales higher: {against_corroded} vs {even}"
    );

    // And the same Corrosion on the attacker cuts its own payload back.
    let while_corroded = direct_attack_weight_scale(&atk, &def, &corroded_defender, &empty);
    assert!(
        while_corroded <= even,
        "a corroded attacker cannot scale above even weights: got {while_corroded}"
    );
}
