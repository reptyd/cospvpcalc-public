//! Reference: ability_fortify
//!
//! Covers each testable bullet in the "Fortify" entry. Each test body
//! starts with the [REF:ability_fortify] marker so the vitest coverage
//! gate (src/pages/referenceCoverage.test.ts) sees it.
//!
//! The full removable-status list (Bleed, Burn, Corrosion, ..., Radiation)
//! and the policy heuristics (15-stack threshold for ReallyFast, etc.)
//! are exercised by the broader composable::tests::*_fortify_* suite.
//! These tests focus on the core timing and weight-bonus invariants.

use super::super::config::ComposableAbilityConfig;
use super::super::simulate_composable_matchup_with_trace;
use super::default_combatant;
use crate::active_runtime::with_active_weight_bonuses;
use crate::contracts::{SimpleAbilityTimingMode, SimpleAppliedStatus, SimpleCombatantStats};
use crate::spec_constants::FORTIFY_COOLDOWN_SEC;

fn fortify_attacker_config() -> ComposableAbilityConfig {
    let mut cfg = ComposableAbilityConfig::default();
    cfg.attacker_fortify = true;
    cfg
}

fn passive_combatant(max_hp: f64) -> SimpleCombatantStats {
    let mut c = default_combatant();
    c.health = max_hp;
    c.damage = 0.0;
    c.bite_cooldown = 1000.0;
    c
}

fn fortify_activation_times(
    attacker: &SimpleCombatantStats,
    defender: &SimpleCombatantStats,
    cfg: &ComposableAbilityConfig,
    max_time_sec: f64,
) -> Vec<f64> {
    let result = simulate_composable_matchup_with_trace(
        attacker,
        defender,
        None,
        None,
        SimpleAbilityTimingMode::ReallyFast,
        cfg,
        max_time_sec,
        true,
    );
    let log = result.combat_log.expect("trace log requested");
    log.iter()
        .filter(|e| {
            e.entry_type == "ability"
                && e.attacker == "A"
                && e.description.as_deref() == Some("Fortify activated")
        })
        .map(|e| e.time)
        .collect()
}

#[test]
fn fires_after_the_opening_hold_with_severe_starting_status() {
    // [REF:ability_fortify]
    // Attacker carries 20 Bleed stacks (>= 15 ReallyFast threshold), but
    // ReallyFast holds the opening cast until 8 s regardless.
    let mut attacker = passive_combatant(1_000.0);
    attacker.starting_statuses = vec![SimpleAppliedStatus {
        status_id: "Bleed_Status".to_string(),
        stacks: 20.0,
        ..Default::default()
    }];
    let defender = passive_combatant(10_000.0);
    let activations = fortify_activation_times(&attacker, &defender, &fortify_attacker_config(), 10.0);
    let first = *activations
        .first()
        .expect("Fortify must activate once the opening hold elapses");
    assert!(
        (8.0..10.0).contains(&first),
        "first Fortify activation must land on the first active-ability event at or          after the 8 s opening hold, got {first}"
    );
}

#[test]
fn cooldown_ninety_seconds() {
    // [REF:ability_fortify]
    // Steady damage keeps re-applying Bleed via on-hit; Fortify fires once,
    // cleanses, then the second activation is gated by the 90 s cooldown.
    let mut attacker = passive_combatant(10_000.0);
    attacker.starting_statuses = vec![SimpleAppliedStatus {
        status_id: "Bleed_Status".to_string(),
        stacks: 20.0,
        ..Default::default()
    }];
    let mut defender = passive_combatant(1_000_000.0);
    defender.damage = 1.0;
    defender.bite_cooldown = 0.5;
    defender.on_hit_statuses = vec![SimpleAppliedStatus {
        status_id: "Bleed_Status".to_string(),
        stacks: 1.0,
        ..Default::default()
    }];
    let activations = fortify_activation_times(&attacker, &defender, &fortify_attacker_config(), 200.0);
    assert!(
        activations.len() >= 2,
        "Fortify must fire at least twice in a 200 s window: {activations:?}"
    );
    let gap = activations[1] - activations[0];
    assert!(
        (gap - FORTIFY_COOLDOWN_SEC).abs() < 1.0,
        "second Fortify activation must be ~{FORTIFY_COOLDOWN_SEC} s after the first, got {gap}: {activations:?}"
    );
}

#[test]
fn precision_modes_fire_under_sustained_dot_pressure() {
    // [REF:ability_fortify]
    // Regression: the candidate-search modes must actually fire Fortify
    // while the opponent keeps re-applying a DoT. The stack-pressure
    // projection credited the stacks that would pile up during a wait
    // but never charged the DoT the actor suffers getting there, so the
    // utility curve rose monotonically with the delay - the search
    // perpetually chose "wait a little longer" and Fortify never fired
    // in SemiIdeal / Ideal / Extreme. (ReallyFast is gate-based and was
    // unaffected.) A Feared-only actor still fired because Fear carries
    // no DoT, so this specifically pins the DoT-pressure path.
    let mut attacker = passive_combatant(1_000_000.0);
    attacker.damage = 50.0;
    attacker.bite_cooldown = 2.0;
    let mut defender = passive_combatant(1_000_000.0);
    defender.damage = 1.0;
    defender.bite_cooldown = 1.0;
    defender.on_hit_statuses = vec![SimpleAppliedStatus {
        status_id: "Bleed_Status".to_string(),
        stacks: 3.0,
        ..Default::default()
    }];
    for mode in [
        SimpleAbilityTimingMode::SemiIdeal,
        SimpleAbilityTimingMode::Ideal,
        SimpleAbilityTimingMode::Extreme,
    ] {
        let result = simulate_composable_matchup_with_trace(
            &attacker,
            &defender,
            None,
            None,
            mode,
            &fortify_attacker_config(),
            120.0,
            true,
        );
        let log = result.combat_log.expect("trace log requested");
        assert!(
            log.iter().any(|e| e.entry_type == "ability"
                && e.attacker == "A"
                && e.description.as_deref() == Some("Fortify activated")),
            "Fortify must fire under sustained Bleed in {mode:?}, but never activated"
        );
        // The cleanse must leave a trace so the Compare status timeline can
        // close the debuff interval - a silent strip left the charts showing
        // the status as still active after Fortify removed it.
        assert!(
            log.iter().any(|e| e.entry_type == "ability"
                && e.hp_side == "A"
                && e.status_id.as_deref() == Some("Bleed_Status")
                && e.description.as_deref().is_some_and(|d| d.starts_with("Fortify removed "))),
            "Fortify cleanse must emit a 'Fortify removed Bleed' trace entry in {mode:?}"
        );
    }
}

#[test]
fn fear_alone_fires_even_when_weight_cap_zeroes_self_buff() {
    // [REF:ability_fortify]
    // A Feared actor carrying no DoT, whose weight ratio is capped (so the
    // +5% self-buff gain rounds to 0), still has a strong reason to Fortify:
    // Fear's flat -45% outgoing damage. Before Fear was scored the utility
    // collapsed to 0 and the precision search skipped Fortify entirely.
    let mut attacker = passive_combatant(1_000_000.0);
    attacker.damage = 50.0;
    attacker.bite_cooldown = 2.0;
    attacker.weight = 1000.0; // ratio vs 100 = 10 -> capped at 3 -> self-buff 0
    attacker.starting_statuses = vec![SimpleAppliedStatus {
        status_id: "Fear_Status".to_string(),
        stacks: 10.0,
        ..Default::default()
    }];
    let mut defender = passive_combatant(1_000_000.0);
    defender.weight = 100.0;
    for mode in [
        SimpleAbilityTimingMode::SemiIdeal,
        SimpleAbilityTimingMode::Ideal,
        SimpleAbilityTimingMode::Extreme,
    ] {
        let result = simulate_composable_matchup_with_trace(
            &attacker,
            &defender,
            None,
            None,
            mode,
            &fortify_attacker_config(),
            30.0,
            true,
        );
        let log = result.combat_log.expect("trace log requested");
        assert!(
            log.iter().any(|e| e.entry_type == "ability"
                && e.attacker == "A"
                && e.description.as_deref() == Some("Fortify activated")),
            "Fortify must fire against a Fear-only pile in {mode:?} (Fear scores via its outgoing penalty)"
        );
    }
}

#[test]
fn high_hp_fear_pile_fires_despite_trickle_dot() {
    // [REF:ability_fortify]
    // Regression (Goreganthus vs Turrim): a high-HP creature that is Feared by
    // the opponent, with only a trickle of DoT landing, must still Fortify
    // promptly. Fear's -45% outgoing is a delay-flat credit; on a big HP pool
    // the DoT terms are tiny, so the candidate search preferred "wait a little
    // longer" every tick and Fortify never fired. Charging the wait for the
    // outgoing damage Fear suppresses restores prompt firing.
    let mut attacker = passive_combatant(500_000.0);
    attacker.damage = 300.0;
    attacker.bite_cooldown = 1.3;
    attacker.weight = 44_900.0;
    attacker.starting_statuses = vec![SimpleAppliedStatus {
        status_id: "Fear_Status".to_string(),
        stacks: 10.0,
        ..Default::default()
    }];
    let mut defender = passive_combatant(500_000.0);
    defender.weight = 10_400.0;
    defender.damage = 300.0;
    defender.bite_cooldown = 1.3;
    defender.on_hit_statuses = vec![SimpleAppliedStatus {
        status_id: "Bleed_Status".to_string(),
        stacks: 1.0,
        ..Default::default()
    }];
    for mode in [
        SimpleAbilityTimingMode::SemiIdeal,
        SimpleAbilityTimingMode::Ideal,
        SimpleAbilityTimingMode::Extreme,
    ] {
        let result = simulate_composable_matchup_with_trace(
            &attacker,
            &defender,
            None,
            None,
            mode,
            &fortify_attacker_config(),
            60.0,
            true,
        );
        let log = result.combat_log.expect("trace log requested");
        let first = log
            .iter()
            .find(|e| e.entry_type == "ability"
                && e.attacker == "A"
                && e.description.as_deref() == Some("Fortify activated"))
            .map(|e| e.time);
        // Must fire, and fire while the Fear pile is still up (well before its
        // ~30 s decay), not defer forever.
        assert!(
            first.is_some_and(|t| t < 15.0),
            "Fortify must fire promptly against a Fear pile on a high-HP creature in {mode:?}, got {first:?}"
        );
    }
}

#[test]
fn weight_bonus_is_five_percent_during_immunity_window() {
    // [REF:ability_fortify]
    // active_runtime::with_active_weight_bonuses returns the stats with
    // weight x 1.05 while time < fortify_weight_bonus_until.
    let attacker = passive_combatant(1_000.0);
    let original_weight = attacker.weight;
    let fortify_weight_bonus_until = 9.0;
    let inside = with_active_weight_bonuses(&attacker, fortify_weight_bonus_until, 0.0, 0.0, 0.0);
    let outside = with_active_weight_bonuses(&attacker, fortify_weight_bonus_until, 0.0, 0.0, 10.0);
    assert!(
        (inside.weight - original_weight * 1.05).abs() < 1e-9,
        "Fortify weight bonus must be 5% during immunity window: expected {}, got {}",
        original_weight * 1.05,
        inside.weight
    );
    assert!(
        (outside.weight - original_weight).abs() < 1e-9,
        "Fortify weight bonus must clear after the 9 s window: expected {original_weight}, got {}",
        outside.weight
    );
}
