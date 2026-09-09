//! Reference: ability_tail_striker
//!
//! The whole of the ability is one permission: a secondary bite from a carrier
//! applies the on-hit offensive ailments a primary bite would, where a secondary
//! bite otherwise applies none. The engine reads it as
//! `SimpleCombatantStats.has_tail_striker` and lifts the
//! `bite_variant != SECONDARY_VARIANT` gate on the status-apply block in
//! `phases/melee.rs`.

use super::super::config::{ComposableAbilityConfig, SimpleBiteVariantMode};
use super::super::simulate_composable_matchup_with_trace;
use super::{applied_status, default_combatant};
use crate::contracts::{SimpleAbilityTimingMode, SimpleCombatantStats};

/// A biter whose primary carries Bleed and whose secondary hits harder.
fn biter(tail_striker: bool) -> SimpleCombatantStats {
    let mut s = default_combatant();
    s.damage = 100.0;
    s.damage2 = 200.0;
    s.bite_cooldown = 1.0;
    s.has_tail_striker = tail_striker;
    s.on_hit_statuses = vec![applied_status("Bleed_Status", 2.0)];
    s
}

fn bleed_applications(tail_striker: bool, secondary: bool) -> usize {
    let attacker = biter(tail_striker);
    let mut defender = default_combatant();
    defender.damage = 0.0;
    defender.health = 1e9;

    let mut config = ComposableAbilityConfig::default();
    config.attacker_bite_variant_mode = if secondary {
        SimpleBiteVariantMode::SecondaryOnly
    } else {
        SimpleBiteVariantMode::PrimaryOnly
    };

    simulate_composable_matchup_with_trace(
        &attacker, &defender, None, None,
        SimpleAbilityTimingMode::Ideal,
        &config,
        10.0, true,
    )
    .combat_log
    .expect("trace")
    .iter()
    .filter(|e| e.status_id.as_deref() == Some("Bleed_Status"))
    .count()
}

#[test]
fn a_secondary_bite_applies_nothing_without_it() {
    // [REF:ability_tail_striker]
    assert!(bleed_applications(false, true) == 0, "a plain secondary applies no ailment");
    assert!(bleed_applications(false, false) > 0, "the primary always does");
}

#[test]
fn a_secondary_bite_applies_the_primary_ailments_with_it() {
    // [REF:ability_tail_striker]
    let with_it = bleed_applications(true, true);
    assert!(with_it > 0, "Tail Striker lets the secondary apply them");
    assert_eq!(
        with_it,
        bleed_applications(true, false),
        "and applies exactly what a primary would, not more or fewer",
    );
}

#[test]
fn it_leaves_the_primary_alone() {
    // [REF:ability_tail_striker]
    assert_eq!(
        bleed_applications(true, false),
        bleed_applications(false, false),
        "a primary bite is the same with and without the ability",
    );
}
