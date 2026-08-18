//! Melee phase functions: Phases 10+11 (bite A and bite B).
//! Extracted from `phases/mod.rs`.

#![allow(clippy::too_many_arguments)]

use super::super::*;

/// Phases 10+11: Melee hit A and Melee hit B, with the symmetric
/// pre-Phase-10/11 Cocoon-Ph2-target-invincibility checks for both
/// sides. Each side: when `next_hit` is due, compute the raw bite
/// damage, layer the per-side multipliers (Hunters Curse x Unbridled
/// Rage x Warden's Rage x Adrenaline x Spite x Power Charge x Cocoon
/// Rage x Expunge), apply hunker reductions on owner and target, route
/// through Reflect, log,
/// apply on-hit / on-hit-taken statuses, run Power-Charge / Gore-Charge
/// first-hit bonuses, run Divination burn ticks, decrement Toxic Trap
/// durability, fire Lich Mark, consume Spite, run Expunge post-bite,
/// and life-leech-heal the bite damage.
///
/// Death commit is deferred to Phase 16 - same-tick breath / heal can
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
    // "fall through to config-driven mode resolution" - used by
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
    // Cocoon Ph2 caster lock-out: if A's bite is due and A is itself in Ph2,
    // reschedule A's own bite to A's Ph2 end. Phase 1 does not lock the user.
    // Mirrors the opponent reschedule above but reads A's own cocoon window.
    if (ctx.a.next_hit - ctx.time).abs() <= 1e-9 && ctx.a.in_cocoon_phase_2(ctx.time) {
        ctx.a.next_hit = ctx.a.cocoon_phase2_until;
    }
    // Reflect response: a side set to hold does not bite while the opponent's
    // Reflect is active. Reflect is visible in game, so a player can make the
    // same decision. The bite is not lost: `next_hit` is set to
    // `reflect_active_until`, so the bite lands when Reflect ends.
    if ctx.a.reflect_response_hold
        && (ctx.a.next_hit - ctx.time).abs() <= 1e-9
        && ctx.b.reflect_active_until > ctx.time
    {
        ctx.a.next_hit = ctx.b.reflect_active_until;
    }
    if ctx.b.reflect_response_hold
        && (ctx.b.next_hit - ctx.time).abs() <= 1e-9
        && ctx.a.reflect_active_until > ctx.time
    {
        ctx.b.next_hit = ctx.a.reflect_active_until;
    }
    // Posture gate: A cannot bite while settled in Sitting / Laying.
    // The transition window does NOT block (matches the multiplier
    // gate - actions stay free until the posture is fully settled).
    // We push next_hit forward by one bite cooldown so the scheduler
    // makes progress; when the policy stands A back up, the next bite
    // fires after the rescheduled cooldown elapses.
    if (ctx.a.next_hit - ctx.time).abs() <= 1e-9 && ctx.a.posture_settled_non_standing() {
        ctx.a.next_hit = ctx.time
            + current_simple_bite_cooldown_with_statuses(eff_a, ctx.a.hp, &ctx.a.statuses);
    }
    // Dodge Chance: if B dodges, A's bite lands nothing - no damage, no on-hit
    // statuses, no life leech - and A's cadence advances one bite cooldown.
    // As with the posture skip above, `next_hit` is pushed forward so the
    // fires-check below does not match.
    if (ctx.a.next_hit - ctx.time).abs() <= 1e-9
        && !aerial_dodge_incoming_lands(ctx.defender, ctx.b, AerialDodgeChannel::Bite)
    {
        if ctx.record_trace {
            ctx.combat_log.push(crate::contracts::CombatLogEntry {
                time: ctx.time,
                entry_type: "dodge".to_string(),
                attacker: "A".to_string(),
                damage: 0.0,
                healing: None,
                actor_hp_after: ctx.a.hp.max(0.0),
                hp_side: "B".to_string(),
                hp_after: ctx.b.hp.max(0.0),
                description: Some("Dodged bite".to_string()),
                detail: None,
                status_id: None,
            });
        }
        ctx.a.next_hit = ctx.time
            + current_simple_bite_cooldown_with_statuses(eff_a, ctx.a.hp, &ctx.a.statuses);
    }
    // Head Start: while A stands inert under the defender's window, the
    // scheduler parks `a.next_hit` on the window boundary, so the bite below
    // never matches `time` until A resumes. Nothing to do in this phase.
    // Phase 10: Melee hit A
    if (ctx.a.next_hit - ctx.time).abs() <= 1e-9 {
        // Tag iter mask - A is dealing a bite this iter, B is taking bite
        // damage. The bit means: this iteration contained a bite event aimed
        // at B, whether or not damage landed. User gates read it with that
        // meaning.
        ctx.a.iter_damage_kinds_dealt |= crate::composable::side::DAMAGE_KIND_BITE;
        ctx.b.iter_damage_kinds_taken |= crate::composable::side::DAMAGE_KIND_BITE;
        if ctx.record_trace {
            *bite_count_a += 1;
        }
        // Bite variant decision (primary vs. secondary).
        //
        // `bite_eff_a` is an effective stats *view* for THIS bite -
        // identical to `eff_a` on primary, `eff_a` with damage swapped
        // for `damage2` on secondary. On-hit offensive ailments are
        // suppressed entirely on secondary; the gate is the
        // `bite_variant_a != SECONDARY_VARIANT` check on the status-apply
        // block below.
        //
        // Bite cadence (`next_hit`) is variant-independent: primary and
        // secondary read and write the same cooldown timer.
        let bite_variant_a = if let Some(v) = pre_resolved_variant_a {
            // Engine-replay already picked this variant for this bite
            // event; honor the secondary->primary fallback if damage2
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
        // multipliers and stack: a side with both active multiplies by
        // 2.0 x 1.3, not by whichever is larger. The sequential `if`s below
        // are what makes that true - an `else if` would drop one.
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
        // Cocoon Rage (+15% damage) only applies in Phase 3 - after the Ph2->Ph3
        // transition resets the phase timers to 0. The Cocoon_Damage_Status is
        // seeded at activation (Ph1), so gate on the phase window, not just the
        // stack count, or Ph1 bites would wrongly get the buff (side.rs: "Ph3
        // (after cocoon_phase2_until) +15% damage"). In Ph3 phase2_until == 0,
        // so `time >= phase2_until` holds; during Ph1/Ph2 it does not.
        let cocoon_damage_mult_a = if ctx.a.statuses.get("Cocoon_Damage_Status").map(|s| s.stacks).unwrap_or(0.0) > 0.0
            && ctx.time >= ctx.a.cocoon_phase2_until
        {
            1.15
        } else {
            1.0
        };
        // Expunge (default modeled, ideal policy): fires only when it
        // produces unambiguous net benefit - kill secure or heal save.
        let bleed_on_b = ctx.b.statuses.get("Bleed_Status").map(|s| s.stacks).unwrap_or(0.0);
        let expunge_cd_ready = ctx.time >= ctx.a.expunge_cooldown_until;
        let expunge_eligible = ctx.config.attacker_expunge && expunge_cd_ready && bleed_on_b >= 1.0;
        let expunge_mult_value = 1.0 + EXPUNGE_DAMAGE_PER_STACK * bleed_on_b;

        let (kill_secure_a, heal_save_a) = if expunge_eligible {
            // Use the variant-effective stats so secondary's lower
            // damage feeds both Expunge's kill-secure math and the heal
            // (which scales with the landed normal bite, so the variant's
            // weight-scaled damage flows through naturally).
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
            // multiplier that would actually land - otherwise Expunge
            // refuses a guaranteed kill on a laying target.
            let posture_mult_on_b = ctx.b.posture_incoming_damage_mult();
            // Divination's flat +50 is not scaled by posture: the game applies
            // the sit/lay multiplier before this flat bonus is added. Keep it
            // outside the posture multiply.
            let normal_final = apply_hunker_to_incoming(
                apply_hunker_to_damage(
                    raw_melee_a * common_mult_a * posture_mult_on_b,
                    hunker_active_a,
                ) + divination_flat_a,
                eff_b.hunker_reduction_pct,
                hunker_active_b,
            );
            let bonus_final = apply_hunker_to_incoming(
                apply_hunker_to_damage(
                    raw_melee_a * common_mult_a * expunge_mult_value * posture_mult_on_b,
                    hunker_active_a,
                ) + divination_flat_a,
                eff_b.hunker_reduction_pct,
                hunker_active_b,
            );
            let kill_secure = normal_final < ctx.b.hp && bonus_final >= ctx.b.hp;

            // Expunge heals for half the extra damage it deals: in game the
            // heal is `EXPUNGE_HEAL_FRACTION_OF_BONUS x
            // EXPUNGE_DAMAGE_PER_STACK x bleed_stacks x base`, where `base` is
            // the normal bite after weight scaling, posture and mitigation and
            // before the attacker's own on-attack bonuses. That is the same
            // value as the reflect base: Spite, Power Charge and Divination are
            // on-attack bonuses and are excluded from both. Compute it here for
            // the heal-save projection; it equals `reflect_base_a` used at the
            // actual heal.
            let heal_base_a = apply_hunker_to_incoming(
                apply_hunker_to_damage(
                    raw_melee_a
                        * melee_multiplier_a
                        * warden_rage_mult_a
                        * adrenaline_mult_a
                        * cocoon_damage_mult_a
                        * posture_mult_on_b,
                    hunker_active_a,
                ),
                eff_b.hunker_reduction_pct,
                hunker_active_b,
            );
            let heal_amount = EXPUNGE_HEAL_FRACTION_OF_BONUS
                * heal_base_a
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
        // Keep the pre-mitigation amount so the
        // `on_before_take_damage` / `on_before_deal_damage` hooks can
        // surface it as `event.raw_damage`.
        //
        // Pass `bite_eff_a` (variant-effective) so secondary's
        // damage2 is honored - primary path is unchanged because
        // `bite_eff_a == eff_a` then.
        let melee_base_a = compute_melee_damage_per_hit_with_actor_and_target_statuses(
            bite_eff_a,
            eff_b,
            ctx.a.hp,
            &ctx.a.statuses,
            &ctx.b.statuses,
        );
        // Divination's flat bonus is added at the end of the attacker's own
        // chain, after Hunker has halved its damage stat - Hunker reduces the
        // stat and not the bite total, so the flat bonus is not halved. The
        // defender's Hunker is applied to the total below.
        let raw_bite_damage_a = apply_hunker_to_damage(
            (melee_base_a
                * melee_multiplier_a
                * warden_rage_mult_a
                * adrenaline_mult_a
                * spite_mult_a
                * power_charge_mult_a
                * cocoon_damage_mult_a
                * expunge_mult_a)
                * ctx.b.posture_incoming_damage_mult(),
            hunker_active_a,
        ) + divination_flat_a;
        // The value the game reflects: the weight-scaled base carrying the
        // stat-level buffs and debuffs only. Spite, Expunge, Divination and
        // Power Charge are applied to the attacker's hit after Reflect has
        // taken its share, so none of them is reflected. Same Hunker order as
        // `damage_a`.
        let raw_reflect_base_a = (melee_base_a
            * melee_multiplier_a
            * warden_rage_mult_a
            * adrenaline_mult_a
            * cocoon_damage_mult_a)
            * ctx.b.posture_incoming_damage_mult();
        // `raw_bite_damage_a` already carries the attacker's own Hunker.
        let mut damage_a = apply_hunker_to_incoming(
            raw_bite_damage_a,
            eff_b.hunker_reduction_pct,
            hunker_active_b,
        );
        let reflect_base_a = apply_hunker_to_incoming(
            apply_hunker_to_damage(raw_reflect_base_a, hunker_active_a),
            eff_b.hunker_reduction_pct,
            hunker_active_b,
        );
        // Accumulate raw (pre-mitigation) for the
        // post-damage event extras.
        ctx.a.iter_raw_damage_dealt += raw_bite_damage_a.max(0.0);
        ctx.b.iter_raw_damage_taken += raw_bite_damage_a.max(0.0);
        // Pre-damage hooks (dealer = A, victim = B).
        // Hooks see raw_damage and the engine's post-mitigation
        // amount; either may write `damage_override` to replace.
        if damage_a > 0.0 {
            damage_a = damage_pipeline::resolve_incoming_damage(
                ctx.a, ctx.b, ctx.attacker, ctx.defender, ctx.time,
                raw_bite_damage_a, damage_a, "bite",
                ctx.combat_log, ctx.record_trace, "A", "B",
            );
        }
        let hp_b_before_melee = ctx.b.hp;
        let mut reflected_to_a = apply_direct_damage_with_reflect(
            damage_a,
            reflect_base_a,
            true,
            eff_a,
            eff_b,
            &mut ctx.a.hp,
            &mut ctx.b.hp,
            counters,
            hunker_active_b,
            true,
        );
        // Route the reflected self-damage (B reflects A's bite back at A)
        // through the pre-damage hook - dealer = B (reflector), victim = A.
        // Post-hoc: adjust A's hp by the override delta. Skipped when nothing
        // in the chain could move the number (byte-identical).
        if reflected_to_a > 0.0
            && damage_pipeline::chain_may_move_damage(&*ctx.a, ctx.attacker, ctx.defender)
        {
            let final_reflect = damage_pipeline::resolve_incoming_damage(
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
        // Cumulative bite + damage counters surfaced
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
        // Sliding-window logs.
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
        // Snapshot the pre-reflect bite (damage_a) and its reflect base so
        // Shadow Barrage routes each replayed hit through Reflect itself. A
        // bite that was fully reflected still arms the barrage, because in
        // game each barrage hit recomputes its damage from the attacker's
        // stats rather than reusing the first hit's result.
        if damage_a > 0.0 {
            ctx.a.last_melee_hit_at = ctx.time;
            ctx.a.last_melee_hit_damage = damage_a;
            ctx.a.last_melee_reflect_base = reflect_base_a;
        }
        if ctx.record_trace && applied_melee_damage_a > 0.0 {
            // Label the variant in the timeline. Primary keeps "Bite hit",
            // which the fixtures and the TS consumers filter on; secondary
            // uses "Secondary bite hit".
            let bite_description = if bite_variant_a
                == crate::policy::decisions::bite_variant::SECONDARY_VARIANT
            {
                "Secondary bite hit"
            } else {
                "Bite hit"
            };
            // Tag the bite that consumes an armed Spite charge so the timeline
            // shows where the charge was spent (the activation is logged once,
            // at arm time / t=0). `spite_armed` is still set here - the consume
            // site below clears it. Kept in `detail`, not `description`, so the
            // primary/secondary-bite parsing on the TS side is untouched.
            let bite_detail = if ctx.a.spite_armed {
                Some("Spite-charged".to_string())
            } else {
                None
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
                detail: bite_detail,
                status_id: None,
            });
        }
        // Skip on-hit offensive ailments when this bite is the secondary
        // attack: the secondary deals more damage and applies no offensive
        // status, which is the choice the bite-variant policy decides between.
        // Power Charge, Gore Charge and Divination below are Compare-side
        // bonus statuses rather than on-hit ailments, and still fire.
        if bite_variant_a != crate::policy::decisions::bite_variant::SECONDARY_VARIANT {
            // Spite doubles on-hit status stacks. Tag the source so the
            // doubled application logs as "Spite applied <X>" instead of
            // "Bite applied <X>" - the timeline then shows which statuses the
            // Spite bite buffed. Display-only: the apply path uses status_id +
            // stacks, never the source label, so the outcome is unchanged.
            let on_hit_a: Vec<SimpleAppliedStatus> = if spite_status_mult_a > 1.0 {
                ctx.attacker.on_hit_statuses.iter().map(|s| SimpleAppliedStatus {
                    status_id: s.status_id.clone(),
                    stacks: s.stacks * spite_status_mult_a,
                    source_ability: Some("Spite".to_string()),
                    ..Default::default()
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
                ..Default::default()
            }];
            apply_incoming_statuses_to_target_with_fortify_immunity(
                ctx.time, eff_b, ctx.b.hp, &mut ctx.b.statuses, &extra, ctx.b.fortify_immune_until,
            );
            record_ability_event(ctx.a, "A", ctx.combat_log, ctx.record_trace, ctx.time, "Power Charge");
        }
        if ctx.config.attacker_gore_charge && !ctx.a.first_melee_hit_taken {
            let extra = vec![
                SimpleAppliedStatus { status_id: "Bleed_Status".to_string(), stacks: 2.0, ..Default::default() },
                SimpleAppliedStatus { status_id: "Deep_Wounds_Status".to_string(), stacks: 9.0, ..Default::default() },
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
                ..Default::default()
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
            // No separate "Spite activated" event here - the activation is
            // logged once (Phase 4 arm, or t=0 for ready-at-start). This bite
            // and its buffed statuses are tagged as Spite-sourced instead.
        }
        if expunge_fires_a {
            ctx.b.statuses.remove("Bleed_Status");
            // Heal off the landed normal bite (game p4 = reflect base), same
            // base as the eligibility projection (== heal_base_a above).
            let heal_amount = EXPUNGE_HEAL_FRACTION_OF_BONUS
                * reflect_base_a
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
            // Feed the on_heal accumulator (dispatched in Phase 16).
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
    // Cocoon Ph2 caster lock-out (symmetric to A - B can't bite during own P2).
    if (ctx.b.next_hit - ctx.time).abs() <= 1e-9 && ctx.b.in_cocoon_phase_2(ctx.time) {
        ctx.b.next_hit = ctx.b.cocoon_phase2_until;
    }
    // Posture gate (symmetric to A - see comment above).
    if (ctx.b.next_hit - ctx.time).abs() <= 1e-9 && ctx.b.posture_settled_non_standing() {
        ctx.b.next_hit = ctx.time
            + current_simple_bite_cooldown_with_statuses(eff_b, ctx.b.hp, &ctx.b.statuses);
    }
    // Dodge Chance: symmetric to side A above - A (B's target) may dodge B's
    // bite, which then lands nothing while B's cadence advances one bite
    // cooldown.
    if (ctx.b.next_hit - ctx.time).abs() <= 1e-9
        && !aerial_dodge_incoming_lands(ctx.attacker, ctx.a, AerialDodgeChannel::Bite)
    {
        if ctx.record_trace {
            ctx.combat_log.push(crate::contracts::CombatLogEntry {
                time: ctx.time,
                entry_type: "dodge".to_string(),
                attacker: "B".to_string(),
                damage: 0.0,
                healing: None,
                actor_hp_after: ctx.b.hp.max(0.0),
                hp_side: "A".to_string(),
                hp_after: ctx.a.hp.max(0.0),
                description: Some("Dodged bite".to_string()),
                detail: None,
                status_id: None,
            });
        }
        ctx.b.next_hit = ctx.time
            + current_simple_bite_cooldown_with_statuses(eff_b, ctx.b.hp, &ctx.b.statuses);
    }
    // Head Start: B's inert-window bite timer is parked by the scheduler
    // (symmetric to A above).
    // Phase 11: Melee hit B
    if (ctx.b.next_hit - ctx.time).abs() <= 1e-9 {
        // Tag iter mask for the symmetric bite.
        ctx.b.iter_damage_kinds_dealt |= crate::composable::side::DAMAGE_KIND_BITE;
        ctx.a.iter_damage_kinds_taken |= crate::composable::side::DAMAGE_KIND_BITE;
        if ctx.record_trace {
            *bite_count_b += 1;
        }
        // Mirror of the A-bite variant decision (see Phase 10).
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
        // See the A-side note: Cocoon Rage is Phase-3-only.
        let cocoon_damage_mult_b = if ctx.b.statuses.get("Cocoon_Damage_Status").map(|s| s.stacks).unwrap_or(0.0) > 0.0
            && ctx.time >= ctx.b.cocoon_phase2_until
        {
            1.15
        } else {
            1.0
        };
        let bleed_on_a = ctx.a.statuses.get("Bleed_Status").map(|s| s.stacks).unwrap_or(0.0);
        let expunge_cd_ready_b = ctx.time >= ctx.b.expunge_cooldown_until;
        let expunge_eligible_b = ctx.config.defender_expunge && expunge_cd_ready_b && bleed_on_a >= 1.0;
        let expunge_mult_value_b = 1.0 + EXPUNGE_DAMAGE_PER_STACK * bleed_on_a;

        let (kill_secure_b, heal_save_b) = if expunge_eligible_b {
            // Variant-effective stats for B's bite Expunge check
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
            // Divination's flat +50 is not scaled by posture: the game applies
            // the sit/lay multiplier before this flat bonus is added (mirror of
            // the A side).
            let normal_final = apply_hunker_to_incoming(
                apply_hunker_to_damage(
                    raw_melee_b * common_mult_b * posture_mult_on_a,
                    hunker_active_b,
                ) + divination_flat_b,
                eff_a.hunker_reduction_pct,
                hunker_active_a,
            );
            let bonus_final = apply_hunker_to_incoming(
                apply_hunker_to_damage(
                    raw_melee_b * common_mult_b * expunge_mult_value_b * posture_mult_on_a,
                    hunker_active_b,
                ) + divination_flat_b,
                eff_a.hunker_reduction_pct,
                hunker_active_a,
            );
            let kill_secure = normal_final < ctx.a.hp && bonus_final >= ctx.a.hp;

            // Heal off the landed normal bite (game p4 = reflect base),
            // mirror of the A side; equals `reflect_base_b` used at the heal.
            let heal_base_b = apply_hunker_to_incoming(
                apply_hunker_to_damage(
                    raw_melee_b
                        * melee_multiplier_b
                        * warden_rage_mult_b
                        * adrenaline_mult_b
                        * cocoon_damage_mult_b
                        * posture_mult_on_a,
                    hunker_active_b,
                ),
                eff_a.hunker_reduction_pct,
                hunker_active_a,
            );
            let heal_amount = EXPUNGE_HEAL_FRACTION_OF_BONUS
                * heal_base_b
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
        // Same shape as the A-bites-B path above.
        // Variant-effective `bite_eff_b` so secondary's damage2
        // feeds raw_bite_damage_b.
        let melee_base_b = compute_melee_damage_per_hit_with_actor_and_target_statuses(
            bite_eff_b,
            eff_a,
            ctx.b.hp,
            &ctx.b.statuses,
            &ctx.a.statuses,
        );
        // Mirror of the A side: the attacker's own Hunker reduces its damage
        // stat and not the bite total, so Divination's flat bonus is added
        // after it and is not halved.
        let raw_bite_damage_b = apply_hunker_to_damage(
            (melee_base_b
                * melee_multiplier_b
                * warden_rage_mult_b
                * adrenaline_mult_b
                * spite_mult_b
                * power_charge_mult_b
                * cocoon_damage_mult_b
                * expunge_mult_b)
                * ctx.a.posture_incoming_damage_mult(),
            hunker_active_b,
        ) + divination_flat_b;
        // Mirror of the A-side: the game reflects the stat-level base only;
        // Spite, Expunge, Divination and Power Charge are excluded.
        let raw_reflect_base_b = (melee_base_b
            * melee_multiplier_b
            * warden_rage_mult_b
            * adrenaline_mult_b
            * cocoon_damage_mult_b)
            * ctx.a.posture_incoming_damage_mult();
        // `raw_bite_damage_b` already carries the attacker's own Hunker.
        let mut damage_b = apply_hunker_to_incoming(
            raw_bite_damage_b,
            eff_a.hunker_reduction_pct,
            hunker_active_a,
        );
        let reflect_base_b = apply_hunker_to_incoming(
            apply_hunker_to_damage(raw_reflect_base_b, hunker_active_b),
            eff_a.hunker_reduction_pct,
            hunker_active_a,
        );
        ctx.b.iter_raw_damage_dealt += raw_bite_damage_b.max(0.0);
        ctx.a.iter_raw_damage_taken += raw_bite_damage_b.max(0.0);
        if damage_b > 0.0 {
            damage_b = damage_pipeline::resolve_incoming_damage(
                ctx.b, ctx.a, ctx.defender, ctx.attacker, ctx.time,
                raw_bite_damage_b, damage_b, "bite",
                ctx.combat_log, ctx.record_trace, "B", "A",
            );
        }
        let hp_a_before_melee = ctx.a.hp;
        let mut reflected_to_b = apply_direct_damage_with_reflect(
            damage_b,
            reflect_base_b,
            false,
            eff_b,
            eff_a,
            &mut ctx.b.hp,
            &mut ctx.a.hp,
            counters,
            hunker_active_a,
            true,
        );
        // Route the reflected self-damage (A reflects B's bite back at B)
        // through the pre-damage hook - dealer = A (reflector), victim = B.
        if reflected_to_b > 0.0
            && damage_pipeline::chain_may_move_damage(&*ctx.b, ctx.attacker, ctx.defender)
        {
            let final_reflect = damage_pipeline::resolve_incoming_damage(
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
        // Counters on the symmetric path.
        super::bump_combat_counter(&mut ctx.b.user_extras, "combat.bites_dealt", 1.0);
        super::bump_combat_counter(&mut ctx.a.user_extras, "combat.bites_taken", 1.0);
        super::bump_combat_counter(&mut ctx.b.user_extras, "combat.damage_dealt_total", applied_melee_damage_b);
        super::bump_combat_counter(&mut ctx.a.user_extras, "combat.damage_taken_total", applied_melee_damage_b);
        super::push_damage_window(&mut ctx.b.recent_damage_dealt, ctx.time, applied_melee_damage_b);
        super::push_damage_window(&mut ctx.a.recent_damage_taken, ctx.time, applied_melee_damage_b);
        // Mirror of the A side: snapshot pre-reflect damage + reflect base.
        if damage_b > 0.0 {
            ctx.b.last_melee_hit_at = ctx.time;
            ctx.b.last_melee_hit_damage = damage_b;
            ctx.b.last_melee_reflect_base = reflect_base_b;
        }
        if ctx.record_trace && applied_melee_damage_b > 0.0 {
            // Mirror - variant-aware label, same rules as A's bite.
            let bite_description = if bite_variant_b
                == crate::policy::decisions::bite_variant::SECONDARY_VARIANT
            {
                "Secondary bite hit"
            } else {
                "Bite hit"
            };
            // Mirror of A: tag a Spite-consuming bite (still armed here).
            let bite_detail = if ctx.b.spite_armed {
                Some("Spite-charged".to_string())
            } else {
                None
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
                detail: bite_detail,
                status_id: None,
            });
        }
        // Mirror - skip on-hit ailments on B's secondary bite.
        if bite_variant_b != crate::policy::decisions::bite_variant::SECONDARY_VARIANT {
            // Mirror of A: tag Spite-doubled statuses as Spite-sourced (display
            // only - the apply path ignores the source label).
            let on_hit_b: Vec<SimpleAppliedStatus> = if spite_status_mult_b > 1.0 {
                ctx.defender.on_hit_statuses.iter().map(|s| SimpleAppliedStatus {
                    status_id: s.status_id.clone(),
                    stacks: s.stacks * spite_status_mult_b,
                    source_ability: Some("Spite".to_string()),
                    ..Default::default()
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
                ..Default::default()
            }];
            apply_incoming_statuses_to_target_with_fortify_immunity(
                ctx.time, eff_a, ctx.a.hp, &mut ctx.a.statuses, &extra, ctx.a.fortify_immune_until,
            );
            record_ability_event(ctx.b, "B", ctx.combat_log, ctx.record_trace, ctx.time, "Power Charge");
        }
        if ctx.config.defender_gore_charge && !ctx.b.first_melee_hit_taken {
            let extra = vec![
                SimpleAppliedStatus { status_id: "Bleed_Status".to_string(), stacks: 2.0, ..Default::default() },
                SimpleAppliedStatus { status_id: "Deep_Wounds_Status".to_string(), stacks: 9.0, ..Default::default() },
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
                ..Default::default()
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
            // Mirror of A: no consume event here - tagged bite + statuses above.
        }
        if expunge_fires_b {
            ctx.a.statuses.remove("Bleed_Status");
            // Heal off the landed normal bite (game p4 = reflect base), same
            // base as the eligibility projection (== heal_base_b above).
            let heal_amount = EXPUNGE_HEAL_FRACTION_OF_BONUS
                * reflect_base_b
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
            // Feed the on_heal accumulator (dispatched in Phase 16).
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
