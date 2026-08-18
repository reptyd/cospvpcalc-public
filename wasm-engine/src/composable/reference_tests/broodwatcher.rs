//! Reference: compare_broodwatcher, approx_broodwatcher
//!
//! Compare seeds 5 Defensive stacks at t=0 and marks them permanent
//! (`buildCompareInitialStatuses` in `src/hooks/useCompareSimulation.ts`).
//! The permanence rides on the starting-status payload's `no_decay` flag -
//! without it the five stacks bleed off one per 3-second decay step and the
//! +10% weight is gone 15 seconds into the fight instead of lasting it out.

use crate::active_runtime::defensive_status_weight_factor;
use crate::contracts::{SimpleAppliedStatus, SimpleStatusInstance};
use crate::statuses::{apply_simple_status_list, update_simple_status_durations_full};
use std::collections::BTreeMap;

fn seeded(no_decay: bool) -> BTreeMap<String, SimpleStatusInstance> {
    let mut statuses = BTreeMap::new();
    apply_simple_status_list(
        0.0,
        &mut statuses,
        &[SimpleAppliedStatus {
            status_id: "Defensive_Status".to_string(),
            stacks: 5.0,
            source_ability: Some("Broodwatcher".to_string()),
            no_decay,
            // What Compare sends: the five stacks are the buff's lifetime, not
            // five times its strength.
            stack_value_mode: Some("durationOnly".to_string()),
            ..Default::default()
        }],
    );
    statuses
}

#[test]
fn the_five_defensive_stacks_do_not_decay() {
    // [REF:compare_broodwatcher]
    // [REF:approx_broodwatcher]
    let mut statuses = seeded(true);
    for t in [3.0, 15.0, 60.0, 300.0] {
        update_simple_status_durations_full(t, &mut statuses, false, None, 1.0, 1.0);
    }
    let instance = statuses
        .get("Defensive_Status")
        .expect("permanent Defensive stacks must survive the whole fight");
    assert_eq!(instance.stacks, 5.0);
    assert!(instance.no_decay);

    // Without the flag the same seed is a 15-second buff - five stacks at the
    // 3-second engine decay step.
    let mut decaying = seeded(false);
    for t in [3.0, 6.0, 9.0, 12.0, 15.0] {
        update_simple_status_durations_full(t, &mut decaying, false, None, 1.0, 1.0);
    }
    assert!(!decaying.contains_key("Defensive_Status"));
}

#[test]
fn defensive_stacks_are_worth_a_flat_ten_percent_weight() {
    // [REF:compare_broodwatcher]
    let mut statuses = seeded(true);
    update_simple_status_durations_full(300.0, &mut statuses, false, None, 1.0, 1.0);
    let factor = defensive_status_weight_factor(&statuses);
    assert!(
        (factor - 1.10).abs() < 1e-9,
        "Defensive is applied durationOnly, so 5 stacks are still +10%: got {factor}",
    );

    // A source that does not mark its stacks as a lifetime is paid for all of
    // them. Nothing applies Defensive that way today; the clamp used to be
    // unconditional, which would have silently capped the first one that did.
    let mut real_stacks = BTreeMap::new();
    apply_simple_status_list(
        0.0,
        &mut real_stacks,
        &[SimpleAppliedStatus {
            status_id: "Defensive_Status".to_string(),
            stacks: 5.0,
            no_decay: true,
            ..Default::default()
        }],
    );
    let per_stack = defensive_status_weight_factor(&real_stacks);
    assert!(
        (per_stack - 1.50).abs() < 1e-9,
        "five real stacks are worth 5 x 10%: got {per_stack}",
    );
}
