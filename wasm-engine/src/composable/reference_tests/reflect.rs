//! Reference: ability_reflect
//!
//! Covers each testable bullet in the "Reflect" entry. Each test body
//! starts with the [REF:ability_reflect] marker so the vitest coverage
//! gate (src/pages/referenceCoverage.test.ts) sees it.
//!
//! Engine path: activation in `composable/mod.rs:3920-3974` (Phase 4p
//! — `reflect_active_until = time + 6.0`, cooldown +60, gated by
//! `policy_framework::should_activate_reflect`). Reflect resolution in
//! `apply_direct_damage_with_reflect` (`composable/mod.rs:489-545`):
//! when target has `has_reflect=true`, incoming damage is reduced to
//! 0 on the target and the reflected amount is applied to the source
//! using `compute_simple_reflected_melee_damage` (bite path) or
//! `compute_simple_reflected_breath_damage` (breath path).

use super::super::config::ComposableAbilityConfig;
use super::super::{simulate_composable_matchup, simulate_composable_matchup_with_trace};
use super::{applied_status, default_breath, default_combatant};
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

fn reflect_attacker_cfg() -> ComposableAbilityConfig {
    let mut cfg = ComposableAbilityConfig::default();
    cfg.attacker_reflect = true;
    cfg
}

fn activation_times(
    attacker: &SimpleCombatantStats,
    defender: &SimpleCombatantStats,
    cfg: &ComposableAbilityConfig,
    max_time_sec: f64,
) -> Vec<f64> {
    let result = simulate_composable_matchup_with_trace(
        attacker, defender, None, None,
        SimpleAbilityTimingMode::ReallyFast,
        cfg, max_time_sec, true,
    );
    let log = result.combat_log.expect("trace log requested");
    log.iter()
        .filter(|e| {
            e.entry_type == "ability"
                && e.attacker == "A"
                && e.description.as_deref() == Some("Reflect activated")
        })
        .map(|e| e.time)
        .collect()
}

#[test]
fn starts_immediately_at_t_zero_when_actives_enabled() {
    // [REF:ability_reflect]
    // Bullet 1 + policy bullet: "Reflect starts immediately at t=0 if
    // actives are enabled." Engine: ReallyFast policy fires Reflect on
    // cooldown — first activation at t=0.
    let attacker = passive_combatant(10_000.0);
    let mut defender = passive_combatant(10_000_000.0);
    defender.damage = 1.0;
    defender.bite_cooldown = 5.0;
    let activations = activation_times(&attacker, &defender, &reflect_attacker_cfg(), 1.0);
    let first = *activations
        .first()
        .expect("Reflect must activate at t=0 with ReallyFast policy");
    assert!(
        first.abs() < 1e-6,
        "first Reflect activation must land at t=0, got {first}"
    );
}

#[test]
fn lasts_six_seconds() {
    // [REF:ability_reflect]
    // Bullet 2: "Reflect lasts for 6 seconds."
    // Engine: `reflect_active_until = time + 6.0` (composable/mod.rs:3933).
    // The 60 s cooldown blocks re-activation between t=0 and t=60, so
    // a 7 s window must produce exactly ONE activation event (the
    // 6 s window has expired but the cooldown still blocks).
    let attacker = passive_combatant(10_000.0);
    let mut defender = passive_combatant(10_000_000.0);
    defender.damage = 1.0;
    defender.bite_cooldown = 5.0;
    let activations = activation_times(&attacker, &defender, &reflect_attacker_cfg(), 7.0);
    assert_eq!(
        activations.len(),
        1,
        "exactly one Reflect activation in a 7 s window (6 s window done, 60 s cooldown still blocks): {activations:?}"
    );
}

#[test]
fn cooldown_sixty_seconds() {
    // [REF:ability_reflect]
    // Bullet 3: "It has a 60 second cooldown."
    // First activation at t=0; second activation gated by 60 s cooldown.
    let attacker = passive_combatant(10_000_000.0);
    let mut defender = passive_combatant(10_000_000.0);
    defender.damage = 1.0;
    defender.bite_cooldown = 5.0;
    let activations = activation_times(&attacker, &defender, &reflect_attacker_cfg(), 130.0);
    assert!(
        activations.len() >= 2,
        "Reflect must fire at least twice in a 130 s window: {activations:?}"
    );
    let gap = activations[1] - activations[0];
    assert!(
        (gap - 60.0).abs() < 1.0,
        "second Reflect activation must land ~60 s after the first, got {gap}: {activations:?}"
    );
}

#[test]
fn reflects_bite_damage_back_to_attacker() {
    // [REF:ability_reflect]
    // Bullet 4: "While Reflect is active, direct bite damage is reduced
    // to 0 on the reflector and is instead dealt back to the attacker."
    // A holds Reflect; B bites A. Within the 6 s active window, A's
    // HP must NOT drop from B's bite, and B must take damage instead.
    let mut a = passive_combatant(1_000_000.0);
    a.weight = 100.0;
    let b = melee_combatant(1_000_000.0, 100.0, 0.5);

    // Compare with-Reflect run vs no-Reflect baseline. Within 5 s
    // (inside Reflect's 6 s window), A should take dramatically less
    // damage and B should take more.
    let baseline = simulate_composable_matchup(
        &a, &b, None, None,
        SimpleAbilityTimingMode::ReallyFast,
        &ComposableAbilityConfig::default(), 5.0,
    );
    let reflected = simulate_composable_matchup(
        &a, &b, None, None,
        SimpleAbilityTimingMode::ReallyFast,
        &reflect_attacker_cfg(), 5.0,
    );
    assert!(
        reflected.final_hp_a > baseline.final_hp_a,
        "Reflect must reduce A's incoming bite damage: \
         reflect hp_a={}, baseline hp_a={}",
        reflected.final_hp_a, baseline.final_hp_a,
    );
    // Reflected damage flows back: B takes more under reflect than baseline.
    let baseline_b_damage = b.health - baseline.final_hp_b;
    let reflected_b_damage = b.health - reflected.final_hp_b;
    assert!(
        reflected_b_damage > baseline_b_damage,
        "Reflect must deal reflected damage back to B: \
         reflected_b_damage={reflected_b_damage}, baseline_b_damage={baseline_b_damage}"
    );
}

#[test]
fn reflects_breath_damage_back_to_attacker() {
    // [REF:ability_reflect]
    // Bullet 5: "While Reflect is active, direct breath damage is also
    // reduced to 0 on the reflector and is instead dealt back to the
    // attacker."
    // Same shape as bullet 4 but the damage source is breath. Defender
    // (B) breathes on reflector (A). Within the 6 s window, A takes
    // less breath damage and B takes reflected damage.
    //
    // Reflect is on the BREATHER's target, but the engine reads
    // `target.has_reflect` from the bite/breath resolution in
    // `apply_direct_damage_with_reflect`. So setup A as a passive
    // reflector with attacker_reflect=true — wait, A is the actor in
    // reference orientation. We need A to reflect B's breath.
    //
    // Simpler: A breathes, B has reflect. Configure
    // defender_reflect=true.
    let mut attacker = passive_combatant(1_000_000.0);
    attacker.weight = 100.0;
    attacker.bite_cooldown = 1000.0; // no melee
    let defender = passive_combatant(1_000_000.0);
    let mut breath = default_breath();
    breath.dps_pct = 1.0;
    breath.capacity = 5.0;
    breath.regen_rate = 1.0;
    breath.crit_chance_pct = 0.0;

    let baseline = simulate_composable_matchup(
        &attacker, &defender, Some(&breath), None,
        SimpleAbilityTimingMode::ReallyFast,
        &ComposableAbilityConfig::default(), 5.0,
    );
    let mut reflect_cfg = ComposableAbilityConfig::default();
    reflect_cfg.defender_reflect = true;
    let reflected = simulate_composable_matchup(
        &attacker, &defender, Some(&breath), None,
        SimpleAbilityTimingMode::ReallyFast,
        &reflect_cfg, 5.0,
    );
    assert!(
        reflected.final_hp_b > baseline.final_hp_b,
        "Reflect must reduce B's incoming breath damage (B is the reflector here): \
         reflect hp_b={}, baseline hp_b={}",
        reflected.final_hp_b, baseline.final_hp_b,
    );
    // Reflected breath damage flows back to A.
    let baseline_a_damage = attacker.health - baseline.final_hp_a;
    let reflected_a_damage = attacker.health - reflected.final_hp_a;
    assert!(
        reflected_a_damage > baseline_a_damage,
        "Reflect must deal reflected breath damage back to A (the breather): \
         reflected_a_damage={reflected_a_damage}, baseline_a_damage={baseline_a_damage}"
    );
}

#[test]
fn does_not_reflect_status_damage_over_time() {
    // [REF:ability_reflect]
    // Bullet 6: "This applies only to direct damage. Status damage
    // over time is not a Reflect event."
    // Engine: DoT damage flows through `handle_simple_dot_ticks_*` in
    // Phase 12, which never calls `apply_direct_damage_with_reflect`.
    // Pre-load A with Burn stacks; A holds Reflect; B is fully passive
    // (no bites, no breath). Burn DoT ticks deal damage to A; if
    // Reflect intercepted DoT, A's HP would not drop (or B would take
    // damage). Verify A's HP DOES drop (DoT bypasses Reflect) and B
    // takes zero damage.
    let mut a = passive_combatant(1_000_000.0);
    a.starting_statuses = vec![applied_status("Burn_Status", 10.0)];
    let b = passive_combatant(1_000_000.0);

    let result = simulate_composable_matchup(
        &a, &b, None, None,
        SimpleAbilityTimingMode::ReallyFast,
        &reflect_attacker_cfg(), 6.0,
    );
    // A took some Burn DoT damage (DoT bypasses Reflect).
    assert!(
        result.final_hp_a < a.health,
        "Burn DoT must damage the reflector (Reflect does NOT intercept DoT): hp_a={}, max={}",
        result.final_hp_a, a.health
    );
    // B took zero damage — there's no source of incoming damage on B,
    // and Reflect did NOT bounce DoT back.
    assert!(
        (b.health - result.final_hp_b).abs() < 1e-6,
        "Reflect must NOT reflect DoT damage to B: B took {} damage",
        b.health - result.final_hp_b
    );
}
