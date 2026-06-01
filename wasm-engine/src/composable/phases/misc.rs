//! Miscellaneous phase functions: Self-Destruct passive (Phase 7) and
//! Lance aura ticks (Phase 9). Extracted from `phases/mod.rs`.

#![allow(clippy::too_many_arguments)]

use super::super::*;

/// Phase 7: Self-Destruct passive. Runs every iter regardless of the
/// user-configurable phase order — Self-Destruct's arming reacts to HP,
/// not to selected_phase. It is a passive ability (see
/// `docs/adding-an-ability.md` for the passive-vs-active rule), which is
/// why this is gated only on `has_any_self_destruct`, never on
/// `OrderedEventPhase`.
///
/// Reworked 2026-04-21: HP ≤ 15% arms a 3-stack status that decays
/// standard (1 stack / 3s) → 9s fuse. Explosion fires on stacks-to-0
/// (natural decay OR cleanse).
pub(in super::super) fn process_phase_7_self_destruct_passive(
    ctx: &mut PhaseContext<'_, '_>,
    has_any_self_destruct: bool,
) {
    if !has_any_self_destruct {
        return;
    }
    if let Some(profile) = &ctx.attacker.self_destruct_profile {
        let event = update_simple_self_destruct_state(
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
        match event {
            SelfDestructEvent::Armed => {
                record_ability_event(ctx.a, "A", ctx.combat_log, ctx.record_trace, ctx.time, "Self-Destruct armed");
            }
            SelfDestructEvent::Exploded => {
                record_ability_event(ctx.a, "A", ctx.combat_log, ctx.record_trace, ctx.time, "Self-Destruct");
            }
            SelfDestructEvent::None => {}
        }
    }
    if let Some(profile) = &ctx.defender.self_destruct_profile {
        let event = update_simple_self_destruct_state(
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
        match event {
            SelfDestructEvent::Armed => {
                record_ability_event(ctx.b, "B", ctx.combat_log, ctx.record_trace, ctx.time, "Self-Destruct armed");
            }
            SelfDestructEvent::Exploded => {
                record_ability_event(ctx.b, "B", ctx.combat_log, ctx.record_trace, ctx.time, "Self-Destruct");
            }
            SelfDestructEvent::None => {}
        }
    }
}

/// Phase 9: Lance aura ticks. Each side's active Lance ability damages
/// the opposing creature for 1% of its max HP per tick (1s cadence) until
/// the aura window expires. Lance optionally applies its breath-bound
/// status (`SimpleBreathProfile::lance_status_id`) at each tick, gated by
/// the target's fortify immunity.
pub(in super::super) fn process_phase_9_lance_aura(
    ctx: &mut PhaseContext<'_, '_>,
    eff_a: &SimpleCombatantStats,
    eff_b: &SimpleCombatantStats,
    counters: &mut DamageCounters,
) {
    if let Some(next_tick) = ctx.a.lance_aura_next_tick_at {
        if next_tick <= ctx.a.lance_aura_until && (next_tick - ctx.time).abs() <= 1e-9 {
            let aura_damage = ctx.defender.health * 0.01;
            let applied_damage =
                apply_unbreakable_damage_cap(aura_damage, ctx.defender).min(ctx.b.hp.max(0.0));
            // G3: route the lance-aura tick through the pre-damage hook.
            let applied_damage = user_dispatch::run_pre_damage_hooks(
                ctx.a, ctx.b, eff_a, eff_b, ctx.time,
                applied_damage, applied_damage, "lance_aura",
                ctx.combat_log, ctx.record_trace, "A", "B",
            );
            ctx.b.hp -= applied_damage;
            counters.dealt_a += applied_damage;
            if let Some(status_id) =
                ctx.attacker_breath.and_then(|breath| breath.lance_status_id.as_ref())
            {
                apply_incoming_statuses_to_target_with_fortify_immunity(
                    ctx.time,
                    eff_b,
                    ctx.b.hp,
                    &mut ctx.b.statuses,
                    &[SimpleAppliedStatus {
                        status_id: status_id.clone(),
                        stacks: 1.0,
                        source_ability: None,
                    }],
                    ctx.b.fortify_immune_until,
                );
            }
            ctx.a.lance_aura_next_tick_at = Some(ctx.time + 1.0);
            if ctx.a.lance_aura_next_tick_at.is_some_and(|tick| tick > ctx.a.lance_aura_until) {
                ctx.a.lance_aura_next_tick_at = None;
            }
        }
    }
    if let Some(next_tick) = ctx.b.lance_aura_next_tick_at {
        if next_tick <= ctx.b.lance_aura_until && (next_tick - ctx.time).abs() <= 1e-9 {
            let aura_damage = ctx.attacker.health * 0.01;
            let applied_damage =
                apply_unbreakable_damage_cap(aura_damage, ctx.attacker).min(ctx.a.hp.max(0.0));
            // G3: route the lance-aura tick through the pre-damage hook.
            let applied_damage = user_dispatch::run_pre_damage_hooks(
                ctx.b, ctx.a, eff_b, eff_a, ctx.time,
                applied_damage, applied_damage, "lance_aura",
                ctx.combat_log, ctx.record_trace, "B", "A",
            );
            ctx.a.hp -= applied_damage;
            counters.dealt_b += applied_damage;
            if let Some(status_id) =
                ctx.defender_breath.and_then(|breath| breath.lance_status_id.as_ref())
            {
                apply_incoming_statuses_to_target_with_fortify_immunity(
                    ctx.time,
                    eff_a,
                    ctx.a.hp,
                    &mut ctx.a.statuses,
                    &[SimpleAppliedStatus {
                        status_id: status_id.clone(),
                        stacks: 1.0,
                        source_ability: None,
                    }],
                    ctx.a.fortify_immune_until,
                );
            }
            ctx.b.lance_aura_next_tick_at = Some(ctx.time + 1.0);
            if ctx.b.lance_aura_next_tick_at.is_some_and(|tick| tick > ctx.b.lance_aura_until) {
                ctx.b.lance_aura_next_tick_at = None;
            }
        }
    }
}
