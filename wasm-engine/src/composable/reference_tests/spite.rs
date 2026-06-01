//! Reference: ability_spite
//!
//! Covers each testable bullet in the "Spite" entry. Each test body
//! starts with the [REF:ability_spite] marker so the vitest coverage
//! gate (src/pages/referenceCoverage.test.ts) sees it.
//!
//! Engine path: arming in `composable/mod.rs:3497-3524` (Phase 4l) —
//! arms automatically as soon as `time >= spite_cooldown_until` and
//! `!spite_armed`. Charge ramp computed in Phase 10 melee resolution
//! at `mod.rs:4726-4732` (`charge_ratio = (time - activation) / 5`,
//! clamped 0..1; bonus = value × ratio). Consume site at
//! `mod.rs:4982-4986` — the next bite while `spite_armed` clears the
//! flag. On-hit status doubling at `mod.rs:4733`
//! (`spite_status_mult = 2.0` while armed).

use super::super::config::ComposableAbilityConfig;
use super::super::simulate_composable_matchup_with_trace;
use super::{applied_status, default_combatant};
use crate::contracts::{SimpleAbilityTimingMode, SimpleCombatantStats};

fn spite_attacker_cfg(spite_value: f64) -> ComposableAbilityConfig {
    let mut cfg = ComposableAbilityConfig::default();
    cfg.attacker_spite_value = spite_value;
    cfg
}

fn passive_combatant(max_hp: f64) -> SimpleCombatantStats {
    let mut c = default_combatant();
    c.health = max_hp;
    c.damage = 0.0;
    c.bite_cooldown = 1000.0;
    c
}

fn melee_attacker(max_hp: f64, damage: f64, bite_cd: f64) -> SimpleCombatantStats {
    let mut c = default_combatant();
    c.health = max_hp;
    c.damage = damage;
    c.bite_cooldown = bite_cd;
    c
}

fn spite_activation_times(
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
                && e.description.as_deref() == Some("Spite activated")
        })
        .map(|e| e.time)
        .collect()
}

#[test]
fn cooldown_twenty_seconds() {
    // [REF:ability_spite]
    // Bullet 1: "Spite has a 20 second cooldown."
    // Engine: `spite_cooldown_until = time + 20.0` set at arming.
    // First arming at t=0; second arming at t=20 after the consume +
    // re-arm cycle. Note: the engine emits a "Spite activated" event
    // both at arming (Phase 4l) AND at consume (Phase 10) — same
    // description string. So the trace shows TWO events per cycle at
    // the same timestamp (arm-and-consume happen in the same tick
    // when a bite is due). Group by unique timestamps to read
    // arming-cycle gaps.
    let attacker = melee_attacker(1_000_000.0, 50.0, 1.0);
    let defender = passive_combatant(10_000_000.0);
    let raw = spite_activation_times(&attacker, &defender, &spite_attacker_cfg(1.0), 50.0);
    let mut unique_times: Vec<f64> = Vec::new();
    for t in &raw {
        if unique_times.last().map(|prev| (t - prev).abs() > 1e-6).unwrap_or(true) {
            unique_times.push(*t);
        }
    }
    assert!(
        unique_times.len() >= 2,
        "Spite must arm-and-consume at least twice in 50 s: raw={raw:?}, unique={unique_times:?}"
    );
    let gap = unique_times[1] - unique_times[0];
    assert!(
        (gap - 20.0).abs() < 1.0,
        "second Spite arming must land ~20 s after the first: gap={gap}, unique={unique_times:?}"
    );
}

#[test]
fn arms_automatically_as_soon_as_cooldown_elapses() {
    // [REF:ability_spite]
    // Bullet 2: "Spite arms automatically as soon as its cooldown
    // elapses."
    // No melee-hit dependency. With cooldown_until=0 default, Spite
    // arms at t=0 even if the user has not yet bitten.
    let mut attacker = passive_combatant(1_000_000.0);
    attacker.bite_cooldown = 1000.0;
    attacker.damage = 0.0;
    let defender = passive_combatant(10_000_000.0);
    let activations = spite_activation_times(&attacker, &defender, &spite_attacker_cfg(1.0), 1.0);
    let first = *activations
        .first()
        .expect("Spite must arm at t=0 with default cooldown");
    assert!(
        first.abs() < 1e-6,
        "first Spite arming must land at t=0 (cooldown ready, no melee dependency), got {first}"
    );
}

#[test]
fn next_direct_melee_hit_consumes_spite() {
    // [REF:ability_spite]
    // Bullet 4: "The next direct melee hit then uses the charged
    // Spite bonus and consumes it."
    // Engine: at melee resolution, if `spite_armed`, the engine reads
    // the bonus, applies it, and clears `spite_armed`. The proof here
    // is the consume → cooldown gate → re-arm chain: a second arming
    // event only happens if the first was actually consumed (and the
    // cooldown elapsed).
    let attacker = melee_attacker(1_000_000.0, 50.0, 1.0);
    let defender = passive_combatant(10_000_000.0);
    let activations = spite_activation_times(&attacker, &defender, &spite_attacker_cfg(1.0), 25.0);
    assert!(
        activations.len() >= 2,
        "second Spite arming proves the first was consumed by a bite: {activations:?}"
    );
}

#[test]
fn fully_charged_bite_uses_one_plus_value_multiplier() {
    // [REF:ability_spite]
    // Bullets 3 + 5: "Once armed, it takes 5 seconds to fully charge."
    // + "The damage bonus scales from 0% to the user's Spite value
    // over that 5 second charge."
    // Engine: `bonus_mult = 1.0 + value × clamp((time - arm_time)/5, 0..1)`.
    //
    // The intermediate ramp values cannot be observed through normal
    // simulation — Phase 4l arming and Phase 10 consume happen in the
    // same tick whenever a bite is due, so the consume always reads
    // ratio=0. The Compare-only `attacker_spite_ready_at_start` flag
    // pre-arms at t=0 with `charge_ready_at=0`, which means
    // `activation_time = -5` and the t=0 ratio clamps to 1.0 (max).
    // That gives the canonical full-charge multiplier `1 + value`.
    //
    // Test: with spite_value = 5.0 and ready-at-start, first bite
    // damage = base × (1 + 5) = base × 6.
    let mut a = melee_attacker(1_000_000.0, 100.0, 1.0);
    a.weight = 100.0;
    let mut b = passive_combatant(10_000_000.0);
    b.weight = 100.0;

    let baseline = simulate_composable_matchup_with_trace(
        &a, &b, None, None,
        SimpleAbilityTimingMode::ReallyFast,
        &ComposableAbilityConfig::default(), 0.5, true,
    );
    let mut spite_cfg = ComposableAbilityConfig::default();
    spite_cfg.attacker_spite_value = 5.0;
    spite_cfg.attacker_spite_ready_at_start = true;
    let spite_run = simulate_composable_matchup_with_trace(
        &a, &b, None, None,
        SimpleAbilityTimingMode::ReallyFast,
        &spite_cfg, 0.5, true,
    );
    let first_bite = |log: &Vec<crate::contracts::CombatLogEntry>| -> f64 {
        log.iter()
            .find(|e| e.entry_type == "bite" && e.attacker == "A")
            .map(|e| e.damage)
            .unwrap_or(0.0)
    };
    let baseline_log = baseline.combat_log.expect("baseline trace");
    let spite_log = spite_run.combat_log.expect("spite trace");
    let baseline_bite = first_bite(&baseline_log);
    let spite_bite = first_bite(&spite_log);
    assert!(baseline_bite > 0.0, "baseline first bite expected");
    assert!(spite_bite > 0.0, "spite first bite expected");
    let ratio = spite_bite / baseline_bite;
    assert!(
        (ratio - 6.0).abs() < 1e-6,
        "fully-charged Spite (value=5) must multiply bite damage by 1+5 = 6.0: \
         baseline={baseline_bite}, spite={spite_bite}, ratio={ratio}"
    );
}

#[test]
fn charged_hit_doubles_offensive_ailments() {
    // [REF:ability_spite]
    // Bullet 6: "That charged hit also doubles the user's inflicted
    // offensive ailments."
    // Engine: `spite_status_mult = 2.0` while armed
    // (`composable/mod.rs:4733`). On-hit status stacks are scaled by
    // this multiplier when the bite consumes Spite.
    //
    // Setup: attacker has on-hit Bleed × 1. First bite (consumes
    // Spite) applies Bleed × 2.
    let mut a = melee_attacker(1_000_000.0, 50.0, 1.0);
    a.on_hit_statuses = vec![applied_status("Bleed_Status", 1.0)];
    let defender = passive_combatant(10_000_000.0);

    let result = simulate_composable_matchup_with_trace(
        &a, &defender, None, None,
        SimpleAbilityTimingMode::ReallyFast,
        &spite_attacker_cfg(1.0),
        2.5, true,
    );
    let log = result.combat_log.expect("trace");
    let first_bleed_apply = log.iter().find(|e| {
        e.status_id.as_deref() == Some("Bleed_Status")
            && e.description.as_deref().is_some_and(|d| d.contains("applied"))
    }).expect("first Bleed apply event must exist");
    let detail = first_bleed_apply.detail.as_deref().unwrap_or("");
    assert!(
        detail.contains("0 -> 2") || detail.contains("0.0 -> 2") || detail.contains("-> 2 stacks"),
        "first bite under armed Spite must apply Bleed × 2 (1 × 2.0 doubling): detail={detail}"
    );
}
