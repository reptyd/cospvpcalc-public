//! Reference: status_thirsty
//!
//! Covers every testable bullet in the "Thirsty" entry. Each test body
//! must contain the [REF:status_thirsty] marker so the vitest coverage gate
//! sees it - the gate reads the marker only from a file that asserts, so
//! a body carrying nothing but the marker still counts as uncovered.

use super::default_combatant;
use crate::compare_hunger::COMPARE_METER_DRAIN_UNITS_PER_SEC;
use crate::composable::side::CombatSide;
use crate::composable::status_helpers::advance_side_hunger;
use crate::statuses::{compute_simple_dot_damage, status_tick_sec};

const DRAIN_INTERVAL_SEC: f64 = 1.0 / COMPARE_METER_DRAIN_UNITS_PER_SEC;

fn side_with(hunger: f64, thirst: f64) -> CombatSide {
    let mut side = CombatSide::new(&default_combatant(), None);
    side.compare_hunger_rule_enabled = true;
    side.compare_appetite_base = 100.0;
    side.compare_hunger = hunger;
    side.compare_thirst = thirst;
    side
}

fn stacks(side: &CombatSide, id: &str) -> f64 {
    side.statuses.get(id).map(|i| i.stacks).unwrap_or(0.0)
}

#[test]
fn is_hungry_on_the_other_meter() {
    // [REF:status_thirsty]
    // Bullet 1: "Thirsty is Hungry on the thirst meter: same stack rule, same
    // damage, same regeneration block."
    assert_eq!(status_tick_sec("Thirsty_Status"), status_tick_sec("Hungry_Status"));
    for stack_count in [1.0, 3.0, 7.0] {
        assert_eq!(
            compute_simple_dot_damage(10_000.0, "Thirsty_Status", stack_count),
            compute_simple_dot_damage(10_000.0, "Hungry_Status", stack_count),
            "the two must deal the same damage at {stack_count} stacks"
        );
    }
    assert_eq!(
        crate::effects_registry::regen_modifier_pct("Thirsty_Status"),
        crate::effects_registry::regen_modifier_pct("Hungry_Status"),
    );

    // Both meters run independently, so a creature can starve on one alone.
    let mut side = side_with(100.0, 0.0);
    advance_side_hunger(&mut side, DRAIN_INTERVAL_SEC * 2.0);
    assert_eq!(stacks(&side, "Thirsty_Status"), 3.0);
    assert_eq!(stacks(&side, "Hungry_Status"), 0.0, "a full meter is not starving");
}

#[test]
fn a_creature_with_no_thirst_meter_never_gets_it() {
    // [REF:status_thirsty]
    // Bullet 2: "Aquatic and Photocarnivore creatures have no thirst meter
    // and never get Thirsty."
    let mut side = side_with(100.0, 0.0);
    side.compare_has_thirst = false;
    advance_side_hunger(&mut side, DRAIN_INTERVAL_SEC * 10.0);
    assert_eq!(stacks(&side, "Thirsty_Status"), 0.0, "no meter, no dehydration");
    assert_eq!(
        side.compare_thirst, 0.0,
        "and the meter it does not own must not move"
    );
}
