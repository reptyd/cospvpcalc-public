//! Shared test fixtures for `policy::decisions` unit tests.
//!
//! Each decision file used to carry its own ~30-line `fresh_stats` /
//! `fresh_side` / `fresh_state` triple, drifting independently as
//! contract fields were added. This module collapses the common case
//! into one set of "zero-everything baseline" builders. Tests that
//! need a specific value mutate the returned state directly:
//!
//! ```ignore
//! let mut state = testing::default_state();
//! state.self_side.hp = 5_000.0;
//! state.self_side.stats.damage = 50.0;
//! ```
//!
//! Adding a new field to `SimpleCombatantStats` / `PolicySide` /
//! `PolicyState` now requires updating exactly this file, not every
//! decision's test module.

use std::collections::BTreeMap;

use crate::contracts::{SimpleCombatantStats, SimpleStatusInstance};
use crate::policy::state::{PolicySide, PolicyState};

/// Combatant stats baseline: 10 000 HP, 100 damage, 2 s bite cooldown,
/// neutral weight, no regen, no buffs, no statuses, no plushies.
pub fn default_stats() -> SimpleCombatantStats {
    SimpleCombatantStats {
        health: 10_000.0,
        weight: 100.0,
        damage: 100.0,
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

/// Policy-side baseline: full HP, no statuses, all cooldown /
/// active-until maps empty, no breath, no extras.
pub fn default_side() -> PolicySide {
    let stats = default_stats();
    PolicySide {
        hp: stats.health,
        stats,
        statuses: BTreeMap::new(),
        cooldowns: BTreeMap::new(),
        active_until: BTreeMap::new(),
        breath_capacity: 0.0,
        breath: None,
        next_hit: 0.0,
        next_breath: f64::INFINITY,
        extras: BTreeMap::new(),
        recent_damage_taken: Vec::new(),
        recent_damage_dealt: Vec::new(),
        posture: "Standing".to_string(),
    }
}

/// Policy-state baseline: both sides at full HP, time = 0, no
/// state-level extras.
pub fn default_state() -> PolicyState {
    PolicyState {
        self_side: default_side(),
        opponent: default_side(),
        time: 0.0,
        extras: BTreeMap::new(),
    }
}

/// Shorthand for a fully-stocked status instance with `stacks` and a
/// long remaining duration; the next-tick / next-decay timestamps are
/// left unset (the engine sets them on first tick).
pub fn status_instance(stacks: f64) -> SimpleStatusInstance {
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
