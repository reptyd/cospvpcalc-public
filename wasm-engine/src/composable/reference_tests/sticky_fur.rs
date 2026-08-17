//! Reference: ability_sticky_fur
//!
//! Covers each testable bullet in the "Sticky Fur" entry. Each test
//! body starts with the [REF:ability_sticky_fur] marker so the vitest
//! coverage gate (src/pages/referenceCoverage.test.ts) sees it.
//!
//! Engine wiring: Sticky Fur is a generic defensive on-hit-taken
//! ability. The TS bridge `rustBestBuildsRuntime.ts` materializes Sticky
//! Fur as `Sticky_Teeth_Status x 2` in `on_hit_taken_statuses` (game
//! `StickyFur.OnDamageAilments = { StickyTeeth = 2 }`). The bite phases
//! consume that list via `apply_statuses_with_per_effect_trace`; the
//! breath path does not. Cumulative stacks are capped at 5 by the status
//! registry, which is the cap the game applies to Sticky Teeth landed by
//! this passive.

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

/// Parse the "N" out of a per-effect apply detail like "2 -> 4 stacks".
fn resulting_stacks(detail: &str) -> Option<f64> {
    let after = detail.split("-> ").nth(1)?;
    after.split_whitespace().next()?.parse::<f64>().ok()
}

#[test]
fn applies_two_stacks_of_sticky_teeth_when_user_is_bitten() {
    // [REF:ability_sticky_fur]
    // Bullets 1, 2, 4: defensive ability whose effect fires "when the
    // user is hit by a direct attack" and "applies 2 stacks of Sticky
    // Teeth per bite."
    // Setup: A holds Sticky Fur (modeled as on_hit_taken_statuses with
    // Sticky_Teeth x 2). B bites A -> B receives 2 Sticky_Teeth stacks.
    let mut a = passive_combatant(10_000.0);
    a.on_hit_taken_statuses = vec![applied_status(STICKY_TEETH_STATUS_ID, 2.0)];
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
        detail.contains("0 -> 2") || detail.contains("0.0 -> 2") || detail.contains("-> 2 stack"),
        "Sticky Fur must apply exactly 2 stacks of Sticky Teeth per bite: detail={detail}"
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
    a.on_hit_taken_statuses = vec![applied_status(STICKY_TEETH_STATUS_ID, 2.0)];
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

#[test]
fn sticky_teeth_stacks_accumulate_and_cap_at_five() {
    // [REF:ability_sticky_fur]
    // "Sticky Teeth stacks accumulate up to a cap of 5." Each bite adds
    // 2 stacks (0 -> 2 -> 4 -> capped 5); the sixth stack is clamped, so
    // no apply event ever reports more than 5. Bite repeatedly and check
    // the resulting-stack count across every apply event.
    let mut a = passive_combatant(10_000_000.0);
    a.on_hit_taken_statuses = vec![applied_status(STICKY_TEETH_STATUS_ID, 2.0)];
    let b = melee_combatant(10_000_000.0, 1.0, 1.0);

    let result = simulate_composable_matchup_with_trace(
        &a, &b, None, None,
        SimpleAbilityTimingMode::ReallyFast,
        &ComposableAbilityConfig::default(),
        6.0, true,
    );
    let log = result.combat_log.expect("trace log");
    let resulting: Vec<f64> = log
        .iter()
        .filter(|e| {
            e.status_id.as_deref() == Some(STICKY_TEETH_STATUS_ID)
                && e.description.as_deref().is_some_and(|d| d.contains("applied"))
        })
        .filter_map(|e| e.detail.as_deref().and_then(resulting_stacks))
        .collect();
    assert!(
        !resulting.is_empty(),
        "expected at least one Sticky_Teeth apply event"
    );
    let max = resulting.iter().cloned().fold(0.0_f64, f64::max);
    assert!(
        (max - 5.0).abs() < 1e-9,
        "Sticky Teeth must accumulate to exactly the cap of 5 (+2 per bite), never past it: observed max {max}, series {resulting:?}"
    );
}
