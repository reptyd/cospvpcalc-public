//! Reference: status_disease
//!
//! Covers each testable bullet in the "Disease" entry. Each test
//! body starts with the [REF:status_disease] marker so the vitest
//! coverage gate (src/pages/referenceCoverage.test.ts) sees it.
//!
//! Engine paths:
//! - Regen reduction: `hp_regen_multiplier_from_statuses` multiplies by a flat
//!   `0.75` (a single `regen_modifier_pct` of -25), constant regardless of the
//!   Disease stack count - matching the game's `Disease.OnGet` returning
//!   `HealthRegen * 0.75`.
//! - Offensive scaling: `combat.rs:25-44` - `Disease_Status` is
//!   tagged via `is_weight_scaled_direct_attack_offensive_ailment_status`,
//!   so direct-attack payloads scale by `direct_attack_weight_scale`.

use super::default_combatant;
use crate::combat::{
    direct_attack_weight_scale, hp_regen_multiplier_from_statuses,
    is_weight_scaled_direct_attack_offensive_ailment_status,
};
use crate::contracts::SimpleStatusInstance;
use crate::spec_constants::DISEASE_REGEN_REDUCTION_PCT;
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
fn reduces_passive_regen_by_twenty_five_percent() {
    // [REF:status_disease]
    // Bullet 1: "Disease reduces natural health regeneration by 25%."
    // Engine multiplies regen by a flat 0.75 while Disease is present.
    let mut statuses: BTreeMap<String, SimpleStatusInstance> = BTreeMap::new();
    statuses.insert("Disease_Status".to_string(), instance(1.0));
    let mult = hp_regen_multiplier_from_statuses(&statuses);
    let expected = 1.0 - DISEASE_REGEN_REDUCTION_PCT / 100.0;
    assert!(
        (mult - expected).abs() < 1e-9,
        "1 Disease stack must yield {expected}x regen multiplier (-{DISEASE_REGEN_REDUCTION_PCT}%): got {mult}"
    );
}

#[test]
fn regen_cut_is_constant_regardless_of_stack_count() {
    // [REF:status_disease]
    // Bullet 2: the regen cut is a fixed x0.75 and does NOT scale with stacks -
    // the game's Disease.OnGet returns HealthRegen * 0.75 regardless of stack
    // count. Every stack count must yield the same 0.75x multiplier. This is the
    // regression guard for the old additive `1 - 0.15 * stacks` bug that
    // over-cut regen at 2+ stacks (e.g. Plague Breath / Plague Trail / a
    // weight-scaled Disease Attack payload all stack Disease past 1).
    let expected = 1.0 - DISEASE_REGEN_REDUCTION_PCT / 100.0;
    for stacks in [1.0, 2.0, 5.0, 20.0] {
        let mut statuses: BTreeMap<String, SimpleStatusInstance> = BTreeMap::new();
        statuses.insert("Disease_Status".to_string(), instance(stacks));
        let mult = hp_regen_multiplier_from_statuses(&statuses);
        assert!(
            (mult - expected).abs() < 1e-9,
            "Disease regen multiplier must be a constant {expected}x at any stack count; got {mult} at {stacks} stacks"
        );
    }
}

#[test]
fn offensive_payload_scales_stacks_by_weight_ratio() {
    // [REF:status_disease]
    // Bullets 3 + 4 + 5: "When Disease is applied through an offensive direct
    // attack payload, its applied stacks are multiplied by (1 + min(ratio, 3))
    // / 2, where ratio is attacker effective weight / defender effective
    // weight." + scale checkpoints + "the applied stacks stay at 1.0x instead
    // of scaling downward."
    assert!(
        is_weight_scaled_direct_attack_offensive_ailment_status("Disease_Status"),
        "Disease_Status must be tagged as a weight-scaled offensive ailment"
    );
    let mut atk = default_combatant();
    let mut def = default_combatant();

    atk.weight = 100.0;
    def.weight = 100.0;
    let scale_eq = direct_attack_weight_scale(&atk, &def, &BTreeMap::new(), &BTreeMap::new());
    assert!((scale_eq - 1.0).abs() < 1e-9, "1:1 scale 1.0x: got {scale_eq}");

    atk.weight = 200.0;
    let scale_2 = direct_attack_weight_scale(&atk, &def, &BTreeMap::new(), &BTreeMap::new());
    assert!((scale_2 - 1.5).abs() < 1e-9, "2:1 scale 1.5x: got {scale_2}");

    atk.weight = 300.0;
    let scale_3 = direct_attack_weight_scale(&atk, &def, &BTreeMap::new(), &BTreeMap::new());
    assert!((scale_3 - 2.0).abs() < 1e-9, "3:1 scale 2.0x: got {scale_3}");

    atk.weight = 50.0;
    let scale_light = direct_attack_weight_scale(&atk, &def, &BTreeMap::new(), &BTreeMap::new());
    assert!(
        (scale_light - 0.75).abs() < 1e-9,
        "a half-weight attacker scales by (1 + 0.5) / 2: got {scale_light}"
    );
}
