//! Reference: compare_aerial_dodge
//!
//! Each test body starts with the [REF:compare_aerial_dodge] marker so the
//! vitest coverage gate (src/pages/referenceCoverage.test.ts) sees it.
//!
//! Engine path: `composable/mod.rs::aerial_dodge_incoming_lands` decides whether
//! an incoming bite / breath tick lands on a flier. It is gated at both bite
//! sides in `phases/melee.rs` (dodge => the swing whiffs and advances one
//! normal cooldown) and in `breath.rs::fire_breath_damage`.

use super::default_combatant;
use crate::composable::side::CombatSide;
use crate::composable::{aerial_dodge_incoming_lands, AerialDodgeChannel};
use crate::contracts::{CreatureIdentity, SimpleCombatantStats, SimpleStatusInstance};

fn aerial_stats(hit_chance_pct: f64) -> SimpleCombatantStats {
    let mut s = default_combatant();
    s.identity = Some(CreatureIdentity {
        is_aerial: true,
        ..Default::default()
    });
    s.aerial_dodge_hit_chance_pct = hit_chance_pct;
    s
}

fn active_side(stats: &SimpleCombatantStats) -> CombatSide {
    let mut side = CombatSide::new(stats, None);
    side.aerial_dodge_active = true;
    side
}

fn shredded_wings() -> SimpleStatusInstance {
    SimpleStatusInstance {
        stacks: 1.0,
        next_tick_at: None,
        next_decay_at: None,
        remaining_sec: 100.0,
        stack_value_mode: None,
        lich_mark_owned_stacks: None,
        no_decay: false,
        resolved_scalars: None,
    }
}

#[test]
fn rule_off_always_lands_and_never_rolls() {
    // [REF:compare_aerial_dodge]
    // Inactive rule never dodges (byte-identical default: no roll, no state).
    let stats = aerial_stats(25.0);
    let mut side = CombatSide::new(&stats, None); // aerial_dodge_active = false
    for _ in 0..8 {
        assert!(aerial_dodge_incoming_lands(
            &stats,
            &mut side,
            AerialDodgeChannel::Bite
        ));
    }
    assert_eq!(side.aerial_dodge_acc_bite, 0.0);
}

#[test]
fn non_aerial_is_always_hit() {
    // [REF:compare_aerial_dodge]
    // "A grounded (non-aerial) creature is always hit."
    let mut stats = default_combatant();
    stats.aerial_dodge_hit_chance_pct = 25.0;
    let mut side = active_side(&stats);
    for _ in 0..8 {
        assert!(aerial_dodge_incoming_lands(
            &stats,
            &mut side,
            AerialDodgeChannel::Bite
        ));
    }
}

#[test]
fn even_pattern_lands_two_of_eight_at_25_pct() {
    // [REF:compare_aerial_dodge]
    // Even pattern: a flier at 25% lands exactly 2 of every 8 bites, evenly.
    let stats = aerial_stats(25.0);
    let mut side = active_side(&stats);
    let lands = (0..8)
        .filter(|_| aerial_dodge_incoming_lands(&stats, &mut side, AerialDodgeChannel::Bite))
        .count();
    assert_eq!(lands, 2, "25% even pattern lands 2 of 8: got {lands}");
}

#[test]
fn full_chance_always_lands_zero_never() {
    // [REF:compare_aerial_dodge]
    let hit = aerial_stats(100.0);
    let mut a = active_side(&hit);
    assert!(aerial_dodge_incoming_lands(&hit, &mut a, AerialDodgeChannel::Bite));

    let miss = aerial_stats(0.0);
    let mut b = active_side(&miss);
    assert!(!aerial_dodge_incoming_lands(&miss, &mut b, AerialDodgeChannel::Bite));
}

#[test]
fn shredded_wings_removes_the_dodge() {
    // [REF:compare_aerial_dodge]
    // "A creature with Shredded Wings can no longer dodge."
    let stats = aerial_stats(0.0); // would otherwise dodge everything
    let mut side = active_side(&stats);
    side.statuses.insert("Shredded_Wings".to_string(), shredded_wings());
    assert!(aerial_dodge_incoming_lands(
        &stats,
        &mut side,
        AerialDodgeChannel::Bite
    ));
}

#[test]
fn bite_and_breath_use_independent_accumulators() {
    // [REF:compare_aerial_dodge]
    // Separate channels so frequent breath ticks don't starve bite dodging.
    let stats = aerial_stats(25.0);
    let mut side = active_side(&stats);
    // Three bites accumulate 0.75 on the bite channel (none land yet)...
    assert!(!aerial_dodge_incoming_lands(&stats, &mut side, AerialDodgeChannel::Bite));
    assert!(!aerial_dodge_incoming_lands(&stats, &mut side, AerialDodgeChannel::Bite));
    assert!(!aerial_dodge_incoming_lands(&stats, &mut side, AerialDodgeChannel::Bite));
    // ...a breath tick draws from its own accumulator (also a miss)...
    assert!(!aerial_dodge_incoming_lands(&stats, &mut side, AerialDodgeChannel::Breath));
    // ...and the 4th bite crosses 1.0 and lands, unaffected by the breath tick.
    assert!(aerial_dodge_incoming_lands(&stats, &mut side, AerialDodgeChannel::Bite));
}

#[test]
fn real_random_replays_for_a_fixed_seed_and_varies_by_seed() {
    // [REF:compare_aerial_dodge]
    // Real random varies with the seed but replays byte-identically for a
    // fixed seed, so a Compare/Sandbox run is reproducible given its seed.
    let stats = aerial_stats(50.0);
    let seq = |seed: u64| -> Vec<bool> {
        let mut side = CombatSide::new(&stats, None);
        side.aerial_dodge_active = true;
        side.aerial_dodge_real_random = true;
        side.aerial_dodge_rng = seed;
        (0..16)
            .map(|_| aerial_dodge_incoming_lands(&stats, &mut side, AerialDodgeChannel::Bite))
            .collect()
    };
    assert_eq!(seq(42), seq(42), "same seed replays identically");
    assert_ne!(seq(1), seq(2), "different seeds diverge");
}
