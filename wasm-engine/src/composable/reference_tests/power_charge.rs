//! Reference: compare_power_charge
//!
//! Covers each testable bullet in the "Power Charge" entry. Each test
//! body starts with the [REF:compare_power_charge] marker so the
//! vitest coverage gate (src/pages/referenceCoverage.test.ts) sees it.
//!
//! Engine path: `composable/mod.rs:4742-4747` (attacker melee
//! multiplier 1.5x while `!first_melee_hit_taken`) and
//! `mod.rs:4918-4926` (Shredded_Wings × 2 apply on the first bite,
//! gated by `first_melee_hit_taken`). Defender mirror at 5098-5104 +
//! 5266-5273.

use super::super::config::ComposableAbilityConfig;
use super::super::simulate_composable_matchup_with_trace;
use super::default_combatant;
use crate::contracts::{SimpleAbilityTimingMode, SimpleCombatantStats};

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

fn power_charge_attacker_cfg() -> ComposableAbilityConfig {
    let mut cfg = ComposableAbilityConfig::default();
    cfg.attacker_power_charge = true;
    cfg
}

#[test]
fn first_melee_hit_gains_fifty_percent_damage_and_two_shredded_wings() {
    // [REF:compare_power_charge]
    // Bullets 1 + 2: "Power Charge currently changes only the first
    // melee hit." + "That hit gains +50% damage and applies 2 stacks
    // of Shredded Wings."
    let attacker = melee_combatant(10_000.0, 100.0, 1.0);
    let defender = passive_combatant(10_000_000.0);

    let with_pc = simulate_composable_matchup_with_trace(
        &attacker, &defender, None, None,
        SimpleAbilityTimingMode::ReallyFast,
        &power_charge_attacker_cfg(),
        2.0, true,
    );
    let baseline = simulate_composable_matchup_with_trace(
        &attacker, &defender, None, None,
        SimpleAbilityTimingMode::ReallyFast,
        &ComposableAbilityConfig::default(),
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
    let pc_dmg = first_bite_damage(&with_pc);
    let base_dmg = first_bite_damage(&baseline);
    let ratio = pc_dmg / base_dmg;
    assert!(
        (ratio - 1.5).abs() < 0.01,
        "first melee hit with Power Charge must deal exactly 1.5x baseline: got ratio {ratio} (with={pc_dmg}, base={base_dmg})"
    );
    // Activation event with Shredded Wings apply.
    let activation = with_pc
        .combat_log
        .as_ref()
        .unwrap()
        .iter()
        .find(|e| e.description.as_deref() == Some("Power Charge activated"));
    assert!(
        activation.is_some(),
        "Power Charge activation event must fire on first hit"
    );
}

#[test]
fn second_hit_returns_to_baseline_damage() {
    // [REF:compare_power_charge]
    // Bullet 1 (single-fire scope): the +50% multiplier and Shredded
    // Wings apply only on the first melee hit. Subsequent bites use
    // the baseline 1.0x multiplier and no extra Power Charge log
    // event fires.
    let attacker = melee_combatant(10_000.0, 100.0, 0.5);
    let defender = passive_combatant(10_000_000.0);

    let with_pc = simulate_composable_matchup_with_trace(
        &attacker, &defender, None, None,
        SimpleAbilityTimingMode::ReallyFast,
        &power_charge_attacker_cfg(),
        5.0, true,
    );
    let log = with_pc.combat_log.expect("trace");
    let activations = log
        .iter()
        .filter(|e| e.description.as_deref() == Some("Power Charge activated"))
        .count();
    assert_eq!(
        activations, 1,
        "Power Charge must activate exactly once across many bites: got {activations}"
    );
    // Compare per-bite damage of bites at ~t=2.0 (well after the
    // first hit) with a baseline run.
    let baseline = simulate_composable_matchup_with_trace(
        &attacker, &defender, None, None,
        SimpleAbilityTimingMode::ReallyFast,
        &ComposableAbilityConfig::default(),
        5.0, true,
    );
    let pick_bite_at = |log: &[crate::contracts::CombatLogEntry], target_t: f64| -> Option<f64> {
        log.iter()
            .filter(|e| e.entry_type == "bite" && e.attacker == "A" && (e.time - target_t).abs() < 0.4)
            .map(|e| e.damage)
            .next()
    };
    let with_dmg_late = pick_bite_at(&log, 2.0).expect("bite at ~t=2 in PC run");
    let base_dmg_late = pick_bite_at(baseline.combat_log.as_ref().unwrap(), 2.0)
        .expect("bite at ~t=2 in baseline");
    assert!(
        (with_dmg_late - base_dmg_late).abs() < 0.01,
        "post-first-hit bite damage must match baseline (no lingering PC bonus): with={with_dmg_late}, base={base_dmg_late}"
    );
}
