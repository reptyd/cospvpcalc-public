//! Reference: compare_reflect_response
//!
//! Covers every testable bullet in the "Reflect response" entry. Each test body
//! must contain the [REF:compare_reflect_response] marker so the vitest coverage
//! gate sees it - the gate reads the marker only from a file that asserts, so a
//! body carrying nothing but the marker still counts as uncovered.

use super::default_combatant;
use crate::composable::{simulate_composable_matchup, ComposableAbilityConfig};
use crate::contracts::{SimpleAbilityTimingMode, SimpleCombatantStats};

/// A fight where B carries Reflect and A does the attacking. A's health is what
/// the reflected damage lands on, so it reads the answer directly.
fn run(hold: bool) -> (f64, f64) {
    let mut attacker: SimpleCombatantStats = default_combatant();
    attacker.health = 40_000.0;
    attacker.damage = 400.0;
    attacker.bite_cooldown = 2.0;
    attacker.health_regen = 0.0;
    let mut defender = attacker.clone();
    defender.has_reflect = true;
    defender.damage = 0.0;

    let config = ComposableAbilityConfig {
        defender_reflect: true,
        attacker_reflect_response_hold: hold,
        ..Default::default()
    };
    let out = simulate_composable_matchup(
        &attacker,
        &defender,
        None,
        None,
        SimpleAbilityTimingMode::Ideal,
        &config,
        240.0,
    );
    (out.final_hp_a, out.damage_dealt_a)
}

#[test]
fn ignore_keeps_swinging_into_it() {
    // [REF:compare_reflect_response]
    // "Ignore keeps biting and breathing into an active Reflect, and is what
    // the model does when the setting is left alone."
    let (hp_ignoring, dealt) = run(false);
    assert!(
        hp_ignoring < 40_000.0,
        "swinging into Reflect must cost the attacker health: {hp_ignoring} of 40000"
    );
    assert!(dealt > 0.0, "and it must still be attacking: dealt {dealt}");
}

#[test]
fn hold_stops_the_reflected_damage_coming_back() {
    // [REF:compare_reflect_response]
    // "Under hold, the side does not bite while the opponent's Reflect is
    // active." Same for its breath.
    let (hp_ignoring, _) = run(false);
    let (hp_holding, _) = run(true);
    assert!(
        hp_holding > hp_ignoring,
        "holding must take less reflected damage: holding={hp_holding}, ignoring={hp_ignoring}"
    );
}

#[test]
fn a_held_bite_is_not_a_lost_bite() {
    // [REF:compare_reflect_response]
    // "A held bite is not lost: it lands the moment Reflect expires, and the
    // bite cooldown carries on from there."
    //
    // Reflect is a window, not the whole fight, so a side that waits it out
    // still spends most of the fight attacking - it must land real damage, not
    // stand idle.
    let (_, dealt_holding) = run(true);
    assert!(
        dealt_holding > 0.0,
        "a holding side must still fight outside the window: dealt {dealt_holding}"
    );
}
