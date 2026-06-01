//! Breath phase functions: Phases 14+15 (breath ticks) and
//! Phases 15b+15c (post-breath hooks: rewind snapshot + self-destruct death hook).
//! Extracted from `phases/mod.rs`.

#![allow(clippy::too_many_arguments)]

use super::super::*;

/// Phases 14+15: Breath A and Breath B. Each side fires its breath at
/// the scheduled tick (`a.next_breath` / `b.next_breath`), routing
/// through `tick_breath_side` for the actual stat-aware damage and
/// status apply. The wrapper here records cloud-breath Muddy refresh,
/// per-status apply deltas, breath-damage events, and life-leech
/// healing from breath damage (miasma family). The two halves are
/// side-symmetric — A tick runs against B as target, then B tick runs
/// against A.
pub(in super::super) fn process_phase_14_15_breath(
    ctx: &mut PhaseContext<'_, '_>,
    eff_a: &SimpleCombatantStats,
    eff_b: &SimpleCombatantStats,
    hunker_active_a: bool,
    hunker_active_b: bool,
    counters: &mut DamageCounters,
    breath_tick_count_a: &mut u32,
    breath_tick_count_b: &mut u32,
) {
    // Phase 14: Breath A
    if (ctx.a.next_breath - ctx.time).abs() <= 1e-9 {
        if let Some(breath) = ctx.attacker_breath {
            // Round 36 / A10: A is breathing onto B.
            ctx.a.iter_damage_kinds_dealt |= crate::composable::side::DAMAGE_KIND_BREATH;
            ctx.b.iter_damage_kinds_taken |= crate::composable::side::DAMAGE_KIND_BREATH;
            if ctx.record_trace {
                *breath_tick_count_a += 1;
            }
            let hp_a_before_breath = ctx.a.hp;
            let hp_b_before_breath = ctx.b.hp;
            let muddy_before_a = if ctx.record_trace
                && matches!(breath.special_kind.as_deref(), Some("cloud"))
            {
                ctx.a.statuses.get("Muddy_Status").and_then(|status| status.next_decay_at)
            } else {
                None
            };
            let breath_status_snapshot_a: Vec<(String, f64)> = if ctx.record_trace
                && !breath.special_statuses.is_empty()
            {
                breath
                    .special_statuses
                    .iter()
                    .map(|s| {
                        (
                            s.status_id.clone(),
                            ctx.b.statuses.get(&s.status_id).map(|i| i.stacks).unwrap_or(0.0),
                        )
                    })
                    .collect()
            } else {
                Vec::new()
            };
            tick_breath_side(
                ctx.time,
                eff_a,
                eff_b,
                breath,
                true,
                ctx.a,
                ctx.b,
                hunker_active_a,
                hunker_active_b,
                counters,
                ctx.combat_log,
                ctx.record_trace,
                "A",
                "B",
            );
            if ctx.record_trace {
                push_breath_heal_log(
                    ctx.combat_log,
                    ctx.time,
                    "A",
                    hp_a_before_breath,
                    ctx.a.hp,
                    breath,
                );
                let muddy_after_a = ctx.a.statuses.get("Muddy_Status").and_then(|status| status.next_decay_at);
                if matches!(breath.special_kind.as_deref(), Some("cloud"))
                    && muddy_after_a.zip(muddy_before_a).map(|(after, before)| after > before + 1e-9).unwrap_or(muddy_after_a.is_some())
                {
                    ctx.combat_log.push(crate::contracts::CombatLogEntry {
                        time: ctx.time,
                        entry_type: "ability".to_string(),
                        attacker: "A".to_string(),
                        damage: 0.0,
                        healing: None,
                        actor_hp_after: ctx.a.hp.max(0.0),
                        hp_side: "A".to_string(),
                        hp_after: ctx.a.hp.max(0.0),
                        description: Some("Cloud Breath applied Muddy (90s)".to_string()),
                        detail: None,
                        status_id: Some("Muddy_Status".to_string()),
                    });
                }
                for (status_id, prev) in breath_status_snapshot_a.iter() {
                    let after = ctx.b.statuses.get(status_id).map(|i| i.stacks).unwrap_or(0.0);
                    let delta = after - *prev;
                    if delta > 1e-9 {
                        ctx.combat_log.push(crate::contracts::CombatLogEntry {
                            time: ctx.time,
                            entry_type: "ability".to_string(),
                            attacker: "A".to_string(),
                            damage: 0.0,
                            healing: None,
                            actor_hp_after: ctx.a.hp.max(0.0),
                            hp_side: "B".to_string(),
                            hp_after: ctx.b.hp.max(0.0),
                            description: Some(format!(
                                "Breath applied {} ({})",
                                format_status_label(status_id),
                                format_stacks(delta)
                            )),
                            detail: None,
                            status_id: Some(status_id.clone()),
                        });
                    }
                }
            }
            let breath_damage_a = (hp_b_before_breath - ctx.b.hp).max(0.0);
            // 2026-05-12: breath damage now contributes to combat
            // counters (B4), sliding-window logs (B2), and raw-damage
            // accumulators (A10b). Bite already did this inline; this
            // is the extension to breath. Raw == applied here because
            // breath_resistance + hunker happen inside
            // `tick_breath_side` and we don't have a clean pre-
            // mitigation handle to surface separately. Pre-damage
            // hooks (A13 `on_before_*_damage`) remain bite-only —
            // refactoring `tick_breath_side` to expose the raw/post
            // split is a separate session.
            super::record_damage_event(ctx.a, ctx.b, ctx.time, breath_damage_a, breath_damage_a);
            if ctx.record_trace && breath_damage_a > 0.0 {
                ctx.combat_log.push(crate::contracts::CombatLogEntry {
                    time: ctx.time,
                    entry_type: "breath".to_string(),
                    attacker: "A".to_string(),
                    damage: breath_damage_a,
                    healing: None,
                    actor_hp_after: ctx.a.hp.max(0.0),
                    hp_side: "B".to_string(),
                    hp_after: ctx.b.hp.max(0.0),
                    description: Some("Breath tick".to_string()),
                    detail: None,
                    status_id: None,
                });
            }
            // Life Leech healing from breath damage (miasma, etc.)
            if ctx.config.attacker_life_leech_value > 0.0 {
                // Death pinning sets target.hp = 1.0, so account for that
                let breath_damage_to_target = if ctx.b.death_time.is_some() && hp_b_before_breath > 1.0 {
                    (hp_b_before_breath - 1.0).max(0.0)
                } else {
                    (hp_b_before_breath - ctx.b.hp).max(0.0)
                };
                // Reference status_heartbroken: blocks all healing
                // sources except natural regen.
                if breath_damage_to_target > 0.0
                    && !is_external_healing_blocked(&ctx.a.statuses)
                {
                    let hp_before_leech = ctx.a.hp;
                    let leech = simulate_simple_life_leech_hit(
                        ctx.time, ctx.attacker, ctx.a.hp, breath_damage_to_target, true,
                        ctx.a.life_leech_active_until, ctx.config.attacker_life_leech_value,
                    );
                    ctx.a.hp = leech.attacker_hp;
                    let healed = (ctx.a.hp - hp_before_leech).max(0.0);
                    // G4: feed the on_heal accumulator (dispatched in Phase 16).
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
                            description: Some("Life Leech heal".to_string()),
                            detail: None,
                            status_id: None,
                        });
                    }
                }
            }
        }
        ctx.a.next_breath = ctx.attacker_breath
            .map(|breath| runtime_breath_tick_sec(ctx.attacker, breath))
            .unwrap_or(1.0)
            + ctx.time;
    }

    // Phase 15: Breath B
    if (ctx.b.next_breath - ctx.time).abs() <= 1e-9 {
        if let Some(breath) = ctx.defender_breath {
            // Round 36 / A10: B is breathing onto A.
            ctx.b.iter_damage_kinds_dealt |= crate::composable::side::DAMAGE_KIND_BREATH;
            ctx.a.iter_damage_kinds_taken |= crate::composable::side::DAMAGE_KIND_BREATH;
            if ctx.record_trace {
                *breath_tick_count_b += 1;
            }
            let hp_a_before_breath = ctx.a.hp;
            let hp_b_before_breath = ctx.b.hp;
            let muddy_before_b = if ctx.record_trace
                && matches!(breath.special_kind.as_deref(), Some("cloud"))
            {
                ctx.b.statuses.get("Muddy_Status").and_then(|status| status.next_decay_at)
            } else {
                None
            };
            let breath_status_snapshot_b: Vec<(String, f64)> = if ctx.record_trace
                && !breath.special_statuses.is_empty()
            {
                breath
                    .special_statuses
                    .iter()
                    .map(|s| {
                        (
                            s.status_id.clone(),
                            ctx.a.statuses.get(&s.status_id).map(|i| i.stacks).unwrap_or(0.0),
                        )
                    })
                    .collect()
            } else {
                Vec::new()
            };
            tick_breath_side(
                ctx.time,
                eff_b,
                eff_a,
                breath,
                false,
                ctx.b,
                ctx.a,
                hunker_active_b,
                hunker_active_a,
                counters,
                ctx.combat_log,
                ctx.record_trace,
                "B",
                "A",
            );
            if ctx.record_trace {
                push_breath_heal_log(
                    ctx.combat_log,
                    ctx.time,
                    "B",
                    hp_b_before_breath,
                    ctx.b.hp,
                    breath,
                );
                let muddy_after_b = ctx.b.statuses.get("Muddy_Status").and_then(|status| status.next_decay_at);
                if matches!(breath.special_kind.as_deref(), Some("cloud"))
                    && muddy_after_b.zip(muddy_before_b).map(|(after, before)| after > before + 1e-9).unwrap_or(muddy_after_b.is_some())
                {
                    ctx.combat_log.push(crate::contracts::CombatLogEntry {
                        time: ctx.time,
                        entry_type: "ability".to_string(),
                        attacker: "B".to_string(),
                        damage: 0.0,
                        healing: None,
                        actor_hp_after: ctx.b.hp.max(0.0),
                        hp_side: "B".to_string(),
                        hp_after: ctx.b.hp.max(0.0),
                        description: Some("Cloud Breath applied Muddy (90s)".to_string()),
                        detail: None,
                        status_id: Some("Muddy_Status".to_string()),
                    });
                }
                for (status_id, prev) in breath_status_snapshot_b.iter() {
                    let after = ctx.a.statuses.get(status_id).map(|i| i.stacks).unwrap_or(0.0);
                    let delta = after - *prev;
                    if delta > 1e-9 {
                        ctx.combat_log.push(crate::contracts::CombatLogEntry {
                            time: ctx.time,
                            entry_type: "ability".to_string(),
                            attacker: "B".to_string(),
                            damage: 0.0,
                            healing: None,
                            actor_hp_after: ctx.b.hp.max(0.0),
                            hp_side: "A".to_string(),
                            hp_after: ctx.a.hp.max(0.0),
                            description: Some(format!(
                                "Breath applied {} ({})",
                                format_status_label(status_id),
                                format_stacks(delta)
                            )),
                            detail: None,
                            status_id: Some(status_id.clone()),
                        });
                    }
                }
            }
            let breath_damage_b = (hp_a_before_breath - ctx.a.hp).max(0.0);
            // 2026-05-12: extension of A→B breath tracking to B→A.
            super::record_damage_event(ctx.b, ctx.a, ctx.time, breath_damage_b, breath_damage_b);
            if ctx.record_trace && breath_damage_b > 0.0 {
                ctx.combat_log.push(crate::contracts::CombatLogEntry {
                    time: ctx.time,
                    entry_type: "breath".to_string(),
                    attacker: "B".to_string(),
                    damage: breath_damage_b,
                    healing: None,
                    actor_hp_after: ctx.b.hp.max(0.0),
                    hp_side: "A".to_string(),
                    hp_after: ctx.a.hp.max(0.0),
                    description: Some("Breath tick".to_string()),
                    detail: None,
                    status_id: None,
                });
            }
            // Life Leech healing from breath damage (miasma, etc.)
            if ctx.config.defender_life_leech_value > 0.0 {
                let breath_damage_to_target = if ctx.a.death_time.is_some() && hp_a_before_breath > 1.0 {
                    (hp_a_before_breath - 1.0).max(0.0)
                } else {
                    (hp_a_before_breath - ctx.a.hp).max(0.0)
                };
                // Reference status_heartbroken: blocks all healing
                // sources except natural regen.
                if breath_damage_to_target > 0.0
                    && !is_external_healing_blocked(&ctx.b.statuses)
                {
                    let hp_before_leech = ctx.b.hp;
                    let leech = simulate_simple_life_leech_hit(
                        ctx.time, ctx.defender, ctx.b.hp, breath_damage_to_target, true,
                        ctx.b.life_leech_active_until, ctx.config.defender_life_leech_value,
                    );
                    ctx.b.hp = leech.attacker_hp;
                    let healed = (ctx.b.hp - hp_before_leech).max(0.0);
                    // G4: feed the on_heal accumulator (dispatched in Phase 16).
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
                            description: Some("Life Leech heal".to_string()),
                            detail: None,
                            status_id: None,
                        });
                    }
                }
            }
        }
        ctx.b.next_breath = ctx.defender_breath
            .map(|breath| runtime_breath_tick_sec(ctx.defender, breath))
            .unwrap_or(1.0)
            + ctx.time;
    }
}

/// Phase 15b + 15c: Post-breath hooks. Phase 15b records rewind snapshots
/// for either side that has Rewind configured (snapshot taken AFTER all
/// damage/heal phases this tick but BEFORE Phase 16 final death commit,
/// so a same-tick lethal blow leaves a recoverable snapshot). Phase 15c
/// fires the Self-Destruct death-hook explosion: when an armed side dies
/// this tick (hp ≤ 0, death not yet committed), trigger the explosion at
/// the death time so its damage + Burn application both happen at the
/// pre-death moment. Both phases are gated by the corresponding `has_any`
/// flag so the megafunction can early-out when neither side has the
/// ability.
pub(in super::super) fn process_phase_15b_15c_post_breath_hooks(
    ctx: &mut PhaseContext<'_, '_>,
    has_any_rewind: bool,
    has_any_self_destruct: bool,
) {
    if has_any_rewind {
        if ctx.config.attacker_rewind {
            record_rewind_snapshot(&mut ctx.a.rewind_history, ctx.time, ctx.a.hp, &ctx.a.statuses);
        }
        if ctx.config.defender_rewind {
            record_rewind_snapshot(&mut ctx.b.rewind_history, ctx.time, ctx.b.hp, &ctx.b.statuses);
        }
    }
    if has_any_self_destruct {
        if ctx.a.self_destruct_armed && ctx.a.hp <= 0.0 && ctx.a.death_time.is_none() {
            if let Some(profile) = &ctx.attacker.self_destruct_profile {
                trigger_self_destruct_explosion(
                    ctx.time,
                    ctx.attacker,
                    ctx.defender,
                    profile,
                    &mut ctx.a.hp,
                    &mut ctx.b.hp,
                    &mut ctx.a.statuses,
                    &mut ctx.b.statuses,
                    &mut ctx.a.self_destruct_cooldown_until,
                    &mut ctx.a.self_destruct_armed,
                );
                record_ability_event(ctx.a, "A", ctx.combat_log, ctx.record_trace, ctx.time, "Self-Destruct");
            }
        }
        if ctx.b.self_destruct_armed && ctx.b.hp <= 0.0 && ctx.b.death_time.is_none() {
            if let Some(profile) = &ctx.defender.self_destruct_profile {
                trigger_self_destruct_explosion(
                    ctx.time,
                    ctx.defender,
                    ctx.attacker,
                    profile,
                    &mut ctx.b.hp,
                    &mut ctx.a.hp,
                    &mut ctx.b.statuses,
                    &mut ctx.a.statuses,
                    &mut ctx.b.self_destruct_cooldown_until,
                    &mut ctx.b.self_destruct_armed,
                );
                record_ability_event(ctx.b, "B", ctx.combat_log, ctx.record_trace, ctx.time, "Self-Destruct");
            }
        }
    }
}
