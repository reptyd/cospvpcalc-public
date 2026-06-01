//! Melee phase functions: Phases 10+11 (bite A and bite B).
//! Extracted from `phases/mod.rs`.

#![allow(clippy::too_many_arguments)]

use super::super::*;

/// Phases 10+11: Melee hit A and Melee hit B, with the symmetric
/// pre-Phase-10/11 Cocoon-Ph2-target-invincibility checks for both
/// sides. Each side: when `next_hit` is due, compute the raw bite
/// damage, layer per-side multipliers (HC × UR × warden rage ×
/// adrenaline × spite × power-charge × cocoon damage × expunge), apply
/// hunker reductions on owner and target, route through Reflect, log,
/// apply on-hit / on-hit-taken statuses, run Power-Charge / Gore-Charge
/// first-hit bonuses, run Divination burn ticks, decrement Toxic Trap
/// durability, fire Lich Mark, consume Spite, run Expunge post-bite,
/// and life-leech-heal the bite damage.
///
/// Death commit is deferred to Phase 16 — same-tick breath / heal can
/// still lift HP back above zero before death registers.
#[allow(clippy::too_many_arguments)]
pub(in super::super) fn process_phase_10_11_melee(
    ctx: &mut PhaseContext<'_, '_>,
    eff_a: &SimpleCombatantStats,
    eff_b: &SimpleCombatantStats,
    hunker_active_a: bool,
    hunker_active_b: bool,
    counters: &mut DamageCounters,
    bite_count_a: &mut u32,
    bite_count_b: &mut u32,
    bite_variant_override: Option<&super::super::loop_iter::BiteVariantOverrideFn<'_>>,
    // Engine-replay-resolved variants (live engine path). When set,
    // `resolve_bite_variant_*` uses these directly. None means
    // "fall through to config-driven mode resolution" — used by
    // callers that do not supply a pre-resolved variant (e.g.
    // PrimaryOnly / SecondaryOnly configs, or non-live callers).
    pre_resolved_variant_a: Option<&'static str>,
    pre_resolved_variant_b: Option<&'static str>,
) {
    // Cocoon Ph2 target invincibility: if A's bite is due AND B is in Ph2,
    // reschedule A's bite to Ph2 end and skip this hit entirely (no damage,
    // no statuses, no life-leech, no power charge consume). Bite cadence
    // resumes when invincibility lifts.
    if (ctx.a.next_hit - ctx.time).abs() <= 1e-9 && ctx.b.in_cocoon_phase_2(ctx.time) {
        ctx.a.next_hit = ctx.b.cocoon_phase2_until;
    }
    // Cocoon Ph2 caster lock-out: if A's bite is due AND A is itself in
    // Ph2 (post-2026-05-12: P1 no longer locks the user, only P2 does),
    // reschedule A's own bite to A's Ph2 end. Mirrors the opponent
    // reschedule above but reads A's own cocoon window.
    if (ctx.a.next_hit - ctx.time).abs() <= 1e-9 && ctx.a.in_cocoon_phase_2(ctx.time) {
        ctx.a.next_hit = ctx.a.cocoon_phase2_until;
    }
    // Posture gate: A cannot bite while settled in Sitting / Laying.
    // The transition window does NOT block (matches the multiplier
    // gate — actions stay free until the posture is fully settled).
    // We push next_hit forward by one bite cooldown so the scheduler
    // makes progress; when the policy stands A back up, the next bite
    // fires after the rescheduled cooldown elapses.
    if (ctx.a.next_hit - ctx.time).abs() <= 1e-9 && ctx.a.posture_settled_non_standing() {
        ctx.a.next_hit = ctx.time
            + current_simple_bite_cooldown_with_statuses(eff_a, ctx.a.hp, &ctx.a.statuses);
    }
    // Phase 10: Melee hit A
    if (ctx.a.next_hit - ctx.time).abs() <= 1e-9 {
        // Round 36 / A10: tag iter mask — A is dealing a bite this iter,
        // B is taking bite damage. Note: this fires whether or not the
        // bite ultimately lands damage (Cocoon Ph2 invincibility short-
        // circuits earlier in the phase). For the "is_bite" semantics
        // — "did this iter contain a bite event aimed at B" — that's
        // accurate enough for user gates.
        ctx.a.iter_damage_kinds_dealt |= crate::composable::side::DAMAGE_KIND_BITE;
        ctx.b.iter_damage_kinds_taken |= crate::composable::side::DAMAGE_KIND_BITE;
        if ctx.record_trace {
            *bite_count_a += 1;
        }
        // P3: bite variant decision (primary vs. secondary).
        //
        // `bite_eff_a` is an effective stats *view* for THIS bite —
        // identical to `eff_a` on primary, `eff_a` with damage swapped
        // for `damage2` on secondary. On-hit offensive ailments are
        // suppressed entirely on secondary (gated below at the
        // status-apply block, line ~1310).
        //
        // Bite cadence (`next_hit`) is variant-independent — primary
        // and secondary share the same cooldown timer per design.
        let bite_variant_a = if let Some(v) = pre_resolved_variant_a {
            // Engine-replay already picked this variant for this bite
            // event; honor the secondary→primary fallback if damage2
            // was zero between pre-resolve and this point (defensive).
            use crate::policy::decisions::bite_variant::{PRIMARY_VARIANT, SECONDARY_VARIANT};
            if v == SECONDARY_VARIANT && eff_a.damage2 <= 0.0 {
                PRIMARY_VARIANT
            } else {
                v
            }
        } else {
            super::resolve_bite_variant_attacker(ctx, eff_a, eff_b, bite_variant_override)
        };
        let bite_eff_a_secondary = super::bite_eff_for_secondary(eff_a, bite_variant_a);
        let bite_eff_a: &SimpleCombatantStats = bite_eff_a_secondary.as_ref().unwrap_or(eff_a);
        // Hunters Curse and Unbridled Rage are independent damage
        // boosts and stack multiplicatively, mirroring TS
        // `combatMath.ts:51-56` (sequential `if`s, not else-if).
        let mut melee_multiplier_a = 1.0;
        if ctx.config.attacker_hunters_curse
            && ctx.a.hunters_curse_active_until > 0.0
            && ctx.a.hunters_curse_active_until > ctx.time
        {
            melee_multiplier_a *= 2.0;
        }
        if ctx.config.attacker_unbridled_rage
            && ctx.a.unbridled_rage_active_until > 0.0
            && ctx.a.unbridled_rage_active_until > ctx.time
        {
            melee_multiplier_a *= 1.3;
        }
        let warden_rage_mult_a = if ctx.config.attacker_warden_rage {
            wardens_rage_multiplier(ctx.a.warden_rage_stacks)
        } else {
            1.0
        };
        let adrenaline_mult_a = if ctx.config.attacker_adrenaline
            && ctx.a.adrenaline_active_until > 0.0
            && ctx.a.adrenaline_active_until > ctx.time
        {
            1.2
        } else {
            1.0
        };
        let spite_mult_a = if ctx.a.spite_armed && ctx.config.attacker_spite_value != 0.0 {
            let activation_time = ctx.a.spite_charge_ready_at - 5.0;
            let charge_ratio = ((ctx.time - activation_time) / 5.0).clamp(0.0, 1.0);
            1.0 + ctx.config.attacker_spite_value * charge_ratio
        } else {
            1.0
        };
        let spite_status_mult_a = if ctx.a.spite_armed { 2.0 } else { 1.0 };
        let divination_flat_a = if ctx.a.divination_charges_left > 0 { 50.0 } else { 0.0 };
        let power_charge_mult_a = if ctx.config.attacker_power_charge && !ctx.a.first_melee_hit_taken {
            1.5
        } else {
            1.0
        };
        let cocoon_damage_mult_a = if ctx.a.statuses.get("Cocoon_Damage_Status").map(|s| s.stacks).unwrap_or(0.0) > 0.0 {
            1.15
        } else {
            1.0
        };
        // Expunge (default modeled, ideal policy): fires only when it
        // produces unambiguous net benefit — kill secure or heal save.
        let bleed_on_b = ctx.b.statuses.get("Bleed_Status").map(|s| s.stacks).unwrap_or(0.0);
        let expunge_cd_ready = ctx.time >= ctx.a.expunge_cooldown_until;
        let expunge_eligible = ctx.config.attacker_expunge && expunge_cd_ready && bleed_on_b >= 1.0;
        let expunge_mult_value = 1.0 + EXPUNGE_DAMAGE_PER_STACK * bleed_on_b;

        let (kill_secure_a, heal_save_a) = if expunge_eligible {
            // P3: use the variant-effective stats so secondary's lower
            // damage feeds Expunge's kill-secure math. Heal projection
            // below still reads `ctx.attacker.damage` (pre-variant) —
            // matches the existing convention that Expunge heal scales
            // with base attack, not the bite's current damage flavor.
            let raw_melee_a = compute_melee_damage_per_hit_with_actor_and_target_statuses(
                bite_eff_a, eff_b, ctx.a.hp, &ctx.a.statuses, &ctx.b.statuses,
            );
            let common_mult_a = melee_multiplier_a
                * warden_rage_mult_a
                * adrenaline_mult_a
                * spite_mult_a
                * power_charge_mult_a
                * cocoon_damage_mult_a;
            // Posture: Expunge kill-secure projection must reflect the
            // multiplier that would actually land — otherwise Expunge
            // refuses a guaranteed kill on a laying target.
            let posture_mult_on_b = ctx.b.posture_incoming_damage_mult();
            let normal_final = apply_hunker_to_incoming(
                apply_hunker_to_damage(
                    (raw_melee_a * common_mult_a + divination_flat_a) * posture_mult_on_b,
                    hunker_active_a,
                ),
                eff_b.hunker_reduction_pct,
                hunker_active_b,
            );
            let bonus_final = apply_hunker_to_incoming(
                apply_hunker_to_damage(
                    (raw_melee_a * common_mult_a * expunge_mult_value + divination_flat_a)
                        * posture_mult_on_b,
                    hunker_active_a,
                ),
                eff_b.hunker_reduction_pct,
                hunker_active_b,
            );
            let kill_secure = normal_final < ctx.b.hp && bonus_final >= ctx.b.hp;

            // P3: scale Expunge heal by the variant's effective damage.
            // Pre-P3 the TS bridge substituted `damage = damage2` before
            // serialization in SecondaryOnly mode, which made this line
            // read damage2 implicitly. After P3 the bridge no longer
            // mutates `damage`; we re-derive variant damage from
            // `bite_eff_a` to preserve the equivalent behavior.
            let heal_amount = EXPUNGE_HEAL_FRACTION_OF_BONUS
                * bite_eff_a.damage
                * EXPUNGE_DAMAGE_PER_STACK
                * bleed_on_b;
            // Opp-bite projection: scale by A's posture vulnerability
            // so the heal-save trigger fires for the real expected hit.
            let opp_bite_raw = compute_melee_damage_per_hit_with_actor_and_target_statuses(
                eff_b, eff_a, ctx.b.hp, &ctx.b.statuses, &ctx.a.statuses,
            ) * ctx.a.posture_incoming_damage_mult();
            let a_next_cd = ctx.attacker.bite_cooldown.max(0.1);
            let b_cd = eff_b.bite_cooldown.max(0.1);
            let projected_opp_bites = (a_next_cd / b_cd).ceil().max(1.0);
            let projected_incoming = opp_bite_raw * projected_opp_bites;
            let safety_margin = ctx.attacker.health.max(1.0) * EXPUNGE_HEAL_SAVE_SAFETY_RATIO;
            let heal_save = ctx.a.hp < projected_incoming + safety_margin
                && ctx.a.hp + heal_amount >= projected_incoming + safety_margin;

            (kill_secure, heal_save)
        } else {
            (false, false)
        };

        let expunge_fires_a = expunge_eligible && (kill_secure_a || heal_save_a);
        let expunge_mult_a = if expunge_fires_a { expunge_mult_value } else { 1.0 };
        // Round 43 / A13: keep the pre-mitigation amount so the
        // `on_before_take_damage` / `on_before_deal_damage` hooks can
        // surface it as `event.raw_damage`.
        //
        // P3: pass `bite_eff_a` (variant-effective) so secondary's
        // damage2 is honored — primary path is unchanged because
        // `bite_eff_a == eff_a` then.
        let raw_bite_damage_a = (compute_melee_damage_per_hit_with_actor_and_target_statuses(
            bite_eff_a,
            eff_b,
            ctx.a.hp,
            &ctx.a.statuses,
            &ctx.b.statuses,
        ) * melee_multiplier_a
            * warden_rage_mult_a
            * adrenaline_mult_a
            * spite_mult_a
            * power_charge_mult_a
            * cocoon_damage_mult_a
            * expunge_mult_a
            + divination_flat_a)
            * ctx.b.posture_incoming_damage_mult();
        let mut damage_a = apply_hunker_to_incoming(
            apply_hunker_to_damage(raw_bite_damage_a, hunker_active_a),
            eff_b.hunker_reduction_pct,
            hunker_active_b,
        );
        // Round 43 / A10b: accumulate raw (pre-mitigation) for the
        // post-damage event extras.
        ctx.a.iter_raw_damage_dealt += raw_bite_damage_a.max(0.0);
        ctx.b.iter_raw_damage_taken += raw_bite_damage_a.max(0.0);
        // Round 43 / A13: pre-damage hooks (dealer = A, victim = B).
        // Hooks see raw_damage and the engine's post-mitigation
        // amount; either may write `damage_override` to replace.
        if damage_a > 0.0 {
            damage_a = user_dispatch::run_pre_damage_hooks(
                ctx.a, ctx.b, ctx.attacker, ctx.defender, ctx.time,
                raw_bite_damage_a, damage_a, "bite",
                ctx.combat_log, ctx.record_trace, "A", "B",
            );
        }
        let hp_b_before_melee = ctx.b.hp;
        let mut reflected_to_a = apply_direct_damage_with_reflect(
            damage_a,
            true,
            false,
            eff_a,
            eff_b,
            &ctx.a.statuses,
            &ctx.b.statuses,
            &mut ctx.a.hp,
            &mut ctx.b.hp,
            counters,
            hunker_active_b,
        );
        // G3: route the reflected self-damage (B reflects A's bite back at A)
        // through the pre-damage hook — dealer = B (reflector), victim = A.
        // Post-hoc: adjust A's hp by the override delta. No-op fast path when
        // no user ability (byte-identical).
        if reflected_to_a > 0.0
            && (!ctx.attacker.user_ability_ids.is_empty()
                || !ctx.defender.user_ability_ids.is_empty())
        {
            let final_reflect = user_dispatch::run_pre_damage_hooks(
                ctx.b, ctx.a, eff_b, eff_a, ctx.time,
                reflected_to_a, reflected_to_a, "reflect",
                ctx.combat_log, ctx.record_trace, "B", "A",
            );
            if (final_reflect - reflected_to_a).abs() > 1e-9 {
                ctx.a.hp = (ctx.a.hp + reflected_to_a - final_reflect).max(0.0);
                reflected_to_a = final_reflect;
            }
        }
        let applied_melee_damage_a = (hp_b_before_melee - ctx.b.hp).max(0.0);
        // Round 45 / B4: cumulative bite + damage counters surfaced
        // as `combat.bites_dealt` / `combat.bites_taken` /
        // `combat.damage_dealt_total` / `combat.damage_taken_total`
        // to user expressions. Stored on each side's `user_extras`
        // following the same pattern as `combat.iteration_count`.
        // Bite counts increment regardless of whether the hit
        // actually reduced HP (0-damage user-shielded bite still
        // counts as a bite event).
        super::bump_combat_counter(&mut ctx.a.user_extras, "combat.bites_dealt", 1.0);
        super::bump_combat_counter(&mut ctx.b.user_extras, "combat.bites_taken", 1.0);
        super::bump_combat_counter(&mut ctx.a.user_extras, "combat.damage_dealt_total", applied_melee_damage_a);
        super::bump_combat_counter(&mut ctx.b.user_extras, "combat.damage_taken_total", applied_melee_damage_a);
        // Round 46 / B2: sliding-window logs.
        super::push_damage_window(&mut ctx.a.recent_damage_dealt, ctx.time, applied_melee_damage_a);
        super::push_damage_window(&mut ctx.b.recent_damage_taken, ctx.time, applied_melee_damage_a);
        if ctx.record_trace && reflected_to_a > 0.0 {
            ctx.combat_log.push(crate::contracts::CombatLogEntry {
                time: ctx.time,
                entry_type: "ability".to_string(),
                attacker: "B".to_string(),
                damage: reflected_to_a,
                healing: None,
                actor_hp_after: ctx.b.hp.max(0.0),
                hp_side: "A".to_string(),
                hp_after: ctx.a.hp.max(0.0),
                description: Some("Reflect (bite)".to_string()),
                detail: None,
                status_id: None,
            });
        }
        if applied_melee_damage_a > 0.0 {
            ctx.a.last_melee_hit_at = ctx.time;
            ctx.a.last_melee_hit_damage = applied_melee_damage_a;
        }
        if ctx.record_trace && applied_melee_damage_a > 0.0 {
            // P3: surface variant in the timeline so primary vs. secondary
            // bites are distinguishable at a glance. Primary keeps the
            // legacy "Bite hit" label (zero regression for existing
            // fixtures / TS-side consumers that filter on description);
            // secondary uses "Secondary bite hit".
            let bite_description = if bite_variant_a
                == crate::policy::decisions::bite_variant::SECONDARY_VARIANT
            {
                "Secondary bite hit"
            } else {
                "Bite hit"
            };
            ctx.combat_log.push(crate::contracts::CombatLogEntry {
                time: ctx.time,
                entry_type: "bite".to_string(),
                attacker: "A".to_string(),
                damage: applied_melee_damage_a,
                healing: None,
                actor_hp_after: ctx.a.hp.max(0.0),
                hp_side: "B".to_string(),
                hp_after: ctx.b.hp.max(0.0),
                description: Some(bite_description.to_string()),
                detail: None,
                status_id: None,
            });
        }
        // P3: skip on-hit offensive ailments entirely when this bite
        // is the secondary attack. Secondary deals more damage but
        // applies *no* offensive statuses — that's the whole game-
        // design trade-off the policy weighs. Power Charge / Gore
        // Charge / Divination below are separate Compare-side bonus
        // statuses, not "on-hit ailments", so they keep firing.
        if bite_variant_a != crate::policy::decisions::bite_variant::SECONDARY_VARIANT {
            // Spite doubles on-hit status stacks
            let on_hit_a: Vec<SimpleAppliedStatus> = if spite_status_mult_a > 1.0 {
                ctx.attacker.on_hit_statuses.iter().map(|s| SimpleAppliedStatus {
                    status_id: s.status_id.clone(),
                    stacks: s.stacks * spite_status_mult_a,
                    source_ability: None,
                }).collect()
            } else {
                ctx.attacker.on_hit_statuses.clone()
            };
            let scaled_on_hit_a = scale_direct_attack_offensive_ailment_statuses(
                &on_hit_a,
                ctx.attacker,
                ctx.defender,
                &ctx.a.statuses,
                &ctx.b.statuses,
            );
            apply_statuses_with_per_effect_trace(
                ctx.time,
                eff_b,
                ctx.b.hp,
                &mut ctx.b.statuses,
                &scaled_on_hit_a,
                ctx.b.fortify_immune_until,
                "A",
                ctx.a.hp,
                "B",
                "Bite",
                if ctx.record_trace { Some(ctx.combat_log) } else { None },
            );
        }
        // Power Charge / Gore Charge: first-hit bonus statuses (compare-only).
        if ctx.config.attacker_power_charge && !ctx.a.first_melee_hit_taken {
            let extra = vec![SimpleAppliedStatus {
                status_id: "Shredded_Wings".to_string(),
                stacks: 2.0,
                source_ability: None,
            }];
            apply_incoming_statuses_to_target_with_fortify_immunity(
                ctx.time, eff_b, ctx.b.hp, &mut ctx.b.statuses, &extra, ctx.b.fortify_immune_until,
            );
            record_ability_event(ctx.a, "A", ctx.combat_log, ctx.record_trace, ctx.time, "Power Charge");
        }
        if ctx.config.attacker_gore_charge && !ctx.a.first_melee_hit_taken {
            let extra = vec![
                SimpleAppliedStatus { status_id: "Bleed_Status".to_string(), stacks: 2.0, source_ability: None },
                SimpleAppliedStatus { status_id: "Deep_Wounds_Status".to_string(), stacks: 10.0, source_ability: None },
            ];
            apply_incoming_statuses_to_target_with_fortify_immunity(
                ctx.time, eff_b, ctx.b.hp, &mut ctx.b.statuses, &extra, ctx.b.fortify_immune_until,
            );
            record_ability_event(ctx.a, "A", ctx.combat_log, ctx.record_trace, ctx.time, "Gore Charge");
        }
        ctx.a.first_melee_hit_taken = true;
        // Divination: apply 2 Burn stacks and consume a charge
        if ctx.a.divination_charges_left > 0 {
            let divination_burn = vec![SimpleAppliedStatus {
                status_id: "Burn_Status".to_string(),
                stacks: 2.0,
                source_ability: None,
            }];
            apply_incoming_statuses_to_target_with_fortify_immunity(
                ctx.time,
                eff_b,
                ctx.b.hp,
                &mut ctx.b.statuses,
                &divination_burn,
                ctx.b.fortify_immune_until,
            );
            ctx.a.divination_charges_left -= 1;
        }
        // Toxic Trap: A's bite consumes one durability charge on B's trap
        if ctx.config.defender_toxic_trap && ctx.b.toxic_trap_bites_remaining > 0 {
            ctx.b.toxic_trap_bites_remaining -= 1;
            if ctx.b.toxic_trap_bites_remaining <= 0 {
                ctx.b.toxic_trap_next_tick_at = None;
            }
        }
        if ctx.config.attacker_lich_mark {
            apply_lich_mark_on_melee_hit(
                ctx.a,
                ctx.b,
                ctx.config.attacker_lich_mark_payload_status_id.as_deref(),
                ctx.time,
            );
        }
        apply_statuses_with_per_effect_trace(
            ctx.time,
            eff_a,
            ctx.a.hp,
            &mut ctx.a.statuses,
            &ctx.defender.on_hit_taken_statuses,
            ctx.a.fortify_immune_until,
            "B",
            ctx.b.hp,
            "A",
            "Defensive",
            if ctx.record_trace { Some(ctx.combat_log) } else { None },
        );
        if ctx.a.spite_armed {
            ctx.a.spite_armed = false;
            ctx.a.spite_charge_ready_at = 0.0;
            record_ability_event(ctx.a, "A", ctx.combat_log, ctx.record_trace, ctx.time, "Spite");
        }
        if expunge_fires_a {
            ctx.b.statuses.remove("Bleed_Status");
            // P3: same variant-aware heal as the eligibility check above.
            let heal_amount = EXPUNGE_HEAL_FRACTION_OF_BONUS
                * bite_eff_a.damage
                * EXPUNGE_DAMAGE_PER_STACK
                * bleed_on_b;
            let hp_before_expunge_heal = ctx.a.hp;
            ctx.a.hp = (ctx.a.hp + heal_amount).min(ctx.attacker.health);
            let healed = (ctx.a.hp - hp_before_expunge_heal).max(0.0);
            ctx.a.expunge_cooldown_until = ctx.time + scale_active_cooldown(ctx.attacker, EXPUNGE_COOLDOWN_SEC);
            record_ability_event(ctx.a, "A", ctx.combat_log, ctx.record_trace, ctx.time, "Expunge");
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
                    description: Some("Expunge heal".to_string()),
                    detail: None,
                    status_id: None,
                });
            }
        }
        // Life Leech healing from melee
        if ctx.config.attacker_life_leech_value > 0.0 && applied_melee_damage_a > 0.0
            && !is_external_healing_blocked(&ctx.a.statuses)
        {
            let hp_before_leech = ctx.a.hp;
            let leech = simulate_simple_life_leech_hit(
                ctx.time, ctx.attacker, ctx.a.hp, applied_melee_damage_a, true,
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
        ctx.a.next_hit =
            ctx.time + current_simple_bite_cooldown_with_statuses(eff_a, ctx.a.hp, &ctx.a.statuses);
        // Death commit deferred to Phase 16.
    }

    // Cocoon Ph2 target invincibility (symmetric to A).
    if (ctx.b.next_hit - ctx.time).abs() <= 1e-9 && ctx.a.in_cocoon_phase_2(ctx.time) {
        ctx.b.next_hit = ctx.a.cocoon_phase2_until;
    }
    // Cocoon Ph2 caster lock-out (symmetric to A — B can't bite during own P2).
    if (ctx.b.next_hit - ctx.time).abs() <= 1e-9 && ctx.b.in_cocoon_phase_2(ctx.time) {
        ctx.b.next_hit = ctx.b.cocoon_phase2_until;
    }
    // Posture gate (symmetric to A — see comment above).
    if (ctx.b.next_hit - ctx.time).abs() <= 1e-9 && ctx.b.posture_settled_non_standing() {
        ctx.b.next_hit = ctx.time
            + current_simple_bite_cooldown_with_statuses(eff_b, ctx.b.hp, &ctx.b.statuses);
    }
    // Phase 11: Melee hit B
    if (ctx.b.next_hit - ctx.time).abs() <= 1e-9 {
        // Round 36 / A10: tag iter mask for the symmetric bite.
        ctx.b.iter_damage_kinds_dealt |= crate::composable::side::DAMAGE_KIND_BITE;
        ctx.a.iter_damage_kinds_taken |= crate::composable::side::DAMAGE_KIND_BITE;
        if ctx.record_trace {
            *bite_count_b += 1;
        }
        // P3 — mirror of the A-bite variant decision (see Phase 10).
        let bite_variant_b = if let Some(v) = pre_resolved_variant_b {
            use crate::policy::decisions::bite_variant::{PRIMARY_VARIANT, SECONDARY_VARIANT};
            if v == SECONDARY_VARIANT && eff_b.damage2 <= 0.0 {
                PRIMARY_VARIANT
            } else {
                v
            }
        } else {
            super::resolve_bite_variant_defender(ctx, eff_a, eff_b, bite_variant_override)
        };
        let bite_eff_b_secondary = super::bite_eff_for_secondary(eff_b, bite_variant_b);
        let bite_eff_b: &SimpleCombatantStats = bite_eff_b_secondary.as_ref().unwrap_or(eff_b);
        let mut melee_multiplier_b = 1.0;
        if ctx.config.defender_hunters_curse
            && ctx.b.hunters_curse_active_until > 0.0
            && ctx.b.hunters_curse_active_until > ctx.time
        {
            melee_multiplier_b *= 2.0;
        }
        if ctx.config.defender_unbridled_rage
            && ctx.b.unbridled_rage_active_until > 0.0
            && ctx.b.unbridled_rage_active_until > ctx.time
        {
            melee_multiplier_b *= 1.3;
        }
        let warden_rage_mult_b = if ctx.config.defender_warden_rage {
            wardens_rage_multiplier(ctx.b.warden_rage_stacks)
        } else {
            1.0
        };
        let adrenaline_mult_b = if ctx.config.defender_adrenaline
            && ctx.b.adrenaline_active_until > 0.0
            && ctx.b.adrenaline_active_until > ctx.time
        {
            1.2
        } else {
            1.0
        };
        let spite_mult_b = if ctx.b.spite_armed && ctx.config.defender_spite_value != 0.0 {
            let activation_time = ctx.b.spite_charge_ready_at - 5.0;
            let charge_ratio = ((ctx.time - activation_time) / 5.0).clamp(0.0, 1.0);
            1.0 + ctx.config.defender_spite_value * charge_ratio
        } else {
            1.0
        };
        let spite_status_mult_b = if ctx.b.spite_armed { 2.0 } else { 1.0 };
        let divination_flat_b = if ctx.b.divination_charges_left > 0 { 50.0 } else { 0.0 };
        let power_charge_mult_b = if ctx.config.defender_power_charge && !ctx.b.first_melee_hit_taken {
            1.5
        } else {
            1.0
        };
        let cocoon_damage_mult_b = if ctx.b.statuses.get("Cocoon_Damage_Status").map(|s| s.stacks).unwrap_or(0.0) > 0.0 {
            1.15
        } else {
            1.0
        };
        let bleed_on_a = ctx.a.statuses.get("Bleed_Status").map(|s| s.stacks).unwrap_or(0.0);
        let expunge_cd_ready_b = ctx.time >= ctx.b.expunge_cooldown_until;
        let expunge_eligible_b = ctx.config.defender_expunge && expunge_cd_ready_b && bleed_on_a >= 1.0;
        let expunge_mult_value_b = 1.0 + EXPUNGE_DAMAGE_PER_STACK * bleed_on_a;

        let (kill_secure_b, heal_save_b) = if expunge_eligible_b {
            // P3: variant-effective stats for B's bite Expunge check
            // (mirror of A-side, see Phase 10).
            let raw_melee_b = compute_melee_damage_per_hit_with_actor_and_target_statuses(
                bite_eff_b, eff_a, ctx.b.hp, &ctx.b.statuses, &ctx.a.statuses,
            );
            let common_mult_b = melee_multiplier_b
                * warden_rage_mult_b
                * adrenaline_mult_b
                * spite_mult_b
                * power_charge_mult_b
                * cocoon_damage_mult_b;
            // Posture: mirror of the A-side Expunge projection.
            let posture_mult_on_a = ctx.a.posture_incoming_damage_mult();
            let normal_final = apply_hunker_to_incoming(
                apply_hunker_to_damage(
                    (raw_melee_b * common_mult_b + divination_flat_b) * posture_mult_on_a,
                    hunker_active_b,
                ),
                eff_a.hunker_reduction_pct,
                hunker_active_a,
            );
            let bonus_final = apply_hunker_to_incoming(
                apply_hunker_to_damage(
                    (raw_melee_b * common_mult_b * expunge_mult_value_b + divination_flat_b)
                        * posture_mult_on_a,
                    hunker_active_b,
                ),
                eff_a.hunker_reduction_pct,
                hunker_active_a,
            );
            let kill_secure = normal_final < ctx.a.hp && bonus_final >= ctx.a.hp;

            // P3: variant-aware heal on the B side (mirror of A's).
            let heal_amount = EXPUNGE_HEAL_FRACTION_OF_BONUS
                * bite_eff_b.damage
                * EXPUNGE_DAMAGE_PER_STACK
                * bleed_on_a;
            let opp_bite_raw = compute_melee_damage_per_hit_with_actor_and_target_statuses(
                eff_a, eff_b, ctx.a.hp, &ctx.a.statuses, &ctx.b.statuses,
            ) * ctx.b.posture_incoming_damage_mult();
            let b_next_cd = ctx.defender.bite_cooldown.max(0.1);
            let a_cd = eff_a.bite_cooldown.max(0.1);
            let projected_opp_bites = (b_next_cd / a_cd).ceil().max(1.0);
            let projected_incoming = opp_bite_raw * projected_opp_bites;
            let safety_margin = ctx.defender.health.max(1.0) * EXPUNGE_HEAL_SAVE_SAFETY_RATIO;
            let heal_save = ctx.b.hp < projected_incoming + safety_margin
                && ctx.b.hp + heal_amount >= projected_incoming + safety_margin;

            (kill_secure, heal_save)
        } else {
            (false, false)
        };

        let expunge_fires_b = expunge_eligible_b && (kill_secure_b || heal_save_b);
        let expunge_mult_b = if expunge_fires_b { expunge_mult_value_b } else { 1.0 };
        // Round 43 / A13: same shape as the A-bites-B path above.
        // P3: variant-effective `bite_eff_b` so secondary's damage2
        // feeds raw_bite_damage_b.
        let raw_bite_damage_b = (compute_melee_damage_per_hit_with_actor_and_target_statuses(
            bite_eff_b,
            eff_a,
            ctx.b.hp,
            &ctx.b.statuses,
            &ctx.a.statuses,
        ) * melee_multiplier_b
            * warden_rage_mult_b
            * adrenaline_mult_b
            * spite_mult_b
            * power_charge_mult_b
            * cocoon_damage_mult_b
            * expunge_mult_b
            + divination_flat_b)
            * ctx.a.posture_incoming_damage_mult();
        let mut damage_b = apply_hunker_to_incoming(
            apply_hunker_to_damage(raw_bite_damage_b, hunker_active_b),
            eff_a.hunker_reduction_pct,
            hunker_active_a,
        );
        ctx.b.iter_raw_damage_dealt += raw_bite_damage_b.max(0.0);
        ctx.a.iter_raw_damage_taken += raw_bite_damage_b.max(0.0);
        if damage_b > 0.0 {
            damage_b = user_dispatch::run_pre_damage_hooks(
                ctx.b, ctx.a, ctx.defender, ctx.attacker, ctx.time,
                raw_bite_damage_b, damage_b, "bite",
                ctx.combat_log, ctx.record_trace, "B", "A",
            );
        }
        let hp_a_before_melee = ctx.a.hp;
        let mut reflected_to_b = apply_direct_damage_with_reflect(
            damage_b,
            false,
            false,
            eff_b,
            eff_a,
            &ctx.b.statuses,
            &ctx.a.statuses,
            &mut ctx.b.hp,
            &mut ctx.a.hp,
            counters,
            hunker_active_a,
        );
        // G3: route the reflected self-damage (A reflects B's bite back at B)
        // through the pre-damage hook — dealer = A (reflector), victim = B.
        if reflected_to_b > 0.0
            && (!ctx.attacker.user_ability_ids.is_empty()
                || !ctx.defender.user_ability_ids.is_empty())
        {
            let final_reflect = user_dispatch::run_pre_damage_hooks(
                ctx.a, ctx.b, eff_a, eff_b, ctx.time,
                reflected_to_b, reflected_to_b, "reflect",
                ctx.combat_log, ctx.record_trace, "A", "B",
            );
            if (final_reflect - reflected_to_b).abs() > 1e-9 {
                ctx.b.hp = (ctx.b.hp + reflected_to_b - final_reflect).max(0.0);
                reflected_to_b = final_reflect;
            }
        }
        if ctx.record_trace && reflected_to_b > 0.0 {
            ctx.combat_log.push(crate::contracts::CombatLogEntry {
                time: ctx.time,
                entry_type: "ability".to_string(),
                attacker: "A".to_string(),
                damage: reflected_to_b,
                healing: None,
                actor_hp_after: ctx.a.hp.max(0.0),
                hp_side: "B".to_string(),
                hp_after: ctx.b.hp.max(0.0),
                description: Some("Reflect (bite)".to_string()),
                detail: None,
                status_id: None,
            });
        }
        let applied_melee_damage_b = (hp_a_before_melee - ctx.a.hp).max(0.0);
        // Round 45 / B4: counters on the symmetric path.
        super::bump_combat_counter(&mut ctx.b.user_extras, "combat.bites_dealt", 1.0);
        super::bump_combat_counter(&mut ctx.a.user_extras, "combat.bites_taken", 1.0);
        super::bump_combat_counter(&mut ctx.b.user_extras, "combat.damage_dealt_total", applied_melee_damage_b);
        super::bump_combat_counter(&mut ctx.a.user_extras, "combat.damage_taken_total", applied_melee_damage_b);
        super::push_damage_window(&mut ctx.b.recent_damage_dealt, ctx.time, applied_melee_damage_b);
        super::push_damage_window(&mut ctx.a.recent_damage_taken, ctx.time, applied_melee_damage_b);
        if applied_melee_damage_b > 0.0 {
            ctx.b.last_melee_hit_at = ctx.time;
            ctx.b.last_melee_hit_damage = applied_melee_damage_b;
        }
        if ctx.record_trace && applied_melee_damage_b > 0.0 {
            // P3 mirror — variant-aware label, same rules as A's bite.
            let bite_description = if bite_variant_b
                == crate::policy::decisions::bite_variant::SECONDARY_VARIANT
            {
                "Secondary bite hit"
            } else {
                "Bite hit"
            };
            ctx.combat_log.push(crate::contracts::CombatLogEntry {
                time: ctx.time,
                entry_type: "bite".to_string(),
                attacker: "B".to_string(),
                damage: applied_melee_damage_b,
                healing: None,
                actor_hp_after: ctx.b.hp.max(0.0),
                hp_side: "A".to_string(),
                hp_after: ctx.a.hp.max(0.0),
                description: Some(bite_description.to_string()),
                detail: None,
                status_id: None,
            });
        }
        // P3 mirror — skip on-hit ailments on B's secondary bite.
        if bite_variant_b != crate::policy::decisions::bite_variant::SECONDARY_VARIANT {
            let on_hit_b: Vec<SimpleAppliedStatus> = if spite_status_mult_b > 1.0 {
                ctx.defender.on_hit_statuses.iter().map(|s| SimpleAppliedStatus {
                    status_id: s.status_id.clone(),
                    stacks: s.stacks * spite_status_mult_b,
                    source_ability: None,
                }).collect()
            } else {
                ctx.defender.on_hit_statuses.clone()
            };
            let scaled_on_hit_b = scale_direct_attack_offensive_ailment_statuses(
                &on_hit_b,
                ctx.defender,
                ctx.attacker,
                &ctx.b.statuses,
                &ctx.a.statuses,
            );
            apply_statuses_with_per_effect_trace(
                ctx.time,
                eff_a,
                ctx.a.hp,
                &mut ctx.a.statuses,
                &scaled_on_hit_b,
                ctx.a.fortify_immune_until,
                "B",
                ctx.b.hp,
                "A",
                "Bite",
                if ctx.record_trace { Some(ctx.combat_log) } else { None },
            );
        }
        if ctx.config.defender_power_charge && !ctx.b.first_melee_hit_taken {
            let extra = vec![SimpleAppliedStatus {
                status_id: "Shredded_Wings".to_string(),
                stacks: 2.0,
                source_ability: None,
            }];
            apply_incoming_statuses_to_target_with_fortify_immunity(
                ctx.time, eff_a, ctx.a.hp, &mut ctx.a.statuses, &extra, ctx.a.fortify_immune_until,
            );
            record_ability_event(ctx.b, "B", ctx.combat_log, ctx.record_trace, ctx.time, "Power Charge");
        }
        if ctx.config.defender_gore_charge && !ctx.b.first_melee_hit_taken {
            let extra = vec![
                SimpleAppliedStatus { status_id: "Bleed_Status".to_string(), stacks: 2.0, source_ability: None },
                SimpleAppliedStatus { status_id: "Deep_Wounds_Status".to_string(), stacks: 10.0, source_ability: None },
            ];
            apply_incoming_statuses_to_target_with_fortify_immunity(
                ctx.time, eff_a, ctx.a.hp, &mut ctx.a.statuses, &extra, ctx.a.fortify_immune_until,
            );
            record_ability_event(ctx.b, "B", ctx.combat_log, ctx.record_trace, ctx.time, "Gore Charge");
        }
        ctx.b.first_melee_hit_taken = true;
        if ctx.b.divination_charges_left > 0 {
            let divination_burn = vec![SimpleAppliedStatus {
                status_id: "Burn_Status".to_string(),
                stacks: 2.0,
                source_ability: None,
            }];
            apply_incoming_statuses_to_target_with_fortify_immunity(
                ctx.time,
                eff_a,
                ctx.a.hp,
                &mut ctx.a.statuses,
                &divination_burn,
                ctx.a.fortify_immune_until,
            );
            ctx.b.divination_charges_left -= 1;
        }
        if ctx.config.attacker_toxic_trap && ctx.a.toxic_trap_bites_remaining > 0 {
            ctx.a.toxic_trap_bites_remaining -= 1;
            if ctx.a.toxic_trap_bites_remaining <= 0 {
                ctx.a.toxic_trap_next_tick_at = None;
            }
        }
        if ctx.config.defender_lich_mark {
            apply_lich_mark_on_melee_hit(
                ctx.b,
                ctx.a,
                ctx.config.defender_lich_mark_payload_status_id.as_deref(),
                ctx.time,
            );
        }
        apply_statuses_with_per_effect_trace(
            ctx.time,
            eff_b,
            ctx.b.hp,
            &mut ctx.b.statuses,
            &ctx.attacker.on_hit_taken_statuses,
            ctx.b.fortify_immune_until,
            "A",
            ctx.a.hp,
            "B",
            "Defensive",
            if ctx.record_trace { Some(ctx.combat_log) } else { None },
        );
        if ctx.b.spite_armed {
            ctx.b.spite_armed = false;
            ctx.b.spite_charge_ready_at = 0.0;
            record_ability_event(ctx.b, "B", ctx.combat_log, ctx.record_trace, ctx.time, "Spite");
        }
        if expunge_fires_b {
            ctx.a.statuses.remove("Bleed_Status");
            // P3: same variant-aware heal as the eligibility check above.
            let heal_amount = EXPUNGE_HEAL_FRACTION_OF_BONUS
                * bite_eff_b.damage
                * EXPUNGE_DAMAGE_PER_STACK
                * bleed_on_a;
            let hp_before_expunge_heal = ctx.b.hp;
            ctx.b.hp = (ctx.b.hp + heal_amount).min(ctx.defender.health);
            let healed = (ctx.b.hp - hp_before_expunge_heal).max(0.0);
            ctx.b.expunge_cooldown_until = ctx.time + scale_active_cooldown(ctx.defender, EXPUNGE_COOLDOWN_SEC);
            record_ability_event(ctx.b, "B", ctx.combat_log, ctx.record_trace, ctx.time, "Expunge");
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
                    description: Some("Expunge heal".to_string()),
                    detail: None,
                    status_id: None,
                });
            }
        }
        if ctx.config.defender_life_leech_value > 0.0 && applied_melee_damage_b > 0.0
            && !is_external_healing_blocked(&ctx.b.statuses)
        {
            let hp_before_leech = ctx.b.hp;
            let leech = simulate_simple_life_leech_hit(
                ctx.time, ctx.defender, ctx.b.hp, applied_melee_damage_b, true,
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
        ctx.b.next_hit =
            ctx.time + current_simple_bite_cooldown_with_statuses(eff_b, ctx.b.hp, &ctx.b.statuses);
        // Death commit deferred to Phase 16.
    }
}
