//! Reference: ability_sticky_fur
//!
//! Covers each testable bullet in the "Sticky Fur" entry. Each test
//! body starts with the [REF:ability_sticky_fur] marker so the vitest
//! coverage gate (src/pages/referenceCoverage.test.ts) sees it.
//!
//! Engine wiring: Sticky Fur is a generic defensive on-hit-taken
//! ability. The TS bridge `rustBestBuildsRuntime.ts:559-571`
//! materializes Sticky Fur as `Sticky_Teeth_Status × 1` in
//! `on_hit_taken_statuses`. The bite phases consume that list via
//! `apply_statuses_with_per_effect_trace` (`composable/mod.rs:4961`,
//! `:5312`); the breath path does not.

use super::super::config::ComposableAbilityConfig;
use super::super::simulate_composable_matchup_with_trace;
use super::{applied_status, default_breath, default_combatant};
use crate::contracts::{SimpleAbilityTimingMode, SimpleCombatantStats};

const STICKY_TEETH_STATUS_ID: &str = "Sticky_Teeth_Status";

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
fn applies_one_stack_of_sticky_teeth_when_user_is_bitten() {
    // [REF:ability_sticky_fur]
    // Bullets 1, 2, 4: defensive ability whose effect fires "when the
    // user is hit by a direct attack" and "applies 1 stack of Sticky
    // Teeth."
    // Setup: A holds Sticky Fur (modeled as on_hit_taken_statuses with
    // Sticky_Teeth × 1). B bites A → B receives Sticky_Teeth_Status.
    let mut a = passive_combatant(10_000.0);
    a.on_hit_taken_statuses = vec![applied_status(STICKY_TEETH_STATUS_ID, 1.0)];
    let b = melee_combatant(10_000_000.0, 50.0, 1.0);

    let result = simulate_composable_matchup_with_trace(
        &a, &b, None, None,
        SimpleAbilityTimingMode::ReallyFast,
        &ComposableAbilityConfig::default(),
        2.0, true,
    );
    let log = result.combat_log.expect("trace log");
    let apply = log.iter().find(|e| {
        e.status_id.as_deref() == Some(STICKY_TEETH_STATUS_ID)
            && e.description.as_deref().is_some_and(|d| d.contains("applied"))
    });
    assert!(
        apply.is_some(),
        "defensive Sticky Fur must apply Sticky_Teeth_Status when the user is bitten"
    );
    let detail = apply.unwrap().detail.as_deref().unwrap_or("");
    assert!(
        detail.contains("0 -> 1") || detail.contains("0.0 -> 1") || detail.contains("-> 1 stack"),
        "Sticky Fur must apply exactly 1 stack of Sticky Teeth: detail={detail}"
    );
}

#[test]
fn breath_does_not_trigger_sticky_fur() {
    // [REF:ability_sticky_fur]
    // Bullet 3: "Breath does not trigger Sticky Fur."
    // Same setup as Ligament Tear's breath-doesn't-trigger test: A
    // holds Sticky_Teeth in on_hit_taken_statuses. B has zero bite
    // damage and a 1000 s bite cooldown so its only first bite at t=0
    // fires (default `next_hit=0.0`) and applies on-hit-taken once
    // (regardless of damage). Subsequent breath ticks do NOT add more
    // applies. With damage=0 there's no "Bite hit" log entry, but the
    // on-hit-taken still triggers once. We assert the apply count is
    // exactly 1 (the t=0 bite event), proving breath ticks don't add.
    let mut a = passive_combatant(10_000.0);
    a.on_hit_taken_statuses = vec![applied_status(STICKY_TEETH_STATUS_ID, 1.0)];
    let mut b = passive_combatant(10_000_000.0);
    b.weight = 100.0;
    b.bite_cooldown = 1000.0;
    let mut breath = default_breath();
    breath.dps_pct = 1.0;
    breath.capacity = 5.0;
    breath.regen_rate = 1.0;

    let result = simulate_composable_matchup_with_trace(
        &a, &b, None, Some(&breath),
        SimpleAbilityTimingMode::ReallyFast,
        &ComposableAbilityConfig::default(),
        5.0, true,
    );
    let log = result.combat_log.expect("trace log");
    let apply_count = log
        .iter()
        .filter(|e| {
            e.status_id.as_deref() == Some(STICKY_TEETH_STATUS_ID)
                && e.description.as_deref().is_some_and(|d| d.contains("applied"))
        })
        .count();
    assert_eq!(
        apply_count, 1,
        "expected exactly 1 Sticky_Teeth apply (from the single t=0 bite event); breath ticks must not add more: {apply_count}"
    );
}
