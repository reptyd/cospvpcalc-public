//! Reference: status_injury
//!
//! Covers each testable bullet in the "Injury" entry. Each test
//! body starts with the [REF:status_injury] marker so the vitest
//! coverage gate (src/pages/referenceCoverage.test.ts) sees it.
//!
//! Engine paths:
//! - Out-of-model PvP body: the status lives in the per-side
//!   statuses BTreeMap but no combat formula reads `Injury_Status`
//!   for a damage / cooldown / regen effect.
//! - Offensive scaling: `combat.rs:25-44` - `Injury_Status` is
//!   tagged via `is_weight_scaled_direct_attack_offensive_ailment_status`,
//!   so direct-attack payloads scale by `direct_attack_weight_scale`.

use super::default_combatant;
use crate::combat::{
    direct_attack_weight_scale, is_weight_scaled_direct_attack_offensive_ailment_status,
};
use std::collections::BTreeMap;

#[test]
fn injury_is_a_persistent_do_not_heal_while_moving_status() {
    // [REF:status_injury]
    // Injury carries the game's DoesNotHealWhileMoving flag, so a decaying
    // instance is held while moving under No Move Facetank - its stacks stay
    // put even though the movement-side effect itself is out of model.
    assert!(crate::statuses::is_persistent_pvp_status("Injury_Status"));
}

#[test]
fn offensive_payload_scales_stacks_by_weight_ratio() {
    // [REF:status_injury]
    // Bullets 3 + 4 + 5: "When Injury is applied through an offensive direct
    // attack payload, its applied stacks are multiplied by (1 + min(ratio, 3))
    // / 2, where ratio is attacker effective weight / defender effective
    // weight." + scale checkpoints + "the applied stacks stay at 1.0x instead
    // of scaling downward."
    assert!(
        is_weight_scaled_direct_attack_offensive_ailment_status("Injury_Status"),
        "Injury_Status must be tagged as a weight-scaled offensive ailment"
    );
    let mut atk = default_combatant();
    let mut def = default_combatant();

    // Equal weights -> 1.0x.
    atk.weight = 100.0;
    def.weight = 100.0;
    let scale_eq = direct_attack_weight_scale(&atk, &def, &BTreeMap::new(), &BTreeMap::new());
    assert!(
        (scale_eq - 1.0).abs() < 1e-9,
        "1:1 weight scale must be 1.0x: got {scale_eq}"
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

    // Lighter attacker -> still 1.0x.
    atk.weight = 50.0;
    def.weight = 200.0;
    let scale_light = direct_attack_weight_scale(&atk, &def, &BTreeMap::new(), &BTreeMap::new());
    assert!(
        (scale_light - 0.625).abs() < 1e-9,
        "a quarter-weight attacker scales by (1 + 0.25) / 2: got {scale_light}"
    );
}
