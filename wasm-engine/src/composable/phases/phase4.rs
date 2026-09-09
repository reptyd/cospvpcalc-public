//! Phase 4 cluster: all process_phase_4_* functions plus the shared
//! helper effects (apply_cause_fear_effect etc.) extracted from phases/mod.rs.
//!
//! These helpers are also called from sandbox.rs via super::phases::apply_*
//! so they are re-exported from phases/mod.rs at pub(super) visibility.

#![allow(clippy::too_many_arguments)]

use super::super::*;
use crate::composable::ability_metadata::ability_blocked_by_necropoison;
use crate::spec_constants::LIFE_LEECH_DURATION_SEC;

// Reflux and Seedling Mist are the same shape: a charge, then an area that
// appears where the throw lands, lasts a fixed time and ticks once a second.
// The delay between the completion of the charge and the area is the one figure
// a fight cannot derive - the throw has no distance to cross here - so it is
// chosen, and it is the same for both.
use crate::spec_constants::{
    REFLUX_AREA_DELAY_SEC, REFLUX_CHARGE_SEC, REFLUX_DURATION_SEC, REFLUX_TICK_INTERVAL_SEC,
    SEEDLING_MIST_AREA_DELAY_SEC, SEEDLING_MIST_DURATION_SEC,
};

/// How many ticks an area of `duration` seconds carries at `interval` seconds
/// apart, the first of them one interval in. A puddle that lasts its whole
/// duration ticks on every second of it, the last one at its expiry.
fn area_tick_count(duration_sec: f64, interval_sec: f64) -> u32 {
    if interval_sec <= 0.0 {
        return 0;
    }
    (duration_sec / interval_sec).round().max(0.0) as u32
}
/// Phase 4 areas cluster: Phase 4c (Frost Snare ticks), Phase 4c-bis
/// (Poison Area ticks), Phase 4c-ter (Yolk Bomb area), Phase 4c-quat
/// (Divination activation arming 3 bite charges). Each is gated by
/// its own `has_any_*` flag.
pub(in super::super) fn process_phase_4_areas_cluster(
    ctx: &mut PhaseContext<'_, '_>,
    has_any_frost_snare: bool,
    has_any_poison_area: bool,
    has_any_yolk_bomb: bool,
    has_any_divination: bool,
) {
    // Phase 4c: Frost Snare ticks
    if has_any_frost_snare {
        if ctx.config.attacker_frost_snare
            && !ctx.config.head_start_inert_a(ctx.time)
            && ctx.a.next_frost_snare <= ctx.time + 1e-9
            && !ability_blocked_by_necropoison("Frost Snare", &ctx.a.statuses) && !ctx.a.in_cocoon_phase_2(ctx.time)
            && ctx.time >= ctx.a.frost_snare_cooldown_until
        {
            apply_frost_snare_effect(
                ctx.time, ctx.attacker, ctx.defender,
                ctx.a, ctx.b, "A", ctx.combat_log, ctx.record_trace,
            );
        }
        if ctx.config.defender_frost_snare
            && !ctx.config.head_start_inert_b(ctx.time)
            && ctx.b.next_frost_snare <= ctx.time + 1e-9
            && !ability_blocked_by_necropoison("Frost Snare", &ctx.b.statuses) && !ctx.b.in_cocoon_phase_2(ctx.time)
            && ctx.time >= ctx.b.frost_snare_cooldown_until
        {
            apply_frost_snare_effect(
                ctx.time, ctx.defender, ctx.attacker,
                ctx.b, ctx.a, "B", ctx.combat_log, ctx.record_trace,
            );
        }
    }

    // Phase 4c-bis: Poison Area ticks
    if has_any_poison_area {
        if ctx.config.attacker_poison_area
            && !ctx.config.head_start_inert_a(ctx.time)
            && ctx.a_within_reach("Poison Area")
            && ctx.a.next_poison_area <= ctx.time + 1e-9
            && !ability_blocked_by_necropoison("Poison Area", &ctx.a.statuses) && !ctx.a.in_cocoon_phase_2(ctx.time)
            && ctx.time >= ctx.a.poison_area_cooldown_until
        {
            apply_poison_area_effect(
                ctx.time, ctx.attacker, ctx.defender,
                ctx.a, ctx.b, "A", ctx.combat_log, ctx.record_trace,
            );
        }
        if ctx.config.defender_poison_area
            && !ctx.config.head_start_inert_b(ctx.time)
            && ctx.b_within_reach("Poison Area")
            && ctx.b.next_poison_area <= ctx.time + 1e-9
            && !ability_blocked_by_necropoison("Poison Area", &ctx.b.statuses) && !ctx.b.in_cocoon_phase_2(ctx.time)
            && ctx.time >= ctx.b.poison_area_cooldown_until
        {
            apply_poison_area_effect(
                ctx.time, ctx.defender, ctx.attacker,
                ctx.b, ctx.a, "B", ctx.combat_log, ctx.record_trace,
            );
        }
    }

    // Phase 4c-ter: Yolk Bomb ticks
    if has_any_yolk_bomb {
        if ctx.config.attacker_yolk_bomb
            && !ctx.config.head_start_inert_a(ctx.time)
            && ctx.a.next_yolk_bomb <= ctx.time + 1e-9
            && !ability_blocked_by_necropoison("Yolk Bomb", &ctx.a.statuses) && !ctx.a.in_cocoon_phase_2(ctx.time)
            && ctx.time >= ctx.a.yolk_bomb_cooldown_until
        {
            apply_yolk_bomb_effect(
                ctx.time,
                ctx.config.attacker_yolk_bomb_value.as_deref(),
                ctx.attacker, ctx.defender,
                ctx.a, ctx.b, "A", ctx.combat_log, ctx.record_trace,
            );
        }
        if ctx.config.defender_yolk_bomb
            && !ctx.config.head_start_inert_b(ctx.time)
            && ctx.b.next_yolk_bomb <= ctx.time + 1e-9
            && !ability_blocked_by_necropoison("Yolk Bomb", &ctx.b.statuses) && !ctx.b.in_cocoon_phase_2(ctx.time)
            && ctx.time >= ctx.b.yolk_bomb_cooldown_until
        {
            apply_yolk_bomb_effect(
                ctx.time,
                ctx.config.defender_yolk_bomb_value.as_deref(),
                ctx.defender, ctx.attacker,
                ctx.b, ctx.a, "B", ctx.combat_log, ctx.record_trace,
            );
        }
    }

    // Phase 4c-quat: Divination activation
    if has_any_divination {
        if ctx.config.attacker_divination
            && !ctx.config.head_start_inert_a(ctx.time)
            && ctx.a.next_divination <= ctx.time + 1e-9
            && !ability_blocked_by_necropoison("Divination", &ctx.a.statuses) && !ctx.a.in_cocoon_phase_2(ctx.time)
            && ctx.time >= ctx.a.divination_cooldown_until
            && ctx.a.divination_charges_left == 0
        {
            apply_divination_effect(
                ctx.time, ctx.attacker, ctx.a, "A", ctx.combat_log, ctx.record_trace,
            );
        }
        if ctx.config.defender_divination
            && !ctx.config.head_start_inert_b(ctx.time)
            && ctx.b.next_divination <= ctx.time + 1e-9
            && !ability_blocked_by_necropoison("Divination", &ctx.b.statuses) && !ctx.b.in_cocoon_phase_2(ctx.time)
            && ctx.time >= ctx.b.divination_cooldown_until
            && ctx.b.divination_charges_left == 0
        {
            apply_divination_effect(
                ctx.time, ctx.defender, ctx.b, "B", ctx.combat_log, ctx.record_trace,
            );
        }
    }
}

/// Apply one Frost Snare tick to `opp` (5 stacks Frostbite) and set
/// the user's 205 s cooldown + `next_frost_snare` re-arm. Shared by the
/// phase4c handler and the Sandbox Manual click path
/// (`sandbox::try_force_frost_snare`). Mirrors the structure of
/// [`apply_drowsy_area_effect`].
pub(in super::super) fn apply_frost_snare_effect(
    time: f64,
    user_stats: &SimpleCombatantStats,
    opp_stats: &SimpleCombatantStats,
    user: &mut CombatSide,
    opp: &mut CombatSide,
    user_label: &str,
    combat_log: &mut Vec<crate::contracts::CombatLogEntry>,
    record_trace: bool,
) {
    let opp_label = if user_label == "A" { "B" } else { "A" };
    apply_statuses_with_trace(
        time, opp_stats, opp.hp, &mut opp.statuses,
        &[SimpleAppliedStatus {
            status_id: "Frostbite_Status".to_string(),
            stacks: 5.0, ..Default::default() }],
        opp.fortify_immune_until,
        user_label, user.hp, opp_label, "Frost Snare",
        if record_trace { Some(combat_log) } else { None },
    );
    charge_active_cooldown(&mut user.frost_snare_cooldown_until, time, user_stats, 205.0);
    user.next_frost_snare = user.frost_snare_cooldown_until;
    record_ability_event(user, user_label, combat_log, record_trace, time, "Frost Snare");
}

/// Apply one Poison Area tick to `opp` (5 stacks Poison) and set the
/// user's 15 s cooldown + `next_poison_area` re-arm. Shared by the
/// phase4c-bis handler and `sandbox::try_force_poison_area`.
pub(in super::super) fn apply_poison_area_effect(
    time: f64,
    user_stats: &SimpleCombatantStats,
    opp_stats: &SimpleCombatantStats,
    user: &mut CombatSide,
    opp: &mut CombatSide,
    user_label: &str,
    combat_log: &mut Vec<crate::contracts::CombatLogEntry>,
    record_trace: bool,
) {
    let opp_label = if user_label == "A" { "B" } else { "A" };
    apply_statuses_with_trace(
        time, opp_stats, opp.hp, &mut opp.statuses,
        &[SimpleAppliedStatus {
            status_id: "Poison_Status".to_string(),
            stacks: 5.0, ..Default::default() }],
        opp.fortify_immune_until,
        user_label, user.hp, opp_label, "Poison Area",
        if record_trace { Some(combat_log) } else { None },
    );
    charge_active_cooldown(&mut user.poison_area_cooldown_until, time, user_stats, 15.0);
    user.next_poison_area = user.poison_area_cooldown_until;
    record_ability_event(user, user_label, combat_log, record_trace, time, "Poison Area");
}

/// Detonate Yolk Bomb (routes self/opponent by `value` via
/// [`apply_yolk_bomb`]) and set the user's 30 s cooldown +
/// `next_yolk_bomb` re-arm. Shared by the phase4c-ter handler and
/// `sandbox::try_force_yolk_bomb`. The `opp` side carries the
/// fortify-immune read needed for the enemy-status routing; the user's
/// own fortify-immune / weight-bonus windows are mutated in place for
/// the self-fortify routing.
#[allow(clippy::too_many_arguments)]
pub(in super::super) fn apply_yolk_bomb_effect(
    time: f64,
    value: Option<&str>,
    user_stats: &SimpleCombatantStats,
    opp_stats: &SimpleCombatantStats,
    user: &mut CombatSide,
    opp: &mut CombatSide,
    user_label: &str,
    combat_log: &mut Vec<crate::contracts::CombatLogEntry>,
    record_trace: bool,
) {
    apply_yolk_bomb(
        time,
        value,
        user_stats,
        opp_stats,
        user.hp,
        opp.hp,
        &mut user.statuses,
        &mut opp.statuses,
        user.fortify_immune_until,
        opp.fortify_immune_until,
        &mut user.fortify_immune_until,
        &mut user.fortify_weight_bonus_until,
        user_label,
        if record_trace { Some(combat_log) } else { None },
    );
    charge_active_cooldown(&mut user.yolk_bomb_cooldown_until, time, user_stats, 30.0);
    user.next_yolk_bomb = user.yolk_bomb_cooldown_until;
    record_ability_event(user, user_label, combat_log, record_trace, time, "Yolk Bomb");
}

/// Grant the user 3 Divination bite charges and set the 120 s cooldown plus
/// the `next_divination` re-arm. Self-targeted (no opponent effect at
/// activation; the charges modify the user's subsequent bites). Shared
/// by the phase4c-quat handler and `sandbox::try_force_divination`.
pub(in super::super) fn apply_divination_effect(
    time: f64,
    user_stats: &SimpleCombatantStats,
    user: &mut CombatSide,
    user_label: &str,
    combat_log: &mut Vec<crate::contracts::CombatLogEntry>,
    record_trace: bool,
) {
    user.divination_charges_left = 3;
    charge_active_cooldown(&mut user.divination_cooldown_until, time, user_stats, 120.0);
    user.next_divination = user.divination_cooldown_until;
    record_ability_event(user, user_label, combat_log, record_trace, time, "Divination");
}

/// Phase 4 aura+trails cluster: Phase 4d (Aura subtype-driven ticks)
/// + Phase 4d-bis0 (Damage trails - Flame/Frost/Plague/Toxic). Aura
///   status ids are pre-resolved by the driver (the subtype is in
///   config but the status id mapping depends on it); damage trails
///   loop over those four per side.
pub(in super::super) fn process_phase_4_aura_and_trails_cluster(
    ctx: &mut PhaseContext<'_, '_>,
    has_any_aura: bool,
    has_any_damage_trail: bool,
    attacker_aura_status: Option<&'static str>,
    defender_aura_status: Option<&'static str>,
    counters: &mut DamageCounters,
) {
    // Phase 4d: Aura ticks
    if has_any_aura {
        if let Some(next_tick) = ctx.a.aura_next_tick_at {
            if (next_tick - ctx.time).abs() <= 1e-9 && ctx.a.aura_on && !ctx.a.in_cocoon_phase_2(ctx.time)
                && ctx.a_within_reach("Aura") {
                if let Some(status_id) = attacker_aura_status {
                    let subtype = ctx.config.attacker_aura_subtype.as_deref().unwrap_or("");
                    let display = format!("Aura ({})", subtype);
                    apply_statuses_with_trace(
                        ctx.time, ctx.defender, ctx.b.hp, &mut ctx.b.statuses,
                        &[SimpleAppliedStatus {
                            status_id: status_id.to_string(),
                            stacks: AURA_AILMENT_STACKS,
                            source_ability: Some(display.clone()),
                            ..Default::default()
                        }],
                        ctx.b.fortify_immune_until,
                        "A", ctx.a.hp, "B", display.as_str(),
                        if ctx.record_trace { Some(ctx.combat_log) } else { None },
                    );
                }
                ctx.a.aura_next_tick_at = Some(ctx.time + AURA_TICK_SEC);
            }
        }
        if let Some(next_tick) = ctx.b.aura_next_tick_at {
            if (next_tick - ctx.time).abs() <= 1e-9 && ctx.b.aura_on && !ctx.b.in_cocoon_phase_2(ctx.time)
                && ctx.b_within_reach("Aura") {
                if let Some(status_id) = defender_aura_status {
                    let subtype = ctx.config.defender_aura_subtype.as_deref().unwrap_or("");
                    let display = format!("Aura ({})", subtype);
                    apply_statuses_with_trace(
                        ctx.time, ctx.attacker, ctx.a.hp, &mut ctx.a.statuses,
                        &[SimpleAppliedStatus {
                            status_id: status_id.to_string(),
                            stacks: AURA_AILMENT_STACKS,
                            source_ability: Some(display.clone()),
                            ..Default::default()
                        }],
                        ctx.a.fortify_immune_until,
                        "B", ctx.b.hp, "A", display.as_str(),
                        if ctx.record_trace { Some(ctx.combat_log) } else { None },
                    );
                }
                ctx.b.aura_next_tick_at = Some(ctx.time + AURA_TICK_SEC);
            }
        }
    }

    // Phase 4d-bis0: Damage trails ticks
    if has_any_damage_trail {
        if let Some(next_tick) = ctx.a.damage_trail_next_tick_at {
            if (next_tick - ctx.time).abs() <= 1e-9 {
                if ctx.time >= ctx.a.cocoon_phase2_until && ctx.a.death_time.is_none() {
                    let mut specs: Vec<(f64, String, String)> = vec![
                        (ctx.config.attacker_flame_trail_value, "Burn_Status".to_string(), "Flame Trail".to_string()),
                        (ctx.config.attacker_frost_trail_value, "Frostbite_Status".to_string(), "Frost Trail".to_string()),
                        (ctx.config.attacker_plague_trail_value, "Disease_Status".to_string(), "Plague Trail".to_string()),
                        (ctx.config.attacker_toxic_trail_value, "Poison_Status".to_string(), "Toxic Trail".to_string()),
                    ];
                    if let Some(status_id) = ctx.config.attacker_trail_status_id.as_deref() {
                        let label = format!(
                            "{} Trail",
                            status_id.strip_suffix("_Status").unwrap_or(status_id).replace('_', " ")
                        );
                        specs.push((ctx.config.attacker_trail_value, status_id.to_string(), label));
                    }
                    for (value, status_id, ability_name) in specs.iter() {
                        if is_damage_trail_active(ctx.a.hp, ctx.attacker.health, *value) {
                            let dmg = ctx.defender.health * DAMAGE_TRAIL_DAMAGE_FRACTION;
                            let actual =
                                apply_unbreakable_damage_cap(dmg, ctx.defender).min(ctx.b.hp.max(0.0));
                            // Route the damage-trail tick through the hook.
                            let actual = damage_pipeline::resolve_incoming_damage(
                                ctx.a, ctx.b, ctx.attacker, ctx.defender, ctx.time,
                                actual, actual, "trail",
                                ctx.combat_log, ctx.record_trace, "A", "B",
                            );
                            ctx.b.hp -= actual;
                            counters.dealt_a += actual;
                            // Trace the apply (source_ability stays None on the
                            // instance so non-traced runs are byte-identical;
                            // the label only drives the "<X> Trail applied <Y>"
                            // log event that the timeline reads to draw a lane).
                            apply_statuses_with_trace(
                                ctx.time, ctx.defender, ctx.b.hp, &mut ctx.b.statuses,
                                &[SimpleAppliedStatus {
                                    status_id: status_id.clone(),
                                    stacks: DAMAGE_TRAIL_STATUS_STACKS, ..Default::default() }],
                                ctx.b.fortify_immune_until,
                                "A", ctx.a.hp, "B", ability_name.as_str(),
                                if ctx.record_trace { Some(ctx.combat_log) } else { None },
                            );
                            if ctx.a.ability_activation_counts.get(ability_name.as_str()).copied().unwrap_or(0) == 0 {
                                record_ability_event(ctx.a, "A", ctx.combat_log, ctx.record_trace, ctx.time, ability_name);
                            }
                        }
                    }
                }
                ctx.a.damage_trail_next_tick_at = Some(ctx.time + DAMAGE_TRAIL_TICK_SEC);
            }
        }
        if let Some(next_tick) = ctx.b.damage_trail_next_tick_at {
            if (next_tick - ctx.time).abs() <= 1e-9 {
                if ctx.time >= ctx.b.cocoon_phase2_until && ctx.b.death_time.is_none() {
                    let mut specs: Vec<(f64, String, String)> = vec![
                        (ctx.config.defender_flame_trail_value, "Burn_Status".to_string(), "Flame Trail".to_string()),
                        (ctx.config.defender_frost_trail_value, "Frostbite_Status".to_string(), "Frost Trail".to_string()),
                        (ctx.config.defender_plague_trail_value, "Disease_Status".to_string(), "Plague Trail".to_string()),
                        (ctx.config.defender_toxic_trail_value, "Poison_Status".to_string(), "Toxic Trail".to_string()),
                    ];
                    if let Some(status_id) = ctx.config.defender_trail_status_id.as_deref() {
                        let label = format!(
                            "{} Trail",
                            status_id.strip_suffix("_Status").unwrap_or(status_id).replace('_', " ")
                        );
                        specs.push((ctx.config.defender_trail_value, status_id.to_string(), label));
                    }
                    for (value, status_id, ability_name) in specs.iter() {
                        if is_damage_trail_active(ctx.b.hp, ctx.defender.health, *value) {
                            let dmg = ctx.attacker.health * DAMAGE_TRAIL_DAMAGE_FRACTION;
                            let actual =
                                apply_unbreakable_damage_cap(dmg, ctx.attacker).min(ctx.a.hp.max(0.0));
                            // Route the damage-trail tick through the hook.
                            let actual = damage_pipeline::resolve_incoming_damage(
                                ctx.b, ctx.a, ctx.defender, ctx.attacker, ctx.time,
                                actual, actual, "trail",
                                ctx.combat_log, ctx.record_trace, "B", "A",
                            );
                            ctx.a.hp -= actual;
                            counters.dealt_b += actual;
                            apply_statuses_with_trace(
                                ctx.time, ctx.attacker, ctx.a.hp, &mut ctx.a.statuses,
                                &[SimpleAppliedStatus {
                                    status_id: status_id.clone(),
                                    stacks: DAMAGE_TRAIL_STATUS_STACKS, ..Default::default() }],
                                ctx.a.fortify_immune_until,
                                "B", ctx.b.hp, "A", ability_name.as_str(),
                                if ctx.record_trace { Some(ctx.combat_log) } else { None },
                            );
                            if ctx.b.ability_activation_counts.get(ability_name.as_str()).copied().unwrap_or(0) == 0 {
                                record_ability_event(ctx.b, "B", ctx.combat_log, ctx.record_trace, ctx.time, ability_name);
                            }
                        }
                    }
                }
                ctx.b.damage_trail_next_tick_at = Some(ctx.time + DAMAGE_TRAIL_TICK_SEC);
            }
        }
    }
}

/// Oxygen / Moisture per-second drain + damage tick (Compare-only global
/// mode). Mirrors the per-side DOT-tick dispatch shape: each side self-gates on
/// its `oxy_moist_next_tick_at` due-time, drains the active-mode pool by 1, and
/// once the pool is depleted applies 5% max HP/sec - FLOORED at 50% max HP for
/// ground/moisture (drying never kills) and UNFLOORED for underwater/oxygen
/// (drowning is lethal; the normal Phase-16 death path fires when hp <= 0).
///
/// Re-arm is a strict forward advance (`+1`), and only while the side is alive
/// and the mode is on; a dead side parks the timer at INFINITY so the scheduler
/// never pins next_time at/below time (healing-pulse cost-bug class). Gated by
/// `has_any_oxygen_moisture` so off / all-immune runs never enter here.
pub(in super::super) fn process_phase_4_oxygen_moisture_tick(
    ctx: &mut PhaseContext<'_, '_>,
) {
    let lethal = match ctx.config.oxygen_moisture_mode.as_deref() {
        Some("ground") => false,
        Some("underwater") => true,
        _ => return,
    };
    tick_oxygen_moisture_side(
        ctx.a, ctx.attacker.health, ctx.time, lethal,
    );
    tick_oxygen_moisture_side(
        ctx.b, ctx.defender.health, ctx.time, lethal,
    );
}

/// One side's Oxygen/Moisture tick. `max_hp` is the side's raw max HP. A dead
/// side pauses (timer parked at INFINITY); a live side drains its pool and,
/// once depleted, takes the floored (moisture) or lethal (oxygen) %maxHP hit,
/// then re-arms one second forward.
fn tick_oxygen_moisture_side(
    side: &mut crate::composable::side::CombatSide,
    max_hp: f64,
    time: f64,
    lethal: bool,
) {
    if side.oxy_moist_next_tick_at > time + 1e-9 {
        return;
    }
    // Dead side: stop (do not crawl). Park the timer so the scheduler drops it.
    if side.death_time.is_some() {
        side.oxy_moist_next_tick_at = f64::INFINITY;
        return;
    }
    let pool = if lethal {
        &mut side.oxygen_remaining
    } else {
        &mut side.moisture_remaining
    };
    let new_hp = crate::oxygen_moisture::tick(pool, side.hp, max_hp, lethal);
    side.hp = new_hp;
    side.oxy_moist_next_tick_at = time + crate::oxygen_moisture::DRAIN_PER_SEC;
}

/// Phase 4g + 4h + 4i + 4j + 4k: delayed-activation policy actives.
///
/// All five abilities route through the unified `policy_bridge` for
/// activation decisions. UR/HC/Adrenaline use a "planned_at" delayed
/// scheme - when the policy fires, the ability either executes
/// immediately (precision modes) or queues a delayed activation that
/// fires when its scheduled boundary arrives. Life Leech is a simple
/// "fire when policy returns yes" pattern. Warden's Rage is a toggle
/// (on/off via `toggle_state_now`) with cooldown gating fresh
/// turn-ons.
#[allow(clippy::too_many_arguments)]
pub(in super::super) fn process_phase_4_delayed_activations_cluster(
    ctx: &mut PhaseContext<'_, '_>,
    ability_policy: SimpleAbilityTimingMode,
    is_initial_tick: bool,
    ability_timing_events_a: &mut Vec<String>,
    ability_timing_events_b: &mut Vec<String>,
    warden_rage_events_a: &mut Vec<String>,
    warden_rage_events_b: &mut Vec<String>,
    // Toggle rollout held Warden's manual intent (`TOGGLE_ROLLOUT`);
    // `None` => pi-zero gate. Drives ONLY the manual controller's `next_on`;
    // the passive controller, cooldown, and buffered-regen flush stay in
    // the real engine.
    warden_forced_a: Option<bool>,
    warden_forced_b: Option<bool>,
) {
    // Phase 4g: Unbridled Rage activation
    if ctx.config.attacker_unbridled_rage && !ctx.a.posture_settled_non_standing()
        && !ctx.config.head_start_inert_a(ctx.time)
        && !ability_blocked_by_necropoison("Unbridled Rage", &ctx.a.statuses) && !ctx.a.in_cocoon_phase_2(ctx.time)
        // game CanUse: refused below half a pool, and the activation spends
        // that half. Reads as payable when the fight does not model stamina.
        && (!ctx.config.stamina_enabled
            || crate::composable::stamina::can_pay(
                &*ctx.a,
                crate::composable::stamina::cost_from_max(&*ctx.a, ctx.attacker, crate::composable::stamina::UNBRIDLED_RAGE_STAMINA_FRACTION),
            ))
    {
        if ctx.time < ctx.a.unbridled_rage_cooldown_until || ctx.time < ctx.a.unbridled_rage_active_until {
            ctx.a.unbridled_rage_planned_at = 0.0;
        } else if ctx.a.unbridled_rage_planned_at > ctx.time + 1e-9 {
        } else if ctx.a.unbridled_rage_planned_at > 0.0 && ctx.time + 1e-9 >= ctx.a.unbridled_rage_planned_at {
            ctx.a.unbridled_rage_planned_at = 0.0;
            ctx.a.unbridled_rage_active_until = ctx.time + 30.0;
            charge_active_cooldown(&mut ctx.a.unbridled_rage_cooldown_until, ctx.time, ctx.attacker, 120.0);
            if ctx.config.stamina_enabled {
                crate::composable::stamina::spend(
                    ctx.a,
                    crate::composable::stamina::cost_from_max(&*ctx.a, ctx.attacker, crate::composable::stamina::UNBRIDLED_RAGE_STAMINA_FRACTION),
                );
            }
            push_timing_event(ability_timing_events_a, format!("[Unbridled Rage] t={:.2} delayed_fire", ctx.time));
            record_ability_event(ctx.a, "A", ctx.combat_log, ctx.record_trace, ctx.time, "Unbridled Rage");
        } else if !is_initial_tick {
            let policy_ur = resolve_ability_policy(ability_policy, ctx.config.attacker_ability_policy_overrides.unbridled_rage);
            let self_side = policy_bridge::build_policy_side(&*ctx.a, ctx.attacker, ctx.attacker_breath, std::iter::empty());
            let opp_side = policy_bridge::build_policy_side(&*ctx.b, ctx.defender, ctx.defender_breath, std::iter::empty());
            let mode = policy_bridge::map_timing_mode(policy_ur);
            if policy_bridge::should_activate_now(
                crate::policy::decisions::unbridled_rage::UNBRIDLED_RAGE_DECISION_ID,
                self_side, opp_side, ctx.time, mode,
            ) {
                ctx.a.unbridled_rage_planned_at = 0.0;
                ctx.a.unbridled_rage_active_until = ctx.time + 30.0;
                charge_active_cooldown(&mut ctx.a.unbridled_rage_cooldown_until, ctx.time, ctx.attacker, 120.0);
                if ctx.config.stamina_enabled {
                    crate::composable::stamina::spend(
                        ctx.a,
                        crate::composable::stamina::cost_from_max(&*ctx.a, ctx.attacker, crate::composable::stamina::UNBRIDLED_RAGE_STAMINA_FRACTION),
                    );
                }
                push_timing_event(ability_timing_events_a, format!("[Unbridled Rage] t={:.2} fire", ctx.time));
                record_ability_event(ctx.a, "A", ctx.combat_log, ctx.record_trace, ctx.time, "Unbridled Rage");
            }
        }
    }
    if ctx.config.defender_unbridled_rage && !ctx.b.posture_settled_non_standing()
        && !ctx.config.head_start_inert_b(ctx.time)
        && !ability_blocked_by_necropoison("Unbridled Rage", &ctx.b.statuses) && !ctx.b.in_cocoon_phase_2(ctx.time)
        // game CanUse: refused below half a pool, and the activation spends
        // that half. Reads as payable when the fight does not model stamina.
        && (!ctx.config.stamina_enabled
            || crate::composable::stamina::can_pay(
                &*ctx.b,
                crate::composable::stamina::cost_from_max(&*ctx.b, ctx.defender, crate::composable::stamina::UNBRIDLED_RAGE_STAMINA_FRACTION),
            ))
    {
        if ctx.time < ctx.b.unbridled_rage_cooldown_until || ctx.time < ctx.b.unbridled_rage_active_until {
            ctx.b.unbridled_rage_planned_at = 0.0;
        } else if ctx.b.unbridled_rage_planned_at > ctx.time + 1e-9 {
        } else if ctx.b.unbridled_rage_planned_at > 0.0 && ctx.time + 1e-9 >= ctx.b.unbridled_rage_planned_at {
            ctx.b.unbridled_rage_planned_at = 0.0;
            ctx.b.unbridled_rage_active_until = ctx.time + 30.0;
            charge_active_cooldown(&mut ctx.b.unbridled_rage_cooldown_until, ctx.time, ctx.defender, 120.0);
            if ctx.config.stamina_enabled {
                crate::composable::stamina::spend(
                    ctx.b,
                    crate::composable::stamina::cost_from_max(&*ctx.b, ctx.defender, crate::composable::stamina::UNBRIDLED_RAGE_STAMINA_FRACTION),
                );
            }
            push_timing_event(ability_timing_events_b, format!("[Unbridled Rage] t={:.2} delayed_fire", ctx.time));
            record_ability_event(ctx.b, "B", ctx.combat_log, ctx.record_trace, ctx.time, "Unbridled Rage");
        } else if !is_initial_tick {
            let policy_ur = resolve_ability_policy(ability_policy, ctx.config.defender_ability_policy_overrides.unbridled_rage);
            let self_side = policy_bridge::build_policy_side(&*ctx.b, ctx.defender, ctx.defender_breath, std::iter::empty());
            let opp_side = policy_bridge::build_policy_side(&*ctx.a, ctx.attacker, ctx.attacker_breath, std::iter::empty());
            let mode = policy_bridge::map_timing_mode(policy_ur);
            if policy_bridge::should_activate_now(
                crate::policy::decisions::unbridled_rage::UNBRIDLED_RAGE_DECISION_ID,
                self_side, opp_side, ctx.time, mode,
            ) {
                ctx.b.unbridled_rage_planned_at = 0.0;
                ctx.b.unbridled_rage_active_until = ctx.time + 30.0;
                charge_active_cooldown(&mut ctx.b.unbridled_rage_cooldown_until, ctx.time, ctx.defender, 120.0);
                if ctx.config.stamina_enabled {
                    crate::composable::stamina::spend(
                        ctx.b,
                        crate::composable::stamina::cost_from_max(&*ctx.b, ctx.defender, crate::composable::stamina::UNBRIDLED_RAGE_STAMINA_FRACTION),
                    );
                }
                push_timing_event(ability_timing_events_b, format!("[Unbridled Rage] t={:.2} fire", ctx.time));
                record_ability_event(ctx.b, "B", ctx.combat_log, ctx.record_trace, ctx.time, "Unbridled Rage");
            }
        }
    }

    // Phase 4h: Hunter's Curse activation
    if ctx.config.attacker_hunters_curse && !ctx.a.posture_settled_non_standing()
        && !ctx.config.head_start_inert_a(ctx.time)
        && !ability_blocked_by_necropoison("Hunters Curse", &ctx.a.statuses) && !ctx.a.in_cocoon_phase_2(ctx.time)
        && ctx.a.hp >= ctx.attacker.health * 0.5 // game CanUse: blocked below 50% max HP
    {
        if ctx.time < ctx.a.hunters_curse_cooldown_until || ctx.time < ctx.a.hunters_curse_active_until {
            ctx.a.hunters_curse_planned_at = 0.0;
        } else if ctx.a.hunters_curse_planned_at > ctx.time + 1e-9 {
        } else if ctx.a.hunters_curse_planned_at > 0.0 && ctx.time + 1e-9 >= ctx.a.hunters_curse_planned_at {
            ctx.a.hunters_curse_planned_at = 0.0;
            ctx.a.hp = apply_hunters_curse_self_cost(ctx.a.hp, ctx.attacker);
            ctx.a.hunters_curse_active_until = ctx.time + 30.0;
            charge_active_cooldown(&mut ctx.a.hunters_curse_cooldown_until, ctx.time, ctx.attacker, 120.0);
            push_timing_event(ability_timing_events_a, format!("[Hunter's Curse] t={:.2} delayed_fire", ctx.time));
            ctx.a.hunters_curse_activation_count += 1;
            if ctx.record_trace {
                ctx.combat_log.push(crate::contracts::CombatLogEntry {
                    time: ctx.time,
                    entry_type: "ability".to_string(),
                    attacker: "A".to_string(),
                    damage: 0.0,
                    healing: None,
                    actor_hp_after: ctx.a.hp.max(0.0),
                    hp_side: "A".to_string(),
                    hp_after: ctx.a.hp.max(0.0),
                    description: Some("Hunters Curse activated".to_string()),
                    detail: None,
                    status_id: None,
                });
            }
        } else {
            let policy_hc = resolve_ability_policy(ability_policy, ctx.config.attacker_ability_policy_overrides.hunters_curse);
            if !is_initial_tick || policy_hc == SimpleAbilityTimingMode::ReallyFast {
                let self_side = policy_bridge::build_policy_side(&*ctx.a, ctx.attacker, ctx.attacker_breath, std::iter::empty());
                let opp_side = policy_bridge::build_policy_side(&*ctx.b, ctx.defender, ctx.defender_breath, std::iter::empty());
                let mode = policy_bridge::map_timing_mode(policy_hc);
                if policy_bridge::should_activate_now(
                    crate::policy::decisions::hunters_curse::HUNTERS_CURSE_DECISION_ID,
                    self_side, opp_side, ctx.time, mode,
                ) {
                    ctx.a.hunters_curse_planned_at = 0.0;
                    ctx.a.hp = apply_hunters_curse_self_cost(ctx.a.hp, ctx.attacker);
                    ctx.a.hunters_curse_active_until = ctx.time + 30.0;
                    charge_active_cooldown(&mut ctx.a.hunters_curse_cooldown_until, ctx.time, ctx.attacker, 120.0);
                    push_timing_event(ability_timing_events_a, format!("[Hunter's Curse] t={:.2} fire", ctx.time));
                    ctx.a.hunters_curse_activation_count += 1;
                    if ctx.record_trace {
                        ctx.combat_log.push(crate::contracts::CombatLogEntry {
                            time: ctx.time,
                            entry_type: "ability".to_string(),
                            attacker: "A".to_string(),
                            damage: 0.0,
                            healing: None,
                            actor_hp_after: ctx.a.hp.max(0.0),
                            hp_side: "A".to_string(),
                            hp_after: ctx.a.hp.max(0.0),
                            description: Some("Hunters Curse activated".to_string()),
                            detail: None,
                            status_id: None,
                        });
                    }
                }
            }
        }
    }
    if ctx.config.defender_hunters_curse && !ctx.b.posture_settled_non_standing()
        && !ctx.config.head_start_inert_b(ctx.time)
        && !ability_blocked_by_necropoison("Hunters Curse", &ctx.b.statuses) && !ctx.b.in_cocoon_phase_2(ctx.time)
        && ctx.b.hp >= ctx.defender.health * 0.5 // game CanUse: blocked below 50% max HP
    {
        if ctx.time < ctx.b.hunters_curse_cooldown_until || ctx.time < ctx.b.hunters_curse_active_until {
            ctx.b.hunters_curse_planned_at = 0.0;
        } else if ctx.b.hunters_curse_planned_at > ctx.time + 1e-9 {
        } else if ctx.b.hunters_curse_planned_at > 0.0 && ctx.time + 1e-9 >= ctx.b.hunters_curse_planned_at {
            ctx.b.hunters_curse_planned_at = 0.0;
            ctx.b.hp = apply_hunters_curse_self_cost(ctx.b.hp, ctx.defender);
            ctx.b.hunters_curse_active_until = ctx.time + 30.0;
            charge_active_cooldown(&mut ctx.b.hunters_curse_cooldown_until, ctx.time, ctx.defender, 120.0);
            push_timing_event(ability_timing_events_b, format!("[Hunter's Curse] t={:.2} delayed_fire", ctx.time));
            ctx.b.hunters_curse_activation_count += 1;
            if ctx.record_trace {
                ctx.combat_log.push(crate::contracts::CombatLogEntry {
                    time: ctx.time,
                    entry_type: "ability".to_string(),
                    attacker: "B".to_string(),
                    damage: 0.0,
                    healing: None,
                    actor_hp_after: ctx.b.hp.max(0.0),
                    hp_side: "B".to_string(),
                    hp_after: ctx.b.hp.max(0.0),
                    description: Some("Hunters Curse activated".to_string()),
                    detail: None,
                    status_id: None,
                });
            }
        } else {
            let policy_hc = resolve_ability_policy(ability_policy, ctx.config.defender_ability_policy_overrides.hunters_curse);
            if !is_initial_tick || policy_hc == SimpleAbilityTimingMode::ReallyFast {
                let self_side = policy_bridge::build_policy_side(&*ctx.b, ctx.defender, ctx.defender_breath, std::iter::empty());
                let opp_side = policy_bridge::build_policy_side(&*ctx.a, ctx.attacker, ctx.attacker_breath, std::iter::empty());
                let mode = policy_bridge::map_timing_mode(policy_hc);
                if policy_bridge::should_activate_now(
                    crate::policy::decisions::hunters_curse::HUNTERS_CURSE_DECISION_ID,
                    self_side, opp_side, ctx.time, mode,
                ) {
                    ctx.b.hunters_curse_planned_at = 0.0;
                    ctx.b.hp = apply_hunters_curse_self_cost(ctx.b.hp, ctx.defender);
                    ctx.b.hunters_curse_active_until = ctx.time + 30.0;
                    charge_active_cooldown(&mut ctx.b.hunters_curse_cooldown_until, ctx.time, ctx.defender, 120.0);
                    push_timing_event(ability_timing_events_b, format!("[Hunter's Curse] t={:.2} fire", ctx.time));
                    ctx.b.hunters_curse_activation_count += 1;
                    if ctx.record_trace {
                        ctx.combat_log.push(crate::contracts::CombatLogEntry {
                            time: ctx.time,
                            entry_type: "ability".to_string(),
                            attacker: "B".to_string(),
                            damage: 0.0,
                            healing: None,
                            actor_hp_after: ctx.b.hp.max(0.0),
                            hp_side: "B".to_string(),
                            hp_after: ctx.b.hp.max(0.0),
                            description: Some("Hunters Curse activated".to_string()),
                            detail: None,
                            status_id: None,
                        });
                    }
                }
            }
        }
    }

    // Phase 4i: Life Leech activation
    if ctx.config.attacker_life_leech_value > 0.0 && !ctx.a.posture_settled_non_standing()
        && !ctx.config.head_start_inert_a(ctx.time)
        && !ability_blocked_by_necropoison("Life Leech", &ctx.a.statuses) && !ctx.a.in_cocoon_phase_2(ctx.time)
        && ctx.time >= ctx.a.life_leech_cooldown_until
        && ctx.time >= ctx.a.life_leech_active_until
    {
        let policy_ll_a = resolve_ability_policy(ability_policy, ctx.config.attacker_ability_policy_overrides.life_leech);
        let self_side = policy_bridge::build_policy_side(
            &*ctx.a, ctx.attacker, ctx.attacker_breath,
            std::iter::once(policy_bridge::life_leech_value_extra(ctx.config.attacker_life_leech_value)),
        );
        let opp_side = policy_bridge::build_policy_side(&*ctx.b, ctx.defender, ctx.defender_breath, std::iter::empty());
        let mode = policy_bridge::map_timing_mode(policy_ll_a);
        if policy_bridge::should_activate_now(
            crate::policy::decisions::life_leech::LIFE_LEECH_DECISION_ID,
            self_side, opp_side, ctx.time, mode,
        ) {
            ctx.a.life_leech_active_until = ctx.time + LIFE_LEECH_DURATION_SEC;
            charge_active_cooldown(&mut ctx.a.life_leech_cooldown_until, ctx.time, ctx.attacker, 60.0);
            push_timing_event(ability_timing_events_a, format!("[Life Leech] t={:.2} fire", ctx.time));
            record_ability_event(ctx.a, "A", ctx.combat_log, ctx.record_trace, ctx.time, "Life Leech");
        }
    }
    if ctx.config.defender_life_leech_value > 0.0 && !ctx.b.posture_settled_non_standing()
        && !ctx.config.head_start_inert_b(ctx.time)
        && !ability_blocked_by_necropoison("Life Leech", &ctx.b.statuses) && !ctx.b.in_cocoon_phase_2(ctx.time)
        && ctx.time >= ctx.b.life_leech_cooldown_until
        && ctx.time >= ctx.b.life_leech_active_until
    {
        let policy_ll_b = resolve_ability_policy(ability_policy, ctx.config.defender_ability_policy_overrides.life_leech);
        let self_side = policy_bridge::build_policy_side(
            &*ctx.b, ctx.defender, ctx.defender_breath,
            std::iter::once(policy_bridge::life_leech_value_extra(ctx.config.defender_life_leech_value)),
        );
        let opp_side = policy_bridge::build_policy_side(&*ctx.a, ctx.attacker, ctx.attacker_breath, std::iter::empty());
        let mode = policy_bridge::map_timing_mode(policy_ll_b);
        if policy_bridge::should_activate_now(
            crate::policy::decisions::life_leech::LIFE_LEECH_DECISION_ID,
            self_side, opp_side, ctx.time, mode,
        ) {
            ctx.b.life_leech_active_until = ctx.time + LIFE_LEECH_DURATION_SEC;
            charge_active_cooldown(&mut ctx.b.life_leech_cooldown_until, ctx.time, ctx.defender, 60.0);
            push_timing_event(ability_timing_events_b, format!("[Life Leech] t={:.2} fire", ctx.time));
            record_ability_event(ctx.b, "B", ctx.combat_log, ctx.record_trace, ctx.time, "Life Leech");
        }
    }

    // Phase 4j: Warden's Rage toggle
    if ctx.config.attacker_warden_rage && !ctx.a.posture_settled_non_standing()
        && !ctx.config.head_start_inert_a(ctx.time)
        && !ctx.a.in_cocoon_phase_2(ctx.time) {
        let policy_wr = resolve_ability_policy(ability_policy, ctx.config.attacker_ability_policy_overrides.wardens_rage);
        let is_really_fast = policy_wr == SimpleAbilityTimingMode::ReallyFast;
        let next_on = match warden_forced_a {
            Some(v) => v,
            None => {
                let self_side = policy_bridge::build_policy_side(
                    &*ctx.a, ctx.attacker, ctx.attacker_breath,
                    [policy_bridge::warden_rage_currently_on_extra(ctx.a.warden_rage_on)],
                );
                let opp_side = policy_bridge::build_policy_side(&*ctx.b, ctx.defender, ctx.defender_breath, std::iter::empty());
                let mode = policy_bridge::map_timing_mode(policy_wr);
                policy_bridge::toggle_state_now(
                    crate::policy::decisions::wardens_rage::WARDEN_RAGE_DECISION_ID,
                    self_side, opp_side, ctx.time, mode,
                )
            }
        };
        // Manual controller. `next_on` is the manual (policy / RF) intent;
        // the passive controller (damage -> on, full HP -> off) runs in the
        // post-tick phase on top. The manual path owns `warden_rage_manual_on`
        // (the authority flag) and is cooldown-gated.
        if !ctx.a.warden_rage_manual_on && next_on && ctx.time >= ctx.a.warden_rage_cooldown_until {
            ctx.a.warden_rage_on = true;
            ctx.a.warden_rage_manual_on = true;
            ctx.a.warden_rage_stacks = wardens_rage_stacks_from_hp_ratio(ctx.a.hp / ctx.attacker.health.max(1.0));
            ctx.a.warden_rage_tap_until = if is_really_fast { 0.0 } else { ctx.time + WARDEN_RAGE_TAP_SEC };
            charge_active_cooldown(&mut ctx.a.warden_rage_cooldown_until, ctx.time, ctx.attacker, 30.0);
            // Count the deliberate manual activation as a use (the passive auto-on
            // is not a "use"). The timeline window itself is emitted by
            // `sync_conditional_passive_events`, not here.
            *ctx.a
                .ability_activation_counts
                .entry("Warden's Rage".to_string())
                .or_insert(0) += 1;
            let hp_ratio = ctx.a.hp / ctx.attacker.health.max(1.0);
            warden_rage_events_a.push(format!(
                "WR_ON t={:.1} hp={:.2} stacks={} cd={:.1}",
                ctx.time, hp_ratio, ctx.a.warden_rage_stacks, ctx.a.warden_rage_cooldown_until
            ));
        } else if ctx.a.warden_rage_manual_on && next_on {
            if is_really_fast {
                ctx.a.warden_rage_tap_until = 0.0;
            }
            ctx.a.warden_rage_stacks = wardens_rage_stacks_from_hp_ratio(ctx.a.hp / ctx.attacker.health.max(1.0));
        }
        // A precision plan's OFF intent (the Harvest release, or a committed
        // Off) must drop the switch even when the passive controller owns it
        // (`manual_on == false` under continuous fire) - otherwise the release
        // is a no-op and the buffered regen tick never flushes. `warden_forced_a`
        // is Some only on the replay-driven precision path (None => fast modes /
        // rollout off => byte-identical).
        if (ctx.a.warden_rage_manual_on || (warden_forced_a.is_some() && ctx.a.warden_rage_on))
            && !next_on
        {
            let hp_ratio = ctx.a.hp / ctx.attacker.health.max(1.0);
            warden_rage_events_a.push(format!(
                "WR_OFF t={:.1} hp={:.2} stacks={} cd={:.1}",
                ctx.time, hp_ratio, ctx.a.warden_rage_stacks, ctx.a.warden_rage_cooldown_until
            ));
            ctx.a.warden_rage_on = false;
            ctx.a.warden_rage_manual_on = false;
            ctx.a.warden_rage_stacks = 0;
            ctx.a.warden_rage_tap_until = 0.0;
        }
    }
    if ctx.config.defender_warden_rage && !ctx.b.posture_settled_non_standing()
        && !ctx.config.head_start_inert_b(ctx.time)
        && !ctx.b.in_cocoon_phase_2(ctx.time) {
        let policy_wr = resolve_ability_policy(ability_policy, ctx.config.defender_ability_policy_overrides.wardens_rage);
        let is_really_fast = policy_wr == SimpleAbilityTimingMode::ReallyFast;
        let next_on = match warden_forced_b {
            Some(v) => v,
            None => {
                let self_side = policy_bridge::build_policy_side(
                    &*ctx.b, ctx.defender, ctx.defender_breath,
                    [policy_bridge::warden_rage_currently_on_extra(ctx.b.warden_rage_on)],
                );
                let opp_side = policy_bridge::build_policy_side(&*ctx.a, ctx.attacker, ctx.attacker_breath, std::iter::empty());
                let mode = policy_bridge::map_timing_mode(policy_wr);
                policy_bridge::toggle_state_now(
                    crate::policy::decisions::wardens_rage::WARDEN_RAGE_DECISION_ID,
                    self_side, opp_side, ctx.time, mode,
                )
            }
        };
        // Manual controller (see the A-side block above for the model).
        if !ctx.b.warden_rage_manual_on && next_on && ctx.time >= ctx.b.warden_rage_cooldown_until {
            ctx.b.warden_rage_on = true;
            ctx.b.warden_rage_manual_on = true;
            ctx.b.warden_rage_stacks = wardens_rage_stacks_from_hp_ratio(ctx.b.hp / ctx.defender.health.max(1.0));
            ctx.b.warden_rage_tap_until = if is_really_fast { 0.0 } else { ctx.time + WARDEN_RAGE_TAP_SEC };
            charge_active_cooldown(&mut ctx.b.warden_rage_cooldown_until, ctx.time, ctx.defender, 30.0);
            *ctx.b
                .ability_activation_counts
                .entry("Warden's Rage".to_string())
                .or_insert(0) += 1;
            let hp_ratio = ctx.b.hp / ctx.defender.health.max(1.0);
            warden_rage_events_b.push(format!(
                "WR_ON t={:.1} hp={:.2} stacks={} cd={:.1}",
                ctx.time, hp_ratio, ctx.b.warden_rage_stacks, ctx.b.warden_rage_cooldown_until
            ));
        } else if ctx.b.warden_rage_manual_on && next_on {
            if is_really_fast {
                ctx.b.warden_rage_tap_until = 0.0;
            }
            ctx.b.warden_rage_stacks = wardens_rage_stacks_from_hp_ratio(ctx.b.hp / ctx.defender.health.max(1.0));
        }
        if (ctx.b.warden_rage_manual_on || (warden_forced_b.is_some() && ctx.b.warden_rage_on))
            && !next_on
        {
            let hp_ratio = ctx.b.hp / ctx.defender.health.max(1.0);
            warden_rage_events_b.push(format!(
                "WR_OFF t={:.1} hp={:.2} stacks={} cd={:.1}",
                ctx.time, hp_ratio, ctx.b.warden_rage_stacks, ctx.b.warden_rage_cooldown_until
            ));
            ctx.b.warden_rage_on = false;
            ctx.b.warden_rage_manual_on = false;
            ctx.b.warden_rage_stacks = 0;
            ctx.b.warden_rage_tap_until = 0.0;
        }
    }

    // Phase 4k: Adrenaline activation
    if ctx.config.attacker_adrenaline && !ctx.a.posture_settled_non_standing()
        && !ctx.config.head_start_inert_a(ctx.time)
        && !ability_blocked_by_necropoison("Adrenaline", &ctx.a.statuses) && !ctx.a.in_cocoon_phase_2(ctx.time)
    {
        if ctx.time < ctx.a.adrenaline_cooldown_until || ctx.time < ctx.a.adrenaline_active_until {
            ctx.a.adrenaline_planned_at = 0.0;
        } else if ctx.a.adrenaline_planned_at > ctx.time + 1e-9 {
        } else if ctx.a.adrenaline_planned_at > 0.0 && ctx.time + 1e-9 >= ctx.a.adrenaline_planned_at {
            ctx.a.adrenaline_planned_at = 0.0;
            ctx.a.adrenaline_active_until = ctx.time + 30.0;
            charge_active_cooldown(&mut ctx.a.adrenaline_cooldown_until, ctx.time, ctx.attacker, 90.0);
            push_timing_event(ability_timing_events_a, format!("[Adrenaline] t={:.2} delayed_fire", ctx.time));
            record_ability_event(ctx.a, "A", ctx.combat_log, ctx.record_trace, ctx.time, "Adrenaline");
        } else {
            let policy_adrenaline = resolve_ability_policy(ability_policy, ctx.config.attacker_ability_policy_overrides.adrenaline);
            let self_side = policy_bridge::build_policy_side(&*ctx.a, ctx.attacker, ctx.attacker_breath, std::iter::empty());
            let opp_side = policy_bridge::build_policy_side(&*ctx.b, ctx.defender, ctx.defender_breath, std::iter::empty());
            let mode = policy_bridge::map_timing_mode(policy_adrenaline);
            if policy_bridge::should_activate_now(
                crate::policy::decisions::adrenaline::ADRENALINE_DECISION_ID,
                self_side, opp_side, ctx.time, mode,
            ) {
                ctx.a.adrenaline_planned_at = 0.0;
                ctx.a.adrenaline_active_until = ctx.time + 30.0;
                charge_active_cooldown(&mut ctx.a.adrenaline_cooldown_until, ctx.time, ctx.attacker, 90.0);
                push_timing_event(ability_timing_events_a, format!("[Adrenaline] t={:.2} fire", ctx.time));
                record_ability_event(ctx.a, "A", ctx.combat_log, ctx.record_trace, ctx.time, "Adrenaline");
            }
        }
    }
    if ctx.config.defender_adrenaline && !ctx.b.posture_settled_non_standing()
        && !ctx.config.head_start_inert_b(ctx.time)
        && !ability_blocked_by_necropoison("Adrenaline", &ctx.b.statuses) && !ctx.b.in_cocoon_phase_2(ctx.time)
    {
        if ctx.time < ctx.b.adrenaline_cooldown_until || ctx.time < ctx.b.adrenaline_active_until {
            ctx.b.adrenaline_planned_at = 0.0;
        } else if ctx.b.adrenaline_planned_at > ctx.time + 1e-9 {
        } else if ctx.b.adrenaline_planned_at > 0.0 && ctx.time + 1e-9 >= ctx.b.adrenaline_planned_at {
            ctx.b.adrenaline_planned_at = 0.0;
            ctx.b.adrenaline_active_until = ctx.time + 30.0;
            charge_active_cooldown(&mut ctx.b.adrenaline_cooldown_until, ctx.time, ctx.defender, 90.0);
            push_timing_event(ability_timing_events_b, format!("[Adrenaline] t={:.2} delayed_fire", ctx.time));
            record_ability_event(ctx.b, "B", ctx.combat_log, ctx.record_trace, ctx.time, "Adrenaline");
        } else {
            let policy_adrenaline = resolve_ability_policy(ability_policy, ctx.config.defender_ability_policy_overrides.adrenaline);
            let self_side = policy_bridge::build_policy_side(&*ctx.b, ctx.defender, ctx.defender_breath, std::iter::empty());
            let opp_side = policy_bridge::build_policy_side(&*ctx.a, ctx.attacker, ctx.attacker_breath, std::iter::empty());
            let mode = policy_bridge::map_timing_mode(policy_adrenaline);
            if policy_bridge::should_activate_now(
                crate::policy::decisions::adrenaline::ADRENALINE_DECISION_ID,
                self_side, opp_side, ctx.time, mode,
            ) {
                ctx.b.adrenaline_planned_at = 0.0;
                ctx.b.adrenaline_active_until = ctx.time + 30.0;
                charge_active_cooldown(&mut ctx.b.adrenaline_cooldown_until, ctx.time, ctx.defender, 90.0);
                push_timing_event(ability_timing_events_b, format!("[Adrenaline] t={:.2} fire", ctx.time));
                record_ability_event(ctx.b, "B", ctx.combat_log, ctx.record_trace, ctx.time, "Adrenaline");
            }
        }
    }
}

/// Phase 4m + 4n + 4o + 4p: tick-based actives.
///
/// - Phase 4m (Frost Nova): drains Frostbite to opponent every 3s
///   over a 15s active window, 60s cooldown.
/// - Phase 4n (Reflux): three-stage state machine - the charge is armed (5s),
///   the puddle appears 0.8s later with a 5% maxHP hit + Slowed, and lasts 10s
///   ticking 1.5% maxHP + Corrosion once a second. 120s cooldown from the
///   start of the charge. The Hunger Rule spends 25 percentage points of
///   appetite.
/// - Phase 4o (Totem): drains Poison to opponent every 3s over a
///   120s active window, 120s cooldown.
/// - Phase 4p (Reflect): 6s reflect window, 45s cooldown,
///   policy-aware activation gating (precision modes delay).
#[allow(clippy::too_many_arguments)]
pub(in super::super) fn process_phase_4_tick_actives_cluster(
    ctx: &mut PhaseContext<'_, '_>,
    ability_policy: SimpleAbilityTimingMode,
    counters: &mut DamageCounters,
    ability_timing_events_a: &mut Vec<String>,
    ability_timing_events_b: &mut Vec<String>,
) {
    // Phase 4m: Frost Nova ticks + activation
    if ctx.config.attacker_frost_nova && !ctx.a.posture_settled_non_standing()
        && !ctx.config.head_start_inert_a(ctx.time)
        && ctx.a_within_reach("Frost Nova")
        && !ctx.a.in_cocoon_phase_2(ctx.time) {
        while let Some(next_tick) = ctx.a.frost_nova_next_tick_at {
            if next_tick > ctx.time + 1e-9 || next_tick > ctx.a.frost_nova_active_until + 1e-9 {
                break;
            }
            apply_frost_nova_tick(
                next_tick, ctx.defender,
                ctx.a, ctx.b, "A",
                ctx.combat_log, ctx.record_trace,
            );
        }
        if !ability_blocked_by_necropoison("Frost Nova", &ctx.a.statuses)
            && ctx.time >= ctx.a.frost_nova_cooldown_until
            && ctx.time >= ctx.a.frost_nova_active_until
        {
            ctx.a.frost_nova_active_until = ctx.time + FROST_NOVA_ACTIVE_DURATION;
            charge_active_cooldown(&mut ctx.a.frost_nova_cooldown_until, ctx.time, ctx.attacker, FROST_NOVA_COOLDOWN);
            ctx.a.frost_nova_next_tick_at = Some(ctx.time + FROST_NOVA_TICK_SEC);
            push_timing_event(ability_timing_events_a, format!("[Frost Nova] t={:.2} fire", ctx.time));
            record_ability_event(ctx.a, "A", ctx.combat_log, ctx.record_trace, ctx.time, "Frost Nova");
        }
    }
    if ctx.config.defender_frost_nova && !ctx.b.posture_settled_non_standing()
        && !ctx.config.head_start_inert_b(ctx.time)
        && ctx.b_within_reach("Frost Nova")
        && !ctx.b.in_cocoon_phase_2(ctx.time) {
        while let Some(next_tick) = ctx.b.frost_nova_next_tick_at {
            if next_tick > ctx.time + 1e-9 || next_tick > ctx.b.frost_nova_active_until + 1e-9 {
                break;
            }
            apply_frost_nova_tick(
                next_tick, ctx.attacker,
                ctx.b, ctx.a, "B",
                ctx.combat_log, ctx.record_trace,
            );
        }
        if !ability_blocked_by_necropoison("Frost Nova", &ctx.b.statuses)
            && ctx.time >= ctx.b.frost_nova_cooldown_until
            && ctx.time >= ctx.b.frost_nova_active_until
        {
            ctx.b.frost_nova_active_until = ctx.time + FROST_NOVA_ACTIVE_DURATION;
            charge_active_cooldown(&mut ctx.b.frost_nova_cooldown_until, ctx.time, ctx.defender, FROST_NOVA_COOLDOWN);
            ctx.b.frost_nova_next_tick_at = Some(ctx.time + FROST_NOVA_TICK_SEC);
            push_timing_event(ability_timing_events_b, format!("[Frost Nova] t={:.2} fire", ctx.time));
            record_ability_event(ctx.b, "B", ctx.combat_log, ctx.record_trace, ctx.time, "Frost Nova");
        }
    }

    // Phase 4n: Reflux (charge -> the area appears -> the area ticks)
    // The posture gate is on the throw, not on the puddle: a creature that sits
    // down cannot start a cast, and the puddle already on the ground keeps
    // ticking whatever the creature that threw it does.
    if ctx.config.attacker_reflux
        && !ctx.config.head_start_inert_a(ctx.time)
        && ctx.a_within_reach("Reflux")
        && !ctx.a.in_cocoon_phase_2(ctx.time) {
        let reflux_hunger_ok_a = if ctx.a.compare_hunger_rule_enabled {
            let cost = compare_hunger::reflux_hunger_cost(ctx.a.compare_appetite_base);
            ctx.a.compare_hunger + 1e-9 >= cost
        } else {
            true
        };
        if !ctx.a.reflux_armed
            && !ctx.a.posture_settled_non_standing()
            && !ability_blocked_by_necropoison("Reflux", &ctx.a.statuses)
            && ctx.a.reflux_ticks_left == 0
            && ctx.time >= ctx.a.reflux_cooldown_until
            && reflux_hunger_ok_a
        {
            if ctx.a.compare_hunger_rule_enabled {
                let cost = compare_hunger::reflux_hunger_cost(ctx.a.compare_appetite_base);
                ctx.a.compare_hunger = (ctx.a.compare_hunger - cost).max(0.0);
            }
            arm_reflux_charge(
                ctx.a, ctx.time, ctx.attacker, "A", ctx.combat_log, ctx.record_trace,
            );
        } else if ctx.a.reflux_armed && ctx.time + 1e-9 >= ctx.a.reflux_area_at {
            open_reflux_area(
                ctx.time, ctx.attacker, ctx.defender,
                ctx.a, ctx.b, "A",
                ctx.combat_log, ctx.record_trace, &mut counters.dealt_a,
            );
        } else if ctx.a.reflux_ticks_left > 0 && ctx.time + 1e-9 >= ctx.a.reflux_next_tick_at {
            apply_reflux_area_tick(
                ctx.time, ctx.attacker, ctx.defender,
                ctx.a, ctx.b, "A",
                ctx.combat_log, ctx.record_trace, &mut counters.dealt_a,
            );
        }
    }
    if ctx.config.defender_reflux
        && !ctx.config.head_start_inert_b(ctx.time)
        && ctx.b_within_reach("Reflux")
        && !ctx.b.in_cocoon_phase_2(ctx.time) {
        let reflux_hunger_ok_b = if ctx.b.compare_hunger_rule_enabled {
            let cost = compare_hunger::reflux_hunger_cost(ctx.b.compare_appetite_base);
            ctx.b.compare_hunger + 1e-9 >= cost
        } else {
            true
        };
        if !ctx.b.reflux_armed
            && !ctx.b.posture_settled_non_standing()
            && !ability_blocked_by_necropoison("Reflux", &ctx.b.statuses)
            && ctx.b.reflux_ticks_left == 0
            && ctx.time >= ctx.b.reflux_cooldown_until
            && reflux_hunger_ok_b
        {
            if ctx.b.compare_hunger_rule_enabled {
                let cost = compare_hunger::reflux_hunger_cost(ctx.b.compare_appetite_base);
                ctx.b.compare_hunger = (ctx.b.compare_hunger - cost).max(0.0);
            }
            arm_reflux_charge(
                ctx.b, ctx.time, ctx.defender, "B", ctx.combat_log, ctx.record_trace,
            );
        } else if ctx.b.reflux_armed && ctx.time + 1e-9 >= ctx.b.reflux_area_at {
            open_reflux_area(
                ctx.time, ctx.defender, ctx.attacker,
                ctx.b, ctx.a, "B",
                ctx.combat_log, ctx.record_trace, &mut counters.dealt_b,
            );
        } else if ctx.b.reflux_ticks_left > 0 && ctx.time + 1e-9 >= ctx.b.reflux_next_tick_at {
            apply_reflux_area_tick(
                ctx.time, ctx.defender, ctx.attacker,
                ctx.b, ctx.a, "B",
                ctx.combat_log, ctx.record_trace, &mut counters.dealt_b,
            );
        }
    }

    // Phase 4o: Totem
    if ctx.config.attacker_totem && !ctx.a.posture_settled_non_standing()
        && !ctx.config.head_start_inert_a(ctx.time)
        && !ctx.a.in_cocoon_phase_2(ctx.time) {
        if !ability_blocked_by_necropoison("Totem", &ctx.a.statuses)
            && ctx.a.totem_active_until <= ctx.time
            && ctx.time >= ctx.a.totem_cooldown_until
        {
            ctx.a.totem_active_until = ctx.time + crate::spec_constants::TOTEM_ACTIVE_WINDOW_SEC;
            ctx.a.totem_next_tick_at = Some(ctx.time + 3.0);
            charge_active_cooldown(&mut ctx.a.totem_cooldown_until, ctx.time, ctx.attacker, crate::spec_constants::TOTEM_COOLDOWN_SEC);
            if ctx.record_trace {
                ctx.combat_log.push(crate::contracts::CombatLogEntry {
                    time: ctx.time,
                    entry_type: "ability".to_string(),
                    attacker: "A".to_string(),
                    damage: 0.0,
                    healing: None,
                    actor_hp_after: ctx.a.hp.max(0.0),
                    hp_side: "A".to_string(),
                    hp_after: ctx.a.hp.max(0.0),
                    description: Some("Totem activated".to_string()),
                    detail: None,
                    status_id: None,
                });
            }
        }
        if ctx.a.totem_active_until > 0.0
            && ctx.time >= ctx.a.totem_next_tick_at.unwrap_or(f64::INFINITY)
            && ctx.time <= ctx.a.totem_active_until
        {
            let status_id = ctx
                .config
                .attacker_totem_status_id
                .clone()
                .unwrap_or_else(|| "Poison_Status".to_string());
            apply_totem_tick(
                ctx.time, ctx.defender, ctx.a, ctx.b, &status_id, "A",
                ctx.combat_log, ctx.record_trace,
            );
        }
    }
    if ctx.config.defender_totem && !ctx.b.posture_settled_non_standing()
        && !ctx.config.head_start_inert_b(ctx.time)
        && !ctx.b.in_cocoon_phase_2(ctx.time) {
        if !ability_blocked_by_necropoison("Totem", &ctx.b.statuses)
            && ctx.b.totem_active_until <= ctx.time
            && ctx.time >= ctx.b.totem_cooldown_until
        {
            ctx.b.totem_active_until = ctx.time + crate::spec_constants::TOTEM_ACTIVE_WINDOW_SEC;
            ctx.b.totem_next_tick_at = Some(ctx.time + 3.0);
            charge_active_cooldown(&mut ctx.b.totem_cooldown_until, ctx.time, ctx.defender, crate::spec_constants::TOTEM_COOLDOWN_SEC);
            if ctx.record_trace {
                ctx.combat_log.push(crate::contracts::CombatLogEntry {
                    time: ctx.time,
                    entry_type: "ability".to_string(),
                    attacker: "B".to_string(),
                    damage: 0.0,
                    healing: None,
                    actor_hp_after: ctx.b.hp.max(0.0),
                    hp_side: "B".to_string(),
                    hp_after: ctx.b.hp.max(0.0),
                    description: Some("Totem activated".to_string()),
                    detail: None,
                    status_id: None,
                });
            }
        }
        if ctx.b.totem_active_until > 0.0
            && ctx.time >= ctx.b.totem_next_tick_at.unwrap_or(f64::INFINITY)
            && ctx.time <= ctx.b.totem_active_until
        {
            let status_id = ctx
                .config
                .defender_totem_status_id
                .clone()
                .unwrap_or_else(|| "Poison_Status".to_string());
            apply_totem_tick(
                ctx.time, ctx.attacker, ctx.b, ctx.a, &status_id, "B",
                ctx.combat_log, ctx.record_trace,
            );
        }
    }

    // Phase 4p0: Guardians Passage. The cooldown is tested before the other
    // gates: it is one comparison, and past the opening use it stays false for
    // the rest of the fight, so nothing below it runs per iteration.
    if ctx.config.attacker_guardians_passage
        && ctx.time >= ctx.a.guardians_passage_cooldown_until
        && !ctx.a.posture_settled_non_standing()
        && !ctx.config.head_start_inert_a(ctx.time)
        && !ctx.a.in_cocoon_phase_2(ctx.time)
        && !ability_blocked_by_necropoison("Guardians Passage", &ctx.a.statuses)
    {
        let policy_passage = resolve_ability_policy(
            ability_policy, ctx.config.attacker_ability_policy_overrides.guardians_passage);
        let self_side = policy_bridge::build_policy_side(&*ctx.a, ctx.attacker, ctx.attacker_breath, std::iter::empty());
        let opp_side = policy_bridge::build_policy_side(&*ctx.b, ctx.defender, ctx.defender_breath, std::iter::empty());
        let mode = policy_bridge::map_timing_mode(policy_passage);
        if policy_bridge::should_activate_now(
            crate::policy::decisions::guardians_passage::GUARDIANS_PASSAGE_DECISION_ID,
            self_side, opp_side, ctx.time, mode,
        ) {
            charge_active_cooldown(&mut ctx.a.guardians_passage_cooldown_until, ctx.time, ctx.attacker, crate::spec_constants::GUARDIANS_PASSAGE_COOLDOWN_SEC);
            record_ability_event(ctx.a, "A", ctx.combat_log, ctx.record_trace, ctx.time, "Guardians Passage");
            apply_guardian_seal(ctx.time, ctx.attacker, ctx.a, "A", ctx.combat_log, ctx.record_trace);
            // The game takes 75% of the pool where the sealed creature is a
            // packmate and the whole pool otherwise. A fight here has two
            // creatures and no pack, so the sealed creature counts as a
            // packmate.
            if ctx.config.stamina_enabled {
                crate::composable::stamina::spend(
                    ctx.a,
                    crate::composable::stamina::cost_from_max(
                        &*ctx.a,
                        ctx.attacker,
                        crate::composable::stamina::GUARDIANS_PASSAGE_STAMINA_FRACTION,
                    ),
                );
            }
            push_timing_event(ability_timing_events_a, format!("[Guardians Passage] t={:.2} fire", ctx.time));
        }
    }
    if ctx.config.defender_guardians_passage
        && ctx.time >= ctx.b.guardians_passage_cooldown_until
        && !ctx.b.posture_settled_non_standing()
        && !ctx.config.head_start_inert_b(ctx.time)
        && !ctx.b.in_cocoon_phase_2(ctx.time)
        && !ability_blocked_by_necropoison("Guardians Passage", &ctx.b.statuses)
    {
        let policy_passage = resolve_ability_policy(
            ability_policy, ctx.config.defender_ability_policy_overrides.guardians_passage);
        let self_side = policy_bridge::build_policy_side(&*ctx.b, ctx.defender, ctx.defender_breath, std::iter::empty());
        let opp_side = policy_bridge::build_policy_side(&*ctx.a, ctx.attacker, ctx.attacker_breath, std::iter::empty());
        let mode = policy_bridge::map_timing_mode(policy_passage);
        if policy_bridge::should_activate_now(
            crate::policy::decisions::guardians_passage::GUARDIANS_PASSAGE_DECISION_ID,
            self_side, opp_side, ctx.time, mode,
        ) {
            charge_active_cooldown(&mut ctx.b.guardians_passage_cooldown_until, ctx.time, ctx.defender, crate::spec_constants::GUARDIANS_PASSAGE_COOLDOWN_SEC);
            record_ability_event(ctx.b, "B", ctx.combat_log, ctx.record_trace, ctx.time, "Guardians Passage");
            apply_guardian_seal(ctx.time, ctx.defender, ctx.b, "B", ctx.combat_log, ctx.record_trace);
            // The game takes 75% of the pool where the sealed creature is a
            // packmate and the whole pool otherwise. A fight here has two
            // creatures and no pack, so the sealed creature counts as a
            // packmate.
            if ctx.config.stamina_enabled {
                crate::composable::stamina::spend(
                    ctx.b,
                    crate::composable::stamina::cost_from_max(
                        &*ctx.b,
                        ctx.defender,
                        crate::composable::stamina::GUARDIANS_PASSAGE_STAMINA_FRACTION,
                    ),
                );
            }
            push_timing_event(ability_timing_events_b, format!("[Guardians Passage] t={:.2} fire", ctx.time));
        }
    }

    // Phase 4p: Reflect (activated)
    if ctx.config.attacker_reflect && !ctx.a.posture_settled_non_standing()
        && !ctx.config.head_start_inert_a(ctx.time)
        && !ability_blocked_by_necropoison("Reflect", &ctx.a.statuses) && !ctx.a.in_cocoon_phase_2(ctx.time)
        && ctx.a.reflect_active_until <= ctx.time
        && ctx.time >= ctx.a.reflect_cooldown_until
    {
        let policy_reflect = resolve_ability_policy(ability_policy, ctx.config.attacker_ability_policy_overrides.reflect);
        let self_side = policy_bridge::build_policy_side(&*ctx.a, ctx.attacker, ctx.attacker_breath, std::iter::empty());
        let opp_side = policy_bridge::build_policy_side(&*ctx.b, ctx.defender, ctx.defender_breath, std::iter::empty());
        let mode = policy_bridge::map_timing_mode(policy_reflect);
        if policy_bridge::should_activate_now(
            crate::policy::decisions::reflect::REFLECT_DECISION_ID,
            self_side, opp_side, ctx.time, mode,
        ) {
            ctx.a.reflect_active_until = ctx.time + 6.0;
            charge_active_cooldown(&mut ctx.a.reflect_cooldown_until, ctx.time, ctx.attacker, 45.0);
            push_timing_event(ability_timing_events_a, format!("[Reflect] t={:.2} fire", ctx.time));
            if ctx.record_trace {
                ctx.combat_log.push(crate::contracts::CombatLogEntry {
                    time: ctx.time,
                    entry_type: "ability".to_string(),
                    attacker: "A".to_string(),
                    damage: 0.0,
                    healing: None,
                    actor_hp_after: ctx.a.hp.max(0.0),
                    hp_side: "A".to_string(),
                    hp_after: ctx.a.hp.max(0.0),
                    description: Some("Reflect activated".to_string()),
                    detail: None,
                    status_id: None,
                });
            }
        }
    }
    if ctx.config.defender_reflect && !ctx.b.posture_settled_non_standing()
        && !ctx.config.head_start_inert_b(ctx.time)
        && !ability_blocked_by_necropoison("Reflect", &ctx.b.statuses) && !ctx.b.in_cocoon_phase_2(ctx.time)
        && ctx.b.reflect_active_until <= ctx.time
        && ctx.time >= ctx.b.reflect_cooldown_until
    {
        let policy_reflect = resolve_ability_policy(ability_policy, ctx.config.defender_ability_policy_overrides.reflect);
        let self_side = policy_bridge::build_policy_side(&*ctx.b, ctx.defender, ctx.defender_breath, std::iter::empty());
        let opp_side = policy_bridge::build_policy_side(&*ctx.a, ctx.attacker, ctx.attacker_breath, std::iter::empty());
        let mode = policy_bridge::map_timing_mode(policy_reflect);
        if policy_bridge::should_activate_now(
            crate::policy::decisions::reflect::REFLECT_DECISION_ID,
            self_side, opp_side, ctx.time, mode,
        ) {
            ctx.b.reflect_active_until = ctx.time + 6.0;
            charge_active_cooldown(&mut ctx.b.reflect_cooldown_until, ctx.time, ctx.defender, 45.0);
            push_timing_event(ability_timing_events_b, format!("[Reflect] t={:.2} fire", ctx.time));
            if ctx.record_trace {
                ctx.combat_log.push(crate::contracts::CombatLogEntry {
                    time: ctx.time,
                    entry_type: "ability".to_string(),
                    attacker: "B".to_string(),
                    damage: 0.0,
                    healing: None,
                    actor_hp_after: ctx.b.hp.max(0.0),
                    hp_side: "B".to_string(),
                    hp_after: ctx.b.hp.max(0.0),
                    description: Some("Reflect activated".to_string()),
                    detail: None,
                    status_id: None,
                });
            }
        }
    }
}

/// Instant-effect actives: a status (and for Grim Lariat, damage) is
/// applied to the opponent at the moment the user-side flag is set and
/// the cooldown has elapsed. Extracted so the Sandbox "manual click"
/// path (`sandbox::arm_ability_for_side`) and the canonical engine
/// path share the effect application: a path that set only the cooldown
/// timer would push `cooldown_until` into the future and make the next
/// engine iter skip the ability, landing neither the status nor the
/// damage. Each helper assumes the caller already
/// gated on whatever preconditions apply (cooldown / necro-disable /
/// cocoon-phase2 / posture-settled); it mutates the user-side cooldown
/// and (where applicable) the user-side damage counter, and pushes the
/// trace log entry via [`record_ability_event`].
pub(in super::super) fn apply_cause_fear_effect(
    time: f64,
    user_stats: &SimpleCombatantStats,
    opp_stats: &SimpleCombatantStats,
    user: &mut CombatSide,
    opp: &mut CombatSide,
    user_label: &str,
    combat_log: &mut Vec<crate::contracts::CombatLogEntry>,
    record_trace: bool,
) {
    let opp_label = if user_label == "A" { "B" } else { "A" };
    apply_statuses_with_trace(
        time,
        opp_stats,
        opp.hp,
        &mut opp.statuses,
        &[SimpleAppliedStatus {
            status_id: "Fear_Status".to_string(),
            stacks: 10.0,
            ..Default::default()
        }],
        opp.fortify_immune_until,
        user_label, user.hp, opp_label, "Cause Fear",
        if record_trace { Some(combat_log) } else { None },
    );
    charge_active_cooldown(&mut user.cause_fear_cooldown_until, time, user_stats, 120.0);
    record_ability_event(user, user_label, combat_log, record_trace, time, "Cause Fear");
}

pub(in super::super) fn apply_grim_lariat_effect(
    time: f64,
    user_stats: &SimpleCombatantStats,
    opp_stats: &SimpleCombatantStats,
    user: &mut CombatSide,
    opp: &mut CombatSide,
    user_label: &str,
    combat_log: &mut Vec<crate::contracts::CombatLogEntry>,
    record_trace: bool,
    user_dealt_counter: &mut f64,
) {
    let damage = apply_unbreakable_damage_cap(user_stats.damage * 0.5, opp_stats)
        .min(opp.hp.max(0.0));
    // Route Grim Lariat through the pre-damage hook.
    let opp_label = if user_label == "A" { "B" } else { "A" };
    let damage = damage_pipeline::resolve_incoming_damage(
        user, opp, user_stats, opp_stats, time,
        damage, damage, "grim_lariat",
        combat_log, record_trace, user_label, opp_label,
    );
    opp.hp -= damage;
    *user_dealt_counter += damage;
    apply_statuses_with_trace(
        time,
        opp_stats,
        opp.hp,
        &mut opp.statuses,
        &[SimpleAppliedStatus {
            status_id: "Heartbroken_Status".to_string(),
            stacks: 8.0,
            ..Default::default()
        }],
        opp.fortify_immune_until,
        user_label, user.hp, opp_label, "Grim Lariat",
        if record_trace { Some(combat_log) } else { None },
    );
    charge_active_cooldown(&mut user.grim_lariat_cooldown_until, time, user_stats, 60.0);
    record_ability_event(user, user_label, combat_log, record_trace, time, "Grim Lariat");
}

pub(in super::super) fn apply_cursed_sigil_effect(
    time: f64,
    user_stats: &SimpleCombatantStats,
    opp_stats: &SimpleCombatantStats,
    user: &mut CombatSide,
    opp: &mut CombatSide,
    stacks: f64,
    user_label: &str,
    combat_log: &mut Vec<crate::contracts::CombatLogEntry>,
    record_trace: bool,
) {
    let opp_label = if user_label == "A" { "B" } else { "A" };
    apply_statuses_with_trace(
        time,
        opp_stats,
        opp.hp,
        &mut opp.statuses,
        &[SimpleAppliedStatus {
            status_id: "Bad_Omen".to_string(),
            stacks,
            ..Default::default()
        }],
        opp.fortify_immune_until,
        user_label, user.hp, opp_label, "Cursed Sigil",
        if record_trace { Some(combat_log) } else { None },
    );
    charge_active_cooldown(&mut user.cursed_sigil_cooldown_until, time, user_stats, 85.0);
    record_ability_event(user, user_label, combat_log, record_trace, time, "Cursed Sigil");
}

pub(in super::super) fn apply_drowsy_area_effect(
    time: f64,
    user_stats: &SimpleCombatantStats,
    opp_stats: &SimpleCombatantStats,
    user: &mut CombatSide,
    opp: &mut CombatSide,
    user_label: &str,
    combat_log: &mut Vec<crate::contracts::CombatLogEntry>,
    record_trace: bool,
) {
    let opp_label = if user_label == "A" { "B" } else { "A" };
    apply_statuses_with_trace(
        time,
        opp_stats,
        opp.hp,
        &mut opp.statuses,
        &[SimpleAppliedStatus {
            status_id: "Drowsy_Status".to_string(),
            stacks: 5.0,
            ..Default::default()
        }],
        opp.fortify_immune_until,
        user_label, user.hp, opp_label, "Drowsy Area",
        if record_trace { Some(combat_log) } else { None },
    );
    charge_active_cooldown(&mut user.drowsy_area_cooldown_until, time, user_stats, 60.0);
    record_ability_event(user, user_label, combat_log, record_trace, time, "Drowsy Area");
}

/// Apply the Guardians Passage seal status to `user`. The user is both caster
/// and recipient here: in game the ability also applies it to a packmate, and
/// a one-on-one fight has none.
pub(in super::super) fn apply_guardian_seal(
    time: f64,
    user_stats: &SimpleCombatantStats,
    user: &mut CombatSide,
    user_label: &str,
    combat_log: &mut Vec<crate::contracts::CombatLogEntry>,
    record_trace: bool,
) {
    let hp = user.hp;
    apply_statuses_with_trace(
        time, user_stats, hp, &mut user.statuses,
        &[SimpleAppliedStatus {
            status_id: damage_pipeline::GUARDIAN_SEAL_STATUS.to_string(),
            stacks: crate::spec_constants::GUARDIANS_PASSAGE_SEAL_STACKS, ..Default::default() }],
        user.fortify_immune_until,
        user_label, hp, user_label, "Guardians Passage",
        if record_trace { Some(combat_log) } else { None },
    );
}

/// Apply one Totem tick to `opp` (2 stacks of `status_id`, default
/// Poison) and reschedule the next tick at +3 s, clamped to the active
/// window (clears the timer once the window closes so a stale past
/// timer can't pin the scheduler). The caller is responsible for the
/// `totem_active_until` / `totem_next_tick_at` due-time gates. Shared by
/// the phase4o handler and the Sandbox Manual deferred-tick driver
/// (`sandbox::run_due_armed_ticks`).
pub(in super::super) fn apply_totem_tick(
    time: f64,
    opp_stats: &SimpleCombatantStats,
    user: &mut CombatSide,
    opp: &mut CombatSide,
    status_id: &str,
    user_label: &str,
    combat_log: &mut Vec<crate::contracts::CombatLogEntry>,
    record_trace: bool,
) {
    let opp_label = if user_label == "A" { "B" } else { "A" };
    apply_statuses_with_trace(
        time, opp_stats, opp.hp, &mut opp.statuses,
        &[SimpleAppliedStatus {
            status_id: status_id.to_string(),
            stacks: 2.0, ..Default::default() }],
        opp.fortify_immune_until,
        user_label, user.hp, opp_label, "Totem",
        if record_trace { Some(combat_log) } else { None },
    );
    let next = time + 3.0;
    user.totem_next_tick_at = if next <= user.totem_active_until { Some(next) } else { None };
}

/// Apply one Frost Nova tick to `opp` (3 stacks Frostbite) and reschedule
/// the next tick at +`FROST_NOVA_TICK_SEC`, clamped to the active window
/// (clears the timer once the next tick would fall past the window). The
/// caller is responsible for the `frost_nova_active_until` /
/// `frost_nova_next_tick_at` due-time gates. Shared by the phase4m handler
/// and the Sandbox Manual deferred-tick driver
/// (`sandbox::run_due_armed_ticks`). Mirrors [`apply_totem_tick`].
pub(in super::super) fn apply_frost_nova_tick(
    tick_time: f64,
    opp_stats: &SimpleCombatantStats,
    user: &mut CombatSide,
    opp: &mut CombatSide,
    user_label: &str,
    combat_log: &mut Vec<crate::contracts::CombatLogEntry>,
    record_trace: bool,
) {
    let opp_label = if user_label == "A" { "B" } else { "A" };
    apply_statuses_with_trace(
        tick_time, opp_stats, opp.hp, &mut opp.statuses,
        &[SimpleAppliedStatus {
            status_id: "Frostbite_Status".to_string(),
            stacks: 3.0, ..Default::default() }],
        opp.fortify_immune_until,
        user_label, user.hp, opp_label, "Frost Nova",
        if record_trace { Some(combat_log) } else { None },
    );
    let next_after = tick_time + FROST_NOVA_TICK_SEC;
    user.frost_nova_next_tick_at = if next_after <= user.frost_nova_active_until + 1e-9 {
        Some(next_after)
    } else {
        None
    };
}

/// Start a Reflux charge on one side and put the ability on cooldown. The
/// cooldown runs from the start of the charge, so the interval between two
/// casts does not grow with the charge. The caller owns the readiness check
/// and the appetite cost.
pub(in super::super) fn arm_reflux_charge(
    side: &mut CombatSide,
    time: f64,
    user_stats: &SimpleCombatantStats,
    label: &str,
    combat_log: &mut Vec<crate::contracts::CombatLogEntry>,
    record_trace: bool,
) {
    side.reflux_armed = true;
    side.reflux_area_at = time + REFLUX_CHARGE_SEC + REFLUX_AREA_DELAY_SEC;
    charge_active_cooldown(&mut side.reflux_cooldown_until, time, user_stats, crate::spec_constants::REFLUX_COOLDOWN_SEC);
    *side.ability_activation_counts
        .entry("Reflux".to_string())
        .or_insert(0) += 1;
    if record_trace {
        let hp = side.hp.max(0.0);
        combat_log.push(crate::contracts::CombatLogEntry {
            time,
            entry_type: "ability".to_string(),
            attacker: label.to_string(),
            damage: 0.0,
            healing: None,
            actor_hp_after: hp,
            hp_side: label.to_string(),
            hp_after: hp,
            description: Some("Reflux charge started".to_string()),
            detail: None,
            status_id: None,
        });
    }
}

/// The moment Reflux's area appears: a 5% max-HP direct hit and 2 stacks of
/// Slowed land on the opponent, and the area opens with all ten of its ticks
/// still owed, the first one an interval later. Decrements `opp.hp` through
/// the unbreakable-cap + pre-damage-hook pipeline and credits `dealt` (the
/// user's dealt-damage counter). The caller is responsible for the
/// `reflux_armed && time >= reflux_area_at` gate. Shared by the phase4n
/// handler and the Sandbox Manual deferred-tick driver
/// (`sandbox::run_due_armed_ticks`).
#[allow(clippy::too_many_arguments)]
pub(in super::super) fn open_reflux_area(
    time: f64,
    user_stats: &SimpleCombatantStats,
    opp_stats: &SimpleCombatantStats,
    user: &mut CombatSide,
    opp: &mut CombatSide,
    user_label: &str,
    combat_log: &mut Vec<crate::contracts::CombatLogEntry>,
    record_trace: bool,
    dealt: &mut f64,
) {
    let opp_label = if user_label == "A" { "B" } else { "A" };
    let impact_damage = opp_stats.health * 0.05;
    let applied_impact =
        apply_unbreakable_damage_cap(impact_damage, opp_stats).min(opp.hp.max(0.0));
    let applied_impact = damage_pipeline::resolve_incoming_damage(
        user, opp, user_stats, opp_stats, time,
        applied_impact, applied_impact, "reflux",
        combat_log, record_trace, user_label, opp_label,
    );
    opp.hp -= applied_impact;
    *dealt += applied_impact;
    if record_trace && applied_impact > 0.0 {
        combat_log.push(crate::contracts::CombatLogEntry {
            time,
            entry_type: "ability".to_string(),
            attacker: user_label.to_string(),
            damage: applied_impact,
            healing: None,
            actor_hp_after: user.hp.max(0.0),
            hp_side: opp_label.to_string(),
            hp_after: opp.hp.max(0.0),
            description: Some("Reflux impact".to_string()),
            detail: Some("5% maxHP direct hit + Slow 2".to_string()),
            status_id: None,
        });
    }
    apply_statuses_with_trace(
        time,
        opp_stats,
        opp.hp,
        &mut opp.statuses,
        &[SimpleAppliedStatus {
            status_id: "Slow_Status".to_string(),
            stacks: 2.0, ..Default::default() }],
        opp.fortify_immune_until,
        user_label, user.hp, opp_label, "Reflux",
        if record_trace { Some(combat_log) } else { None },
    );
    user.reflux_armed = false;
    user.reflux_ticks_left = area_tick_count(REFLUX_DURATION_SEC, REFLUX_TICK_INTERVAL_SEC);
    // The ticks are counted off the moment the area appeared rather than off
    // the loop's current time, so a wake that arrives late does not carry the
    // whole series with it.
    user.reflux_next_tick_at = user.reflux_area_at + REFLUX_TICK_INTERVAL_SEC;
}

/// One Reflux area tick: 1.5% max-HP direct damage and 0.5 stacks of
/// Corrosion on the opponent. Same cap + hook + counter pipeline as the
/// impact, then one tick is taken off the count and the next is scheduled an
/// interval on. The caller is responsible for the
/// `reflux_ticks_left > 0 && next tick due` gate. Shared by the phase4n
/// handler and the Sandbox Manual deferred-tick driver.
#[allow(clippy::too_many_arguments)]
pub(in super::super) fn apply_reflux_area_tick(
    time: f64,
    user_stats: &SimpleCombatantStats,
    opp_stats: &SimpleCombatantStats,
    user: &mut CombatSide,
    opp: &mut CombatSide,
    user_label: &str,
    combat_log: &mut Vec<crate::contracts::CombatLogEntry>,
    record_trace: bool,
    dealt: &mut f64,
) {
    let opp_label = if user_label == "A" { "B" } else { "A" };
    let puddle_damage = opp_stats.health * 0.015;
    let applied_puddle =
        apply_unbreakable_damage_cap(puddle_damage, opp_stats).min(opp.hp.max(0.0));
    let applied_puddle = damage_pipeline::resolve_incoming_damage(
        user, opp, user_stats, opp_stats, time,
        applied_puddle, applied_puddle, "reflux",
        combat_log, record_trace, user_label, opp_label,
    );
    opp.hp -= applied_puddle;
    *dealt += applied_puddle;
    if record_trace && applied_puddle > 0.0 {
        combat_log.push(crate::contracts::CombatLogEntry {
            time,
            entry_type: "ability".to_string(),
            attacker: user_label.to_string(),
            damage: applied_puddle,
            healing: None,
            actor_hp_after: user.hp.max(0.0),
            hp_side: opp_label.to_string(),
            hp_after: opp.hp.max(0.0),
            description: Some("Reflux puddle tick".to_string()),
            detail: Some("1.5% maxHP puddle damage + Corrosion 0.5".to_string()),
            status_id: None,
        });
    }
    apply_statuses_with_trace(
        time,
        opp_stats,
        opp.hp,
        &mut opp.statuses,
        &[SimpleAppliedStatus {
            status_id: "Corrosion_Status".to_string(),
            stacks: 0.5, ..Default::default() }],
        opp.fortify_immune_until,
        user_label, user.hp, opp_label, "Reflux",
        if record_trace { Some(combat_log) } else { None },
    );
    user.reflux_ticks_left -= 1;
    user.reflux_next_tick_at += REFLUX_TICK_INTERVAL_SEC;
}

/// A fresh plant count for one Life Of The Forest activation: a uniform integer
/// from zero to five, every outcome equally likely, drawn off the side's own
/// stream so the two sides never share a sequence.
fn random_plant_count(rng: &mut u64) -> f64 {
    let steps = LIFE_OF_THE_FOREST_MAX_PLANTS + 1.0;
    (super::super::aerial_dodge_next_unit(rng) * steps)
        .floor()
        .min(LIFE_OF_THE_FOREST_MAX_PLANTS)
}

/// Phase 4q + 4r + 4s + 4t + 4u: misc actives + Cocoon family.
///
/// - Phase 4q (Cause Fear): 10 stacks Fear on opponent, 120s cooldown.
/// - Phase 4r (Grim Lariat): 0.5x damage hit + 8 stacks Heartbroken,
///   60s cooldown.
/// - Phase 4s (Shadow Barrage): on activation deals N stacked
///   barrage hits *all at once* (damage = base x sum(0.9^i for i in
///   1..=N)), applies on-hit ailments N times, then arms a
///   30 s cooldown. Needs a recent (<=10 s) melee hit to seed
///   `last_melee_hit_damage`.
/// - Phase 4t (Cocoon activation): 3-phase ability - Ph1 lockdown,
///   Ph2 invincibility+heal, Ph3 +15% damage buff.
/// - Phase 4u (Cocoon Ph2->Ph3 transition): applies +30% max-HP lump
///   heal at Ph2 end, zeroes the phase gates.
#[allow(clippy::too_many_arguments)]
pub(in super::super) fn process_phase_4_misc_and_cocoon_cluster(
    ctx: &mut PhaseContext<'_, '_>,
    ability_policy: SimpleAbilityTimingMode,
    counters: &mut DamageCounters,
) {
    // Phase 4q: Cause Fear
    if ctx.config.attacker_cause_fear && !ctx.a.posture_settled_non_standing()
        && !ctx.config.head_start_inert_a(ctx.time)
        && ctx.a_within_reach("Cause Fear")
        && !ability_blocked_by_necropoison("Cause Fear", &ctx.a.statuses) && !ctx.a.in_cocoon_phase_2(ctx.time)
        && ctx.time >= ctx.a.cause_fear_cooldown_until
    {
        apply_cause_fear_effect(
            ctx.time, ctx.attacker, ctx.defender,
            ctx.a, ctx.b, "A", ctx.combat_log, ctx.record_trace,
        );
    }
    if ctx.config.defender_cause_fear && !ctx.b.posture_settled_non_standing()
        && !ctx.config.head_start_inert_b(ctx.time)
        && ctx.b_within_reach("Cause Fear")
        && !ability_blocked_by_necropoison("Cause Fear", &ctx.b.statuses) && !ctx.b.in_cocoon_phase_2(ctx.time)
        && ctx.time >= ctx.b.cause_fear_cooldown_until
    {
        apply_cause_fear_effect(
            ctx.time, ctx.defender, ctx.attacker,
            ctx.b, ctx.a, "B", ctx.combat_log, ctx.record_trace,
        );
    }

    // Phase 4q-quinquies: Seedling Mist. A charge arms it, then the mist stands
    // for a fixed number of ticks and heals whatever is inside it - which, in a
    // fight, is both fighters. The share is read off the creature being healed,
    // so the side with the larger maximum health gains more from it.
    for owner_is_a in [true, false] {
        let on = if owner_is_a {
            ctx.config.attacker_seedling_mist
        } else {
            ctx.config.defender_seedling_mist
        };
        if !on {
            continue;
        }
        let inert = if owner_is_a {
            ctx.config.head_start_inert_a(ctx.time)
        } else {
            ctx.config.head_start_inert_b(ctx.time)
        };
        // The throw has a reach, the mist it leaves does not: a side too far
        // away cannot start one, and one already standing keeps ticking.
        let allow_start = if owner_is_a {
            ctx.a_within_reach("Seedling Mist")
        } else {
            ctx.b_within_reach("Seedling Mist")
        };
        step_seedling_mist(
            SeedlingMistStep { time: ctx.time, owner_is_a, allow_start, inert },
            ctx.a, ctx.b, ctx.attacker, ctx.defender,
            ctx.combat_log, ctx.record_trace,
        );
    }

    // Phase 4q-quater: Heal Aura. It lands on every creature inside its radius
    // once a second, and a fight holds both fighters inside it, so a side that
    // runs one heals the opponent as well as itself. The share is read off the
    // creature being healed, which is why the bigger-health side gains more
    // from it than the side paying for it.
    for (on, value, owner_is_a) in [
        (ctx.config.attacker_heal_aura, ctx.config.attacker_heal_aura_value, true),
        (ctx.config.defender_heal_aura, ctx.config.defender_heal_aura_value, false),
    ] {
        if !on || value <= 0.0 {
            continue;
        }
        step_heal_aura(
            ctx.time, value, owner_is_a,
            ctx.a, ctx.b, ctx.attacker, ctx.defender,
            ctx.combat_log, ctx.record_trace,
        );
    }

    // Phase 4q-ter: Tangled Reckoning. A toggle with no cost and nothing to
    // weigh at zero distance - the thorn reaches, the heal runs, and the root
    // costs movement the model does not have - so it goes on as soon as its
    // cooldown allows and stays on. What it does cost is the opening lock, and
    // that is charged inside the step.
    for owner_is_a in [true, false] {
        let owns = if owner_is_a {
            ctx.config.attacker_tangled_reckoning
        } else {
            ctx.config.defender_tangled_reckoning
        };
        let inert = if owner_is_a {
            ctx.config.head_start_inert_a(ctx.time)
        } else {
            ctx.config.head_start_inert_b(ctx.time)
        };
        let (side, stats, label) = if owner_is_a {
            (&mut *ctx.a, ctx.attacker, "A")
        } else {
            (&mut *ctx.b, ctx.defender, "B")
        };
        step_tangled_reckoning(
            ctx.time, owns, inert, side, stats, label,
            ctx.combat_log, ctx.record_trace,
        );
    }

    // Phase 4q-bis: Life Of The Forest. A pure gain with no cost and no decision
    // to make, so it fires the moment its cooldown allows.
    for (active, fixed_plants, random_plants, once, side, stats, inert, label) in [
        (
            ctx.config.life_of_the_forest_active_a(),
            ctx.config.attacker_life_of_the_forest_plants,
            ctx.config.attacker_life_of_the_forest_random,
            ctx.config.attacker_life_of_the_forest_once,
            &mut *ctx.a,
            ctx.attacker,
            ctx.config.head_start_inert_a(ctx.time),
            "A",
        ),
        (
            ctx.config.life_of_the_forest_active_b(),
            ctx.config.defender_life_of_the_forest_plants,
            ctx.config.defender_life_of_the_forest_random,
            ctx.config.defender_life_of_the_forest_once,
            &mut *ctx.b,
            ctx.defender,
            ctx.config.head_start_inert_b(ctx.time),
            "B",
        ),
    ] {
        grant_life_of_the_forest_if_due(
            LifeOfTheForestGrant { active, fixed_plants, random_plants, once, inert, label },
            side,
            stats,
            ctx.time,
            ctx.combat_log,
            ctx.record_trace,
        );
    }

    // Phase 4r: Grim Lariat
    if ctx.config.attacker_grim_lariat && !ctx.a.posture_settled_non_standing()
        && !ctx.config.head_start_inert_a(ctx.time)
        && ctx.a_within_reach("Grim Lariat")
        && !ability_blocked_by_necropoison("Grim Lariat", &ctx.a.statuses) && !ctx.a.in_cocoon_phase_2(ctx.time)
        && ctx.time >= ctx.a.grim_lariat_cooldown_until
    {
        apply_grim_lariat_effect(
            ctx.time, ctx.attacker, ctx.defender,
            ctx.a, ctx.b, "A", ctx.combat_log, ctx.record_trace,
            &mut counters.dealt_a,
        );
    }
    if ctx.config.defender_grim_lariat && !ctx.b.posture_settled_non_standing()
        && !ctx.config.head_start_inert_b(ctx.time)
        && ctx.b_within_reach("Grim Lariat")
        && !ability_blocked_by_necropoison("Grim Lariat", &ctx.b.statuses) && !ctx.b.in_cocoon_phase_2(ctx.time)
        && ctx.time >= ctx.b.grim_lariat_cooldown_until
    {
        apply_grim_lariat_effect(
            ctx.time, ctx.defender, ctx.attacker,
            ctx.b, ctx.a, "B", ctx.combat_log, ctx.record_trace,
            &mut counters.dealt_b,
        );
    }

    // Phase 4s: Shadow Barrage activation - burst-on-activation.
    // All N "barrage hits" of the dropoff sequence
    // (0.9, 0.81, 0.729, ...) land simultaneously at the moment of
    // activation rather than being scheduled at 1 Hz. On-hit
    // ailments still apply once per hit (engine-side: stacks x
    // count, single trace entry).
    if ctx.config.attacker_shadow_barrage_value > 0.0 && !ctx.a.posture_settled_non_standing()
        && !ctx.config.head_start_inert_a(ctx.time)
        && !ctx.a.in_cocoon_phase_2(ctx.time)
        && !ability_blocked_by_necropoison("Shadow Barrage", &ctx.a.statuses)
        && ctx.time >= ctx.a.shadow_barrage_cooldown_until
        && ctx.time - ctx.a.last_melee_hit_at <= 10.0
        && ctx.a.last_melee_hit_damage > 0.0
    {
        let count = ctx.config.attacker_shadow_barrage_value.floor().max(0.0) as i32;
        if count > 0 {
            charge_active_cooldown(&mut ctx.a.shadow_barrage_cooldown_until, ctx.time, ctx.attacker, 30.0);
            record_ability_event(
                ctx.a,
                "A",
                ctx.combat_log,
                ctx.record_trace,
                ctx.time,
                "Shadow Barrage",
            );

            // Replay the seeding bite as N stacked hits. In game each hit
            // recomputes its damage from the attacker's stats, multiplies it by
            // 0.9^i for the i-th hit, and is then subject to the defender's
            // Reflect. We reuse the seeding bite's pre-reflect damage and its
            // reflect base and route each hit through the reflect pipeline, so
            // a defender with Reflect active takes nothing and the attacker
            // takes one reflection per hit.
            //
            // Reflect timing: in game the reflection is computed before the
            // 0.9^i decay is applied, so every hit reflects the full undecayed
            // base and the attacker takes `count x base`, not the decayed sum.
            // Measured in game: 4 hits from a 375 seed returned about 1500,
            // which is 4 x 375; the forward decay would give 3.0951 x 375.
            // So the reflection uses the undecayed `reflect_base`; only the
            // FORWARD hit to a non-reflect defender keeps the `x 0.9^i` decay.
            let base = ctx.a.last_melee_hit_damage;
            let reflect_base = ctx.a.last_melee_reflect_base;
            let target_hunker_active =
                crate::actives::is_hunker_effect_active(ctx.b.hunker_on, ctx.b.hunker_effect_starts_at, ctx.time);
            let hp_b_before = ctx.b.hp;
            let hp_a_before = ctx.a.hp;
            for i in 1..=count {
                let factor = 0.9_f64.powi(i);
                let hit = damage_pipeline::resolve_incoming_damage(
                    ctx.a, ctx.b, ctx.attacker, ctx.defender, ctx.time,
                    base * factor, base * factor, "shadow_barrage",
                    ctx.combat_log, ctx.record_trace, "A", "B",
                );
                apply_direct_damage_with_reflect(
                    hit,
                    reflect_base.max(0.0),
                    true,
                    ctx.attacker,
                    ctx.defender,
                    &mut ctx.a.hp,
                    &mut ctx.b.hp,
                    counters,
                    target_hunker_active,
                    true,
                );
            }
            let applied = (hp_b_before - ctx.b.hp).max(0.0);
            let reflected = (hp_a_before - ctx.a.hp).max(0.0);
            if ctx.record_trace && applied > 0.0 {
                ctx.combat_log.push(crate::contracts::CombatLogEntry {
                    time: ctx.time,
                    entry_type: "ability".to_string(),
                    attacker: "A".to_string(),
                    damage: applied,
                    healing: None,
                    actor_hp_after: ctx.a.hp.max(0.0),
                    hp_side: "B".to_string(),
                    hp_after: ctx.b.hp.max(0.0),
                    description: Some("Shadow Barrage hit".to_string()),
                    detail: Some(format!("burst of {count} hits (0.9^i decay)")),
                    status_id: None,
                });
            }
            if ctx.record_trace && reflected > 0.0 {
                ctx.combat_log.push(crate::contracts::CombatLogEntry {
                    time: ctx.time,
                    entry_type: "ability".to_string(),
                    attacker: "B".to_string(),
                    damage: reflected,
                    healing: None,
                    actor_hp_after: ctx.b.hp.max(0.0),
                    hp_side: "A".to_string(),
                    hp_after: ctx.a.hp.max(0.0),
                    description: Some("Shadow Barrage reflected".to_string()),
                    detail: Some(format!("{count} hits reflected back")),
                    status_id: None,
                });
            }
            let scaled_on_hit = scale_direct_attack_offensive_ailment_statuses(
                &ctx.attacker.on_hit_statuses,
                ctx.attacker,
                ctx.defender,
                &ctx.a.statuses,
                &ctx.b.statuses,
            );
            // On-hit applies once per barrage hit => multiply stacks
            // by count. For stacking statuses this is equivalent to
            // N sequential applies; for non-stacking ones the engine
            // clamps to its max-stack cap automatically.
            let shadow_barrage_on_hit: Vec<SimpleAppliedStatus> = scaled_on_hit
                .iter()
                .map(|status| SimpleAppliedStatus {
                    status_id: status.status_id.clone(),
                    stacks: status.stacks * count as f64,
                    source_ability: Some("Shadow Barrage".to_string()),
                    ..Default::default()
                })
                .collect();
            apply_statuses_with_per_effect_trace(
                ctx.time,
                ctx.defender,
                ctx.b.hp,
                &mut ctx.b.statuses,
                &shadow_barrage_on_hit,
                ctx.b.fortify_immune_until,
                "A",
                ctx.a.hp,
                "B",
                "Shadow Barrage",
                if ctx.record_trace { Some(ctx.combat_log) } else { None },
            );
            // Nothing reads these scheduling fields now that the hits
            // land at once. Reset them so the scheduler in
            // `process_phase_0_collect_step_targets` does not read a
            // stale `next_hit_at` and schedule a barrage that has
            // already resolved.
            ctx.a.shadow_barrage_remaining_hits = 0;
            ctx.a.shadow_barrage_total_hits = 0;
            ctx.a.shadow_barrage_base_damage = 0.0;
            ctx.a.shadow_barrage_next_hit_at = None;
        }
    }
    // Phase 4s mirror - same burst-on-activation model for B side.
    if ctx.config.defender_shadow_barrage_value > 0.0 && !ctx.b.posture_settled_non_standing()
        && !ctx.config.head_start_inert_b(ctx.time)
        && !ctx.b.in_cocoon_phase_2(ctx.time)
        && !ability_blocked_by_necropoison("Shadow Barrage", &ctx.b.statuses)
        && ctx.time >= ctx.b.shadow_barrage_cooldown_until
        && ctx.time - ctx.b.last_melee_hit_at <= 10.0
        && ctx.b.last_melee_hit_damage > 0.0
    {
        let count = ctx.config.defender_shadow_barrage_value.floor().max(0.0) as i32;
        if count > 0 {
            charge_active_cooldown(&mut ctx.b.shadow_barrage_cooldown_until, ctx.time, ctx.defender, 30.0);
            record_ability_event(
                ctx.b,
                "B",
                ctx.combat_log,
                ctx.record_trace,
                ctx.time,
                "Shadow Barrage",
            );

            // Mirror of the A side (see there): geometric 0.9^i decay on the
            // forward hit, undecayed base on the reflection, each hit routed
            // through A's Reflect.
            let base = ctx.b.last_melee_hit_damage;
            let reflect_base = ctx.b.last_melee_reflect_base;
            let target_hunker_active =
                crate::actives::is_hunker_effect_active(ctx.a.hunker_on, ctx.a.hunker_effect_starts_at, ctx.time);
            let hp_a_before = ctx.a.hp;
            let hp_b_before = ctx.b.hp;
            for i in 1..=count {
                let factor = 0.9_f64.powi(i);
                let hit = damage_pipeline::resolve_incoming_damage(
                    ctx.b, ctx.a, ctx.defender, ctx.attacker, ctx.time,
                    base * factor, base * factor, "shadow_barrage",
                    ctx.combat_log, ctx.record_trace, "B", "A",
                );
                apply_direct_damage_with_reflect(
                    hit,
                    reflect_base.max(0.0),
                    false,
                    ctx.defender,
                    ctx.attacker,
                    &mut ctx.b.hp,
                    &mut ctx.a.hp,
                    counters,
                    target_hunker_active,
                    true,
                );
            }
            let applied = (hp_a_before - ctx.a.hp).max(0.0);
            let reflected = (hp_b_before - ctx.b.hp).max(0.0);
            if ctx.record_trace && applied > 0.0 {
                ctx.combat_log.push(crate::contracts::CombatLogEntry {
                    time: ctx.time,
                    entry_type: "ability".to_string(),
                    attacker: "B".to_string(),
                    damage: applied,
                    healing: None,
                    actor_hp_after: ctx.b.hp.max(0.0),
                    hp_side: "A".to_string(),
                    hp_after: ctx.a.hp.max(0.0),
                    description: Some("Shadow Barrage hit".to_string()),
                    detail: Some(format!("burst of {count} hits (0.9^i decay)")),
                    status_id: None,
                });
            }
            if ctx.record_trace && reflected > 0.0 {
                ctx.combat_log.push(crate::contracts::CombatLogEntry {
                    time: ctx.time,
                    entry_type: "ability".to_string(),
                    attacker: "A".to_string(),
                    damage: reflected,
                    healing: None,
                    actor_hp_after: ctx.a.hp.max(0.0),
                    hp_side: "B".to_string(),
                    hp_after: ctx.b.hp.max(0.0),
                    description: Some("Shadow Barrage reflected".to_string()),
                    detail: Some(format!("{count} hits reflected back")),
                    status_id: None,
                });
            }
            let scaled_on_hit = scale_direct_attack_offensive_ailment_statuses(
                &ctx.defender.on_hit_statuses,
                ctx.defender,
                ctx.attacker,
                &ctx.b.statuses,
                &ctx.a.statuses,
            );
            let shadow_barrage_on_hit: Vec<SimpleAppliedStatus> = scaled_on_hit
                .iter()
                .map(|status| SimpleAppliedStatus {
                    status_id: status.status_id.clone(),
                    stacks: status.stacks * count as f64,
                    source_ability: Some("Shadow Barrage".to_string()),
                    ..Default::default()
                })
                .collect();
            apply_statuses_with_per_effect_trace(
                ctx.time,
                ctx.attacker,
                ctx.a.hp,
                &mut ctx.a.statuses,
                &shadow_barrage_on_hit,
                ctx.a.fortify_immune_until,
                "B",
                ctx.b.hp,
                "A",
                "Shadow Barrage",
                if ctx.record_trace { Some(ctx.combat_log) } else { None },
            );
            ctx.b.shadow_barrage_remaining_hits = 0;
            ctx.b.shadow_barrage_total_hits = 0;
            ctx.b.shadow_barrage_base_damage = 0.0;
            ctx.b.shadow_barrage_next_hit_at = None;
        }
    }

    // Phase 4t: Cocoon activation
    if ctx.config.attacker_cocoon
        && !ctx.config.head_start_inert_a(ctx.time)
        && !ability_blocked_by_necropoison("Cocoon", &ctx.a.statuses)
        // Cocoon's own activation gate reads phase2_until: the ability cannot
        // re-activate during Phase 1, and phase2_until is
        // reset to 0 once P2->P3 transitions so post-cocoon activation works.
        && ctx.time >= ctx.a.cocoon_phase2_until
        && ctx.time >= ctx.a.cocoon_cooldown_until
    {
        let policy_cocoon = resolve_ability_policy(ability_policy, ctx.config.attacker_ability_policy_overrides.cocoon);
        let self_side = policy_bridge::build_policy_side(&*ctx.a, ctx.attacker, ctx.attacker_breath, std::iter::empty());
        let opp_side = policy_bridge::build_policy_side(&*ctx.b, ctx.defender, ctx.defender_breath, std::iter::empty());
        let mode = policy_bridge::map_timing_mode(policy_cocoon);
        if policy_bridge::should_activate_now(
            crate::policy::decisions::cocoon::COCOON_DECISION_ID,
            self_side, opp_side, ctx.time, mode,
        ) {
            charge_active_cooldown(&mut ctx.a.cocoon_cooldown_until, ctx.time, ctx.attacker, 120.0);
            ctx.a.cocoon_phase1_until = ctx.time + 5.0;
            ctx.a.cocoon_phase2_until = ctx.time + 10.0;
            // The user keeps biting during Phase 1, so next_hit is not
            // pushed to phase2_until at activation. The own-side Ph2
            // reschedule in process_phase_10_11_melee pushes the bite
            // forward only once we cross into Ph2.
            apply_status_delta(ctx.time, &mut ctx.a.statuses, "Cocoon_Damage_Status", 6.66);
            if let Some(inst) = ctx.a.statuses.get_mut("Cocoon_Damage_Status") {
                inst.next_decay_at = Some(ctx.time + 13.0);
                inst.remaining_sec = 19.98;
            }
            record_ability_event(ctx.a, "A", ctx.combat_log, ctx.record_trace, ctx.time, "Cocoon");
        }
    }
    if ctx.config.defender_cocoon
        && !ctx.config.head_start_inert_b(ctx.time)
        && !ability_blocked_by_necropoison("Cocoon", &ctx.b.statuses)
        // See note on attacker_cocoon - re-activation needs phase2_until.
        && ctx.time >= ctx.b.cocoon_phase2_until
        && ctx.time >= ctx.b.cocoon_cooldown_until
    {
        let policy_cocoon = resolve_ability_policy(ability_policy, ctx.config.defender_ability_policy_overrides.cocoon);
        let self_side = policy_bridge::build_policy_side(&*ctx.b, ctx.defender, ctx.defender_breath, std::iter::empty());
        let opp_side = policy_bridge::build_policy_side(&*ctx.a, ctx.attacker, ctx.attacker_breath, std::iter::empty());
        let mode = policy_bridge::map_timing_mode(policy_cocoon);
        if policy_bridge::should_activate_now(
            crate::policy::decisions::cocoon::COCOON_DECISION_ID,
            self_side, opp_side, ctx.time, mode,
        ) {
            charge_active_cooldown(&mut ctx.b.cocoon_cooldown_until, ctx.time, ctx.defender, 120.0);
            ctx.b.cocoon_phase1_until = ctx.time + 5.0;
            ctx.b.cocoon_phase2_until = ctx.time + 10.0;
            // See the note in the A-side activation above.
            apply_status_delta(ctx.time, &mut ctx.b.statuses, "Cocoon_Damage_Status", 6.66);
            if let Some(inst) = ctx.b.statuses.get_mut("Cocoon_Damage_Status") {
                inst.next_decay_at = Some(ctx.time + 13.0);
                inst.remaining_sec = 19.98;
            }
            record_ability_event(ctx.b, "B", ctx.combat_log, ctx.record_trace, ctx.time, "Cocoon");
        }
    }

    // Phase 4t-bis: Cocoon Ph1->Ph2. The cocoon closes over the user and lays it
    // down for the five seconds it holds, so from here its regeneration, its
    // ailment decay and the damage a bite would do to it read the Laying
    // multipliers, and its persistent ailments come down because it is still.
    for label in ["A", "B"] {
        let side = if label == "A" { &mut *ctx.a } else { &mut *ctx.b };
        if side.cocoon_phase1_until > 0.0
            && side.cocoon_phase2_until > 0.0
            && ctx.time + 1e-9 >= side.cocoon_phase1_until
            && ctx.time < side.cocoon_phase2_until
            && !side.cocoon_laid_down
        {
            super::super::posture::lay_for_cocoon(side, ctx.time);
            if ctx.record_trace {
                let hp = side.hp.max(0.0);
                ctx.combat_log.push(crate::contracts::CombatLogEntry {
                    time: ctx.time,
                    entry_type: "ability".to_string(),
                    attacker: label.to_string(),
                    damage: 0.0,
                    healing: None,
                    actor_hp_after: hp,
                    hp_side: label.to_string(),
                    hp_after: hp,
                    description: Some("Cocoon closes".to_string()),
                    detail: Some("laid down until the cocoon opens".to_string()),
                    status_id: None,
                });
            }
        }
    }

    // Phase 4u: Cocoon Ph2->Ph3 transition (+30% maxHP lump heal).
    // Must use `time >= phase2_until` here (not `!in_cocoon_phase_2`):
    // immediately after activation we're in P1 which also satisfies
    // `!in_cocoon_phase_2`, and that would fire the transition + reset
    // phases on the very iter cocoon was set up.
    if ctx.a.cocoon_phase1_until > 0.0
        && ctx.a.cocoon_phase2_until > 0.0
        && ctx.time >= ctx.a.cocoon_phase2_until
    {
        let hp_before = ctx.a.hp;
        ctx.a.hp = (ctx.a.hp + ctx.attacker.health * 0.30).min(ctx.attacker.health);
        let healed = ctx.a.hp - hp_before;
        ctx.a.iter_healing_taken += healed; // on_heal accumulator
        ctx.a.cocoon_phase1_until = 0.0;
        ctx.a.cocoon_phase2_until = 0.0;
        super::super::posture::stand_after_cocoon(&mut *ctx.a, ctx.time);
        if ctx.record_trace && healed > 0.0 {
            ctx.combat_log.push(crate::contracts::CombatLogEntry {
                time: ctx.time,
                entry_type: "ability".to_string(),
                attacker: "A".to_string(),
                damage: 0.0,
                healing: Some(healed),
                actor_hp_after: ctx.a.hp,
                hp_side: "A".to_string(),
                hp_after: ctx.a.hp,
                description: Some("Cocoon heal".to_string()),
                detail: Some("+30% maxHP".to_string()),
                status_id: None,
            });
        }
    }
    // See note on the attacker-side Ph2->Ph3 transition above.
    if ctx.b.cocoon_phase1_until > 0.0
        && ctx.b.cocoon_phase2_until > 0.0
        && ctx.time >= ctx.b.cocoon_phase2_until
    {
        let hp_before = ctx.b.hp;
        ctx.b.hp = (ctx.b.hp + ctx.defender.health * 0.30).min(ctx.defender.health);
        let healed = ctx.b.hp - hp_before;
        ctx.b.iter_healing_taken += healed; // on_heal accumulator
        ctx.b.cocoon_phase1_until = 0.0;
        ctx.b.cocoon_phase2_until = 0.0;
        super::super::posture::stand_after_cocoon(&mut *ctx.b, ctx.time);
        if ctx.record_trace && healed > 0.0 {
            ctx.combat_log.push(crate::contracts::CombatLogEntry {
                time: ctx.time,
                entry_type: "ability".to_string(),
                attacker: "B".to_string(),
                damage: 0.0,
                healing: Some(healed),
                actor_hp_after: ctx.b.hp,
                hp_side: "B".to_string(),
                hp_after: ctx.b.hp,
                description: Some("Cocoon heal".to_string()),
                detail: Some("+30% maxHP".to_string()),
                status_id: None,
            });
        }
    }
}

/// Phase 4la + 4l: Lich Mark + Spite. Lich Mark arms an on-hit
/// payload window; Spite arms a charge that doubles on-hit status
/// stacks and amplifies damage on the next bite. Both fire when
/// their cooldowns expire - no policy decision involved.
pub(in super::super) fn process_phase_4_lich_and_spite_cluster(ctx: &mut PhaseContext<'_, '_>) {
    // Phase 4la: Lich Mark activation
    if ctx.config.attacker_lich_mark
        && !ctx.config.head_start_inert_a(ctx.time)
        && !ability_blocked_by_necropoison("Lich Mark", &ctx.a.statuses) && !ctx.a.in_cocoon_phase_2(ctx.time)
        && ctx.time >= ctx.a.lich_mark_cooldown_until
        && ctx.time >= ctx.a.lich_mark_armed_until
    {
        ctx.a.lich_mark_armed_until = ctx.time + LICH_MARK_ARMED_WINDOW_SEC;
        charge_active_cooldown(&mut ctx.a.lich_mark_cooldown_until, ctx.time, ctx.attacker, LICH_MARK_COOLDOWN_SEC);
        record_ability_event(ctx.a, "A", ctx.combat_log, ctx.record_trace, ctx.time, "Lich Mark");
    }
    if ctx.config.defender_lich_mark
        && !ctx.config.head_start_inert_b(ctx.time)
        && !ability_blocked_by_necropoison("Lich Mark", &ctx.b.statuses) && !ctx.b.in_cocoon_phase_2(ctx.time)
        && ctx.time >= ctx.b.lich_mark_cooldown_until
        && ctx.time >= ctx.b.lich_mark_armed_until
    {
        ctx.b.lich_mark_armed_until = ctx.time + LICH_MARK_ARMED_WINDOW_SEC;
        charge_active_cooldown(&mut ctx.b.lich_mark_cooldown_until, ctx.time, ctx.defender, LICH_MARK_COOLDOWN_SEC);
        record_ability_event(ctx.b, "B", ctx.combat_log, ctx.record_trace, ctx.time, "Lich Mark");
    }

    // Phase 4l: Spite activation
    if ctx.config.attacker_spite_value != 0.0
        && !ctx.config.head_start_inert_a(ctx.time)
        && !ability_blocked_by_necropoison("Spite", &ctx.a.statuses) && !ctx.a.in_cocoon_phase_2(ctx.time)
        && !ctx.a.spite_armed
        && ctx.time >= ctx.a.spite_cooldown_until
    {
        // Negative spite (heal target) only activates if attacker has on-hit payload
        let has_offensive_payload = !ctx.attacker.on_hit_statuses.is_empty();
        if ctx.config.attacker_spite_value > 0.0 || has_offensive_payload {
            ctx.a.spite_armed = true;
            ctx.a.spite_charge_ready_at = ctx.time + 5.0;
            charge_active_cooldown(&mut ctx.a.spite_cooldown_until, ctx.time, ctx.attacker, 20.0);
            record_ability_event(ctx.a, "A", ctx.combat_log, ctx.record_trace, ctx.time, "Spite");
        }
    }
    if ctx.config.defender_spite_value != 0.0
        && !ctx.config.head_start_inert_b(ctx.time)
        && !ability_blocked_by_necropoison("Spite", &ctx.b.statuses) && !ctx.b.in_cocoon_phase_2(ctx.time)
        && !ctx.b.spite_armed
        && ctx.time >= ctx.b.spite_cooldown_until
    {
        let has_offensive_payload = !ctx.defender.on_hit_statuses.is_empty();
        if ctx.config.defender_spite_value > 0.0 || has_offensive_payload {
            ctx.b.spite_armed = true;
            ctx.b.spite_charge_ready_at = ctx.time + 5.0;
            charge_active_cooldown(&mut ctx.b.spite_cooldown_until, ctx.time, ctx.defender, 20.0);
            record_ability_event(ctx.b, "B", ctx.combat_log, ctx.record_trace, ctx.time, "Spite");
        }
    }
}

/// Phase 4e + 4f: Cursed Sigil + Drowsy Area. Both apply a status
/// (Bad_Omen for Cursed Sigil, Drowsy_Status for Drowsy Area) to the
/// opponent on cooldown. Distinct from delayed-policy actives
/// (Phase 4g+) because they fire unconditionally when the cooldown
/// expires - no decision engine involved.
pub(in super::super) fn process_phase_4_status_applies_cluster(ctx: &mut PhaseContext<'_, '_>) {
    // Phase 4e: Cursed Sigil
    if ctx.config.attacker_cursed_sigil_stacks > 0.0
        && !ctx.config.head_start_inert_a(ctx.time)
        && ctx.a_within_reach("Cursed Sigil")
        && !ability_blocked_by_necropoison("Cursed Sigil", &ctx.a.statuses) && !ctx.a.in_cocoon_phase_2(ctx.time)
        && ctx.time >= ctx.a.cursed_sigil_cooldown_until
    {
        apply_cursed_sigil_effect(
            ctx.time, ctx.attacker, ctx.defender,
            ctx.a, ctx.b, ctx.config.attacker_cursed_sigil_stacks,
            "A", ctx.combat_log, ctx.record_trace,
        );
    }
    if ctx.config.defender_cursed_sigil_stacks > 0.0
        && !ctx.config.head_start_inert_b(ctx.time)
        && ctx.b_within_reach("Cursed Sigil")
        && !ability_blocked_by_necropoison("Cursed Sigil", &ctx.b.statuses) && !ctx.b.in_cocoon_phase_2(ctx.time)
        && ctx.time >= ctx.b.cursed_sigil_cooldown_until
    {
        apply_cursed_sigil_effect(
            ctx.time, ctx.defender, ctx.attacker,
            ctx.b, ctx.a, ctx.config.defender_cursed_sigil_stacks,
            "B", ctx.combat_log, ctx.record_trace,
        );
    }

    // Phase 4f: Drowsy Area
    if ctx.config.attacker_drowsy_area
        && !ctx.config.head_start_inert_a(ctx.time)
        && ctx.a_within_reach("Drowsy Area")
        && !ability_blocked_by_necropoison("Drowsy Area", &ctx.a.statuses) && !ctx.a.in_cocoon_phase_2(ctx.time)
        && ctx.time >= ctx.a.drowsy_area_cooldown_until
    {
        apply_drowsy_area_effect(
            ctx.time, ctx.attacker, ctx.defender,
            ctx.a, ctx.b, "A", ctx.combat_log, ctx.record_trace,
        );
    }
    if ctx.config.defender_drowsy_area
        && !ctx.config.head_start_inert_b(ctx.time)
        && ctx.b_within_reach("Drowsy Area")
        && !ability_blocked_by_necropoison("Drowsy Area", &ctx.b.statuses) && !ctx.b.in_cocoon_phase_2(ctx.time)
        && ctx.time >= ctx.b.drowsy_area_cooldown_until
    {
        apply_drowsy_area_effect(
            ctx.time, ctx.defender, ctx.attacker,
            ctx.b, ctx.a, "B", ctx.combat_log, ctx.record_trace,
        );
    }
}

/// Phase 4d-bis + 4d-ter: Healing Step + Healing Pulse - the
/// ActiveAbilities-gated half of the healing family. Healing Step
/// heals value% of max HP every 3s while HP <= 65% max. Healing Pulse
/// applies 10 stacks of Healing_Ailment to both sides (radius) every
/// 90s, or once at start in OnceAtStart mode.
pub(in super::super) fn process_phase_4_healing_actives_cluster(
    ctx: &mut PhaseContext<'_, '_>,
    has_any_healing_step: bool,
    has_any_healing_pulse: bool,
) {
    // Phase 4d-bis: Healing Step ticks
    if has_any_healing_step {
        if let Some(next_tick) = ctx.a.healing_step_next_tick_at {
            if (next_tick - ctx.time).abs() <= 1e-9 {
                let max_hp = ctx.attacker.health;
                let value = ctx.config.attacker_healing_step_value;
                if value > 0.0
                    && max_hp > 0.0
                    && ctx.a.hp / max_hp <= HEALING_STEP_THRESHOLD_HP_FRACTION + 1e-9
                    && ctx.a.death_time.is_none()
                {
                    let hp_before = ctx.a.hp;
                    ctx.a.hp = (ctx.a.hp + max_hp * (value / 100.0)).min(max_hp);
                    let healed = ctx.a.hp - hp_before;
                    ctx.a.iter_healing_taken += healed; // on_heal accumulator
                    *ctx.a.ability_activation_counts
                        .entry("Healing Step".to_string())
                        .or_insert(0) += 1;
                    if ctx.record_trace && healed > 0.0 {
                        ctx.combat_log.push(crate::contracts::CombatLogEntry {
                            time: ctx.time,
                            entry_type: "ability".to_string(),
                            attacker: "A".to_string(),
                            damage: 0.0,
                            healing: Some(healed),
                            actor_hp_after: ctx.a.hp,
                            hp_side: "A".to_string(),
                            hp_after: ctx.a.hp,
                            description: Some("Healing Step tick".to_string()),
                            detail: Some(format!("{}% maxHP heal", format_stacks(value))),
                            status_id: None,
                        });
                    }
                }
                ctx.a.healing_step_next_tick_at = Some(ctx.time + HEALING_STEP_TICK_SEC);
            }
        }
        if let Some(next_tick) = ctx.b.healing_step_next_tick_at {
            if (next_tick - ctx.time).abs() <= 1e-9 {
                let max_hp = ctx.defender.health;
                let value = ctx.config.defender_healing_step_value;
                if value > 0.0
                    && max_hp > 0.0
                    && ctx.b.hp / max_hp <= HEALING_STEP_THRESHOLD_HP_FRACTION + 1e-9
                    && ctx.b.death_time.is_none()
                {
                    let hp_before = ctx.b.hp;
                    ctx.b.hp = (ctx.b.hp + max_hp * (value / 100.0)).min(max_hp);
                    let healed = ctx.b.hp - hp_before;
                    ctx.b.iter_healing_taken += healed; // on_heal accumulator
                    *ctx.b.ability_activation_counts
                        .entry("Healing Step".to_string())
                        .or_insert(0) += 1;
                    if ctx.record_trace && healed > 0.0 {
                        ctx.combat_log.push(crate::contracts::CombatLogEntry {
                            time: ctx.time,
                            entry_type: "ability".to_string(),
                            attacker: "B".to_string(),
                            damage: 0.0,
                            healing: Some(healed),
                            actor_hp_after: ctx.b.hp,
                            hp_side: "B".to_string(),
                            hp_after: ctx.b.hp,
                            description: Some("Healing Step tick".to_string()),
                            detail: Some(format!("{}% maxHP heal", format_stacks(value))),
                            status_id: None,
                        });
                    }
                }
                ctx.b.healing_step_next_tick_at = Some(ctx.time + HEALING_STEP_TICK_SEC);
            }
        }
    }

    // Phase 4d-ter: Healing Pulse casts
    if has_any_healing_pulse {
        if ctx.config.attacker_healing_pulse
            && !ctx.config.head_start_inert_a(ctx.time)
            && ctx.a.next_healing_pulse <= ctx.time + 1e-9
            && !ability_blocked_by_necropoison("Healing Pulse", &ctx.a.statuses)
            && !ctx.a.in_cocoon_phase_2(ctx.time)
            && ctx.time >= ctx.a.healing_pulse_cooldown_until
            && ctx.a.death_time.is_none()
        {
            cast_healing_pulse(
                ctx.time, ctx.a, ctx.b, ctx.attacker,
                ctx.config.attacker_healing_pulse_once, "A",
                ctx.combat_log, ctx.record_trace,
            );
        }
        if ctx.config.defender_healing_pulse
            && !ctx.config.head_start_inert_b(ctx.time)
            && ctx.b.next_healing_pulse <= ctx.time + 1e-9
            && !ability_blocked_by_necropoison("Healing Pulse", &ctx.b.statuses)
            && !ctx.b.in_cocoon_phase_2(ctx.time)
            && ctx.time >= ctx.b.healing_pulse_cooldown_until
            && ctx.b.death_time.is_none()
        {
            cast_healing_pulse(
                ctx.time, ctx.b, ctx.a, ctx.defender,
                ctx.config.defender_healing_pulse_once, "B",
                ctx.combat_log, ctx.record_trace,
            );
        }
    }
}

/// One Healing Pulse cast. The pulse lands on everything in its radius, so in
/// `once` mode - the reading where the caster stands alone in it - only the
/// caster is stacked and the ability does not come round again; otherwise the
/// opponent is stacked too and the cooldown starts. The caller owns the
/// readiness check.
pub(crate) fn cast_healing_pulse(
    time: f64,
    caster: &mut CombatSide,
    other: &mut CombatSide,
    stats: &SimpleCombatantStats,
    once: bool,
    label: &str,
    combat_log: &mut Vec<crate::contracts::CombatLogEntry>,
    record_trace: bool,
) {
    let stacks = [SimpleAppliedStatus {
        status_id: "Healing_Ailment".to_string(),
        stacks: HEALING_PULSE_STACKS_PER_CAST,
        ..Default::default()
    }];
    apply_simple_status_list(time, &mut caster.statuses, &stacks);
    if caster.healing_ailment_next_tick_at.is_none() {
        caster.healing_ailment_next_tick_at = Some(time + HEALING_AILMENT_TICK_SEC);
    }
    if !once {
        apply_simple_status_list(time, &mut other.statuses, &stacks);
        if other.healing_ailment_next_tick_at.is_none() {
            other.healing_ailment_next_tick_at = Some(time + HEALING_AILMENT_TICK_SEC);
        }
        charge_active_cooldown(
            &mut caster.healing_pulse_cooldown_until, time, stats, HEALING_PULSE_COOLDOWN_SEC,
        );
        caster.next_healing_pulse = caster.healing_pulse_cooldown_until;
    } else {
        caster.next_healing_pulse = f64::INFINITY;
    }
    record_ability_event(caster, label, combat_log, record_trace, time, "Healing Pulse");
}

/// Phase 4d-quat: Healing Ailment ticks - the StatusTicks-gated tail
/// of the healing family. While Healing_Ailment has stacks > 0, heals
/// +7% of max HP flat every 15s. Bypasses bleed/burn regen-disable
/// (standalone heal, not a regen modifier). Heartbroken status blocks
/// the heal but keeps the scheduler alive for the next tick.
pub(in super::super) fn process_phase_4_healing_ailment_tick(ctx: &mut PhaseContext<'_, '_>) {
    if let Some(next_tick) = ctx.a.healing_ailment_next_tick_at {
        if (next_tick - ctx.time).abs() <= 1e-9 {
            let has_stacks = ctx.a.statuses.get("Healing_Ailment")
                .map(|s| s.stacks > 0.0)
                .unwrap_or(false);
            if has_stacks && ctx.a.death_time.is_none() && ctx.attacker.health > 0.0 {
                let blocked = is_external_healing_blocked(&ctx.a.statuses);
                if !blocked {
                    // In game Healing Pulse adds 7 to the health-regen stat
                    // after the base-regen multipliers have already applied,
                    // so nothing that scales natural regen touches it: status
                    // regen mods (Bleed 0x, Disease 0.75x, ...), Quick Recovery,
                    // Harden and the Compare regen bonus are all bypassed. Only
                    // the recipient's posture multiplies the pulse (x1.5 sitting
                    // / x2 laying, SIT/LAY_HEALTH_MULTIPLIER), and it keeps
                    // firing when bleed/burn have zeroed natural regen.
                    let heal = ctx.attacker.health * (HEALING_AILMENT_HEAL_PCT_PER_TICK / 100.0)
                        * ctx.a.posture_regen_mult();
                    let hp_before = ctx.a.hp;
                    ctx.a.hp = (ctx.a.hp + heal).min(ctx.attacker.health);
                    let healed = ctx.a.hp - hp_before;
                    ctx.a.iter_healing_taken += healed; // on_heal accumulator
                    *ctx.a.ability_activation_counts
                        .entry("Healing Ailment".to_string())
                        .or_insert(0) += 1;
                    if ctx.record_trace && healed > 0.0 {
                        ctx.combat_log.push(crate::contracts::CombatLogEntry {
                            time: ctx.time,
                            entry_type: "status".to_string(),
                            attacker: "A".to_string(),
                            damage: 0.0,
                            healing: Some(healed),
                            actor_hp_after: ctx.a.hp,
                            hp_side: "A".to_string(),
                            hp_after: ctx.a.hp,
                            description: Some("Healing Ailment tick".to_string()),
                            detail: Some(format!(
                                "+{}% maxHP",
                                format_stacks(HEALING_AILMENT_HEAL_PCT_PER_TICK)
                            )),
                            status_id: Some("Healing_Ailment".to_string()),
                        });
                    }
                }
                ctx.a.healing_ailment_next_tick_at = Some(ctx.time + HEALING_AILMENT_TICK_SEC);
            } else {
                ctx.a.healing_ailment_next_tick_at = None;
            }
        }
    }
    if let Some(next_tick) = ctx.b.healing_ailment_next_tick_at {
        if (next_tick - ctx.time).abs() <= 1e-9 {
            let has_stacks = ctx.b.statuses.get("Healing_Ailment")
                .map(|s| s.stacks > 0.0)
                .unwrap_or(false);
            if has_stacks && ctx.b.death_time.is_none() && ctx.defender.health > 0.0 {
                let blocked = is_external_healing_blocked(&ctx.b.statuses);
                if !blocked {
                    // Mirror of the A side: the flat +7 is added on top of
                    // HealthRegen, bypassing every regen multiplier; only
                    // posture scales it and bleed/burn never disable it.
                    let heal = ctx.defender.health * (HEALING_AILMENT_HEAL_PCT_PER_TICK / 100.0)
                        * ctx.b.posture_regen_mult();
                    let hp_before = ctx.b.hp;
                    ctx.b.hp = (ctx.b.hp + heal).min(ctx.defender.health);
                    let healed = ctx.b.hp - hp_before;
                    ctx.b.iter_healing_taken += healed; // on_heal accumulator
                    *ctx.b.ability_activation_counts
                        .entry("Healing Ailment".to_string())
                        .or_insert(0) += 1;
                    if ctx.record_trace && healed > 0.0 {
                        ctx.combat_log.push(crate::contracts::CombatLogEntry {
                            time: ctx.time,
                            entry_type: "status".to_string(),
                            attacker: "B".to_string(),
                            damage: 0.0,
                            healing: Some(healed),
                            actor_hp_after: ctx.b.hp,
                            hp_side: "B".to_string(),
                            hp_after: ctx.b.hp,
                            description: Some("Healing Ailment tick".to_string()),
                            detail: Some(format!(
                                "+{}% maxHP",
                                format_stacks(HEALING_AILMENT_HEAL_PCT_PER_TICK)
                            )),
                            status_id: Some("Healing_Ailment".to_string()),
                        });
                    }
                }
                ctx.b.healing_ailment_next_tick_at = Some(ctx.time + HEALING_AILMENT_TICK_SEC);
            } else {
                ctx.b.healing_ailment_next_tick_at = None;
            }
        }
    }
}

/// Phase 4 traps cluster: Phase 4b (Thorn Trap ticks) + Phase 4b-bis
/// (Toxic Trap activation and 3s poison ticks for 25 bite charges).
/// Both are gated by their respective `has_any_*_trap` flag so they
/// can short-circuit when neither side has the ability.
pub(in super::super) fn process_phase_4_traps_cluster(
    ctx: &mut PhaseContext<'_, '_>,
    has_any_thorn_trap: bool,
    has_any_toxic_trap: bool,
    counters: &mut DamageCounters,
) {
    // Phase 4b: Thorn Trap ticks
    if has_any_thorn_trap {
        if ctx.config.attacker_thorn_trap
            && !ctx.config.head_start_inert_a(ctx.time)
            && ctx.a.next_thorn_trap <= ctx.time + 1e-9
            && !ability_blocked_by_necropoison("Thorn Trap", &ctx.a.statuses) && !ctx.a.in_cocoon_phase_2(ctx.time)
            && ctx.time >= ctx.a.thorn_trap_cooldown_until
        {
            apply_thorn_trap_effect(
                ctx.time, ctx.attacker, ctx.defender,
                ctx.a, ctx.b, "A", ctx.combat_log, ctx.record_trace, &mut counters.dealt_a,
            );
        }
        if ctx.config.defender_thorn_trap
            && !ctx.config.head_start_inert_b(ctx.time)
            && ctx.b.next_thorn_trap <= ctx.time + 1e-9
            && !ability_blocked_by_necropoison("Thorn Trap", &ctx.b.statuses) && !ctx.b.in_cocoon_phase_2(ctx.time)
            && ctx.time >= ctx.b.thorn_trap_cooldown_until
        {
            apply_thorn_trap_effect(
                ctx.time, ctx.defender, ctx.attacker,
                ctx.b, ctx.a, "B", ctx.combat_log, ctx.record_trace, &mut counters.dealt_b,
            );
        }
    }

    // Phase 4b-bis: Toxic Trap activation and ticks
    if has_any_toxic_trap {
        if ctx.config.attacker_toxic_trap
            && !ctx.config.head_start_inert_a(ctx.time)
            && ctx.a.next_toxic_trap <= ctx.time + 1e-9
            && !ability_blocked_by_necropoison("Toxic Trap", &ctx.a.statuses) && !ctx.a.in_cocoon_phase_2(ctx.time)
            && ctx.time >= ctx.a.toxic_trap_cooldown_until
        {
            // A trap that is still active is replaced rather than left to
            // expire, and the replacement starts at 25 bites. The model
            // carries one trap per side.
            ctx.a.toxic_trap_bites_remaining = 25;
            ctx.a.toxic_trap_next_tick_at = Some(ctx.time + 3.0);
            charge_active_cooldown(&mut ctx.a.toxic_trap_cooldown_until, ctx.time, ctx.attacker, 75.0);
            ctx.a.next_toxic_trap = ctx.a.toxic_trap_cooldown_until;
            record_ability_event(ctx.a, "A", ctx.combat_log, ctx.record_trace, ctx.time, "Toxic Trap");
        }
        if ctx.config.defender_toxic_trap
            && !ctx.config.head_start_inert_b(ctx.time)
            && ctx.b.next_toxic_trap <= ctx.time + 1e-9
            && !ability_blocked_by_necropoison("Toxic Trap", &ctx.b.statuses) && !ctx.b.in_cocoon_phase_2(ctx.time)
            && ctx.time >= ctx.b.toxic_trap_cooldown_until
        {
            // A trap that is still active is replaced rather than left to
            // expire, and the replacement starts at 25 bites. The model
            // carries one trap per side.
            ctx.b.toxic_trap_bites_remaining = 25;
            ctx.b.toxic_trap_next_tick_at = Some(ctx.time + 3.0);
            charge_active_cooldown(&mut ctx.b.toxic_trap_cooldown_until, ctx.time, ctx.defender, 75.0);
            ctx.b.next_toxic_trap = ctx.b.toxic_trap_cooldown_until;
            record_ability_event(ctx.b, "B", ctx.combat_log, ctx.record_trace, ctx.time, "Toxic Trap");
        }
        if let Some(next_tick) = ctx.a.toxic_trap_next_tick_at {
            if (next_tick - ctx.time).abs() <= 1e-9 && ctx.a.toxic_trap_bites_remaining > 0 {
                apply_toxic_trap_tick(
                    ctx.time, ctx.defender, ctx.a, ctx.b, "A", ctx.combat_log, ctx.record_trace,
                    ctx.config.stamina_enabled,
                );
            }
        }
        if let Some(next_tick) = ctx.b.toxic_trap_next_tick_at {
            if (next_tick - ctx.time).abs() <= 1e-9 && ctx.b.toxic_trap_bites_remaining > 0 {
                apply_toxic_trap_tick(
                    ctx.time, ctx.attacker, ctx.b, ctx.a, "B", ctx.combat_log, ctx.record_trace,
                    ctx.config.stamina_enabled,
                );
            }
        }
    }
}

/// Apply one Thorn Trap snap to `opp` (6 stacks Bleed + 2 stacks
/// Freeze) and set the user's 35 s cooldown + `next_thorn_trap` re-arm.
/// Shared by the phase4b handler and `sandbox::try_force_thorn_trap`
/// (the reference says the opponent is caught as soon as the trap is
/// activated, so the Sandbox click delivers it synchronously).
pub(in super::super) fn apply_thorn_trap_effect(
    time: f64,
    user_stats: &SimpleCombatantStats,
    opp_stats: &SimpleCombatantStats,
    user: &mut CombatSide,
    opp: &mut CombatSide,
    user_label: &str,
    combat_log: &mut Vec<crate::contracts::CombatLogEntry>,
    record_trace: bool,
    dealt: &mut f64,
) {
    let opp_label = if user_label == "A" { "B" } else { "A" };
    // Trigger damage: a flat percentage of the target's maximum HP, the value
    // we chose. Modeled the same way as Reflux's impact - unbreakable cap,
    // then the pre-damage hook, then credited to the user's dealt-damage
    // counter.
    let trap_damage =
        opp_stats.health * crate::spec_constants::THORN_TRAP_DAMAGE_PCT_MAX_HP / 100.0;
    let applied = apply_unbreakable_damage_cap(trap_damage, opp_stats).min(opp.hp.max(0.0));
    let applied = damage_pipeline::resolve_incoming_damage(
        user, opp, user_stats, opp_stats, time,
        applied, applied, "thorn_trap",
        combat_log, record_trace, user_label, opp_label,
    );
    opp.hp -= applied;
    *dealt += applied;
    if record_trace && applied > 0.0 {
        combat_log.push(crate::contracts::CombatLogEntry {
            time,
            entry_type: "ability".to_string(),
            attacker: user_label.to_string(),
            damage: applied,
            healing: None,
            actor_hp_after: user.hp.max(0.0),
            hp_side: opp_label.to_string(),
            hp_after: opp.hp.max(0.0),
            description: Some("Thorn Trap impact".to_string()),
            detail: Some("5% maxHP direct hit".to_string()),
            status_id: None,
        });
    }
    apply_statuses_with_trace(
        time, opp_stats, opp.hp, &mut opp.statuses,
        &[
            SimpleAppliedStatus {
                status_id: "Bleed_Status".to_string(),
                stacks: 6.0, ..Default::default() },
            SimpleAppliedStatus {
                status_id: "Freeze_Status".to_string(),
                stacks: 2.0, ..Default::default() },
        ],
        opp.fortify_immune_until,
        user_label, user.hp, opp_label, "Thorn Trap",
        if record_trace { Some(combat_log) } else { None },
    );
    charge_active_cooldown(&mut user.thorn_trap_cooldown_until, time, user_stats, 35.0);
    user.next_thorn_trap = user.thorn_trap_cooldown_until;
    record_ability_event(user, user_label, combat_log, record_trace, time, "Thorn Trap");
}

/// Apply one Toxic Trap poison tick to `opp` (5 stacks Poison) and
/// reschedule the next tick at +3 s. The caller is responsible for the
/// `bites_remaining > 0` and `next_tick_at` due-time gates. Shared by
/// the phase4b-bis handler and the Sandbox Manual deferred-tick driver
/// (`sandbox::run_due_armed_ticks`). Note the bite-charge counter is
/// not decremented here, matching the pre-extraction engine behavior
/// (the window is bounded by `next_tick_at`, not by the counter).
pub(in super::super) fn apply_toxic_trap_tick(
    time: f64,
    opp_stats: &SimpleCombatantStats,
    user: &mut CombatSide,
    opp: &mut CombatSide,
    user_label: &str,
    combat_log: &mut Vec<crate::contracts::CombatLogEntry>,
    record_trace: bool,
    stamina_enabled: bool,
) {
    let opp_label = if user_label == "A" { "B" } else { "A" };
    apply_statuses_with_trace(
        time, opp_stats, opp.hp, &mut opp.statuses,
        &[SimpleAppliedStatus {
            status_id: "Poison_Status".to_string(),
            stacks: 5.0, ..Default::default() }],
        opp.fortify_immune_until,
        user_label, user.hp, opp_label, "Toxic Trap",
        if record_trace { Some(combat_log) } else { None },
    );
    if stamina_enabled {
        let drain = crate::composable::stamina::max_stamina(opp, opp_stats)
            * crate::spec_constants::TOXIC_TRAP_STAMINA_LOSS_PER_TICK_PCT
            / 100.0;
        crate::composable::stamina::spend(opp, drain);
    }
    user.toxic_trap_next_tick_at = Some(time + 3.0);
}

/// Phase 4: Hunker decisions - routed through the unified policy
/// decision engine via `policy_bridge`. ReallyFast/Fast map to "always
/// on if eligible"; precision modes use the delta-toggle policy.
/// Cadence gating prevents per-tick re-evaluation under precision
/// modes. First sub-phase of the ActiveAbilities gate; runs only when
/// at least one side has Hunker enabled (`has_any_hunker`).
#[allow(clippy::too_many_arguments)]
pub(in super::super) fn process_phase_4_hunker_decisions(
    ctx: &mut PhaseContext<'_, '_>,
    has_any_hunker: bool,
    attacker_hunker_enabled: bool,
    defender_hunker_enabled: bool,
    ability_policy: SimpleAbilityTimingMode,
    hunker_decision_cadence_sec: f64,
    // Toggle rollout held value (`TOGGLE_ROLLOUT`); `None` => pi-zero gate.
    hunker_forced_a: Option<bool>,
    hunker_forced_b: Option<bool>,
) {
    if !has_any_hunker {
        return;
    }
    // Posture gate: Hunker requires Standing. Phase 1 already
    // deactivates Hunker the moment any posture transition starts,
    // so this gate prevents the policy from RE-activating it while
    // the side is settled in Sit / Lay. Pre-existing `hunker_on`
    // state was already cleared, so the `ctx.a.hunker_on` short-
    // circuit can't pass for a laying side either.
    if attacker_hunker_enabled
        && !ctx.a.posture_settled_non_standing()
    {
        let policy_hunker_a = resolve_ability_policy(ability_policy, ctx.config.attacker_ability_policy_overrides.hunker);
        let always_on_mode = matches!(
            policy_hunker_a,
            SimpleAbilityTimingMode::Fast | SimpleAbilityTimingMode::ReallyFast
        );
        let cadence_due = hunker_decision_cadence_reached(
            ctx.time,
            ctx.a.hunker_last_decision_at,
            hunker_decision_cadence_sec,
        );
        let previous_hunker = ctx.a.hunker_on;
        // Toggle rollout (flag on): apply the epoch-committed held value
        // every tick (the epoch throttle already bounded the expensive
        // replay). Flag off => `None` => the pi-zero gate under the cadence
        // throttle, byte-identical.
        let next_on = match hunker_forced_a {
            Some(v) => Some(v),
            None if always_on_mode || cadence_due => {
                // Forward current ON/OFF state via extras so the
                // decision can apply hysteresis (avoid per-tick flicker
                // in long fights).
                let self_side = policy_bridge::build_policy_side(
                    &*ctx.a,
                    ctx.attacker,
                    ctx.attacker_breath,
                    [policy_bridge::hunker_currently_on_extra(previous_hunker)],
                );
                let opp_side = policy_bridge::build_policy_side(&*ctx.b, ctx.defender, ctx.defender_breath, std::iter::empty());
                let mode = policy_bridge::map_timing_mode(policy_hunker_a);
                Some(policy_bridge::toggle_state_now(
                    crate::policy::decisions::hunker::HUNKER_DECISION_ID,
                    self_side, opp_side, ctx.time, mode,
                ))
            }
            None => None,
        };
        if let Some(next_on) = next_on {
            ctx.a.hunker_on = next_on;
            ctx.a.hunker_effect_starts_at = resolve_hunker_effect_starts_at(
                previous_hunker,
                ctx.a.hunker_on,
                ctx.time,
                ctx.a.hunker_effect_starts_at,
                ctx.a.hunker_activation_count,
            );
            if !previous_hunker && ctx.a.hunker_on {
                ctx.a.hunker_activation_count += 1;
                if ctx.record_trace {
                    ctx.combat_log.push(crate::contracts::CombatLogEntry {
                        time: ctx.time,
                        entry_type: "ability".to_string(),
                        attacker: "A".to_string(),
                        damage: 0.0,
                        healing: None,
                        actor_hp_after: ctx.a.hp.max(0.0),
                        hp_side: "A".to_string(),
                        hp_after: ctx.a.hp.max(0.0),
                        description: Some("Hunker activated".to_string()),
                        detail: None,
                        status_id: None,
                    });
                }
            } else if previous_hunker && !ctx.a.hunker_on && ctx.record_trace {
                ctx.combat_log.push(crate::contracts::CombatLogEntry {
                    time: ctx.time,
                    entry_type: "ability".to_string(),
                    attacker: "A".to_string(),
                    damage: 0.0,
                    healing: None,
                    actor_hp_after: ctx.a.hp.max(0.0),
                    hp_side: "A".to_string(),
                    hp_after: ctx.a.hp.max(0.0),
                    description: Some("Hunker deactivated".to_string()),
                    detail: None,
                    status_id: None,
                });
            }
            ctx.a.hunker_last_decision_at = ctx.time;
        }
    }

    if defender_hunker_enabled
        && !ctx.b.posture_settled_non_standing()
    {
        let policy_hunker_b = resolve_ability_policy(ability_policy, ctx.config.defender_ability_policy_overrides.hunker);
        let always_on_mode = matches!(
            policy_hunker_b,
            SimpleAbilityTimingMode::Fast | SimpleAbilityTimingMode::ReallyFast
        );
        let cadence_due = hunker_decision_cadence_reached(
            ctx.time,
            ctx.b.hunker_last_decision_at,
            hunker_decision_cadence_sec,
        );
        let previous_hunker = ctx.b.hunker_on;
        // See A-side mirror - toggle rollout held value, else pi-zero gate.
        let next_on = match hunker_forced_b {
            Some(v) => Some(v),
            None if always_on_mode || cadence_due => {
                let self_side = policy_bridge::build_policy_side(
                    &*ctx.b,
                    ctx.defender,
                    ctx.defender_breath,
                    [policy_bridge::hunker_currently_on_extra(previous_hunker)],
                );
                let opp_side = policy_bridge::build_policy_side(&*ctx.a, ctx.attacker, ctx.attacker_breath, std::iter::empty());
                let mode = policy_bridge::map_timing_mode(policy_hunker_b);
                Some(policy_bridge::toggle_state_now(
                    crate::policy::decisions::hunker::HUNKER_DECISION_ID,
                    self_side, opp_side, ctx.time, mode,
                ))
            }
            None => None,
        };
        if let Some(next_on) = next_on {
            ctx.b.hunker_on = next_on;
            ctx.b.hunker_effect_starts_at = resolve_hunker_effect_starts_at(
                previous_hunker,
                ctx.b.hunker_on,
                ctx.time,
                ctx.b.hunker_effect_starts_at,
                ctx.b.hunker_activation_count,
            );
            if !previous_hunker && ctx.b.hunker_on {
                ctx.b.hunker_activation_count += 1;
                if ctx.record_trace {
                    ctx.combat_log.push(crate::contracts::CombatLogEntry {
                        time: ctx.time,
                        entry_type: "ability".to_string(),
                        attacker: "B".to_string(),
                        damage: 0.0,
                        healing: None,
                        actor_hp_after: ctx.b.hp.max(0.0),
                        hp_side: "B".to_string(),
                        hp_after: ctx.b.hp.max(0.0),
                        description: Some("Hunker activated".to_string()),
                        detail: None,
                        status_id: None,
                    });
                }
            } else if previous_hunker && !ctx.b.hunker_on && ctx.record_trace {
                ctx.combat_log.push(crate::contracts::CombatLogEntry {
                    time: ctx.time,
                    entry_type: "ability".to_string(),
                    attacker: "B".to_string(),
                    damage: 0.0,
                    healing: None,
                    actor_hp_after: ctx.b.hp.max(0.0),
                    hp_side: "B".to_string(),
                    hp_after: ctx.b.hp.max(0.0),
                    description: Some("Hunker deactivated".to_string()),
                    detail: None,
                    status_id: None,
                });
            }
            ctx.b.hunker_last_decision_at = ctx.time;
        }
    }
}

/// What one Seedling Mist step reads about the side that owns it.
pub(crate) struct SeedlingMistStep {
    pub time: f64,
    pub owner_is_a: bool,
    /// Whether the step may start a fresh charge. The fight starts one on its
    /// own; the Sandbox leaves that to the button and passes `false`.
    pub allow_start: bool,
    pub inert: bool,
}

/// One Seedling Mist step for the side that owns it: start a charge, resolve a
/// charge that has finished, and run a tick that is due. A tick heals every
/// creature standing in the mist, which in a fight is both fighters, so both
/// sides are written. Returns whether anything moved.
pub(crate) fn step_seedling_mist(
    step: SeedlingMistStep,
    a: &mut CombatSide,
    b: &mut CombatSide,
    attacker: &SimpleCombatantStats,
    defender: &SimpleCombatantStats,
    combat_log: &mut Vec<crate::contracts::CombatLogEntry>,
    record_trace: bool,
) -> bool {
    let SeedlingMistStep { time, owner_is_a, allow_start, inert } = step;
    let label = if owner_is_a { "A" } else { "B" };
    let owner_stats = if owner_is_a { attacker } else { defender };
    let mut moved = false;
    {
        let side = if owner_is_a { &mut *a } else { &mut *b };
        // Start a charge when nothing is in flight and the cooldown allows.
        if allow_start
            && !inert
            && !side.seedling_mist_armed
            && side.seedling_mist_ticks_left == 0
            && time >= side.seedling_mist_cooldown_until
            && !side.posture_settled_non_standing()
            && !ability_blocked_by_necropoison("Seedling Mist", &side.statuses)
        {
            arm_seedling_mist_charge(side, time, owner_stats, label, combat_log, record_trace);
            moved = true;
        }
        // The area appears and has all of its ticks left, the first one an
        // interval on. The ticks are counted off that moment rather than off
        // the loop's current time, so a wake that arrives late does not carry
        // the whole series with it.
        if side.seedling_mist_armed && time + 1e-9 >= side.seedling_mist_area_at {
            side.seedling_mist_armed = false;
            side.seedling_mist_ticks_left = area_tick_count(
                SEEDLING_MIST_DURATION_SEC,
                crate::spec_constants::SEEDLING_MIST_TICK_INTERVAL_SEC,
            );
            side.seedling_mist_next_tick_at = side.seedling_mist_area_at
                + crate::spec_constants::SEEDLING_MIST_TICK_INTERVAL_SEC;
            moved = true;
        }
    }
    // A tick heals both sides, so it is applied outside the borrow above.
    let due = if owner_is_a { a.seedling_mist_next_tick_at } else { b.seedling_mist_next_tick_at };
    let left = if owner_is_a { a.seedling_mist_ticks_left } else { b.seedling_mist_ticks_left };
    if left > 0 && time + 1e-9 >= due {
        let pct = crate::spec_constants::SEEDLING_MIST_HEAL_PCT_MAX_HP / 100.0;
        let heal_a = attacker.health.max(0.0) * pct;
        let heal_b = defender.health.max(0.0) * pct;
        a.hp = (a.hp + heal_a).min(attacker.health);
        b.hp = (b.hp + heal_b).min(defender.health);
        let next = due + crate::spec_constants::SEEDLING_MIST_TICK_INTERVAL_SEC;
        if owner_is_a {
            a.seedling_mist_ticks_left = left - 1;
            a.seedling_mist_next_tick_at = next;
        } else {
            b.seedling_mist_ticks_left = left - 1;
            b.seedling_mist_next_tick_at = next;
        }
        if record_trace {
            for (side_label, healed, hp) in [
                ("A", heal_a, a.hp.max(0.0)),
                ("B", heal_b, b.hp.max(0.0)),
            ] {
                combat_log.push(crate::contracts::CombatLogEntry {
                    time,
                    entry_type: "heal".to_string(),
                    attacker: label.to_string(),
                    damage: 0.0,
                    healing: Some(healed),
                    actor_hp_after: hp,
                    hp_side: side_label.to_string(),
                    hp_after: hp,
                    description: Some("Seedling Mist tick".to_string()),
                    detail: None,
                    status_id: None,
                });
            }
        }
        moved = true;
    }
    moved
}

/// Start a Seedling Mist charge on one side and put the ability on cooldown.
/// The cooldown runs from the start of the charge, the same way Reflux's does.
/// The caller owns the readiness check.
pub(crate) fn arm_seedling_mist_charge(
    side: &mut CombatSide,
    time: f64,
    user_stats: &SimpleCombatantStats,
    label: &str,
    combat_log: &mut Vec<crate::contracts::CombatLogEntry>,
    record_trace: bool,
) {
    side.seedling_mist_armed = true;
    side.seedling_mist_area_at = time
        + crate::spec_constants::SEEDLING_MIST_CHARGE_SEC
        + SEEDLING_MIST_AREA_DELAY_SEC;
    charge_active_cooldown(&mut side.seedling_mist_cooldown_until, time, user_stats, crate::spec_constants::SEEDLING_MIST_COOLDOWN_SEC,);
    if record_trace {
        let hp = side.hp.max(0.0);
        combat_log.push(crate::contracts::CombatLogEntry {
            time,
            entry_type: "ability".to_string(),
            attacker: label.to_string(),
            damage: 0.0,
            healing: None,
            actor_hp_after: hp,
            hp_side: label.to_string(),
            hp_after: hp,
            description: Some("Seedling Mist charge started".to_string()),
            detail: None,
            status_id: None,
        });
    }
}

/// One Heal Aura tick for the side that owns it, when one is due. The aura
/// covers both fighters, so both sides are written; the share is read off the
/// creature being healed. Returns whether the tick ran.
pub(crate) fn step_heal_aura(
    time: f64,
    value: f64,
    owner_is_a: bool,
    a: &mut CombatSide,
    b: &mut CombatSide,
    attacker: &SimpleCombatantStats,
    defender: &SimpleCombatantStats,
    combat_log: &mut Vec<crate::contracts::CombatLogEntry>,
    record_trace: bool,
) -> bool {
    let label = if owner_is_a { "A" } else { "B" };
    let due = if owner_is_a { a.next_heal_aura } else { b.next_heal_aura };
    if time + 1e-9 < due {
        return false;
    }
    let next = due + crate::spec_constants::HEAL_AURA_INTERVAL_SEC;
    if owner_is_a { a.next_heal_aura = next; } else { b.next_heal_aura = next; }
    let heal_a = attacker.health.max(0.0) * value / 100.0;
    let heal_b = defender.health.max(0.0) * value / 100.0;
    a.hp = (a.hp + heal_a).min(attacker.health);
    b.hp = (b.hp + heal_b).min(defender.health);
    if record_trace {
        for (side_label, healed, hp) in [
            ("A", heal_a, a.hp.max(0.0)),
            ("B", heal_b, b.hp.max(0.0)),
        ] {
            combat_log.push(crate::contracts::CombatLogEntry {
                time,
                entry_type: "heal".to_string(),
                attacker: label.to_string(),
                damage: 0.0,
                healing: Some(healed),
                actor_hp_after: hp,
                hp_side: side_label.to_string(),
                hp_after: hp,
                description: Some("Heal Aura".to_string()),
                detail: Some(format!("{value}% of maximum health")),
                status_id: None,
            });
        }
    }
    true
}

/// One Tangled Reckoning step for a side: switch the toggle on when it is
/// allowed to and run the heal that is due while it holds. Returns whether
/// anything moved.
pub(crate) fn step_tangled_reckoning(
    time: f64,
    allow_start: bool,
    inert: bool,
    side: &mut CombatSide,
    stats: &SimpleCombatantStats,
    label: &str,
    combat_log: &mut Vec<crate::contracts::CombatLogEntry>,
    record_trace: bool,
) -> bool {
    let mut moved = false;
    if allow_start
        && !side.tangled_reckoning_on
        && !inert
        && !side.posture_settled_non_standing()
        && time >= side.tangled_reckoning_cooldown_until
        && !ability_blocked_by_necropoison("Tangled Reckoning", &side.statuses)
    {
        activate_tangled_reckoning(side, stats, time, label, combat_log, record_trace);
        moved = true;
    }
    // The heal runs once a second for as long as the toggle holds, the
    // opening lock included.
    if side.tangled_reckoning_on && time + 1e-9 >= side.tangled_reckoning_next_heal {
        let healed = stats.health.max(0.0)
            * crate::spec_constants::TANGLED_RECKONING_HEAL_PCT_MAX_HP_PER_SEC
            / 100.0;
        side.hp = (side.hp + healed).min(stats.health);
        side.tangled_reckoning_next_heal += 1.0;
        if record_trace {
            let hp = side.hp.max(0.0);
            combat_log.push(crate::contracts::CombatLogEntry {
                time,
                entry_type: "heal".to_string(),
                attacker: label.to_string(),
                damage: 0.0,
                healing: Some(healed),
                actor_hp_after: hp,
                hp_side: label.to_string(),
                hp_after: hp,
                description: Some("Tangled Reckoning heal".to_string()),
                detail: None,
                status_id: None,
            });
        }
        moved = true;
    }
    moved
}

/// Switch Tangled Reckoning on: the root holds the side in place for the
/// opening lock, so its next attack cannot land before the lock ends. The
/// caller owns the readiness check.
pub(crate) fn activate_tangled_reckoning(
    side: &mut CombatSide,
    stats: &SimpleCombatantStats,
    time: f64,
    label: &str,
    combat_log: &mut Vec<crate::contracts::CombatLogEntry>,
    record_trace: bool,
) {
    side.tangled_reckoning_on = true;
    side.tangled_reckoning_locked_until =
        time + crate::spec_constants::TANGLED_RECKONING_LOCK_SEC;
    side.tangled_reckoning_next_heal = time + 1.0;
    // Rooting is what the cooldown is charged for. A fight leaves the root on
    // and so never reads it back; a side taken out of the root by hand cannot
    // go straight back in.
    charge_active_cooldown(&mut side.tangled_reckoning_cooldown_until, time, stats, crate::spec_constants::TANGLED_RECKONING_COOLDOWN_SEC);
    side.next_hit = side.next_hit.max(side.tangled_reckoning_locked_until);
    if record_trace {
        let hp = side.hp.max(0.0);
        combat_log.push(crate::contracts::CombatLogEntry {
            time,
            entry_type: "ability".to_string(),
            attacker: label.to_string(),
            damage: 0.0,
            healing: None,
            actor_hp_after: hp,
            hp_side: label.to_string(),
            hp_after: hp,
            description: Some("Tangled Reckoning activated".to_string()),
            detail: Some(format!(
                "rooted, {:.0}s before it acts again",
                crate::spec_constants::TANGLED_RECKONING_LOCK_SEC
            )),
            status_id: None,
        });
    }
}

/// What one side's Life Of The Forest reads when it is due.
pub(crate) struct LifeOfTheForestGrant<'a> {
    pub active: bool,
    pub fixed_plants: f64,
    pub random_plants: bool,
    pub once: bool,
    pub inert: bool,
    pub label: &'a str,
}

/// Grant the overshield if the side's next firing has come due. What it grants
/// is a share of maximum health per plant standing inside its radius, capped,
/// and the plant count is a battle setting rather than a figure of the build.
///
/// A side reaches this from the ability phase in a fight, and from the Sandbox's
/// manual drain: nothing about the ability is pressed, so a mode that filters
/// the ability phase out would otherwise leave it unable to fire at all.
pub(crate) fn grant_life_of_the_forest_if_due(
    grant: LifeOfTheForestGrant<'_>,
    side: &mut CombatSide,
    stats: &SimpleCombatantStats,
    time: f64,
    combat_log: &mut Vec<crate::contracts::CombatLogEntry>,
    record_trace: bool,
) {
    if !grant.active || grant.inert || side.posture_settled_non_standing() {
        return;
    }
    if side.next_life_of_the_forest > time + 1e-9 {
        return;
    }
    side.next_life_of_the_forest = if grant.once {
        f64::INFINITY
    } else {
        time + scale_active_cooldown(stats, LIFE_OF_THE_FOREST_COOLDOWN)
    };
    let plants = if grant.random_plants {
        random_plant_count(&mut side.life_of_the_forest_rng)
    } else {
        grant.fixed_plants.min(LIFE_OF_THE_FOREST_MAX_PLANTS)
    };
    let max_hp = stats.health.max(0.0);
    let granted = max_hp * (plants * LIFE_OF_THE_FOREST_PCT_PER_PLANT / 100.0);
    let cap = max_hp * LIFE_OF_THE_FOREST_CAP_PCT / 100.0;
    let before = side.overshield;
    side.overshield = (side.overshield + granted).min(cap);
    if record_trace {
        let added = side.overshield - before;
        let hp = side.hp.max(0.0);
        combat_log.push(crate::contracts::CombatLogEntry {
            time,
            entry_type: "ability".to_string(),
            attacker: grant.label.to_string(),
            damage: 0.0,
            healing: None,
            actor_hp_after: hp,
            hp_side: grant.label.to_string(),
            hp_after: hp,
            description: Some("Life Of The Forest activated".to_string()),
            detail: Some(format!("+{added:.0} overshield from {plants:.0} plants")),
            status_id: None,
        });
    }
}
