//! Reference: the two policy entries, `policy_fast` and
//! `policy_semi_ideal_ideal_and_extreme`.
//!
//! Both sat in the coverage baseline on the grounds that what they state is a
//! judgement rather than a mechanic. Most of it is not: the delay ladders are
//! concrete vectors, the ordering claim ("fast cannot choose a delay any
//! deeper mode would reach for") is a comparison between them, and the
//! re-decision cadence is a number the setup reads. The ladders themselves are
//! private to `policy::timing_mode`, so the checks on those live in that
//! module's own test block; what is reachable from here is checked here.

use super::super::setup::hunker_cadence_for;
use crate::contracts::SimpleAbilityTimingMode as Mode;

#[test]
fn the_deeper_modes_reconsider_a_standing_hunker_more_often() {
    // [REF:policy_semi_ideal_ideal_and_extreme] "Hunker ... is re-evaluated
    // every 0.1 seconds under extreme, every 0.25 under ideal, and every 0.5
    // under the rest."
    assert!((hunker_cadence_for(Mode::Extreme) - 0.1).abs() < 1e-12);
    assert!((hunker_cadence_for(Mode::Ideal) - 0.25).abs() < 1e-12);
    for mode in [Mode::SemiIdeal, Mode::Fast, Mode::ReallyFast] {
        assert!(
            (hunker_cadence_for(mode) - 0.5).abs() < 1e-12,
            "{mode:?} must share the half-second cadence, got {}",
            hunker_cadence_for(mode)
        );
    }
}

#[test]
fn the_cadence_is_a_property_of_the_mode_and_nothing_else() {
    // [REF:policy_fast] The entry says fast "carries none of the really fast
    // state rules" but is otherwise one of the modes - and on this axis it is
    // not distinguished from really fast or semi-ideal.
    assert!((hunker_cadence_for(Mode::Fast) - hunker_cadence_for(Mode::ReallyFast)).abs() < 1e-12);
    assert!(hunker_cadence_for(Mode::Fast) > hunker_cadence_for(Mode::Ideal));
}
