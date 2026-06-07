//! Property-based tests for the policy engine's forward-projection.
//!
//! Where the curated tests in `monotonicity.rs`, `edge_cases.rs`, etc.
//! catch named regressions on hand-picked scenarios, the tests here
//! assert invariants that must hold across the *whole input space* of
//! `CombatStateProjection::project`:
//!
//! 1. **Determinism.** `project(s, dt)` is a pure function - same
//!    inputs always produce the same output. (No global mutable state,
//!    no clocks, no RNG inside.)
//! 2. **Time monotonicity.** For any positive finite `dt`, the
//!    projected `next.time` equals `s.time + dt` exactly.
//! 3. **Zero / non-finite delta is identity.** `project(s, 0)` and
//!    `project(s, NaN)` and `project(s, -anything)` all return a clone
//!    of `s` (preserves `time`).
//! 4. **HP bounds.** Projected HP is clamped to `[0, max_hp]` for any
//!    delta, no matter how large the input DoT stacks or opponent DPS.
//! 5. **Status stacks never grow.** Forward-projection only ever
//!    DECAYS DoT statuses. A property that asserts "no status's stack
//!    count is larger in `next` than in `s`" catches a class of bugs
//!    where a decay-side helper accidentally writes back the input.
//!
//! Why these matter for ability-add ergonomics: the projector is the
//! shared dependency of every decision (built-in or user-registered).
//! A regression that violates a core projection/registry invariant silently corrupts
//! every utility() call across the engine. Property tests catch this
//! at the unit level instead of waiting for a fixture matchup to drift.
//!
//! Default proptest config: 256 cases per property. ~5-10 ms per
//! property locally; well under the cost budget.

use proptest::prelude::*;
use std::collections::BTreeMap;

use crate::contracts::{SimpleCombatantStats, SimpleStatusInstance};
use crate::policy::light_projection::CombatStateProjection;
use crate::policy::state::{PolicySide, PolicyState};
use crate::policy::traits::StateProjection;

// ── Generators ─────────────────────────────────────────────────────

/// Status ids the projector recognises. Other ids pass through
/// unchanged so we draw from the recognised set for the "decay
/// happens" properties.
const DOT_IDS: &[&str] = &[
    "Bleed_Status",
    "Burn_Status",
    "Poison_Status",
    "Corrosion_Status",
    "Necropoison_Status",
    "Frostbite_Status",
    "Hypothermia_Status",
    "Heat_Wave_Status",
];

fn arb_finite_positive_delta() -> impl Strategy<Value = f64> {
    // Range chosen to cover sub-tick (0.5 s) up to multiple full
    // status decay cycles (90 s). Avoids the early-return branch at
    // 0/NaN/negative which has its own property.
    0.5f64..90.0f64
}

fn arb_stats(max_hp: f64) -> SimpleCombatantStats {
    SimpleCombatantStats {
        health: max_hp,
        weight: 100.0,
        damage: 50.0,
        bite_cooldown: 2.0,
        damage2: 0.0,
        health_regen: 0.0,
        active_cooldown_multiplier: 1.0,
        quick_recovery_hp_ratio_threshold: 0.0,
        unbreakable_damage_cap_pct: 0.0,
        damage_taken_multiplier_on_being_bitten: 1.0,
        breath_resistance: 0.0,
        berserk_bite_cooldown_multiplier: 1.0,
        berserk_hp_ratio_threshold: 0.0,
        first_strike_pct: 0.0,
        first_strike_hp_ratio_threshold: 1.0,
        has_warden_resistance: false,
        has_reflect: false,
        immune_status_ids: vec![],
        hunker_reduction_pct: 0.0,
        self_destruct_profile: None,
        on_hit_statuses: vec![],
        on_hit_taken_statuses: vec![],
        starting_statuses: vec![],
        status_resist_fractions: BTreeMap::new(),
        plushie_status_block_fractions: BTreeMap::new(),
        plushie_reflect_avg_pct: 0.0,
        disabled_abilities: vec![],
        compare_air_rule_cooldown_sec: 0.0,
        user_ability_ids: Vec::new(),
        identity: None,
    }
}

fn arb_status_instance(stacks: f64) -> SimpleStatusInstance {
    SimpleStatusInstance {
        stacks,
        next_tick_at: None,
        next_decay_at: None,
        remaining_sec: 100.0,
        stack_value_mode: None,
        lich_mark_owned_stacks: None,
        no_decay: false,
        resolved_scalars: None,
    }
}

prop_compose! {
    /// One side with randomized HP fraction, optional DoT statuses,
    /// and a fixed stats baseline. Opponent damage is zeroed in the
    /// callers below so DoT-only properties stay isolated.
    fn arb_side()(
        hp_ratio in 0.05f64..1.0f64,
        regen_pct in 0.0f64..10.0f64,
        // Up to three random DoT stacks. Keeping the vec short keeps
        // shrinking fast; the projector iterates DoT_IDS unconditionally
        // so coverage of all eight is via the index choices below.
        statuses in prop::collection::vec(
            (0usize..DOT_IDS.len(), 0.5f64..15.0f64),
            0..3,
        ),
    ) -> PolicySide {
        let max_hp = 10_000.0;
        let mut stats = arb_stats(max_hp);
        stats.health_regen = regen_pct;
        let mut status_map = BTreeMap::new();
        for (idx, stacks) in statuses {
            status_map.insert(DOT_IDS[idx].to_string(), arb_status_instance(stacks));
        }
        PolicySide {
            stats,
            hp: max_hp * hp_ratio,
            statuses: status_map,
            cooldowns: BTreeMap::new(),
            active_until: BTreeMap::new(),
            breath_capacity: 0.0,
            next_hit: 0.0,
            next_breath: f64::INFINITY,
            breath: None,
            extras: BTreeMap::new(),
            recent_damage_taken: Vec::new(),
            recent_damage_dealt: Vec::new(),
            posture: "Standing".to_string(),
        }
    }
}

prop_compose! {
    fn arb_state()(self_side in arb_side(), opp in arb_side(), time in 0.0f64..600.0f64)
        -> PolicyState
    {
        // Zero opponent damage so the projection's incoming-DPS term
        // drops out. Tests that exercise the DPS interaction can
        // construct states explicitly.
        let mut opponent = opp;
        opponent.stats.damage = 0.0;
        PolicyState { self_side, opponent, time, extras: BTreeMap::new() }
    }
}

// ── Properties ─────────────────────────────────────────────────────

proptest! {
    /// Pillar: pure function. Two calls with identical inputs produce
    /// byte-for-byte identical outputs (time + hp + status stacks).
    #[test]
    fn project_is_deterministic(state in arb_state(), delta in arb_finite_positive_delta()) {
        let proj = CombatStateProjection;
        let a = proj.project(&state, delta);
        let b = proj.project(&state, delta);
        prop_assert_eq!(a.time, b.time);
        prop_assert_eq!(a.self_side.hp, b.self_side.hp);
        prop_assert_eq!(a.opponent.hp, b.opponent.hp);
        // Compare status maps key-by-key - BTreeMap is ordered so
        // direct equality on the map would catch insertion-order
        // drift, but we want the property to focus on values.
        for id in DOT_IDS {
            prop_assert_eq!(
                a.self_side.status_stacks(id),
                b.self_side.status_stacks(id),
            );
            prop_assert_eq!(
                a.opponent.status_stacks(id),
                b.opponent.status_stacks(id),
            );
        }
    }

    /// Pillar: time monotonicity. `next.time == s.time + delta`
    /// exactly for any positive finite delta.
    #[test]
    fn project_advances_time_exactly(
        state in arb_state(),
        delta in arb_finite_positive_delta(),
    ) {
        let proj = CombatStateProjection;
        let next = proj.project(&state, delta);
        prop_assert!((next.time - (state.time + delta)).abs() < 1e-9);
    }

    /// Pillar: zero / negative / NaN delta is an identity (clone).
    /// Captured by the `delta_sec <= 0.0 || !delta_sec.is_finite()`
    /// early-return branch in `project`.
    #[test]
    fn project_with_non_positive_delta_is_identity(
        state in arb_state(),
        delta in prop_oneof![Just(0.0f64), Just(-1.0f64), Just(-1e6), Just(f64::NAN), Just(f64::NEG_INFINITY)],
    ) {
        let proj = CombatStateProjection;
        let next = proj.project(&state, delta);
        prop_assert_eq!(next.time, state.time);
        prop_assert_eq!(next.self_side.hp, state.self_side.hp);
        for id in DOT_IDS {
            prop_assert_eq!(
                next.self_side.status_stacks(id),
                state.self_side.status_stacks(id),
            );
        }
    }

    /// Pillar: HP stays in `[0, max_hp]` no matter what statuses
    /// are stacked, how long the window, or whether regen would
    /// overshoot. Catches sign-flip or clamp-skip bugs in the
    /// `side.hp = hp.clamp(0.0, max_hp)` line at the end of
    /// `project_side`.
    #[test]
    fn project_keeps_hp_within_bounds(
        state in arb_state(),
        delta in arb_finite_positive_delta(),
    ) {
        let proj = CombatStateProjection;
        let next = proj.project(&state, delta);
        let max_self = next.self_side.stats.health;
        let max_opp = next.opponent.stats.health;
        prop_assert!(
            (0.0..=max_self).contains(&next.self_side.hp),
            "self HP {} outside [0, {}]", next.self_side.hp, max_self
        );
        prop_assert!(
            (0.0..=max_opp).contains(&next.opponent.hp),
            "opp HP {} outside [0, {}]", next.opponent.hp, max_opp
        );
    }

    /// Pillar: status decay is monotone. A DoT status's stack count
    /// in `next` must be ≤ its stack count in `s`. A status that fully
    /// decayed is removed from the map (read as 0 by `status_stacks`).
    #[test]
    fn project_only_decays_statuses(
        state in arb_state(),
        delta in arb_finite_positive_delta(),
    ) {
        let proj = CombatStateProjection;
        let next = proj.project(&state, delta);
        for id in DOT_IDS {
            let before = state.self_side.status_stacks(id);
            let after = next.self_side.status_stacks(id);
            prop_assert!(
                after <= before + 1e-9,
                "self status {} grew: before={}, after={}",
                id, before, after,
            );
            let before_opp = state.opponent.status_stacks(id);
            let after_opp = next.opponent.status_stacks(id);
            prop_assert!(
                after_opp <= before_opp + 1e-9,
                "opp status {} grew: before={}, after={}",
                id, before_opp, after_opp,
            );
        }
    }
}
