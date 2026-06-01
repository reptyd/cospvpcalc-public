//! Phase 4 cluster: all process_phase_4_* functions plus the shared
//! helper effects (apply_cause_fear_effect etc.) extracted from phases/mod.rs.
//!
//! These helpers are also called from sandbox.rs via super::phases::apply_*
//! so they are re-exported from phases/mod.rs at pub(super) visibility.

#![allow(clippy::too_many_arguments)]

use super::super::*;
use crate::composable::ability_metadata::ability_blocked_by_necropoison;
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
        let frost_status = [SimpleAppliedStatus {
            status_id: "Frostbite_Status".to_string(),
            stacks: 5.0, source_ability: None }];
        if ctx.config.attacker_frost_snare
            && ctx.a.next_frost_snare <= ctx.time + 1e-9
            && !ability_blocked_by_necropoison("Frost Snare", &ctx.a.statuses) && !ctx.a.in_cocoon_phase_2(ctx.time)
            && ctx.time >= ctx.a.frost_snare_cooldown_until
        {
            apply_incoming_statuses_to_target_with_fortify_immunity(
                ctx.time, ctx.defender, ctx.b.hp, &mut ctx.b.statuses, &frost_status,
                ctx.b.fortify_immune_until,
            );
            let a_cd = scale_active_cooldown(ctx.attacker, 205.0);
            ctx.a.frost_snare_cooldown_until = ctx.time + a_cd;
            ctx.a.next_frost_snare = ctx.time + a_cd;
            record_ability_event(ctx.a, "A", ctx.combat_log, ctx.record_trace, ctx.time, "Frost Snare");
        }
        if ctx.config.defender_frost_snare
            && ctx.b.next_frost_snare <= ctx.time + 1e-9
            && !ability_blocked_by_necropoison("Frost Snare", &ctx.b.statuses) && !ctx.b.in_cocoon_phase_2(ctx.time)
            && ctx.time >= ctx.b.frost_snare_cooldown_until
        {
            apply_incoming_statuses_to_target_with_fortify_immunity(
                ctx.time, ctx.attacker, ctx.a.hp, &mut ctx.a.statuses, &frost_status,
                ctx.a.fortify_immune_until,
            );
            let b_cd = scale_active_cooldown(ctx.defender, 205.0);
            ctx.b.frost_snare_cooldown_until = ctx.time + b_cd;
            ctx.b.next_frost_snare = ctx.time + b_cd;
            record_ability_event(ctx.b, "B", ctx.combat_log, ctx.record_trace, ctx.time, "Frost Snare");
        }
    }

    // Phase 4c-bis: Poison Area ticks
    if has_any_poison_area {
        let poison_status = [SimpleAppliedStatus {
            status_id: "Poison_Status".to_string(),
            stacks: 5.0, source_ability: None }];
        if ctx.config.attacker_poison_area
            && ctx.a.next_poison_area <= ctx.time + 1e-9
            && !ability_blocked_by_necropoison("Poison Area", &ctx.a.statuses) && !ctx.a.in_cocoon_phase_2(ctx.time)
            && ctx.time >= ctx.a.poison_area_cooldown_until
        {
            apply_incoming_statuses_to_target_with_fortify_immunity(
                ctx.time, ctx.defender, ctx.b.hp, &mut ctx.b.statuses, &poison_status,
                ctx.b.fortify_immune_until,
            );
            let a_cd = scale_active_cooldown(ctx.attacker, 15.0);
            ctx.a.poison_area_cooldown_until = ctx.time + a_cd;
            ctx.a.next_poison_area = ctx.time + a_cd;
            record_ability_event(ctx.a, "A", ctx.combat_log, ctx.record_trace, ctx.time, "Poison Area");
        }
        if ctx.config.defender_poison_area
            && ctx.b.next_poison_area <= ctx.time + 1e-9
            && !ability_blocked_by_necropoison("Poison Area", &ctx.b.statuses) && !ctx.b.in_cocoon_phase_2(ctx.time)
            && ctx.time >= ctx.b.poison_area_cooldown_until
        {
            apply_incoming_statuses_to_target_with_fortify_immunity(
                ctx.time, ctx.attacker, ctx.a.hp, &mut ctx.a.statuses, &poison_status,
                ctx.a.fortify_immune_until,
            );
            let b_cd = scale_active_cooldown(ctx.defender, 15.0);
            ctx.b.poison_area_cooldown_until = ctx.time + b_cd;
            ctx.b.next_poison_area = ctx.time + b_cd;
            record_ability_event(ctx.b, "B", ctx.combat_log, ctx.record_trace, ctx.time, "Poison Area");
        }
    }

    // Phase 4c-ter: Yolk Bomb ticks
    if has_any_yolk_bomb {
        if ctx.config.attacker_yolk_bomb
            && ctx.a.next_yolk_bomb <= ctx.time + 1e-9
            && !ability_blocked_by_necropoison("Yolk Bomb", &ctx.a.statuses) && !ctx.a.in_cocoon_phase_2(ctx.time)
            && ctx.time >= ctx.a.yolk_bomb_cooldown_until
        {
            apply_yolk_bomb(
                ctx.time,
                ctx.config.attacker_yolk_bomb_value.as_deref(),
                ctx.attacker,
                ctx.defender,
                ctx.a.hp,
                ctx.b.hp,
                &mut ctx.a.statuses,
                &mut ctx.b.statuses,
                ctx.a.fortify_immune_until,
                ctx.b.fortify_immune_until,
                &mut ctx.a.fortify_immune_until,
                &mut ctx.a.fortify_weight_bonus_until,
            );
            ctx.a.yolk_bomb_cooldown_until = ctx.time + scale_active_cooldown(ctx.attacker, 30.0);
            ctx.a.next_yolk_bomb = ctx.a.yolk_bomb_cooldown_until;
            record_ability_event(ctx.a, "A", ctx.combat_log, ctx.record_trace, ctx.time, "Yolk Bomb");
        }
        if ctx.config.defender_yolk_bomb
            && ctx.b.next_yolk_bomb <= ctx.time + 1e-9
            && !ability_blocked_by_necropoison("Yolk Bomb", &ctx.b.statuses) && !ctx.b.in_cocoon_phase_2(ctx.time)
            && ctx.time >= ctx.b.yolk_bomb_cooldown_until
        {
            apply_yolk_bomb(
                ctx.time,
                ctx.config.defender_yolk_bomb_value.as_deref(),
                ctx.defender,
                ctx.attacker,
                ctx.b.hp,
                ctx.a.hp,
                &mut ctx.b.statuses,
                &mut ctx.a.statuses,
                ctx.b.fortify_immune_until,
                ctx.a.fortify_immune_until,
                &mut ctx.b.fortify_immune_until,
                &mut ctx.b.fortify_weight_bonus_until,
            );
            ctx.b.yolk_bomb_cooldown_until = ctx.time + scale_active_cooldown(ctx.defender, 30.0);
            ctx.b.next_yolk_bomb = ctx.b.yolk_bomb_cooldown_until;
            record_ability_event(ctx.b, "B", ctx.combat_log, ctx.record_trace, ctx.time, "Yolk Bomb");
        }
    }

    // Phase 4c-quat: Divination activation
    if has_any_divination {
        if ctx.config.attacker_divination
            && ctx.a.next_divination <= ctx.time + 1e-9
            && !ability_blocked_by_necropoison("Divination", &ctx.a.statuses) && !ctx.a.in_cocoon_phase_2(ctx.time)
            && ctx.time >= ctx.a.divination_cooldown_until
            && ctx.a.divination_charges_left == 0
        {
            ctx.a.divination_charges_left = 3;
            ctx.a.divination_cooldown_until = ctx.time + scale_active_cooldown(ctx.attacker, 120.0);
            ctx.a.next_divination = ctx.a.divination_cooldown_until;
            record_ability_event(ctx.a, "A", ctx.combat_log, ctx.record_trace, ctx.time, "Divination");
        }
        if ctx.config.defender_divination
            && ctx.b.next_divination <= ctx.time + 1e-9
            && !ability_blocked_by_necropoison("Divination", &ctx.b.statuses) && !ctx.b.in_cocoon_phase_2(ctx.time)
            && ctx.time >= ctx.b.divination_cooldown_until
            && ctx.b.divination_charges_left == 0
        {
            ctx.b.divination_charges_left = 3;
            ctx.b.divination_cooldown_until = ctx.time + scale_active_cooldown(ctx.defender, 120.0);
            ctx.b.next_divination = ctx.b.divination_cooldown_until;
            record_ability_event(ctx.b, "B", ctx.combat_log, ctx.record_trace, ctx.time, "Divination");
        }
    }
}

/// Phase 4 aura+trails cluster: Phase 4d (Aura subtype-driven ticks)
/// + Phase 4d-bis0 (Damage trails — Flame/Frost/Plague/Toxic). Aura
///   status ids are pre-resolved by the megafunction (the subtype is in
///   config but the status id mapping depends on it); damage trails
///   loop over their four flavours per side.
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
            if (next_tick - ctx.time).abs() <= 1e-9 && !ctx.a.in_cocoon_phase_2(ctx.time) {
                if let Some(status_id) = attacker_aura_status {
                    let subtype = ctx.config.attacker_aura_subtype.as_deref().unwrap_or("");
                    let display = format!("Aura ({})", subtype);
                    apply_statuses_with_trace(
                        ctx.time, ctx.defender, ctx.b.hp, &mut ctx.b.statuses,
                        &[SimpleAppliedStatus {
                            status_id: status_id.to_string(),
                            stacks: AURA_AILMENT_STACKS,
                            source_ability: Some(display.clone()),
                        }],
                        ctx.b.fortify_immune_until,
                        "A", ctx.a.hp, "B", display.as_str(),
                        if ctx.record_trace { Some(ctx.combat_log) } else { None },
                    );
                    if ctx.a.ability_activation_counts.get(display.as_str()).copied().unwrap_or(0) == 0 {
                        record_ability_event(ctx.a, "A", ctx.combat_log, ctx.record_trace, ctx.time, display.as_str());
                    }
                }
                ctx.a.aura_next_tick_at = Some(ctx.time + AURA_TICK_SEC);
            }
        }
        if let Some(next_tick) = ctx.b.aura_next_tick_at {
            if (next_tick - ctx.time).abs() <= 1e-9 && !ctx.b.in_cocoon_phase_2(ctx.time) {
                if let Some(status_id) = defender_aura_status {
                    let subtype = ctx.config.defender_aura_subtype.as_deref().unwrap_or("");
                    let display = format!("Aura ({})", subtype);
                    apply_statuses_with_trace(
                        ctx.time, ctx.attacker, ctx.a.hp, &mut ctx.a.statuses,
                        &[SimpleAppliedStatus {
                            status_id: status_id.to_string(),
                            stacks: AURA_AILMENT_STACKS,
                            source_ability: Some(display.clone()),
                        }],
                        ctx.a.fortify_immune_until,
                        "B", ctx.b.hp, "A", display.as_str(),
                        if ctx.record_trace { Some(ctx.combat_log) } else { None },
                    );
                    if ctx.b.ability_activation_counts.get(display.as_str()).copied().unwrap_or(0) == 0 {
                        record_ability_event(ctx.b, "B", ctx.combat_log, ctx.record_trace, ctx.time, display.as_str());
                    }
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
                    let specs: [(f64, &str, &str); 4] = [
                        (ctx.config.attacker_flame_trail_value, "Burn_Status", "Flame Trail"),
                        (ctx.config.attacker_frost_trail_value, "Frostbite_Status", "Frost Trail"),
                        (ctx.config.attacker_plague_trail_value, "Disease_Status", "Plague Trail"),
                        (ctx.config.attacker_toxic_trail_value, "Poison_Status", "Toxic Trail"),
                    ];
                    for (value, status_id, ability_name) in specs.iter() {
                        if is_damage_trail_active(ctx.a.hp, ctx.attacker.health, *value) {
                            let dmg = ctx.defender.health * DAMAGE_TRAIL_DAMAGE_FRACTION;
                            let actual =
                                apply_unbreakable_damage_cap(dmg, ctx.defender).min(ctx.b.hp.max(0.0));
                            // G3: route the damage-trail tick through the hook.
                            let actual = user_dispatch::run_pre_damage_hooks(
                                ctx.a, ctx.b, ctx.attacker, ctx.defender, ctx.time,
                                actual, actual, "trail",
                                ctx.combat_log, ctx.record_trace, "A", "B",
                            );
                            ctx.b.hp -= actual;
                            counters.dealt_a += actual;
                            apply_incoming_statuses_to_target_with_fortify_immunity(
                                ctx.time, ctx.defender, ctx.b.hp, &mut ctx.b.statuses,
                                &[SimpleAppliedStatus {
                                    status_id: (*status_id).to_string(),
                                    stacks: DAMAGE_TRAIL_STATUS_STACKS, source_ability: None }],
                                ctx.b.fortify_immune_until,
                            );
                            if ctx.a.ability_activation_counts.get(*ability_name).copied().unwrap_or(0) == 0 {
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
                    let specs: [(f64, &str, &str); 4] = [
                        (ctx.config.defender_flame_trail_value, "Burn_Status", "Flame Trail"),
                        (ctx.config.defender_frost_trail_value, "Frostbite_Status", "Frost Trail"),
                        (ctx.config.defender_plague_trail_value, "Disease_Status", "Plague Trail"),
                        (ctx.config.defender_toxic_trail_value, "Poison_Status", "Toxic Trail"),
                    ];
                    for (value, status_id, ability_name) in specs.iter() {
                        if is_damage_trail_active(ctx.b.hp, ctx.defender.health, *value) {
                            let dmg = ctx.attacker.health * DAMAGE_TRAIL_DAMAGE_FRACTION;
                            let actual =
                                apply_unbreakable_damage_cap(dmg, ctx.attacker).min(ctx.a.hp.max(0.0));
                            // G3: route the damage-trail tick through the hook.
                            let actual = user_dispatch::run_pre_damage_hooks(
                                ctx.b, ctx.a, ctx.defender, ctx.attacker, ctx.time,
                                actual, actual, "trail",
                                ctx.combat_log, ctx.record_trace, "B", "A",
                            );
                            ctx.a.hp -= actual;
                            counters.dealt_b += actual;
                            apply_incoming_statuses_to_target_with_fortify_immunity(
                                ctx.time, ctx.attacker, ctx.a.hp, &mut ctx.a.statuses,
                                &[SimpleAppliedStatus {
                                    status_id: (*status_id).to_string(),
                                    stacks: DAMAGE_TRAIL_STATUS_STACKS, source_ability: None }],
                                ctx.a.fortify_immune_until,
                            );
                            if ctx.b.ability_activation_counts.get(*ability_name).copied().unwrap_or(0) == 0 {
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

/// Phase 4g + 4h + 4i + 4j + 4k: delayed-activation policy actives.
///
/// All five abilities route through the unified `policy_bridge` for
/// activation decisions. UR/HC/Adrenaline use a "planned_at" delayed
/// scheme — when the policy fires, the ability either executes
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
) {
    // Phase 4g: Unbridled Rage activation
    if ctx.config.attacker_unbridled_rage && !ctx.a.posture_settled_non_standing()
        && !ability_blocked_by_necropoison("Unbridled Rage", &ctx.a.statuses) && !ctx.a.in_cocoon_phase_2(ctx.time)
    {
        if ctx.time < ctx.a.unbridled_rage_cooldown_until || ctx.time < ctx.a.unbridled_rage_active_until {
            ctx.a.unbridled_rage_planned_at = 0.0;
        } else if ctx.a.unbridled_rage_planned_at > ctx.time + 1e-9 {
        } else if ctx.a.unbridled_rage_planned_at > 0.0 && ctx.time + 1e-9 >= ctx.a.unbridled_rage_planned_at {
            ctx.a.unbridled_rage_planned_at = 0.0;
            ctx.a.unbridled_rage_active_until = ctx.time + 30.0;
            ctx.a.unbridled_rage_cooldown_until = ctx.time + scale_active_cooldown(ctx.attacker, 120.0);
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
                ctx.a.unbridled_rage_cooldown_until = ctx.time + scale_active_cooldown(ctx.attacker, 120.0);
                push_timing_event(ability_timing_events_a, format!("[Unbridled Rage] t={:.2} fire", ctx.time));
                record_ability_event(ctx.a, "A", ctx.combat_log, ctx.record_trace, ctx.time, "Unbridled Rage");
            }
        }
    }
    if ctx.config.defender_unbridled_rage && !ctx.b.posture_settled_non_standing()
        && !ability_blocked_by_necropoison("Unbridled Rage", &ctx.b.statuses) && !ctx.b.in_cocoon_phase_2(ctx.time)
    {
        if ctx.time < ctx.b.unbridled_rage_cooldown_until || ctx.time < ctx.b.unbridled_rage_active_until {
            ctx.b.unbridled_rage_planned_at = 0.0;
        } else if ctx.b.unbridled_rage_planned_at > ctx.time + 1e-9 {
        } else if ctx.b.unbridled_rage_planned_at > 0.0 && ctx.time + 1e-9 >= ctx.b.unbridled_rage_planned_at {
            ctx.b.unbridled_rage_planned_at = 0.0;
            ctx.b.unbridled_rage_active_until = ctx.time + 30.0;
            ctx.b.unbridled_rage_cooldown_until = ctx.time + scale_active_cooldown(ctx.defender, 120.0);
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
                ctx.b.unbridled_rage_cooldown_until = ctx.time + scale_active_cooldown(ctx.defender, 120.0);
                push_timing_event(ability_timing_events_b, format!("[Unbridled Rage] t={:.2} fire", ctx.time));
                record_ability_event(ctx.b, "B", ctx.combat_log, ctx.record_trace, ctx.time, "Unbridled Rage");
            }
        }
    }

    // Phase 4h: Hunter's Curse activation
    if ctx.config.attacker_hunters_curse && !ctx.a.posture_settled_non_standing()
        && !ability_blocked_by_necropoison("Hunters Curse", &ctx.a.statuses) && !ctx.a.in_cocoon_phase_2(ctx.time)
    {
        if ctx.time < ctx.a.hunters_curse_cooldown_until || ctx.time < ctx.a.hunters_curse_active_until {
            ctx.a.hunters_curse_planned_at = 0.0;
        } else if ctx.a.hunters_curse_planned_at > ctx.time + 1e-9 {
        } else if ctx.a.hunters_curse_planned_at > 0.0 && ctx.time + 1e-9 >= ctx.a.hunters_curse_planned_at {
            ctx.a.hunters_curse_planned_at = 0.0;
            ctx.a.hp = apply_hunters_curse_self_cost(ctx.a.hp, ctx.attacker);
            ctx.a.hunters_curse_active_until = ctx.time + 30.0;
            ctx.a.hunters_curse_cooldown_until = ctx.time + scale_active_cooldown(ctx.attacker, 120.0);
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
                    ctx.a.hunters_curse_cooldown_until = ctx.time + scale_active_cooldown(ctx.attacker, 120.0);
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
        && !ability_blocked_by_necropoison("Hunters Curse", &ctx.b.statuses) && !ctx.b.in_cocoon_phase_2(ctx.time)
    {
        if ctx.time < ctx.b.hunters_curse_cooldown_until || ctx.time < ctx.b.hunters_curse_active_until {
            ctx.b.hunters_curse_planned_at = 0.0;
        } else if ctx.b.hunters_curse_planned_at > ctx.time + 1e-9 {
        } else if ctx.b.hunters_curse_planned_at > 0.0 && ctx.time + 1e-9 >= ctx.b.hunters_curse_planned_at {
            ctx.b.hunters_curse_planned_at = 0.0;
            ctx.b.hp = apply_hunters_curse_self_cost(ctx.b.hp, ctx.defender);
            ctx.b.hunters_curse_active_until = ctx.time + 30.0;
            ctx.b.hunters_curse_cooldown_until = ctx.time + scale_active_cooldown(ctx.defender, 120.0);
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
                    ctx.b.hunters_curse_cooldown_until = ctx.time + scale_active_cooldown(ctx.defender, 120.0);
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
            ctx.a.life_leech_active_until = ctx.time + 12.0;
            ctx.a.life_leech_cooldown_until = ctx.time + scale_active_cooldown(ctx.attacker, 60.0);
            push_timing_event(ability_timing_events_a, format!("[Life Leech] t={:.2} fire", ctx.time));
            record_ability_event(ctx.a, "A", ctx.combat_log, ctx.record_trace, ctx.time, "Life Leech");
        }
    }
    if ctx.config.defender_life_leech_value > 0.0 && !ctx.b.posture_settled_non_standing()
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
            ctx.b.life_leech_active_until = ctx.time + 12.0;
            ctx.b.life_leech_cooldown_until = ctx.time + scale_active_cooldown(ctx.defender, 60.0);
            push_timing_event(ability_timing_events_b, format!("[Life Leech] t={:.2} fire", ctx.time));
            record_ability_event(ctx.b, "B", ctx.combat_log, ctx.record_trace, ctx.time, "Life Leech");
        }
    }

    // Phase 4j: Warden's Rage toggle
    if ctx.config.attacker_warden_rage && !ctx.a.posture_settled_non_standing() && !ctx.a.in_cocoon_phase_2(ctx.time) {
        let policy_wr = resolve_ability_policy(ability_policy, ctx.config.attacker_ability_policy_overrides.wardens_rage);
        let is_really_fast = policy_wr == SimpleAbilityTimingMode::ReallyFast;
        let next_on = {
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
        };
        if !ctx.a.warden_rage_on && next_on && ctx.time >= ctx.a.warden_rage_cooldown_until {
            ctx.a.warden_rage_on = true;
            ctx.a.warden_rage_stacks = wardens_rage_stacks_from_hp_ratio(ctx.a.hp / ctx.attacker.health.max(1.0));
            ctx.a.warden_rage_tap_until = if is_really_fast { 0.0 } else { ctx.time + WARDEN_RAGE_TAP_SEC };
            ctx.a.warden_rage_cooldown_until = ctx.time + scale_active_cooldown(ctx.attacker, 30.0);
            record_ability_event(ctx.a, "A", ctx.combat_log, ctx.record_trace, ctx.time, "Warden's Rage");
            let hp_ratio = ctx.a.hp / ctx.attacker.health.max(1.0);
            warden_rage_events_a.push(format!(
                "WR_ON t={:.1} hp={:.2} stacks={} cd={:.1}",
                ctx.time, hp_ratio, ctx.a.warden_rage_stacks, ctx.a.warden_rage_cooldown_until
            ));
        } else if ctx.a.warden_rage_on {
            if is_really_fast {
                ctx.a.warden_rage_tap_until = 0.0;
            }
            ctx.a.warden_rage_stacks = wardens_rage_stacks_from_hp_ratio(ctx.a.hp / ctx.attacker.health.max(1.0));
        }
        if ctx.a.warden_rage_on && !next_on {
            let hp_ratio = ctx.a.hp / ctx.attacker.health.max(1.0);
            warden_rage_events_a.push(format!(
                "WR_OFF t={:.1} hp={:.2} stacks={} cd={:.1}",
                ctx.time, hp_ratio, ctx.a.warden_rage_stacks, ctx.a.warden_rage_cooldown_until
            ));
            ctx.a.warden_rage_on = false;
            ctx.a.warden_rage_tap_until = 0.0;
        }
    }
    if ctx.config.defender_warden_rage && !ctx.b.posture_settled_non_standing() && !ctx.b.in_cocoon_phase_2(ctx.time) {
        let policy_wr = resolve_ability_policy(ability_policy, ctx.config.defender_ability_policy_overrides.wardens_rage);
        let is_really_fast = policy_wr == SimpleAbilityTimingMode::ReallyFast;
        let next_on = {
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
        };
        if !ctx.b.warden_rage_on && next_on && ctx.time >= ctx.b.warden_rage_cooldown_until {
            ctx.b.warden_rage_on = true;
            ctx.b.warden_rage_stacks = wardens_rage_stacks_from_hp_ratio(ctx.b.hp / ctx.defender.health.max(1.0));
            ctx.b.warden_rage_tap_until = if is_really_fast { 0.0 } else { ctx.time + WARDEN_RAGE_TAP_SEC };
            ctx.b.warden_rage_cooldown_until = ctx.time + scale_active_cooldown(ctx.defender, 30.0);
            record_ability_event(ctx.b, "B", ctx.combat_log, ctx.record_trace, ctx.time, "Warden's Rage");
            let hp_ratio = ctx.b.hp / ctx.defender.health.max(1.0);
            warden_rage_events_b.push(format!(
                "WR_ON t={:.1} hp={:.2} stacks={} cd={:.1}",
                ctx.time, hp_ratio, ctx.b.warden_rage_stacks, ctx.b.warden_rage_cooldown_until
            ));
        } else if ctx.b.warden_rage_on {
            if is_really_fast {
                ctx.b.warden_rage_tap_until = 0.0;
            }
            ctx.b.warden_rage_stacks = wardens_rage_stacks_from_hp_ratio(ctx.b.hp / ctx.defender.health.max(1.0));
        }
        if ctx.b.warden_rage_on && !next_on {
            let hp_ratio = ctx.b.hp / ctx.defender.health.max(1.0);
            warden_rage_events_b.push(format!(
                "WR_OFF t={:.1} hp={:.2} stacks={} cd={:.1}",
                ctx.time, hp_ratio, ctx.b.warden_rage_stacks, ctx.b.warden_rage_cooldown_until
            ));
            ctx.b.warden_rage_on = false;
            ctx.b.warden_rage_tap_until = 0.0;
        }
    }

    // Phase 4k: Adrenaline activation
    if ctx.config.attacker_adrenaline && !ctx.a.posture_settled_non_standing()
        && !ability_blocked_by_necropoison("Adrenaline", &ctx.a.statuses) && !ctx.a.in_cocoon_phase_2(ctx.time)
    {
        if ctx.time < ctx.a.adrenaline_cooldown_until || ctx.time < ctx.a.adrenaline_active_until {
            ctx.a.adrenaline_planned_at = 0.0;
        } else if ctx.a.adrenaline_planned_at > ctx.time + 1e-9 {
        } else if ctx.a.adrenaline_planned_at > 0.0 && ctx.time + 1e-9 >= ctx.a.adrenaline_planned_at {
            ctx.a.adrenaline_planned_at = 0.0;
            ctx.a.adrenaline_active_until = ctx.time + 30.0;
            ctx.a.adrenaline_cooldown_until = ctx.time + scale_active_cooldown(ctx.attacker, 90.0);
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
                ctx.a.adrenaline_cooldown_until = ctx.time + scale_active_cooldown(ctx.attacker, 90.0);
                push_timing_event(ability_timing_events_a, format!("[Adrenaline] t={:.2} fire", ctx.time));
                record_ability_event(ctx.a, "A", ctx.combat_log, ctx.record_trace, ctx.time, "Adrenaline");
            }
        }
    }
    if ctx.config.defender_adrenaline && !ctx.b.posture_settled_non_standing()
        && !ability_blocked_by_necropoison("Adrenaline", &ctx.b.statuses) && !ctx.b.in_cocoon_phase_2(ctx.time)
    {
        if ctx.time < ctx.b.adrenaline_cooldown_until || ctx.time < ctx.b.adrenaline_active_until {
            ctx.b.adrenaline_planned_at = 0.0;
        } else if ctx.b.adrenaline_planned_at > ctx.time + 1e-9 {
        } else if ctx.b.adrenaline_planned_at > 0.0 && ctx.time + 1e-9 >= ctx.b.adrenaline_planned_at {
            ctx.b.adrenaline_planned_at = 0.0;
            ctx.b.adrenaline_active_until = ctx.time + 30.0;
            ctx.b.adrenaline_cooldown_until = ctx.time + scale_active_cooldown(ctx.defender, 90.0);
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
                ctx.b.adrenaline_cooldown_until = ctx.time + scale_active_cooldown(ctx.defender, 90.0);
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
/// - Phase 4n (Reflux): three-stage state machine — arm (5s charge),
///   impact (5% maxHP + Slow), then 10s puddle of 1.5% maxHP/s +
///   Corrosion. 120s cooldown. Hunger Rule consumes 25% appetite.
/// - Phase 4o (Totem): drains Poison to opponent every 3s over a
///   120s active window, 120s cooldown.
/// - Phase 4p (Reflect): 6s reflect window, 60s cooldown,
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
    if ctx.config.attacker_frost_nova && !ctx.a.posture_settled_non_standing() && !ctx.a.in_cocoon_phase_2(ctx.time) {
        while let Some(next_tick) = ctx.a.frost_nova_next_tick_at {
            if next_tick > ctx.time + 1e-9 || next_tick > ctx.a.frost_nova_active_until + 1e-9 {
                break;
            }
            apply_incoming_statuses_to_target_with_fortify_immunity(
                next_tick,
                ctx.defender,
                ctx.b.hp,
                &mut ctx.b.statuses,
                &[SimpleAppliedStatus {
                    status_id: "Frostbite_Status".to_string(),
                    stacks: 3.0, source_ability: None }],
                ctx.b.fortify_immune_until,
            );
            let next_after = next_tick + FROST_NOVA_TICK_SEC;
            ctx.a.frost_nova_next_tick_at = if next_after <= ctx.a.frost_nova_active_until + 1e-9 {
                Some(next_after)
            } else {
                None
            };
        }
        if !ability_blocked_by_necropoison("Frost Nova", &ctx.a.statuses)
            && ctx.time >= ctx.a.frost_nova_cooldown_until
            && ctx.time >= ctx.a.frost_nova_active_until
        {
            ctx.a.frost_nova_active_until = ctx.time + FROST_NOVA_ACTIVE_DURATION;
            ctx.a.frost_nova_cooldown_until = ctx.time + scale_active_cooldown(ctx.attacker, FROST_NOVA_COOLDOWN);
            ctx.a.frost_nova_next_tick_at = Some(ctx.time + FROST_NOVA_TICK_SEC);
            push_timing_event(ability_timing_events_a, format!("[Frost Nova] t={:.2} fire", ctx.time));
            record_ability_event(ctx.a, "A", ctx.combat_log, ctx.record_trace, ctx.time, "Frost Nova");
        }
    }
    if ctx.config.defender_frost_nova && !ctx.b.posture_settled_non_standing() && !ctx.b.in_cocoon_phase_2(ctx.time) {
        while let Some(next_tick) = ctx.b.frost_nova_next_tick_at {
            if next_tick > ctx.time + 1e-9 || next_tick > ctx.b.frost_nova_active_until + 1e-9 {
                break;
            }
            apply_incoming_statuses_to_target_with_fortify_immunity(
                next_tick,
                ctx.attacker,
                ctx.a.hp,
                &mut ctx.a.statuses,
                &[SimpleAppliedStatus {
                    status_id: "Frostbite_Status".to_string(),
                    stacks: 3.0, source_ability: None }],
                ctx.a.fortify_immune_until,
            );
            let next_after = next_tick + FROST_NOVA_TICK_SEC;
            ctx.b.frost_nova_next_tick_at = if next_after <= ctx.b.frost_nova_active_until + 1e-9 {
                Some(next_after)
            } else {
                None
            };
        }
        if !ability_blocked_by_necropoison("Frost Nova", &ctx.b.statuses)
            && ctx.time >= ctx.b.frost_nova_cooldown_until
            && ctx.time >= ctx.b.frost_nova_active_until
        {
            ctx.b.frost_nova_active_until = ctx.time + FROST_NOVA_ACTIVE_DURATION;
            ctx.b.frost_nova_cooldown_until = ctx.time + scale_active_cooldown(ctx.defender, FROST_NOVA_COOLDOWN);
            ctx.b.frost_nova_next_tick_at = Some(ctx.time + FROST_NOVA_TICK_SEC);
            push_timing_event(ability_timing_events_b, format!("[Frost Nova] t={:.2} fire", ctx.time));
            record_ability_event(ctx.b, "B", ctx.combat_log, ctx.record_trace, ctx.time, "Frost Nova");
        }
    }

    // Phase 4n: Reflux (arm → impact → puddle ticks)
    if ctx.config.attacker_reflux && !ctx.a.posture_settled_non_standing() && !ctx.a.in_cocoon_phase_2(ctx.time) {
        let reflux_hunger_ok_a = if ctx.a.compare_hunger_rule_enabled {
            let cost = compare_hunger::reflux_hunger_cost(ctx.a.compare_appetite_base);
            ctx.a.compare_hunger + 1e-9 >= cost
        } else {
            true
        };
        if !ctx.a.reflux_armed
            && !ability_blocked_by_necropoison("Reflux", &ctx.a.statuses)
            && ctx.a.reflux_charge_ready_at <= 0.0
            && ctx.a.reflux_puddle_until <= ctx.time
            && ctx.time >= ctx.a.reflux_cooldown_until
            && reflux_hunger_ok_a
        {
            if ctx.a.compare_hunger_rule_enabled {
                let cost = compare_hunger::reflux_hunger_cost(ctx.a.compare_appetite_base);
                ctx.a.compare_hunger = (ctx.a.compare_hunger - cost).max(0.0);
            }
            ctx.a.reflux_armed = true;
            ctx.a.reflux_charge_ready_at = ctx.time + 5.0;
            *ctx.a.ability_activation_counts
                .entry("Reflux".to_string())
                .or_insert(0) += 1;
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
                    description: Some("Reflux charge started".to_string()),
                    detail: None,
                    status_id: None,
                });
            }
        } else if ctx.a.reflux_armed && ctx.time >= ctx.a.reflux_charge_ready_at {
            let impact_damage = ctx.defender.health * 0.05;
            let applied_impact =
                apply_unbreakable_damage_cap(impact_damage, ctx.defender).min(ctx.b.hp.max(0.0));
            let applied_impact = user_dispatch::run_pre_damage_hooks(
                ctx.a, ctx.b, ctx.attacker, ctx.defender, ctx.time,
                applied_impact, applied_impact, "reflux",
                ctx.combat_log, ctx.record_trace, "A", "B",
            );
            ctx.b.hp -= applied_impact;
            counters.dealt_a += applied_impact;
            if ctx.record_trace && applied_impact > 0.0 {
                ctx.combat_log.push(crate::contracts::CombatLogEntry {
                    time: ctx.time,
                    entry_type: "ability".to_string(),
                    attacker: "A".to_string(),
                    damage: applied_impact,
                    healing: None,
                    actor_hp_after: ctx.a.hp.max(0.0),
                    hp_side: "B".to_string(),
                    hp_after: ctx.b.hp.max(0.0),
                    description: Some("Reflux impact".to_string()),
                    detail: Some("5% maxHP direct hit + Slow 2".to_string()),
                    status_id: None,
                });
            }
            apply_incoming_statuses_to_target_with_fortify_immunity(
                ctx.time,
                ctx.defender,
                ctx.b.hp,
                &mut ctx.b.statuses,
                &[SimpleAppliedStatus {
                    status_id: "Slow_Status".to_string(),
                    stacks: 2.0, source_ability: None }],
                ctx.b.fortify_immune_until,
            );
            ctx.a.reflux_armed = false;
            ctx.a.reflux_charge_ready_at = 0.0;
            ctx.a.reflux_cooldown_until = ctx.time + scale_active_cooldown(ctx.attacker, 120.0);
            ctx.a.reflux_puddle_until = ctx.time + 10.0;
            ctx.a.reflux_next_tick_at = Some(ctx.time + 1.0);
        } else if ctx.a.reflux_puddle_until > ctx.time
            && ctx.time >= ctx.a.reflux_next_tick_at.unwrap_or(f64::INFINITY)
        {
            let puddle_damage = ctx.defender.health * 0.015;
            let applied_puddle =
                apply_unbreakable_damage_cap(puddle_damage, ctx.defender).min(ctx.b.hp.max(0.0));
            let applied_puddle = user_dispatch::run_pre_damage_hooks(
                ctx.a, ctx.b, ctx.attacker, ctx.defender, ctx.time,
                applied_puddle, applied_puddle, "reflux",
                ctx.combat_log, ctx.record_trace, "A", "B",
            );
            ctx.b.hp -= applied_puddle;
            counters.dealt_a += applied_puddle;
            if ctx.record_trace && applied_puddle > 0.0 {
                ctx.combat_log.push(crate::contracts::CombatLogEntry {
                    time: ctx.time,
                    entry_type: "ability".to_string(),
                    attacker: "A".to_string(),
                    damage: applied_puddle,
                    healing: None,
                    actor_hp_after: ctx.a.hp.max(0.0),
                    hp_side: "B".to_string(),
                    hp_after: ctx.b.hp.max(0.0),
                    description: Some("Reflux puddle tick".to_string()),
                    detail: Some("1.5% maxHP puddle damage + Corrosion 0.5".to_string()),
                    status_id: None,
                });
            }
            apply_incoming_statuses_to_target_with_fortify_immunity(
                ctx.time,
                ctx.defender,
                ctx.b.hp,
                &mut ctx.b.statuses,
                &[SimpleAppliedStatus {
                    status_id: "Corrosion_Status".to_string(),
                    stacks: 0.5, source_ability: None }],
                ctx.b.fortify_immune_until,
            );
            let next_tick_at = ctx.time + 1.0;
            ctx.a.reflux_next_tick_at = if next_tick_at <= ctx.a.reflux_puddle_until {
                Some(next_tick_at)
            } else {
                None
            };
        }
        if ctx.a.reflux_puddle_until <= ctx.time && ctx.a.reflux_next_tick_at.is_some() {
            ctx.a.reflux_next_tick_at = None;
        }
    }
    if ctx.config.defender_reflux && !ctx.b.posture_settled_non_standing() && !ctx.b.in_cocoon_phase_2(ctx.time) {
        let reflux_hunger_ok_b = if ctx.b.compare_hunger_rule_enabled {
            let cost = compare_hunger::reflux_hunger_cost(ctx.b.compare_appetite_base);
            ctx.b.compare_hunger + 1e-9 >= cost
        } else {
            true
        };
        if !ctx.b.reflux_armed
            && !ability_blocked_by_necropoison("Reflux", &ctx.b.statuses)
            && ctx.b.reflux_charge_ready_at <= 0.0
            && ctx.b.reflux_puddle_until <= ctx.time
            && ctx.time >= ctx.b.reflux_cooldown_until
            && reflux_hunger_ok_b
        {
            if ctx.b.compare_hunger_rule_enabled {
                let cost = compare_hunger::reflux_hunger_cost(ctx.b.compare_appetite_base);
                ctx.b.compare_hunger = (ctx.b.compare_hunger - cost).max(0.0);
            }
            ctx.b.reflux_armed = true;
            ctx.b.reflux_charge_ready_at = ctx.time + 5.0;
            *ctx.b.ability_activation_counts
                .entry("Reflux".to_string())
                .or_insert(0) += 1;
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
                    description: Some("Reflux charge started".to_string()),
                    detail: None,
                    status_id: None,
                });
            }
        } else if ctx.b.reflux_armed && ctx.time >= ctx.b.reflux_charge_ready_at {
            let impact_damage = ctx.attacker.health * 0.05;
            let applied_impact =
                apply_unbreakable_damage_cap(impact_damage, ctx.attacker).min(ctx.a.hp.max(0.0));
            let applied_impact = user_dispatch::run_pre_damage_hooks(
                ctx.b, ctx.a, ctx.defender, ctx.attacker, ctx.time,
                applied_impact, applied_impact, "reflux",
                ctx.combat_log, ctx.record_trace, "B", "A",
            );
            ctx.a.hp -= applied_impact;
            counters.dealt_b += applied_impact;
            if ctx.record_trace && applied_impact > 0.0 {
                ctx.combat_log.push(crate::contracts::CombatLogEntry {
                    time: ctx.time,
                    entry_type: "ability".to_string(),
                    attacker: "B".to_string(),
                    damage: applied_impact,
                    healing: None,
                    actor_hp_after: ctx.b.hp.max(0.0),
                    hp_side: "A".to_string(),
                    hp_after: ctx.a.hp.max(0.0),
                    description: Some("Reflux impact".to_string()),
                    detail: Some("5% maxHP direct hit + Slow 2".to_string()),
                    status_id: None,
                });
            }
            apply_incoming_statuses_to_target_with_fortify_immunity(
                ctx.time,
                ctx.attacker,
                ctx.a.hp,
                &mut ctx.a.statuses,
                &[SimpleAppliedStatus {
                    status_id: "Slow_Status".to_string(),
                    stacks: 2.0, source_ability: None }],
                ctx.a.fortify_immune_until,
            );
            ctx.b.reflux_armed = false;
            ctx.b.reflux_charge_ready_at = 0.0;
            ctx.b.reflux_cooldown_until = ctx.time + scale_active_cooldown(ctx.defender, 120.0);
            ctx.b.reflux_puddle_until = ctx.time + 10.0;
            ctx.b.reflux_next_tick_at = Some(ctx.time + 1.0);
        } else if ctx.b.reflux_puddle_until > ctx.time
            && ctx.time >= ctx.b.reflux_next_tick_at.unwrap_or(f64::INFINITY)
        {
            let puddle_damage = ctx.attacker.health * 0.015;
            let applied_puddle =
                apply_unbreakable_damage_cap(puddle_damage, ctx.attacker).min(ctx.a.hp.max(0.0));
            let applied_puddle = user_dispatch::run_pre_damage_hooks(
                ctx.b, ctx.a, ctx.defender, ctx.attacker, ctx.time,
                applied_puddle, applied_puddle, "reflux",
                ctx.combat_log, ctx.record_trace, "B", "A",
            );
            ctx.a.hp -= applied_puddle;
            counters.dealt_b += applied_puddle;
            if ctx.record_trace && applied_puddle > 0.0 {
                ctx.combat_log.push(crate::contracts::CombatLogEntry {
                    time: ctx.time,
                    entry_type: "ability".to_string(),
                    attacker: "B".to_string(),
                    damage: applied_puddle,
                    healing: None,
                    actor_hp_after: ctx.b.hp.max(0.0),
                    hp_side: "A".to_string(),
                    hp_after: ctx.a.hp.max(0.0),
                    description: Some("Reflux puddle tick".to_string()),
                    detail: Some("1.5% maxHP puddle damage + Corrosion 0.5".to_string()),
                    status_id: None,
                });
            }
            apply_incoming_statuses_to_target_with_fortify_immunity(
                ctx.time,
                ctx.attacker,
                ctx.a.hp,
                &mut ctx.a.statuses,
                &[SimpleAppliedStatus {
                    status_id: "Corrosion_Status".to_string(),
                    stacks: 0.5, source_ability: None }],
                ctx.a.fortify_immune_until,
            );
            let next_tick_at = ctx.time + 1.0;
            ctx.b.reflux_next_tick_at = if next_tick_at <= ctx.b.reflux_puddle_until {
                Some(next_tick_at)
            } else {
                None
            };
        }
        if ctx.b.reflux_puddle_until <= ctx.time && ctx.b.reflux_next_tick_at.is_some() {
            ctx.b.reflux_next_tick_at = None;
        }
    }

    // Phase 4o: Totem
    if ctx.config.attacker_totem && !ctx.a.posture_settled_non_standing() && !ctx.a.in_cocoon_phase_2(ctx.time) {
        if !ability_blocked_by_necropoison("Totem", &ctx.a.statuses)
            && ctx.a.totem_active_until <= ctx.time
            && ctx.time >= ctx.a.totem_cooldown_until
        {
            ctx.a.totem_active_until = ctx.time + 120.0;
            ctx.a.totem_next_tick_at = Some(ctx.time + 3.0);
            ctx.a.totem_cooldown_until = ctx.time + scale_active_cooldown(ctx.attacker, 120.0);
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
            apply_incoming_statuses_to_target_with_fortify_immunity(
                ctx.time,
                ctx.defender,
                ctx.b.hp,
                &mut ctx.b.statuses,
                &[SimpleAppliedStatus {
                    status_id: "Poison_Status".to_string(),
                    stacks: 2.0, source_ability: None }],
                ctx.b.fortify_immune_until,
            );
            ctx.a.totem_next_tick_at = Some(ctx.time + 3.0);
        }
    }
    if ctx.config.defender_totem && !ctx.b.posture_settled_non_standing() && !ctx.b.in_cocoon_phase_2(ctx.time) {
        if !ability_blocked_by_necropoison("Totem", &ctx.b.statuses)
            && ctx.b.totem_active_until <= ctx.time
            && ctx.time >= ctx.b.totem_cooldown_until
        {
            ctx.b.totem_active_until = ctx.time + 120.0;
            ctx.b.totem_next_tick_at = Some(ctx.time + 3.0);
            ctx.b.totem_cooldown_until = ctx.time + scale_active_cooldown(ctx.defender, 120.0);
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
            apply_incoming_statuses_to_target_with_fortify_immunity(
                ctx.time,
                ctx.attacker,
                ctx.a.hp,
                &mut ctx.a.statuses,
                &[SimpleAppliedStatus {
                    status_id: "Poison_Status".to_string(),
                    stacks: 2.0, source_ability: None }],
                ctx.a.fortify_immune_until,
            );
            ctx.b.totem_next_tick_at = Some(ctx.time + 3.0);
        }
    }

    // Phase 4p: Reflect (activated)
    if ctx.config.attacker_reflect && !ctx.a.posture_settled_non_standing()
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
            ctx.a.reflect_cooldown_until = ctx.time + scale_active_cooldown(ctx.attacker, 60.0);
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
            ctx.b.reflect_cooldown_until = ctx.time + scale_active_cooldown(ctx.defender, 60.0);
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
/// path can share the effect application — previously the Sandbox path
/// set only the cooldown timer, which pushed `cooldown_until` into the
/// future and made the next engine iter skip the ability (the status
/// and damage never landed). Each helper assumes the caller already
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
    apply_incoming_statuses_to_target_with_fortify_immunity(
        time,
        opp_stats,
        opp.hp,
        &mut opp.statuses,
        &[SimpleAppliedStatus {
            status_id: "Fear_Status".to_string(),
            stacks: 10.0,
            source_ability: None,
        }],
        opp.fortify_immune_until,
    );
    user.cause_fear_cooldown_until = time + scale_active_cooldown(user_stats, 120.0);
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
    // G3: route Grim Lariat through the pre-damage hook.
    let opp_label = if user_label == "A" { "B" } else { "A" };
    let damage = user_dispatch::run_pre_damage_hooks(
        user, opp, user_stats, opp_stats, time,
        damage, damage, "grim_lariat",
        combat_log, record_trace, user_label, opp_label,
    );
    opp.hp -= damage;
    *user_dealt_counter += damage;
    apply_incoming_statuses_to_target_with_fortify_immunity(
        time,
        opp_stats,
        opp.hp,
        &mut opp.statuses,
        &[SimpleAppliedStatus {
            status_id: "Heartbroken_Status".to_string(),
            stacks: 8.0,
            source_ability: None,
        }],
        opp.fortify_immune_until,
    );
    user.grim_lariat_cooldown_until = time + scale_active_cooldown(user_stats, 60.0);
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
    apply_incoming_statuses_to_target_with_fortify_immunity(
        time,
        opp_stats,
        opp.hp,
        &mut opp.statuses,
        &[SimpleAppliedStatus {
            status_id: "Bad_Omen".to_string(),
            stacks,
            source_ability: None,
        }],
        opp.fortify_immune_until,
    );
    user.cursed_sigil_cooldown_until = time + scale_active_cooldown(user_stats, 85.0);
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
    apply_incoming_statuses_to_target_with_fortify_immunity(
        time,
        opp_stats,
        opp.hp,
        &mut opp.statuses,
        &[SimpleAppliedStatus {
            status_id: "Drowsy_Status".to_string(),
            stacks: 5.0,
            source_ability: None,
        }],
        opp.fortify_immune_until,
    );
    user.drowsy_area_cooldown_until = time + scale_active_cooldown(user_stats, 60.0);
    record_ability_event(user, user_label, combat_log, record_trace, time, "Drowsy Area");
}

/// Phase 4q + 4r + 4s + 4t + 4u: misc actives + Cocoon family.
///
/// - Phase 4q (Cause Fear): 10 stacks Fear on opponent, 120s cooldown.
/// - Phase 4r (Grim Lariat): 0.5x damage hit + 8 stacks Heartbroken,
///   60s cooldown.
/// - Phase 4s (Shadow Barrage): on activation deals N stacked
///   barrage hits *all at once* (damage = base × Σ(max(1 − 0.1×i, 0)
///   for i in 0..N)), applies on-hit ailments N times, then arms a
///   30 s cooldown. Needs a recent (≤10 s) melee hit to seed
///   `last_melee_hit_damage`. Prior to 2026-05-18 the engine
///   scheduled N hits at 1 Hz; user-arbiter call replaced that with
///   the burst-on-activation model.
/// - Phase 4t (Cocoon activation): 3-phase ability — Ph1 lockdown,
///   Ph2 invincibility+heal, Ph3 +15% damage buff.
/// - Phase 4u (Cocoon Ph2→Ph3 transition): applies +30% max-HP lump
///   heal at Ph2 end, zeroes the phase gates.
#[allow(clippy::too_many_arguments)]
pub(in super::super) fn process_phase_4_misc_and_cocoon_cluster(
    ctx: &mut PhaseContext<'_, '_>,
    ability_policy: SimpleAbilityTimingMode,
    counters: &mut DamageCounters,
) {
    // Phase 4q: Cause Fear
    if ctx.config.attacker_cause_fear && !ctx.a.posture_settled_non_standing()
        && !ability_blocked_by_necropoison("Cause Fear", &ctx.a.statuses) && !ctx.a.in_cocoon_phase_2(ctx.time)
        && ctx.time >= ctx.a.cause_fear_cooldown_until
    {
        apply_cause_fear_effect(
            ctx.time, ctx.attacker, ctx.defender,
            ctx.a, ctx.b, "A", ctx.combat_log, ctx.record_trace,
        );
    }
    if ctx.config.defender_cause_fear && !ctx.b.posture_settled_non_standing()
        && !ability_blocked_by_necropoison("Cause Fear", &ctx.b.statuses) && !ctx.b.in_cocoon_phase_2(ctx.time)
        && ctx.time >= ctx.b.cause_fear_cooldown_until
    {
        apply_cause_fear_effect(
            ctx.time, ctx.defender, ctx.attacker,
            ctx.b, ctx.a, "B", ctx.combat_log, ctx.record_trace,
        );
    }

    // Phase 4r: Grim Lariat
    if ctx.config.attacker_grim_lariat && !ctx.a.posture_settled_non_standing()
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
        && !ability_blocked_by_necropoison("Grim Lariat", &ctx.b.statuses) && !ctx.b.in_cocoon_phase_2(ctx.time)
        && ctx.time >= ctx.b.grim_lariat_cooldown_until
    {
        apply_grim_lariat_effect(
            ctx.time, ctx.defender, ctx.attacker,
            ctx.b, ctx.a, "B", ctx.combat_log, ctx.record_trace,
            &mut counters.dealt_b,
        );
    }

    // Phase 4s: Shadow Barrage activation — burst-on-activation
    // (2026-05-18). All N "barrage hits" of the dropoff sequence
    // (1.0, 0.9, 0.8, …) land simultaneously at the moment of
    // activation rather than being scheduled at 1 Hz. On-hit
    // ailments still apply once per hit (engine-side: stacks ×
    // count, single trace entry).
    if ctx.config.attacker_shadow_barrage_value > 0.0 && !ctx.a.posture_settled_non_standing()
        && !ctx.a.in_cocoon_phase_2(ctx.time)
        && !ability_blocked_by_necropoison("Shadow Barrage", &ctx.a.statuses)
        && ctx.time >= ctx.a.shadow_barrage_cooldown_until
        && ctx.time - ctx.a.last_melee_hit_at <= 10.0
        && ctx.a.last_melee_hit_damage > 0.0
    {
        let count = ctx.config.attacker_shadow_barrage_value.floor().max(0.0) as i32;
        if count > 0 {
            ctx.a.shadow_barrage_cooldown_until =
                ctx.time + scale_active_cooldown(ctx.attacker, 30.0);
            record_ability_event(
                ctx.a,
                "A",
                ctx.combat_log,
                ctx.record_trace,
                ctx.time,
                "Shadow Barrage",
            );

            let base = ctx.a.last_melee_hit_damage;
            let total_factor: f64 = (0..count)
                .map(|i| (1.0 - 0.1 * i as f64).max(0.0))
                .sum();
            let total_damage = (base * total_factor).max(0.0);
            let applied = apply_unbreakable_damage_cap(total_damage, ctx.defender)
                .min(ctx.b.hp.max(0.0));
            // G3: route the Shadow Barrage clone through the pre-damage hook.
            let applied = user_dispatch::run_pre_damage_hooks(
                ctx.a, ctx.b, ctx.attacker, ctx.defender, ctx.time,
                applied, applied, "shadow_barrage",
                ctx.combat_log, ctx.record_trace, "A", "B",
            );
            ctx.b.hp -= applied;
            counters.dealt_a += applied;
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
                    detail: Some(format!("burst of {count} hits at activation")),
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
            // On-hit applies once per barrage hit ⇒ multiply stacks
            // by count. For stacking statuses this is equivalent to
            // N sequential applies; for non-stacking ones the engine
            // clamps to its max-stack cap automatically.
            let shadow_barrage_on_hit: Vec<SimpleAppliedStatus> = scaled_on_hit
                .iter()
                .map(|status| SimpleAppliedStatus {
                    status_id: status.status_id.clone(),
                    stacks: status.stacks * count as f64,
                    source_ability: Some("Shadow Barrage".to_string()),
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
            // Legacy scheduling fields no longer drive the engine.
            // Reset them so the global scheduler at
            // process_phase_0_collect_step_targets doesn't see a
            // stale `next_hit_at` and treat the barrage as still
            // in flight.
            ctx.a.shadow_barrage_remaining_hits = 0;
            ctx.a.shadow_barrage_total_hits = 0;
            ctx.a.shadow_barrage_base_damage = 0.0;
            ctx.a.shadow_barrage_next_hit_at = None;
        }
    }
    // Phase 4s mirror — same burst-on-activation model for B side.
    if ctx.config.defender_shadow_barrage_value > 0.0 && !ctx.b.posture_settled_non_standing()
        && !ctx.b.in_cocoon_phase_2(ctx.time)
        && !ability_blocked_by_necropoison("Shadow Barrage", &ctx.b.statuses)
        && ctx.time >= ctx.b.shadow_barrage_cooldown_until
        && ctx.time - ctx.b.last_melee_hit_at <= 10.0
        && ctx.b.last_melee_hit_damage > 0.0
    {
        let count = ctx.config.defender_shadow_barrage_value.floor().max(0.0) as i32;
        if count > 0 {
            ctx.b.shadow_barrage_cooldown_until =
                ctx.time + scale_active_cooldown(ctx.defender, 30.0);
            record_ability_event(
                ctx.b,
                "B",
                ctx.combat_log,
                ctx.record_trace,
                ctx.time,
                "Shadow Barrage",
            );

            let base = ctx.b.last_melee_hit_damage;
            let total_factor: f64 = (0..count)
                .map(|i| (1.0 - 0.1 * i as f64).max(0.0))
                .sum();
            let total_damage = (base * total_factor).max(0.0);
            let applied = apply_unbreakable_damage_cap(total_damage, ctx.attacker)
                .min(ctx.a.hp.max(0.0));
            // G3: route the Shadow Barrage clone through the pre-damage hook.
            let applied = user_dispatch::run_pre_damage_hooks(
                ctx.b, ctx.a, ctx.defender, ctx.attacker, ctx.time,
                applied, applied, "shadow_barrage",
                ctx.combat_log, ctx.record_trace, "B", "A",
            );
            ctx.a.hp -= applied;
            counters.dealt_b += applied;
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
                    detail: Some(format!("burst of {count} hits at activation")),
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
        && !ability_blocked_by_necropoison("Cocoon", &ctx.a.statuses)
        // Cocoon's own activation gate stays on phase2_until — re-activating
        // during P1 makes no sense (already cocooning), and phase2_until is
        // reset to 0 once P2→P3 transitions so post-cocoon activation works.
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
            ctx.a.cocoon_cooldown_until = ctx.time + scale_active_cooldown(ctx.attacker, 120.0);
            ctx.a.cocoon_phase1_until = ctx.time + 5.0;
            ctx.a.cocoon_phase2_until = ctx.time + 10.0;
            // Post-2026-05-12: do not push next_hit to phase2_until at
            // activation — the user keeps biting during Phase 1. The
            // own-side Ph2 reschedule in process_phase_10_11_melee will
            // push the bite forward only once we cross into Ph2.
            apply_status_delta(ctx.time, &mut ctx.a.statuses, "Cocoon_Damage_Status", 6.66);
            if let Some(inst) = ctx.a.statuses.get_mut("Cocoon_Damage_Status") {
                inst.next_decay_at = Some(ctx.time + 13.0);
                inst.remaining_sec = 19.98;
            }
            record_ability_event(ctx.a, "A", ctx.combat_log, ctx.record_trace, ctx.time, "Cocoon");
        }
    }
    if ctx.config.defender_cocoon
        && !ability_blocked_by_necropoison("Cocoon", &ctx.b.statuses)
        // See note on attacker_cocoon — re-activation needs phase2_until.
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
            ctx.b.cocoon_cooldown_until = ctx.time + scale_active_cooldown(ctx.defender, 120.0);
            ctx.b.cocoon_phase1_until = ctx.time + 5.0;
            ctx.b.cocoon_phase2_until = ctx.time + 10.0;
            // Post-2026-05-12: see note in the A-side activation above.
            apply_status_delta(ctx.time, &mut ctx.b.statuses, "Cocoon_Damage_Status", 6.66);
            if let Some(inst) = ctx.b.statuses.get_mut("Cocoon_Damage_Status") {
                inst.next_decay_at = Some(ctx.time + 13.0);
                inst.remaining_sec = 19.98;
            }
            record_ability_event(ctx.b, "B", ctx.combat_log, ctx.record_trace, ctx.time, "Cocoon");
        }
    }

    // Phase 4u: Cocoon Ph2→Ph3 transition (+30% maxHP lump heal).
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
        ctx.a.iter_healing_taken += healed; // G4: on_heal accumulator
        ctx.a.cocoon_phase1_until = 0.0;
        ctx.a.cocoon_phase2_until = 0.0;
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
    // See note on the attacker-side Ph2→Ph3 transition above.
    if ctx.b.cocoon_phase1_until > 0.0
        && ctx.b.cocoon_phase2_until > 0.0
        && ctx.time >= ctx.b.cocoon_phase2_until
    {
        let hp_before = ctx.b.hp;
        ctx.b.hp = (ctx.b.hp + ctx.defender.health * 0.30).min(ctx.defender.health);
        let healed = ctx.b.hp - hp_before;
        ctx.b.iter_healing_taken += healed; // G4: on_heal accumulator
        ctx.b.cocoon_phase1_until = 0.0;
        ctx.b.cocoon_phase2_until = 0.0;
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
/// their cooldowns expire — no policy decision involved.
pub(in super::super) fn process_phase_4_lich_and_spite_cluster(ctx: &mut PhaseContext<'_, '_>) {
    // Phase 4la: Lich Mark activation
    if ctx.config.attacker_lich_mark
        && !ability_blocked_by_necropoison("Lich Mark", &ctx.a.statuses) && !ctx.a.in_cocoon_phase_2(ctx.time)
        && ctx.time >= ctx.a.lich_mark_cooldown_until
        && ctx.time >= ctx.a.lich_mark_armed_until
    {
        ctx.a.lich_mark_armed_until = ctx.time + LICH_MARK_ARMED_WINDOW_SEC;
        ctx.a.lich_mark_cooldown_until = ctx.time + scale_active_cooldown(ctx.attacker, LICH_MARK_COOLDOWN_SEC);
        record_ability_event(ctx.a, "A", ctx.combat_log, ctx.record_trace, ctx.time, "Lich Mark");
    }
    if ctx.config.defender_lich_mark
        && !ability_blocked_by_necropoison("Lich Mark", &ctx.b.statuses) && !ctx.b.in_cocoon_phase_2(ctx.time)
        && ctx.time >= ctx.b.lich_mark_cooldown_until
        && ctx.time >= ctx.b.lich_mark_armed_until
    {
        ctx.b.lich_mark_armed_until = ctx.time + LICH_MARK_ARMED_WINDOW_SEC;
        ctx.b.lich_mark_cooldown_until = ctx.time + scale_active_cooldown(ctx.defender, LICH_MARK_COOLDOWN_SEC);
        record_ability_event(ctx.b, "B", ctx.combat_log, ctx.record_trace, ctx.time, "Lich Mark");
    }

    // Phase 4l: Spite activation
    if ctx.config.attacker_spite_value != 0.0
        && !ability_blocked_by_necropoison("Spite", &ctx.a.statuses) && !ctx.a.in_cocoon_phase_2(ctx.time)
        && !ctx.a.spite_armed
        && ctx.time >= ctx.a.spite_cooldown_until
    {
        // Negative spite (heal target) only activates if attacker has on-hit payload
        let has_offensive_payload = !ctx.attacker.on_hit_statuses.is_empty();
        if ctx.config.attacker_spite_value > 0.0 || has_offensive_payload {
            ctx.a.spite_armed = true;
            ctx.a.spite_charge_ready_at = ctx.time + 5.0;
            ctx.a.spite_cooldown_until = ctx.time + scale_active_cooldown(ctx.attacker, 20.0);
            record_ability_event(ctx.a, "A", ctx.combat_log, ctx.record_trace, ctx.time, "Spite");
        }
    }
    if ctx.config.defender_spite_value != 0.0
        && !ability_blocked_by_necropoison("Spite", &ctx.b.statuses) && !ctx.b.in_cocoon_phase_2(ctx.time)
        && !ctx.b.spite_armed
        && ctx.time >= ctx.b.spite_cooldown_until
    {
        let has_offensive_payload = !ctx.defender.on_hit_statuses.is_empty();
        if ctx.config.defender_spite_value > 0.0 || has_offensive_payload {
            ctx.b.spite_armed = true;
            ctx.b.spite_charge_ready_at = ctx.time + 5.0;
            ctx.b.spite_cooldown_until = ctx.time + scale_active_cooldown(ctx.defender, 20.0);
            record_ability_event(ctx.b, "B", ctx.combat_log, ctx.record_trace, ctx.time, "Spite");
        }
    }
}

/// Phase 4e + 4f: Cursed Sigil + Drowsy Area. Both apply a status
/// (Bad_Omen for Cursed Sigil, Drowsy_Status for Drowsy Area) to the
/// opponent on cooldown. Distinct from delayed-policy actives
/// (Phase 4g+) because they fire unconditionally when the cooldown
/// expires — no decision engine involved.
pub(in super::super) fn process_phase_4_status_applies_cluster(ctx: &mut PhaseContext<'_, '_>) {
    // Phase 4e: Cursed Sigil
    if ctx.config.attacker_cursed_sigil_stacks > 0.0
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
        && !ability_blocked_by_necropoison("Drowsy Area", &ctx.a.statuses) && !ctx.a.in_cocoon_phase_2(ctx.time)
        && ctx.time >= ctx.a.drowsy_area_cooldown_until
    {
        apply_drowsy_area_effect(
            ctx.time, ctx.attacker, ctx.defender,
            ctx.a, ctx.b, "A", ctx.combat_log, ctx.record_trace,
        );
    }
    if ctx.config.defender_drowsy_area
        && !ability_blocked_by_necropoison("Drowsy Area", &ctx.b.statuses) && !ctx.b.in_cocoon_phase_2(ctx.time)
        && ctx.time >= ctx.b.drowsy_area_cooldown_until
    {
        apply_drowsy_area_effect(
            ctx.time, ctx.defender, ctx.attacker,
            ctx.b, ctx.a, "B", ctx.combat_log, ctx.record_trace,
        );
    }
}

/// Phase 4d-bis + 4d-ter: Healing Step + Healing Pulse — the
/// ActiveAbilities-gated half of the healing family. Healing Step
/// heals value% of max HP every 3s while HP ≤ 65% max. Healing Pulse
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
                    ctx.a.iter_healing_taken += healed; // G4: on_heal accumulator
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
                    ctx.b.iter_healing_taken += healed; // G4: on_heal accumulator
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
            && ctx.a.next_healing_pulse <= ctx.time + 1e-9
            && !ability_blocked_by_necropoison("Healing Pulse", &ctx.a.statuses)
            && !ctx.a.in_cocoon_phase_2(ctx.time)
            && ctx.time >= ctx.a.healing_pulse_cooldown_until
            && ctx.a.death_time.is_none()
        {
            let stacks = [SimpleAppliedStatus {
                status_id: "Healing_Ailment".to_string(),
                stacks: HEALING_PULSE_STACKS_PER_CAST,
                source_ability: None,
            }];
            apply_simple_status_list(ctx.time, &mut ctx.a.statuses, &stacks);
            if ctx.a.healing_ailment_next_tick_at.is_none() {
                ctx.a.healing_ailment_next_tick_at = Some(ctx.time + HEALING_AILMENT_TICK_SEC);
            }
            if !ctx.config.attacker_healing_pulse_once {
                apply_simple_status_list(ctx.time, &mut ctx.b.statuses, &stacks);
                if ctx.b.healing_ailment_next_tick_at.is_none() {
                    ctx.b.healing_ailment_next_tick_at = Some(ctx.time + HEALING_AILMENT_TICK_SEC);
                }
                let a_cd = scale_active_cooldown(ctx.attacker, HEALING_PULSE_COOLDOWN_SEC);
                ctx.a.healing_pulse_cooldown_until = ctx.time + a_cd;
                ctx.a.next_healing_pulse = ctx.time + a_cd;
            } else {
                ctx.a.next_healing_pulse = f64::INFINITY;
            }
            record_ability_event(ctx.a, "A", ctx.combat_log, ctx.record_trace, ctx.time, "Healing Pulse");
        }
        if ctx.config.defender_healing_pulse
            && ctx.b.next_healing_pulse <= ctx.time + 1e-9
            && !ability_blocked_by_necropoison("Healing Pulse", &ctx.b.statuses)
            && !ctx.b.in_cocoon_phase_2(ctx.time)
            && ctx.time >= ctx.b.healing_pulse_cooldown_until
            && ctx.b.death_time.is_none()
        {
            let stacks = [SimpleAppliedStatus {
                status_id: "Healing_Ailment".to_string(),
                stacks: HEALING_PULSE_STACKS_PER_CAST,
                source_ability: None,
            }];
            apply_simple_status_list(ctx.time, &mut ctx.b.statuses, &stacks);
            if ctx.b.healing_ailment_next_tick_at.is_none() {
                ctx.b.healing_ailment_next_tick_at = Some(ctx.time + HEALING_AILMENT_TICK_SEC);
            }
            if !ctx.config.defender_healing_pulse_once {
                apply_simple_status_list(ctx.time, &mut ctx.a.statuses, &stacks);
                if ctx.a.healing_ailment_next_tick_at.is_none() {
                    ctx.a.healing_ailment_next_tick_at = Some(ctx.time + HEALING_AILMENT_TICK_SEC);
                }
                let b_cd = scale_active_cooldown(ctx.defender, HEALING_PULSE_COOLDOWN_SEC);
                ctx.b.healing_pulse_cooldown_until = ctx.time + b_cd;
                ctx.b.next_healing_pulse = ctx.time + b_cd;
            } else {
                ctx.b.next_healing_pulse = f64::INFINITY;
            }
            record_ability_event(ctx.b, "B", ctx.combat_log, ctx.record_trace, ctx.time, "Healing Pulse");
        }
    }
}

/// Phase 4d-quat: Healing Ailment ticks — the StatusTicks-gated tail
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
                    let hp_before = ctx.a.hp;
                    ctx.a.hp = (ctx.a.hp + ctx.attacker.health * (HEALING_AILMENT_HEAL_PCT_PER_TICK / 100.0))
                        .min(ctx.attacker.health);
                    let healed = ctx.a.hp - hp_before;
                    ctx.a.iter_healing_taken += healed; // G4: on_heal accumulator
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
                    let hp_before = ctx.b.hp;
                    ctx.b.hp = (ctx.b.hp + ctx.defender.health * (HEALING_AILMENT_HEAL_PCT_PER_TICK / 100.0))
                        .min(ctx.defender.health);
                    let healed = ctx.b.hp - hp_before;
                    ctx.b.iter_healing_taken += healed; // G4: on_heal accumulator
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
) {
    // Phase 4b: Thorn Trap ticks
    if has_any_thorn_trap {
        let thorn_statuses = [
            SimpleAppliedStatus {
                status_id: "Bleed_Status".to_string(),
                stacks: 6.0, source_ability: None },
            SimpleAppliedStatus {
                status_id: "Freeze_Status".to_string(),
                stacks: 2.0, source_ability: None },
        ];
        if ctx.config.attacker_thorn_trap
            && ctx.a.next_thorn_trap <= ctx.time + 1e-9
            && !ability_blocked_by_necropoison("Thorn Trap", &ctx.a.statuses) && !ctx.a.in_cocoon_phase_2(ctx.time)
            && ctx.time >= ctx.a.thorn_trap_cooldown_until
        {
            apply_incoming_statuses_to_target_with_fortify_immunity(
                ctx.time,
                ctx.defender,
                ctx.b.hp,
                &mut ctx.b.statuses,
                &thorn_statuses,
                ctx.b.fortify_immune_until,
            );
            ctx.a.thorn_trap_cooldown_until = ctx.time + scale_active_cooldown(ctx.attacker, 35.0);
            ctx.a.next_thorn_trap = ctx.a.thorn_trap_cooldown_until;
            record_ability_event(ctx.a, "A", ctx.combat_log, ctx.record_trace, ctx.time, "Thorn Trap");
        }
        if ctx.config.defender_thorn_trap
            && ctx.b.next_thorn_trap <= ctx.time + 1e-9
            && !ability_blocked_by_necropoison("Thorn Trap", &ctx.b.statuses) && !ctx.b.in_cocoon_phase_2(ctx.time)
            && ctx.time >= ctx.b.thorn_trap_cooldown_until
        {
            apply_incoming_statuses_to_target_with_fortify_immunity(
                ctx.time,
                ctx.attacker,
                ctx.a.hp,
                &mut ctx.a.statuses,
                &thorn_statuses,
                ctx.a.fortify_immune_until,
            );
            ctx.b.thorn_trap_cooldown_until = ctx.time + scale_active_cooldown(ctx.defender, 35.0);
            ctx.b.next_thorn_trap = ctx.b.thorn_trap_cooldown_until;
            record_ability_event(ctx.b, "B", ctx.combat_log, ctx.record_trace, ctx.time, "Thorn Trap");
        }
    }

    // Phase 4b-bis: Toxic Trap activation and ticks
    if has_any_toxic_trap {
        let toxic_poison = [SimpleAppliedStatus {
            status_id: "Poison_Status".to_string(),
            stacks: 5.0, source_ability: None }];
        if ctx.config.attacker_toxic_trap
            && ctx.a.next_toxic_trap <= ctx.time + 1e-9
            && !ability_blocked_by_necropoison("Toxic Trap", &ctx.a.statuses) && !ctx.a.in_cocoon_phase_2(ctx.time)
            && ctx.time >= ctx.a.toxic_trap_cooldown_until
            && ctx.a.toxic_trap_bites_remaining == 0
        {
            ctx.a.toxic_trap_bites_remaining = 25;
            ctx.a.toxic_trap_next_tick_at = Some(ctx.time + 3.0);
            ctx.a.toxic_trap_cooldown_until = ctx.time + scale_active_cooldown(ctx.attacker, 75.0);
            ctx.a.next_toxic_trap = ctx.a.toxic_trap_cooldown_until;
            record_ability_event(ctx.a, "A", ctx.combat_log, ctx.record_trace, ctx.time, "Toxic Trap");
        }
        if ctx.config.defender_toxic_trap
            && ctx.b.next_toxic_trap <= ctx.time + 1e-9
            && !ability_blocked_by_necropoison("Toxic Trap", &ctx.b.statuses) && !ctx.b.in_cocoon_phase_2(ctx.time)
            && ctx.time >= ctx.b.toxic_trap_cooldown_until
            && ctx.b.toxic_trap_bites_remaining == 0
        {
            ctx.b.toxic_trap_bites_remaining = 25;
            ctx.b.toxic_trap_next_tick_at = Some(ctx.time + 3.0);
            ctx.b.toxic_trap_cooldown_until = ctx.time + scale_active_cooldown(ctx.defender, 75.0);
            ctx.b.next_toxic_trap = ctx.b.toxic_trap_cooldown_until;
            record_ability_event(ctx.b, "B", ctx.combat_log, ctx.record_trace, ctx.time, "Toxic Trap");
        }
        if let Some(next_tick) = ctx.a.toxic_trap_next_tick_at {
            if (next_tick - ctx.time).abs() <= 1e-9 && ctx.a.toxic_trap_bites_remaining > 0 {
                apply_incoming_statuses_to_target_with_fortify_immunity(
                    ctx.time, ctx.defender, ctx.b.hp, &mut ctx.b.statuses, &toxic_poison,
                    ctx.b.fortify_immune_until,
                );
                ctx.a.toxic_trap_next_tick_at = Some(ctx.time + 3.0);
            }
        }
        if let Some(next_tick) = ctx.b.toxic_trap_next_tick_at {
            if (next_tick - ctx.time).abs() <= 1e-9 && ctx.b.toxic_trap_bites_remaining > 0 {
                apply_incoming_statuses_to_target_with_fortify_immunity(
                    ctx.time, ctx.attacker, ctx.a.hp, &mut ctx.a.statuses, &toxic_poison,
                    ctx.a.fortify_immune_until,
                );
                ctx.b.toxic_trap_next_tick_at = Some(ctx.time + 3.0);
            }
        }
    }
}

/// Phase 4: Hunker decisions — routed through the unified policy
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
        if always_on_mode || cadence_due {
            let previous_hunker = ctx.a.hunker_on;
            // P4: forward current ON/OFF state via extras so the
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
            ctx.a.hunker_on = policy_bridge::toggle_state_now(
                crate::policy::decisions::hunker::HUNKER_DECISION_ID,
                self_side, opp_side, ctx.time, mode,
            );
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
        if always_on_mode || cadence_due {
            let previous_hunker = ctx.b.hunker_on;
            // P4: see A-side mirror — forward current ON/OFF for hysteresis.
            let self_side = policy_bridge::build_policy_side(
                &*ctx.b,
                ctx.defender,
                ctx.defender_breath,
                [policy_bridge::hunker_currently_on_extra(previous_hunker)],
            );
            let opp_side = policy_bridge::build_policy_side(&*ctx.a, ctx.attacker, ctx.attacker_breath, std::iter::empty());
            let mode = policy_bridge::map_timing_mode(policy_hunker_b);
            ctx.b.hunker_on = policy_bridge::toggle_state_now(
                crate::policy::decisions::hunker::HUNKER_DECISION_ID,
                self_side, opp_side, ctx.time, mode,
            );
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
