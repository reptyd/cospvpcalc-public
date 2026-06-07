//! Reference: status_heartbroken
//!
//! Covers each testable bullet in the "Heartbroken" entry. Each test
//! body starts with the [REF:status_heartbroken] marker so the
//! vitest coverage gate (src/pages/referenceCoverage.test.ts) sees
//! it.
//!
//! Engine paths (durable fix landed alongside this batch - see commit
//! header):
//! - `combat.rs:is_external_healing_blocked` - single helper consulted
//!   at every external-heal site.
//! - Heal Breath / Cloud Breath / Miasma self-heal in
//!   `composable/breath.rs:369-413`.
//! - Healing_Ailment ticks in `composable/mod.rs:2902-2978`.
//! - Life Leech mêlée + breath in `composable/mod.rs:5015-5038`,
//!   `:5363-5386`, `:5605-5630`, `:5755-5779`.
//! - Blessing's Boon ticks in `statuses.rs:642-651`.
//!
//! Natural passive regen (`combat.rs:handle_simple_regen_with_statuses`)
//! is the documented exception and is NOT gated.

use super::super::config::ComposableAbilityConfig;
use super::super::simulate_composable_matchup_with_trace;
use super::default_combatant;
use crate::contracts::{SimpleAbilityTimingMode, SimpleAppliedStatus, SimpleCombatantStats};

fn passive_combatant(max_hp: f64) -> SimpleCombatantStats {
    let mut c = default_combatant();
    c.health = max_hp;
    c.damage = 0.0;
    c.bite_cooldown = 1000.0;
    c
}

#[test]
fn blocks_blessings_boon_heal_but_keeps_natural_regen() {
    // [REF:status_heartbroken]
    // Bullet 1: "Heartbroken blocks all healing sources except the
    // creature's natural health regeneration."
    // Strategy: pre-wound attacker. Run two scenarios - both with
    // Blessings_Boon × 5 stacks. In one, attacker also carries a
    // Heartbroken_Status × 5 stacks at start; in the other, no
    // Heartbroken. Over a 12 s window the Heartbroken side must NOT
    // gain HP from Blessings_Boon ticks (attacker_hp_at_end ≈ same
    // as if Boon never existed).
    let mut atk_with_hb = passive_combatant(10_000.0);
    atk_with_hb.starting_statuses = vec![
        SimpleAppliedStatus {
            status_id: "Blessings_Boon".to_string(),
            stacks: 5.0,
            source_ability: None,
        },
        SimpleAppliedStatus {
            status_id: "Heartbroken_Status".to_string(),
            stacks: 5.0,
            source_ability: None,
        },
    ];
    let mut atk_no_hb = passive_combatant(10_000.0);
    atk_no_hb.starting_statuses = vec![SimpleAppliedStatus {
        status_id: "Blessings_Boon".to_string(),
        stacks: 5.0,
        source_ability: None,
    }];

    let mut biter = default_combatant();
    biter.damage = 50.0;
    biter.bite_cooldown = 1.0;
    biter.health = 10_000_000.0;

    let with_hb = simulate_composable_matchup_with_trace(
        &atk_with_hb, &biter, None, None,
        SimpleAbilityTimingMode::ReallyFast,
        &ComposableAbilityConfig::default(),
        12.0, true,
    );
    let no_hb = simulate_composable_matchup_with_trace(
        &atk_no_hb, &biter, None, None,
        SimpleAbilityTimingMode::ReallyFast,
        &ComposableAbilityConfig::default(),
        12.0, true,
    );
    let last_hp = |result: &crate::contracts::BestBuildsMatchupSummary| -> f64 {
        result
            .combat_log
            .as_ref()
            .and_then(|log| {
                log.iter().rev().find(|e| e.hp_side == "A").map(|e| e.hp_after)
            })
            .unwrap_or(0.0)
    };
    let hp_with = last_hp(&with_hb);
    let hp_no = last_hp(&no_hb);
    assert!(
        hp_no > hp_with + 200.0,
        "Heartbroken must block Blessings_Boon heal → HB-side attacker ends with strictly less HP than no-HB side: with={hp_with}, no={hp_no}"
    );
}

#[test]
fn natural_regen_is_not_blocked_by_heartbroken() {
    // [REF:status_heartbroken]
    // Bullet 1 (exception clause): "...except the creature's natural
    // health regeneration."
    // Strategy: pre-wound attacker via heavy biter, attacker has
    // health_regen=5 + Heartbroken × 5. The 15 s regen tick at t=15
    // must still fire and heal - natural regen is not gated by
    // Heartbroken.
    let mut atk = passive_combatant(10_000.0);
    atk.health_regen = 5.0;
    atk.starting_statuses = vec![SimpleAppliedStatus {
        status_id: "Heartbroken_Status".to_string(),
        stacks: 5.0,
        source_ability: None,
    }];
    let mut biter = default_combatant();
    biter.damage = 100.0;
    biter.bite_cooldown = 0.5;
    biter.health = 10_000_000.0;

    let result = simulate_composable_matchup_with_trace(
        &atk, &biter, None, None,
        SimpleAbilityTimingMode::ReallyFast,
        &ComposableAbilityConfig::default(),
        16.0, true,
    );
    let log = result.combat_log.expect("trace");
    let regen_count = log
        .iter()
        .filter(|e| e.description.as_deref() == Some("Natural regen") && e.attacker == "A")
        .count();
    assert!(
        regen_count >= 1,
        "Heartbroken must NOT block natural regen → at least one Natural regen event in 16 s window: got {regen_count}"
    );
}
