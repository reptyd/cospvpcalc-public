//! Reference: compare_spite_ready_at_start
//!
//! Covers each testable bullet in the "Spite ready at start" entry.
//! Each test body starts with the [REF:compare_spite_ready_at_start]
//! marker so the vitest coverage gate
//! (src/pages/referenceCoverage.test.ts) sees it.
//!
//! Engine path: `composable/mod.rs:1457-1476` initialises
//! `spite_armed = true`, `spite_charge_ready_at = 0.0`, and
//! `spite_cooldown_until = 20.0` for the side that holds
//! `attacker_spite_ready_at_start`. The opening bite consumes the
//! armed Spite via the standard Phase 10 melee path.

use super::super::config::ComposableAbilityConfig;
use super::super::simulate_composable_matchup_with_trace;
use super::default_combatant;
use crate::contracts::{SimpleAbilityTimingMode, SimpleCombatantStats};

fn melee_combatant(max_hp: f64, damage: f64, bite_cd: f64) -> SimpleCombatantStats {
    let mut c = default_combatant();
    c.health = max_hp;
    c.damage = damage;
    c.bite_cooldown = bite_cd;
    c
}

fn passive_combatant(max_hp: f64) -> SimpleCombatantStats {
    let mut c = default_combatant();
    c.health = max_hp;
    c.damage = 0.0;
    c.bite_cooldown = 1000.0;
    c
}

#[test]
fn first_bite_consumes_pre_armed_spite() {
    // [REF:compare_spite_ready_at_start]
    // Bullets 2 + 3: "The fight starts with that Spite fully charged."
    // + "The opening bite consumes that charged Spite immediately."
    // Engine: with `attacker_spite_ready_at_start = true` AND
    // `attacker_spite_value` set, the first bite applies the Spite
    // multiplier (1 + value) to outgoing damage.
    let attacker = melee_combatant(10_000.0, 100.0, 1.0);
    let defender = passive_combatant(10_000_000.0);

    let mut cfg_with = ComposableAbilityConfig::default();
    cfg_with.attacker_spite_value = 1.0;
    cfg_with.attacker_spite_ready_at_start = true;
    let with_run = simulate_composable_matchup_with_trace(
        &attacker, &defender, None, None,
        SimpleAbilityTimingMode::ReallyFast,
        &cfg_with,
        2.0, true,
    );
    let mut cfg_no_spite = ComposableAbilityConfig::default();
    cfg_no_spite.attacker_spite_value = 0.0;
    let baseline = simulate_composable_matchup_with_trace(
        &attacker, &defender, None, None,
        SimpleAbilityTimingMode::ReallyFast,
        &cfg_no_spite,
        2.0, true,
    );
    let first_bite_damage = |result: &crate::contracts::BestBuildsMatchupSummary| -> f64 {
        result
            .combat_log
            .as_ref()
            .and_then(|log| {
                log.iter()
                    .find(|e| e.entry_type == "bite" && e.attacker == "A")
                    .map(|e| e.damage)
            })
            .unwrap_or(0.0)
    };
    let pre_armed_dmg = first_bite_damage(&with_run);
    let baseline_dmg = first_bite_damage(&baseline);
    let ratio = pre_armed_dmg / baseline_dmg;
    assert!(
        (ratio - 2.0).abs() < 0.02,
        "first bite must apply (1 + spite_value=1.0) = 2.0x multiplier vs baseline: got ratio {ratio} (with={pre_armed_dmg}, base={baseline_dmg})"
    );
}

#[test]
fn rule_off_means_first_bite_is_unmultiplied() {
    // [REF:compare_spite_ready_at_start]
    // Inverse of the test above: with
    // `attacker_spite_ready_at_start = false`, the engine never sets
    // `spite_armed = true` at simulation start, so the first bite
    // does not consume any Spite charge - damage equals the baseline
    // (no-Spite) run.
    let attacker = melee_combatant(10_000.0, 100.0, 1.0);
    let defender = passive_combatant(10_000_000.0);

    let mut cfg_off = ComposableAbilityConfig::default();
    cfg_off.attacker_spite_value = 1.0;
    cfg_off.attacker_spite_ready_at_start = false;
    let off_run = simulate_composable_matchup_with_trace(
        &attacker, &defender, None, None,
        SimpleAbilityTimingMode::ReallyFast,
        &cfg_off,
        2.0, true,
    );
    let mut cfg_no_spite = ComposableAbilityConfig::default();
    cfg_no_spite.attacker_spite_value = 0.0;
    let baseline = simulate_composable_matchup_with_trace(
        &attacker, &defender, None, None,
        SimpleAbilityTimingMode::ReallyFast,
        &cfg_no_spite,
        2.0, true,
    );
    let first_bite_damage = |result: &crate::contracts::BestBuildsMatchupSummary| -> f64 {
        result
            .combat_log
            .as_ref()
            .and_then(|log| {
                log.iter()
                    .find(|e| e.entry_type == "bite" && e.attacker == "A")
                    .map(|e| e.damage)
            })
            .unwrap_or(0.0)
    };
    let off_dmg = first_bite_damage(&off_run);
    let base_dmg = first_bite_damage(&baseline);
    assert!(
        (off_dmg - base_dmg).abs() < 0.01,
        "with the rule off, first bite must equal baseline (no Spite charge): off={off_dmg}, base={base_dmg}"
    );
}

#[test]
fn timeline_marks_activation_at_t0_and_tags_the_consuming_bite() {
    // [REF:compare_spite_ready_at_start]
    // Display: pre-armed Spite logs its single activation at t=0 (not at the
    // opening bite, which previously read as if Spite activated there), and the
    // opening bite that consumes it is tagged "Spite-charged". No second
    // activation event is logged.
    let attacker = melee_combatant(10_000.0, 100.0, 1.0);
    let defender = passive_combatant(10_000_000.0);

    let mut cfg = ComposableAbilityConfig::default();
    cfg.attacker_spite_value = 1.0;
    cfg.attacker_spite_ready_at_start = true;
    let run = simulate_composable_matchup_with_trace(
        &attacker, &defender, None, None,
        SimpleAbilityTimingMode::ReallyFast,
        &cfg,
        // Stop before the 20 s re-arm so only the opening cycle is traced.
        3.0, true,
    );
    let log = run.combat_log.expect("trace");
    let activations: Vec<f64> = log
        .iter()
        .filter(|e| e.attacker == "A" && e.description.as_deref() == Some("Spite activated"))
        .map(|e| e.time)
        .collect();
    assert_eq!(
        activations.len(),
        1,
        "ready-at-start must log exactly one activation in the opening cycle: {activations:?}"
    );
    assert!(
        activations[0].abs() < 1e-6,
        "the single activation must sit at t=0 (armed at start), got {}",
        activations[0]
    );
    let charged_bite = log.iter().find(|e| {
        e.entry_type == "bite" && e.attacker == "A" && e.detail.as_deref() == Some("Spite-charged")
    });
    assert!(
        charged_bite.is_some(),
        "the opening bite that consumes the pre-armed Spite must be tagged 'Spite-charged'"
    );
}
