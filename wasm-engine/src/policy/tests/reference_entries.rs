//! The Ability Policy Reference entries, checked against the policy
//! layer they describe.
//!
//! Each threshold the Really fast entry states is driven through the
//! registered policy rather than read off its constant, so a gate that
//! is rewired - not merely renumbered - still has to answer the same
//! way on either side of the boundary the entry names.

use std::collections::BTreeMap;

use crate::contracts::SimpleStatusInstance;
use crate::policy::decisions::fortify::FORTIFY_DECISION_ID;
use crate::policy::decisions::hunker::HunkerDecision;
use crate::policy::decisions::life_leech::{
    LifeLeechDecision, LEECH_VALUE_EXTRA_KEY, LIFE_LEECH_DECISION_ID,
};
use crate::policy::decisions::fortify::FortifyDecision;
use crate::policy::decisions::rewind::{RewindDecision, RESTORED_HP_DELTA_KEY};
use crate::policy::light_projection::CombatStateProjection;
use crate::policy::registry::PolicyRegistry;
use crate::policy::state::{PolicyState, PolicyValue};
use crate::policy::testing::default_state;
use crate::policy::timing_mode::TimingMode;
use crate::policy::traits::{TimedChoice, TimedDecision, ToggleDecision};

fn really_fast(decision: &dyn TimedDecision, state: &PolicyState) -> TimedChoice {
    let registry = PolicyRegistry::with_builtins();
    let policy = registry
        .for_mode(TimingMode::ReallyFast)
        .expect("Really fast is a built-in mode");
    policy.decide(decision, state, &CombatStateProjection)
}

fn fires(decision: &dyn TimedDecision, state: &PolicyState) -> bool {
    matches!(really_fast(decision, state), TimedChoice::Now)
}

fn wounded(hp_ratio: f64) -> PolicyState {
    let mut state = default_state();
    state.self_side.hp = state.self_side.stats.health * hp_ratio;
    state
}

#[test]
fn life_leech_refuses_above_85_percent_hp() {
    // [REF:policy_really_fast]
    // "In the current code, Life Leech refuses to cast above 85% HP
    // under Really fast."
    let decision = LifeLeechDecision::new();
    let with_leech = |hp_ratio: f64| {
        let mut state = wounded(hp_ratio);
        state
            .self_side
            .extras
            .insert(LEECH_VALUE_EXTRA_KEY.to_string(), PolicyValue::Number(0.3));
        state.self_side.stats.damage = 100.0;
        state
            .self_side
            .cooldowns
            .insert(LIFE_LEECH_DECISION_ID.to_string(), 0.0);
        state
    };
    assert!(
        fires(&decision, &with_leech(0.85)),
        "at exactly 85% HP Really fast casts",
    );
    assert!(
        fires(&decision, &with_leech(0.60)),
        "below the threshold Really fast casts",
    );
    assert!(
        !fires(&decision, &with_leech(0.86)),
        "above 85% HP Really fast refuses",
    );
    assert!(
        !fires(&decision, &with_leech(1.0)),
        "at full HP Really fast refuses",
    );
}

#[test]
fn fortify_waits_for_fifteen_stacks_and_holds_the_first_eight_seconds() {
    // [REF:policy_really_fast]
    // "Fortify waits until there are at least 15 total removable
    // negative stacks under Really fast, and it never fires in the
    // first 8 seconds of a fight."
    let decision = FortifyDecision::new();
    let afflicted = |stacks: f64, time: f64| {
        let mut state = default_state();
        state.time = time;
        let mut statuses: BTreeMap<String, SimpleStatusInstance> = BTreeMap::new();
        statuses.insert(
            "Bleed_Status".to_string(),
            SimpleStatusInstance {
                stacks,
                next_tick_at: None,
                next_decay_at: None,
                remaining_sec: 30.0,
                stack_value_mode: None,
                lich_mark_owned_stacks: None,
                no_decay: false,
                resolved_scalars: None,
            },
        );
        state.self_side.statuses = statuses;
        state
            .self_side
            .cooldowns
            .insert(FORTIFY_DECISION_ID.to_string(), 0.0);
        state
    };
    assert!(
        fires(&decision, &afflicted(15.0, 8.0)),
        "fifteen stacks past the opening hold is the case that fires",
    );
    assert!(
        !fires(&decision, &afflicted(14.0, 8.0)),
        "fourteen stacks is short of the threshold",
    );
    assert!(
        !fires(&decision, &afflicted(40.0, 7.9)),
        "no cast inside the first 8 seconds, however heavy the pressure",
    );
    assert!(
        fires(&decision, &afflicted(40.0, 8.0)),
        "the hold ends at 8 seconds",
    );
}

#[test]
fn rewind_waits_for_75_percent_hp() {
    // [REF:policy_really_fast]
    // "In the current code, Rewind only activates at 75% HP or lower
    // under Really fast."
    let decision = RewindDecision::new();
    let snapshotted = |hp_ratio: f64| {
        let mut state = wounded(hp_ratio);
        state
            .self_side
            .extras
            .insert(RESTORED_HP_DELTA_KEY.to_string(), PolicyValue::Number(500.0));
        state
    };
    assert!(fires(&decision, &snapshotted(0.75)), "75% HP activates");
    assert!(fires(&decision, &snapshotted(0.40)), "below 75% activates");
    assert!(
        !fires(&decision, &snapshotted(0.76)),
        "above 75% HP Really fast holds Rewind",
    );
}

#[test]
fn hunker_goes_on_immediately_and_stays_on() {
    // [REF:policy_really_fast]
    // "Hunker is the clearest example: Really fast turns it on
    // immediately and keeps it on."
    let registry = PolicyRegistry::with_builtins();
    let policy = registry
        .toggle_for_mode(TimingMode::ReallyFast)
        .expect("Really fast has a toggle policy");
    let decision = HunkerDecision;
    for time in [0.0, 1.0, 30.0, 300.0] {
        for hp_ratio in [1.0, 0.5, 0.05] {
            let mut state = wounded(hp_ratio);
            state.time = time;
            assert!(
                policy.decide(&decision, &state, &CombatStateProjection),
                "Hunker must read on at t={time} on {hp_ratio} HP",
            );
        }
    }
    assert!(decision.really_fast_default(&default_state()) == Some(true));
}

#[test]
fn the_site_ships_exactly_the_five_named_modes() {
    // [REF:policy_what_ability_policies_are]
    // "The site shows five named modes: Really fast, Fast, Semi-ideal,
    // Ideal, and Extreme."
    let registry = PolicyRegistry::with_builtins();
    assert_eq!(registry.len(), 5, "five timing modes, no more and no fewer");
    let mut ids: Vec<&str> = Vec::new();
    for mode in [
        TimingMode::ReallyFast,
        TimingMode::Fast,
        TimingMode::SemiIdeal,
        TimingMode::Ideal,
        TimingMode::Extreme,
    ] {
        let policy = registry
            .for_mode(mode)
            .unwrap_or_else(|| panic!("{mode:?} has no registered policy"));
        assert!(
            registry.toggle_for_mode(mode).is_some() && registry.variant_for_mode(mode).is_some(),
            "{mode:?} must resolve on all three decision shapes",
        );
        ids.push(policy.id());
    }
    assert_eq!(
        ids,
        vec![
            "builtin.really_fast",
            "builtin.fast",
            "builtin.semi_ideal",
            "builtin.ideal",
            "builtin.extreme",
        ],
    );
}

#[test]
fn the_search_family_compares_now_against_later() {
    // [REF:policy_what_ability_policies_are]
    // "The search-based family looks ahead, compares several possible
    // timings, and keeps the one that gives the best projected
    // result." Really fast is the control: it holds no candidates, so
    // it can only answer Now or Skip, never Wait.
    struct BetterLater;
    impl TimedDecision for BetterLater {
        fn id(&self) -> &str {
            "test.better_later"
        }
        fn utility(&self, state: &PolicyState) -> f64 {
            state.time
        }
        fn is_available(&self, _: &PolicyState) -> bool {
            true
        }
        fn really_fast_gate(&self, _: &PolicyState) -> Option<bool> {
            Some(true)
        }
    }
    let registry = PolicyRegistry::with_builtins();
    let mut state = default_state();
    state.time = 0.0;
    for mode in [
        TimingMode::Fast,
        TimingMode::SemiIdeal,
        TimingMode::Ideal,
        TimingMode::Extreme,
    ] {
        let choice = registry
            .for_mode(mode)
            .unwrap()
            .decide(&BetterLater, &state, &CombatStateProjection);
        match choice {
            TimedChoice::Wait { delay_sec } => assert!(
                delay_sec > 0.0,
                "{mode:?} must wait for the better projected moment",
            ),
            other => panic!("{mode:?} took {other:?} instead of waiting"),
        }
    }
    assert!(matches!(
        registry
            .for_mode(TimingMode::ReallyFast)
            .unwrap()
            .decide(&BetterLater, &state, &CombatStateProjection),
        TimedChoice::Now,
    ));
}
