//! Reference: status_shredded_wings
//!
//! Modeled: Shredded Wings takes a flying creature out of the air, so it can no
//! longer dodge under the Dodge Chance rule - every incoming bite and breath
//! then lands on it. A creature that does not fly keeps its dodge. With the
//! rule off the status has no separate combat effect. Test body carries the
//! [REF:status_shredded_wings] marker for the coverage gate.

use super::default_combatant;
use crate::composable::side::CombatSide;
use crate::composable::{aerial_dodge_incoming_lands, AerialDodgeChannel};
use crate::contracts::{CreatureIdentity, SimpleStatusInstance};

#[test]
fn shredded_wings_takes_a_flying_creature_out_of_the_air_so_attacks_always_land() {
    // [REF:status_shredded_wings]
    // A flying creature at 0% hit chance would dodge everything, but Shredded
    // Wings removes the dodge, so every incoming bite and breath lands.
    let mut stats = default_combatant();
    stats.identity = Some(CreatureIdentity {
        is_aerial: true,
        ..Default::default()
    });
    stats.aerial_dodge_hit_chance_pct = 0.0;

    let mut side = CombatSide::new(&stats, None);
    side.aerial_dodge_active = true;
    side.statuses.insert(
        "Shredded_Wings".to_string(),
        SimpleStatusInstance {
            stacks: 1.0,
            next_tick_at: None,
            next_decay_at: None,
            remaining_sec: 100.0,
            stack_value_mode: None,
            lich_mark_owned_stacks: None,
            no_decay: false,
            resolved_scalars: None,
        },
    );

    assert!(aerial_dodge_incoming_lands(&stats, &mut side, AerialDodgeChannel::Bite));
    assert!(aerial_dodge_incoming_lands(&stats, &mut side, AerialDodgeChannel::Breath));
}
