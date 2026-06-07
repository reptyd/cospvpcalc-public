//! Status-related phase functions: DOT ticks (Phase 12), regen
//! (Phases 5+6), and the status-decay gate (Phases 2.5/3/3c).
//! Extracted from `phases/mod.rs`.

#![allow(clippy::too_many_arguments)]

use super::super::*;

/// Phase 12: Status DOT ticks. Both sides' active DOT-shaped statuses
/// (Bleed, Burn, Poison, Disease, Frostbite, Necropoison, Corrosion ...)
/// fire their per-tick damage and any side-effects (e.g. Necropoison ailment
/// reapply). Damage routes through `handle_simple_dot_ticks_with_log_and_cap_and_decay_flags`
/// which applies unbreakable cap + records per-status log entries.
pub(in super::super) fn process_phase_12_status_dot_ticks(
    ctx: &mut PhaseContext<'_, '_>,
    eff_a: &SimpleCombatantStats,
    eff_b: &SimpleCombatantStats,
    counters: &mut DamageCounters,
) {
    use crate::composable::side::DAMAGE_KIND_DOT;
    if !ctx.a.statuses.is_empty() {
        // Snapshot effective decay flag BEFORE taking mut borrows on
        // a.hp / a.statuses below. The override flag itself was refreshed
        // in Phase 2.5 from this tick's pre-DOT HP, so reading it here is
        // already up to date for the current tick.
        let a_block_decay =
            effective_block_persistent_decay(&*ctx.a, ctx.config.attacker_compare_block_persistent_decay);
        let mut tick_log: Vec<(String, f64, f64)> = Vec::new();
        let hp_before_dot_a = ctx.a.hp;
        let posture_decay_mult_a = ctx.a.posture_decay_mult();
        let a_laying = ctx.a.posture_is_settled_laying();
        let side_effects = crate::statuses::handle_simple_dot_ticks_full(
            ctx.time,
            eff_a.health,
            eff_a.unbreakable_damage_cap_pct,
            &mut ctx.a.hp,
            &mut ctx.a.statuses,
            &mut counters.dealt_b,
            a_block_decay,
            if ctx.record_trace { Some(&mut tick_log) } else { None },
            posture_decay_mult_a,
            a_laying,
        );
        // Route this iteration's DOT total through the pre-damage hook
        // (victim = A; dealer = B by the engine's DOT attribution
        // convention). Aggregate per iter - consistent with how on_take_damage
        // already coalesces DOT - applied post-hoc: the override replaces the
        // iter's DOT total. No-user-ability fast path inside leaves hp
        // untouched (byte-identical). The per-status trace below still shows
        // the pre-override ticks (cosmetic only).
        if (!ctx.attacker.user_ability_ids.is_empty()
            || !ctx.defender.user_ability_ids.is_empty())
            && ctx.a.hp < hp_before_dot_a
        {
            let applied = hp_before_dot_a - ctx.a.hp;
            let final_dot = user_dispatch::run_pre_damage_hooks(
                ctx.b, ctx.a, eff_b, eff_a, ctx.time,
                applied, applied, "dot",
                ctx.combat_log, ctx.record_trace, "B", "A",
            );
            if (final_dot - applied).abs() > 1e-9 {
                ctx.a.hp = (hp_before_dot_a - final_dot).max(0.0);
            }
        }
        // Tag iter mask if any DOT actually damaged A.
        // A "took" DOT damage → bit on A. B "dealt" it (attribution
        // convention since B's prior applies put the status on A).
        if ctx.a.hp < hp_before_dot_a {
            ctx.a.iter_damage_kinds_taken |= DAMAGE_KIND_DOT;
            ctx.b.iter_damage_kinds_dealt |= DAMAGE_KIND_DOT;
        }
        // 2026-05-12: DOT damage now flows into combat counters,
        // sliding-window logs, and raw-damage iter totals.
        // Attribution: B is the "dealer" by the same convention used
        // above for the DAMAGE_KIND_DOT bit (B applied the status to A).
        let dot_damage_to_a = (hp_before_dot_a - ctx.a.hp).max(0.0);
        if dot_damage_to_a > 0.0 {
            super::record_damage_event(ctx.b, ctx.a, ctx.time, dot_damage_to_a, dot_damage_to_a);
        }
        if ctx.record_trace {
            for (status_id, damage, hp_after) in tick_log {
                ctx.combat_log.push(crate::contracts::CombatLogEntry {
                    time: ctx.time,
                    entry_type: "dot".to_string(),
                    attacker: "B".to_string(),
                    damage,
                    healing: None,
                    actor_hp_after: ctx.b.hp.max(0.0),
                    hp_side: "A".to_string(),
                    hp_after,
                    description: Some(format!("{} tick", status_id)),
                    detail: None,
                    status_id: Some(status_id),
                });
            }
        }
        if !side_effects.is_empty() {
            apply_incoming_statuses_to_target_with_fortify_immunity(
                ctx.time,
                ctx.attacker,
                ctx.a.hp,
                &mut ctx.a.statuses,
                &side_effects,
                ctx.a.fortify_immune_until,
            );
        }
    }
    if !ctx.b.statuses.is_empty() {
        let b_block_decay =
            effective_block_persistent_decay(&*ctx.b, ctx.config.defender_compare_block_persistent_decay);
        let mut tick_log: Vec<(String, f64, f64)> = Vec::new();
        let hp_before_dot_b = ctx.b.hp;
        let posture_decay_mult_b = ctx.b.posture_decay_mult();
        let b_laying = ctx.b.posture_is_settled_laying();
        let side_effects = crate::statuses::handle_simple_dot_ticks_full(
            ctx.time,
            eff_b.health,
            eff_b.unbreakable_damage_cap_pct,
            &mut ctx.b.hp,
            &mut ctx.b.statuses,
            &mut counters.dealt_a,
            b_block_decay,
            if ctx.record_trace { Some(&mut tick_log) } else { None },
            posture_decay_mult_b,
            b_laying,
        );
        // Route B's iteration DOT total through the pre-damage hook
        // (victim = B; dealer = A). Symmetric to the A block above.
        if (!ctx.attacker.user_ability_ids.is_empty()
            || !ctx.defender.user_ability_ids.is_empty())
            && ctx.b.hp < hp_before_dot_b
        {
            let applied = hp_before_dot_b - ctx.b.hp;
            let final_dot = user_dispatch::run_pre_damage_hooks(
                ctx.a, ctx.b, eff_a, eff_b, ctx.time,
                applied, applied, "dot",
                ctx.combat_log, ctx.record_trace, "A", "B",
            );
            if (final_dot - applied).abs() > 1e-9 {
                ctx.b.hp = (hp_before_dot_b - final_dot).max(0.0);
            }
        }
        // B took DOT damage → bit on B, A "dealt" it.
        if ctx.b.hp < hp_before_dot_b {
            ctx.b.iter_damage_kinds_taken |= DAMAGE_KIND_DOT;
            ctx.a.iter_damage_kinds_dealt |= DAMAGE_KIND_DOT;
        }
        // 2026-05-12: DOT-on-B tracking. A is the "dealer".
        let dot_damage_to_b = (hp_before_dot_b - ctx.b.hp).max(0.0);
        if dot_damage_to_b > 0.0 {
            super::record_damage_event(ctx.a, ctx.b, ctx.time, dot_damage_to_b, dot_damage_to_b);
        }
        if ctx.record_trace {
            for (status_id, damage, hp_after) in tick_log {
                ctx.combat_log.push(crate::contracts::CombatLogEntry {
                    time: ctx.time,
                    entry_type: "dot".to_string(),
                    attacker: "A".to_string(),
                    damage,
                    healing: None,
                    actor_hp_after: ctx.a.hp.max(0.0),
                    hp_side: "B".to_string(),
                    hp_after,
                    description: Some(format!("{} tick", status_id)),
                    detail: None,
                    status_id: Some(status_id),
                });
            }
        }
        if !side_effects.is_empty() {
            apply_incoming_statuses_to_target_with_fortify_immunity(
                ctx.time,
                ctx.defender,
                ctx.b.hp,
                &mut ctx.b.statuses,
                &side_effects,
                ctx.b.fortify_immune_until,
            );
        }
    }
}

/// Phase 5+6: Post-death regen management + natural regen ticks.
///
/// TS does not disable regen for dead creatures (Phase 5 just notes this);
/// after the Phase 2 HP pin to 1, regen continues to lift HP slightly. The
/// real work is Phase 6: each side ticks its `next_regen` cadence, healing
/// `health × health_regen × multiplier × compare_regen_bonus_factor / 100`
/// per tick. Warden's Rage's rage-tap mode buffers ticks during the rage
/// window and fires them once the tap concludes (mirrors the bespoke TS
/// path's same-time-fold behaviour).
pub(in super::super) fn process_phase_5_6_regen(
    ctx: &mut PhaseContext<'_, '_>,
    regen_healed_a: &mut f64,
    regen_healed_b: &mut f64,
    regen_ticks_a: &mut u32,
    regen_ticks_b: &mut u32,
) {
    // Phase 5: post-death regen management - TS doesn't disable regen for
    // dead creatures. Phase 6 below ticks regen for both sides regardless
    // of HP. The HP pin happens in Phase 2.
    //
    // Phase 6: Compare-only regen bonus (Frosty, Volcanic, Pack Healer,
    // Clean water, Refreshed, Regen Boost, Mud Pile) is an aggregate
    // percentage-point bonus, applied multiplicatively as
    // (1 + bonus/100) on the heal amount.
    let attacker_regen_bonus_factor =
        1.0 + (ctx.config.attacker_compare_regen_bonus_pct.max(0.0) / 100.0);
    let defender_regen_bonus_factor =
        1.0 + (ctx.config.defender_compare_regen_bonus_pct.max(0.0) / 100.0);
    if ctx.a.next_regen.is_finite() {
        if ctx.config.attacker_warden_rage
            && ctx.attacker.health_regen > 0.0
            && ctx.a.warden_rage_on
        {
            while is_regen_tick_due(ctx.a.next_regen, ctx.time) {
                ctx.a.warden_rage_regen_buffered = true;
                ctx.a.next_regen += 15.0;
            }
        } else {
            if ctx.attacker.health_regen <= 0.0 {
                ctx.a.next_regen = f64::INFINITY;
            } else {
                while is_regen_tick_due(ctx.a.next_regen, ctx.time) {
                    let tick_time = ctx.a.next_regen;
                    if ctx.a.hp < ctx.attacker.health {
                        let heal = (ctx.attacker.health
                            * ctx.attacker.health_regen
                            * effective_hp_regen_multiplier_with_actives(
                                ctx.attacker,
                                ctx.a.hp,
                                &ctx.a.statuses,
                                ctx.time,
                                ctx.a.harden_active_until,
                            ))
                            / 100.0
                            * attacker_regen_bonus_factor
                            * ctx.a.posture_regen_mult();
                        if heal > 0.0 {
                            let hp_before = ctx.a.hp;
                            ctx.a.hp = (ctx.a.hp + heal).min(ctx.attacker.health);
                            let healed = (ctx.a.hp - hp_before).max(0.0);
                            *regen_healed_a += healed;
                            // Accumulate for OnHeal trigger.
                            ctx.a.iter_healing_taken += healed;
                            if ctx.record_trace && healed > 0.0 {
                                ctx.combat_log.push(crate::contracts::CombatLogEntry {
                                    time: tick_time,
                                    entry_type: "ability".to_string(),
                                    attacker: "A".to_string(),
                                    damage: 0.0,
                                    healing: Some(healed),
                                    actor_hp_after: ctx.a.hp.max(0.0),
                                    hp_side: "A".to_string(),
                                    hp_after: ctx.a.hp.max(0.0),
                                    description: Some("Natural regen".to_string()),
                                    detail: None,
                                    status_id: None,
                                });
                            }
                        }
                    }
                    *regen_ticks_a += 1;
                    ctx.a.next_regen += 15.0;
                }
            }
            if ctx.config.attacker_warden_rage && ctx.a.warden_rage_regen_buffered {
                let heal = (ctx.attacker.health
                    * ctx.attacker.health_regen
                    * effective_hp_regen_multiplier_with_actives(
                        ctx.attacker,
                        ctx.a.hp,
                        &ctx.a.statuses,
                        ctx.time,
                        ctx.a.harden_active_until,
                    ))
                    / 100.0
                    * attacker_regen_bonus_factor
                    * ctx.a.posture_regen_mult();
                if heal > 0.0 {
                    let hp_before = ctx.a.hp;
                    ctx.a.hp = (ctx.a.hp + heal).min(ctx.attacker.health);
                    let healed = (ctx.a.hp - hp_before).max(0.0);
                    *regen_healed_a += healed;
                    // Accumulate for OnHeal trigger.
                    ctx.a.iter_healing_taken += healed;
                    if ctx.record_trace && healed > 0.0 {
                        ctx.combat_log.push(crate::contracts::CombatLogEntry {
                            time: ctx.time,
                            entry_type: "ability".to_string(),
                            attacker: "A".to_string(),
                            damage: 0.0,
                            healing: Some(healed),
                            actor_hp_after: ctx.a.hp.max(0.0),
                            hp_side: "A".to_string(),
                            hp_after: ctx.a.hp.max(0.0),
                            description: Some("Natural regen".to_string()),
                            detail: None,
                            status_id: None,
                        });
                    }
                }
                *regen_ticks_a += 1;
                ctx.a.warden_rage_regen_buffered = false;
            }
        }
    }
    if ctx.b.next_regen.is_finite() {
        if ctx.config.defender_warden_rage
            && ctx.defender.health_regen > 0.0
            && ctx.b.warden_rage_on
        {
            while is_regen_tick_due(ctx.b.next_regen, ctx.time) {
                ctx.b.warden_rage_regen_buffered = true;
                ctx.b.next_regen += 15.0;
            }
        } else {
            if ctx.defender.health_regen <= 0.0 {
                ctx.b.next_regen = f64::INFINITY;
            } else {
                while is_regen_tick_due(ctx.b.next_regen, ctx.time) {
                    let tick_time = ctx.b.next_regen;
                    if ctx.b.hp < ctx.defender.health {
                        let heal = (ctx.defender.health
                            * ctx.defender.health_regen
                            * effective_hp_regen_multiplier_with_actives(
                                ctx.defender,
                                ctx.b.hp,
                                &ctx.b.statuses,
                                ctx.time,
                                ctx.b.harden_active_until,
                            ))
                            / 100.0
                            * defender_regen_bonus_factor
                            * ctx.b.posture_regen_mult();
                        if heal > 0.0 {
                            let hp_before = ctx.b.hp;
                            ctx.b.hp = (ctx.b.hp + heal).min(ctx.defender.health);
                            let healed = (ctx.b.hp - hp_before).max(0.0);
                            *regen_healed_b += healed;
                            // Accumulate for OnHeal trigger.
                            ctx.b.iter_healing_taken += healed;
                            if ctx.record_trace && healed > 0.0 {
                                ctx.combat_log.push(crate::contracts::CombatLogEntry {
                                    time: tick_time,
                                    entry_type: "ability".to_string(),
                                    attacker: "B".to_string(),
                                    damage: 0.0,
                                    healing: Some(healed),
                                    actor_hp_after: ctx.b.hp.max(0.0),
                                    hp_side: "B".to_string(),
                                    hp_after: ctx.b.hp.max(0.0),
                                    description: Some("Natural regen".to_string()),
                                    detail: None,
                                    status_id: None,
                                });
                            }
                        }
                    }
                    *regen_ticks_b += 1;
                    ctx.b.next_regen += 15.0;
                }
            }
            if ctx.config.defender_warden_rage && ctx.b.warden_rage_regen_buffered {
                let heal = (ctx.defender.health
                    * ctx.defender.health_regen
                    * effective_hp_regen_multiplier_with_actives(
                        ctx.defender,
                        ctx.b.hp,
                        &ctx.b.statuses,
                        ctx.time,
                        ctx.b.harden_active_until,
                    ))
                    / 100.0
                    * defender_regen_bonus_factor
                    * ctx.b.posture_regen_mult();
                if heal > 0.0 {
                    let hp_before = ctx.b.hp;
                    ctx.b.hp = (ctx.b.hp + heal).min(ctx.defender.health);
                    let healed = (ctx.b.hp - hp_before).max(0.0);
                    *regen_healed_b += healed;
                    // Accumulate for OnHeal trigger.
                    ctx.b.iter_healing_taken += healed;
                    if ctx.record_trace && healed > 0.0 {
                        ctx.combat_log.push(crate::contracts::CombatLogEntry {
                            time: ctx.time,
                            entry_type: "ability".to_string(),
                            attacker: "B".to_string(),
                            damage: 0.0,
                            healing: Some(healed),
                            actor_hp_after: ctx.b.hp.max(0.0),
                            hp_side: "B".to_string(),
                            hp_after: ctx.b.hp.max(0.0),
                            description: Some("Natural regen".to_string()),
                            detail: None,
                            status_id: None,
                        });
                    }
                }
                *regen_ticks_b += 1;
                ctx.b.warden_rage_regen_buffered = false;
            }
        }
    }
}

/// Phase 2.5 + Phase 3 + Phase 3c (Bad Omen): the StatusDecay-gated
/// portion of the status family.
///
/// Phase 2.5 refreshes `trails_facetank_override_active` for both
/// sides BEFORE Phase 3 status duration updates and Phase 12 DOT ticks
/// read it via `effective_block_persistent_decay`. Phase 3 advances
/// status durations on both sides with the per-side persistent-decay
/// flag. Phase 3c applies the pre-resolved Bad Omen outcome to whichever
/// side had Bad_Omen present pre-iteration but absent post-Phase-3
/// (i.e. the status expired this tick).
pub(in super::super) fn process_phase_status_decay_gate(ctx: &mut PhaseContext<'_, '_>) {
    let has_bad_omen_config = ctx.config.bad_omen_outcome.is_some();
    let had_bad_omen_a = has_bad_omen_config
        && ctx.a.statuses.get("Bad_Omen").map(|s| s.stacks > 0.0).unwrap_or(false);
    let had_bad_omen_b = has_bad_omen_config
        && ctx.b.statuses.get("Bad_Omen").map(|s| s.stacks > 0.0).unwrap_or(false);

    // Phase 2.5: Trails/Step facetank override refresh.
    ctx.a.trails_facetank_override_active = any_trail_or_step_active_for_side(
        ctx.a.hp,
        ctx.attacker.health,
        ctx.config.attacker_flame_trail_value,
        ctx.config.attacker_frost_trail_value,
        ctx.config.attacker_plague_trail_value,
        ctx.config.attacker_toxic_trail_value,
        ctx.config.attacker_healing_step_value,
    );
    ctx.b.trails_facetank_override_active = any_trail_or_step_active_for_side(
        ctx.b.hp,
        ctx.defender.health,
        ctx.config.defender_flame_trail_value,
        ctx.config.defender_frost_trail_value,
        ctx.config.defender_plague_trail_value,
        ctx.config.defender_toxic_trail_value,
        ctx.config.defender_healing_step_value,
    );

    // Phase 3: Status duration updates.
    let phase3_a_block_decay =
        effective_block_persistent_decay(&*ctx.a, ctx.config.attacker_compare_block_persistent_decay);
    let phase3_b_block_decay =
        effective_block_persistent_decay(&*ctx.b, ctx.config.defender_compare_block_persistent_decay);
    let mut decay_log_a: Vec<StatusDecayLogEntry> = Vec::new();
    let mut decay_log_b: Vec<StatusDecayLogEntry> = Vec::new();
    // Read the posture decay multiplier BEFORE the &mut borrow on
    // statuses - the borrow checker won't let us call &self methods
    // through ctx.a / ctx.b while a &mut borrow is live on a sub-field.
    let posture_decay_mult_a = ctx.a.posture_decay_mult();
    let posture_decay_mult_b = ctx.b.posture_decay_mult();
    crate::statuses::update_simple_status_durations_full(
        ctx.time,
        &mut ctx.a.statuses,
        phase3_a_block_decay,
        if ctx.record_trace { Some(&mut decay_log_a) } else { None },
        posture_decay_mult_a,
    );
    crate::statuses::update_simple_status_durations_full(
        ctx.time,
        &mut ctx.b.statuses,
        phase3_b_block_decay,
        if ctx.record_trace { Some(&mut decay_log_b) } else { None },
        posture_decay_mult_b,
    );
    if ctx.record_trace {
        emit_status_decay_log(ctx.combat_log, ctx.time, "A", ctx.a.hp, &decay_log_a);
        emit_status_decay_log(ctx.combat_log, ctx.time, "B", ctx.b.hp, &decay_log_b);
    }

    // Phase 3c: Bad Omen outcome application on expiry.
    if let Some(outcome) = ctx.config.bad_omen_outcome.as_ref() {
        let has_bad_omen_a = ctx.a.statuses.get("Bad_Omen").map(|s| s.stacks > 0.0).unwrap_or(false);
        if had_bad_omen_a && !has_bad_omen_a {
            apply_incoming_statuses_to_target_with_fortify_immunity(
                ctx.time,
                ctx.attacker,
                ctx.a.hp,
                &mut ctx.a.statuses,
                &[SimpleAppliedStatus {
                    status_id: outcome.status_id.clone(),
                    stacks: outcome.stacks,
                    source_ability: None,
                }],
                ctx.a.fortify_immune_until,
            );
        }
        let has_bad_omen_b = ctx.b.statuses.get("Bad_Omen").map(|s| s.stacks > 0.0).unwrap_or(false);
        if had_bad_omen_b && !has_bad_omen_b {
            apply_incoming_statuses_to_target_with_fortify_immunity(
                ctx.time,
                ctx.defender,
                ctx.b.hp,
                &mut ctx.b.statuses,
                &[SimpleAppliedStatus {
                    status_id: outcome.status_id.clone(),
                    stacks: outcome.stacks,
                    source_ability: None,
                }],
                ctx.b.fortify_immune_until,
            );
        }
    }
}
