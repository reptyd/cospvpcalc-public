//! Reference: ability_wardens_resistance
//!
//! Covers each testable bullet in the "Warden's Resistance" entry.
//! Each test body starts with the [REF:ability_wardens_resistance]
//! marker so the vitest coverage gate
//! (src/pages/referenceCoverage.test.ts) sees it.
//!
//! Engine path: `composable/mod.rs:326-329`
//! `conditional_warden_resistance_active` returns true when
//! `stats.has_warden_resistance && hp_ratio <= 0.5` (constant
//! `WARDEN_RESISTANCE_HP_RATIO_THRESHOLD = 0.5` in `statuses.rs:9`).
//! Status apply path consults the same threshold at `statuses.rs:377`
//! and `statuses.rs:421` to gate incoming statuses.

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

#[test]
fn applies_only_when_hp_at_or_below_fifty_percent() {
    // [REF:ability_wardens_resistance]
    // Bullet 1: "Warden's Resistance applies while the user's HP is
    // at or below 50%."
    // Run two scenarios: attacker stays above 50% HP for whole run
    // (no toggle log) vs attacker drops below 50% (toggle log appears).
    let mut attacker = passive_combatant(1_000.0);
    attacker.has_warden_resistance = true;

    // Scenario 1: defender does no damage, attacker at 100% HP for
    // entire run. Resistance must NEVER toggle on.
    let no_pressure = passive_combatant(10_000.0);
    let high_hp = simulate_composable_matchup_with_trace(
        &attacker, &no_pressure, None, None,
        SimpleAbilityTimingMode::ReallyFast,
        &ComposableAbilityConfig::default(),
        5.0, true,
    );
    let high_log = high_hp.combat_log.expect("trace");
    let high_activations = high_log
        .iter()
        .filter(|e| e.description.as_deref() == Some("Warden's Resistance activated"))
        .count();
    assert_eq!(
        high_activations, 0,
        "Warden's Resistance must NOT activate while attacker is above 50% HP: got {high_activations} activations"
    );

    // Scenario 2: defender pounds attacker below 50% quickly. Toggle
    // log must appear.
    let mut heavy = default_combatant();
    heavy.health = 10_000.0;
    heavy.damage = 600.0;
    heavy.bite_cooldown = 0.5;
    let low_hp = simulate_composable_matchup_with_trace(
        &attacker, &heavy, None, None,
        SimpleAbilityTimingMode::ReallyFast,
        &ComposableAbilityConfig::default(),
        5.0, true,
    );
    let low_log = low_hp.combat_log.expect("trace");
    let low_activations: Vec<f64> = low_log
        .iter()
        .filter(|e| e.description.as_deref() == Some("Warden's Resistance activated"))
        .map(|e| e.time)
        .collect();
    assert!(
        !low_activations.is_empty(),
        "Warden's Resistance must activate after attacker HP drops at or below 50%: got 0 activations"
    );
}

#[test]
fn while_active_blocks_new_incoming_statuses() {
    // [REF:ability_wardens_resistance]
    // Bullet 2: "While it is active, new incoming ailments and
    // statuses are blocked completely."
    // Engine: status apply path at `statuses.rs:377` returns early
    // when `has_warden_resistance && target_hp/max <= 0.5`.
    //
    // Setup: attacker holds Warden's Resistance and is pre-pressured
    // below 50% HP. Defender bites with on-hit Bleed apply. Compare
    // post-run Bleed DoT presence vs a control attacker without
    // Warden's Resistance.
    let mut attacker = passive_combatant(1_000.0);
    attacker.has_warden_resistance = true;
    let mut control_attacker = passive_combatant(1_000.0);
    control_attacker.has_warden_resistance = false;

    let mut biter = default_combatant();
    biter.health = 10_000.0;
    biter.damage = 600.0;
    biter.bite_cooldown = 0.5;
    biter.on_hit_statuses = vec![crate::contracts::SimpleAppliedStatus {
        status_id: "Bleed_Status".to_string(),
        stacks: 5.0,
        source_ability: None,
    }];

    let with_wr = simulate_composable_matchup_with_trace(
        &attacker, &biter, None, None,
        SimpleAbilityTimingMode::ReallyFast,
        &ComposableAbilityConfig::default(),
        10.0, true,
    );
    let without_wr = simulate_composable_matchup_with_trace(
        &control_attacker, &biter, None, None,
        SimpleAbilityTimingMode::ReallyFast,
        &ComposableAbilityConfig::default(),
        10.0, true,
    );
    let with_log = with_wr.combat_log.expect("trace");
    let without_log = without_wr.combat_log.expect("trace");
    let count_bleed_on_a = |log: &[crate::contracts::CombatLogEntry]| -> usize {
        log.iter()
            .filter(|e| {
                e.entry_type == "dot"
                    && e.status_id.as_deref() == Some("Bleed_Status")
                    && e.hp_side == "A"
            })
            .count()
    };
    let with_bleed = count_bleed_on_a(&with_log);
    let without_bleed = count_bleed_on_a(&without_log);
    // With WR active for the post-50% portion, fewer fresh applies
    // land → fewer Bleed DoT events on attacker over the run.
    assert!(
        with_bleed < without_bleed,
        "Warden's Resistance must block at least some incoming Bleed applies once HP drops at or below 50%: with={with_bleed}, without={without_bleed}"
    );
}
