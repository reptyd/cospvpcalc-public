//! Reference: ability_shadow_barrage
//!
//! Covers each testable bullet in the "Shadow Barrage" entry. Each
//! test body starts with the [REF:ability_shadow_barrage] marker so
//! the vitest coverage gate (src/pages/referenceCoverage.test.ts)
//! sees it.
//!
//! Engine path: `composable/phases/phase4.rs` Phase 4s. Activation
//! gate requires (cooldown done) + (last melee within 10 s) + (stored
//! damage > 0). The barrage replays the seeding bite as N hits with a
//! geometric 0.9^i dropoff (hit i = 0.9^i of the stored bite), each
//! routed through the defender's Reflect. In-game Reflect fires before the
//! decay, so each reflected hit is the FULL undecayed stored bite: a Reflect
//! defender takes ~0 and the attacker eats `count x base` back (NOT the
//! decayed sum). On-hit ailments apply once per hit in the burst (engine
//! multiplies stacks by `count` and emits a single apply trace entry). 30 s
//! cooldown is unchanged.

use super::super::config::ComposableAbilityConfig;
use super::super::simulate_composable_matchup_with_trace;
use super::{applied_status, default_combatant};
use crate::contracts::{SimpleAbilityTimingMode, SimpleCombatantStats};
use crate::spec_constants::SHADOW_BARRAGE_COOLDOWN_SEC;

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
fn barrage_hits_reflect_back_to_the_attacker() {
    // [REF:ability_shadow_barrage]
    // A4: each barrage hit passes through the defender's Reflect. Against
    // a Reflect defender the defender takes ~0 (no "Shadow Barrage hit"
    // event) and the attacker eats one reflection per hit, so the
    // "Shadow Barrage reflected" event fires and A loses HP to its own
    // barrage. The reflection is UNDECAYED (game Reflect fires before the
    // 0.9^i decay), so the total is `count x single-bite reflect`.
    let attacker = shadow_barrage_attacker(1_000_000.0, 5_000.0, 0.5);
    let defender = passive_combatant(10_000_000.0);
    let count = 3;
    let mut cfg = shadow_barrage_cfg(count as f64);
    cfg.defender_reflect = true;
    let result = simulate_composable_matchup_with_trace(
        &attacker, &defender, None, None,
        SimpleAbilityTimingMode::ReallyFast,
        &cfg,
        5.0, true,
    );
    let log = result.combat_log.expect("trace");
    let reflected = log
        .iter()
        .find(|e| e.description.as_deref() == Some("Shadow Barrage reflected"))
        .map(|e| e.damage);
    assert!(
        reflected.is_some_and(|d| d > 0.0),
        "barrage into a Reflect defender must reflect back at the attacker: {reflected:?}"
    );
    assert!(
        log.iter()
            .all(|e| e.description.as_deref() != Some("Shadow Barrage hit")),
        "a Reflect defender must take ~0 from the barrage (no hit event)"
    );
    // Undecayed reflection: a single regular bite into the same Reflect
    // defender bounces `reflect_base`; the burst must bounce exactly
    // `count x reflect_base`, NOT the 0.9^i-decayed sum (which the old
    // model produced). The seeding attacker has no Berserk, so every
    // bite's reflect base is the same constant.
    let single_bite_reflect = log
        .iter()
        .find(|e| e.description.as_deref() == Some("Reflect (bite)"))
        .map(|e| e.damage)
        .expect("a regular bite into the Reflect defender must reflect");
    let expected = single_bite_reflect * count as f64;
    let barrage_reflected = reflected.unwrap();
    assert!(
        (barrage_reflected - expected).abs() < 1e-6,
        "barrage reflection must be UNDECAYED (count × single-bite reflect = {expected}), \
         not the 0.9^i-decayed sum: got {barrage_reflected}"
    );
}

#[test]
fn barrage_reflection_is_undecayed_when_the_defender_fires_it() {
    // [REF:ability_shadow_barrage]
    // A4 from the other side. Phase 4s runs as two mirrored blocks, one
    // per side, so the undecayed-reflection rule needs its own assertion
    // on the B side: the B block once passed the 0.9^i-decayed base and
    // no test read it.
    let attacker = passive_combatant(10_000_000.0);
    let defender = shadow_barrage_attacker(1_000_000.0, 5_000.0, 0.5);
    let count = 3;
    let mut cfg = ComposableAbilityConfig::default();
    cfg.defender_shadow_barrage_value = count as f64;
    cfg.attacker_reflect = true;
    let result = simulate_composable_matchup_with_trace(
        &attacker, &defender, None, None,
        SimpleAbilityTimingMode::ReallyFast,
        &cfg,
        5.0, true,
    );
    let log = result.combat_log.expect("trace");
    let reflected = log
        .iter()
        .find(|e| e.description.as_deref() == Some("Shadow Barrage reflected"))
        .map(|e| e.damage);
    assert!(
        reflected.is_some_and(|d| d > 0.0),
        "a B-side barrage into a Reflect A must reflect back at B: {reflected:?}"
    );
    assert!(
        log.iter()
            .all(|e| e.description.as_deref() != Some("Shadow Barrage hit")),
        "a Reflect A must take ~0 from B's barrage (no hit event)"
    );
    let single_bite_reflect = log
        .iter()
        .find(|e| e.description.as_deref() == Some("Reflect (bite)"))
        .map(|e| e.damage)
        .expect("a regular bite into the Reflect A must reflect");
    let expected = single_bite_reflect * count as f64;
    let barrage_reflected = reflected.unwrap();
    assert!(
        (barrage_reflected - expected).abs() < 1e-6,
        "B-side barrage reflection must be UNDECAYED (count × single-bite reflect = {expected}), \
         not the 0.9^i-decayed sum: got {barrage_reflected}"
    );
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
    // Bullets 5 + 6: geometric dropoff 0.9^i, i from 1 (first hit 0.9).
    // Burst total = base x sum(0.9^i for i in 1..=N).
    // Value=4 => 0.9 + 0.81 + 0.729 + 0.6561 = 3.0951x the stored bite.
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
    let expected_factor = 0.9_f64 + 0.81 + 0.729 + 0.6561; // = 3.0951
    let expected = first_bite_damage * expected_factor;
    assert!(
        (burst_damage - expected).abs() < 1e-6,
        "value=4 burst damage must equal {expected_factor}× stored bite damage = {expected}: got {burst_damage}"
    );
}

#[test]
fn dropoff_is_geometric_and_bounded_by_nine_times() {
    // [REF:ability_shadow_barrage]
    // The dropoff is geometric 0.9^i, so it never clamps to zero, but the
    // sum is bounded by the geometric limit sum(0.9^i, i>=1) = 9. Value=15 =>
    // burst = base x sum(0.9^i, i in 1..=15) ~ 7.147x, strictly under 9x.
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
    let expected_factor: f64 = (1..=15).map(|i| 0.9_f64.powi(i)).sum();
    let expected = first_bite_damage * expected_factor;
    assert!(
        (burst_damage - expected).abs() < 1e-6,
        "value=15 burst must equal base × Σ(0.9^i, 1..=15) = {expected}: got {burst_damage}"
    );
    assert!(
        burst_damage < first_bite_damage * 9.0 + 1e-6,
        "geometric burst is bounded by 9× the stored bite: got {burst_damage}"
    );
}

#[test]
fn stored_damage_equals_last_melee_hit_at_activation_time() {
    // [REF:ability_shadow_barrage]
    // Bullets 3 + final note: "When it starts, it stores the pre-reflect
    // damage of that last melee hit." The burst's total damage must line up
    // with `stored_bite x sum(dropoff)` where `stored_bite` is the bite captured
    // at activation time.
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
    let expected = first_bite_damage * (0.9 + 0.81 + 0.729);
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

    // Witness the cooldown magnitude: extend the window past the 30 s
    // cooldown. Continuous 0.5 s bites keep `last_melee_hit_*` fresh, so
    // the ability re-arms the instant its cooldown expires and the second
    // activation lands ~30 s after the first.
    let extended = simulate_composable_matchup_with_trace(
        &attacker, &defender, None, None,
        SimpleAbilityTimingMode::ReallyFast,
        &shadow_barrage_cfg(3.0),
        70.0, true,
    );
    let extended_log = extended.combat_log.expect("trace");
    let activation_times: Vec<f64> = extended_log
        .iter()
        .filter(|e| e.description.as_deref() == Some("Shadow Barrage activated"))
        .map(|e| e.time)
        .collect();
    assert!(
        activation_times.len() >= 2,
        "Shadow Barrage must re-fire after the cooldown in a 70 s window: {activation_times:?}"
    );
    let gap = activation_times[1] - activation_times[0];
    assert!(
        (gap - SHADOW_BARRAGE_COOLDOWN_SEC).abs() < 1.0,
        "second Shadow Barrage activation must land ~{SHADOW_BARRAGE_COOLDOWN_SEC} s after the first, got {gap}: {activation_times:?}"
    );
}

#[test]
fn each_barrage_hit_reapplies_offensive_on_hit_effects() {
    // [REF:ability_shadow_barrage]
    // "Each barrage hit reapplies the attacker's modeled offensive
    // on-hit effects" still holds in the burst model: the engine
    // multiplies on-hit stack counts by `count` and emits a single
    // apply trace event. For value=3 with on-hit Bleed x1.0, the
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
