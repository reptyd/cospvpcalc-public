//! Reference: ability_shadow_barrage
//!
//! Covers each testable bullet in the "Shadow Barrage" entry. Each
//! test body starts with the [REF:ability_shadow_barrage] marker so
//! the vitest coverage gate (src/pages/referenceCoverage.test.ts)
//! sees it.
//!
//! Engine path: `composable/phases.rs` Phase 4s. Activation gate
//! requires (cooldown done) + (last melee within 10 s) + (stored
//! damage > 0). 2026-05-18: replaced the prior 1-Hz scheduled
//! delivery with **burst on activation** - all N "barrage hits" of
//! the 100% / 90% / 80% / … dropoff sequence are summed and dealt
//! as a single damage event at the moment of activation. On-hit
//! ailments apply once per hit in the burst (engine multiplies
//! stacks by `count` and emits a single apply trace entry). 30 s
//! cooldown is unchanged.

use super::super::config::ComposableAbilityConfig;
use super::super::simulate_composable_matchup_with_trace;
use super::{applied_status, default_combatant};
use crate::contracts::{SimpleAbilityTimingMode, SimpleCombatantStats};

fn shadow_barrage_attacker(max_hp: f64, damage: f64, bite_cd: f64) -> SimpleCombatantStats {
    let mut c = default_combatant();
    c.health = max_hp;
    c.damage = damage;
    c.bite_cooldown = bite_cd;
    c
}

fn passive_combatant(max_hp: f64) -> SimpleCombatantStats {
    let mut c = default_combatant();
    c.health = max_hp;
    c.damage = 0.0;
    c.bite_cooldown = 1000.0;
    c
}

fn shadow_barrage_cfg(value: f64) -> ComposableAbilityConfig {
    let mut cfg = ComposableAbilityConfig::default();
    cfg.attacker_shadow_barrage_value = value;
    cfg
}

#[test]
fn activation_requires_recent_melee_hit_within_ten_seconds() {
    // [REF:ability_shadow_barrage]
    // Bullets 1 + 2: activation requires the last melee hit to be
    // within the previous 10 s AND `last_melee_hit_damage > 0`. A
    // zero-damage attacker never records `last_melee_hit_*`, so the
    // gate never opens.
    let attacker = shadow_barrage_attacker(1_000_000.0, 0.0, 1.0);
    let defender = passive_combatant(10_000_000.0);
    let result = simulate_composable_matchup_with_trace(
        &attacker, &defender, None, None,
        SimpleAbilityTimingMode::ReallyFast,
        &shadow_barrage_cfg(3.0),
        15.0, true,
    );
    let log = result.combat_log.expect("trace");
    let activations = log
        .iter()
        .filter(|e| e.description.as_deref() == Some("Shadow Barrage activated"))
        .count();
    assert_eq!(
        activations, 0,
        "Shadow Barrage must NOT activate without a recorded recent melee hit (damage=0): got {activations}"
    );
}

#[test]
fn fires_one_burst_event_per_activation_regardless_of_value() {
    // [REF:ability_shadow_barrage]
    // Bullets 4 + 7: all N hits land as a single burst event at
    // activation. Value=3 and value=5 produce ONE "Shadow Barrage
    // hit" trace event each - the difference is in damage magnitude
    // (handled by the next test), not in event count.
    let attacker = shadow_barrage_attacker(1_000_000.0, 100.0, 0.5);
    let defender = passive_combatant(10_000_000.0);
    for value in [3.0, 5.0, 1.0] {
        let result = simulate_composable_matchup_with_trace(
            &attacker, &defender, None, None,
            SimpleAbilityTimingMode::ReallyFast,
            &shadow_barrage_cfg(value),
            // Short enough to stay inside the 30 s cooldown so we
            // see at most one activation.
            5.0, true,
        );
        let log = result.combat_log.expect("trace");
        let hits = log
            .iter()
            .filter(|e| e.description.as_deref() == Some("Shadow Barrage hit"))
            .count();
        assert_eq!(
            hits, 1,
            "Shadow Barrage value={value} must produce exactly ONE burst event in the activation window: got {hits}"
        );
    }
}

#[test]
fn burst_damage_equals_sum_of_dropoff_sequence() {
    // [REF:ability_shadow_barrage]
    // Bullets 5 + 6: dropoff sequence is 100%, 90%, 80%, … Burst
    // total = base × Σ(max(1 - 0.1×i, 0) for i in 0..N).
    // Value=4 ⇒ 1.0 + 0.9 + 0.8 + 0.7 = 3.4× the stored bite damage.
    let attacker = shadow_barrage_attacker(1_000_000.0, 100.0, 0.5);
    let defender = passive_combatant(10_000_000.0);
    let result = simulate_composable_matchup_with_trace(
        &attacker, &defender, None, None,
        SimpleAbilityTimingMode::ReallyFast,
        &shadow_barrage_cfg(4.0),
        5.0, true,
    );
    let log = result.combat_log.expect("trace");
    let first_bite_damage = log
        .iter()
        .find(|e| e.entry_type == "bite" && e.attacker == "A")
        .map(|e| e.damage)
        .expect("at least one bite event must be recorded");
    let burst_damage = log
        .iter()
        .find(|e| e.description.as_deref() == Some("Shadow Barrage hit"))
        .map(|e| e.damage)
        .expect("burst event must fire");
    let expected_factor = 1.0_f64 + 0.9 + 0.8 + 0.7; // = 3.4
    let expected = first_bite_damage * expected_factor;
    assert!(
        (burst_damage - expected).abs() < 1e-6,
        "value=4 burst damage must equal {expected_factor}× stored bite damage = {expected}: got {burst_damage}"
    );
}

#[test]
fn dropoff_factor_clamps_at_zero_for_large_values() {
    // [REF:ability_shadow_barrage]
    // Bullet 6 explicit "clamped at zero". Value=15 ⇒ effective hit
    // count is 10 (after that the per-hit factor reaches 0). Total
    // factor = 1.0 + 0.9 + … + 0.1 = 5.5×; further "hits" 11-15 add
    // nothing. The test asserts the burst damage never exceeds the
    // value=10 ceiling no matter how high the configured value is.
    let attacker = shadow_barrage_attacker(1_000_000.0, 100.0, 0.5);
    let defender = passive_combatant(10_000_000.0);
    let result = simulate_composable_matchup_with_trace(
        &attacker, &defender, None, None,
        SimpleAbilityTimingMode::ReallyFast,
        &shadow_barrage_cfg(15.0),
        5.0, true,
    );
    let log = result.combat_log.expect("trace");
    let first_bite_damage = log
        .iter()
        .find(|e| e.entry_type == "bite" && e.attacker == "A")
        .map(|e| e.damage)
        .expect("at least one bite event must be recorded");
    let burst_damage = log
        .iter()
        .find(|e| e.description.as_deref() == Some("Shadow Barrage hit"))
        .map(|e| e.damage)
        .expect("burst event must fire");
    let max_factor = 1.0_f64 + 0.9 + 0.8 + 0.7 + 0.6 + 0.5 + 0.4 + 0.3 + 0.2 + 0.1;
    let ceiling = first_bite_damage * max_factor + 1e-6;
    assert!(
        burst_damage <= ceiling,
        "value=15 burst must NOT exceed value=10 ceiling ({ceiling}): got {burst_damage}"
    );
}

#[test]
fn stored_damage_equals_last_melee_hit_at_activation_time() {
    // [REF:ability_shadow_barrage]
    // Bullets 3 + final note: "Shadow Barrage is based on the
    // damage of the last recent melee hit, not on a newly
    // recalculated bite each time." The burst's total damage must
    // line up with `stored_bite × Σ(dropoff)` where `stored_bite` is
    // the bite captured at activation time.
    let attacker = shadow_barrage_attacker(1_000_000.0, 100.0, 0.5);
    let defender = passive_combatant(10_000_000.0);
    let result = simulate_composable_matchup_with_trace(
        &attacker, &defender, None, None,
        SimpleAbilityTimingMode::ReallyFast,
        &shadow_barrage_cfg(3.0),
        5.0, true,
    );
    let log = result.combat_log.expect("trace");
    let first_bite_damage = log
        .iter()
        .find(|e| e.entry_type == "bite" && e.attacker == "A")
        .map(|e| e.damage)
        .expect("at least one bite event must be recorded");
    let burst_damage = log
        .iter()
        .find(|e| e.description.as_deref() == Some("Shadow Barrage hit"))
        .map(|e| e.damage)
        .expect("burst event must fire");
    let expected = first_bite_damage * (1.0 + 0.9 + 0.8);
    assert!(
        (burst_damage - expected).abs() < 1e-6,
        "burst damage must use the stored bite at activation: expected {expected}, got {burst_damage}"
    );
}

#[test]
fn cooldown_blocks_reactivation_during_continuous_bites() {
    // [REF:ability_shadow_barrage]
    // "It has a 30 second cooldown" - even with continuous bite
    // pressure that keeps `last_melee_hit_*` fresh every tick, the
    // ability cannot re-fire until 30 s have passed. In a 5 s
    // window we see exactly one activation.
    let attacker = shadow_barrage_attacker(1_000_000.0, 100.0, 0.5);
    let defender = passive_combatant(10_000_000.0);
    let result = simulate_composable_matchup_with_trace(
        &attacker, &defender, None, None,
        SimpleAbilityTimingMode::ReallyFast,
        &shadow_barrage_cfg(3.0),
        5.0, true,
    );
    let log = result.combat_log.expect("trace");
    let activations = log
        .iter()
        .filter(|e| e.description.as_deref() == Some("Shadow Barrage activated"))
        .count();
    assert_eq!(
        activations, 1,
        "exactly ONE Shadow Barrage activation in 5 s window even with continuous bites: got {activations}"
    );
}

#[test]
fn each_barrage_hit_reapplies_offensive_on_hit_effects() {
    // [REF:ability_shadow_barrage]
    // "Each barrage hit reapplies the attacker's modeled offensive
    // on-hit effects" still holds in the burst model: the engine
    // multiplies on-hit stack counts by `count` and emits a single
    // apply trace event. For value=3 with on-hit Bleed×1.0, the
    // burst applies 3 stacks of Bleed in one combined apply.
    let mut a = shadow_barrage_attacker(1_000_000.0, 100.0, 1.0);
    a.on_hit_statuses = vec![applied_status("Bleed_Status", 1.0)];
    let defender = passive_combatant(10_000_000.0);
    let result = simulate_composable_matchup_with_trace(
        &a, &defender, None, None,
        SimpleAbilityTimingMode::ReallyFast,
        &shadow_barrage_cfg(3.0),
        5.0, true,
    );
    let log = result.combat_log.expect("trace");
    let bite_count = log
        .iter()
        .filter(|e| e.entry_type == "bite" && e.attacker == "A")
        .count();
    // Bleed apply events whose description starts with "Bite applied"
    // come from regular bites; whose description starts with
    // "Shadow Barrage applied" come from the burst.
    let barrage_applies: Vec<&_> = log
        .iter()
        .filter(|e| {
            e.status_id.as_deref() == Some("Bleed_Status")
                && e.description.as_deref().is_some_and(|d| d.starts_with("Shadow Barrage applied"))
        })
        .collect();
    assert_eq!(
        barrage_applies.len(),
        1,
        "burst must emit exactly one Shadow-Barrage Bleed apply event (stacks ×count): got {}",
        barrage_applies.len()
    );
    // Ensure regular bites still apply Bleed normally (sanity that
    // we didn't break the bite-side trace).
    let bite_applies = log
        .iter()
        .filter(|e| {
            e.status_id.as_deref() == Some("Bleed_Status")
                && e.description.as_deref().is_some_and(|d| d.starts_with("Bite applied"))
        })
        .count();
    assert_eq!(
        bite_applies, bite_count,
        "every regular bite must still apply Bleed: bites={bite_count}, applies={bite_applies}"
    );
}
