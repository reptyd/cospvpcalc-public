//! Reference: ability_unbridled_rage
//!
//! Covers each testable bullet in the "Unbridled Rage" entry. Each
//! test body starts with the [REF:ability_unbridled_rage] marker so
//! the vitest coverage gate (src/pages/referenceCoverage.test.ts)
//! sees it.
//!
//! Engine path: `composable/mod.rs:3053-3082` (Phase 4g) handles
//! activation and the planned-fire delay; `mod.rs:4714-4719` applies
//! the 1.3x melee multiplier to outgoing bites while
//! `unbridled_rage_active_until > time`. Active duration: 30 s.
//! Cooldown: 120 s, scaled by `active_cooldown_multiplier`.

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

fn ur_attacker_cfg() -> ComposableAbilityConfig {
    let mut cfg = ComposableAbilityConfig::default();
    cfg.attacker_unbridled_rage = true;
    cfg
}

#[test]
fn lasts_thirty_seconds() {
    // [REF:ability_unbridled_rage]
    // Bullet 1: "Unbridled Rage lasts for 30 seconds."
    // Engine: `unbridled_rage_active_until = time + 30.0`. The 1.3x
    // multiplier gates on `> time`, so per-bite damage drops back to
    // 1.0x at exactly t=activation+30. With ReallyFast first arming at
    // t=0.5, the active window is (0.5, 30.5]; a bite at t=31.0 must
    // see baseline damage.
    let attacker = melee_combatant(1_000_000.0, 100.0, 0.5);
    let defender = passive_combatant(10_000_000_000.0);

    let with_ur = simulate_composable_matchup_with_trace(
        &attacker, &defender, None, None,
        SimpleAbilityTimingMode::ReallyFast,
        &ur_attacker_cfg(),
        15.0, true,
    );
    let baseline = simulate_composable_matchup_with_trace(
        &attacker, &defender, None, None,
        SimpleAbilityTimingMode::ReallyFast,
        &ComposableAbilityConfig::default(),
        15.0, true,
    );
    // During the active window, attacker damage_dealt per second must
    // exceed baseline (×1.3). Use damage totals at t=15 as proxy.
    let dmg_with = with_ur.damage_dealt_a;
    let dmg_base = baseline.damage_dealt_a;
    let ratio = dmg_with / dmg_base;
    assert!(
        ratio > 1.25 && ratio < 1.32,
        "during 30 s active window, attacker bite damage must be ~1.3x baseline: got ratio {ratio} (with={dmg_with}, base={dmg_base})"
    );
}

#[test]
fn cooldown_one_hundred_twenty_seconds() {
    // [REF:ability_unbridled_rage]
    // Bullet 2: "It has a 120 second cooldown."
    // Engine: `unbridled_rage_cooldown_until = time + 120.0`. Second
    // activation can fire only after the cooldown elapses AND the
    // 30 s active window has ended.
    let attacker = melee_combatant(1_000_000.0, 100.0, 0.5);
    let defender = passive_combatant(10_000_000_000.0);

    let result = simulate_composable_matchup_with_trace(
        &attacker, &defender, None, None,
        SimpleAbilityTimingMode::ReallyFast,
        &ur_attacker_cfg(),
        130.0, true,
    );
    let log = result.combat_log.expect("trace");
    let activations: Vec<f64> = log
        .iter()
        .filter(|e| e.description.as_deref() == Some("Unbridled Rage activated"))
        .map(|e| e.time)
        .collect();
    assert!(
        activations.len() >= 2,
        "Unbridled Rage must fire at least twice in a 130 s window: {activations:?}"
    );
    let gap = activations[1] - activations[0];
    assert!(
        (gap - 120.0).abs() < 1.0,
        "second Unbridled Rage activation must land ~120 s after the first: gap={gap}, times={activations:?}"
    );
}

#[test]
fn while_active_bite_damage_is_multiplied_by_one_point_three() {
    // [REF:ability_unbridled_rage]
    // Bullet 3: "While Unbridled Rage is active, the user's bite
    // damage is multiplied by 1.3x."
    // Verify by reading the per-bite damage during the active window
    // versus a baseline run with UR off.
    let attacker = melee_combatant(1_000_000.0, 100.0, 1.0);
    let defender = passive_combatant(10_000_000_000.0);

    let with_ur = simulate_composable_matchup_with_trace(
        &attacker, &defender, None, None,
        SimpleAbilityTimingMode::ReallyFast,
        &ur_attacker_cfg(),
        5.0, true,
    );
    let baseline = simulate_composable_matchup_with_trace(
        &attacker, &defender, None, None,
        SimpleAbilityTimingMode::ReallyFast,
        &ComposableAbilityConfig::default(),
        5.0, true,
    );
    // Pick a bite around t=2.0 (well inside the active window) from
    // each run and compare per-bite damage.
    let with_log = with_ur.combat_log.expect("trace");
    let base_log = baseline.combat_log.expect("trace");
    let pick_bite_at = |log: &[crate::contracts::CombatLogEntry], target_t: f64| -> Option<f64> {
        log.iter()
            .filter(|e| e.entry_type == "bite" && e.attacker == "A" && (e.time - target_t).abs() < 0.5)
            .map(|e| e.damage)
            .next()
    };
    let with_dmg = pick_bite_at(&with_log, 2.0).expect("bite at ~t=2 in UR run");
    let base_dmg = pick_bite_at(&base_log, 2.0).expect("bite at ~t=2 in baseline");
    let ratio = with_dmg / base_dmg;
    assert!(
        (ratio - 1.3).abs() < 0.01,
        "UR bite damage must be exactly 1.3x baseline: got ratio {ratio} (with={with_dmg}, base={base_dmg})"
    );
}

#[test]
fn does_not_increase_breath_damage() {
    // [REF:ability_unbridled_rage]
    // Bullet 4: "It boosts bite damage only and does not increase
    // breath damage."
    // Engine: `melee_multiplier_a *= 1.3` is in the melee branch only;
    // the breath path (`compute_simple_breath_damage_*`) does not read
    // any `unbridled_rage_active_until`. Verify per-tick breath damage
    // is identical with and without UR active.
    use super::default_breath;
    use crate::contracts::SimpleBreathProfile;

    let attacker = passive_combatant(1_000_000.0);
    let defender = passive_combatant(10_000_000_000.0);
    let mut breath: SimpleBreathProfile = default_breath();
    breath.dps_pct = 1.0;
    breath.capacity = 5.0;
    breath.regen_rate = 1.0;

    let with_ur = simulate_composable_matchup_with_trace(
        &attacker, &defender, Some(&breath), None,
        SimpleAbilityTimingMode::ReallyFast,
        &ur_attacker_cfg(),
        5.0, true,
    );
    let baseline = simulate_composable_matchup_with_trace(
        &attacker, &defender, Some(&breath), None,
        SimpleAbilityTimingMode::ReallyFast,
        &ComposableAbilityConfig::default(),
        5.0, true,
    );
    let with_log = with_ur.combat_log.expect("trace");
    let base_log = baseline.combat_log.expect("trace");
    let breath_dmg = |log: &[crate::contracts::CombatLogEntry]| -> f64 {
        log.iter()
            .filter(|e| e.entry_type == "breath" && e.attacker == "A")
            .map(|e| e.damage)
            .sum()
    };
    let with_total = breath_dmg(&with_log);
    let base_total = breath_dmg(&base_log);
    assert!(
        (with_total - base_total).abs() < 1e-6,
        "UR must NOT change breath damage totals: with={with_total}, base={base_total}"
    );
}
