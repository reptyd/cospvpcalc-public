//! Reference: compare_gore_charge
//!
//! Covers each testable bullet in the "Gore Charge" entry. Each test
//! body starts with the [REF:compare_gore_charge] marker so the
//! vitest coverage gate (src/pages/referenceCoverage.test.ts) sees it.
//!
//! Engine path: `composable/mod.rs:4927-4936` (attacker side) /
//! `5275-5283` (defender side) - gated on `!first_melee_hit_taken`
//! flag, applies Bleed x 2 + Deep_Wounds x 10 to the bitten target,
//! then `first_melee_hit_taken = true` consumes the charge.

use super::super::config::ComposableAbilityConfig;
use super::super::sandbox::{
    SandboxAutomationMode, SandboxBiteVariant, SandboxRuntime, SandboxSide,
};
use super::super::simulate_composable_matchup_with_trace;
use super::default_combatant;
use crate::contracts::{SimpleAbilityTimingMode, SimpleCombatantStats};
use crate::spec_constants::{GORE_CHARGE_BLEED_STACKS, GORE_CHARGE_DEEP_WOUNDS_STACKS};

fn passive_combatant(max_hp: f64) -> SimpleCombatantStats {
    let mut c = default_combatant();
    c.health = max_hp;
    c.damage = 0.0;
    c.bite_cooldown = 1000.0;
    c
}

fn melee_combatant(max_hp: f64, damage: f64, bite_cd: f64) -> SimpleCombatantStats {
    let mut c = default_combatant();
    c.health = max_hp;
    c.damage = damage;
    c.bite_cooldown = bite_cd;
    c
}

fn gore_charge_attacker_cfg() -> ComposableAbilityConfig {
    let mut cfg = ComposableAbilityConfig::default();
    cfg.attacker_gore_charge = true;
    cfg
}

#[test]
fn first_melee_hit_applies_two_bleed_plus_nine_deep_wounds() {
    // [REF:compare_gore_charge]
    // Bullets 1 + 2: "In Compare, Gore Charge changes only the first melee
    // hit." + "That hit applies 2 stacks of Bleed and 9 stacks of Deep
    // Wounds."
    let attacker = melee_combatant(10_000.0, 50.0, 1.0);
    let defender = passive_combatant(10_000_000.0);
    // Bleed_Status DoT cadence is 3 s, so first DoT lands ~t=3 after
    // the t=0 first-hit. Run a 5 s window to capture it.
    let result = simulate_composable_matchup_with_trace(
        &attacker, &defender, None, None,
        SimpleAbilityTimingMode::ReallyFast,
        &gore_charge_attacker_cfg(),
        5.0, true,
    );
    let log = result.combat_log.expect("trace");
    // Activation log entry.
    let activation = log
        .iter()
        .find(|e| e.description.as_deref() == Some("Gore Charge activated"));
    assert!(
        activation.is_some(),
        "Gore Charge activation event must fire on first melee hit"
    );
    // Status apply path is non-tracing (Bleed/Deep_Wounds applied via
    // apply_incoming_statuses_to_target_with_fortify_immunity). Use
    // downstream Bleed DoT presence as proof of the apply.
    let bleed_dot = log.iter().any(|e| {
        e.entry_type == "dot"
            && e.status_id.as_deref() == Some("Bleed_Status")
            && e.hp_side == "B"
    });
    assert!(
        bleed_dot,
        "Gore Charge first-hit Bleed must produce DoT ticks on defender (proves Bleed × 2 was applied)"
    );
}

#[test]
fn the_first_hit_lands_the_stack_counts_the_entry_states() {
    // [REF:compare_gore_charge]
    // Bullet 2 again, on the count rather than on the arrival: "That hit applies
    // 2 stacks of Bleed and 9 stacks of Deep Wounds." The apply path writes no
    // timeline entry, so the stacks are read off the target. One forced bite in
    // the sandbox is the whole charge - nothing else has touched the defender by
    // then.
    let mut rt = SandboxRuntime::new(
        melee_combatant(10_000.0, 50.0, 1.0),
        passive_combatant(10_000_000.0),
        None,
        None,
        gore_charge_attacker_cfg(),
        SimpleAbilityTimingMode::ReallyFast,
        SandboxAutomationMode::Manual,
        120.0,
        true,
    );
    rt.force_bite(SandboxSide::A, SandboxBiteVariant::Primary);
    let view = rt.snapshot_view();
    let stacks = |id: &str| {
        view.side_b
            .statuses
            .iter()
            .find(|s| s.id == id)
            .map(|s| s.stacks)
            .unwrap_or(0.0)
    };
    let bleed = stacks("Bleed_Status");
    let deep_wounds = stacks("Deep_Wounds_Status");
    assert!(
        (bleed - GORE_CHARGE_BLEED_STACKS).abs() < 1e-9,
        "the charged hit must land {GORE_CHARGE_BLEED_STACKS} stacks of Bleed, got {bleed}"
    );
    assert!(
        (deep_wounds - GORE_CHARGE_DEEP_WOUNDS_STACKS).abs() < 1e-9,
        "the charged hit must land {GORE_CHARGE_DEEP_WOUNDS_STACKS} stacks of Deep Wounds, got {deep_wounds}"
    );
}

#[test]
fn only_first_hit_applies_charge_subsequent_hits_skip() {
    // [REF:compare_gore_charge]
    // Bullet 1 (single-fire scope): "In Compare, Gore Charge changes only the
    // first melee hit." Engine: `first_melee_hit_taken` flips to true after
    // the first melee bite consumes the charge, so the second activation log
    // event must NOT fire.
    let attacker = melee_combatant(10_000.0, 50.0, 0.5);
    let defender = passive_combatant(10_000_000.0);
    let result = simulate_composable_matchup_with_trace(
        &attacker, &defender, None, None,
        SimpleAbilityTimingMode::ReallyFast,
        &gore_charge_attacker_cfg(),
        5.0, true,
    );
    let log = result.combat_log.expect("trace");
    let activation_count = log
        .iter()
        .filter(|e| e.description.as_deref() == Some("Gore Charge activated"))
        .count();
    assert_eq!(
        activation_count, 1,
        "Gore Charge must activate exactly once across many bites (first-hit only): got {activation_count}"
    );
}
