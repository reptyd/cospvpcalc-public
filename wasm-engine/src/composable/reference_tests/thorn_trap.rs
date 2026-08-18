//! Reference: ability_thorn_trap
//!
//! Covers each testable bullet in the "Thorn Trap" entry. Each test
//! body starts with the [REF:ability_thorn_trap] marker so the vitest
//! coverage gate (src/pages/referenceCoverage.test.ts) sees it.
//!
//! Engine path: `composable/mod.rs:2367-2410` (Phase 4r). On
//! activation the engine applies Bleed x 6 and Freeze x 2 to the
//! defender via `apply_incoming_statuses_to_target_with_fortify_immunity`,
//! sets a 35 s cooldown, and emits a "Thorn Trap activated" log entry.

use super::super::config::ComposableAbilityConfig;
use super::super::sandbox::{SandboxAutomationMode, SandboxRuntime, SandboxSide};
use super::super::simulate_composable_matchup_with_trace;
use super::default_combatant;
use crate::contracts::{SimpleAbilityTimingMode, SimpleCombatantStats};
use crate::spec_constants::{
    THORN_TRAP_BLEED_STACKS, THORN_TRAP_COOLDOWN_SEC, THORN_TRAP_DAMAGE_PCT_MAX_HP,
    THORN_TRAP_FREEZE_STACKS,
};

fn passive_combatant(max_hp: f64) -> SimpleCombatantStats {
    let mut c = default_combatant();
    c.health = max_hp;
    c.damage = 0.0;
    c.bite_cooldown = 1000.0;
    c
}

fn thorn_trap_attacker_cfg() -> ComposableAbilityConfig {
    let mut cfg = ComposableAbilityConfig::default();
    cfg.attacker_thorn_trap = true;
    cfg
}

fn activation_times(
    attacker: &SimpleCombatantStats,
    defender: &SimpleCombatantStats,
    cfg: &ComposableAbilityConfig,
    max_time_sec: f64,
) -> Vec<f64> {
    let result = simulate_composable_matchup_with_trace(
        attacker, defender, None, None,
        SimpleAbilityTimingMode::ReallyFast,
        cfg, max_time_sec, true,
    );
    let log = result.combat_log.expect("trace log requested");
    log.iter()
        .filter(|e| {
            e.entry_type == "ability"
                && e.attacker == "A"
                && e.description.as_deref() == Some("Thorn Trap activated")
        })
        .map(|e| e.time)
        .collect()
}

#[test]
fn applies_six_bleed_and_two_freeze_immediately_when_used() {
    // [REF:ability_thorn_trap]
    // Bullets 4 + 5: "Thorn Trap applies 6 stacks of Bleed immediately when it
    // is used." + "It also applies 2 stacks of Freeze immediately." Engine:
    // Phase 4r at activation calls
    // `apply_incoming_statuses_to_target_with_fortify_immunity` with Bleed x 6
    // + Freeze x 2 on the defender.
    let attacker = passive_combatant(1_000.0);
    let defender = passive_combatant(10_000_000.0);
    let result = simulate_composable_matchup_with_trace(
        &attacker, &defender, None, None,
        SimpleAbilityTimingMode::ReallyFast,
        &thorn_trap_attacker_cfg(),
        1.0, true,
    );
    let log = result.combat_log.expect("trace log");
    // Verify activation event fires.
    let activation = log
        .iter()
        .find(|e| e.description.as_deref() == Some("Thorn Trap activated"));
    assert!(activation.is_some(), "Thorn Trap must activate immediately");
    // Bleed and Freeze are statuses with engine-side decay/effects;
    // their apply does not push to combat_log via this path, but
    // Bleed DoT ticks should appear in the trace shortly after as
    // proof. Run a longer window to capture Bleed DoT.
    let extended = simulate_composable_matchup_with_trace(
        &attacker, &defender, None, None,
        SimpleAbilityTimingMode::ReallyFast,
        &thorn_trap_attacker_cfg(),
        4.0, true,
    );
    let extended_log = extended.combat_log.expect("trace");
    let bleed_dot = extended_log.iter().any(|e| {
        e.entry_type == "dot"
            && e.status_id.as_deref() == Some("Bleed_Status")
            && e.attacker == "A"
    });
    assert!(
        bleed_dot,
        "Thorn Trap-applied Bleed must produce DoT ticks (proves Bleed × 6 was applied)"
    );
}

#[test]
fn lands_the_stack_counts_the_entry_states() {
    // [REF:ability_thorn_trap]
    // Bullets 4 + 5 on the counts rather than on the arrival: 6 stacks of Bleed
    // and 2 of Freeze. The Bleed DoT above proves only that some Bleed is there,
    // and Freeze does nothing observable at all, so both are read off the target
    // after a single activation.
    let mut rt = SandboxRuntime::new(
        passive_combatant(1_000.0),
        passive_combatant(10_000_000.0),
        None,
        None,
        thorn_trap_attacker_cfg(),
        SimpleAbilityTimingMode::ReallyFast,
        SandboxAutomationMode::Manual,
        120.0,
        true,
    );
    assert!(
        rt.force_ability(SandboxSide::A, "Thorn Trap"),
        "Thorn Trap must be a name the sandbox recognises"
    );
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
    let freeze = stacks("Freeze_Status");
    assert!(
        (bleed - THORN_TRAP_BLEED_STACKS).abs() < 1e-9,
        "Thorn Trap must apply {THORN_TRAP_BLEED_STACKS} stacks of Bleed, got {bleed}"
    );
    assert!(
        (freeze - THORN_TRAP_FREEZE_STACKS).abs() < 1e-9,
        "Thorn Trap must apply {THORN_TRAP_FREEZE_STACKS} stacks of Freeze, got {freeze}"
    );
}

#[test]
fn deals_flat_five_percent_max_hp_on_trigger_not_weight_scaled() {
    // [REF:ability_thorn_trap]
    // "Thorn Trap deals direct damage equal to 5% of the target's max HP when
    // it triggers" + "a flat one-time hit: not weight-scaled". A heavy attacker
    // (3:1 weight) still deals exactly 5% - unlike Lance, the trap damage does
    // not weight-scale.
    let mut attacker = passive_combatant(1_000.0);
    attacker.weight = 300.0;
    let mut defender = passive_combatant(10_000.0);
    defender.weight = 100.0;
    let result = simulate_composable_matchup_with_trace(
        &attacker, &defender, None, None,
        SimpleAbilityTimingMode::ReallyFast,
        &thorn_trap_attacker_cfg(),
        1.0, true,
    );
    let log = result.combat_log.expect("trace log");
    let impact = log
        .iter()
        .find(|e| e.description.as_deref() == Some("Thorn Trap impact"))
        .expect("Thorn Trap must deal an impact hit on trigger");
    let expected = defender.health * THORN_TRAP_DAMAGE_PCT_MAX_HP / 100.0;
    assert!(
        (impact.damage - expected).abs() < 1e-6,
        "Thorn Trap impact must be a flat {THORN_TRAP_DAMAGE_PCT_MAX_HP}% of target maxHP ({expected}), not weight-scaled: got {}",
        impact.damage
    );
}

#[test]
fn cooldown_thirty_five_seconds() {
    // [REF:ability_thorn_trap]
    // Bullet 6: "It has a 35 second cooldown." First activation at t=0.5
    // (engine schedules `next_thorn_trap = 0.5` at simulation start); second
    // activation gated until cooldown elapses at t=0.5 + 35 = 35.5.
    let mut attacker = passive_combatant(1_000_000.0);
    attacker.bite_cooldown = 5.0;
    attacker.damage = 1.0; // keep loop alive
    let defender = passive_combatant(10_000_000_000.0);

    let activations = activation_times(&attacker, &defender, &thorn_trap_attacker_cfg(), 50.0);
    assert!(
        activations.len() >= 2,
        "Thorn Trap must fire at least twice in a 50 s window: {activations:?}"
    );
    let gap = activations[1] - activations[0];
    assert!(
        (gap - THORN_TRAP_COOLDOWN_SEC).abs() < 1.0,
        "second Thorn Trap activation must land ~{THORN_TRAP_COOLDOWN_SEC} s after the first, got {gap}: {activations:?}"
    );
}
