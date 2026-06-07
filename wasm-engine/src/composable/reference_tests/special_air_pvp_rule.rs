//! Reference: compare_special_air_pvp_rule
//!
//! Covers each testable bullet in the "Special Air PvP Rule" entry.
//! Each test body starts with the [REF:compare_special_air_pvp_rule]
//! marker so the vitest coverage gate
//! (src/pages/referenceCoverage.test.ts) sees it.
//!
//! Engine path: `combat.rs:585-594` - when
//! `stats.compare_air_rule_cooldown_sec > 0.0`, the helper returns
//! `max(0.1, this)` directly, bypassing all status (Sticky Teeth,
//! Drowsy, Frostbite) and berserk modifiers.

use super::default_combatant;
use crate::combat::current_simple_bite_cooldown_with_statuses;
use crate::contracts::{SimpleCombatantStats, SimpleStatusInstance};
use std::collections::BTreeMap;

#[test]
fn fixed_cooldown_overrides_status_modifiers() {
    // [REF:compare_special_air_pvp_rule]
    // Bullet 2: "When it is enabled, that fixed cooldown overrides
    // normal bite-cooldown changes from statuses and traits."
    // Engine: with `compare_air_rule_cooldown_sec = 1.5`, even with
    // Sticky_Teeth_Status (+65% cooldown) and Drowsy_Status (+35%)
    // present, the helper returns 1.5 unchanged.
    let mut stats = default_combatant();
    stats.bite_cooldown = 2.0;
    stats.compare_air_rule_cooldown_sec = 1.5;

    let mut statuses: BTreeMap<String, SimpleStatusInstance> = BTreeMap::new();
    statuses.insert(
        "Sticky_Teeth_Status".to_string(),
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
    statuses.insert(
        "Drowsy_Status".to_string(),
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

    let cd = current_simple_bite_cooldown_with_statuses(&stats, stats.health, &statuses);
    assert!(
        (cd - 1.5).abs() < 1e-12,
        "Special Air PvP Rule must lock bite cooldown at 1.5 regardless of statuses: got {cd}"
    );
}

#[test]
fn disabled_zero_cooldown_falls_back_to_normal_calc() {
    // [REF:compare_special_air_pvp_rule]
    // Bullet 1 (off branch implied by default): with
    // `compare_air_rule_cooldown_sec = 0.0`, the helper applies
    // status multipliers normally - Sticky_Teeth gives +65%
    // (multiplier 1.65), so a 2.0 s base cooldown becomes 3.3 s.
    let mut stats: SimpleCombatantStats = default_combatant();
    stats.bite_cooldown = 2.0;
    stats.compare_air_rule_cooldown_sec = 0.0;

    let mut statuses: BTreeMap<String, SimpleStatusInstance> = BTreeMap::new();
    statuses.insert(
        "Sticky_Teeth_Status".to_string(),
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

    let cd = current_simple_bite_cooldown_with_statuses(&stats, stats.health, &statuses);
    assert!(
        (cd - 3.3).abs() < 0.05,
        "with the rule off, normal status math applies (Sticky_Teeth +65% → 3.3 s): got {cd}"
    );
}
