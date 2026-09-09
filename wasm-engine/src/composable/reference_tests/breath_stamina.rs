//! Reference: ability_miasma_breath, ability_cloud_breath
//!
//! The two breaths that move a stamina pool: Miasma takes pool units from the
//! target on every hit, Cloud returns a share of the user's own pool on every
//! hit. Both run on the 0.5 second hit interval the engine already ticks
//! breath on, and both are inert in a fight that does not model stamina.

use super::super::config::ComposableAbilityConfig;
use super::super::simulate_composable_matchup_with_trace;
use super::{default_breath, default_combatant};
use crate::contracts::{SimpleAbilityTimingMode, SimpleBreathProfile, SimpleCombatantStats};

fn quiet(max_hp: f64, stamina: f64) -> SimpleCombatantStats {
    let mut c = default_combatant();
    c.health = max_hp;
    c.damage = 0.0;
    c.bite_cooldown = 1000.0;
    c.health_regen = 0.0;
    c.stamina = stamina;
    c.stamina_regen = 0.0;
    c
}

fn miasma() -> SimpleBreathProfile {
    let mut breath = default_breath();
    breath.dps_pct = 0.25;
    breath.capacity = 10.0;
    breath.regen_rate = 2.5;
    breath.crit_chance_pct = 25.0;
    breath.special_kind = Some("miasma".to_string());
    breath.self_heal_pct = 0.5;
    breath.stamina_damage = crate::spec_constants::MIASMA_BREATH_STAMINA_DAMAGE;
    breath
}

fn cloud() -> SimpleBreathProfile {
    let mut breath = default_breath();
    breath.dps_pct = 0.0;
    breath.capacity = 15.0;
    breath.regen_rate = 1.3;
    breath.crit_chance_pct = 0.0;
    breath.special_kind = Some("cloud".to_string());
    breath.self_heal_pct = 1.0;
    breath.stamina_regen_pct = crate::spec_constants::CLOUD_BREATH_STAMINA_REGEN_PCT;
    breath
}

/// Both pools after `seconds` of the attacker firing `breath`, as (A, B).
fn pools(breath: &SimpleBreathProfile, stamina_on: bool, seconds: f64) -> (f64, f64) {
    let attacker = quiet(100_000.0, 100.0);
    let defender = quiet(100_000.0, 100.0);
    let mut config = ComposableAbilityConfig::default();
    config.stamina_enabled = stamina_on;

    let debug = simulate_composable_matchup_with_trace(
        &attacker, &defender, Some(breath), None,
        SimpleAbilityTimingMode::Ideal,
        &config,
        seconds, true,
    )
    .debug
    .expect("side snapshots");
    (debug.a.stamina, debug.b.stamina)
}

#[test]
fn miasma_takes_pool_units_from_the_target_on_every_hit() {
    // [REF:ability_miasma_breath]
    // Two hits a second for two seconds is four hits, 2.5 units each.
    let (_, defender) = pools(&miasma(), true, 2.0);
    assert!(defender < 100.0, "the target's pool falls");
    assert!(
        (100.0 - defender - 10.0).abs() < 2.5 + 1e-9,
        "and falls by 2.5 a hit, four hits in two seconds: {defender}",
    );
}

#[test]
fn miasma_takes_nothing_where_stamina_is_not_modelled() {
    // [REF:ability_miasma_breath]
    let (_, defender) = pools(&miasma(), false, 10.0);
    assert_eq!(defender, 100.0, "the pool the fight never reads is left as it started");
}

#[test]
fn cloud_returns_a_share_of_the_users_own_pool_on_every_hit() {
    // [REF:ability_cloud_breath]
    // Poison drains the pool while it ticks, which is what gives the breath
    // something to put back. 5% of a 100 pool is 5 units a hit against
    // Poison's 0.35% a stack a tick, so the user ends the fight ahead.
    let mut poisoned = quiet(100_000.0, 100.0);
    poisoned.starting_statuses = vec![super::applied_status("Poison_Status", 20.0)];
    let defender = quiet(100_000.0, 100.0);

    let mut config = ComposableAbilityConfig::default();
    config.stamina_enabled = true;

    let pool = |breath: &SimpleBreathProfile| {
        simulate_composable_matchup_with_trace(
            &poisoned, &defender, Some(breath), None,
            SimpleAbilityTimingMode::Ideal,
            &config,
            10.0, true,
        )
        .debug
        .expect("side snapshots")
        .a
        .stamina
    };

    let mut silent = default_breath();
    silent.dps_pct = 0.0;
    silent.special_kind = Some("cloud".to_string());

    let with_regen = pool(&cloud());
    let without_regen = pool(&silent);
    assert!(
        with_regen > without_regen + 1e-9,
        "the breath puts stamina back: {with_regen} against {without_regen}",
    );
    assert!(with_regen <= 100.0 + 1e-9, "and never past the ceiling: {with_regen}");
}

#[test]
fn cloud_returns_nothing_where_stamina_is_not_modelled() {
    // [REF:ability_cloud_breath]
    let (attacker, _) = pools(&cloud(), false, 10.0);
    assert_eq!(attacker, 100.0, "the pool the fight never reads is left as it started");
}
