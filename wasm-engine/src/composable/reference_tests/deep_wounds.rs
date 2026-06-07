//! Reference: status_deep_wounds
//!
//! Covers each testable bullet in the "Deep Wounds" entry. Each test
//! body starts with the [REF:status_deep_wounds] marker so the
//! vitest coverage gate (src/pages/referenceCoverage.test.ts) sees
//! it.
//!
//! Engine path: `statuses.rs:622-624` and `:792-798` -
//! `bleed_decay_blocked` resolves true while `Deep_Wounds_Status` has
//! stacks > 0; the per-status decay loop then suppresses Bleed's
//! natural one-stack-per-3 s decay. Cleanse / heal also gate on
//! `bleed_healing_blocked` at `:495-511`.

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
fn blocks_natural_bleed_decay_while_active() {
    // [REF:status_deep_wounds]
    // Bullets 1 + 2: "Deep Wounds blocks natural Bleed decay while
    // it is active." + "Because of that, existing Bleed stacks stay
    // in place until Deep Wounds runs out."
    // Strategy: pre-seed attacker with Bleed × 5 + Deep_Wounds × 5
    // (= 15 s of decay block). Run 12 s window. Compare cumulative
    // Bleed DoT damage to a control with only Bleed × 5 (decay
    // active). With decay blocked, all 4 Bleed DoT ticks (t=3, 6, 9,
    // 12) fire at full 5 stacks → bigger total Bleed damage.
    let mut with_dw = passive_combatant(10_000_000.0);
    with_dw.starting_statuses = vec![
        SimpleAppliedStatus {
            status_id: "Bleed_Status".to_string(),
            stacks: 5.0,
            source_ability: None,
        },
        SimpleAppliedStatus {
            status_id: "Deep_Wounds_Status".to_string(),
            stacks: 5.0,
            source_ability: None,
        },
    ];
    let mut without_dw = passive_combatant(10_000_000.0);
    without_dw.starting_statuses = vec![SimpleAppliedStatus {
        status_id: "Bleed_Status".to_string(),
        stacks: 5.0,
        source_ability: None,
    }];

    let defender = passive_combatant(10_000_000.0);
    let with_run = simulate_composable_matchup_with_trace(
        &with_dw, &defender, None, None,
        SimpleAbilityTimingMode::ReallyFast,
        &ComposableAbilityConfig::default(),
        12.5, true,
    );
    let no_run = simulate_composable_matchup_with_trace(
        &without_dw, &defender, None, None,
        SimpleAbilityTimingMode::ReallyFast,
        &ComposableAbilityConfig::default(),
        12.5, true,
    );
    let total_bleed = |result: &crate::contracts::BestBuildsMatchupSummary| -> f64 {
        result
            .combat_log
            .as_ref()
            .map(|log| {
                log.iter()
                    .filter(|e| {
                        e.entry_type == "dot"
                            && e.status_id.as_deref() == Some("Bleed_Status")
                            && e.hp_side == "A"
                    })
                    .map(|e| e.damage)
                    .sum()
            })
            .unwrap_or(0.0)
    };
    let with_total = total_bleed(&with_run);
    let no_total = total_bleed(&no_run);
    assert!(
        with_total > no_total + 1e-3,
        "Deep Wounds must block Bleed decay → total Bleed DoT damage strictly higher than baseline: with={with_total}, without={no_total}"
    );
}
