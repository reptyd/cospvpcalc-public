//! Reference: status_radiation
//!
//! Radiation is a fully-fledged ailment whose signature effect is lowering the
//! target's positive ailment blocks for every OTHER ailment, plus a small flat
//! 0.5% max-HP DOT. The block-reduction lives at the single status-apply
//! chokepoint (`statuses::apply_status_application_in_place`), so it covers all
//! carriers (Attack/Block/Defensive/Aura/Lance/Trail/Totem) that route through
//! `apply_incoming_statuses_to_target[_with_fortify_immunity]`.
//!
//! Each test body carries a [REF:<id>] marker so the vitest coverage gate sees
//! it. The status_* tests drive the math through the public `statuses` API; the
//! ability_* test drives a carrier (Aura (Radiation)) end-to-end.

use std::collections::BTreeMap;

use super::super::config::ComposableAbilityConfig;
use super::super::simulate_composable_matchup_with_trace;
use super::{default_breath, default_combatant};
use crate::contracts::{SimpleAbilityTimingMode, SimpleCombatantStats};
use crate::spec_constants::RADIATION_DOT_PCT_MAX_HP;
use crate::statuses::{
    apply_incoming_statuses_to_target, apply_simple_status, compute_simple_dot_damage,
    status_max_stacks,
};
use crate::{SimpleAppliedStatus, SimpleStatusInstance};

fn passive_combatant(max_hp: f64) -> SimpleCombatantStats {
    let mut c = default_combatant();
    c.health = max_hp;
    c.damage = 0.0;
    c.bite_cooldown = 1000.0;
    c
}

fn seed_status(statuses: &mut BTreeMap<String, SimpleStatusInstance>, id: &str, stacks: f64) {
    let mut slot = statuses.get(id).cloned();
    apply_simple_status(0.0, id, stacks, &mut slot);
    if let Some(inst) = slot {
        statuses.insert(id.to_string(), inst);
    }
}

/// Apply a single status to a fresh target carrying the given native /
/// plushie block on `block_status_id`, with `radiation` Radiation stacks
/// already present, and return the resulting stack count of `apply_id`.
fn applied_stacks_with_radiation(
    block_status_id: &str,
    native_block: f64,
    plushie_block: f64,
    radiation: f64,
    apply_id: &str,
    apply_stacks: f64,
) -> f64 {
    let mut target = passive_combatant(10_000_000.0);
    if native_block != 0.0 {
        target
            .status_resist_fractions
            .insert(block_status_id.to_string(), native_block);
    }
    if plushie_block != 0.0 {
        target
            .plushie_status_block_fractions
            .insert(block_status_id.to_string(), plushie_block);
    }
    let mut statuses: BTreeMap<String, SimpleStatusInstance> = BTreeMap::new();
    if radiation > 0.0 {
        seed_status(&mut statuses, "Radiation_Status", radiation);
    }
    let target_hp = target.health;
    apply_incoming_statuses_to_target(
        0.0,
        &target,
        target_hp,
        &mut statuses,
        &[SimpleAppliedStatus {
            status_id: apply_id.to_string(),
            stacks: apply_stacks,
            ..Default::default()
        }],
    );
    let radiation_seeded = if apply_id == "Radiation_Status" { radiation } else { 0.0 };
    statuses
        .get(apply_id)
        .map(|s| s.stacks)
        .unwrap_or(0.0)
        - radiation_seeded
}

#[test]
fn block_reduction_guts_other_ailment_block_at_full_stacks() {
    // [REF:status_radiation]
    // 99 Radiation stacks reduce a positive ailment block by 99% (keep = 1%).
    // A target with 50% Poison block hit by 100 Poison normally takes 50;
    // with 99 Radiation the block falls to 0.5%, so ~99.5 stacks land.
    let baseline = applied_stacks_with_radiation("Poison_Status", 0.5, 0.0, 0.0, "Poison_Status", 100.0);
    assert!(
        (baseline - 50.0).abs() < 1e-6,
        "sanity: 50% block on 100 Poison should land 50, got {baseline}"
    );
    let radiated = applied_stacks_with_radiation("Poison_Status", 0.5, 0.0, 99.0, "Poison_Status", 100.0);
    assert!(
        (radiated - 99.5).abs() < 1e-6,
        "99 Radiation should cut 50% Poison block to 0.5%, landing ~99.5 of 100, got {radiated}"
    );
}

#[test]
fn block_reduction_follows_the_stacking_formula() {
    // [REF:status_radiation]
    // reduction = 99 * ((x/99)^2.5) percent, multiplicative on the block.
    // At 50 stacks: reduction = 0.99 * (50/99)^2.5 of the block.
    let stacks = 50.0_f64;
    let reduction = 0.99 * (stacks / 99.0).powf(2.5);
    let kept_block = 0.5 * (1.0 - reduction);
    let expected = 100.0 * (1.0 - kept_block);
    let got = applied_stacks_with_radiation("Poison_Status", 0.5, 0.0, stacks, "Poison_Status", 100.0);
    assert!(
        (got - expected).abs() < 1e-6,
        "50-stack Radiation block reduction mismatch: expected {expected}, got {got}"
    );
}

#[test]
fn block_reduction_also_lowers_plushie_block() {
    // [REF:status_radiation]
    // The reduction applies to plushie ailment block too, not just native.
    // 40% plushie Poison block on 100 Poison normally lands 60; with 99
    // Radiation the plushie block falls to 0.4%, so ~99.6 land.
    let baseline = applied_stacks_with_radiation("Poison_Status", 0.0, 0.4, 0.0, "Poison_Status", 100.0);
    assert!((baseline - 60.0).abs() < 1e-6, "sanity plushie baseline, got {baseline}");
    let radiated = applied_stacks_with_radiation("Poison_Status", 0.0, 0.4, 99.0, "Poison_Status", 100.0);
    assert!(
        (radiated - 99.6).abs() < 1e-6,
        "99 Radiation should cut 40% plushie block to 0.4%, landing ~99.6, got {radiated}"
    );
}

#[test]
fn umbrella_elder_block_is_not_reduced_by_radiation() {
    // [REF:status_radiation]
    // The umbrella all-ailment block (elder BlockAilment) is not in Radiation's
    // target list, so it stays intact while the specific per-ailment block is
    // gutted. Target: 50% native Poison block (specific, reducible) + 20% elder
    // umbrella block (immune). With 99 Radiation the native block falls to 0.5%
    // but the 20% umbrella holds, so total block = 0.5% + 20% = 20.5% and ~79.5
    // of 100 Poison land. If the umbrella were reducible it would fall to ~0.2%
    // and ~99.3 would land instead.
    let mut target = passive_combatant(10_000_000.0);
    target
        .status_resist_fractions
        .insert("Poison_Status".to_string(), 0.5);
    target.elder_block_fraction = 0.2;
    let mut statuses: BTreeMap<String, SimpleStatusInstance> = BTreeMap::new();
    seed_status(&mut statuses, "Radiation_Status", 99.0);
    let target_hp = target.health;
    apply_incoming_statuses_to_target(
        0.0,
        &target,
        target_hp,
        &mut statuses,
        &[SimpleAppliedStatus {
            status_id: "Poison_Status".to_string(),
            stacks: 100.0,
            ..Default::default()
        }],
    );
    let landed = statuses.get("Poison_Status").map(|s| s.stacks).unwrap_or(0.0);
    let keep = 1.0 - 0.99 * (99.0_f64 / 99.0).powf(2.5);
    let expected = 100.0 * (1.0 - (0.5 * keep + 0.2));
    assert!(
        (landed - expected).abs() < 1e-6,
        "Radiation must gut the specific block but leave the 20% umbrella intact: expected {expected}, got {landed}"
    );
}

#[test]
fn ailment_weaknesses_are_not_altered() {
    // [REF:status_radiation]
    // Negative blocks (weaknesses) amplify incoming stacks and Radiation must
    // leave them untouched. -50% Poison block on 100 Poison lands 150 with or
    // without Radiation present.
    let no_rad = applied_stacks_with_radiation("Poison_Status", -0.5, 0.0, 0.0, "Poison_Status", 100.0);
    let with_rad = applied_stacks_with_radiation("Poison_Status", -0.5, 0.0, 99.0, "Poison_Status", 100.0);
    assert!((no_rad - 150.0).abs() < 1e-6, "weakness baseline should land 150, got {no_rad}");
    assert!(
        (with_rad - 150.0).abs() < 1e-6,
        "Radiation must not alter a negative (weakness) block: expected 150, got {with_rad}"
    );
}

#[test]
fn radiation_does_not_reduce_its_own_block() {
    // [REF:status_radiation]
    // Radiation lowers resistance to OTHER ailments, never to itself. A target
    // with 50% Radiation block and 50 Radiation stacks, hit by 10 more
    // Radiation, still applies the full 50% block (5 land, total 55) - not the
    // reduced block it would apply to any other ailment.
    let got = applied_stacks_with_radiation("Radiation_Status", 0.5, 0.0, 50.0, "Radiation_Status", 10.0);
    assert!(
        (got - 5.0).abs() < 1e-6,
        "Radiation's own block must be unreduced: expected 5 fresh stacks, got {got}"
    );
}

#[test]
fn dot_is_flat_half_percent_max_hp_regardless_of_stacks() {
    // [REF:status_radiation]
    // 0.5% max HP per tick, unscaling - identical at 1 and 99 stacks.
    let max_hp = 10_000.0;
    let at_one = compute_simple_dot_damage(max_hp, "Radiation_Status", 1.0);
    let at_max = compute_simple_dot_damage(max_hp, "Radiation_Status", 99.0);
    let expected = max_hp * RADIATION_DOT_PCT_MAX_HP / 100.0;
    assert!(
        (at_one - expected).abs() < 1e-9,
        "{RADIATION_DOT_PCT_MAX_HP}% of 10000 should be {expected}, got {at_one}"
    );
    assert!(
        (at_max - at_one).abs() < 1e-9,
        "Radiation DOT must not scale with stacks: {at_max} vs {at_one}"
    );
}

#[test]
fn stacks_cap_at_ninety_nine() {
    // [REF:status_radiation]
    assert_eq!(status_max_stacks("Radiation_Status"), Some(99.0));
    let mut statuses: BTreeMap<String, SimpleStatusInstance> = BTreeMap::new();
    seed_status(&mut statuses, "Radiation_Status", 60.0);
    seed_status(&mut statuses, "Radiation_Status", 60.0);
    let stacks = statuses.get("Radiation_Status").map(|s| s.stacks).unwrap_or(0.0);
    assert!(
        (stacks - 99.0).abs() < 1e-9,
        "Radiation must cap at 99 stacks (60+60), got {stacks}"
    );
}

#[test]
fn radiation_status_is_fortify_removable() {
    // [REF:status_radiation]
    // Polarity negative => Fortify cleanses it (registry path).
    assert!(crate::statuses::is_fortify_removable_status("Radiation_Status"));
}

#[test]
fn aura_radiation_applies_radiation_status() {
    // [REF:status_radiation]
    // Radiation deploys through the standard carriers; verify the generic Aura
    // mechanism applies Radiation_Status when its subtype is "Radiation"
    // (3 stacks every 3 s, first tick at t=3). This is the same code path the
    // legacy Corrosion aura uses - only the carried ailment changes.
    let attacker = passive_combatant(1_000.0);
    let defender = passive_combatant(10_000_000.0);
    let mut cfg = ComposableAbilityConfig::default();
    cfg.attacker_aura_subtype = Some("Radiation".to_string());
    let result = simulate_composable_matchup_with_trace(
        &attacker, &defender, None, None,
        SimpleAbilityTimingMode::Fast,
        &cfg,
        11.0, true,
    );
    let log = result.combat_log.expect("trace log");
    let radiation_applies: Vec<&_> = log
        .iter()
        .filter(|e| {
            e.status_id.as_deref() == Some("Radiation_Status")
                && e.description.as_deref().is_some_and(|d| d.contains("applied"))
        })
        .collect();
    assert_eq!(
        radiation_applies.len(),
        3,
        "expected 3 Radiation apply events at t=3, 6, 9 in an 11 s window, got {}",
        radiation_applies.len()
    );
    let times: Vec<f64> = radiation_applies.iter().map(|e| e.time).collect();
    for (got, want) in times.iter().zip([3.0, 6.0, 9.0].iter()) {
        assert!(
            (got - want).abs() < 1e-9,
            "Radiation aura apply timing mismatch: expected {want}, got {got} (all={times:?})"
        );
    }
    let first_detail = radiation_applies[0].detail.as_deref().unwrap_or("");
    assert!(
        first_detail.contains("0 -> 3") || first_detail.contains("0.0 -> 3"),
        "first Radiation aura apply must add 3 stacks (0 -> 3), got detail={first_detail}"
    );
}

#[test]
fn totem_radiation_applies_radiation_status() {
    // [REF:status_radiation]
    // Totem is ailment-parametric: "Totem Radiation" carries Radiation instead
    // of the default Poison. The carrier applies its status the same way (2
    // stacks every 3 s while placed); the status apply is non-tracing, so we
    // verify via the downstream Radiation DOT ticks it produces on the target.
    let attacker = passive_combatant(1_000.0);
    let defender = passive_combatant(10_000_000_000.0);
    let mut cfg = ComposableAbilityConfig::default();
    cfg.attacker_totem = true;
    cfg.attacker_totem_status_id = Some("Radiation_Status".to_string());
    let result = simulate_composable_matchup_with_trace(
        &attacker, &defender, None, None,
        SimpleAbilityTimingMode::ReallyFast,
        &cfg,
        60.0, true,
    );
    let log = result.combat_log.expect("trace log");
    let radiation_dots = log
        .iter()
        .filter(|e| e.entry_type == "dot" && e.status_id.as_deref() == Some("Radiation_Status"))
        .count();
    assert!(
        radiation_dots >= 10,
        "Totem Radiation must drive sustained Radiation DOT ticks, got {radiation_dots}"
    );
    // Sanity: it must NOT be applying Poison anymore.
    let poison_dots = log
        .iter()
        .filter(|e| e.entry_type == "dot" && e.status_id.as_deref() == Some("Poison_Status"))
        .count();
    assert_eq!(poison_dots, 0, "Totem Radiation must not apply Poison, got {poison_dots} Poison DOT ticks");
}

#[test]
fn trail_radiation_applies_radiation_status() {
    // [REF:status_radiation]
    // The generic trail channel carries any ailment. A Radiation trail with a
    // 100% HP threshold is always active; it deals 2% opponent max HP and
    // applies 2 Radiation stacks per tick. Verify via downstream Radiation DOT.
    let attacker = passive_combatant(1_000.0);
    let defender = passive_combatant(10_000_000_000.0);
    let mut cfg = ComposableAbilityConfig::default();
    cfg.attacker_trail_status_id = Some("Radiation_Status".to_string());
    cfg.attacker_trail_value = 100.0; // 100% HP threshold => always active
    let result = simulate_composable_matchup_with_trace(
        &attacker, &defender, None, None,
        SimpleAbilityTimingMode::Fast,
        &cfg,
        30.0, true,
    );
    let log = result.combat_log.expect("trace log");
    let radiation_dots = log
        .iter()
        .filter(|e| e.entry_type == "dot" && e.status_id.as_deref() == Some("Radiation_Status"))
        .count();
    assert!(
        radiation_dots >= 5,
        "Trail Radiation must drive Radiation DOT ticks on the opponent, got {radiation_dots}"
    );
}

#[test]
fn dot_scales_with_nearby_radiated_creatures() {
    // [REF:status_radiation]
    // 0.5% max HP per tick is additive across nearby radiated creatures: the
    // per-tick damage is multiplied by (1 self + N nearby extras + the other
    // fighter when it is radiated). Drive the tick handler directly via the
    // radiation_dot_mult parameter (the multiplier phase 12 computes).
    let tick = |mult: f64| {
        let mut statuses: BTreeMap<String, SimpleStatusInstance> = BTreeMap::new();
        seed_status(&mut statuses, "Radiation_Status", 5.0);
        let mut hp = 10_000.0;
        let mut dealt = 0.0;
        crate::statuses::handle_simple_dot_ticks_full(
            3.0, 10_000.0, 0.0, &mut hp, &mut statuses, &mut dealt, false, None, 1.0, false, false, mult, 1.0,
        );
        10_000.0 - hp
    };
    // Solo (mult 1) = 0.5% of 10000 = 50; flat / unscaling.
    assert!((tick(1.0) - 50.0).abs() < 1e-6, "solo Radiation tick must be 50, got {}", tick(1.0));
    // 1 nearby extra + opponent radiated => mult 3 => 150 (additive across sources).
    assert!((tick(3.0) - 150.0).abs() < 1e-6, "mult-3 Radiation tick must be 150, got {}", tick(3.0));
}

#[test]
fn zeoarex_like_combined_carriers_run_to_completion() {
    // Regression repro for "battles with Zeoarex don't run": after the wiki
    // sync Zeoarex is simultaneously a Lance (Radiation) breather, a Totem
    // (Radiation) placer, and a Radiation-trail carrier. Run a full-length sim
    // with all three (+ nearby-radiated) at once: it has to reach a decided
    // outcome, and each carrier has to still be deploying - a repro that
    // quietly stops driving all three carriers stops reproducing.
    let mut attacker = default_combatant();
    attacker.health = 1500.0;
    attacker.weight = 2200.0;
    attacker.damage = 80.0;
    attacker.bite_cooldown = 1.0;
    let defender = passive_combatant(5_000.0);
    let mut breath = default_breath();
    breath.special_kind = Some("lance".to_string());
    breath.lance_charge_sec = 3.0;
    breath.lance_damage_pct = 5.0;
    breath.lance_cooldown_sec = 60.0;
    breath.lance_status_id = Some("Radiation_Status".to_string());
    let mut cfg = ComposableAbilityConfig::default();
    cfg.attacker_totem = true;
    cfg.attacker_totem_status_id = Some("Radiation_Status".to_string());
    cfg.attacker_trail_status_id = Some("Radiation_Status".to_string());
    cfg.attacker_trail_value = 0.5;
    cfg.radiation_nearby_count = 3.0;
    let result = simulate_composable_matchup_with_trace(
        &attacker, &defender, Some(&breath), None,
        SimpleAbilityTimingMode::Fast, &cfg, 300.0, true,
    );
    let log = result.combat_log.as_ref().expect("trace");
    let death = result
        .death_time_b
        .expect("the combined-carrier fight must resolve, not stall out the horizon");
    assert!(
        death < 300.0,
        "the defender must die inside the window, got {death}"
    );
    let count = |pred: &dyn Fn(&crate::contracts::CombatLogEntry) -> bool| {
        log.iter().filter(|e| pred(e)).count()
    };
    assert!(
        count(&|e| e.entry_type == "breath") > 0,
        "the Lance carrier must fire in the repro"
    );
    assert!(
        count(&|e| e.description.as_deref().is_some_and(|d| d.starts_with("Totem applied"))) > 0,
        "the Totem carrier must place its ailment in the repro"
    );
    assert!(
        count(&|e| e.entry_type == "dot" && e.status_id.as_deref() == Some("Radiation_Status")) > 0,
        "the carriers must land Radiation on the defender in the repro"
    );
}
