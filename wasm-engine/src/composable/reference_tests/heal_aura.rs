//! Reference: ability_heal_aura
//!
//! The aura lands on both fighters, and the share it lands is read off the
//! creature being healed rather than off the one running it.

use super::super::config::ComposableAbilityConfig;
use super::super::simulate_composable_matchup_with_trace;
use super::default_combatant;
use crate::contracts::{SimpleAbilityTimingMode, SimpleCombatantStats};

fn quiet(max_hp: f64) -> SimpleCombatantStats {
    let mut c = default_combatant();
    c.health = max_hp;
    c.damage = 0.0;
    c.bite_cooldown = 1000.0;
    c.health_regen = 0.0;
    c
}

fn aura_config(value: f64) -> ComposableAbilityConfig {
    let mut cfg = ComposableAbilityConfig::default();
    cfg.attacker_heal_aura = true;
    cfg.attacker_heal_aura_value = value;
    cfg
}

#[test]
fn the_aura_heals_the_opponent_as_well_as_its_own_user() {
    // [REF:ability_heal_aura]
    let attacker = quiet(3_000.0);
    let defender = quiet(20_000.0);
    let result = simulate_composable_matchup_with_trace(
        &attacker, &defender, None, None,
        SimpleAbilityTimingMode::Fast,
        &aura_config(2.0),
        5.0, true,
    );
    let log = result.combat_log.expect("trace");
    let healed_for = |side: &str| -> f64 {
        log.iter()
            .filter(|e| e.description.as_deref() == Some("Heal Aura") && e.hp_side == side)
            .filter_map(|e| e.healing)
            .next()
            .unwrap_or(0.0)
    };
    // 2% of each creature's own maximum: 60 for the user, 400 for the opponent.
    assert!((healed_for("A") - 60.0).abs() < 1e-9, "user: {}", healed_for("A"));
    assert!((healed_for("B") - 400.0).abs() < 1e-9, "opponent: {}", healed_for("B"));
}

#[test]
fn an_aura_left_off_heals_nobody() {
    // [REF:ability_heal_aura]
    let attacker = quiet(3_000.0);
    let defender = quiet(20_000.0);
    let mut cfg = aura_config(2.0);
    cfg.attacker_heal_aura = false;
    let result = simulate_composable_matchup_with_trace(
        &attacker, &defender, None, None,
        SimpleAbilityTimingMode::Fast,
        &cfg,
        5.0, true,
    );
    let log = result.combat_log.expect("trace");
    assert!(!log.iter().any(|e| e.description.as_deref() == Some("Heal Aura")));
}
