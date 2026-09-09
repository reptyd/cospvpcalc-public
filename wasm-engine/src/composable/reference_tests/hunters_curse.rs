//! Reference: ability_hunters_curse
//!
//! Covers each testable bullet in the "Hunters Curse" entry. Each test
//! body starts with the [REF:ability_hunters_curse] marker so the vitest
//! coverage gate (src/pages/referenceCoverage.test.ts) sees it.
//!
//! Engine path: `composable/mod.rs:3120-3247` (Hunters Curse activation
//! phase). Self-cost helper at `composable/mod.rs:483-487`. The 2x bite
//! multiplier is applied in Phase 10 melee resolution at
//! `composable/mod.rs:4700-4712` and `:5054-5066`.

use super::super::config::ComposableAbilityConfig;
use super::super::{simulate_composable_matchup, simulate_composable_matchup_with_trace};
use super::{default_breath, default_combatant};
use crate::contracts::{SimpleAbilityTimingMode, SimpleCombatantStats};
use crate::spec_constants::{
    HUNTERS_CURSE_BITE_MULTIPLIER, HUNTERS_CURSE_COOLDOWN_SEC, HUNTERS_CURSE_DURATION_SEC,
    HUNTERS_CURSE_HP_COST_PCT,
};

fn passive_combatant(max_hp: f64) -> SimpleCombatantStats {
    let mut c = default_combatant();
    c.health = max_hp;
    c.damage = 0.0;
    c.bite_cooldown = 1000.0;
    c
}

fn hunters_curse_attacker_config() -> ComposableAbilityConfig {
    let mut cfg = ComposableAbilityConfig::default();
    cfg.attacker_hunters_curse = true;
    cfg
}

fn activation_times(
    attacker: &SimpleCombatantStats,
    defender: &SimpleCombatantStats,
    cfg: &ComposableAbilityConfig,
    max_time_sec: f64,
) -> Vec<f64> {
    let result = simulate_composable_matchup_with_trace(
        attacker,
        defender,
        None,
        None,
        SimpleAbilityTimingMode::ReallyFast,
        cfg,
        max_time_sec,
        true,
    );
    let log = result.combat_log.expect("trace log requested");
    log.iter()
        .filter(|e| {
            e.entry_type == "ability"
                && e.attacker == "A"
                && e.description.as_deref() == Some("Hunters Curse activated")
        })
        .map(|e| e.time)
        .collect()
}

fn deactivation_times(
    attacker: &SimpleCombatantStats,
    defender: &SimpleCombatantStats,
    cfg: &ComposableAbilityConfig,
    max_time_sec: f64,
) -> Vec<f64> {
    let result = simulate_composable_matchup_with_trace(
        attacker,
        defender,
        None,
        None,
        SimpleAbilityTimingMode::ReallyFast,
        cfg,
        max_time_sec,
        true,
    );
    let log = result.combat_log.expect("trace log requested");
    log.iter()
        .filter(|e| {
            e.entry_type == "ability"
                && e.attacker == "A"
                && e.description.as_deref() == Some("Hunters Curse deactivated")
        })
        .map(|e| e.time)
        .collect()
}

#[test]
fn lasts_thirty_seconds() {
    // [REF:ability_hunters_curse]
    // Bullet 1: "Hunters Curse lasts for 30 seconds."
    // Engine assigns `hunters_curse_active_until = time + 30.0`
    // (composable/mod.rs:3130). Observe via the bite-damage 2x window:
    // at t=29.999 the bite multiplier is 2x; at t=30.001 it falls back
    // to 1x. Test indirectly through bite damage delta.
    //
    // Simpler observation: only one activation can fire in a 31 s
    // window (next would need 120 s cooldown). The activation event
    // at t=0 plus the 30 s active window exhausts within the run.
    let attacker = passive_combatant(1_000_000.0);
    let mut defender = passive_combatant(1_000_000.0);
    defender.damage = 1.0;
    defender.bite_cooldown = 5.0;

    let activations = activation_times(&attacker, &defender, &hunters_curse_attacker_config(), 31.0);
    assert_eq!(
        activations.len(),
        1,
        "exactly one Hunters Curse activation in 31 s window: {activations:?}"
    );
    // First activation at t=0 (ReallyFast). 30 s active window expires
    // at t=30; cooldown blocks re-activation until t=120. So between
    // t=30 and t=31 there is no Hunters Curse boost AND no new
    // activation event.
    assert!(
        activations[0].abs() < 1e-6,
        "first activation must land at t=0, got {}",
        activations[0]
    );

    // Witness the active-window length directly: the engine sets
    // `hunters_curse_active_until = activation_time + 30.0`
    // (phases/phase4.rs) and emits "Hunters Curse deactivated" at the
    // first loop event at/after the window end. A 0.5 s bite cadence
    // keeps events flowing so the close lands within a sub-second of
    // t=30. Activation is at t=0, so the deactivation time is the
    // window length.
    let mut biter = passive_combatant(1_000_000.0);
    biter.damage = 1.0;
    biter.bite_cooldown = 0.5;
    let deactivation = *deactivation_times(&attacker, &biter, &hunters_curse_attacker_config(), 60.0)
        .first()
        .expect("Hunters Curse window must close before the 60 s window ends");
    assert!(
        (deactivation - HUNTERS_CURSE_DURATION_SEC).abs() < 0.6,
        "Hunters Curse active window must last ~{HUNTERS_CURSE_DURATION_SEC} s, deactivation landed at {deactivation}"
    );
}

#[test]
fn cooldown_one_hundred_twenty_seconds() {
    // [REF:ability_hunters_curse]
    // Bullet 2: "It has a 120 second cooldown."
    // First activation at t=0; second activation gated by 120 s cooldown
    // measured from the first. A slow biter keeps the loop alive past
    // the cooldown boundary.
    let attacker = passive_combatant(10_000_000.0);
    let mut defender = passive_combatant(1_000_000.0);
    // Zero-damage biter keeps the loop alive without pushing the attacker
    // below the 50% gate: after the first cast the attacker sits at exactly
    // 50% max HP, which still clears CanUse, so the second cast fires on
    // cooldown (the activation is logged before the flat cost self-kills it).
    defender.damage = 0.0;
    defender.bite_cooldown = 5.0;

    let activations = activation_times(&attacker, &defender, &hunters_curse_attacker_config(), 200.0);
    assert!(
        activations.len() >= 2,
        "Hunters Curse must fire at least twice in a 200 s window: {activations:?}"
    );
    let gap = activations[1] - activations[0];
    assert!(
        (gap - HUNTERS_CURSE_COOLDOWN_SEC).abs() < 1.0,
        "second Hunters Curse activation must land ~{HUNTERS_CURSE_COOLDOWN_SEC} s after the first, got {gap}: {activations:?}"
    );
}

#[test]
fn costs_fifty_percent_max_hp_on_activation() {
    // [REF:ability_hunters_curse]
    // Bullet 4: "When it is activated, the user immediately loses 50% of its
    // max HP as a flat cost with no floor, so activating at exactly 50% HP
    // kills the user." Engine: `apply_hunters_curse_self_cost` deducts maxHP x
    // 0.5 (subject to unbreakable cap) from the owner's HP at activation time.
    // With a fresh attacker at full HP, post-activation HP must be exactly 0.5
    // x maxHP.
    let attacker = passive_combatant(1_000.0);
    let mut defender = passive_combatant(1_000_000.0);
    defender.damage = 0.0; // attacker takes no other damage in window
    defender.bite_cooldown = 1000.0;

    let result = simulate_composable_matchup(
        &attacker,
        &defender,
        None,
        None,
        SimpleAbilityTimingMode::ReallyFast,
        &hunters_curse_attacker_config(),
        1.0,
    );
    // Activation fires at t=0 (ReallyFast). After 1 s of no-damage,
    // attacker HP must equal 50% of maxHP (no other HP source moves it).
    let expected = 1_000.0 * (1.0 - HUNTERS_CURSE_HP_COST_PCT / 100.0);
    assert!(
        (result.final_hp_a - expected).abs() < 1e-6,
        "post-activation HP must equal maxHP minus the {HUNTERS_CURSE_HP_COST_PCT}% cost = {expected}, got {}",
        result.final_hp_a
    );
}

#[test]
fn cost_is_flat_fifty_percent_with_no_floor() {
    // [REF:ability_hunters_curse]
    // Bullet 4: "the user immediately loses 50% of its max HP as a flat cost
    // with no floor, so activating at exactly 50% HP kills the user."
    // Direct unit test of the self-cost helper.
    use super::super::apply_hunters_curse_self_cost;

    let mut attacker = default_combatant();
    attacker.health = 1_000.0; // maxHP -> flat cost = 500

    // At exactly 50% HP the flat cost drops the user to 0 (death), no floor.
    let killed = apply_hunters_curse_self_cost(500.0, &attacker);
    assert!(
        killed.abs() < 1e-9,
        "flat 50% cost at exactly 50% HP must leave 0 HP (death), got {killed}"
    );
    // Above 50% HP the cost applies normally: 600 - 500 = 100.
    let normal = apply_hunters_curse_self_cost(600.0, &attacker);
    assert!(
        (normal - 100.0).abs() < 1e-9,
        "Hunters Curse cost must apply the flat 50% when HP exceeds cost: expected 100, got {normal}"
    );
}

#[test]
fn cannot_activate_below_fifty_percent_hp() {
    // [REF:ability_hunters_curse]
    // Bullet 3: "It cannot be used while the user's current HP is below 50%
    // of max HP." The attacker starts at 40% HP (compare start-HP) against
    // a passive opponent - no regen, no incoming damage - so it stays below
    // the gate and Hunters Curse never activates.
    let attacker = passive_combatant(1_000.0);
    let defender = passive_combatant(1_000_000.0);
    let mut cfg = hunters_curse_attacker_config();
    // The compare start-HP seed is only applied when Warden's Rage is on
    // (setup.rs). The attacker has no regen and the opponent deals no damage,
    // so it holds at 40% - below the gate - for the whole window.
    cfg.attacker_warden_rage = true;
    cfg.attacker_compare_start_hp_pct = 40.0;

    let activations = activation_times(&attacker, &defender, &cfg, 30.0);
    assert!(
        activations.is_empty(),
        "Hunters Curse must not activate below 50% HP: {activations:?}"
    );
}

#[test]
fn doubles_bite_damage_during_active_window() {
    // [REF:ability_hunters_curse]
    // Bullet 6: "While Hunters Curse is active, the user's melee damage is
    // multiplied by 2." Compare per-bite damage to the defender between a
    // no-HC baseline and an HC run. Inside the 30 s active window the HC run
    // must deliver exactly 2x damage per bite.
    let mut attacker = passive_combatant(1_000_000.0);
    attacker.damage = 100.0;
    attacker.bite_cooldown = 0.5;
    let defender = passive_combatant(10_000_000.0);

    let baseline_cfg = ComposableAbilityConfig::default();
    let baseline = simulate_composable_matchup(
        &attacker, &defender, None, None,
        SimpleAbilityTimingMode::ReallyFast,
        &baseline_cfg, 5.0,
    );
    let hc = simulate_composable_matchup(
        &attacker, &defender, None, None,
        SimpleAbilityTimingMode::ReallyFast,
        &hunters_curse_attacker_config(), 5.0,
    );
    let baseline_dmg = defender.health - baseline.final_hp_b;
    let hc_dmg = defender.health - hc.final_hp_b;
    let ratio = hc_dmg / baseline_dmg;
    assert!(
        baseline_dmg > 0.0,
        "baseline bite damage must be positive (got {baseline_dmg})"
    );
    assert!(
        (ratio - HUNTERS_CURSE_BITE_MULTIPLIER).abs() < 1e-6,
        "Hunters Curse must multiply bite damage by {HUNTERS_CURSE_BITE_MULTIPLIER}x during the 30 s window: hc={hc_dmg}, baseline={baseline_dmg}, ratio={ratio}"
    );
}

#[test]
fn does_not_boost_breath_damage() {
    // [REF:ability_hunters_curse]
    // Bullet 7: "It boosts melee damage only and does not increase breath
    // damage." The breath damage path
    // (`combat::compute_simple_breath_damage_*` and the engine breath tick)
    // does not consult `hunters_curse_active_until`. Sim with HC vs no-HC over
    // a 5 s breath window; total breath damage must be identical.
    let mut attacker = passive_combatant(1_000_000.0);
    attacker.damage = 0.0; // no melee
    attacker.bite_cooldown = 1000.0;
    let mut defender = passive_combatant(10_000_000.0);
    defender.weight = 100.0;
    let mut breath = default_breath();
    breath.dps_pct = 1.0;
    breath.capacity = 5.0;
    breath.regen_rate = 1.0;
    breath.crit_chance_pct = 0.0;

    let baseline = simulate_composable_matchup(
        &attacker, &defender,
        Some(&breath), None,
        SimpleAbilityTimingMode::ReallyFast,
        &ComposableAbilityConfig::default(), 5.0,
    );
    let hc = simulate_composable_matchup(
        &attacker, &defender,
        Some(&breath), None,
        SimpleAbilityTimingMode::ReallyFast,
        &hunters_curse_attacker_config(), 5.0,
    );
    assert!(
        (baseline.damage_dealt_a - hc.damage_dealt_a).abs() < 1e-6,
        "Hunters Curse must NOT change breath damage: baseline={}, hc={}",
        baseline.damage_dealt_a, hc.damage_dealt_a,
    );
}
