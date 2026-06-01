use std::collections::BTreeMap;

use crate::active_runtime::scale_active_cooldown;
use crate::combat::apply_unbreakable_damage_cap;
use crate::statuses::{apply_incoming_statuses_to_target, apply_simple_status};
#[cfg(test)]
use crate::SimpleAdrenalineExpected;
use crate::{
    SimpleCombatantStats, SimpleLifeLeechHitExpected, SimpleSelfDestructProfile,
    SimpleStatusInstance,
};

pub const SELF_DESTRUCT_ARMING_STATUS_ID: &str = "Self_Destruct_Arming_Status";
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SelfDestructEvent {
    None,
    Armed,
    Exploded,
}

/// Runs one tick of the reworked Self-Destruct state machine.
///
/// Mechanics (reworked 2026-04-21):
/// - Passive: when attacker HP ≤ `trigger_hp_ratio_lte` and cooldown elapsed,
///   apply `Self_Destruct_Arming_Status` with `arming_stacks` (default 3).
///   Stacks decay at the standard 1-stack-per-3s rate, giving a 9s fuse.
/// - The arming status is NOT in `is_persistent_pvp_status`, so its decay is
///   unaffected by facetank-off.
/// - Explosion fires when the arming status stacks reach 0 (natural decay
///   OR cleanse) OR when the attacker dies while armed (hooked in Phase 16).
/// - On explosion: deal `damage_pct`% of defender max HP, apply statuses
///   (e.g. 10 Burn). Then cap attacker HP DOWN to `self_hp_floor_pct`% of
///   max HP (only if currently higher).
/// - Cooldown starts at explosion time.
#[allow(clippy::too_many_arguments)]
pub fn update_simple_self_destruct_state(
    time: f64,
    attacker: &SimpleCombatantStats,
    defender: &SimpleCombatantStats,
    profile: &SimpleSelfDestructProfile,
    attacker_hp: &mut f64,
    defender_hp: &mut f64,
    attacker_statuses: &mut BTreeMap<String, SimpleStatusInstance>,
    defender_statuses: &mut BTreeMap<String, SimpleStatusInstance>,
    self_destruct_cooldown_until: &mut f64,
    self_destruct_armed: &mut bool,
) -> SelfDestructEvent {
    // Armed: watch for stacks hitting 0 (natural decay or cleanse).
    if *self_destruct_armed {
        let arming_stacks = attacker_statuses
            .get(SELF_DESTRUCT_ARMING_STATUS_ID)
            .map(|s| s.stacks)
            .unwrap_or(0.0);
        if arming_stacks <= 1e-9 {
            trigger_self_destruct_explosion(
                time,
                attacker,
                defender,
                profile,
                attacker_hp,
                defender_hp,
                attacker_statuses,
                defender_statuses,
                self_destruct_cooldown_until,
                self_destruct_armed,
            );
            return SelfDestructEvent::Exploded;
        }
        return SelfDestructEvent::None;
    }

    // Not armed: check cooldown + HP trigger.
    if time < *self_destruct_cooldown_until {
        return SelfDestructEvent::None;
    }
    let hp_ratio = *attacker_hp / attacker.health.max(1.0);
    if hp_ratio > profile.trigger_hp_ratio_lte {
        return SelfDestructEvent::None;
    }

    // Arm: apply the arming status.
    let existing = attacker_statuses
        .get(SELF_DESTRUCT_ARMING_STATUS_ID)
        .cloned();
    let mut slot = existing;
    apply_simple_status(
        time,
        SELF_DESTRUCT_ARMING_STATUS_ID,
        profile.arming_stacks.max(1.0),
        &mut slot,
    );
    match slot {
        Some(instance) => {
            attacker_statuses.insert(SELF_DESTRUCT_ARMING_STATUS_ID.to_string(), instance);
        }
        None => {
            attacker_statuses.remove(SELF_DESTRUCT_ARMING_STATUS_ID);
        }
    }
    *self_destruct_armed = true;
    SelfDestructEvent::Armed
}

/// Fires the Self-Destruct explosion: damage + statuses to defender, HP cap
/// DOWN on attacker, start cooldown, clear armed flag, remove arming status.
/// Called by the tick loop when stacks expire, and by the death hook when
/// the attacker dies while armed.
#[allow(clippy::too_many_arguments)]
pub fn trigger_self_destruct_explosion(
    time: f64,
    _attacker: &SimpleCombatantStats,
    defender: &SimpleCombatantStats,
    profile: &SimpleSelfDestructProfile,
    attacker_hp: &mut f64,
    defender_hp: &mut f64,
    attacker_statuses: &mut BTreeMap<String, SimpleStatusInstance>,
    defender_statuses: &mut BTreeMap<String, SimpleStatusInstance>,
    self_destruct_cooldown_until: &mut f64,
    self_destruct_armed: &mut bool,
) {
    let damage = apply_unbreakable_damage_cap(
        defender.health * (profile.damage_pct / 100.0),
        defender,
    )
    .min((*defender_hp).max(0.0));
    *defender_hp -= damage;
    apply_incoming_statuses_to_target(
        time,
        defender,
        *defender_hp,
        defender_statuses,
        &profile.apply_statuses,
    );
    // Cap DOWN: if attacker HP is above the cap, set to cap; if below, leave.
    let cap = _attacker.health * (profile.self_hp_floor_pct / 100.0);
    if *attacker_hp > cap {
        *attacker_hp = cap;
    }
    *self_destruct_cooldown_until = time + profile.cooldown_sec;
    *self_destruct_armed = false;
    attacker_statuses.remove(SELF_DESTRUCT_ARMING_STATUS_ID);
}

pub const HUNKER_EFFECT_DELAY_SEC: f64 = 5.0;

pub fn apply_hunker_to_damage(damage: f64, hunker_on: bool) -> f64 {
    if hunker_on {
        damage * 0.5
    } else {
        damage
    }
}

pub fn apply_hunker_to_incoming(damage: f64, hunker_reduction_pct: f64, hunker_on: bool) -> f64 {
    if hunker_on {
        damage * (1.0 - (hunker_reduction_pct / 100.0).clamp(0.0, 1.0))
    } else {
        damage
    }
}

pub fn is_hunker_effect_active(
    hunker_on: bool,
    hunker_effect_starts_at: f64,
    current_time: f64,
) -> bool {
    hunker_on && current_time + 1.0e-9 >= hunker_effect_starts_at
}

pub fn resolve_hunker_effect_starts_at(
    previous_hunker_on: bool,
    next_hunker_on: bool,
    current_time: f64,
    current_effect_starts_at: f64,
    prior_activation_count: u32,
) -> f64 {
    if !next_hunker_on {
        f64::INFINITY
    } else if !previous_hunker_on {
        if prior_activation_count == 0 {
            current_time
        } else {
            current_time + HUNKER_EFFECT_DELAY_SEC
        }
    } else if current_effect_starts_at.is_finite() {
        current_effect_starts_at
    } else {
        current_time
    }
}

pub fn hunker_decision_cadence_reached(
    current_time: f64,
    last_decision_at: f64,
    cadence_sec: f64,
) -> bool {
    current_time + 1.0e-9 >= last_decision_at + cadence_sec
}

pub fn simulate_simple_life_leech_hit(
    time: f64,
    attacker: &SimpleCombatantStats,
    attacker_hp: f64,
    damage_dealt: f64,
    actives_on: bool,
    life_leech_active_until: f64,
    life_leech_value: f64,
) -> SimpleLifeLeechHitExpected {
    if !actives_on
        || damage_dealt <= 0.0
        || time >= life_leech_active_until
        || life_leech_value <= 0.0
    {
        return SimpleLifeLeechHitExpected {
            attacker_hp,
            life_leech_healed_delta: 0.0,
            ability_applied_count: 0,
        };
    }

    let heal = (damage_dealt * life_leech_value).max(0.0);
    let next_hp = (attacker_hp + heal).min(attacker.health);
    let healed_delta = (next_hp - attacker_hp).max(0.0);

    SimpleLifeLeechHitExpected {
        attacker_hp: next_hp,
        life_leech_healed_delta: healed_delta,
        ability_applied_count: if healed_delta > 0.0 { 1 } else { 0 },
    }
}

#[cfg(test)]
pub fn simulate_simple_adrenaline_activation(
    time: f64,
    attacker: &SimpleCombatantStats,
    actives_on: bool,
    ability_disabled: bool,
    starting_adrenaline_active_until: f64,
    starting_adrenaline_cooldown_until: f64,
) -> SimpleAdrenalineExpected {
    let mut adrenaline_active_until = starting_adrenaline_active_until;
    let mut adrenaline_cooldown_until = starting_adrenaline_cooldown_until;
    let mut ability_applied_count = 0;

    if actives_on
        && !ability_disabled
        && time >= adrenaline_cooldown_until
        && time >= adrenaline_active_until
    {
        adrenaline_active_until = time + 30.0;
        adrenaline_cooldown_until = time + scale_active_cooldown(attacker, 90.0);
        ability_applied_count = 1;
    }

    SimpleAdrenalineExpected {
        adrenaline_active_until,
        adrenaline_cooldown_until,
        ability_applied_count,
    }
}

pub fn apply_simple_fortify(
    time: f64,
    attacker: &SimpleCombatantStats,
    statuses: &mut BTreeMap<String, SimpleStatusInstance>,
    fortify_cooldown_until: &mut f64,
    fortify_immune_until: &mut f64,
    fortify_weight_bonus_until: &mut f64,
) -> bool {
    if time < *fortify_cooldown_until {
        return false;
    }

    let removable: Vec<String> = statuses
        .iter()
        .filter(|(status_id, inst)| {
            crate::statuses::is_fortify_cleansable_instance(status_id, inst)
        })
        .map(|(status_id, _)| status_id.clone())
        .collect();
    if removable.is_empty() {
        return false;
    }
    for status_id in removable {
        statuses.remove(&status_id);
    }

    *fortify_cooldown_until = time + scale_active_cooldown(attacker, 90.0);
    *fortify_immune_until = time + 9.0;
    *fortify_weight_bonus_until = time + 9.0;
    true
}
