//! Reference: plushie_oceanwing
//!
//! Oceanwing strengthens Muddy rather than granting anything of its own. The
//! game holds that on the ailment (`DATA_AilmentData.Muddy.OnGet` walks the
//! wearer's plushies and lifts the 1.25 multiplier by 0.125 per copy), so the
//! engine carries it as a per-side scalar on the stats and folds it into the
//! regen multiplier in `effective_hp_regen_multiplier`.

use crate::combat::effective_hp_regen_multiplier;
use crate::contracts::{SimpleCombatantStats, SimpleStatusInstance};
use std::collections::BTreeMap;

use super::default_combatant;

/// One Oceanwing adds 50% of Muddy's own bonus, two add 100%.
const BOOST_PCT_PER_COPY: f64 = 50.0;

fn wearer(boost_pct: f64) -> SimpleCombatantStats {
    let mut stats = default_combatant();
    stats.health = 1_000.0;
    stats.health_regen = 5.0;
    stats.quick_recovery_hp_ratio_threshold = 0.0;
    stats.muddy_strength_boost_pct = boost_pct;
    stats
}

fn muddy() -> BTreeMap<String, SimpleStatusInstance> {
    let mut statuses = BTreeMap::new();
    statuses.insert(
        "Muddy_Status".to_string(),
        SimpleStatusInstance {
            stacks: 1.0,
            next_tick_at: None,
            next_decay_at: None,
            remaining_sec: 90.0,
            stack_value_mode: None,
            lich_mark_owned_stacks: None,
            no_decay: false,
            resolved_scalars: None,
        },
    );
    statuses
}

#[test]
fn one_copy_lifts_muddy_to_thirty_seven_and_a_half_percent() {
    // [REF:plushie_oceanwing]
    let stats = wearer(BOOST_PCT_PER_COPY);
    let multiplier = effective_hp_regen_multiplier(&stats, stats.health, &muddy());
    assert!(
        (multiplier - 1.375).abs() < 1e-9,
        "one Oceanwing must take Muddy's 1.25 to 1.375: got {multiplier}"
    );
}

#[test]
fn a_second_copy_lifts_it_again() {
    // [REF:plushie_oceanwing]
    // The game's loop runs once per plushie it finds, so two copies are not
    // the same as one.
    let stats = wearer(BOOST_PCT_PER_COPY * 2.0);
    let multiplier = effective_hp_regen_multiplier(&stats, stats.health, &muddy());
    assert!(
        (multiplier - 1.5).abs() < 1e-9,
        "two Oceanwings must take Muddy's 1.25 to 1.5: got {multiplier}"
    );
}

#[test]
fn it_does_nothing_without_muddy() {
    // [REF:plushie_oceanwing]
    let stats = wearer(BOOST_PCT_PER_COPY);
    let bare = BTreeMap::new();
    let multiplier = effective_hp_regen_multiplier(&stats, stats.health, &bare);
    assert_eq!(
        multiplier.to_bits(),
        effective_hp_regen_multiplier(&wearer(0.0), stats.health, &bare).to_bits(),
        "Oceanwing has nothing to lift while Muddy is absent"
    );
}

#[test]
fn it_composes_with_the_other_regen_statuses() {
    // [REF:plushie_oceanwing]
    // The lift applies to Muddy alone; Clean Water's +20% stays untouched
    // beside it. 1.375 * 1.20 = 1.65.
    let stats = wearer(BOOST_PCT_PER_COPY);
    let mut statuses = muddy();
    statuses.insert(
        "Clean_Water_Status".to_string(),
        statuses.get("Muddy_Status").expect("muddy seeded").clone(),
    );
    let multiplier = effective_hp_regen_multiplier(&stats, stats.health, &statuses);
    assert!(
        (multiplier - 1.375 * 1.20).abs() < 1e-9,
        "Oceanwing must lift Muddy only: got {multiplier}"
    );
}
