//! Reference: ability_lance
//!
//! Covers each testable bullet in the "Lance" entry. Each test body
//! starts with the [REF:ability_lance] marker so the vitest coverage
//! gate (src/pages/referenceCoverage.test.ts) sees it.
//!
//! Engine path: `composable/breath.rs::tick_breath_lance` handles the
//! charge → impact transition; `composable/mod.rs:4625-4679` (Phase 9)
//! drives the per-second aura ticks. Lance is selected via
//! `breath.special_kind == Some("lance")`. Lance state mutations go
//! through `apply_incoming_statuses_to_target_with_fortify_immunity`
//! (no combat_log push), so per-bullet status checks use direct calls
//! to `tick_breath_side` rather than scraping a trace.
//!
//! Engine timing (verified via experiment): the first arm fires at the
//! first scheduled breath tick t=0.5, so the first impact lands at
//! t=0.5 + lance_charge_sec = 3.5. The aura then fires at t=4.5, 5.5,
//! ..., 8.5 (5 ticks). Cooldown set at first arm = 60.5; next arm at
//! t=61 (next breath tick after cooldown), so second impact at t=64.

use super::super::breath::tick_breath_side;
use super::super::config::ComposableAbilityConfig;
use super::super::side::CombatSide;
use super::super::{simulate_composable_matchup, DamageCounters};
use super::{default_breath, default_combatant};
use crate::contracts::{SimpleAbilityTimingMode, SimpleBreathProfile, SimpleCombatantStats};

/// Lance with a non-DoT carrier status (Slow_Status). Use this for
/// magnitude checks so phantom DoT damage from a damaging carrier
/// status does not contaminate the totals.
fn lance_breath_profile() -> SimpleBreathProfile {
    let mut breath = default_breath();
    breath.special_kind = Some("lance".to_string());
    breath.lance_charge_sec = 3.0;
    breath.lance_damage_pct = 5.0;
    breath.lance_cooldown_sec = 60.0;
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
fn does_not_use_normal_repeated_breath_formula() {
    // [REF:ability_lance]
    // Bullet 1: "Lance does not use the normal repeated breath-damage
    // formula."
    // The normal breath path emits damage every 0.5 s. Lance routes
    // through `tick_breath_lance` and emits no damage during the charge
    // window. At t=2.5 (mid-charge: first arm at 0.5, impact at 3.5)
    // defender HP is unchanged.
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
fn arms_for_three_seconds_before_first_impact() {
    // [REF:ability_lance]
    // Bullet 2: "When it becomes available, it first arms for 3 seconds."
    // First arm fires at the first scheduled breath tick (t=0.5).
    // armed_until = 0.5 + 3.0 = 3.5. Impact lands at the first breath
    // tick where time >= armed_until → t=3.5.
    let attacker = passive_combatant(1_000.0);
    let defender = passive_combatant(10_000.0);
    let breath = lance_breath_profile();

    // Sim through t=3.4 — still arming, no damage.
    let pre_impact = simulate_composable_matchup(
        &attacker, &defender,
        Some(&breath), None,
        SimpleAbilityTimingMode::Fast,
        &ComposableAbilityConfig::default(),
        3.4,
    );
    assert!(
        (pre_impact.final_hp_b - defender.health).abs() < 1e-6,
        "no Lance damage allowed before t=3.5 (charge end): got HP {}",
        pre_impact.final_hp_b
    );
    // Sim through t=3.5+ε — impact has landed.
    let post_impact = simulate_composable_matchup(
        &attacker, &defender,
        Some(&breath), None,
        SimpleAbilityTimingMode::Fast,
        &ComposableAbilityConfig::default(),
        3.6,
    );
    assert!(
        post_impact.final_hp_b < defender.health,
        "Lance impact must land at t=3.5: HP {} unchanged",
        post_impact.final_hp_b
    );
}

#[test]
fn impact_deals_five_percent_target_max_hp() {
    // [REF:ability_lance]
    // Bullet 3: "When that charge finishes, it deals an immediate
    // impact hit for 5% of the target's max HP."
    // Run for 4.0 s — past the impact at t=3.5 but before the first
    // aura tick at t=4.5. Damage dealt must equal exactly 5% × 10_000.
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
    let expected = defender.health * 0.05;
    let actual = defender.health - result.final_hp_b;
    assert!(
        (actual - expected).abs() < 1e-6,
        "Lance impact must deal 5% of target maxHP (between t=3.5 and the first aura tick at 4.5): expected {expected}, got {actual}"
    );
}

#[test]
fn impact_applies_two_slowed() {
    // [REF:ability_lance]
    // Bullet 4: "That impact also applies 2 Slowed."
    // Lance routes through `tick_breath_lance` which calls
    // `apply_incoming_statuses_to_target_with_fortify_immunity` —
    // that helper does not emit a combat_log entry, so the apply event
    // is not visible via a trace scrape. Direct invocation of
    // `tick_breath_side` lets us observe `defender.statuses["Slow_Status"]`
    // immediately after the impact.
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
    );
    assert!(
        attacker.lance_armed_until > 0.0,
        "first tick must arm Lance: lance_armed_until={}",
        attacker.lance_armed_until
    );
    // Trigger impact at t=3.5 (>= armed_until).
    tick_breath_side(
        3.5,
        &attacker_stats, &defender_stats,
        &breath,
        true,
        &mut attacker, &mut defender,
        false, false,
        &mut counters,
        &mut Vec::new(), false, "A", "B",
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
    // Bullet 5: "After the impact, Lance starts a 5 second aura."
    // Impact at t=3.5; aura ticks at t=4.5, 5.5, 6.5, 7.5, 8.5; aura
    // ends at t=8.5 (== impact + 5). Damage at t=9.0 (mid-cooldown)
    // must equal damage at t=20 (still mid-cooldown) — no further
    // ticks past t=8.5 until next cooldown at t=60.5.
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
    // Bullet 6: "That aura ticks once per second."
    // Engine: `lance_aura_next_tick_at = Some(time + 1.0)` per tick.
    // Within the 5 s aura (t=3.5..8.5) exactly 5 ticks fire at t=4.5,
    // 5.5, 6.5, 7.5, 8.5. Damage delta from t=4.0 (post-impact, pre-aura)
    // to t=9.0 (post-aura) must equal 5 ticks × 1% maxHP = 5%.
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
    let expected = defender.health * 0.05;
    assert!(
        (aura_damage - expected).abs() < 1e-3,
        "5 aura ticks at 1%/tick must total 5% maxHP: expected {expected}, got {aura_damage}"
    );
}

#[test]
fn aura_tick_deals_one_percent_max_hp_and_applies_carrier_status() {
    // [REF:ability_lance]
    // Bullet 7: "Each aura tick deals 1% of the target's max HP and
    // applies 1 stack of the user's carrier-specific Lance ailment."
    // Per-tick damage covered by bullet 6 (5×1%=5%). Carrier status:
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
    // 1 Hz (decay) — at least a couple of DoT ticks should appear in
    // the 12 s window after impact.
    assert!(
        bleed_dot_ticks >= 2,
        "Lance aura must apply the carrier Bleed status causing DoT ticks: got {bleed_dot_ticks}"
    );
}

#[test]
fn cooldown_sixty_seconds() {
    // [REF:ability_lance]
    // Bullet 8: "Lance has a 60 second cooldown."
    // First arm at t=0.5 → cooldown_until = 60.5. Next arm at the next
    // breath tick after 60.5 → t=61. Second impact at t=64; second
    // aura ends at t=69. Total damage by t=70 = 2 × (5% impact + 5×1%
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
    let expected = defender.health * 0.20; // 2 × 10% per cycle
    let actual = result.damage_dealt_a;
    assert!(
        (actual - expected).abs() < 1e-3,
        "two Lance cycles (impacts at t=3.5 and t=64) must total 20% maxHP by t=70: \
         expected {expected}, got {actual}"
    );
}
