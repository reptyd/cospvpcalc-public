//! Engine-level tests: traits, registry, and policy modes wiring.
//!
//! Per-ability decision tests live alongside the decision impl
//! (e.g. `decisions/fortify.rs::tests`). Per-ability monotonicity /
//! math-ideal / fixture-parity / cost-budget suites land in
//! Phase 3 once a few decisions have been migrated; for now this
//! module only exercises the engine plumbing.


use crate::contracts::SimpleStatusInstance;
use crate::policy::decisions::FortifyDecision;
use crate::policy::light_projection::CombatStateProjection;
use crate::policy::registry::{DecisionRegistry, PolicyRegistry};
use crate::policy::state::PolicyState;
use crate::policy::testing::default_state;
use crate::policy::timing_mode::TimingMode;
use crate::policy::traits::{TimedChoice, TimedDecision};

/// Engine-test baseline: same as the shared default but with damage
/// halved (50 vs 100) so projection-driven HP movement is observable
/// without one side instantly winning.
fn fresh_state() -> PolicyState {
    let mut s = default_state();
    s.self_side.stats.damage = 50.0;
    s.opponent.stats.damage = 50.0;
    s
}

fn instance(stacks: f64) -> SimpleStatusInstance {
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

#[test]
fn fortify_through_registry_is_callable_via_id() {
    let mut decisions = DecisionRegistry::new();
    decisions.register(Box::new(FortifyDecision::new()));
    let policies = PolicyRegistry::with_builtins();

    let mut state = fresh_state();
    state
        .self_side
        .statuses
        .insert("Bleed_Status".to_string(), instance(20.0));

    let projector = CombatStateProjection;

    let decision = decisions
        .get("builtin.fortify")
        .expect("fortify registered");
    let policy = policies.for_mode(TimingMode::ReallyFast).expect("rf");

    let choice = policy.decide(decision, &state, &projector);
    assert_eq!(
        choice,
        TimedChoice::Now,
        "ReallyFast must fire Fortify with 20 Bleed stacks (≥ 15 gate)"
    );
}

#[test]
fn really_fast_skips_when_gate_fails_even_if_utility_positive() {
    let decision: Box<dyn TimedDecision> = Box::new(FortifyDecision::new());
    let projector = CombatStateProjection;
    let policies = PolicyRegistry::with_builtins();
    let policy = policies.for_mode(TimingMode::ReallyFast).expect("rf");

    let mut state = fresh_state();
    state
        .self_side
        .statuses
        .insert("Bleed_Status".to_string(), instance(5.0));
    // utility > 0 (5 stacks of bleed contribute), but ReallyFast
    // gate requires ≥ 15 total → must skip.
    assert!(decision.utility(&state) > 0.0);
    let choice = policy.decide(decision.as_ref(), &state, &projector);
    assert_eq!(choice, TimedChoice::Skip);
}

#[test]
fn ideal_fires_when_pressure_is_high_enough_for_utility_to_beat_skip() {
    let decision: Box<dyn TimedDecision> = Box::new(FortifyDecision::new());
    let projector = CombatStateProjection;
    let policies = PolicyRegistry::with_builtins();
    let policy = policies.for_mode(TimingMode::Ideal).expect("ideal");

    let mut state = fresh_state();
    state
        .self_side
        .statuses
        .insert("Burn_Status".to_string(), instance(8.0));

    let choice = policy.decide(decision.as_ref(), &state, &projector);
    // Ideal enumerates candidates and picks the one with highest
    // utility. With 8 Burn stacks the immediate candidate (delay=0)
    // should beat the others (Burn decays before later candidates).
    match choice {
        TimedChoice::Now => {}
        TimedChoice::Wait { delay_sec } => {
            // Acceptable if engine prefers a small delay, but it
            // must not be `Skip`.
            assert!(
                delay_sec > 0.0,
                "if not Now, must be Wait - got Wait with delay 0?"
            );
        }
        TimedChoice::Skip => panic!("Ideal must not skip with 8 Burn stacks"),
    }
}

#[test]
fn ideal_skips_clean_actor_with_no_meaningful_pressure() {
    let decision: Box<dyn TimedDecision> = Box::new(FortifyDecision::new());
    let projector = CombatStateProjection;
    let policies = PolicyRegistry::with_builtins();
    let policy = policies.for_mode(TimingMode::Ideal).expect("ideal");

    let state = fresh_state();
    // No statuses, no opp on-hit. is_available returns false →
    // policy must skip.
    let choice = policy.decide(decision.as_ref(), &state, &projector);
    assert_eq!(choice, TimedChoice::Skip);
}

/// Regression: Ideal must NOT fire Fortify when only 1 trivial
/// stack is present *and* opp is set up to apply many more during a
/// wait. Pre-fix, cleanse_value at delay > 0 was computed against
/// the projected (decayed) stacks alone - so utility(0) > utility(8)
/// for any low-stack starting state, and Ideal collapsed to "fire
/// now". With POLICY_SEARCH_DELAY_KEY plumbing + opp-apply
/// extrapolation in cleanse_value, the candidate at delay > 0 sees
/// stacks-at-firing that include opp's future bites, so the wait
/// candidate wins.
#[test]
fn ideal_waits_when_opp_pressure_will_build_during_window() {
    use crate::contracts::SimpleAppliedStatus;

    let decision: Box<dyn TimedDecision> = Box::new(FortifyDecision::new());
    let projector = CombatStateProjection;
    let policies = PolicyRegistry::with_builtins();
    let policy = policies.for_mode(TimingMode::Ideal).expect("ideal");

    let mut state = fresh_state();
    // Tiny starting pressure (one stack - needed so is_available
    // returns true and the policy actually evaluates candidates).
    state
        .self_side
        .statuses
        .insert("Poison_Status".to_string(), instance(1.0));
    // Opp applies 1 stack of Poison per bite at a brisk cadence -
    // 8 s of wait would have stacked many more removable points to
    // cleanse.
    state.opponent.stats.bite_cooldown = 2.0;
    state
        .opponent
        .stats
        .on_hit_statuses
        .push(SimpleAppliedStatus {
            status_id: "Poison_Status".to_string(),
            stacks: 1.0,
            source_ability: None,
        });

    let choice = policy.decide(decision.as_ref(), &state, &projector);
    match choice {
        TimedChoice::Wait { delay_sec } => {
            assert!(
                delay_sec > 0.0,
                "Ideal should pick a non-zero delay when wait builds more pressure: got delay_sec={delay_sec}"
            );
        }
        TimedChoice::Now => panic!(
            "Ideal must not fire Fortify at 1 stack when opp is queueing many more applies during the wait"
        ),
        TimedChoice::Skip => panic!(
            "Ideal must not skip Fortify; some delay candidate must beat zero"
        ),
    }
}

/// Monotonicity guard: the new utility shape must preserve
/// `damage(Ideal) >= damage(ReallyFast)` at the engine-policy level.
/// The original reported bug was Ideal firing too early →
/// ReallyFast outperforming. We can't easily simulate full-engine
/// damage here without pulling in the full composable harness, but
/// we *can* assert the invariant that drives monotonicity: when
/// ReallyFast would skip (stacks below gate), Ideal must not fire
/// at delay=0 either - it should either wait or also skip. Firing
/// strictly worse than ReallyFast violates 5.2.
#[test]
fn ideal_does_not_fire_immediately_at_sub_gate_pressure() {
    use crate::contracts::SimpleAppliedStatus;

    let decision: Box<dyn TimedDecision> = Box::new(FortifyDecision::new());
    let projector = CombatStateProjection;
    let policies = PolicyRegistry::with_builtins();
    let rf = policies.for_mode(TimingMode::ReallyFast).expect("rf");
    let ideal = policies.for_mode(TimingMode::Ideal).expect("ideal");

    let mut state = fresh_state();
    // Below ReallyFast's 15-stack hard gate, but with future
    // pressure incoming. ReallyFast will Skip; Ideal must not fire
    // strictly worse (Now at very low stacks).
    state
        .self_side
        .statuses
        .insert("Bleed_Status".to_string(), instance(3.0));
    state.opponent.stats.bite_cooldown = 1.5;
    state
        .opponent
        .stats
        .on_hit_statuses
        .push(SimpleAppliedStatus {
            status_id: "Bleed_Status".to_string(),
            stacks: 2.0,
            source_ability: None,
        });

    let rf_choice = rf.decide(decision.as_ref(), &state, &projector);
    assert_eq!(
        rf_choice,
        TimedChoice::Skip,
        "test premise: ReallyFast should skip at 3 stacks (gate is 15)"
    );
    let ideal_choice = ideal.decide(decision.as_ref(), &state, &projector);
    assert_ne!(
        ideal_choice,
        TimedChoice::Now,
        "Ideal must not strictly underperform ReallyFast - it should Wait (best of search) when sub-gate"
    );
}

#[test]
fn registry_iter_is_sorted_by_id() {
    let mut decisions = DecisionRegistry::new();
    decisions.register(Box::new(FortifyDecision::new()));
    let ids: Vec<&str> = decisions.iter().map(|(id, _)| id).collect();
    let mut sorted = ids.clone();
    sorted.sort_unstable();
    assert_eq!(ids, sorted, "registry iteration must be sorted");
}
