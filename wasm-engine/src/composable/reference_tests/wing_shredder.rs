//! Reference: ability_wing_shredder
//!
//! Covers each testable bullet in the "Wing Shredder" entry. Each
//! test body starts with the [REF:ability_wing_shredder] marker so
//! the vitest coverage gate (src/pages/referenceCoverage.test.ts)
//! sees it.
//!
//! Engine wiring: Wing Shredder has no dedicated path. Like Ligament
//! Tear and Serrated Teeth, it is a generic on-hit ability that maps
//! to either `on_hit_statuses` (offensive: applied to bitten target)
//! or `on_hit_taken_statuses` (defensive: applied to the biter when
//! the owner is bitten) carrying Shredded_Wings × value. The bite
//! phases consume both lists via `apply_statuses_with_per_effect_trace`
//! (`composable/mod.rs:4961, 5312`); the breath path
//! (`composable/breath.rs`) does not.

use super::super::config::ComposableAbilityConfig;
use super::super::simulate_composable_matchup_with_trace;
use super::{applied_status, default_breath, default_combatant};
use crate::contracts::{SimpleAbilityTimingMode, SimpleCombatantStats};

const SHREDDED_WINGS_STATUS_ID: &str = "Shredded_Wings";

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
fn offensive_application_on_bite_applies_shredded_wings() {
    // [REF:ability_wing_shredder]
    // Bullet 1: "Offensive abilities apply their effect when the user
    // lands a bite."
    // Plus bullet 4: "Wing Shredder applies Shredded Wings."
    // Setup: A holds Wing Shredder as offensive
    // (`on_hit_statuses` with Shredded_Wings × value). A bites B → B
    // receives Shredded_Wings.
    let mut a = melee_combatant(10_000.0, 50.0, 1.0);
    a.on_hit_statuses = vec![applied_status(SHREDDED_WINGS_STATUS_ID, 2.0)];
    let b = passive_combatant(10_000_000.0);

    let result = simulate_composable_matchup_with_trace(
        &a, &b, None, None,
        SimpleAbilityTimingMode::ReallyFast,
        &ComposableAbilityConfig::default(),
        2.0, true,
    );
    let log = result.combat_log.expect("trace log");
    let apply = log.iter().any(|e| {
        e.status_id.as_deref() == Some(SHREDDED_WINGS_STATUS_ID)
            && e.attacker == "A"
            && e.description.as_deref().is_some_and(|d| d.contains("applied"))
    });
    assert!(
        apply,
        "offensive Wing Shredder must apply Shredded_Wings to the bitten target"
    );
}

#[test]
fn defensive_application_on_being_bitten_applies_shredded_wings() {
    // [REF:ability_wing_shredder]
    // Bullet 2: "Defensive abilities apply their effect when the user
    // is bitten."
    // Setup: A holds Wing Shredder as defensive
    // (`on_hit_taken_statuses` with Shredded_Wings × value). When B
    // bites A, the engine applies Shredded_Wings to B (the biter).
    let mut a = passive_combatant(10_000.0);
    a.on_hit_taken_statuses = vec![applied_status(SHREDDED_WINGS_STATUS_ID, 2.0)];
    let b = melee_combatant(10_000_000.0, 50.0, 1.0);

    let result = simulate_composable_matchup_with_trace(
        &a, &b, None, None,
        SimpleAbilityTimingMode::ReallyFast,
        &ComposableAbilityConfig::default(),
        2.0, true,
    );
    let log = result.combat_log.expect("trace log");
    let apply = log.iter().any(|e| {
        e.status_id.as_deref() == Some(SHREDDED_WINGS_STATUS_ID)
            && e.description.as_deref().is_some_and(|d| d.contains("applied"))
    });
    assert!(
        apply,
        "defensive Wing Shredder must apply Shredded_Wings to the biter when the owner is bitten"
    );
}

#[test]
fn breath_does_not_trigger_wing_shredder() {
    // [REF:ability_wing_shredder]
    // Bullet 3: "Breath does not trigger Wing Shredder."
    // The engine's CombatSide initialises `next_hit = 0.0`, so a bite
    // event fires at t=0 even with `bite_cooldown = 1000`. With
    // `damage = 0` that first bite still consumes `on_hit_statuses`.
    // With a long bite_cooldown, only that single t=0 bite fires
    // within a 5 s window, so the Shredded_Wings apply count must
    // equal exactly 1 — proving the breath path does NOT add
    // additional applies.
    let mut a = passive_combatant(10_000.0);
    a.on_hit_statuses = vec![applied_status(SHREDDED_WINGS_STATUS_ID, 2.0)];
    a.bite_cooldown = 1000.0;
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
    let apply_count = log
        .iter()
        .filter(|e| {
            e.status_id.as_deref() == Some(SHREDDED_WINGS_STATUS_ID)
                && e.description.as_deref().is_some_and(|d| d.contains("applied"))
        })
        .count();
    let bite_count = log.iter().filter(|e| e.entry_type == "bite").count();
    assert_eq!(
        apply_count, 1,
        "expected exactly 1 Shredded_Wings apply (from the single t=0 bite event); breath ticks must not add more: \
         bite_log_entries={bite_count}, applies={apply_count}"
    );
}
