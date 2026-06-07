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
    // Bullets 1 + 2: "This rule starts the fight with a fully charged
    // Spite already armed." + "The opening bite consumes that charged
    // Spite immediately."
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
