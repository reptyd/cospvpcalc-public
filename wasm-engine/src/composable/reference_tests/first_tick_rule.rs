//! Reference: compare_first_tick_rule
//!
//! Covers each testable bullet in the "First Tick Rule" entry. Each
//! test body starts with the [REF:compare_first_tick_rule] marker so
//! the vitest coverage gate (src/pages/referenceCoverage.test.ts)
//! sees it.
//!
//! Engine path: per-side `compare_first_tick_regen` and
//! `compare_first_tick_ailments` flags plus
//! `compare_first_tick_delay_sec`. Regen-half overrides
//! `next_regen` at simulation start (`composable/mod.rs:1198-1209`)
//! to fire the first regen tick at `delay_sec` instead of the default
//! 15 s interval. Ailments-half overrides DoT first-tick scheduling
//! at `mod.rs:1829-1835, 5873`.

use super::super::config::ComposableAbilityConfig;
use super::super::simulate_composable_matchup_with_trace;
use super::default_combatant;
use crate::contracts::{SimpleAbilityTimingMode, SimpleCombatantStats};

fn passive_combatant(max_hp: f64, regen_pct: f64) -> SimpleCombatantStats {
    let mut c = default_combatant();
    c.health = max_hp;
    c.damage = 0.0;
    c.bite_cooldown = 1000.0;
    c.health_regen = regen_pct;
    c
}

#[test]
fn regen_half_overrides_first_regen_tick_to_compare_delay() {
    // [REF:compare_first_tick_rule]
    // Bullets 1 + 3 (regen branch): "First Tick Rule changes when the
    // first passive tick happens." + "When it is enabled, the first
    // tick uses the chosen compare delay instead of the normal
    // starting timing."
    // Engine: with attacker_compare_first_tick_regen=true and
    // delay_sec=2, the first regen tick fires at t=2 instead of t=15.
    let mut attacker = passive_combatant(1_000.0, 5.0);
    attacker.health_regen = 5.0;
    let _defender = passive_combatant(10_000_000.0, 0.0);

    // Pre-wound attacker via 1 small bite by defender so regen has
    // headroom to heal. Using starting_statuses or compare_start_hp_pct
    // would also work but bite-pressure is simpler.
    let mut biter = default_combatant();
    biter.damage = 100.0;
    biter.bite_cooldown = 0.5;
    biter.health = 10_000_000.0;

    let mut cfg = ComposableAbilityConfig::default();
    cfg.attacker_compare_first_tick_regen = true;
    cfg.attacker_compare_first_tick_delay_sec = 2.0;

    let result = simulate_composable_matchup_with_trace(
        &attacker, &biter, None, None,
        SimpleAbilityTimingMode::ReallyFast,
        &cfg,
        4.0, true,
    );
    let log = result.combat_log.expect("trace");
    let regen_event = log
        .iter()
        .find(|e| e.description.as_deref() == Some("Natural regen") && e.attacker == "A");
    assert!(
        regen_event.is_some(),
        "first regen tick must fire within the 4 s window when delay=2s"
    );
    let t = regen_event.unwrap().time;
    assert!(
        (t - 2.0).abs() < 0.01,
        "first regen tick must land at t=2 (delay_sec): got t={t}"
    );
}

#[test]
fn rule_off_keeps_default_fifteen_second_first_regen_tick() {
    // [REF:compare_first_tick_rule]
    // Inverse of the test above: when the rule is off, the first regen
    // tick must NOT fire before t=15.
    let mut attacker = passive_combatant(1_000.0, 5.0);
    attacker.health_regen = 5.0;
    let mut biter = default_combatant();
    biter.damage = 100.0;
    biter.bite_cooldown = 0.5;
    biter.health = 10_000_000.0;

    let result = simulate_composable_matchup_with_trace(
        &attacker, &biter, None, None,
        SimpleAbilityTimingMode::ReallyFast,
        &ComposableAbilityConfig::default(),
        4.0, true,
    );
    let log = result.combat_log.expect("trace");
    let regen_count = log
        .iter()
        .filter(|e| e.description.as_deref() == Some("Natural regen") && e.attacker == "A")
        .count();
    assert_eq!(
        regen_count, 0,
        "without First Tick Rule, no regen tick may fire in a 4 s window (default 15 s cadence)"
    );
}

#[test]
fn ailments_half_overrides_first_dot_tick_scheduling() {
    // [REF:compare_first_tick_rule]
    // Bullets 1 + 2 + 3 (ailments branch): with
    // `compare_first_tick_ailments` enabled, freshly applied DoTs
    // (Burn, Bleed, etc.) tick at `delay_sec` instead of the default
    // status-DoT 3s cadence.
    //
    // Setup: attacker takes a Burn × 5 stack on bite. With rule on
    // and delay=0.5, the first Burn DoT must fire near t=0.5 + bite
    // time. With rule off, first DoT lands ~3 s later. Compare DoT
    // event timestamps in the two runs.
    let mut attacker = passive_combatant(10_000_000.0, 0.0);
    attacker.bite_cooldown = 1.0;
    attacker.damage = 50.0;
    attacker.on_hit_taken_statuses = vec![]; // attacker is the target side
    let mut defender = passive_combatant(10_000_000.0, 0.0);
    defender.on_hit_statuses = vec![crate::contracts::SimpleAppliedStatus {
        status_id: "Burn_Status".to_string(),
        stacks: 5.0,
        source_ability: None,
    }];
    defender.damage = 50.0;
    defender.bite_cooldown = 1.0;

    // Both sides bite each other → defender's on_hit_statuses (Burn)
    // applied to attacker on bite. We track attacker-side Burn DoT.
    let mut cfg_on = ComposableAbilityConfig::default();
    cfg_on.attacker_compare_first_tick_ailments = true;
    cfg_on.attacker_compare_first_tick_delay_sec = 0.5;
    let on_run = simulate_composable_matchup_with_trace(
        &attacker, &defender, None, None,
        SimpleAbilityTimingMode::ReallyFast,
        &cfg_on,
        2.5, true,
    );
    let off_run = simulate_composable_matchup_with_trace(
        &attacker, &defender, None, None,
        SimpleAbilityTimingMode::ReallyFast,
        &ComposableAbilityConfig::default(),
        2.5, true,
    );
    let first_burn_dot = |result: &crate::contracts::BestBuildsMatchupSummary| -> Option<f64> {
        result
            .combat_log
            .as_ref()
            .and_then(|log| {
                log.iter()
                    .find(|e| {
                        e.entry_type == "dot"
                            && e.status_id.as_deref() == Some("Burn_Status")
                            && e.hp_side == "A"
                    })
                    .map(|e| e.time)
            })
    };
    let on_t = first_burn_dot(&on_run);
    let off_t = first_burn_dot(&off_run);
    // With rule on, first Burn DoT must land within 1.5 s; with rule
    // off, no DoT lands in the 2.5 s window (first apply at t=0,
    // first DoT at t=3 by default).
    assert!(
        on_t.is_some(),
        "with First Tick Rule (ailments) on, first Burn DoT must land within 2.5 s window"
    );
    let on_t = on_t.unwrap();
    assert!(
        on_t < 1.5,
        "with rule on (delay=0.5), first Burn DoT should fire well before t=1.5: got t={on_t}"
    );
    assert!(
        off_t.is_none(),
        "with rule off, first Burn DoT (default 3s cadence) must NOT fire in a 2.5 s window: got t={off_t:?}"
    );
}
