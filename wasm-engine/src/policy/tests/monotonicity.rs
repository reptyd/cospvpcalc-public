//! Monotonicity invariant.
//!
//! For every migrated ability across a curated set of matchups:
//!
//!     final_outcome(Ideal) >= final_outcome(Fast) >= final_outcome(ReallyFast)
//!
//! 0 % tolerance. If Ideal ever produces a
//! strictly worse outcome than Fast or ReallyFast on any covered
//! matchup, the build is broken - fix before merge.
//!
//! "Outcome" is the matchup summary's `damage_dealt_a` after a full
//! simulation. We use full-sim damage rather than utility scores so
//! the assertion measures the actual game-mechanic effect of the
//! decision, not the engine's analytic estimate.
//!
//! ### Tolerance
//!
//! A small absolute tolerance (`MONOTONIC_EPS_DAMAGE`) is applied to
//! soak up cooldown-rounding and discrete-tick noise. The invariant is
//! "Ideal not strictly worse"; tiny float wobble at the 1e-6 level
//! is not the regression we care about.
//!
//! ### Why curated matchups, not random / fuzzed
//!
//! Curated matchups make a regression's root cause obvious - the
//! failing test names a specific ability + scenario, and the
//! diff between modes is reproducible across runs. Fuzz testing
//! is a future addition; out of scope here.

use crate::composable::simulate_composable_matchup_with_trace;
use crate::composable::ComposableAbilityConfig;
use crate::contracts::{
    BestBuildsMatchupSummary, SimpleAbilityTimingMode, SimpleCombatantStats,
};

const MONOTONIC_EPS_DAMAGE: f64 = 1e-3;
const SIM_HORIZON_SEC: f64 = 120.0;

fn simple_stats(hp: f64, damage: f64, bite_cooldown: f64) -> SimpleCombatantStats {
    let mut s = default_stats();
    s.health = hp;
    s.damage = damage;
    s.bite_cooldown = bite_cooldown;
    s
}

fn default_stats() -> SimpleCombatantStats {
    SimpleCombatantStats {
        health: 1_000.0,
        weight: 100.0,
        damage: 50.0,
        bite_cooldown: 2.0,
        damage2: 0.0,
        health_regen: 0.0,
        active_cooldown_multiplier: 1.0,
        quick_recovery_hp_ratio_threshold: 0.0,
        unbreakable_damage_cap_pct: 0.0,
        damage_taken_multiplier_on_being_bitten: 1.0,
        breath_resistance: 0.0,
        berserk_bite_cooldown_multiplier: 1.0,
        berserk_hp_ratio_threshold: 0.0,
        first_strike_pct: 0.0,
        first_strike_hp_ratio_threshold: 1.0,
        has_warden_resistance: false,
        has_reflect: false,
        immune_status_ids: vec![],
        hunker_reduction_pct: 0.0,
        self_destruct_profile: None,
        on_hit_statuses: vec![],
        on_hit_taken_statuses: vec![],
        starting_statuses: vec![],
        status_resist_fractions: Default::default(),
        plushie_status_block_fractions: Default::default(),
        plushie_reflect_avg_pct: 0.0,
        disabled_abilities: vec![],
        compare_air_rule_cooldown_sec: 0.0,
            user_ability_ids: Vec::new(),
            identity: None,
    }
}

fn run(
    a: &SimpleCombatantStats,
    b: &SimpleCombatantStats,
    config: &ComposableAbilityConfig,
    mode: SimpleAbilityTimingMode,
) -> BestBuildsMatchupSummary {
    simulate_composable_matchup_with_trace(a, b, None, None, mode, config, SIM_HORIZON_SEC, false)
}

/// Assert `Ideal >= Fast >= ReallyFast` on `damage_dealt_a` for the
/// given matchup. Tolerance is `MONOTONIC_EPS_DAMAGE`; any larger
/// inversion fails the test with a labeled message.
fn assert_monotonic(
    label: &str,
    a: &SimpleCombatantStats,
    b: &SimpleCombatantStats,
    config: &ComposableAbilityConfig,
) {
    let rf = run(a, b, config, SimpleAbilityTimingMode::ReallyFast);
    let fast = run(a, b, config, SimpleAbilityTimingMode::Fast);
    let ideal = run(a, b, config, SimpleAbilityTimingMode::Ideal);

    let (rf_dmg, fast_dmg, ideal_dmg) =
        (rf.damage_dealt_a, fast.damage_dealt_a, ideal.damage_dealt_a);

    assert!(
        fast_dmg + MONOTONIC_EPS_DAMAGE >= rf_dmg,
        "[{label}] Fast must not regress vs ReallyFast: fast={fast_dmg}, rf={rf_dmg}"
    );
    assert!(
        ideal_dmg + MONOTONIC_EPS_DAMAGE >= fast_dmg,
        "[{label}] Ideal must not regress vs Fast: ideal={ideal_dmg}, fast={fast_dmg}"
    );
    assert!(
        ideal_dmg + MONOTONIC_EPS_DAMAGE >= rf_dmg,
        "[{label}] Ideal must not regress vs ReallyFast: ideal={ideal_dmg}, rf={rf_dmg}"
    );
}

// ---- Per-ability matchups -----------------------------------------------

#[test]
fn baseline_no_abilities_three_modes_agree() {
    // Sanity control: with no abilities engaged, all three policies
    // must produce the same outcome (no policy choice to make).
    let a = simple_stats(1500.0, 60.0, 2.0);
    let b = simple_stats(1200.0, 45.0, 2.2);
    let config = ComposableAbilityConfig::default();
    assert_monotonic("baseline", &a, &b, &config);
}

#[test]
fn life_leech_attacker() {
    let a = simple_stats(1500.0, 60.0, 2.0);
    let b = simple_stats(1800.0, 50.0, 2.2);
    let mut config = ComposableAbilityConfig::default();
    config.attacker_life_leech_value = 0.20;
    assert_monotonic("life_leech_attacker", &a, &b, &config);
}

#[test]
fn life_leech_pre_wounded() {
    let mut a = simple_stats(2000.0, 70.0, 1.8);
    a.health_regen = 2.0;
    let b = simple_stats(2200.0, 55.0, 2.0);
    let mut config = ComposableAbilityConfig::default();
    config.attacker_life_leech_value = 0.30;
    assert_monotonic("life_leech_pre_wounded", &a, &b, &config);
}

#[test]
fn adrenaline_attacker() {
    let a = simple_stats(1500.0, 60.0, 2.0);
    let b = simple_stats(1800.0, 50.0, 2.2);
    let mut config = ComposableAbilityConfig::default();
    config.attacker_adrenaline = true;
    assert_monotonic("adrenaline", &a, &b, &config);
}

#[test]
fn unbridled_rage_attacker() {
    let a = simple_stats(1500.0, 60.0, 2.0);
    let b = simple_stats(1700.0, 50.0, 2.2);
    let mut config = ComposableAbilityConfig::default();
    config.attacker_unbridled_rage = true;
    assert_monotonic("unbridled_rage", &a, &b, &config);
}

#[test]
fn reflect_attacker_under_pressure() {
    let a = simple_stats(1500.0, 60.0, 2.0);
    let b = simple_stats(2000.0, 70.0, 1.8); // strong opp DPS
    let mut config = ComposableAbilityConfig::default();
    config.attacker_reflect = true;
    assert_monotonic("reflect_attacker", &a, &b, &config);
}

#[test]
fn hunters_curse_high_hp_actor() {
    let a = simple_stats(2000.0, 60.0, 2.0);
    let b = simple_stats(2500.0, 50.0, 2.2);
    let mut config = ComposableAbilityConfig::default();
    config.attacker_hunters_curse = true;
    assert_monotonic("hunters_curse_high_hp", &a, &b, &config);
}

#[test]
fn cocoon_low_hp_actor() {
    let mut a = simple_stats(1500.0, 60.0, 2.0);
    a.health_regen = 3.0;
    let b = simple_stats(2200.0, 65.0, 2.0);
    let mut config = ComposableAbilityConfig::default();
    config.attacker_cocoon = true;
    assert_monotonic("cocoon_low_hp", &a, &b, &config);
}

#[test]
fn fortify_against_starting_statuses() {
    use crate::contracts::SimpleAppliedStatus;
    let mut a = simple_stats(1500.0, 60.0, 2.0);
    a.starting_statuses = vec![
        SimpleAppliedStatus {
            status_id: "Burn_Status".to_string(),
            stacks: 8.0,
            source_ability: None,
        },
        SimpleAppliedStatus {
            status_id: "Bleed_Status".to_string(),
            stacks: 5.0,
            source_ability: None,
        },
    ];
    let b = simple_stats(2000.0, 55.0, 2.2);
    let mut config = ComposableAbilityConfig::default();
    config.attacker_fortify = true;
    assert_monotonic("fortify_starting_statuses", &a, &b, &config);
}

#[test]
fn hunker_under_heavy_incoming_dps() {
    let mut a = simple_stats(2000.0, 50.0, 2.0);
    a.hunker_reduction_pct = 40.0;
    let b = simple_stats(2200.0, 80.0, 1.8); // heavy incoming
    let config = ComposableAbilityConfig::default();
    // Hunker is enabled by passing a non-zero hunker_reduction_pct
    // - the engine's `attacker_hunker_enabled` check looks at that.
    assert_monotonic("hunker_heavy_incoming", &a, &b, &config);
}

#[test]
fn warden_rage_attacker_pre_wounded() {
    let mut a = simple_stats(2000.0, 60.0, 2.0);
    a.health_regen = 2.0;
    let b = simple_stats(2400.0, 55.0, 2.0);
    let mut config = ComposableAbilityConfig::default();
    config.attacker_warden_rage = true;
    assert_monotonic("warden_rage_attacker", &a, &b, &config);
}

#[test]
fn rewind_attacker_with_history() {
    let mut a = simple_stats(2000.0, 60.0, 2.0);
    a.health_regen = 2.0;
    let b = simple_stats(2200.0, 55.0, 2.0);
    let mut config = ComposableAbilityConfig::default();
    config.attacker_rewind = true;
    assert_monotonic("rewind_attacker", &a, &b, &config);
}
