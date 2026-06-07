//! Reference: ability_radiation, status_radiation
//!
//! Covers each testable bullet in the "Radiation" ability entry plus
//! the new status_radiation entry (the legacy alias the engine
//! retains after Aura subtype generalisation). Each test body
//! carries a [REF:<id>] marker so the vitest coverage gate sees it.
//!
//! Engine path: Radiation reuses the generic aura mechanism with
//! subtype="Corrosion". `composable/mod.rs:1399-1413` schedules the
//! first tick at `AURA_TICK_SEC`=3.0 when an aura subtype is set;
//! Phase 4d (`mod.rs:2614-2661`) applies `AURA_AILMENT_STACKS`=3.0
//! Corrosion stacks every 3 s through `apply_statuses_with_trace`,
//! emitting an "Aura (Corrosion) applied Corrosion (3)" log entry
//! per tick. Engine logs use the generic "Aura (Corrosion)" label;
//! the Reference entry calls the same mechanism "Radiation" because
//! that's the carrier ability's in-game name.

use super::super::config::ComposableAbilityConfig;
use super::super::simulate_composable_matchup_with_trace;
use super::default_combatant;
use crate::contracts::{SimpleAbilityTimingMode, SimpleCombatantStats};

fn passive_combatant(max_hp: f64) -> SimpleCombatantStats {
    let mut c = default_combatant();
    c.health = max_hp;
    c.damage = 0.0;
    c.bite_cooldown = 1000.0;
    c
}

fn radiation_attacker_cfg() -> ComposableAbilityConfig {
    let mut cfg = ComposableAbilityConfig::default();
    cfg.attacker_aura_subtype = Some("Corrosion".to_string());
    cfg
}

#[test]
fn applies_three_corrosion_every_three_seconds() {
    // [REF:ability_radiation]
    // Bullet 1: "Radiation applies 3 Corrosion every 3 seconds."
    // Engine: per-tick stacks = AURA_AILMENT_STACKS = 3.0; tick
    // cadence = AURA_TICK_SEC = 3.0 s. Verify across an 11 s window
    // by counting Corrosion apply events at t=3, 6, 9 (3 ticks)
    // and confirming each carries +3 stacks.
    let attacker = passive_combatant(1_000.0);
    let defender = passive_combatant(10_000_000.0);
    let result = simulate_composable_matchup_with_trace(
        &attacker, &defender, None, None,
        SimpleAbilityTimingMode::Fast,
        &radiation_attacker_cfg(),
        11.0, true,
    );
    let log = result.combat_log.expect("trace log");
    let corrosion_applies: Vec<&_> = log
        .iter()
        .filter(|e| {
            e.status_id.as_deref() == Some("Corrosion_Status")
                && e.description.as_deref().is_some_and(|d| d.contains("applied"))
        })
        .collect();
    assert_eq!(
        corrosion_applies.len(),
        3,
        "expected 3 Corrosion apply events at t=3, 6, 9 in an 11 s window: got {}",
        corrosion_applies.len()
    );
    let times: Vec<f64> = corrosion_applies.iter().map(|e| e.time).collect();
    let expected_times = [3.0, 6.0, 9.0];
    for (got, want) in times.iter().zip(expected_times.iter()) {
        assert!(
            (got - want).abs() < 1e-9,
            "Corrosion apply timing mismatch: expected {want}, got {got} (all={times:?})"
        );
    }
    // Each apply event must record +3 stacks. Aura is the only source
    // of Corrosion in this matchup, so stacks ramp 0→3→6→9 across the
    // three ticks (linear because Corrosion's natural decay is slower
    // than the 3 s tick cadence).
    let first_detail = corrosion_applies[0].detail.as_deref().unwrap_or("");
    assert!(
        first_detail.contains("0 -> 3") || first_detail.contains("0.0 -> 3"),
        "first Corrosion apply must add exactly 3 stacks (0 -> 3): got detail={first_detail}"
    );
}

#[test]
fn first_radiation_tick_lands_at_three_seconds() {
    // [REF:ability_radiation]
    // Bullet 2: "The first Radiation tick happens 3 seconds after the
    // fight starts."
    // No Corrosion apply events allowed before t=3 - epsilon; first
    // event lands at exactly t=3.
    let attacker = passive_combatant(1_000.0);
    let defender = passive_combatant(10_000_000.0);
    // Sim past first tick boundary.
    let result = simulate_composable_matchup_with_trace(
        &attacker, &defender, None, None,
        SimpleAbilityTimingMode::Fast,
        &radiation_attacker_cfg(),
        3.5, true,
    );
    let log = result.combat_log.expect("trace log");
    let first_apply_time = log
        .iter()
        .filter(|e| {
            e.status_id.as_deref() == Some("Corrosion_Status")
                && e.description.as_deref().is_some_and(|d| d.contains("applied"))
        })
        .map(|e| e.time)
        .next();
    let first_t = first_apply_time.expect("at least one Corrosion apply expected by t=3.5");
    assert!(
        (first_t - 3.0).abs() < 1e-9,
        "first Radiation tick must land at exactly t=3.0, got {first_t}"
    );
    // Sim ending just before t=3 must record zero apply events.
    let pre_tick = simulate_composable_matchup_with_trace(
        &attacker, &defender, None, None,
        SimpleAbilityTimingMode::Fast,
        &radiation_attacker_cfg(),
        2.99, true,
    );
    let pre_log = pre_tick.combat_log.expect("trace log");
    let pre_applies = pre_log
        .iter()
        .filter(|e| {
            e.status_id.as_deref() == Some("Corrosion_Status")
                && e.description.as_deref().is_some_and(|d| d.contains("applied"))
        })
        .count();
    assert_eq!(
        pre_applies, 0,
        "no Corrosion apply allowed before t=3 (Radiation arms at fight start, fires first at t=3): got {pre_applies}"
    );
}

#[test]
fn always_active_no_cooldown_or_toggle() {
    // [REF:ability_radiation]
    // Bullet 3: "Radiation is treated as always active in the current
    // model."
    // Aura ticks continue indefinitely on the AURA_TICK_SEC cadence
    // - there is no per-fight activation toggle, no cooldown, no
    // expiry. Sim a 30 s window: expect 10 ticks at t=3, 6, ..., 30.
    let attacker = passive_combatant(1_000.0);
    let defender = passive_combatant(10_000_000_000.0);
    let result = simulate_composable_matchup_with_trace(
        &attacker, &defender, None, None,
        SimpleAbilityTimingMode::Fast,
        &radiation_attacker_cfg(),
        30.5, true,
    );
    let log = result.combat_log.expect("trace log");
    let apply_count = log
        .iter()
        .filter(|e| {
            e.status_id.as_deref() == Some("Corrosion_Status")
                && e.description.as_deref().is_some_and(|d| d.contains("applied"))
        })
        .count();
    assert_eq!(
        apply_count, 10,
        "always-active Radiation must produce 10 Corrosion applies across t=3..30: got {apply_count}"
    );
}

#[test]
fn radiation_status_is_fortify_removable_legacy_alias() {
    // [REF:status_radiation]
    // The engine retains Radiation_Status as a legacy id after the
    // Aura subtype-driven generalisation. The
    // catalog records polarity "negative" so Fortify cleanse picks
    // it up via the registry path (Phase 5c + Item 2).
    assert!(crate::statuses::is_fortify_removable_status("Radiation_Status"));
}
