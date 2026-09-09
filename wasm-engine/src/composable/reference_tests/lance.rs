//! Reference: ability_lance
//!
//! Covers each testable bullet in the "Lance" entry. Each test body
//! starts with the [REF:ability_lance] marker so the vitest coverage
//! gate (src/pages/referenceCoverage.test.ts) sees it.
//!
//! Engine path: `composable/breath.rs::tick_breath_lance` handles the
//! charge -> impact transition; `composable/mod.rs:4625-4679` (Phase 9)
//! drives the per-second aura ticks. Lance is selected via
//! `breath.special_kind == Some("lance")`. Lance state mutations go
//! through `apply_incoming_statuses_to_target_with_fortify_immunity`
//! (no combat_log push), so per-bullet status checks use direct calls
//! to `tick_breath_side` rather than scraping a trace.
//!
//! Engine timing (verified via experiment): the first arm fires at the
//! first scheduled breath tick t=0.5, and the aura appears
//! `lance_charge_sec` plus `LANCE_AREA_DELAY_SEC` later, so the first hit lands
//! at t=4.0. The aura then fires at t=5.0, 6.0, ..., 9.0 (5 ticks).
//! Cooldown runs from the arm at 60.5; the next arm is the first breath
//! tick after it, so the second hit lands at t=64.5.

use super::super::breath::tick_breath_side;
use super::super::config::ComposableAbilityConfig;
use super::super::side::CombatSide;
use super::super::{simulate_composable_matchup, DamageCounters};
use super::{default_breath, default_combatant};
use crate::contracts::{SimpleAbilityTimingMode, SimpleBreathProfile, SimpleCombatantStats};
use crate::spec_constants::{LANCE_COOLDOWN_SEC, LANCE_PRIMARY_PCT_MAX_HP, LANCE_SECONDARY_PCT_MAX_HP};

/// Lance with a non-DoT carrier status (Slow_Status). Use this for
/// magnitude checks so phantom DoT damage from a damaging carrier
/// status does not contaminate the totals.
fn lance_breath_profile() -> SimpleBreathProfile {
    let mut breath = default_breath();
    breath.special_kind = Some("lance".to_string());
    breath.lance_charge_sec = 3.0;
    breath.lance_damage_pct = 5.0;
    breath.lance_cooldown_sec = LANCE_COOLDOWN_SEC;
    breath.lance_status_id = Some("Slow_Status".to_string());
    breath
}

/// Lance with Bleed as the carrier status. Use this only in the test
/// that needs to observe the carrier status apply via DoT trace events.
fn lance_breath_profile_with_bleed_carrier() -> SimpleBreathProfile {
    let mut breath = lance_breath_profile();
    breath.lance_status_id = Some("Bleed_Status".to_string());
    breath
}

fn passive_combatant(max_hp: f64) -> SimpleCombatantStats {
    let mut c = default_combatant();
    c.health = max_hp;
    c.damage = 0.0;
    c.bite_cooldown = 1000.0;
    c
}

#[test]
fn nothing_lands_during_the_charge() {
    // [REF:ability_lance]
    // Bullet 1: "The charge takes 3 seconds."
    // A normal breath emits damage every 0.5 s; Lance emits none while it
    // charges. At t=2.5 the charge that started at 0.5 is still running and
    // the defender's HP is unchanged.
    let attacker = passive_combatant(1_000.0);
    let defender = passive_combatant(10_000.0);
    let breath = lance_breath_profile();
    let result = simulate_composable_matchup(
        &attacker, &defender,
        Some(&breath), None,
        SimpleAbilityTimingMode::Fast,
        &ComposableAbilityConfig::default(),
        2.5,
    );
    assert!(
        (result.final_hp_b - defender.health).abs() < 1e-6,
        "Lance must NOT damage during the charge window: defender HP {} → {}",
        defender.health, result.final_hp_b,
    );
}

#[test]
fn the_aura_appears_a_throw_after_the_charge() {
    // [REF:ability_lance]
    // Bullets 1 + 2: "The charge takes 3 seconds."
    // "The aura appears 0.5 seconds after the charge completes, a figure we chose."
    // The first arm fires at the first scheduled breath tick (t=0.5), so the
    // aura is due at 0.5 + 3.0 + 0.5 = 4.0 and the hit lands there.
    let attacker = passive_combatant(1_000.0);
    let defender = passive_combatant(10_000.0);
    let breath = lance_breath_profile();

    // Sim through t=3.9 - before the aura appears, no damage.
    let pre_impact = simulate_composable_matchup(
        &attacker, &defender,
        Some(&breath), None,
        SimpleAbilityTimingMode::Fast,
        &ComposableAbilityConfig::default(),
        3.9,
    );
    assert!(
        (pre_impact.final_hp_b - defender.health).abs() < 1e-6,
        "no Lance damage allowed before t=4.0 (the aura): got HP {}",
        pre_impact.final_hp_b
    );
    // Sim through t=4.0+epsilon - the hit has landed.
    let post_impact = simulate_composable_matchup(
        &attacker, &defender,
        Some(&breath), None,
        SimpleAbilityTimingMode::Fast,
        &ComposableAbilityConfig::default(),
        4.1,
    );
    assert!(
        post_impact.final_hp_b < defender.health,
        "the Lance hit must land at t=4.0: HP {} unchanged",
        post_impact.final_hp_b
    );
}

#[test]
fn impact_deals_five_percent_target_max_hp() {
    // [REF:ability_lance]
    // Bullet 3: "When the aura appears, the opponent takes damage equal to
    // 5% of the opponent's maximum health."
    // Run for 4.5 s - past the hit at t=4.0 but before the first aura tick at
    // t=5.0. Damage dealt must equal exactly 5% x 10_000.
    let attacker = passive_combatant(1_000.0);
    let defender = passive_combatant(10_000.0);
    let breath = lance_breath_profile();
    let result = simulate_composable_matchup(
        &attacker, &defender,
        Some(&breath), None,
        SimpleAbilityTimingMode::Fast,
        &ComposableAbilityConfig::default(),
        4.0,
    );
    let expected = defender.health * LANCE_PRIMARY_PCT_MAX_HP / 100.0;
    let actual = defender.health - result.final_hp_b;
    assert!(
        (actual - expected).abs() < 1e-6,
        "Lance impact must deal {LANCE_PRIMARY_PCT_MAX_HP}% of target maxHP (between t=3.5 and the first aura tick at 4.5): expected {expected}, got {actual}"
    );
}

#[test]
fn impact_weight_lerp_reduces_when_lighter_and_caps_at_base() {
    // [REF:ability_lance]
    // Lance passes a precomputed %-maxHP amount through CalculateDamage's
    // weight-lerp: base *= 0.5 + 0.5 * clamp(atkW/defW, 0, 3)
    // * posture. The game then clamps the result back to the base
    // (ProjectileAOEAbility `_applyDamage`: `clamp(result, 0, maxHP*pct)`), so
    // weight/posture only REDUCE Lance, capped at the base 5%. A heavy attacker
    // (3:1) into a standing target stays at 5% (not 10%); a light attacker (1:3)
    // is reduced below 5%.
    let base_pct = LANCE_PRIMARY_PCT_MAX_HP / 100.0;
    let breath = lance_breath_profile();

    // Heavy attacker (3:1): uncapped factor would be 2.0, but caps at 1.0 -> base.
    let mut heavy = passive_combatant(1_000.0);
    heavy.weight = 300.0;
    let mut def_h = passive_combatant(10_000.0);
    def_h.weight = 100.0;
    let heavy_hit = def_h.health
        - simulate_composable_matchup(
            &heavy, &def_h, Some(&breath), None,
            SimpleAbilityTimingMode::Fast, &ComposableAbilityConfig::default(), 4.0,
        )
        .final_hp_b;
    assert!(
        (heavy_hit - def_h.health * base_pct).abs() < 1e-6,
        "a heavy attacker's Lance impact must cap at the base {LANCE_PRIMARY_PCT_MAX_HP}% (not amplified): expected {}, got {heavy_hit}",
        def_h.health * base_pct,
    );

    // Light attacker (1:3): factor = 0.5 + 0.5*(1/3) = 0.6667 -> reduced.
    let mut light = passive_combatant(1_000.0);
    light.weight = 100.0;
    let mut def_l = passive_combatant(10_000.0);
    def_l.weight = 300.0;
    let light_hit = def_l.health
        - simulate_composable_matchup(
            &light, &def_l, Some(&breath), None,
            SimpleAbilityTimingMode::Fast, &ComposableAbilityConfig::default(), 4.0,
        )
        .final_hp_b;
    let expected_light = def_l.health * base_pct * (0.5 + 0.5 * (1.0 / 3.0));
    assert!(
        (light_hit - expected_light).abs() < 1e-6,
        "a lighter attacker's Lance impact must be weight-lerped down: expected {expected_light}, got {light_hit}"
    );
}

#[test]
fn impact_applies_two_slowed() {
    // [REF:ability_lance]
    // Bullet 4: "The aura applies 2 stacks of Slowed to the opponent when it
    // appears." Lance routes
    // through `tick_breath_lance` which calls
    // `apply_incoming_statuses_to_target_with_fortify_immunity` - that helper
    // does not emit a combat_log entry, so the apply event is not visible via
    // a trace scrape. Direct invocation of `tick_breath_side` lets us observe
    // `defender.statuses["Slow_Status"]` immediately after the impact.
    let attacker_stats = passive_combatant(1_000.0);
    let defender_stats = passive_combatant(10_000.0);
    let breath = lance_breath_profile();
    let mut attacker = CombatSide::new(&attacker_stats, Some(&breath));
    let mut defender = CombatSide::new(&defender_stats, None);
    let mut counters = DamageCounters::default();

    // Arm first via a tick at t=0.5.
    tick_breath_side(
        0.5,
        &attacker_stats, &defender_stats,
        &breath,
        true,
        &mut attacker, &mut defender,
        false, false,
        &mut counters,
        &mut Vec::new(), false, "A", "B",
        crate::composable::config::SimpleBreathPolicyMode::OnAvailability,
        false,
        0.0,
    );
    assert!(
        attacker.lance_armed_until > 0.0,
        "first tick must arm Lance: lance_armed_until={}",
        attacker.lance_armed_until
    );
    // The aura is due at 4.0: the arm at 0.5, the 3 s charge, the 0.5 s throw.
    tick_breath_side(
        4.0,
        &attacker_stats, &defender_stats,
        &breath,
        true,
        &mut attacker, &mut defender,
        false, false,
        &mut counters,
        &mut Vec::new(), false, "A", "B",
        crate::composable::config::SimpleBreathPolicyMode::OnAvailability,
        false,
        0.0,
    );
    let slow_stacks = defender
        .statuses
        .get("Slow_Status")
        .map(|s| s.stacks)
        .unwrap_or(0.0);
    assert!(
        (slow_stacks - 2.0).abs() < 1e-6,
        "Lance impact must apply exactly 2 Slow_Status stacks: got {slow_stacks}"
    );
}

#[test]
fn aura_lasts_five_seconds_after_impact() {
    // [REF:ability_lance]
    // Bullet 5: "The aura lasts 5 seconds."
    // The aura appears at t=4.0 and ticks at t=5.0, 6.0, 7.0, 8.0, 9.0, the
    // last of them at its expiry. Damage at t=9.5 must equal damage at t=20 -
    // no further ticks until the next cast.
    let attacker = passive_combatant(1_000.0);
    let defender = passive_combatant(1_000_000.0);
    let breath = lance_breath_profile();
    let through_aura = simulate_composable_matchup(
        &attacker, &defender,
        Some(&breath), None,
        SimpleAbilityTimingMode::Fast,
        &ComposableAbilityConfig::default(),
        9.0,
    );
    let mid_cooldown = simulate_composable_matchup(
        &attacker, &defender,
        Some(&breath), None,
        SimpleAbilityTimingMode::Fast,
        &ComposableAbilityConfig::default(),
        20.0,
    );
    assert!(
        (through_aura.damage_dealt_a - mid_cooldown.damage_dealt_a).abs() < 1e-6,
        "no Lance damage allowed between t=8.5 (aura end) and t=20 (next cooldown): \
         through_aura={}, mid_cooldown={}",
        through_aura.damage_dealt_a, mid_cooldown.damage_dealt_a,
    );
}

#[test]
fn aura_ticks_once_per_second() {
    // [REF:ability_lance]
    // Bullets 6 + 7: "Its ticks are 1 second apart."
    // "The first tick lands 1 second after the aura appears."
    // Within the 5 s aura exactly 5 ticks fire, at t=5.0, 6.0, 7.0, 8.0 and
    // 9.0. The damage delta from t=4.5 (after the hit, before the first tick)
    // to t=9.5 (after the last) must equal 5 ticks x 1% maxHP = 5%.
    let attacker = passive_combatant(1_000.0);
    let defender = passive_combatant(1_000_000.0);
    let breath = lance_breath_profile();

    let post_impact = simulate_composable_matchup(
        &attacker, &defender,
        Some(&breath), None,
        SimpleAbilityTimingMode::Fast,
        &ComposableAbilityConfig::default(),
        4.0,
    );
    let post_aura = simulate_composable_matchup(
        &attacker, &defender,
        Some(&breath), None,
        SimpleAbilityTimingMode::Fast,
        &ComposableAbilityConfig::default(),
        9.0,
    );
    let aura_damage = post_aura.damage_dealt_a - post_impact.damage_dealt_a;
    // 5 aura ticks at LANCE_SECONDARY_PCT_MAX_HP % maxHP each.
    let expected = defender.health * 5.0 * LANCE_SECONDARY_PCT_MAX_HP / 100.0;
    assert!(
        (aura_damage - expected).abs() < 1e-3,
        "5 aura ticks at {LANCE_SECONDARY_PCT_MAX_HP}%/tick must total {expected}: got {aura_damage}"
    );
}

#[test]
fn aura_tick_deals_one_percent_max_hp_and_applies_carrier_status() {
    // [REF:ability_lance]
    // Bullets 8 + 9: "Each tick deals damage equal to 1% of the opponent's
    // maximum health."
    // "Each tick applies 1 stack of the user's carrier-specific Lance ailment to
    // the opponent."
    // Per-tick damage is covered by the test above (5x1%=5%). Carrier status:
    // `lance_status_id` is set to Bleed (a DoT) so its tick events
    // appear in the trace with `entry_type="dot"` and
    // `description="Bleed_Status tick"`. Verify Bleed ticks fire on
    // the defender after impact.
    let attacker = passive_combatant(1_000.0);
    let defender = passive_combatant(1_000_000.0);
    let breath = lance_breath_profile_with_bleed_carrier();
    let result = super::super::simulate_composable_matchup_with_trace(
        &attacker, &defender,
        Some(&breath), None,
        SimpleAbilityTimingMode::Fast,
        &ComposableAbilityConfig::default(),
        12.0, true,
    );
    let log = result.combat_log.expect("trace log");
    let bleed_dot_ticks = log
        .iter()
        .filter(|e| {
            e.entry_type == "dot"
                && e.status_id.as_deref() == Some("Bleed_Status")
                && e.time > 3.5 + 1e-9
        })
        .count();
    // 5 aura ticks apply 1 Bleed each (max 5 stacks). Bleed ticks at
    // 1 Hz (decay) - at least a couple of DoT ticks should appear in
    // the 12 s window after impact.
    assert!(
        bleed_dot_ticks >= 2,
        "Lance aura must apply the carrier Bleed status causing DoT ticks: got {bleed_dot_ticks}"
    );
}

#[test]
fn cooldown_sixty_seconds() {
    // [REF:ability_lance]
    // Bullets 14 + 15: "The cooldown is 60 seconds."
    // "The cooldown begins at the start of the charge."
    // The first arm is at t=0.5, so the cooldown ends at 60.5 and the next arm
    // is the first breath tick after it, t=61. The second hit lands at t=64.5
    // and its aura ends at t=69.5. Total damage by t=70 = 2 x (5% hit + 5x1%
    // aura) = 20% maxHP.
    let attacker = passive_combatant(1_000.0);
    let defender = passive_combatant(10_000_000.0);
    let breath = lance_breath_profile();
    let result = simulate_composable_matchup(
        &attacker, &defender,
        Some(&breath), None,
        SimpleAbilityTimingMode::Fast,
        &ComposableAbilityConfig::default(),
        70.0,
    );
    let expected = defender.health * 0.20; // 2 x 10% per cycle
    let actual = result.damage_dealt_a;
    assert!(
        (actual - expected).abs() < 1e-3,
        "two Lance cycles (impacts at t=3.5 and t=64) must total 20% maxHP by t=70: \
         expected {expected}, got {actual}"
    );
}

#[test]
fn the_ability_cooldown_multiplier_moves_that_cooldown() {
    // [REF:ability_lance]
    // Bullet 16: "That cooldown is multiplied by the user's ability cooldown
    // multiplier."
    // At 0.5x the cooldown ends at 30.5 instead of 60.5, so the second cycle
    // fits inside 40 s and the damage doubles.
    let mut attacker = passive_combatant(1_000.0);
    attacker.active_cooldown_multiplier = 0.5;
    let defender = passive_combatant(10_000_000.0);
    let breath = lance_breath_profile();
    let result = simulate_composable_matchup(
        &attacker, &defender,
        Some(&breath), None,
        SimpleAbilityTimingMode::Fast,
        &ComposableAbilityConfig::default(),
        40.0,
    );
    let expected = defender.health * 0.20;
    let actual = result.damage_dealt_a;
    assert!(
        (actual - expected).abs() < 1e-3,
        "a 0.5x multiplier must fit two Lance cycles inside 40 s: expected {expected}, got {actual}"
    );
}
