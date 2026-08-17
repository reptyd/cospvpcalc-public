//! Reference: status_guardians_seal
//!
//! Covers each testable bullet in the "Guardian's Seal" entry. Each test body
//! starts with the [REF:status_guardians_seal] marker so the vitest coverage
//! gate (src/pages/referenceCoverage.test.ts) sees it.
//!
//! Engine path: `composable/damage_pipeline.rs`. Every site that takes HP off a
//! side calls `resolve_incoming_damage`, which runs the user hooks and then
//! scales what is left by `1 - GUARDIAN_SEAL_DAMAGE_REDUCTION_PCT / 100` for a
//! sealed victim - so one branch covers every damage kind.

use super::super::config::ComposableAbilityConfig;
use super::super::damage_pipeline::GUARDIAN_SEAL_STATUS;
use super::super::simulate_composable_matchup_with_trace;
use super::{applied_status, default_combatant};
use crate::contracts::{SimpleAbilityTimingMode, SimpleCombatantStats};
use crate::spec_constants::{GUARDIAN_SEAL_DAMAGE_REDUCTION_PCT, GUARDIAN_SEAL_MAX_STACKS};

/// What a sealed creature is left taking, as the entry states it.
fn through() -> f64 {
    1.0 - GUARDIAN_SEAL_DAMAGE_REDUCTION_PCT / 100.0
}

fn biter() -> SimpleCombatantStats {
    let mut c = default_combatant();
    c.damage = 100.0;
    c.bite_cooldown = 1.0;
    c
}

/// A target that only ever loses HP to what is under test: no bite of its own,
/// no regen, and a pool deep enough that the fight never ends early.
fn dummy() -> SimpleCombatantStats {
    let mut c = default_combatant();
    c.health = 5_000_000.0;
    c.damage = 0.0;
    c.bite_cooldown = 1_000.0;
    c.health_regen = 0.0;
    c
}

/// HP `defender` lost over `duration` when sealed, and when not.
fn damage_taken_with_and_without_seal(
    attacker: &SimpleCombatantStats,
    defender: &SimpleCombatantStats,
    stacks: f64,
    duration: f64,
) -> (f64, f64) {
    let cfg = ComposableAbilityConfig::default();
    let run = |target: &SimpleCombatantStats| {
        let result = simulate_composable_matchup_with_trace(
            attacker, target, None, None,
            SimpleAbilityTimingMode::ReallyFast,
            &cfg, duration, true,
        );
        target.health - result.final_hp_b.max(0.0)
    };
    let mut sealed = defender.clone();
    sealed
        .starting_statuses
        .push(applied_status(GUARDIAN_SEAL_STATUS, stacks));
    (run(&sealed), run(defender))
}

#[test]
fn cuts_incoming_damage_by_the_share_the_entry_states() {
    // [REF:status_guardians_seal]
    // Bullet 1: "Guardian's Seal reduces incoming damage by 85% while at least
    // one stack is present." Measured over a window short enough that the
    // stacks never run out.
    let attacker = biter();
    let defender = dummy();
    let (sealed, bare) = damage_taken_with_and_without_seal(&attacker, &defender, 3.0, 6.0);

    assert!(bare > 0.0, "the control must actually be bitten: took {bare}");
    assert!(
        (sealed - bare * through()).abs() < 1e-6,
        "a sealed creature must take {}x what it otherwise would: {sealed} against {bare}",
        through()
    );
}

#[test]
fn one_stack_cuts_as_deeply_as_three() {
    // [REF:status_guardians_seal]
    // Bullet 2: "Stacks set how long the seal lasts and not how deep it goes:
    // the reduction is 85% at one stack and at three."
    let attacker = biter();
    let defender = dummy();
    let (one_stack, bare) = damage_taken_with_and_without_seal(&attacker, &defender, 1.0, 2.5);
    let (three_stacks, _) = damage_taken_with_and_without_seal(&attacker, &defender, 3.0, 2.5);

    assert!(bare > 0.0, "the control must actually be bitten: took {bare}");
    assert!(
        (one_stack - three_stacks).abs() < 1e-6,
        "one stack must cut as deeply as three: {one_stack} against {three_stacks}"
    );
}

#[test]
fn cuts_damage_over_time_as_well_as_bites() {
    // [REF:status_guardians_seal]
    // Bullet 3: the seal covers every source, not just the bite path. Poison
    // reaches HP through the DOT branch of the pipeline, a separate call site
    // from the melee one.
    let mut attacker = default_combatant();
    attacker.damage = 0.0;
    attacker.bite_cooldown = 1_000.0;

    let mut defender = dummy();
    defender.starting_statuses = vec![applied_status("Poison_Status", 40.0)];

    let (cut, bare) = damage_taken_with_and_without_seal(&attacker, &defender, 3.0, 6.0);

    assert!(bare > 0.0, "the control must actually be poisoned: took {bare}");
    assert!(
        (cut - bare * through()).abs() < 1e-6,
        "Poison must meet the seal like a bite does: {cut} against {bare}"
    );
}

#[test]
fn works_on_what_the_other_reductions_left() {
    // [REF:status_guardians_seal]
    // Bullet 4: "The seal applies last, to the damage every other reduction
    // has already left." A Guilt-style halving lands
    // first; the seal then cuts the halved number, so the two compose rather
    // than the deeper one winning outright.
    let attacker = biter();
    let mut halving = dummy();
    halving.damage_taken_multiplier_on_being_bitten = 0.5;

    let (sealed, halved) = damage_taken_with_and_without_seal(&attacker, &halving, 3.0, 6.0);
    let (_, unreduced) = damage_taken_with_and_without_seal(&attacker, &dummy(), 3.0, 6.0);

    assert!(
        (halved - unreduced * 0.5).abs() < 1e-6,
        "the control must be taking the halved bite: {halved} against {unreduced}"
    );
    assert!(
        (sealed - unreduced * 0.5 * through()).abs() < 1e-6,
        "the seal must cut what the halving left, not the raw bite: {sealed}"
    );
}

#[test]
fn runs_out_after_its_stacks_decay() {
    // [REF:status_guardians_seal]
    // Bullet 5: "Each stack decays on the standard 3 second schedule." A full
    // seal therefore covers 9 seconds and no more, so damage lands in full
    // again in the back half of a window twice that long.
    let attacker = biter();
    let defender = dummy();
    let full_life = GUARDIAN_SEAL_MAX_STACKS * 3.0;

    let (early, bare_early) = damage_taken_with_and_without_seal(
        &attacker, &defender, GUARDIAN_SEAL_MAX_STACKS, full_life - 1.0);
    let (late, bare_late) = damage_taken_with_and_without_seal(
        &attacker, &defender, GUARDIAN_SEAL_MAX_STACKS, full_life * 2.0);

    assert!(
        (early - bare_early * through()).abs() < 1e-6,
        "inside the {full_life} s the stacks buy, everything is cut: {early} against {bare_early}"
    );
    let after = late - early;
    let bare_after = bare_late - bare_early;
    assert!(
        after > bare_after * through() * 1.5,
        "past {full_life} s the seal is gone and damage lands in full again: {after} against \
         {bare_after} unsealed, {} if the seal still held",
        bare_after * through()
    );
}
