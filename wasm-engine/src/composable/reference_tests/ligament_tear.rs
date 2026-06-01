//! Reference: ability_ligament_tear
//!
//! Covers each testable bullet in the "Ligament Tear" entry. Each test
//! body starts with the [REF:ability_ligament_tear] marker so the
//! vitest coverage gate (src/pages/referenceCoverage.test.ts) sees it.
//!
//! Engine wiring: Ligament Tear has no dedicated path. It is a generic
//! offensive/defensive on-hit ability that maps to either
//! `on_hit_statuses` (offensive: applied to bitten target) or
//! `on_hit_taken_statuses` (defensive: applied to the biter when the
//! owner is bitten). Both are consumed via
//! `apply_statuses_with_per_effect_trace` in the bite phases
//! (`composable/mod.rs:4961, 5312`). The breath path
//! (`composable/breath.rs`) does not consume either field.

use super::super::config::ComposableAbilityConfig;
use super::super::simulate_composable_matchup_with_trace;
use super::{applied_status, default_breath, default_combatant};
use crate::contracts::{SimpleAbilityTimingMode, SimpleCombatantStats};

const TORN_LIGAMENTS_STATUS_ID: &str = "Torn_Ligaments_Status";

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

#[test]
fn offensive_application_on_bite_applies_torn_ligaments() {
    // [REF:ability_ligament_tear]
    // Bullet 1: "Offensive abilities apply their effect when the user
    // lands a bite."
    // Plus bullet 4: "Ligament Tear applies Torn Ligaments."
    // Setup: A holds Ligament Tear as offensive (on_hit_statuses with
    // Torn_Ligaments). A bites B → B receives Torn_Ligaments.
    let mut a = melee_combatant(10_000.0, 50.0, 1.0);
    a.on_hit_statuses = vec![applied_status(TORN_LIGAMENTS_STATUS_ID, 1.0)];
    let b = passive_combatant(10_000_000.0);

    let result = simulate_composable_matchup_with_trace(
        &a, &b, None, None,
        SimpleAbilityTimingMode::ReallyFast,
        &ComposableAbilityConfig::default(),
        2.0, true,
    );
    let log = result.combat_log.expect("trace log");
    let torn_apply = log.iter().any(|e| {
        e.status_id.as_deref() == Some(TORN_LIGAMENTS_STATUS_ID)
            && e.attacker == "A"
            && e.description.as_deref().is_some_and(|d| d.contains("applied"))
    });
    assert!(
        torn_apply,
        "offensive Ligament Tear must apply Torn_Ligaments_Status to the bitten target"
    );
}

#[test]
fn defensive_application_on_being_bitten_applies_torn_ligaments() {
    // [REF:ability_ligament_tear]
    // Bullet 2: "Defensive abilities apply their effect when the user
    // is bitten."
    // Setup: A holds Ligament Tear as defensive (on_hit_taken_statuses
    // with Torn_Ligaments). When B bites A, the engine applies
    // Torn_Ligaments to B (the biter).
    let mut a = passive_combatant(10_000.0);
    a.on_hit_taken_statuses = vec![applied_status(TORN_LIGAMENTS_STATUS_ID, 1.0)];
    let b = melee_combatant(10_000_000.0, 50.0, 1.0);

    let result = simulate_composable_matchup_with_trace(
        &a, &b, None, None,
        SimpleAbilityTimingMode::ReallyFast,
        &ComposableAbilityConfig::default(),
        2.0, true,
    );
    let log = result.combat_log.expect("trace log");
    // Source side is "B" (B bit A). Target side per
    // apply_statuses_with_per_effect_trace is the biter — events should
    // attribute the Torn_Ligaments apply to A's defensive payload
    // landing on B. Filter by status_id only and confirm any apply
    // event exists.
    let torn_apply = log.iter().any(|e| {
        e.status_id.as_deref() == Some(TORN_LIGAMENTS_STATUS_ID)
            && e.description.as_deref().is_some_and(|d| d.contains("applied"))
    });
    assert!(
        torn_apply,
        "defensive Ligament Tear must apply Torn_Ligaments_Status to the biter when the owner is bitten"
    );
}

#[test]
fn breath_does_not_trigger_ligament_tear() {
    // [REF:ability_ligament_tear]
    // Bullet 3: "Breath does not trigger Ligament Tear."
    // The engine's CombatSide initialises `next_hit = 0.0`, so a bite
    // event fires at t=0 even with `bite_cooldown = 1000`. With
    // `damage = 0` that first bite contributes no damage, but
    // `on_hit_statuses` still apply (the engine consumes them on
    // every bite event regardless of damage). With a long
    // bite_cooldown, only that single t=0 bite fires within a 5 s
    // window, so the Torn_Ligaments apply count must equal exactly 1
    // — proving the breath path does NOT add additional applies.
    let mut a = passive_combatant(10_000.0);
    a.on_hit_statuses = vec![applied_status(TORN_LIGAMENTS_STATUS_ID, 1.0)];
    a.bite_cooldown = 1000.0; // single bite at t=0, then idle
    let mut b = passive_combatant(10_000_000.0);
    b.weight = 100.0;
    let mut breath = default_breath();
    breath.dps_pct = 1.0;
    breath.capacity = 5.0;
    breath.regen_rate = 1.0;

    let result = simulate_composable_matchup_with_trace(
        &a, &b, Some(&breath), None,
        SimpleAbilityTimingMode::ReallyFast,
        &ComposableAbilityConfig::default(),
        5.0, true,
    );
    let log = result.combat_log.expect("trace log");
    let torn_apply_count = log
        .iter()
        .filter(|e| {
            e.status_id.as_deref() == Some(TORN_LIGAMENTS_STATUS_ID)
                && e.description.as_deref().is_some_and(|d| d.contains("applied"))
        })
        .count();
    // Sanity: the trace records exactly one bite event (t=0 only).
    let bite_count = log.iter().filter(|e| e.entry_type == "bite").count();
    // Bite events emit only when applied_melee_damage > 0; with
    // attacker damage=0 there's no "Bite hit" entry, but the
    // on-hit-status apply still happens — i.e. Torn_Ligaments apply
    // count of 1 (vs 0 bite log entries) is the engine's signature.
    assert_eq!(
        torn_apply_count, 1,
        "expected exactly 1 Torn_Ligaments apply (from the single t=0 bite event); breath ticks must not add more: \
         bite_log_entries={bite_count}, torn_applies={torn_apply_count}"
    );
}
