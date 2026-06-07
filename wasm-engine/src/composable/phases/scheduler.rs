//! Scheduler phase functions: Phase 1 (event scheduler), Phase 2 pre-step,
//! Phase 3 activations (Fortify/Harden/Rewind), plus SchedulerPassiveFlags
//! and SchedulerStep types. Extracted from `phases/mod.rs`.

#![allow(clippy::too_many_arguments)]

use super::super::*;
use crate::composable::ability_metadata::ability_blocked_by_necropoison;

/// Bundle of `has_any_*` passive flags consumed by the Phase 1
/// scheduler. The scheduler reads these to know which subset of
/// ability-specific timers (`scheduled_active_time`, etc.) to fold
/// into `next_time`. Passing them as a single argument keeps the
/// scheduler signature manageable.
pub(in super::super) struct SchedulerPassiveFlags {
    pub(in super::super) has_any_thorn_trap: bool,
    pub(in super::super) has_any_toxic_trap: bool,
    pub(in super::super) has_any_frost_snare: bool,
    pub(in super::super) has_any_poison_area: bool,
    pub(in super::super) has_any_yolk_bomb: bool,
    pub(in super::super) has_any_divination: bool,
    pub(in super::super) has_any_aura: bool,
    pub(in super::super) has_any_healing_step: bool,
    pub(in super::super) has_any_healing_pulse: bool,
    pub(in super::super) has_any_damage_trail: bool,
    pub(in super::super) has_any_active_ability: bool,
    pub(in super::super) has_any_fortify: bool,
}

/// Result of one scheduler step. Encodes the three control-flow
/// exits the original inline body had (two `break`s and one
/// `continue`) plus the normal "proceed with the selected phase"
/// path. The driver's outer loop matches on this.
pub(in super::super) enum SchedulerStep {
    /// Break the outer loop (ran out of finite next_time, exceeded
    /// `max_time_sec`, or saw `next_time < time - EVENT_TIME_EPS`
    /// which signals scheduler drift past the current tick).
    Break,
    /// Skip the rest of this loop iteration (no phase was due).
    ContinueLoop,
    /// Proceed to the phase dispatch with this phase selected.
    Proceed { selected_phase: OrderedEventPhase },
}

/// Phase 2 + 2b: Pre-step state - dead-side HP pin (corpse stays at 1.0 HP
/// regardless of damage/heal that landed last tick) followed by Compare-only
/// appetite drain (hunger rule). Both run unconditionally every iter, before
/// any selected_phase gate fires.
pub(in super::super) fn process_phase_2_pre_step(ctx: &mut PhaseContext<'_, '_>) {
    if ctx.a.death_time.is_some() {
        ctx.a.hp = 1.0;
    }
    if ctx.b.death_time.is_some() {
        ctx.b.hp = 1.0;
    }
    advance_side_hunger(ctx.a, ctx.time);
    advance_side_hunger(ctx.b, ctx.time);
}

/// Phase 3b + 3b2 + 3c: Fortify, Harden, and Rewind activations -
/// the ActiveAbilities-gated portion of the status family.
///
/// Phase 3b routes Fortify activation through the unified policy
/// decision engine (`crate::policy::`); the old composable branch
/// search is replaced by light projection here. Phase 3b2 fires
/// Harden when its cooldown / active windows allow. Phase 3c routes
/// Rewind activation through the policy engine with snapshot deltas
/// pre-computed by the bridge. All three are gated on
/// `is_actives_disabled_by_necro` and `cocoon_phase2_until`.
pub(in super::super) fn process_phase_3_activations(
    ctx: &mut PhaseContext<'_, '_>,
    has_any_rewind: bool,
    ability_policy: SimpleAbilityTimingMode,
    fortify_control: &mut FortifySimulationControl,
) {
    // Posture gate: every `if ctx.config.<side>_<ability> && !ctx.<side>
    // .posture_settled_non_standing() && …` below skips NEW activations
    // while the side is fully settled in Sit / Lay. Transition window
    // does NOT block - matches the multiplier predicate (Phase 1).
    // Pre-existing active states (e.g. Adrenaline still in its
    // duration window) keep ticking through duration handlers outside
    // this phase, so they survive a lay-down mid-rotation.
    //
    // Phase 3b: Fortify activation.
    if ctx.config.attacker_fortify && !ctx.a.posture_settled_non_standing() && !ability_blocked_by_necropoison("Fortify", &ctx.a.statuses) && !ctx.a.in_cocoon_phase_2(ctx.time) {
        let policy_fortify = resolve_ability_policy(ability_policy, ctx.config.attacker_ability_policy_overrides.fortify);
        let forced_now = fortify_control
            .attacker_forced_fortify_at
            .map(|target| ctx.time + 1e-9 >= target)
            .unwrap_or(false);
        let activate = forced_now
            || {
                let self_side = policy_bridge::build_policy_side(&*ctx.a, ctx.attacker, ctx.attacker_breath, std::iter::empty());
                let opp_side = policy_bridge::build_policy_side(&*ctx.b, ctx.defender, ctx.defender_breath, std::iter::empty());
                let mode = policy_bridge::map_timing_mode(policy_fortify);
                policy_bridge::should_activate_now(
                    crate::policy::decisions::fortify::FORTIFY_DECISION_ID,
                    self_side, opp_side, ctx.time, mode,
                )
            };
        if activate {
            let applied = apply_simple_fortify(
                ctx.time,
                ctx.attacker,
                &mut ctx.a.statuses,
                &mut ctx.a.fortify_cooldown_until,
                &mut ctx.a.fortify_immune_until,
                &mut ctx.a.fortify_weight_bonus_until,
            );
            if applied {
                ctx.a.fortify_planned_at = 0.0;
                fortify_control.attacker_forced_fortify_at = None;
                record_ability_event(ctx.a, "A", ctx.combat_log, ctx.record_trace, ctx.time, "Fortify");
            }
        }
    }
    if ctx.config.defender_fortify && !ctx.b.posture_settled_non_standing() && !ability_blocked_by_necropoison("Fortify", &ctx.b.statuses) && !ctx.b.in_cocoon_phase_2(ctx.time) {
        let policy_fortify = resolve_ability_policy(ability_policy, ctx.config.defender_ability_policy_overrides.fortify);
        let forced_now = fortify_control
            .defender_forced_fortify_at
            .map(|target| ctx.time + 1e-9 >= target)
            .unwrap_or(false);
        let activate = forced_now
            || {
                let self_side = policy_bridge::build_policy_side(&*ctx.b, ctx.defender, ctx.defender_breath, std::iter::empty());
                let opp_side = policy_bridge::build_policy_side(&*ctx.a, ctx.attacker, ctx.attacker_breath, std::iter::empty());
                let mode = policy_bridge::map_timing_mode(policy_fortify);
                policy_bridge::should_activate_now(
                    crate::policy::decisions::fortify::FORTIFY_DECISION_ID,
                    self_side, opp_side, ctx.time, mode,
                )
            };
        if activate {
            let applied = apply_simple_fortify(
                ctx.time,
                ctx.defender,
                &mut ctx.b.statuses,
                &mut ctx.b.fortify_cooldown_until,
                &mut ctx.b.fortify_immune_until,
                &mut ctx.b.fortify_weight_bonus_until,
            );
            if applied {
                ctx.b.fortify_planned_at = 0.0;
                fortify_control.defender_forced_fortify_at = None;
                record_ability_event(ctx.b, "B", ctx.combat_log, ctx.record_trace, ctx.time, "Fortify");
            }
        }
    }

    // Phase 3b2: Harden activation
    if ctx.config.attacker_harden && !ctx.a.posture_settled_non_standing()
        && !ability_blocked_by_necropoison("Harden", &ctx.a.statuses) && !ctx.a.in_cocoon_phase_2(ctx.time)
        && ctx.time >= ctx.a.harden_cooldown_until
        && ctx.time >= ctx.a.harden_active_until
    {
        ctx.a.harden_active_until = ctx.time + 30.0;
        ctx.a.harden_cooldown_until = ctx.time + scale_active_cooldown(ctx.attacker, 120.0);
        record_ability_event(ctx.a, "A", ctx.combat_log, ctx.record_trace, ctx.time, "Harden");
    }
    if ctx.config.defender_harden && !ctx.b.posture_settled_non_standing()
        && !ability_blocked_by_necropoison("Harden", &ctx.b.statuses) && !ctx.b.in_cocoon_phase_2(ctx.time)
        && ctx.time >= ctx.b.harden_cooldown_until
        && ctx.time >= ctx.b.harden_active_until
    {
        ctx.b.harden_active_until = ctx.time + 30.0;
        ctx.b.harden_cooldown_until = ctx.time + scale_active_cooldown(ctx.defender, 120.0);
        record_ability_event(ctx.b, "B", ctx.combat_log, ctx.record_trace, ctx.time, "Harden");
    }

    // Phase 3c: Rewind activation.
    if has_any_rewind {
        if ctx.config.attacker_rewind
            && !ability_blocked_by_necropoison("Rewind", &ctx.a.statuses)
            && !ctx.a.in_cocoon_phase_2(ctx.time)
            && ctx.time >= ctx.a.rewind_cooldown_until
        {
            if let Some((restored_hp_delta, status_delta)) =
                rewind_snapshot_deltas(ctx.time, ctx.attacker, ctx.a.hp, &ctx.a.statuses, &ctx.a.rewind_history)
            {
                let policy_rewind = resolve_ability_policy(
                    ability_policy,
                    ctx.config.attacker_ability_policy_overrides.rewind,
                );
                let self_side = policy_bridge::build_policy_side(
                    &*ctx.a, ctx.attacker, ctx.attacker_breath,
                    policy_bridge::rewind_extras(restored_hp_delta, status_delta),
                );
                let opp_side = policy_bridge::build_policy_side(&*ctx.b, ctx.defender, ctx.defender_breath, std::iter::empty());
                let mode = policy_bridge::map_timing_mode(policy_rewind);
                if policy_bridge::should_activate_now(
                    crate::policy::decisions::rewind::REWIND_DECISION_ID,
                    self_side, opp_side, ctx.time, mode,
                ) {
                    let applied = apply_rewind_restoration(
                        ctx.time,
                        ctx.attacker,
                        &mut ctx.a.hp,
                        &mut ctx.a.statuses,
                        &mut ctx.a.rewind_cooldown_until,
                        &ctx.a.rewind_history,
                    );
                    if applied {
                        record_ability_event(ctx.a, "A", ctx.combat_log, ctx.record_trace, ctx.time, "Rewind");
                    }
                }
            }
        }
        if ctx.config.defender_rewind
            && !ability_blocked_by_necropoison("Rewind", &ctx.b.statuses)
            && !ctx.b.in_cocoon_phase_2(ctx.time)
            && ctx.time >= ctx.b.rewind_cooldown_until
        {
            if let Some((restored_hp_delta, status_delta)) =
                rewind_snapshot_deltas(ctx.time, ctx.defender, ctx.b.hp, &ctx.b.statuses, &ctx.b.rewind_history)
            {
                let policy_rewind = resolve_ability_policy(
                    ability_policy,
                    ctx.config.defender_ability_policy_overrides.rewind,
                );
                let self_side = policy_bridge::build_policy_side(
                    &*ctx.b, ctx.defender, ctx.defender_breath,
                    policy_bridge::rewind_extras(restored_hp_delta, status_delta),
                );
                let opp_side = policy_bridge::build_policy_side(&*ctx.a, ctx.attacker, ctx.attacker_breath, std::iter::empty());
                let mode = policy_bridge::map_timing_mode(policy_rewind);
                if policy_bridge::should_activate_now(
                    crate::policy::decisions::rewind::REWIND_DECISION_ID,
                    self_side, opp_side, ctx.time, mode,
                ) {
                    let applied = apply_rewind_restoration(
                        ctx.time,
                        ctx.defender,
                        &mut ctx.b.hp,
                        &mut ctx.b.statuses,
                        &mut ctx.b.rewind_cooldown_until,
                        &ctx.b.rewind_history,
                    );
                    if applied {
                        record_ability_event(ctx.b, "B", ctx.combat_log, ctx.record_trace, ctx.time, "Rewind");
                    }
                }
            }
        }
    }
}

/// Phase 1: schedule the next event boundary, advance `time`, and
/// pick which `OrderedEventPhase` fires this iteration. Mutates
/// `time` and `same_time_processed_phases` in place. Calls
/// `sync_conditional_passive_events` on both sides when time
/// actually advances (skipped on the first tick at time = 0 to keep
/// the initial-tick guard).
#[allow(clippy::too_many_arguments)]
pub(in super::super) fn process_phase_1_scheduler<'state>(
    a: &mut CombatSide,
    b: &mut CombatSide,
    attacker: &'state SimpleCombatantStats,
    defender: &'state SimpleCombatantStats,
    config: &'state ComposableAbilityConfig,
    combat_log: &mut Vec<crate::contracts::CombatLogEntry>,
    record_trace: bool,
    time: &mut f64,
    same_time_processed_phases: &mut u32,
    event_phase_order: &[OrderedEventPhase],
    max_time_sec: f64,
    fortify_control: &FortifySimulationControl,
    flags: &SchedulerPassiveFlags,
    posture_snap_enabled: bool,
) -> SchedulerStep {
    // Posture-decision-as-event: include the next scheduled posture
    // decision in the scheduler's candidate min so state.time snaps
    // to the exact moment the policy was scheduled to fire. Paired
    // with the posture-only fallback below (which returns Proceed
    // with a no-op phase so the iter reaches the policy block
    // instead of micro-advancing).
    //
    // Without this snap, state.time progresses only to engine events
    // (bite / breath / regen ticks). A policy decision at t=10.0
    // might never see state.time hit 10.0 (events at 9.8 and 11.2),
    // so the closure fires late at the first iter ≥ scheduled.
    // The drift compounds across decisions and costs hundreds of HP
    // over a 30-second fight.
    // Snap state.time to posture decision moments so the policy fires
    // at the EXACT scheduled time, not at the first engine event ≥
    // scheduled. Gated on `posture_snap_enabled` so brute-force script
    // mode (which never advances `posture_next_decision_at`) doesn't
    // lock state.time at 0.
    let posture_next_a = if posture_snap_enabled && config.attacker_posture_policy_enabled {
        a.posture_next_decision_at
    } else {
        f64::INFINITY
    };
    let posture_next_b = if posture_snap_enabled && config.defender_posture_policy_enabled {
        b.posture_next_decision_at
    } else {
        f64::INFINITY
    };
    let mut next_time = a.next_hit
        .min(b.next_hit)
        .min(a.next_breath)
        .min(b.next_breath)
        .min(a.next_regen)
        .min(b.next_regen)
        .min(a.next_self_destruct_event())
        .min(b.next_self_destruct_event())
        .min(a.next_status_tick())
        .min(b.next_status_tick())
        .min(a.next_status_decay(*time))
        .min(b.next_status_decay(*time))
        .min(a.next_lance_aura_tick())
        .min(b.next_lance_aura_tick())
        .min(posture_next_a)
        .min(posture_next_b);
    // Every candidate below contributes to `next_time` only when the
    // ActiveAbilities phase is going to be processed this loop - i.e.
    // it's in the current `event_phase_order`. Sandbox Manual mode
    // filters ActiveAbilities OUT of the order; without this gate the
    // scheduler keeps proposing `next_time = 0` from
    // `setup.rs::a.next_toxic_trap = 0.0` (and similar zero-initialized
    // active-ability timers), the due-phase mask matches nothing
    // pickable, and the fallback `*time += 1µs` runs forever. That's
    // the "Venuella-vs-Venuella time stalls" bug. Status / Regen /
    // Decay candidates above stay outside this gate so they still get
    // their proper schedule even in Manual mode.
    let active_abilities_in_order =
        event_phase_order.contains(&OrderedEventPhase::ActiveAbilities);
    if active_abilities_in_order && flags.has_any_thorn_trap {
        next_time = next_time
            .min(scheduled_active_time(a.next_thorn_trap, &a.statuses, a.cocoon_phase1_until, a.cocoon_phase2_until, *time))
            .min(scheduled_active_time(b.next_thorn_trap, &b.statuses, b.cocoon_phase1_until, b.cocoon_phase2_until, *time));
    }
    if active_abilities_in_order && flags.has_any_toxic_trap {
        next_time = next_time
            .min(scheduled_active_time(a.next_toxic_trap, &a.statuses, a.cocoon_phase1_until, a.cocoon_phase2_until, *time))
            .min(scheduled_active_time(b.next_toxic_trap, &b.statuses, b.cocoon_phase1_until, b.cocoon_phase2_until, *time));
        next_time = next_time
            .min(cocoon_aware_schedule(a.toxic_trap_next_tick_at.unwrap_or(f64::INFINITY), a.cocoon_phase1_until, a.cocoon_phase2_until, *time))
            .min(cocoon_aware_schedule(b.toxic_trap_next_tick_at.unwrap_or(f64::INFINITY), b.cocoon_phase1_until, b.cocoon_phase2_until, *time));
    }
    if active_abilities_in_order && flags.has_any_frost_snare {
        next_time = next_time
            .min(scheduled_active_time(a.next_frost_snare, &a.statuses, a.cocoon_phase1_until, a.cocoon_phase2_until, *time))
            .min(scheduled_active_time(b.next_frost_snare, &b.statuses, b.cocoon_phase1_until, b.cocoon_phase2_until, *time));
    }
    if active_abilities_in_order && flags.has_any_poison_area {
        next_time = next_time
            .min(scheduled_active_time(a.next_poison_area, &a.statuses, a.cocoon_phase1_until, a.cocoon_phase2_until, *time))
            .min(scheduled_active_time(b.next_poison_area, &b.statuses, b.cocoon_phase1_until, b.cocoon_phase2_until, *time));
    }
    if active_abilities_in_order && flags.has_any_yolk_bomb {
        next_time = next_time
            .min(scheduled_active_time(a.next_yolk_bomb, &a.statuses, a.cocoon_phase1_until, a.cocoon_phase2_until, *time))
            .min(scheduled_active_time(b.next_yolk_bomb, &b.statuses, b.cocoon_phase1_until, b.cocoon_phase2_until, *time));
    }
    if active_abilities_in_order && flags.has_any_divination {
        next_time = next_time
            .min(scheduled_active_time(a.next_divination, &a.statuses, a.cocoon_phase1_until, a.cocoon_phase2_until, *time))
            .min(scheduled_active_time(b.next_divination, &b.statuses, b.cocoon_phase1_until, b.cocoon_phase2_until, *time));
    }
    if active_abilities_in_order && flags.has_any_aura {
        next_time = next_time
            .min(cocoon_aware_schedule(a.aura_next_tick_at.unwrap_or(f64::INFINITY), a.cocoon_phase1_until, a.cocoon_phase2_until, *time))
            .min(cocoon_aware_schedule(b.aura_next_tick_at.unwrap_or(f64::INFINITY), b.cocoon_phase1_until, b.cocoon_phase2_until, *time));
    }
    if active_abilities_in_order && flags.has_any_healing_step {
        next_time = next_time
            .min(cocoon_aware_schedule(a.healing_step_next_tick_at.unwrap_or(f64::INFINITY), a.cocoon_phase1_until, a.cocoon_phase2_until, *time))
            .min(cocoon_aware_schedule(b.healing_step_next_tick_at.unwrap_or(f64::INFINITY), b.cocoon_phase1_until, b.cocoon_phase2_until, *time));
    }
    if active_abilities_in_order && flags.has_any_healing_pulse {
        next_time = next_time
            .min(scheduled_active_time(a.next_healing_pulse, &a.statuses, a.cocoon_phase1_until, a.cocoon_phase2_until, *time))
            .min(scheduled_active_time(b.next_healing_pulse, &b.statuses, b.cocoon_phase1_until, b.cocoon_phase2_until, *time));
    }
    next_time = next_time
        .min(a.healing_ailment_next_tick_at.unwrap_or(f64::INFINITY))
        .min(b.healing_ailment_next_tick_at.unwrap_or(f64::INFINITY));
    if active_abilities_in_order && flags.has_any_damage_trail {
        next_time = next_time
            .min(a.damage_trail_next_tick_at.unwrap_or(f64::INFINITY))
            .min(b.damage_trail_next_tick_at.unwrap_or(f64::INFINITY));
    }
    if active_abilities_in_order && (config.attacker_frost_nova || config.defender_frost_nova) {
        next_time = next_time
            .min(cocoon_aware_schedule(a.frost_nova_next_tick_at.unwrap_or(f64::INFINITY), a.cocoon_phase1_until, a.cocoon_phase2_until, *time))
            .min(cocoon_aware_schedule(b.frost_nova_next_tick_at.unwrap_or(f64::INFINITY), b.cocoon_phase1_until, b.cocoon_phase2_until, *time));
    }
    if active_abilities_in_order && (config.attacker_reflux || config.defender_reflux) {
        if a.reflux_armed && a.reflux_charge_ready_at > 0.0 {
            next_time = next_time.min(cocoon_aware_schedule(a.reflux_charge_ready_at, a.cocoon_phase1_until, a.cocoon_phase2_until, *time));
        } else if a.reflux_cooldown_until > *time {
            next_time = next_time.min(cocoon_aware_schedule(a.reflux_cooldown_until, a.cocoon_phase1_until, a.cocoon_phase2_until, *time));
        }
        if b.reflux_armed && b.reflux_charge_ready_at > 0.0 {
            next_time = next_time.min(cocoon_aware_schedule(b.reflux_charge_ready_at, b.cocoon_phase1_until, b.cocoon_phase2_until, *time));
        } else if b.reflux_cooldown_until > *time {
            next_time = next_time.min(cocoon_aware_schedule(b.reflux_cooldown_until, b.cocoon_phase1_until, b.cocoon_phase2_until, *time));
        }
        next_time = next_time
            .min(cocoon_aware_schedule(a.reflux_next_tick_at.unwrap_or(f64::INFINITY), a.cocoon_phase1_until, a.cocoon_phase2_until, *time))
            .min(cocoon_aware_schedule(b.reflux_next_tick_at.unwrap_or(f64::INFINITY), b.cocoon_phase1_until, b.cocoon_phase2_until, *time));
    }
    if active_abilities_in_order && (config.attacker_totem || config.defender_totem) {
        next_time = next_time
            .min(cocoon_aware_schedule(a.totem_next_tick_at.unwrap_or(f64::INFINITY), a.cocoon_phase1_until, a.cocoon_phase2_until, *time))
            .min(cocoon_aware_schedule(b.totem_next_tick_at.unwrap_or(f64::INFINITY), b.cocoon_phase1_until, b.cocoon_phase2_until, *time));
    }
    if active_abilities_in_order && (config.attacker_shadow_barrage_value > 0.0 || config.defender_shadow_barrage_value > 0.0) {
        next_time = next_time
            .min(cocoon_aware_schedule(a.shadow_barrage_next_hit_at.unwrap_or(f64::INFINITY), a.cocoon_phase1_until, a.cocoon_phase2_until, *time))
            .min(cocoon_aware_schedule(b.shadow_barrage_next_hit_at.unwrap_or(f64::INFINITY), b.cocoon_phase1_until, b.cocoon_phase2_until, *time));
    }
    if active_abilities_in_order && (config.attacker_cocoon || config.defender_cocoon) {
        if a.cocoon_phase2_until > *time {
            next_time = next_time.min(a.cocoon_phase2_until);
        }
        if b.cocoon_phase2_until > *time {
            next_time = next_time.min(b.cocoon_phase2_until);
        }
    }
    if active_abilities_in_order && (config.attacker_hunters_curse || config.defender_hunters_curse) {
        next_time = next_time
            .min(planned_active_time(a.hunters_curse_planned_at, &a.statuses, a.cocoon_phase1_until, a.cocoon_phase2_until, *time))
            .min(planned_active_time(b.hunters_curse_planned_at, &b.statuses, b.cocoon_phase1_until, b.cocoon_phase2_until, *time));
    }
    if active_abilities_in_order && (config.attacker_unbridled_rage || config.defender_unbridled_rage) {
        next_time = next_time
            .min(planned_active_time(a.unbridled_rage_planned_at, &a.statuses, a.cocoon_phase1_until, a.cocoon_phase2_until, *time))
            .min(planned_active_time(b.unbridled_rage_planned_at, &b.statuses, b.cocoon_phase1_until, b.cocoon_phase2_until, *time));
    }
    if active_abilities_in_order && flags.has_any_fortify {
        next_time = next_time
            .min(planned_fortify_time(a.fortify_planned_at, &a.statuses, a.cocoon_phase1_until, a.cocoon_phase2_until, *time, a.fortify_cooldown_until))
            .min(planned_fortify_time(b.fortify_planned_at, &b.statuses, b.cocoon_phase1_until, b.cocoon_phase2_until, *time, b.fortify_cooldown_until));
        if a.fortify_planned_at > 0.0
            && a.fortify_planned_at <= *time + 1e-9
            && a.fortify_cooldown_until > *time
        {
            next_time = next_time.min(a.fortify_cooldown_until);
        }
        if b.fortify_planned_at > 0.0
            && b.fortify_planned_at <= *time + 1e-9
            && b.fortify_cooldown_until > *time
        {
            next_time = next_time.min(b.fortify_cooldown_until);
        }
        if let Some(forced_at) = fortify_control.attacker_forced_fortify_at {
            if forced_at > *time + 1e-9 {
                next_time = next_time.min(forced_at);
            } else if a.fortify_cooldown_until > *time {
                next_time = next_time.min(a.fortify_cooldown_until);
            }
        }
        if let Some(forced_at) = fortify_control.defender_forced_fortify_at {
            if forced_at > *time + 1e-9 {
                next_time = next_time.min(forced_at);
            } else if b.fortify_cooldown_until > *time {
                next_time = next_time.min(b.fortify_cooldown_until);
            }
        }
    }
    // Same-time replay for ActiveAbilities: when a previous phase at the
    // current tick has marked the mask non-zero, force-schedule a second
    // pass at `*time` so the active-abilities phase can fire alongside
    // (the engine's "all due things resolve at the same tick" semantics).
    //
    // This MUST be gated on the phase actually being present in the
    // current `event_phase_order`. Sandbox Manual mode filters
    // ActiveAbilities out of the order - without the gate, the scheduler
    // keeps forcing `next_time = *time` every iteration, `select_ordered_
    // event_phase` returns None (phase not in order), and the fallback
    // path advances time by only `+1µs` per iter. Net effect: time
    // micro-advances forever and no DOT / Regen / Decay phase ever
    // becomes "due" because the scheduler never reaches their event
    // timestamps. That's the Venuella-mirror "time stops" bug.
    if *same_time_processed_phases != 0
        && flags.has_any_active_ability
        && active_abilities_in_order
        && *same_time_processed_phases & event_phase_bit(OrderedEventPhase::ActiveAbilities) == 0
    {
        next_time = *time;
    }

    if !next_time.is_finite() {
        return SchedulerStep::Break;
    }
    if next_time > *time {
        *time = next_time;
        *same_time_processed_phases = 0;
        if *time > max_time_sec {
            return SchedulerStep::Break;
        }
        if *time > EVENT_TIME_EPS {
            sync_conditional_passive_events(a, attacker, "A", combat_log, record_trace, *time);
            sync_conditional_passive_events(b, defender, "B", combat_log, record_trace, *time);
        }
    } else if next_time < *time - EVENT_TIME_EPS {
        // 2026-05-12 freeze-bug fix: pre-fix this branch returned
        // `SchedulerStep::Break`, halting the simulation on any
        // backward drift. Rewind / Cocoon restoration paths could
        // leak a past timestamp into the next-event candidate set;
        // the abort manifested as a "frozen" battle mid-fight.
        //
        // Treat backward drift as "stale event, ignore it" rather
        // than as a fatal scheduler error. The unfiltered candidate
        // sources have been hardened (`next_status_tick_at_after`
        // filters past values; `apply_rewind_restoration` normalizes
        // restored timers), so this branch should be unreachable in
        // practice - but if a new code path leaks a stale timestamp,
        // we'd rather the engine continue with whatever's actually
        // due now than freeze the battle. The fallback below
        // (`select_ordered_event_phase` returning None ⇒
        // `*time += 0.000001`) advances time, breaking any potential
        // tight loop within at most a handful of µs of progress.
        //
        // Do NOT reset `same_time_processed_phases` here - time
        // didn't actually advance, so phases already processed at
        // this tick must stay marked-done to avoid re-running them
        // (which would create the infinite loop the original Break
        // was guarding against).
    }

    let mut due_phase_mask = 0u32;
    if is_event_due_at(a.next_status_tick(), *time)
        || is_event_due_at(b.next_status_tick(), *time)
        || is_event_due_at(a.healing_ailment_next_tick_at.unwrap_or(f64::INFINITY), *time)
        || is_event_due_at(b.healing_ailment_next_tick_at.unwrap_or(f64::INFINITY), *time)
    {
        due_phase_mask |= event_phase_bit(OrderedEventPhase::StatusTicks);
    }
    if a.any_status_decay_due(*time) || b.any_status_decay_due(*time) {
        due_phase_mask |= event_phase_bit(OrderedEventPhase::StatusDecay);
    }
    if is_event_due_at(a.next_regen, *time) || is_event_due_at(b.next_regen, *time) {
        due_phase_mask |= event_phase_bit(OrderedEventPhase::Regen);
    }
    if is_event_due_at(a.next_hit, *time) || is_event_due_at(b.next_hit, *time) {
        due_phase_mask |= event_phase_bit(OrderedEventPhase::Bite);
    }
    if is_event_due_at(a.next_breath, *time) || is_event_due_at(b.next_breath, *time) {
        due_phase_mask |= event_phase_bit(OrderedEventPhase::Breath);
    }
    if flags.has_any_active_ability
        || is_event_due_at(a.next_lance_aura_tick(), *time)
        || is_event_due_at(b.next_lance_aura_tick(), *time)
    {
        due_phase_mask |= event_phase_bit(OrderedEventPhase::ActiveAbilities);
    }

    let Some(selected_phase) =
        select_ordered_event_phase(event_phase_order, due_phase_mask, *same_time_processed_phases)
    else {
        // Posture-only-due: state.time advanced to a posture decision
        // moment with no other phase due. Return Proceed with the
        // first phase in order so the iter reaches the policy block;
        // the dispatched phase fn is idempotent on no-due-event ticks
        // (each phase fn gates its work on `(event_at - time).abs() ≤ ε`).
        // After the policy fires, schedule_next_posture_decision
        // advances `posture_next_decision_at` past state.time, so the
        // next iter falls through normally without re-firing the
        // policy. Without this branch, the +1µs micro-advance fallback
        // would loop hundreds of thousands of iters between the
        // posture moment and the next engine event, never firing the
        // policy (the iter returns Continue before reaching the
        // policy block on ContinueLoop).
        let posture_due_a = posture_snap_enabled
            && config.attacker_posture_policy_enabled
            && a.posture_next_decision_at <= *time + EVENT_TIME_EPS;
        let posture_due_b = posture_snap_enabled
            && config.defender_posture_policy_enabled
            && b.posture_next_decision_at <= *time + EVENT_TIME_EPS;
        if (posture_due_a || posture_due_b) && !event_phase_order.is_empty() {
            // Pick a phase whose bit is NOT already in
            // same_time_processed_phases - otherwise the iter would
            // mark a re-processed phase and tight-loop. The first
            // phase in order whose bit is unset is fine.
            let unprocessed = event_phase_order.iter().copied().find(|p| {
                *same_time_processed_phases & event_phase_bit(*p) == 0
            });
            if let Some(phase) = unprocessed {
                return SchedulerStep::Proceed { selected_phase: phase };
            }
        }
        *same_time_processed_phases = 0;
        if next_time > *time {
            *time = next_time;
        } else {
            *time += 0.000001;
        }
        return SchedulerStep::ContinueLoop;
    };
    *same_time_processed_phases |= event_phase_bit(selected_phase);

    SchedulerStep::Proceed { selected_phase }
}
