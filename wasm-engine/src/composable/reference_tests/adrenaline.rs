//! Reference: ability_adrenaline
//!
//! Covers each testable bullet in the "Adrenaline" entry. Each test body
//! starts with the [REF:ability_adrenaline] marker so the vitest coverage
//! gate (src/pages/referenceCoverage.test.ts) sees it.

use super::super::config::ComposableAbilityConfig;
use super::super::simulate_composable_matchup_with_trace;
use super::{default_breath, default_combatant};
use crate::actives::simulate_simple_adrenaline_activation;
use crate::composable::policy_bridge;
use crate::contracts::{SimpleAbilityTimingMode, SimpleBreathProfile, SimpleCombatantStats};
use crate::policy::decisions::adrenaline::ADRENALINE_DECISION_ID;
use crate::policy::state::PolicySide;
use std::collections::BTreeMap;

fn run_bite_matchup(
    attacker: &SimpleCombatantStats,
    defender: &SimpleCombatantStats,
    breath: Option<&SimpleBreathProfile>,
    config: &ComposableAbilityConfig,
    max_time_sec: f64,
) -> f64 {
    simulate_composable_matchup_with_trace(
        attacker,
        defender,
        breath,
        None,
        SimpleAbilityTimingMode::SemiIdeal,
        config,
        max_time_sec,
        false,
    )
    .final_hp_b
}

#[test]
fn lasts_thirty_seconds() {
    // [REF:ability_adrenaline]
    let attacker = default_combatant();
    let result = simulate_simple_adrenaline_activation(10.0, &attacker, true, false, 0.0, 0.0);
    let duration = result.adrenaline_active_until - 10.0;
    assert!(
        (duration - 30.0).abs() < 1e-9,
        "expected 30 s duration, got {duration}"
    );
}

#[test]
fn base_cooldown_ninety_seconds() {
    // [REF:ability_adrenaline]
    let mut attacker = default_combatant();
    attacker.active_cooldown_multiplier = 1.0;
    let result = simulate_simple_adrenaline_activation(10.0, &attacker, true, false, 0.0, 0.0);
    let cooldown = result.adrenaline_cooldown_until - 10.0;
    assert!(
        (cooldown - 90.0).abs() < 1e-9,
        "expected 90 s base cooldown, got {cooldown}"
    );
}

#[test]
fn bite_damage_multiplied_by_one_point_two_when_active() {
    // [REF:ability_adrenaline]
    let mut attacker = default_combatant();
    attacker.damage = 100.0;
    attacker.bite_cooldown = 2.0;
    let mut defender = default_combatant();
    defender.health = 5_000.0;
    defender.weight = 100.0;
    defender.damage = 0.0;
    defender.bite_cooldown = 1000.0;

    // Window short enough to stay inside the 30 s adrenaline duration.
    let max_time = 20.0;

    let mut cfg_off = ComposableAbilityConfig::default();
    cfg_off.attacker_adrenaline = false;
    let hp_without = run_bite_matchup(&attacker, &defender, None, &cfg_off, max_time);

    let mut cfg_on = ComposableAbilityConfig::default();
    cfg_on.attacker_adrenaline = true;
    let hp_with = run_bite_matchup(&attacker, &defender, None, &cfg_on, max_time);

    let damage_without = defender.health - hp_without;
    let damage_with = defender.health - hp_with;
    assert!(damage_without > 0.0, "baseline must do some damage");

    // Per-bite multiplier is exactly 1.2x. The end-to-end ratio converges
    // to 1.2 as the number of bites grows, but the very first bite can
    // land before adrenaline activation depending on tick ordering, so
    // the observed ratio is (1.2N - 0.2) / N for an off-by-one bite.
    // attacker.damage = 100, so each bite-with-buff contributes 20 extra
    // damage. damage_with - damage_without should equal 20 × M for some
    // integer M close to N.
    let baseline_per_bite = attacker.damage;
    let bonus = damage_with - damage_without;
    let bonus_per_bite = 0.2 * baseline_per_bite;
    let m = bonus / bonus_per_bite;
    assert!(
        (m - m.round()).abs() < 1e-9,
        "bonus should be an integer multiple of 0.2x base damage: bonus={bonus}, base={baseline_per_bite}"
    );
    assert!(
        m.round() >= 1.0,
        "at least one bite must benefit from adrenaline"
    );
    let n = damage_without / baseline_per_bite;
    assert!(
        (m - n).abs() <= 1.0 + 1e-9,
        "bonus bite count {m} should be within one of total bite count {n}"
    );
}

#[test]
fn boost_does_not_apply_to_breath_damage() {
    // [REF:ability_adrenaline]
    let mut attacker = default_combatant();
    attacker.damage = 0.0;
    attacker.bite_cooldown = 1000.0; // suppress bite so only breath lands.
    let mut defender = default_combatant();
    defender.health = 100_000.0;
    defender.weight = 100.0;
    defender.damage = 0.0;
    defender.bite_cooldown = 1000.0;

    let mut breath = default_breath();
    breath.dps_pct = 1.0;
    breath.capacity = 10.0;
    breath.regen_rate = 1.8;
    breath.crit_chance_pct = 0.0;

    let max_time = 25.0;

    let mut cfg_off = ComposableAbilityConfig::default();
    cfg_off.attacker_adrenaline = false;
    let hp_without = run_bite_matchup(&attacker, &defender, Some(&breath), &cfg_off, max_time);

    let mut cfg_on = ComposableAbilityConfig::default();
    cfg_on.attacker_adrenaline = true;
    let hp_with = run_bite_matchup(&attacker, &defender, Some(&breath), &cfg_on, max_time);

    assert!(
        (hp_without - hp_with).abs() < 1e-6,
        "adrenaline must not change breath damage: hp_without={hp_without}, hp_with={hp_with}"
    );
}

#[test]
fn activates_immediately_for_all_policies() {
    // [REF:ability_adrenaline]
    // Adrenaline routes through the unified policy decision engine.
    // Reference policyDifferences mandate "activates as soon as it
    // is available across all timing policy modes" - verified here
    // by querying the bridge directly under each TimingMode.
    let stats = default_combatant();
    let make_side = || PolicySide {
        stats: stats.clone(),
        hp: stats.health,
        statuses: BTreeMap::new(),
        cooldowns: BTreeMap::new(),
        active_until: BTreeMap::new(),
        breath_capacity: 0.0,
        breath: None,
        next_hit: 0.0,
        next_breath: f64::INFINITY,
        extras: BTreeMap::new(),
        recent_damage_taken: Vec::new(),
        recent_damage_dealt: Vec::new(),
        posture: "Standing".to_string(),
    };
    for sim_mode in [
        SimpleAbilityTimingMode::ReallyFast,
        SimpleAbilityTimingMode::Fast,
        SimpleAbilityTimingMode::SemiIdeal,
        SimpleAbilityTimingMode::Ideal,
        SimpleAbilityTimingMode::Extreme,
    ] {
        let mode = policy_bridge::map_timing_mode(sim_mode);
        let activate = policy_bridge::should_activate_now(
            ADRENALINE_DECISION_ID,
            make_side(),
            make_side(),
            0.0,
            mode,
        );
        assert!(
            activate,
            "Adrenaline should activate under {sim_mode:?} (ASAP rule)"
        );
    }
}
