//! Property-based tests for the full composable engine
//! (`simulate_composable_matchup`), across a randomized melee input space.
//!
//! The curated `fixture_tests` / `reference_tests` pin named scenarios to
//! exact expected values. The properties here instead assert invariants
//! that must hold for *every* finite-stat melee matchup - the guarantees
//! the entire fixture system silently depends on:
//!
//! 1. **Determinism.** `simulate_composable_matchup` is a pure function of
//!    its inputs: two calls with identical stats/policy/time produce a
//!    byte-identical summary. (No clocks, no RNG, no global mutable state
//!    on the live path.) This is THE load-bearing invariant - every fixture
//!    and every byte-identical regression gate assumes it.
//! 2. **Output sanity.** No summary field is NaN/non-finite, and final HP
//!    stays within `[0, max_hp]`. Catches a NaN leak (e.g. a `0/0` slipping
//!    out of a defensive clamp) or an HP-cap regression.
//! 3. **Time bounds.** Death times and TTKs stay within `[0, max_time_sec]`.
//! 4. **Winner consistency.** If exactly one side has a recorded death time,
//!    the winner is the survivor. (Both-died / neither-died outcomes have
//!    nuanced tie/timeout rules and are deliberately not constrained here.)
//!
//! Companion to `policy/tests/properties.rs`, which covers the policy
//! light-projector; this file covers the event-loop engine itself. Melee
//! only (no breath, default ability config) so the properties exercise the
//! core loop without depending on any one ability's semantics.

use proptest::prelude::*;

use super::reference_tests::default_combatant;
use super::{simulate_composable_matchup, ComposableAbilityConfig};
use crate::contracts::{SimpleAbilityTimingMode, SimpleCombatantStats, Winner};

const EPS: f64 = 1e-6;

// ── Generators ─────────────────────────────────────────────────────

prop_compose! {
    /// A melee combatant built on the shared `default_combatant` baseline
    /// (using the canonical builder keeps this churn-proof when
    /// `SimpleCombatantStats` gains fields) with the core melee stats
    /// randomized over sane ranges. All abilities/statuses stay off.
    fn arb_stats()(
        health in 100.0f64..20_000.0,
        damage in 10.0f64..3_000.0,
        damage2 in 0.0f64..1_000.0,
        bite_cooldown in 0.5f64..5.0,
        weight in 50.0f64..400.0,
        health_regen in 0.0f64..100.0,
    ) -> SimpleCombatantStats {
        let mut s = default_combatant();
        s.health = health;
        s.damage = damage;
        s.damage2 = damage2;
        s.bite_cooldown = bite_cooldown;
        s.weight = weight;
        s.health_regen = health_regen;
        s
    }
}

fn arb_policy() -> impl Strategy<Value = SimpleAbilityTimingMode> {
    prop_oneof![
        Just(SimpleAbilityTimingMode::ReallyFast),
        Just(SimpleAbilityTimingMode::Fast),
        Just(SimpleAbilityTimingMode::SemiIdeal),
        Just(SimpleAbilityTimingMode::Ideal),
    ]
}

fn run(
    attacker: &SimpleCombatantStats,
    defender: &SimpleCombatantStats,
    policy: SimpleAbilityTimingMode,
    max_time_sec: f64,
) -> crate::contracts::BestBuildsMatchupSummary {
    simulate_composable_matchup(
        attacker,
        defender,
        None,
        None,
        policy,
        &ComposableAbilityConfig::default(),
        max_time_sec,
    )
}

// ── Properties ─────────────────────────────────────────────────────

proptest! {
    /// Pure function: identical inputs => byte-identical summary. Debug
    /// formatting compares every field and is robust to NaN/inf (which
    /// format identically), so this catches any nondeterminism without a
    /// field-by-field float comparison.
    #[test]
    fn engine_is_deterministic(
        attacker in arb_stats(),
        defender in arb_stats(),
        policy in arb_policy(),
        max_time_sec in 10.0f64..60.0,
    ) {
        let a = run(&attacker, &defender, policy, max_time_sec);
        let b = run(&attacker, &defender, policy, max_time_sec);
        prop_assert_eq!(format!("{a:?}"), format!("{b:?}"));
    }

    /// No NaN/non-finite leaks, and final HP within `[0, max_hp]`. (dps /
    /// ehp are intentionally excluded - a t=0 kill divides to +inf there
    /// legitimately.)
    #[test]
    fn engine_outputs_are_finite_and_hp_bounded(
        attacker in arb_stats(),
        defender in arb_stats(),
        policy in arb_policy(),
        max_time_sec in 10.0f64..60.0,
    ) {
        let s = run(&attacker, &defender, policy, max_time_sec);

        for (name, v) in [
            ("final_hp_a", s.final_hp_a),
            ("final_hp_b", s.final_hp_b),
            ("max_hp_a", s.max_hp_a),
            ("max_hp_b", s.max_hp_b),
            ("ttk_a_to_b", s.ttk_a_to_b),
            ("ttk_b_to_a", s.ttk_b_to_a),
            ("damage_dealt_a", s.damage_dealt_a),
            ("damage_dealt_b", s.damage_dealt_b),
        ] {
            prop_assert!(v.is_finite(), "summary.{} is non-finite: {}", name, v);
        }

        prop_assert!(
            (-EPS..=s.max_hp_a + EPS).contains(&s.final_hp_a),
            "final_hp_a {} outside [0, max_hp_a={}]", s.final_hp_a, s.max_hp_a
        );
        prop_assert!(
            (-EPS..=s.max_hp_b + EPS).contains(&s.final_hp_b),
            "final_hp_b {} outside [0, max_hp_b={}]", s.final_hp_b, s.max_hp_b
        );
    }

    /// Death times and TTKs stay within the simulated window.
    #[test]
    fn engine_times_within_window(
        attacker in arb_stats(),
        defender in arb_stats(),
        policy in arb_policy(),
        max_time_sec in 10.0f64..60.0,
    ) {
        let s = run(&attacker, &defender, policy, max_time_sec);
        for (name, t) in [("death_time_a", s.death_time_a), ("death_time_b", s.death_time_b)] {
            if let Some(t) = t {
                prop_assert!(
                    (-EPS..=max_time_sec + EPS).contains(&t),
                    "{} = {} outside [0, {}]", name, t, max_time_sec
                );
            }
        }
        for (name, t) in [("ttk_a_to_b", s.ttk_a_to_b), ("ttk_b_to_a", s.ttk_b_to_a)] {
            prop_assert!(
                (-EPS..=max_time_sec + EPS).contains(&t),
                "{} = {} outside [0, {}]", name, t, max_time_sec
            );
        }
    }

    /// If exactly one side recorded a death, the survivor is the winner.
    #[test]
    fn engine_winner_consistent_when_one_side_dies(
        attacker in arb_stats(),
        defender in arb_stats(),
        policy in arb_policy(),
        max_time_sec in 10.0f64..60.0,
    ) {
        let s = run(&attacker, &defender, policy, max_time_sec);
        match (s.death_time_a.is_some(), s.death_time_b.is_some()) {
            (true, false) => prop_assert_eq!(
                s.winner, Winner::B,
                "A died at {:?}, B survived, but winner is {:?}", s.death_time_a, s.winner
            ),
            (false, true) => prop_assert_eq!(
                s.winner, Winner::A,
                "B died at {:?}, A survived, but winner is {:?}", s.death_time_b, s.winner
            ),
            _ => {} // both-died / neither-died: tie/timeout rules not constrained here
        }
    }
}
