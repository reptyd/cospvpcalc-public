//! Reference: ability_reflect
//!
//! Covers each testable bullet in the "Reflect" entry. Each test body
//! starts with the [REF:ability_reflect] marker so the vitest coverage
//! gate (src/pages/referenceCoverage.test.ts) sees it.
//!
//! Engine path: activation in `composable/mod.rs:3920-3974` (Phase 4p
//! - `reflect_active_until = time + 6.0`, cooldown +45, gated by
//!   `policy_framework::should_activate_reflect`). Reflect resolution in
//!   `apply_direct_damage_with_reflect`: when the target has
//!   `has_reflect=true`, the incoming hit is reduced to 0 on the target
//!   and the attacker's pre-ability hit - the weight-scaled base carrying
//!   the attacker's stat-level buffs/debuffs (Hunters Curse, Unbridled
//!   Rage, Adrenaline, Warden's Rage, Cocoon) but NOT the OnAttack bonuses
//!   (Spite, Expunge, Divination) - is dealt straight back to the attacker,
//!   capped only by the attacker's own Unbreakable limit. The reflector's
//!   weight does not rescale the bounced damage. Only melee bites reflect
//!   (callers pass `allow_reflect = true`); breath takes a separate damage
//!   path in-game and passes `allow_reflect = false`, so it is never bounced.

use super::super::config::ComposableAbilityConfig;
use super::super::{simulate_composable_matchup, simulate_composable_matchup_with_trace};
use super::{applied_status, default_breath, default_combatant};
use crate::contracts::{SimpleAbilityTimingMode, SimpleCombatantStats};
use crate::spec_constants::{REFLECT_COOLDOWN_SEC, REFLECT_DURATION_SEC};

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

fn deactivation_times(
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
                && e.description.as_deref() == Some("Reflect deactivated")
        })
        .map(|e| e.time)
        .collect()
}

#[test]
fn starts_immediately_at_t_zero_when_actives_enabled() {
    // [REF:ability_reflect]
    // Bullet 1 + policy bullet: "Reflect starts immediately at t=0 if
    // actives are enabled." Engine: ReallyFast policy fires Reflect on
    // cooldown - first activation at t=0.
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
        "exactly one Reflect activation in a 7 s window (6 s window done, 45 s cooldown still blocks): {activations:?}"
    );

    // Witness the active-window length directly: the engine sets
    // `reflect_active_until = activation_time + 6.0` (phases/phase4.rs)
    // and emits a "Reflect deactivated" event at the first loop event
    // at/after the window end. A fast biter keeps events flowing so the
    // close lands within a sub-second of t=6. The activation is at t=0,
    // so the deactivation time itself is the window length.
    let mut biter = passive_combatant(10_000_000.0);
    biter.damage = 1.0;
    biter.bite_cooldown = 0.5;
    let activation = *activation_times(&attacker, &biter, &reflect_attacker_cfg(), 30.0)
        .first()
        .expect("Reflect activates at t=0");
    let deactivation = *deactivation_times(&attacker, &biter, &reflect_attacker_cfg(), 30.0)
        .first()
        .expect("Reflect window must close before the 30 s window ends");
    let window = deactivation - activation;
    // The close lands at the first loop event at/after the window end;
    // with a 0.5 s bite cadence that is at most 0.5 s late, so a 0.6 s
    // tolerance still reds any change to the 6 s window constant.
    assert!(
        (window - REFLECT_DURATION_SEC).abs() < 0.6,
        "Reflect active window must last ~{REFLECT_DURATION_SEC} s (activation={activation}, deactivation={deactivation}, window={window})"
    );
}

#[test]
fn cooldown_forty_five_seconds() {
    // [REF:ability_reflect]
    // Bullet 3: "It has a 45 second cooldown."
    // First activation at t=0; second activation gated by 45 s cooldown.
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
        (gap - REFLECT_COOLDOWN_SEC).abs() < 1.0,
        "second Reflect activation must land ~{REFLECT_COOLDOWN_SEC} s after the first, got {gap}: {activations:?}"
    );
}

#[test]
fn reflects_bite_damage_back_to_attacker() {
    // [REF:ability_reflect]
    // Bullet 4: "While Reflect is active, direct bite damage is reduced to 0
    // on the user and is instead dealt back to the attacker." A holds Reflect;
    // B bites A. Within the 6 s active window, A's HP must NOT drop from B's
    // bite, and B must take damage instead.
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
fn reflected_damage_is_not_capped_by_reflector_hp() {
    // [REF:ability_reflect]
    // Regression: a big hit into a low-HP reflector must bounce the FULL
    // dealt damage, not just the reflector's remaining HP. A (reflector) has
    // only 100 HP; B bites for 5000. Within Reflect's window A takes 0 and B
    // takes the full ~5000 back per bite - far more than A's 100 HP.
    let mut a = passive_combatant(100.0);
    a.weight = 100.0;
    let mut b = passive_combatant(100_000_000.0);
    b.damage = 5000.0;
    b.bite_cooldown = 0.5;

    let result = simulate_composable_matchup(
        &a, &b, None, None,
        SimpleAbilityTimingMode::ReallyFast,
        &reflect_attacker_cfg(), 1.0,
    );
    let b_taken = b.health - result.final_hp_b;
    assert!(
        b_taken > 1000.0,
        "reflected damage must be the attacker's full dealt damage, not clamped to \
         the reflector's HP: B took only {b_taken}"
    );
    // A survives - Reflect prevents the incoming hit on the reflector.
    assert!(
        result.final_hp_a > 0.0,
        "reflector takes 0 within the window: hp_a={}",
        result.final_hp_a
    );
}

#[test]
fn spite_bonus_is_not_added_to_the_reflected_bounce() {
    // [REF:ability_reflect]
    // Spite is a runAttackerAbilities (OnAttack) bonus applied AFTER
    // Reflect.OnDamage already returned the hit, so the game never reflects
    // it - the bounce is the pre-ability base. A holds
    // Reflect; B bites into the window. The self-damage bounced back to B
    // must be identical whether or not B has Spite armed.
    let mut a = passive_combatant(1_000_000_000.0); // reflector, never dies
    a.weight = 100.0;
    let b = melee_combatant(1_000_000_000.0, 100.0, 0.5); // attacker, survives

    let base_cfg = reflect_attacker_cfg(); // A reflects, B has no Spite
    let mut spite_cfg = reflect_attacker_cfg();
    spite_cfg.defender_spite_value = 4.0; // opening bite would be +400%
    spite_cfg.defender_spite_ready_at_start = true;

    let base = simulate_composable_matchup(
        &a, &b, None, None,
        SimpleAbilityTimingMode::ReallyFast,
        &base_cfg, 3.0,
    );
    let spite = simulate_composable_matchup(
        &a, &b, None, None,
        SimpleAbilityTimingMode::ReallyFast,
        &spite_cfg, 3.0,
    );

    let base_self_damage = b.health - base.final_hp_b;
    let spite_self_damage = b.health - spite.final_hp_b;
    assert!(
        base_self_damage > 0.0,
        "reflection must be bouncing damage back to B: {base_self_damage}"
    );
    // The bounce excludes Spite, so the two totals are identical. The old bug
    // (reflecting the Spite-boosted hit) would make spite_self_damage far larger.
    assert!(
        (spite_self_damage - base_self_damage).abs() < 1e-6,
        "Spite must NOT inflate the reflected bounce: \
         base={base_self_damage}, spite={spite_self_damage}"
    );
}

#[test]
fn does_not_reflect_breath_damage() {
    // [REF:ability_reflect]
    // Bullet 5: "Breath damage is not reflected: it lands on the user in full
    // and nothing returns to the breather." In-game Reflect
    // (`Reflect.OnDamage`) only fires on the melee `CalculateDamage` path;
    // breath takes a separate damage path and is never bounced. A breathes on
    // B, who holds Reflect: B still takes the full breath damage and A takes
    // nothing back.
    let attacker = {
        let mut a = passive_combatant(1_000_000.0);
        a.weight = 100.0;
        a.bite_cooldown = 1000.0; // no melee, breath only
        a
    };
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
    // B (the reflector) takes the same breath damage whether or not Reflect
    // is up - breath is not reflected.
    assert!(
        (reflected.final_hp_b - baseline.final_hp_b).abs() < 1e-6,
        "Reflect must NOT reduce breath damage on the reflector: \
         reflect hp_b={}, baseline hp_b={}",
        reflected.final_hp_b, baseline.final_hp_b,
    );
    // A (the breather) takes no reflected breath damage back.
    assert!(
        (attacker.health - reflected.final_hp_a).abs() < 1e-6,
        "Reflect must NOT bounce breath damage back to the breather: A took {}",
        attacker.health - reflected.final_hp_a,
    );
}

#[test]
fn does_not_reflect_status_damage_over_time() {
    // [REF:ability_reflect]
    // Bullet 6: "Only direct melee bites bounce." Engine: DoT damage flows
    // through `handle_simple_dot_ticks_*` in Phase 12, which never calls
    // `apply_direct_damage_with_reflect`. Pre-load A with Burn stacks; A holds
    // Reflect; B is fully passive (no bites, no breath). Burn DoT ticks deal
    // damage to A; if Reflect intercepted DoT, A's HP would not drop (or B
    // would take damage). Verify A's HP DOES drop (DoT bypasses Reflect) and B
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
    // B took zero damage - there's no source of incoming damage on B,
    // and Reflect did NOT bounce DoT back.
    assert!(
        (b.health - result.final_hp_b).abs() < 1e-6,
        "Reflect must NOT reflect DoT damage to B: B took {} damage",
        b.health - result.final_hp_b
    );
}
