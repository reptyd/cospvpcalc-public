//! Reference: status_blessings_boon
//!
//! Covers each testable bullet in the "Blessing's Boon" entry. Each
//! test body starts with the [REF:status_blessings_boon] marker so
//! the vitest coverage gate (src/pages/referenceCoverage.test.ts)
//! sees it.
//!
//! Engine path: `statuses.rs:642-649` — when the per-status decay
//! loop hits a `Blessings_Boon` instance with stacks > 0, it heals
//! `target_max_hp * 3.0 / 100.0` (= 3% max HP) and reschedules the
//! tick at `time + status_tick_sec("Blessings_Boon") = time + 3`.

use super::super::config::ComposableAbilityConfig;
use super::super::simulate_composable_matchup_with_trace;
use super::default_combatant;
use crate::contracts::{SimpleAbilityTimingMode, SimpleAppliedStatus, SimpleCombatantStats};

fn passive_combatant(max_hp: f64) -> SimpleCombatantStats {
    let mut c = default_combatant();
    c.health = max_hp;
    c.damage = 0.0;
    c.bite_cooldown = 1000.0;
    c
}

#[test]
fn restores_three_percent_max_hp_every_three_seconds() {
    // [REF:status_blessings_boon]
    // Bullet 1: "Blessing's Boon restores 3% max HP every 3 seconds
    // while it is active."
    // Strategy: pre-wound attacker via a heavy defender, run with
    // Blessings_Boon present vs. without; the Boon-side run must
    // take strictly less net damage over the same window because
    // each 3 s heal restores 3% maxHP.
    let mut attacker = passive_combatant(10_000.0);
    // 5 stacks → status stays alive for 5 × 3 s = 15 s, so the
    // 10 s window captures 3 heal ticks at t≈3, 6, 9.
    attacker.starting_statuses = vec![SimpleAppliedStatus {
        status_id: "Blessings_Boon".to_string(),
        stacks: 5.0,
        source_ability: None,
    }];
    let mut control = passive_combatant(10_000.0);
    control.starting_statuses = vec![]; // baseline, no Boon
    let mut biter = default_combatant();
    biter.damage = 50.0;
    biter.bite_cooldown = 1.0;
    biter.health = 10_000_000.0;

    // Run for 10 seconds → 3 Blessings_Boon ticks (at t=3, 6, 9).
    let with_boon = simulate_composable_matchup_with_trace(
        &attacker, &biter, None, None,
        SimpleAbilityTimingMode::ReallyFast,
        &ComposableAbilityConfig::default(),
        10.0, true,
    );
    let baseline = simulate_composable_matchup_with_trace(
        &control, &biter, None, None,
        SimpleAbilityTimingMode::ReallyFast,
        &ComposableAbilityConfig::default(),
        10.0, true,
    );
    let boon_taken = with_boon.damage_dealt_b;
    let baseline_taken = baseline.damage_dealt_b;
    // Net damage taken = damage_dealt_b - blessings_heals. Boon should
    // reduce net effect — easiest check: the matchup trajectory
    // differs (with-Boon attacker survives longer / takes less net).
    // Concretely, total Bleed/Burn we have none here, so the only
    // mechanism causing the gap is the 3% maxHP heal x 3 = 900 HP
    // returned over 10 s. Assert trajectory differs strictly.
    let saved = boon_taken - baseline_taken;
    // damage_dealt counts gross hits; healing isn't subtracted there.
    // With identical setups except for the starting status the gross
    // hit damage matches. The actual proof of healing is observable
    // through `regen_healed_a` not being identical OR via a per-tick
    // probe. Use the BestBuildsMatchupSummary `regen_healed_a` field
    // when available; otherwise infer from time-to-kill or hp_at_end.
    // Here we observe attacker_hp_at_end via combat_log "Bite" entries
    // on the A side — last hp_after for A in trace.
    let with_log = with_boon.combat_log.expect("trace");
    let base_log = baseline.combat_log.expect("trace");
    let last_hp = |log: &[crate::contracts::CombatLogEntry]| -> f64 {
        log.iter()
            .rev()
            .find(|e| e.hp_side == "A")
            .map(|e| e.hp_after)
            .unwrap_or(0.0)
    };
    let with_hp = last_hp(&with_log);
    let base_hp = last_hp(&base_log);
    assert!(
        with_hp > base_hp,
        "Blessings_Boon must keep attacker at higher HP than baseline (3% max HP heal every 3 s): with={with_hp}, base={base_hp}, gross_dmg_diff={saved}"
    );
    // Sanity: at least 2 heal ticks of 3% (= 600 HP) over 10 s →
    // the gap should be at least ~500 HP (allowing some slack from
    // exact tick timing).
    let gap = with_hp - base_hp;
    assert!(
        gap >= 500.0,
        "expected at least ~500 HP gap from 3 heal ticks @ 3% maxHP=10000 over 10s: got {gap}"
    );
}
