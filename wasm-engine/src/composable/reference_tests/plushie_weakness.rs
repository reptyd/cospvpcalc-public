//! Reference: plushie_sparkler, plushie_ginger_snapper, plushie_ember_spirit
//!
//! Three plushies carry a weakness to one other ailment alongside their blocks,
//! which the data holds as a negative block fraction. A negative fraction
//! multiplies the incoming stacks up, the same way a negative resistance on the
//! creature itself does; the two are split apart from the positive blocks so
//! that a weakness cannot cancel an unrelated block or clamp to zero on its own.

use crate::contracts::{SimpleAppliedStatus, SimpleCombatantStats, SimpleStatusInstance};
use crate::statuses::apply_incoming_statuses_to_target;
use std::collections::BTreeMap;

fn target_with_plushie_block(status_id: &str, fraction: f64) -> SimpleCombatantStats {
    let mut stats = SimpleCombatantStats {
        health: 1000.0,
        weight: 100.0,
        damage: 50.0,
        bite_cooldown: 2.0,
        ..Default::default()
    };
    stats
        .plushie_status_block_fractions
        .insert(status_id.to_string(), fraction);
    stats
}

/// Stacks left on the target after applying `stacks` of `status_id`.
fn applied_stacks(target: &SimpleCombatantStats, status_id: &str, stacks: f64) -> f64 {
    let mut statuses: BTreeMap<String, SimpleStatusInstance> = BTreeMap::new();
    apply_incoming_statuses_to_target(
        0.0,
        target,
        target.health,
        &mut statuses,
        &[SimpleAppliedStatus {
            status_id: status_id.to_string(),
            stacks,
            ..Default::default()
        }],
    );
    statuses.get(status_id).map(|i| i.stacks).unwrap_or(0.0)
}

#[test]
fn a_plushie_weakness_lands_more_stacks_than_no_plushie_at_all() {
    // [REF:plushie_sparkler] [REF:plushie_ginger_snapper] [REF:plushie_ember_spirit]
    // A weakness on its own must land more stacks than no plushie at all.
    let bare = SimpleCombatantStats {
        health: 1000.0,
        weight: 100.0,
        damage: 50.0,
        bite_cooldown: 2.0,
        ..Default::default()
    };
    let weak = target_with_plushie_block("Bleed_Status", -0.2);

    let on_bare = applied_stacks(&bare, "Bleed_Status", 10.0);
    let on_weak = applied_stacks(&weak, "Bleed_Status", 10.0);

    assert!(
        (on_bare - 10.0).abs() < 1e-9,
        "the control must take the stacks whole: {on_bare}"
    );
    assert!(
        (on_weak - 12.0).abs() < 1e-9,
        "a -20% block must land a fifth more stacks, got {on_weak}"
    );
}

#[test]
fn a_plushie_block_still_cuts_what_lands() {
    // [REF:plushie_sparkler]
    // The other three channels Sparkler carries are ordinary blocks and must be
    // unaffected by how the weakness is handled.
    let blocked = target_with_plushie_block("Poison_Status", 0.15);
    let landed = applied_stacks(&blocked, "Poison_Status", 10.0);
    assert!(
        (landed - 8.5).abs() < 1e-9,
        "a +15% block must cut the stacks to 8.5, got {landed}"
    );
}

#[test]
fn a_weakness_on_one_ailment_does_not_pay_for_a_block_on_another() {
    // [REF:plushie_sparkler]
    // Summing every fraction into one total let the Bleed weakness eat into the
    // Poison block. They are separate channels and each must stand alone.
    let mut both = target_with_plushie_block("Poison_Status", 0.15);
    both.plushie_status_block_fractions
        .insert("Bleed_Status".to_string(), -0.2);

    let poison = applied_stacks(&both, "Poison_Status", 10.0);
    let bleed = applied_stacks(&both, "Bleed_Status", 10.0);

    assert!(
        (poison - 8.5).abs() < 1e-9,
        "the Poison block must still cut to 8.5 next to a Bleed weakness, got {poison}"
    );
    assert!(
        (bleed - 12.0).abs() < 1e-9,
        "the Bleed weakness must still cost a fifth next to a Poison block, got {bleed}"
    );
}
