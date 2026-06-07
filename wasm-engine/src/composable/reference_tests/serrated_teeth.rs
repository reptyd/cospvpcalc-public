//! Reference: ability_serrated_teeth
//!
//! Covers each testable bullet in the "Serrated Teeth" entry. Each
//! test body starts with the [REF:ability_serrated_teeth] marker so
//! the vitest coverage gate (src/pages/referenceCoverage.test.ts)
//! sees it.
//!
//! Engine wiring: Serrated Teeth has no dedicated path. Like Ligament
//! Tear, it's a generic offensive on-hit ability that maps to
//! `on_hit_statuses` (Deep_Wounds_Status × 10) on the carrier
//! creature's `SimpleCombatantStats`. The bite phases consume that
//! list via `apply_statuses_with_per_effect_trace`
//! (`composable/mod.rs:4961`, `:5312`); the breath path does not.

use super::super::config::ComposableAbilityConfig;
use super::super::simulate_composable_matchup_with_trace;
use super::{applied_status, default_combatant};
use crate::contracts::{SimpleAbilityTimingMode, SimpleCombatantStats};

const DEEP_WOUNDS_STATUS_ID: &str = "Deep_Wounds_Status";

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
fn applies_ten_deep_wounds_on_direct_hit() {
    // [REF:ability_serrated_teeth]
    // Bullet 1: "Serrated Teeth applies 10 Deep Wounds when the user
    // lands a direct hit."
    // Setup: A holds Serrated Teeth (modeled as Deep_Wounds × 10 in
    // on_hit_statuses). A bites B → B receives a Deep_Wounds_Status
    // apply event with +10 stacks per bite.
    let mut a = melee_combatant(10_000.0, 50.0, 1.0);
    a.on_hit_statuses = vec![applied_status(DEEP_WOUNDS_STATUS_ID, 10.0)];
    let b = passive_combatant(10_000_000.0);

    let result = simulate_composable_matchup_with_trace(
        &a, &b, None, None,
        SimpleAbilityTimingMode::ReallyFast,
        &ComposableAbilityConfig::default(),
        2.0, true,
    );
    let log = result.combat_log.expect("trace log");
    let first_apply = log.iter().find(|e| {
        e.status_id.as_deref() == Some(DEEP_WOUNDS_STATUS_ID)
            && e.description.as_deref().is_some_and(|d| d.contains("applied"))
    });
    assert!(
        first_apply.is_some(),
        "Serrated Teeth must apply Deep_Wounds_Status to the bitten target"
    );
    let detail = first_apply.unwrap().detail.as_deref().unwrap_or("");
    assert!(
        detail.contains("0 -> 10") || detail.contains("0.0 -> 10") || detail.contains("-> 10 stacks"),
        "first Serrated Teeth bite must apply exactly 10 Deep Wounds stacks: detail={detail}"
    );
}
