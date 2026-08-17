//! Scheduler phase functions: Phase 1 (event scheduler), Phase 2 pre-step,
//! Phase 3 activations (Fortify/Harden/Rewind), plus SchedulerPassiveFlags
//! and SchedulerStep types. Extracted from `phases/mod.rs`.

#![allow(clippy::too_many_arguments)]

use super::super::*;
use super::super::loop_iter::AbilityPolicyMode;
use crate::composable::ability_metadata::ability_blocked_by_necropoison;
use crate::policy::timing_mode::TimingMode;

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
    pub(in super::super) has_any_oxygen_moisture: bool,
}

/// Result of one scheduler step. Encodes the three control-flow
/// exits the original inline body had (two `break`s and one
/// `continue`) plus the normal "proceed with the selected phase"
/// path. The driver's outer loop matches on this.
#[derive(Debug)]
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
    fortify_control: &mut DefensivePinControl,
    ability_policy_mode: AbilityPolicyMode,
    fortify_rollout_a: Option<bool>,
    fortify_rollout_b: Option<bool>,
) {
    // Posture gate: every `if ctx.config.<side>_<ability> && !ctx.<side>
    // .posture_settled_non_standing() && ...` below skips NEW activations
    // while the side is fully settled in Sit / Lay. Transition window
    // does NOT block - matches the multiplier predicate (Phase 1).
    // Pre-existing active states (e.g. Adrenaline still in its
    // duration window) keep ticking through duration handlers outside
    // this phase, so they survive a lay-down mid-rotation.
    //
    // Phase 3b: Fortify activation.
    if ctx.config.attacker_fortify && !ctx.a.posture_settled_non_standing() && !ctx.config.head_start_inert_a(ctx.time) && !ability_blocked_by_necropoison("Fortify", &ctx.a.statuses) && !ctx.a.in_cocoon_phase_2(ctx.time) {
        let policy_fortify = resolve_ability_policy(ability_policy, ctx.config.attacker_ability_policy_overrides.fortify);
        let forced_now = fortify_control.attacker.fortify_due(ctx.time);
        // `self_policy_suppressed()` is a test-only oracle knob (const `false`
        // in release, so this guard folds away): when set, the forced-Fortify
        // harness measures a forced grid without the self-policy pre-firing.
        let activate = forced_now
            || (!fortify_control.self_policy_suppressed()
                && fortify_gate_or_rollout(
                    ability_policy_mode,
                    fortify_control.attacker.fortify_gate_suppressed(),
                    fortify_rollout_a,
                    policy_fortify,
                    &*ctx.a, ctx.attacker, ctx.attacker_breath,
                    &*ctx.b, ctx.defender, ctx.defender_breath,
                    ctx.time,
                ));
        if activate {
            let before: Vec<(String, f64)> = if ctx.record_trace {
                ctx.a.statuses.iter().map(|(id, inst)| (id.clone(), inst.stacks)).collect()
            } else {
                Vec::new()
            };
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
                fortify_control.attacker.advance_fortify();
                record_ability_event(ctx.a, "A", ctx.combat_log, ctx.record_trace, ctx.time, "Fortify");
                if ctx.record_trace {
                    emit_cleanse_removed_log(ctx.combat_log, ctx.time, "A", ctx.a.hp, "Fortify", &before, &ctx.a.statuses);
                }
            }
        }
    }
    if ctx.config.defender_fortify && !ctx.b.posture_settled_non_standing() && !ctx.config.head_start_inert_b(ctx.time) && !ability_blocked_by_necropoison("Fortify", &ctx.b.statuses) && !ctx.b.in_cocoon_phase_2(ctx.time) {
        let policy_fortify = resolve_ability_policy(ability_policy, ctx.config.defender_ability_policy_overrides.fortify);
        let forced_now = fortify_control.defender.fortify_due(ctx.time);
        // The self-policy suppression knob is attacker-only (the oracle harness
        // forces the attacker), so the defender arm calls straight through.
        let activate = forced_now
            || fortify_gate_or_rollout(
                ability_policy_mode,
                fortify_control.defender.fortify_gate_suppressed(),
                fortify_rollout_b,
                policy_fortify,
                &*ctx.b, ctx.defender, ctx.defender_breath,
                &*ctx.a, ctx.attacker, ctx.attacker_breath,
                ctx.time,
            );
        if activate {
            let before: Vec<(String, f64)> = if ctx.record_trace {
                ctx.b.statuses.iter().map(|(id, inst)| (id.clone(), inst.stacks)).collect()
            } else {
                Vec::new()
            };
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
                fortify_control.defender.advance_fortify();
                record_ability_event(ctx.b, "B", ctx.combat_log, ctx.record_trace, ctx.time, "Fortify");
                if ctx.record_trace {
                    emit_cleanse_removed_log(ctx.combat_log, ctx.time, "B", ctx.b.hp, "Fortify", &before, &ctx.b.statuses);
                }
            }
        }
    }

    // Phase 3b2: Harden activation
    if ctx.config.attacker_harden && !ctx.a.posture_settled_non_standing() && !ctx.config.head_start_inert_a(ctx.time)
        && !ability_blocked_by_necropoison("Harden", &ctx.a.statuses) && !ctx.a.in_cocoon_phase_2(ctx.time)
        && ctx.time >= ctx.a.harden_cooldown_until
        && ctx.time >= ctx.a.harden_active_until
    {
        ctx.a.harden_active_until = ctx.time + 30.0;
        ctx.a.harden_cooldown_until = ctx.time + scale_active_cooldown(ctx.attacker, 120.0);
        record_ability_event(ctx.a, "A", ctx.combat_log, ctx.record_trace, ctx.time, "Harden");
    }
    if ctx.config.defender_harden && !ctx.b.posture_settled_non_standing() && !ctx.config.head_start_inert_b(ctx.time)
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
            && !ctx.config.head_start_inert_a(ctx.time)
            && !ability_blocked_by_necropoison("Rewind", &ctx.a.statuses)
            && !ctx.a.in_cocoon_phase_2(ctx.time)
            && ctx.time >= ctx.a.rewind_cooldown_until
        {
            if let Some(restored_hp_delta) =
                rewind_snapshot_deltas(ctx.time, ctx.attacker, ctx.a.hp, &ctx.a.rewind_history)
            {
                let policy_rewind = resolve_ability_policy(
                    ability_policy,
                    ctx.config.attacker_ability_policy_overrides.rewind,
                );
                let self_side = policy_bridge::build_policy_side(
                    &*ctx.a, ctx.attacker, ctx.attacker_breath,
                    policy_bridge::rewind_extras(restored_hp_delta),
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
            && !ctx.config.head_start_inert_b(ctx.time)
            && !ability_blocked_by_necropoison("Rewind", &ctx.b.statuses)
            && !ctx.b.in_cocoon_phase_2(ctx.time)
            && ctx.time >= ctx.b.rewind_cooldown_until
        {
            if let Some(restored_hp_delta) =
                rewind_snapshot_deltas(ctx.time, ctx.defender, ctx.b.hp, &ctx.b.rewind_history)
            {
                let policy_rewind = resolve_ability_policy(
                    ability_policy,
                    ctx.config.defender_ability_policy_overrides.rewind,
                );
                let self_side = policy_bridge::build_policy_side(
                    &*ctx.b, ctx.defender, ctx.defender_breath,
                    policy_bridge::rewind_extras(restored_hp_delta),
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

/// Decide whether Fortify should fire NOW for a side, honoring the ability
/// policy mode.
///
/// `GateOnly` (inner replays) collapses to the ReallyFast gate so a
/// rollout-driven Fortify never re-enters its own rollout; a side with a pinned
/// fire schedule fires only through that forced path and so skips the gate here
/// (`forced_pending` = the schedule's gate-suppression). `Normal` uses the
/// pre-resolved rollout decision when
/// `FORTIFY_ROLLOUT` is on (`rollout_pre = Some(_)`), else the hand-written
/// utility gate under the side's configured timing mode.
fn fortify_gate_or_rollout(
    mode: AbilityPolicyMode,
    forced_pending: bool,
    rollout_pre: Option<bool>,
    resolved_policy: SimpleAbilityTimingMode,
    self_side: &CombatSide,
    self_stats: &SimpleCombatantStats,
    self_breath: Option<&crate::contracts::SimpleBreathProfile>,
    opp_side: &CombatSide,
    opp_stats: &SimpleCombatantStats,
    opp_breath: Option<&crate::contracts::SimpleBreathProfile>,
    time: f64,
) -> bool {
    match mode {
        AbilityPolicyMode::GateOnly => {
            if forced_pending {
                return false;
            }
            fortify_gate_fires(
                self_side, self_stats, self_breath, opp_side, opp_stats, opp_breath, time,
                TimingMode::ReallyFast,
            )
        }
        AbilityPolicyMode::Normal => match rollout_pre {
            Some(fire) => fire,
            None => fortify_gate_fires(
                self_side, self_stats, self_breath, opp_side, opp_stats, opp_breath, time,
                policy_bridge::map_timing_mode(resolved_policy),
            ),
        },
    }
}

/// Run the built-in Fortify decision at `mode` (the hand-written utility
/// gate). Extracted so both the `Normal` fallback and the `GateOnly` ReallyFast
/// path share one policy-side build.
fn fortify_gate_fires(
    self_side: &CombatSide,
    self_stats: &SimpleCombatantStats,
    self_breath: Option<&crate::contracts::SimpleBreathProfile>,
    opp_side: &CombatSide,
    opp_stats: &SimpleCombatantStats,
    opp_breath: Option<&crate::contracts::SimpleBreathProfile>,
    time: f64,
    mode: TimingMode,
) -> bool {
    let self_ps =
        policy_bridge::build_policy_side(self_side, self_stats, self_breath, std::iter::empty());
    let opp_ps =
        policy_bridge::build_policy_side(opp_side, opp_stats, opp_breath, std::iter::empty());
    policy_bridge::should_activate_now(
        crate::policy::decisions::fortify::FORTIFY_DECISION_ID,
        self_ps,
        opp_ps,
        time,
        mode,
    )
}

/// Whether this side's phase4 handler for a deferred-tick active is gated off
/// at `time` under the shared outer gate (settled non-standing posture / Head
/// Start inert / Cocoon Phase 2). Mirrors the per-active gate the scheduler
/// fold applies; a gated-off owner legitimately lets the loop end because it
/// will never consume its own pending tick / re-activation.
#[cfg(debug_assertions)]
fn deferred_tick_owner_gated_off(
    side: &CombatSide,
    inert: bool,
    time: f64,
) -> bool {
    side.posture_settled_non_standing() || inert || side.in_cocoon_phase_2(time)
}

/// Debug predicate: would a `Break` here leave a deferred-tick active's
/// re-activation unreached? Returns true when a config-enabled, non-gated
/// deferred-tick active still has a finite re-activation later than `time`
/// and not later than `max_time_sec` - a re-activation that was never folded
/// into a scheduler candidate. A sound Break has none: it fires legitimately
/// when the re-activation lies beyond `max_time_sec`, when the owner is gated
/// off (it will never re-fire), or in Sandbox Manual mode (ActiveAbilities
/// filtered out of the order, so actives are driven by manual press, not the
/// scheduler).
///
/// Scoped to the re-activation invariant the fix guarantees. A generic
/// "no future bite/breath" check is unsound against the Sandbox stepper, which
/// relies on Break-and-restep with `next_time` legitimately pinned at `time` by
/// zero-initialized active timers while a real bite sits a few seconds out.
/// Compiled into `debug_assert!` only.
#[cfg(debug_assertions)]
fn scheduler_has_live_pending_event(
    a: &CombatSide,
    b: &CombatSide,
    config: &ComposableAbilityConfig,
    time: f64,
    max_time_sec: f64,
    active_abilities_in_order: bool,
) -> bool {
    // Deferred-tick re-activations are only scheduled when the ActiveAbilities
    // phase is in the order (Sandbox Manual mode filters it out).
    if !active_abilities_in_order {
        return false;
    }
    let inert_a = config.head_start_inert_a(time);
    let inert_b = config.head_start_inert_b(time);
    // A candidate beyond the horizon is never reached, so the Break is sound.
    let ahead = |t: f64| t.is_finite() && t > time + EVENT_TIME_EPS && t <= max_time_sec + EVENT_TIME_EPS;

    // Re-activation candidate: a closed-window active whose cooldown still ticks
    // toward the next firing. Only counts when the owner is NOT gated off (a
    // gated-off owner never re-fires, so a finite cooldown there is inert).
    let reactivation_pending = |side: &CombatSide, enabled: bool, inert: bool,
                                active_until: f64, cooldown_until: f64| {
        enabled
            && !deferred_tick_owner_gated_off(side, inert, time)
            && active_until <= time
            && ahead(cooldown_until)
    };

    if reactivation_pending(a, config.attacker_frost_nova, inert_a, a.frost_nova_active_until, a.frost_nova_cooldown_until)
        || reactivation_pending(b, config.defender_frost_nova, inert_b, b.frost_nova_active_until, b.frost_nova_cooldown_until)
        || reactivation_pending(a, config.attacker_totem, inert_a, a.totem_active_until, a.totem_cooldown_until)
        || reactivation_pending(b, config.defender_totem, inert_b, b.totem_active_until, b.totem_cooldown_until)
    {
        return true;
    }
    // Reflux re-fires from `reflux_cooldown_until` only when not mid-charge.
    if config.attacker_reflux && !deferred_tick_owner_gated_off(a, inert_a, time) && !a.reflux_armed && ahead(a.reflux_cooldown_until) {
        return true;
    }
    if config.defender_reflux && !deferred_tick_owner_gated_off(b, inert_b, time) && !b.reflux_armed && ahead(b.reflux_cooldown_until) {
        return true;
    }
    false
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
    fortify_control: &DefensivePinControl,
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
    // so the closure fires late at the first iter >= scheduled.
    // The drift compounds across decisions and costs hundreds of HP
    // over a 30-second fight.
    // Gated on `posture_snap_enabled`: brute-force script mode never advances
    // `posture_next_decision_at`, so without the gate `state.time` would stay
    // pinned at 0.
    // Head Start inert mask: while one side enabled Head Start, its
    // opponent stands inert for the opening window. We mask the inert
    // side's OWN action timers (bite / breath / self-destruct / posture
    // decision / every active-ability timer below) to INFINITY so the
    // scheduler never snaps `time` to them during the window. Passive
    // state-evolution timers (regen / status tick / status decay / lance
    // aura) are deliberately NOT masked - the inert side is a live target.
    //
    // The mask lives here at the fold (a read-time view, not a mutate of
    // stored timers) so it propagates identically into the posture/active
    // policy's `decide_via_replay` projections, which clone state and
    // re-run this scheduler. Gating only the live loop would desync the
    // projected schedule from the actual one and corrupt decisions.
    // `head_start_*_sec = 0` (default) leaves both predicates false, so
    // every `mask_*` below is the identity and the fight is byte-identical.
    // Boundary matches `ComposableAbilityConfig::head_start_inert_*` (the
    // shared predicate the firing-gate phases call); spelled out here against
    // the raw fields so the scheduler - the place the window enters the
    // schedule - reads them directly.
    let inert_a = *time + 1e-9 < config.defender_head_start_sec;
    let inert_b = *time + 1e-9 < config.attacker_head_start_sec;
    // Head Start park: an inert side's own action timers (bite / breath /
    // posture decision) are masked out of the fold below, so they must be held
    // on the window boundary N or they break the schedule two ways. (1) Left at
    // a value short of N they fall into the past the instant the window lifts,
    // pinning `next_time` below `time` forever - the +1us crawl that froze the
    // fight at t = N. (2) When BOTH sides open inert and no other event drives
    // the early window, the boundary injection below advances `time` straight
    // past t = 0, so the later melee / breath phases never get to park them.
    // Parking here - the first thing each iter, before the fold and the
    // injection - is the single point that covers both: the timer stays a finite
    // future value through the window and comes due exactly at N. No-op
    // (byte-identical) when no side configured Head Start, since the predicates
    // are then permanently false.
    if inert_a {
        let n = config.defender_head_start_sec;
        if a.next_hit < n {
            a.next_hit = n;
        }
        if a.next_breath < n {
            a.next_breath = n;
        }
        if config.attacker_posture_policy_enabled && a.posture_next_decision_at < n {
            a.posture_next_decision_at = n;
        }
    }
    if inert_b {
        let n = config.attacker_head_start_sec;
        if b.next_hit < n {
            b.next_hit = n;
        }
        if b.next_breath < n {
            b.next_breath = n;
        }
        if config.defender_posture_policy_enabled && b.posture_next_decision_at < n {
            b.posture_next_decision_at = n;
        }
    }
    let mask_a = |v: f64| if inert_a { f64::INFINITY } else { v };
    let mask_b = |v: f64| if inert_b { f64::INFINITY } else { v };
    // `death_time.is_none()` mirrors the firing gate (`loop_iter.rs` a_fire/
    // b_fire): a dead side no longer runs posture decisions, so the scheduler
    // must not snap `time` to its stale `posture_next_decision_at` either -
    // otherwise the proposed-but-never-consumed tick pins `next_time` and stalls
    // the loop (the scheduler-fold-vs-handler-gate divergence class).
    let posture_next_a = if posture_snap_enabled
        && config.attacker_posture_policy_enabled
        && a.death_time.is_none()
    {
        mask_a(a.posture_next_decision_at)
    } else {
        f64::INFINITY
    };
    let posture_next_b = if posture_snap_enabled
        && config.defender_posture_policy_enabled
        && b.death_time.is_none()
    {
        mask_b(b.posture_next_decision_at)
    } else {
        f64::INFINITY
    };
    let mut next_time = mask_a(a.next_hit)
        .min(mask_b(b.next_hit))
        .min(mask_a(a.next_breath))
        .min(mask_b(b.next_breath))
        .min(a.next_regen)
        .min(b.next_regen)
        .min(a.regen_release_at)
        .min(b.regen_release_at)
        .min(mask_a(a.next_self_destruct_event()))
        .min(mask_b(b.next_self_destruct_event()))
        .min(a.next_status_tick())
        .min(b.next_status_tick())
        .min(a.next_status_decay(*time))
        .min(b.next_status_decay(*time))
        .min(a.next_lance_aura_tick())
        .min(b.next_lance_aura_tick())
        .min(posture_next_a)
        .min(posture_next_b);
    // Head Start boundary: while a side is inert its own action timers are
    // masked to INFINITY above, so without this the window end is not on the
    // schedule - the loop would either overshoot N (the inert side resumes
    // late) or, with nothing else pending, fold to INFINITY and break the fight
    // early. Inject the boundary as a candidate so the loop lands exactly on N,
    // where the parked bite/breath/posture timers (see the per-phase gates)
    // come due and the side resumes. `inert_*` are false unless a Head Start is
    // configured, so this is a no-op (byte-identical) in every normal fight.
    if inert_a {
        next_time = next_time.min(config.defender_head_start_sec);
    }
    if inert_b {
        next_time = next_time.min(config.attacker_head_start_sec);
    }
    // Every candidate below contributes to `next_time` only when the
    // ActiveAbilities phase is going to be processed this loop - i.e.
    // it's in the current `event_phase_order`. Sandbox Manual mode
    // filters ActiveAbilities OUT of the order; without this gate the
    // scheduler keeps proposing `next_time = 0` from
    // `setup.rs::a.next_toxic_trap = 0.0` (and similar zero-initialized
    // active-ability timers), the due-phase mask matches nothing
    // pickable, and the fallback `*time += 1us` runs forever. Status /
    // Regen / Decay candidates above stay outside this gate so they still get
    // their proper schedule even in Manual mode.
    let active_abilities_in_order =
        event_phase_order.contains(&OrderedEventPhase::ActiveAbilities);
    if active_abilities_in_order && flags.has_any_thorn_trap {
        next_time = next_time
            .min(mask_a(scheduled_active_time(a.next_thorn_trap, &a.statuses, a.cocoon_phase1_until, a.cocoon_phase2_until, *time)))
            .min(mask_b(scheduled_active_time(b.next_thorn_trap, &b.statuses, b.cocoon_phase1_until, b.cocoon_phase2_until, *time)));
    }
    if active_abilities_in_order && flags.has_any_toxic_trap {
        next_time = next_time
            .min(mask_a(scheduled_active_time(a.next_toxic_trap, &a.statuses, a.cocoon_phase1_until, a.cocoon_phase2_until, *time)))
            .min(mask_b(scheduled_active_time(b.next_toxic_trap, &b.statuses, b.cocoon_phase1_until, b.cocoon_phase2_until, *time)));
        next_time = next_time
            .min(mask_a(cocoon_aware_schedule(a.toxic_trap_next_tick_at.unwrap_or(f64::INFINITY), a.cocoon_phase1_until, a.cocoon_phase2_until, *time)))
            .min(mask_b(cocoon_aware_schedule(b.toxic_trap_next_tick_at.unwrap_or(f64::INFINITY), b.cocoon_phase1_until, b.cocoon_phase2_until, *time)));
    }
    if active_abilities_in_order && flags.has_any_frost_snare {
        next_time = next_time
            .min(mask_a(scheduled_active_time(a.next_frost_snare, &a.statuses, a.cocoon_phase1_until, a.cocoon_phase2_until, *time)))
            .min(mask_b(scheduled_active_time(b.next_frost_snare, &b.statuses, b.cocoon_phase1_until, b.cocoon_phase2_until, *time)));
    }
    if active_abilities_in_order && flags.has_any_poison_area {
        next_time = next_time
            .min(mask_a(scheduled_active_time(a.next_poison_area, &a.statuses, a.cocoon_phase1_until, a.cocoon_phase2_until, *time)))
            .min(mask_b(scheduled_active_time(b.next_poison_area, &b.statuses, b.cocoon_phase1_until, b.cocoon_phase2_until, *time)));
    }
    if active_abilities_in_order && flags.has_any_yolk_bomb {
        next_time = next_time
            .min(mask_a(scheduled_active_time(a.next_yolk_bomb, &a.statuses, a.cocoon_phase1_until, a.cocoon_phase2_until, *time)))
            .min(mask_b(scheduled_active_time(b.next_yolk_bomb, &b.statuses, b.cocoon_phase1_until, b.cocoon_phase2_until, *time)));
    }
    if active_abilities_in_order && flags.has_any_divination {
        next_time = next_time
            .min(mask_a(scheduled_active_time(a.next_divination, &a.statuses, a.cocoon_phase1_until, a.cocoon_phase2_until, *time)))
            .min(mask_b(scheduled_active_time(b.next_divination, &b.statuses, b.cocoon_phase1_until, b.cocoon_phase2_until, *time)));
    }
    if active_abilities_in_order && flags.has_any_aura {
        next_time = next_time
            .min(mask_a(cocoon_aware_schedule(a.aura_next_tick_at.unwrap_or(f64::INFINITY), a.cocoon_phase1_until, a.cocoon_phase2_until, *time)))
            .min(mask_b(cocoon_aware_schedule(b.aura_next_tick_at.unwrap_or(f64::INFINITY), b.cocoon_phase1_until, b.cocoon_phase2_until, *time)));
    }
    if active_abilities_in_order && flags.has_any_healing_step {
        next_time = next_time
            .min(mask_a(cocoon_aware_schedule(a.healing_step_next_tick_at.unwrap_or(f64::INFINITY), a.cocoon_phase1_until, a.cocoon_phase2_until, *time)))
            .min(mask_b(cocoon_aware_schedule(b.healing_step_next_tick_at.unwrap_or(f64::INFINITY), b.cocoon_phase1_until, b.cocoon_phase2_until, *time)));
    }
    if active_abilities_in_order && flags.has_any_healing_pulse {
        next_time = next_time
            .min(mask_a(scheduled_active_time(a.next_healing_pulse, &a.statuses, a.cocoon_phase1_until, a.cocoon_phase2_until, *time)))
            .min(mask_b(scheduled_active_time(b.next_healing_pulse, &b.statuses, b.cocoon_phase1_until, b.cocoon_phase2_until, *time)));
    }
    next_time = next_time
        .min(mask_a(a.healing_ailment_next_tick_at.unwrap_or(f64::INFINITY)))
        .min(mask_b(b.healing_ailment_next_tick_at.unwrap_or(f64::INFINITY)));
    // Oxygen / Moisture per-second drain tick. A global environmental effect
    // (like weather), so it is NOT gated on the ActiveAbilities phase - it must
    // fire in Sandbox Manual mode too. `cocoon_aware_schedule` forward-filters
    // a stale past timer to INFINITY so a dead/depleted side never pins
    // next_time at or below time (healing-pulse cost-bug class); the tick phase
    // re-arms with a strict forward advance and stops when inert.
    if flags.has_any_oxygen_moisture {
        next_time = next_time
            .min(mask_a(cocoon_aware_schedule(a.oxy_moist_next_tick_at, a.cocoon_phase1_until, a.cocoon_phase2_until, *time)))
            .min(mask_b(cocoon_aware_schedule(b.oxy_moist_next_tick_at, b.cocoon_phase1_until, b.cocoon_phase2_until, *time)));
    }
    if active_abilities_in_order && flags.has_any_damage_trail {
        // Damage Trail is the last member of the deferred-tick family. It re-arms
        // its tick continuously (no active window / cooldown re-activation) and
        // its handler always consumes a due tick (it gates only the *apply* on
        // cocoon-phase-2, never leaving the tick unconsumed), so `gated_off=false`
        // and `active_until=INFINITY`. It is intentionally NOT cocoon-lift
        // scheduled (zero cocoon bounds disable the lift, keeping the
        // through-cocoon tick cadence). Routing it through the shared helper is
        // what supplies the strict-past forward-filter - a tick left stale by a
        // head-start-inert window must not pin `next_time`.
        next_time = next_time
            .min(mask_a(deferred_tick_active_next_time(a.damage_trail_next_tick_at, f64::INFINITY, f64::INFINITY, false, 0.0, 0.0, *time)))
            .min(mask_b(deferred_tick_active_next_time(b.damage_trail_next_tick_at, f64::INFINITY, f64::INFINITY, false, 0.0, 0.0, *time)));
    }
    // Deferred-tick actives (Frost Nova / Reflux / Totem / Shadow Barrage) all
    // share one scheduling shape: an in-window `next_tick_at` plus a
    // re-activation timer (`*_cooldown_until`) that the loop must wake on once
    // the active window closes. `deferred_tick_active_next_time` folds both and
    // masks the candidate when the owner's phase4 handler is gated off this
    // iteration (`*_gated_*` below mirror each handler's exact outer gate), so a
    // gated-off owner can't pin `next_time` on a tick it will never consume.
    if active_abilities_in_order && (config.attacker_frost_nova || config.defender_frost_nova) {
        let a_gated = a.posture_settled_non_standing()
            || config.head_start_inert_a(*time)
            || a.in_cocoon_phase_2(*time);
        let b_gated = b.posture_settled_non_standing()
            || config.head_start_inert_b(*time)
            || b.in_cocoon_phase_2(*time);
        next_time = next_time
            .min(mask_a(deferred_tick_active_next_time(a.frost_nova_next_tick_at, a.frost_nova_active_until, a.frost_nova_cooldown_until, a_gated, a.cocoon_phase1_until, a.cocoon_phase2_until, *time)))
            .min(mask_b(deferred_tick_active_next_time(b.frost_nova_next_tick_at, b.frost_nova_active_until, b.frost_nova_cooldown_until, b_gated, b.cocoon_phase1_until, b.cocoon_phase2_until, *time)));
    }
    if active_abilities_in_order && (config.attacker_reflux || config.defender_reflux) {
        let a_gated = a.posture_settled_non_standing()
            || config.head_start_inert_a(*time)
            || a.in_cocoon_phase_2(*time);
        let b_gated = b.posture_settled_non_standing()
            || config.head_start_inert_b(*time)
            || b.in_cocoon_phase_2(*time);
        // Reflux's in-window tick is `reflux_next_tick_at` (the puddle). Its
        // "re-activation" candidate is `reflux_charge_ready_at` while armed
        // (the 5 s charge), otherwise `reflux_cooldown_until` - the two are
        // mutually exclusive. Passing it as the helper's reactivation timer
        // with `active_until = time` keeps it folded whenever it lies strictly
        // ahead.
        let a_reactivation = if a.reflux_armed && a.reflux_charge_ready_at > 0.0 {
            a.reflux_charge_ready_at
        } else {
            a.reflux_cooldown_until
        };
        let b_reactivation = if b.reflux_armed && b.reflux_charge_ready_at > 0.0 {
            b.reflux_charge_ready_at
        } else {
            b.reflux_cooldown_until
        };
        next_time = next_time
            .min(mask_a(deferred_tick_active_next_time(a.reflux_next_tick_at, *time, a_reactivation, a_gated, a.cocoon_phase1_until, a.cocoon_phase2_until, *time)))
            .min(mask_b(deferred_tick_active_next_time(b.reflux_next_tick_at, *time, b_reactivation, b_gated, b.cocoon_phase1_until, b.cocoon_phase2_until, *time)));
    }
    if active_abilities_in_order && (config.attacker_totem || config.defender_totem) {
        let a_gated = a.posture_settled_non_standing()
            || config.head_start_inert_a(*time)
            || a.in_cocoon_phase_2(*time);
        let b_gated = b.posture_settled_non_standing()
            || config.head_start_inert_b(*time)
            || b.in_cocoon_phase_2(*time);
        // The active window is shorter than the cooldown, so once the window
        // closes, the tick timer no longer schedules ActiveAbilities; the
        // re-activation is scheduled from `totem_cooldown_until` (folded by the
        // when `active_until <= time < cooldown_until`).
        next_time = next_time
            .min(mask_a(deferred_tick_active_next_time(a.totem_next_tick_at, a.totem_active_until, a.totem_cooldown_until, a_gated, a.cocoon_phase1_until, a.cocoon_phase2_until, *time)))
            .min(mask_b(deferred_tick_active_next_time(b.totem_next_tick_at, b.totem_active_until, b.totem_cooldown_until, b_gated, b.cocoon_phase1_until, b.cocoon_phase2_until, *time)));
    }
    if active_abilities_in_order && (config.attacker_shadow_barrage_value > 0.0 || config.defender_shadow_barrage_value > 0.0) {
        // Shadow Barrage's outer handler gate additionally includes the
        // Necropoison block, so mirror it here. SB has no timer-driven
        // re-activation - it re-fires only off a fresh melee hit, never off
        // `shadow_barrage_cooldown_until` alone - so pass `active_until =
        // INFINITY` to suppress the cooldown candidate (the burst model leaves
        // `next_hit_at` None, so this stays byte-identical: the only fold is the
        // INFINITY tick timer plus the gated-off mask).
        let a_gated = a.posture_settled_non_standing()
            || config.head_start_inert_a(*time)
            || a.in_cocoon_phase_2(*time)
            || ability_blocked_by_necropoison("Shadow Barrage", &a.statuses);
        let b_gated = b.posture_settled_non_standing()
            || config.head_start_inert_b(*time)
            || b.in_cocoon_phase_2(*time)
            || ability_blocked_by_necropoison("Shadow Barrage", &b.statuses);
        next_time = next_time
            .min(mask_a(deferred_tick_active_next_time(a.shadow_barrage_next_hit_at, f64::INFINITY, a.shadow_barrage_cooldown_until, a_gated, a.cocoon_phase1_until, a.cocoon_phase2_until, *time)))
            .min(mask_b(deferred_tick_active_next_time(b.shadow_barrage_next_hit_at, f64::INFINITY, b.shadow_barrage_cooldown_until, b_gated, b.cocoon_phase1_until, b.cocoon_phase2_until, *time)));
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
            .min(mask_a(planned_active_time(a.hunters_curse_planned_at, &a.statuses, a.cocoon_phase1_until, a.cocoon_phase2_until, *time)))
            .min(mask_b(planned_active_time(b.hunters_curse_planned_at, &b.statuses, b.cocoon_phase1_until, b.cocoon_phase2_until, *time)));
    }
    if active_abilities_in_order && (config.attacker_unbridled_rage || config.defender_unbridled_rage) {
        next_time = next_time
            .min(mask_a(planned_active_time(a.unbridled_rage_planned_at, &a.statuses, a.cocoon_phase1_until, a.cocoon_phase2_until, *time)))
            .min(mask_b(planned_active_time(b.unbridled_rage_planned_at, &b.statuses, b.cocoon_phase1_until, b.cocoon_phase2_until, *time)));
    }
    if active_abilities_in_order && flags.has_any_fortify {
        next_time = next_time
            .min(mask_a(planned_fortify_time(a.fortify_planned_at, &a.statuses, a.cocoon_phase1_until, a.cocoon_phase2_until, *time, a.fortify_cooldown_until)))
            .min(mask_b(planned_fortify_time(b.fortify_planned_at, &b.statuses, b.cocoon_phase1_until, b.cocoon_phase2_until, *time, b.fortify_cooldown_until)));
        if a.fortify_planned_at > 0.0
            && a.fortify_planned_at <= *time + 1e-9
            && a.fortify_cooldown_until > *time
        {
            next_time = next_time.min(mask_a(a.fortify_cooldown_until));
        }
        if b.fortify_planned_at > 0.0
            && b.fortify_planned_at <= *time + 1e-9
            && b.fortify_cooldown_until > *time
        {
            next_time = next_time.min(mask_b(b.fortify_cooldown_until));
        }
        if let Some(forced_at) = fortify_control.attacker.next_fortify_fire() {
            if forced_at > *time + 1e-9 {
                next_time = next_time.min(mask_a(forced_at));
            } else if a.fortify_cooldown_until > *time {
                next_time = next_time.min(mask_a(a.fortify_cooldown_until));
            }
        }
        if let Some(forced_at) = fortify_control.defender.next_fortify_fire() {
            if forced_at > *time + 1e-9 {
                next_time = next_time.min(mask_b(forced_at));
            } else if b.fortify_cooldown_until > *time {
                next_time = next_time.min(mask_b(b.fortify_cooldown_until));
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
    // path advances time by only `+1us` per iter. Net effect: time
    // micro-advances forever and no DOT / Regen / Decay phase ever
    // becomes "due" because the scheduler never reaches their event
    // timestamps.
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
        // Treat backward drift as "stale event, ignore it" rather
        // than as a fatal scheduler error. The unfiltered candidate
        // sources have been hardened (`next_status_tick_at_after`
        // filters past values; `apply_rewind_restoration` normalizes
        // restored timers), so this branch should be unreachable in
        // practice - but if a new code path leaks a stale timestamp,
        // we'd rather the engine continue with whatever's actually
        // due now than freeze the battle. The fallback below
        // (`select_ordered_event_phase` returning None =>
        // `*time += 0.000001`) advances time by 1 microsecond per
        // iteration, so a loop here ends rather than repeating at one
        // timestamp.
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
        || (flags.has_any_oxygen_moisture
            && (is_event_due_at(a.oxy_moist_next_tick_at, *time)
                || is_event_due_at(b.oxy_moist_next_tick_at, *time)))
    {
        due_phase_mask |= event_phase_bit(OrderedEventPhase::StatusTicks);
    }
    if a.any_status_decay_due(*time) || b.any_status_decay_due(*time) {
        due_phase_mask |= event_phase_bit(OrderedEventPhase::StatusDecay);
    }
    if is_event_due_at(a.next_regen, *time)
        || is_event_due_at(b.next_regen, *time)
        || is_event_due_at(a.regen_release_at, *time)
        || is_event_due_at(b.regen_release_at, *time)
    {
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
        // (each phase fn gates its work on `(event_at - time).abs() <= epsilon`).
        // After the policy fires, schedule_next_posture_decision
        // advances `posture_next_decision_at` past state.time, so the
        // next iter falls through normally without re-firing the
        // policy. Without this branch, the +1us micro-advance fallback
        // would loop hundreds of thousands of iters between the
        // posture moment and the next engine event, never firing the
        // policy (the iter returns Continue before reaching the
        // policy block on ContinueLoop).
        let posture_due_a = posture_snap_enabled
            && config.attacker_posture_policy_enabled
            && a.death_time.is_none()
            && a.posture_next_decision_at <= *time + EVENT_TIME_EPS;
        let posture_due_b = posture_snap_enabled
            && config.defender_posture_policy_enabled
            && b.death_time.is_none()
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
            return SchedulerStep::ContinueLoop;
        }
        // No phase is due and nothing is scheduled strictly ahead of `time`.
        // The old `*time += 0.000001` only ever crawled forward across a
        // stale timer pinning `next_time` in the past - which the intake
        // forward-filter now maps to INFINITY, so reaching here means the
        // fight has genuinely run out of events. Stop rather than micro-crawl.
        //
        // Tripwire: a Break here is only sound when no live event remains. If a
        // config-enabled deferred-tick active still has a finite pending
        // re-activation for a side whose handler is NOT gated off, or any side
        // has a finite future engine event, the loop is starving a real event -
        // the stall class this scheduler is meant to make impossible. Debug-only
        // (release is byte-identical); it never fires on a sound Break.
        #[cfg(debug_assertions)]
        debug_assert!(
            !scheduler_has_live_pending_event(
                a, b, config, *time, max_time_sec, active_abilities_in_order,
            ),
            "scheduler Break at t={time} with a deferred-tick active re-activation \
             still pending - a finite future re-activation was not scheduled"
        );
        return SchedulerStep::Break;
    };
    *same_time_processed_phases |= event_phase_bit(selected_phase);

    SchedulerStep::Proceed { selected_phase }
}
