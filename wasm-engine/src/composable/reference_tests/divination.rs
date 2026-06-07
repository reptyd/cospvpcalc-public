//! Reference: ability_divination
//!
//! Covers each testable bullet in the "Divination" entry. Each test body
//! starts with the [REF:ability_divination] marker so the vitest coverage
//! gate (src/pages/referenceCoverage.test.ts) sees it.
//!
//! The "applies 2 stacks of Burn per charged bite" claim is verified by
//! source inspection of composable/mod.rs:4811-4823 (and the symmetric
//! defender block at mod.rs:5157-5169): each charge consumes one bite
//! and emits a `Burn_Status` apply with `stacks: 2.0`. The runtime tests
//! below cover the +50 flat damage bonus, the 120 s cooldown, the
//! re-arm gate (only when charges are fully spent), and the lack of
//! policy-mode timing differences.

use super::super::config::ComposableAbilityConfig;
use super::super::simulate_composable_matchup_with_trace;
use super::default_combatant;
use crate::contracts::{SimpleAbilityTimingMode, SimpleCombatantStats};

fn divination_attacker_config() -> ComposableAbilityConfig {
    let mut cfg = ComposableAbilityConfig::default();
    cfg.attacker_divination = true;
    cfg
}

fn biting_attacker(damage: f64, bite_cd: f64) -> SimpleCombatantStats {
    let mut c = default_combatant();
    c.health = 1_000.0;
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

fn divination_activation_times(
    cfg: &ComposableAbilityConfig,
    policy: SimpleAbilityTimingMode,
    max_time_sec: f64,
    bite_cd: f64,
) -> Vec<f64> {
    let attacker = biting_attacker(50.0, bite_cd);
    let defender = passive_combatant(10_000_000.0);
    let result = simulate_composable_matchup_with_trace(
        &attacker, &defender, None, None, policy, cfg, max_time_sec, true,
    );
    let log = result.combat_log.expect("trace log requested");
    log.iter()
        .filter(|e| {
            e.entry_type == "ability"
                && e.attacker == "A"
                && e.description.as_deref() == Some("Divination activated")
        })
        .map(|e| e.time)
        .collect()
}

#[test]
fn exactly_three_bites_get_fifty_flat_bonus() {
    // [REF:ability_divination]
    // Three charges → exactly three of the first several bites carry a
    // +50 flat damage bonus on top of the weight-symmetric base damage.
    let attacker = biting_attacker(50.0, 2.0);
    let defender = passive_combatant(10_000_000.0);
    let result = simulate_composable_matchup_with_trace(
        &attacker,
        &defender,
        None,
        None,
        SimpleAbilityTimingMode::Fast,
        &divination_attacker_config(),
        12.0,
        true,
    );
    let log = result.combat_log.expect("trace log");
    let bite_damages: Vec<f64> = log
        .iter()
        .filter(|e| e.entry_type == "bite" && e.attacker == "A")
        .map(|e| e.damage)
        .collect();
    assert!(
        bite_damages.len() >= 4,
        "need at least 4 bites to observe charges + post-charge baseline: {bite_damages:?}"
    );
    let charged_count = bite_damages
        .iter()
        .filter(|&&d| (d - 100.0).abs() < 1e-6)
        .count();
    let baseline_count = bite_damages
        .iter()
        .filter(|&&d| (d - 50.0).abs() < 1e-6)
        .count();
    assert_eq!(
        charged_count, 3,
        "Divination must arm exactly 3 charged bites (each at base+50 = 100): {bite_damages:?}"
    );
    assert!(
        baseline_count >= 1,
        "at least one post-charge baseline bite must appear (charges exhausted): {bite_damages:?}"
    );
}

#[test]
fn cooldown_one_hundred_twenty_seconds() {
    // [REF:ability_divination]
    let times = divination_activation_times(
        &divination_attacker_config(),
        SimpleAbilityTimingMode::Fast,
        300.0,
        2.0,
    );
    assert!(
        times.len() >= 2,
        "Divination must fire at least twice in a 300 s window: {times:?}"
    );
    let gap = times[1] - times[0];
    assert!(
        (gap - 120.0).abs() < 1.0,
        "second Divination activation must be ~120 s after the first, got {gap}: {times:?}"
    );
}

#[test]
fn cannot_rearm_while_charges_unspent() {
    // [REF:ability_divination]
    // The activation gate at composable/mod.rs:2498 requires
    // `divination_charges_left == 0`. With a very slow biter that does
    // not consume any charge during the cooldown window, the engine
    // must not re-arm: only one activation event in 200 s.
    let attacker = biting_attacker(50.0, 1000.0); // no bite within window
    let defender = passive_combatant(10_000_000.0);
    let result = simulate_composable_matchup_with_trace(
        &attacker,
        &defender,
        None,
        None,
        SimpleAbilityTimingMode::Fast,
        &divination_attacker_config(),
        200.0,
        true,
    );
    let log = result.combat_log.expect("trace log");
    let activations: Vec<f64> = log
        .iter()
        .filter(|e| {
            e.entry_type == "ability"
                && e.attacker == "A"
                && e.description.as_deref() == Some("Divination activated")
        })
        .map(|e| e.time)
        .collect();
    assert_eq!(
        activations.len(),
        1,
        "Divination must not re-arm while charges remain unspent: {activations:?}"
    );
}

#[test]
fn activates_immediately_under_all_policies() {
    // [REF:ability_divination]
    let cfg = divination_attacker_config();
    for mode in [
        SimpleAbilityTimingMode::ReallyFast,
        SimpleAbilityTimingMode::Fast,
        SimpleAbilityTimingMode::SemiIdeal,
        SimpleAbilityTimingMode::Ideal,
        SimpleAbilityTimingMode::Extreme,
    ] {
        let times = divination_activation_times(&cfg, mode, 5.0, 2.0);
        let first = *times
            .first()
            .unwrap_or_else(|| panic!("first activation under {mode:?}: log empty"));
        assert!(
            first.abs() < 1e-6,
            "Divination must activate at t=0 under {mode:?}, got {first}"
        );
    }
}
