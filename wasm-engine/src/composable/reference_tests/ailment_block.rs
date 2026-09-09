//! Reference: how the three block channels decide how many stacks land.
//!
//! The entry is the one place the composition is written down; every plushie
//! that carries a block states its own number and nothing else. So the checks
//! here are on the arithmetic itself - stacks in, stacks out - rather than on
//! any one plushie's figure.

use std::collections::BTreeMap;

use super::{applied_status, default_combatant};
use crate::contracts::{SimpleCombatantStats, SimpleStatusInstance};
use crate::statuses::apply_incoming_statuses_to_target;

const BLEED: &str = "Bleed_Status";

/// Applies `stacks` of Bleed to a creature carrying the given fractions and
/// reports how many stacks it ends up with.
fn landed(stacks: f64, native: f64, plushie: f64, elder: f64) -> f64 {
    let mut target = default_combatant();
    apply_fractions(&mut target, native, plushie, elder);
    let mut statuses: BTreeMap<String, SimpleStatusInstance> = BTreeMap::new();
    apply_incoming_statuses_to_target(
        0.0,
        &target,
        target.health,
        &mut statuses,
        &[applied_status(BLEED, stacks)],
    );
    statuses.get(BLEED).map(|s| s.stacks).unwrap_or(0.0)
}

fn apply_fractions(target: &mut SimpleCombatantStats, native: f64, plushie: f64, elder: f64) {
    if native != 0.0 {
        target
            .status_resist_fractions
            .insert(BLEED.to_string(), native);
    }
    if plushie != 0.0 {
        target
            .plushie_status_block_fractions
            .insert(BLEED.to_string(), plushie);
    }
    target.elder_block_fraction = elder;
}

#[test]
fn a_block_scales_the_stacks_that_land() {
    // [REF:status_ailment_block] "A block is a fraction of the incoming stacks"
    assert!((landed(8.0, 0.0, 0.0, 0.0) - 8.0).abs() < 1e-9);
    assert!((landed(8.0, 0.25, 0.0, 0.0) - 6.0).abs() < 1e-9);
}

#[test]
fn the_three_positive_channels_add_and_cap_at_one() {
    // [REF:status_ailment_block] "added together and capped at 1"
    let added = landed(10.0, 0.2, 0.3, 0.1);
    assert!(
        (added - 4.0).abs() < 1e-9,
        "0.2 + 0.3 + 0.1 must block 60% of the stacks, not compose multiplicatively; got {added}"
    );

    let capped = landed(10.0, 0.5, 0.5, 0.5);
    assert!(
        capped.abs() < 1e-9,
        "a total at or past 1 must land nothing; got {capped}"
    );
}

#[test]
fn a_negative_fraction_multiplies_the_stacks_up() {
    // [REF:status_ailment_block] "multiplies the incoming stacks by 1 plus its own weakness"
    let native_weak = landed(10.0, -0.2, 0.0, 0.0);
    assert!((native_weak - 12.0).abs() < 1e-9, "got {native_weak}");

    let plushie_weak = landed(10.0, 0.0, -0.2, 0.0);
    assert!((plushie_weak - 12.0).abs() < 1e-9, "got {plushie_weak}");

    // Two weaknesses compound rather than add: 1.2 x 1.5, not 1 + 0.2 + 0.5.
    let both = landed(10.0, -0.2, -0.5, 0.0);
    assert!((both - 18.0).abs() < 1e-9, "got {both}");
}

#[test]
fn a_weakness_and_a_block_on_different_channels_both_apply() {
    // [REF:status_ailment_block] the split is per channel, so a plushie
    // weakness cannot be swallowed by an unrelated native block.
    let mixed = landed(10.0, 0.25, -0.2, 0.0);
    assert!(
        (mixed - 9.0).abs() < 1e-9,
        "10 x 1.2 weakness x 0.75 block = 9; got {mixed}"
    );
}

#[test]
fn healing_ignores_every_channel() {
    // [REF:status_ailment_block] "A negative stack count is neither blocked nor amplified."
    let mut blocked = default_combatant();
    let mut statuses: BTreeMap<String, SimpleStatusInstance> = BTreeMap::new();
    apply_incoming_statuses_to_target(
        0.0,
        &blocked,
        blocked.health,
        &mut statuses,
        &[applied_status(BLEED, 10.0)],
    );
    apply_fractions(&mut blocked, 0.5, 0.5, 0.5);
    apply_incoming_statuses_to_target(
        0.0,
        &blocked,
        blocked.health,
        &mut statuses,
        &[applied_status(BLEED, -4.0)],
    );
    let left = statuses.get(BLEED).map(|s| s.stacks).unwrap_or(0.0);
    assert!(
        (left - 6.0).abs() < 1e-9,
        "a full block must not blunt a cleanse of 4 stacks; got {left}"
    );
}

#[test]
fn a_block_on_one_ailment_leaves_another_alone() {
    // [REF:status_ailment_block] "A weakness on one ailment never touches another"
    let mut target = default_combatant();
    target
        .plushie_status_block_fractions
        .insert(BLEED.to_string(), -0.5);
    let mut statuses: BTreeMap<String, SimpleStatusInstance> = BTreeMap::new();
    apply_incoming_statuses_to_target(
        0.0,
        &target,
        target.health,
        &mut statuses,
        &[applied_status("Burn_Status", 10.0)],
    );
    let burn = statuses.get("Burn_Status").map(|s| s.stacks).unwrap_or(0.0);
    assert!(
        (burn - 10.0).abs() < 1e-9,
        "a Bleed weakness must not reach Burn; got {burn}"
    );
}
