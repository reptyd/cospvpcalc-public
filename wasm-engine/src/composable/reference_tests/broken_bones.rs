//! Reference: status_broken_bones
//!
//! The entry claims the site only records that the effect is present
//! and that it produces no separate combat effect of its own. That is
//! a claim about the engine, so it is read the only way it can be:
//! run the fight with the stacks and without them and demand the same
//! result.
//!
//! "Of its own" is the whole of it. Broken Bones is still a negative
//! ailment (`posture::is_negative_ailment`), so a fight that cleanses
//! or strips ailments does see it - through Fortify's removable count
//! or a posture strip, never through a stat or a tick. The runs below
//! carry neither, which is the plain stand-and-fight case the entry
//! describes.

use super::super::config::ComposableAbilityConfig;
use super::super::simulate_composable_matchup;
use super::default_combatant;
use crate::contracts::{
    BestBuildsMatchupSummary, SimpleAbilityTimingMode, SimpleAppliedStatus, SimpleCombatantStats,
};

fn stacked(stacks: f64) -> Vec<SimpleAppliedStatus> {
    vec![SimpleAppliedStatus {
        status_id: "Broken_Bones_Status".to_string(),
        stacks,
        ..Default::default()
    }]
}

fn run(a: &SimpleCombatantStats, b: &SimpleCombatantStats) -> BestBuildsMatchupSummary {
    simulate_composable_matchup(
        a,
        b,
        None,
        None,
        SimpleAbilityTimingMode::Ideal,
        &ComposableAbilityConfig::default(),
        300.0,
    )
}

fn same_fight(left: &BestBuildsMatchupSummary, right: &BestBuildsMatchupSummary, what: &str) {
    assert_eq!(left.winner, right.winner, "{what}: winner moved");
    for (name, l, r) in [
        ("ttk A→B", left.ttk_a_to_b, right.ttk_a_to_b),
        ("ttk B→A", left.ttk_b_to_a, right.ttk_b_to_a),
        ("final HP A", left.final_hp_a, right.final_hp_a),
        ("final HP B", left.final_hp_b, right.final_hp_b),
        ("damage dealt A", left.damage_dealt_a, right.damage_dealt_a),
        ("damage dealt B", left.damage_dealt_b, right.damage_dealt_b),
    ] {
        assert!(
            (l - r).abs() < 1e-9,
            "{what}: {name} moved, {l} against {r}",
        );
    }
}

#[test]
fn carrying_the_stacks_changes_no_combat_outcome() {
    // [REF:status_broken_bones]
    let bare_a = default_combatant();
    let mut bare_b = default_combatant();
    // Asymmetric, so the fight resolves rather than running to the cap with
    // both sides identical - a draw would look the same whatever a status did.
    bare_b.health = 1_400.0;
    bare_b.damage = 38.0;
    let baseline = run(&bare_a, &bare_b);
    assert!(
        baseline.ttk_a_to_b > 1.0 && baseline.ttk_a_to_b < 299.0,
        "the baseline has to be a decided fight, got ttk {}",
        baseline.ttk_a_to_b,
    );

    for stacks in [1.0, 8.0, 40.0] {
        let mut afflicted_a = bare_a.clone();
        afflicted_a.starting_statuses = stacked(stacks);
        same_fight(
            &run(&afflicted_a, &bare_b),
            &baseline,
            &format!("{stacks} stacks on the attacker"),
        );

        let mut afflicted_b = bare_b.clone();
        afflicted_b.starting_statuses = stacked(stacks);
        same_fight(
            &run(&bare_a, &afflicted_b),
            &baseline,
            &format!("{stacks} stacks on the defender"),
        );
    }
}

#[test]
fn is_recorded_rather_than_dropped() {
    // [REF:status_broken_bones]
    // "The site currently only records that this effect is present." The
    // fight above would also pass if the engine threw the status away on
    // sight, so the record itself is asserted here.
    assert_eq!(
        crate::effects_registry::category("Broken_Bones_Status"),
        Some(crate::effects_registry::Category::NeutralMarker),
    );
    assert!(crate::statuses::is_fortify_removable_status(
        "Broken_Bones_Status"
    ));
}
