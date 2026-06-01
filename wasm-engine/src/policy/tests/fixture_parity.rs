//! Pillar 5.4 — fixture parity smoke test.
//!
//! The full fixture suite lives in `wasm-engine/src/fixture_tests.rs`
//! and runs as part of `cargo test --lib`. This file is a *smoke
//! test* on the policy layer: a small handful of curated matchups
//! representative of the migrated abilities, asserting `winner`
//! and outcome stability.
//!
//! The intent is to fail fast when a policy decision regresses in
//! a way that doesn't show up as a monotonicity inversion (e.g.
//! Ideal and Fast both regress equally). The full fixture sweep
//! catches the rest.

use crate::composable::simulate_composable_matchup_with_trace;
use crate::composable::ComposableAbilityConfig;
use crate::contracts::{SimpleAbilityTimingMode, SimpleCombatantStats, Winner};

const SIM_HORIZON_SEC: f64 = 120.0;

fn simple_stats(hp: f64, damage: f64, bite_cooldown: f64) -> SimpleCombatantStats {
    SimpleCombatantStats {
        health: hp,
        weight: 100.0,
        damage,
        bite_cooldown,
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

fn winner_under(
    a: &SimpleCombatantStats,
    b: &SimpleCombatantStats,
    config: &ComposableAbilityConfig,
    mode: SimpleAbilityTimingMode,
) -> Winner {
    simulate_composable_matchup_with_trace(a, b, None, None, mode, config, SIM_HORIZON_SEC, false)
        .winner
}

#[test]
fn baseline_higher_dps_wins() {
    // No abilities — pure DPS race; A should win (higher damage,
    // similar HP).
    let a = simple_stats(1500.0, 70.0, 2.0);
    let b = simple_stats(1500.0, 50.0, 2.0);
    let config = ComposableAbilityConfig::default();
    for mode in [
        SimpleAbilityTimingMode::ReallyFast,
        SimpleAbilityTimingMode::Fast,
        SimpleAbilityTimingMode::Ideal,
    ] {
        assert_eq!(winner_under(&a, &b, &config, mode), Winner::A, "{mode:?}");
    }
}

#[test]
fn life_leech_swings_close_match_to_owner() {
    // Without Life Leech, B should narrowly win or tie (slightly
    // higher DPS over time). With Life Leech on A, A's heal swings
    // it to a win.
    let a = simple_stats(2000.0, 60.0, 2.0);
    let b = simple_stats(2200.0, 55.0, 2.0);
    let mut config = ComposableAbilityConfig::default();
    config.attacker_life_leech_value = 0.30;
    let winner_with = winner_under(&a, &b, &config, SimpleAbilityTimingMode::Ideal);
    // Life Leech with 30% leech under Ideal should let A flip the
    // result to its favor or at least to a draw (not a loss).
    assert!(
        winner_with == Winner::A || winner_with == Winner::Draw,
        "Life Leech Ideal must swing close match toward owner: got {winner_with:?}"
    );
}

#[test]
fn fortify_lets_actor_outlast_status_pressure() {
    use crate::contracts::SimpleAppliedStatus;
    let mut a = simple_stats(2000.0, 60.0, 2.0);
    a.starting_statuses = vec![
        SimpleAppliedStatus {
            status_id: "Burn_Status".to_string(),
            stacks: 10.0,
            source_ability: None,
        },
        SimpleAppliedStatus {
            status_id: "Bleed_Status".to_string(),
            stacks: 8.0,
            source_ability: None,
        },
    ];
    let b = simple_stats(2000.0, 50.0, 2.2);
    let mut config = ComposableAbilityConfig::default();
    config.attacker_fortify = true;
    // With Fortify cleansing the heavy starting stacks, A's higher
    // base DPS should let it win under Ideal.
    let winner = winner_under(&a, &b, &config, SimpleAbilityTimingMode::Ideal);
    assert_eq!(winner, Winner::A);
}
