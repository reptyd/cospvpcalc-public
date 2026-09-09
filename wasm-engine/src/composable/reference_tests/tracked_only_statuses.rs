//! Reference: the statuses the model tracks without giving them a combat effect.
//!
//! Thirteen entries make the same pair of claims - the model records the effect as
//! present, and it produces no separate combat effect - so they are checked
//! together rather than in thirteen near-identical files. Each entry's marker sits in
//! a body that asserts both claims for that id.
//!
//! Presence takes two things, because the timeline alone does not distinguish a
//! status the engine knows from a name nobody has ever heard: any id handed to
//! `apply_simple_status` decays on the default schedule and logs while it does.
//! So the status must also be one the registry answers for - that is what makes
//! cleanse, the stack rule and the decay interval read from the catalog rather
//! than fall back. The control at the bottom pins the difference.
//!
//! Absence of a combat effect is the stronger half - the whole fight has to come
//! out identical to the same fight without the status.

use super::super::config::ComposableAbilityConfig;
use super::super::{simulate_composable_matchup, simulate_composable_matchup_with_trace};
use super::{applied_status, default_combatant};
use crate::contracts::{SimpleAbilityTimingMode, SimpleCombatantStats};

/// Engine ids for the entries under test, paired with the entry each belongs to.
const TRACKED_ONLY: &[(&str, &str)] = &[
    ("status_blurred_vision", "Blurred_Vision_Status"),
    ("status_confusion", "Confusion_Status"),
    ("status_flowering", "Flowering_Status"),
    ("status_freeze", "Freeze_Status"),
    ("status_gale", "Water_Gale_Status"),
    ("status_shock", "Shock_Status"),
    ("status_slowed", "Slow_Status"),
    ("status_stolen_speed", "Stolen_Speed_Status"),
    ("status_tunnel_vision", "Tunnel_Vision_Status"),
    ("status_water_regeneration", "Water_Regeneration_Status"),
    ("status_injury", "Injury_Status"),
    ("status_torn_ligaments", "Torn_Ligaments_Status"),
    ("ability_sticky_trap", "Sticky_Trap_Status"),
];

/// Regen is on so a status that touched healing would show as readily as one
/// that dealt damage.
fn combatant() -> SimpleCombatantStats {
    let mut c = default_combatant();
    c.health = 4_000.0;
    c.damage = 120.0;
    c.bite_cooldown = 1.5;
    c.health_regen = 6.0;
    c
}

/// Does the engine carry this status as a status, rather than as an unknown
/// name that happens to decay?
fn is_tracked(status_id: &str) -> bool {
    crate::effects_registry::polarity(status_id).is_some() && leaves_a_trace(status_id)
}

/// Does the timeline show the status on the creature through the fight?
fn leaves_a_trace(status_id: &str) -> bool {
    let attacker = combatant();
    let mut defender = combatant();
    defender.starting_statuses = vec![applied_status(status_id, 4.0)];
    let result = simulate_composable_matchup_with_trace(
        &attacker, &defender, None, None,
        SimpleAbilityTimingMode::ReallyFast,
        &ComposableAbilityConfig::default(),
        120.0, true,
    );
    result
        .combat_log
        .expect("trace")
        .iter()
        .any(|e| e.status_id.as_deref() == Some(status_id))
}

/// Where both sides stand at the end, with and without the status on the
/// defender. The horizon stops well short of either death, so each HP total is
/// an exact running sum: a status shaving a single point shows up, where a
/// winner-and-death-time comparison would swallow anything under one bite.
/// Calibrated against Poison and Bleed, which move it by 44 and by 12.
fn hp_with_and_without(status_id: &str) -> ((f64, f64), (f64, f64)) {
    let attacker = combatant();
    let bare = combatant();
    let mut afflicted = combatant();
    afflicted.starting_statuses = vec![applied_status(status_id, 4.0)];

    let run = |defender: &SimpleCombatantStats| {
        let r = simulate_composable_matchup(
            &attacker, defender, None, None,
            SimpleAbilityTimingMode::ReallyFast,
            &ComposableAbilityConfig::default(),
            20.0,
        );
        (r.final_hp_a, r.final_hp_b)
    };
    (run(&afflicted), run(&bare))
}

#[test]
fn each_tracked_only_status_is_recorded_on_the_creature_it_lands_on() {
    // [REF:status_blurred_vision] [REF:status_confusion] [REF:status_flowering]
    // [REF:status_freeze] [REF:status_gale] [REF:status_shock] [REF:status_slowed]
    // [REF:status_stolen_speed] [REF:status_tunnel_vision]
    // [REF:status_water_regeneration] [REF:status_injury]
    // [REF:status_torn_ligaments] [REF:ability_sticky_trap]
    // Bullet 1 of each entry: "The model records this status as present on the
    // affected creature ..."
    let missing: Vec<&str> = TRACKED_ONLY
        .iter()
        .filter(|(_, status_id)| !is_tracked(status_id))
        .map(|(entry, _)| *entry)
        .collect();
    assert!(
        missing.is_empty(),
        "the engine does not carry these as statuses: {missing:?}"
    );

    // The control. A name the catalog has never heard still decays and still
    // logs, so the timeline half of the check passes for it - and the check as a
    // whole must not.
    assert!(
        leaves_a_trace("Not_A_Status_Anyone_Registered"),
        "the timeline logs any id, real or not - if it stopped, the check above \
         became a tautology and needs a different signal"
    );
    assert!(!is_tracked("Not_A_Status_Anyone_Registered"));
}

#[test]
fn no_tracked_only_status_changes_how_the_fight_goes() {
    // [REF:status_blurred_vision] [REF:status_confusion] [REF:status_flowering]
    // [REF:status_freeze] [REF:status_gale] [REF:status_shock] [REF:status_slowed]
    // [REF:status_stolen_speed] [REF:status_tunnel_vision]
    // [REF:status_water_regeneration] [REF:status_injury]
    // [REF:status_torn_ligaments] [REF:ability_sticky_trap]
    // Bullet 3 of each entry: "It moves no combat figure, so a fight runs
    // identically without it." Anything one of them touched would move an HP
    // total, so the two fights have to end on the same numbers.
    for (entry, status_id) in TRACKED_ONLY {
        let (afflicted, bare) = hp_with_and_without(status_id);
        assert_eq!(
            afflicted, bare,
            "{entry} changed the fight: with it {afflicted:?}, without it {bare:?} - \
             the entry says it produces no combat effect, so either the entry or the \
             engine has moved"
        );
    }
}

