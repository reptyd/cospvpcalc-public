//! Reference: ability_life_leech
//!
//! Covers each testable bullet in the "Life Leech" entry. Each test body
//! starts with the [REF:ability_life_leech] marker so the vitest
//! coverage gate (src/pages/referenceCoverage.test.ts) sees it.
//!
//! Engine path: activation in `composable/mod.rs:3256-3286`
//! (Phase 4 - `life_leech_active_until = time + 12`, cooldown +60).
//! Heal-on-direct-damage in melee phases (`mod.rs:5008-5031`,
//! `:5354-5377`) and the breath path (`mod.rs:5590-...`). The leak-test
//! itself is `actives::simulate_simple_life_leech_hit` which gates on
//! `time >= life_leech_active_until` and consumes only the direct
//! `damage_dealt` argument - DoT ticks never call it.
//!
//! ReallyFast policy activates Life Leech on cooldown iff HP <= 85%
//! (`policy_framework::should_activate_life_leech`). All tests below
//! pre-wound the attacker via a hard-pressing defender so the gate
//! flips at t=0.5 (after the first defender bite drops A below 85%).

use super::super::config::ComposableAbilityConfig;
use super::super::simulate_composable_matchup_with_trace;
use super::{applied_status, default_breath, default_combatant};
use crate::contracts::{SimpleAbilityTimingMode, SimpleCombatantStats};
use crate::spec_constants::LIFE_LEECH_DURATION_SEC;

fn life_leech_attacker_cfg() -> ComposableAbilityConfig {
    let mut cfg = ComposableAbilityConfig::default();
    cfg.attacker_life_leech_value = 1.0; // 100% of dealt damage returned as heal
    cfg
}

fn count_heal_events(log: &[crate::contracts::CombatLogEntry], side: &str) -> usize {
    log.iter()
        .filter(|e| {
            e.attacker == side && e.description.as_deref() == Some("Life Leech heal")
        })
        .count()
}

fn heal_events(log: &[crate::contracts::CombatLogEntry]) -> Vec<&crate::contracts::CombatLogEntry> {
    log.iter()
        .filter(|e| e.attacker == "A" && e.description.as_deref() == Some("Life Leech heal"))
        .collect()
}

/// The direct-damage event that produced the heal logged at `time`: the
/// engine leeches inside the same bite/breath resolution, so the source
/// event carries the identical timestamp.
fn direct_damage_at(
    log: &[crate::contracts::CombatLogEntry],
    entry_type: &str,
    time: f64,
) -> f64 {
    log.iter()
        .find(|e| e.entry_type == entry_type && e.attacker == "A" && (e.time - time).abs() < 1e-9)
        .unwrap_or_else(|| panic!("no A {entry_type} paired with the Life Leech heal at t={time}"))
        .damage
}

/// Asserts every heal in `log` equals `direct damage x value`, clamped by
/// the headroom the attacker had at that moment, and reports how many of
/// them the clamp actually bound.
fn assert_heals_match_formula(
    log: &[crate::contracts::CombatLogEntry],
    source_type: &str,
    value: f64,
    max_hp: f64,
) -> usize {
    let mut clamped = 0;
    for h in heal_events(log) {
        let healed = h.healing.unwrap_or(0.0);
        let dealt = direct_damage_at(log, source_type, h.time);
        let headroom = max_hp - (h.actor_hp_after - healed);
        let uncapped = dealt * value;
        let expected = uncapped.min(headroom);
        assert!(
            (healed - expected).abs() < 1e-6,
            "heal at t={} must be {source_type} damage {dealt} × {value} clamped to headroom \
             {headroom} = {expected}, got {healed}",
            h.time
        );
        assert!(
            h.actor_hp_after <= max_hp + 1e-6,
            "Life Leech may never push the attacker past max HP {max_hp}: got {}",
            h.actor_hp_after
        );
        if uncapped > headroom + 1e-6 {
            clamped += 1;
        }
    }
    clamped
}

fn passive_combatant(max_hp: f64) -> SimpleCombatantStats {
    let mut c = default_combatant();
    c.health = max_hp;
    c.damage = 0.0;
    c.bite_cooldown = 1000.0;
    c
}

/// Attacker A: 1000 HP, bites for 100 every 0.5 s.
fn standard_ll_attacker() -> SimpleCombatantStats {
    let mut c = default_combatant();
    c.health = 1_000.0;
    c.damage = 100.0;
    c.bite_cooldown = 0.5;
    c
}

/// Defender B: huge HP (so it doesn't die), bites for 200 every 0.5 s
/// (drops A below the 85% gate after the first bite).
fn standard_ll_defender() -> SimpleCombatantStats {
    let mut c = default_combatant();
    c.health = 10_000_000.0;
    c.damage = 200.0;
    c.bite_cooldown = 0.5;
    c
}

#[test]
fn lasts_twelve_seconds() {
    // [REF:ability_life_leech]
    // Bullet 1: "Life Leech lasts for 12 seconds."
    // Engine: `life_leech_active_until = time + 12.0`. Activation flips
    // at t=0.5 (Phase 4 sees A under 85% gate). Active until t=12.5.
    // Bites past t=12.5 trigger no heal events; cooldown re-arms at
    // t=60.5.
    let result = simulate_composable_matchup_with_trace(
        &standard_ll_attacker(),
        &standard_ll_defender(),
        None, None,
        SimpleAbilityTimingMode::ReallyFast,
        &life_leech_attacker_cfg(),
        14.0, true,
    );
    let log = result.combat_log.expect("trace log");
    let heal_times: Vec<f64> = log
        .iter()
        .filter(|e| {
            e.attacker == "A" && e.description.as_deref() == Some("Life Leech heal")
        })
        .map(|e| e.time)
        .collect();
    assert!(
        !heal_times.is_empty(),
        "Life Leech must heal at least once during the active window"
    );
    let last_heal = heal_times.iter().cloned().fold(0.0_f64, f64::max);
    // Activation flips at t=0.5 (first defender bite drops A under 85%),
    // so the active window ends at 0.5 + LIFE_LEECH_DURATION_SEC.
    let window_end = 0.5 + LIFE_LEECH_DURATION_SEC;
    assert!(
        last_heal <= window_end + 1e-6,
        "no Life Leech heal allowed past the active window (t=0.5 + {LIFE_LEECH_DURATION_SEC} = {window_end}): last_heal={last_heal}"
    );
    assert!(
        last_heal >= window_end - 0.5 - 1e-6,
        "the window must stay open the full {LIFE_LEECH_DURATION_SEC} s - the last heal has to sit \
         within one bite of {window_end}: last_heal={last_heal}, heals={heal_times:?}"
    );
}

#[test]
fn cooldown_sixty_seconds() {
    // [REF:ability_life_leech]
    // Bullet 2: "It has a 60 second cooldown."
    // Activation at t=0.5; cooldown blocks the next activation until
    // t=60.5. Verify a clear gap by counting heal events in three
    // ranges: (0..12.5) first window, (12.5..60.5) cooldown gap,
    // (60.5..) second window.
    let result = simulate_composable_matchup_with_trace(
        &standard_ll_attacker(),
        &standard_ll_defender(),
        None, None,
        SimpleAbilityTimingMode::ReallyFast,
        &life_leech_attacker_cfg(),
        65.0, true,
    );
    let log = result.combat_log.expect("trace log");
    let heal_times: Vec<f64> = log
        .iter()
        .filter(|e| {
            e.attacker == "A" && e.description.as_deref() == Some("Life Leech heal")
        })
        .map(|e| e.time)
        .collect();
    let in_first_window = heal_times.iter().filter(|&&t| t <= 12.5 + 1e-6).count();
    let in_gap = heal_times
        .iter()
        .filter(|&&t| t > 12.5 + 1e-6 && t < 60.5 - 1e-6)
        .count();
    let in_second_window = heal_times.iter().filter(|&&t| t >= 60.5 - 1e-6).count();
    assert!(
        in_first_window > 0,
        "first activation window must produce heal events: {heal_times:?}"
    );
    assert_eq!(
        in_gap, 0,
        "no heal events allowed during the cooldown gap (12.5..60.5): {heal_times:?}"
    );
    assert!(
        in_second_window > 0,
        "second activation at t=60.5 must resume heal events: {heal_times:?}"
    );
}

#[test]
fn heals_based_on_direct_damage_during_active_window() {
    // [REF:ability_life_leech]
    // Bullet 3: "Healing is based on direct damage dealt during the
    // active window."
    // Engine: heal = damage_dealt x life_leech_value. Run the same fight
    // at two leech values and pair every heal with the bite that produced
    // it, so the heal is pinned to both factors rather than to its sign.
    let max_hp = standard_ll_attacker().health;
    for value in [1.0_f64, 0.4] {
        let mut cfg = ComposableAbilityConfig::default();
        cfg.attacker_life_leech_value = value;
        let result = simulate_composable_matchup_with_trace(
            &standard_ll_attacker(),
            &standard_ll_defender(),
            None, None,
            SimpleAbilityTimingMode::ReallyFast,
            &cfg,
            3.0, true,
        );
        let log = result.combat_log.expect("trace log");
        let heals = heal_events(&log);
        assert!(
            heals.len() >= 2,
            "Life Leech must heal on every bite of the active window at value={value}: got {}",
            heals.len()
        );
        assert_heals_match_formula(&log, "bite", value, max_hp);
    }
}

#[test]
fn heals_from_both_bite_and_breath_direct_damage() {
    // [REF:ability_life_leech]
    // Bullet 5: "This includes direct bite damage and direct breath damage."
    // Two sims that isolate each direct-damage path. Each heal is pinned to
    // the damage its own path logged, so a path that heals off the wrong
    // number - or off a constant - fails here.
    let cfg = life_leech_attacker_cfg();

    // (a) Bite path: standard pressure setup.
    let bite_run = simulate_composable_matchup_with_trace(
        &standard_ll_attacker(),
        &standard_ll_defender(),
        None, None,
        SimpleAbilityTimingMode::ReallyFast,
        &cfg, 3.0, true,
    );
    let bite_log = bite_run.combat_log.expect("bite trace");
    assert!(
        count_heal_events(&bite_log, "A") > 0,
        "Life Leech must heal from BITE damage during the active window"
    );
    assert_heals_match_formula(&bite_log, "bite", 1.0, standard_ll_attacker().health);

    // (b) Breath path: attacker has a breath profile but no bite damage.
    // Defender pressure still drops attacker under the 85% gate.
    let mut a_breath = passive_combatant(1_000.0);
    a_breath.bite_cooldown = 1000.0;
    let mut b_breath = standard_ll_defender();
    b_breath.weight = 100.0;
    let mut breath = default_breath();
    breath.dps_pct = 1.0;
    breath.capacity = 5.0;
    breath.regen_rate = 1.0;

    let breath_run = simulate_composable_matchup_with_trace(
        &a_breath, &b_breath, Some(&breath), None,
        SimpleAbilityTimingMode::ReallyFast,
        &cfg, 5.0, true,
    );
    let breath_log = breath_run.combat_log.expect("breath trace");
    assert!(
        count_heal_events(&breath_log, "A") > 0,
        "Life Leech must heal from BREATH damage during the active window"
    );
    assert_heals_match_formula(&breath_log, "breath", 1.0, a_breath.health);
}

#[test]
fn status_dot_damage_does_not_count() {
    // [REF:ability_life_leech]
    // Bullet 3: "Healing is based on direct damage dealt during the active
    // window." Setup: the attacker deals no direct damage (damage 0, long
    // cooldown) but is bitten by the defender, so Life Leech activates and
    // stays active. The defender carries a pre-seeded Burn, so the only damage
    // it takes is that Burn DoT (credited to the attacker). DoT ticks go
    // through Phase 12 (`handle_simple_dot_ticks_*`), which never calls
    // `simulate_simple_life_leech_hit`, so they must produce no heal on the
    // attacker. We also assert the Burn DoT does tick (sanity).
    let mut a = standard_ll_attacker();
    a.damage = 0.0; // no direct attacker damage to defender
    a.bite_cooldown = 1000.0;
    let mut b = standard_ll_defender();
    b.starting_statuses = vec![applied_status("Burn_Status", 5.0)];

    let result = simulate_composable_matchup_with_trace(
        &a, &b, None, None,
        SimpleAbilityTimingMode::ReallyFast,
        &life_leech_attacker_cfg(),
        12.0, true,
    );
    let log = result.combat_log.expect("trace log");
    let heal_events = count_heal_events(&log, "A");
    assert_eq!(
        heal_events, 0,
        "Life Leech must NOT produce heal events from defender's DoT ticks: got {heal_events}"
    );
    // Sanity: defender's pre-loaded Burn produces DoT ticks in the trace.
    let burn_ticks = log.iter().any(|e| {
        e.entry_type == "dot"
            && e.status_id.as_deref() == Some("Burn_Status")
            && e.attacker == "A"
    });
    assert!(
        burn_ticks,
        "sanity: defender starting Burn must produce DoT ticks against attacker"
    );
}

#[test]
fn heal_capped_at_missing_hp() {
    // [REF:ability_life_leech]
    // Bullet 6: "Healing is limited by the user's missing HP."
    // Engine: `next_hp = (current_hp + heal).min(maxHP)`. Give the
    // attacker a bite far bigger than the headroom the 85% activation
    // gate leaves it, so the clamp is the binding constraint on every
    // heal: each one restores exactly the missing HP and lands the
    // attacker back on max HP, never above it.
    let mut attacker = standard_ll_attacker();
    attacker.damage = 5_000.0;
    let result = simulate_composable_matchup_with_trace(
        &attacker,
        &standard_ll_defender(),
        None, None,
        SimpleAbilityTimingMode::ReallyFast,
        &life_leech_attacker_cfg(),
        10.0, true,
    );
    let log = result.combat_log.expect("trace log");
    let max_hp = attacker.health;
    let heals = heal_events(&log);
    assert!(
        !heals.is_empty(),
        "expected Life Leech healing in the 10 s window"
    );
    let clamped = assert_heals_match_formula(&log, "bite", 1.0, max_hp);
    assert!(
        clamped > 0,
        "a bite this far above the attacker's headroom must be clipped by missing HP, \
         but no heal was clamped: {:?}",
        heals.iter().map(|h| (h.time, h.healing)).collect::<Vec<_>>()
    );
    for h in &heals {
        if (h.healing.unwrap_or(0.0) - (max_hp - (h.actor_hp_after - h.healing.unwrap_or(0.0)))).abs() < 1e-6 {
            assert!(
                (h.actor_hp_after - max_hp).abs() < 1e-6,
                "a clamped heal must land the attacker exactly on max HP {max_hp}, got {}",
                h.actor_hp_after
            );
        }
    }
}
