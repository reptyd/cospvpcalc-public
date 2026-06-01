//! Single-iteration body of the composable event loop, extracted so live
//! driver, sandbox, and policy projector can share one implementation.
//! Behaviour-identical to the original inline body in
//! `simulate_composable_matchup_with_trace_control` — no logic changes.

use std::collections::BTreeSet;

use crate::contracts::{
    CombatLogEntry, SimpleAbilityTimingMode, SimpleBreathProfile, SimpleCombatantStats,
};

use super::config::ComposableAbilityConfig;
use super::phases::{
    process_phase_10_11_melee, process_phase_12_status_dot_ticks,
    process_phase_14_15_breath, process_phase_15b_15c_post_breath_hooks,
    process_phase_16_post_tick, process_phase_1_scheduler, process_phase_2_pre_step,
    process_phase_3_activations, process_phase_4_areas_cluster,
    process_phase_4_aura_and_trails_cluster, process_phase_4_delayed_activations_cluster,
    process_phase_4_healing_actives_cluster, process_phase_4_healing_ailment_tick,
    process_phase_4_hunker_decisions, process_phase_4_lich_and_spite_cluster,
    process_phase_4_misc_and_cocoon_cluster, process_phase_4_status_applies_cluster,
    process_phase_4_tick_actives_cluster, process_phase_4_traps_cluster,
    process_phase_5_6_regen, process_phase_7_self_destruct_passive,
    process_phase_9_lance_aura, process_phase_status_decay_gate, SchedulerPassiveFlags,
    SchedulerStep,
};
use super::setup::ComposableLoopFlags;
use super::side::CombatSide;
use super::status_helpers::snapshot_dot_status_keys;
use super::{
    apply_policy_action, compute_first_strike_active, schedule_next_posture_decision,
    user_dispatch, user_status_dispatch, DamageCounters, FortifySimulationControl,
    OrderedEventPhase, PhaseContext,
};
use crate::active_runtime::with_active_weight_bonuses_and_static_factor;
use crate::actives::is_hunker_effect_active;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum PosturePolicyMode {
    /// Honor config.attacker_posture_policy_enabled / defender_posture_policy_enabled.
    Normal,
    /// Skip posture-policy invocation entirely. Used by the projector to
    /// break recursion: the inner replay must never re-enter `decide()`.
    #[allow(dead_code)]
    ForcedOff,
}

pub(super) enum LoopOutcome {
    /// Scheduler returned Break — outer loop should `break`.
    Break,
    /// Scheduler returned ContinueLoop — outer loop should `continue` (no further work in this iter).
    Continue,
    /// Iteration completed — outer loop may continue to next iter.
    Advanced,
    /// Sandbox-only: scheduler advanced time past `IterHooks::bound`.
    /// State was reverted to the pre-scheduler snapshot. Caller should
    /// treat this as "no progress, halt".
    #[allow(dead_code)]
    BoundExceeded,
}

/// Pluggable decide function for benchmark / diagnostic callers. When
/// `LoopParams::decide_override` is `Some(fn)`, the iter's posture-policy
/// block calls this instead of `posture_policy::decide` — and fires
/// EVERY iter (no `posture_next_decision_at` gating), so callers can
/// schedule actions at exact scheduler-event timing instead of
/// pre-iter script application that scheduler-advance can skip past.
///
/// Used by `posture_benchmark.rs` to make brute-force enumeration match
/// the natural policy decision timing — eliminates the 0.5-1s mis-timing
/// artifact that produced "policy > brute-force" capture %.
///
/// Signature: `fn(self_side, opp_side, time, is_attacker) -> PostureAction`.
pub(super) type DecideOverrideFn<'a> = dyn Fn(&CombatSide, &CombatSide, f64, bool) -> super::posture_policy::PostureAction + 'a;

/// Pluggable bite-variant resolver. When `LoopParams::decide_bite_variant_override`
/// is `Some(fn)`, [`super::phases::process_phase_10_11_melee`] consults
/// the override BEFORE the regular `Dynamic`-mode policy path — used by
/// the bite-variant benchmark to script per-bite variants AND by the
/// engine-replay bite-variant decision to install a `BiteVariantReplayer`
/// plan in the inner replay.
///
/// Signature: `fn(self_side, opp_side, time, is_attacker) ->
/// &'static str` (returns `PRIMARY_VARIANT` / `SECONDARY_VARIANT`).
/// Sequence tracking (n-th bite from decision moment) is the
/// closure's responsibility — wrap a `Cell<u32>` if you need it.
pub(super) type BiteVariantOverrideFn<'a> =
    dyn Fn(&CombatSide, &CombatSide, f64, bool) -> &'static str + 'a;

/// Per-iteration hooks for non-live callers (sandbox in Manual mode,
/// future projector). Default is "no hooks" — the live driver passes
/// `IterHooks::default()` and sees byte-identical behaviour.
#[derive(Clone, Copy, Debug, Default)]
pub(super) struct IterHooks {
    /// If `Some(t)`, the iter aborts immediately AFTER the scheduler
    /// runs if `state.time > t + 1e-9`, reverting `state.time` and
    /// `state.same_time_processed_phases` to their pre-scheduler values.
    /// Used by sandbox's `step_to_time_forward` to walk events up to a
    /// user-requested target without overshooting.
    pub bound: Option<f64>,

    /// If true, before the scheduler runs, set `state.a.next_hit = INFINITY`
    /// and `state.b.next_hit = INFINITY`, then restore the originals after
    /// the scheduler returns. Used by sandbox Manual mode to prevent the
    /// scheduler from anchoring at `next_hit = 0`.
    pub suppress_bite_in_scheduler: bool,

    /// Symmetric to `suppress_bite_in_scheduler` for `next_breath`.
    pub suppress_breath_in_scheduler: bool,
}

/// Owned, mutable per-fight state. The caller (live driver, sandbox,
/// projector) builds one of these, then calls
/// `run_one_event_loop_iter` repeatedly until the predicate
/// `state.time <= params.max_time_sec && (state.a.death_time.is_none() || state.b.death_time.is_none())`
/// is false.
#[derive(Clone)]
pub(super) struct LoopState {
    pub a: CombatSide,
    pub b: CombatSide,
    pub combat_log: Vec<CombatLogEntry>,
    pub counters: DamageCounters,
    pub time: f64,
    pub same_time_processed_phases: u32,
    pub user_iteration_index: u32,
    pub hp_a_at_b_death: Option<f64>,
    pub hp_b_at_a_death: Option<f64>,
    pub bite_count_a: u32,
    pub bite_count_b: u32,
    pub breath_tick_count_a: u32,
    pub breath_tick_count_b: u32,
    pub regen_ticks_a: u32,
    pub regen_ticks_b: u32,
    pub regen_healed_a: f64,
    pub regen_healed_b: f64,
    pub warden_rage_events_a: Vec<String>,
    pub warden_rage_events_b: Vec<String>,
    pub ability_timing_events_a: Vec<String>,
    pub ability_timing_events_b: Vec<String>,
    pub fortify_control: FortifySimulationControl,
}

/// Borrowed, immutable per-fight parameters. Plus iteration-control
/// flags that vary by caller.
pub(super) struct LoopParams<'a> {
    pub attacker: &'a SimpleCombatantStats,
    pub defender: &'a SimpleCombatantStats,
    pub attacker_breath: Option<&'a SimpleBreathProfile>,
    pub defender_breath: Option<&'a SimpleBreathProfile>,
    pub config: &'a ComposableAbilityConfig,
    pub flags: &'a ComposableLoopFlags,
    pub ability_policy: SimpleAbilityTimingMode,
    pub event_phase_order: &'a [OrderedEventPhase],
    pub record_trace: bool,
    pub max_time_sec: f64,
    /// True for live driver (counts into global benchmark counter).
    /// False for sandbox + projector (must not pollute benchmarks).
    pub bench_count: bool,
    pub posture_policy_override: PosturePolicyMode,
    /// Per-iter hooks for non-live callers; default is no-op so the
    /// live driver sees byte-identical behaviour.
    pub iter_hooks: IterHooks,
    /// Optional override of the posture-policy `decide()` function. When
    /// `Some(fn)`, the iter calls `fn` instead of the live policy path.
    /// Used by `posture_benchmark` for brute-force script enumeration
    /// AND by `stance_bridge::decide_stance_now` for engine-replay.
    /// Live driver / sandbox leave this `None`.
    pub decide_override: Option<&'a DecideOverrideFn<'a>>,
    /// When `decide_override` is `Some`, controls whether the override
    /// is consulted EVERY iter (false — brute-force script timing) or
    /// only at the side's `posture_next_decision_at` like the live
    /// scheduler (true — engine-replay inside policy evaluation).
    ///
    /// Engine-replay uses `true` so the inner-replay trajectory matches
    /// what the live outer engine could actually realise — closures
    /// don't get every-iter "phantom" fires at moments the outer
    /// schedule can never reach (e.g., narrow pre-tick window when the
    /// outer is on 5 s periodic cadence in regen-unaware mode).
    pub decide_override_respects_schedule: bool,
    /// Optional per-bite variant resolver. When `Some(fn)`,
    /// `process_phase_10_11_melee` consults the override at each bite
    /// event (for the firing side) before falling back to the
    /// configured `bite_variant_mode`. Used by:
    ///   - The bite-variant benchmark (TS-side scripted per-bite
    ///     variants for greedy / beam search).
    ///   - The engine-replay bite-variant decision's inner replay
    ///     (installs a candidate plan for the duration of the
    ///     projection).
    ///     Live driver / sandbox leave this `None`.
    pub decide_bite_variant_override: Option<&'a BiteVariantOverrideFn<'a>>,
}

/// Layer `ModifyStat` overrides onto an effective-stats struct. Each numeric
/// field consults `effective_stat_value` against the side's `user_extras`.
/// With no `modifier.*` keys present every call is an identity, so the struct
/// stays byte-identical to its input — the cascade-safety invariant the whole
/// effective-stats seam rests on.
///
/// Boolean / vec / nested fields aren't layered here (set/add/mul semantics
/// don't generalize). v2-plan Phase 2: the field set reached full numeric
/// coverage at the step-7 hoist — `health` (= max_hp, the `modify_stat` field
/// name per STATS_FIELDS) and `active_cooldown_multiplier` became uniformly
/// modifiable once `ctx` points at `eff` from Phase 4 onward. The 4
/// base-identity `health` reads (seed hp in side.rs, start-hp% + summary
/// max_hp in mod.rs) read raw params/stats directly — NOT `ctx` — so they
/// stay base automatically and are untouched here.
fn apply_stat_modifiers(
    eff: &mut SimpleCombatantStats,
    extras: &std::collections::BTreeMap<String, crate::policy::state::PolicyValue>,
    time: f64,
) {
    use crate::effects::effective_stat_value as esv;
    eff.damage = esv(eff.damage, "damage", extras, time);
    eff.bite_cooldown = esv(eff.bite_cooldown, "bite_cooldown", extras, time).max(0.1);
    eff.weight = esv(eff.weight, "weight", extras, time).max(1.0);
    eff.health_regen = esv(eff.health_regen, "health_regen", extras, time).max(0.0);
    eff.damage2 = esv(eff.damage2, "damage2", extras, time).max(0.0);
    eff.hunker_reduction_pct = esv(eff.hunker_reduction_pct, "hunker_reduction_pct", extras, time);
    // Unclamped: a negative effective resistance is a coherent "breath
    // vulnerability" debuff; the consumer floors (1 - resistance) at 0.
    eff.breath_resistance = esv(eff.breath_resistance, "breath_resistance", extras, time);
    eff.unbreakable_damage_cap_pct = esv(eff.unbreakable_damage_cap_pct, "unbreakable_damage_cap_pct", extras, time).max(0.0);
    eff.first_strike_pct = esv(eff.first_strike_pct, "first_strike_pct", extras, time);
    // Berserk cadence fields (step 5). Unclamped — the cadence helper guards
    // each arm with a `> 0.0` check, so a zero/negative disables that arm.
    eff.berserk_bite_cooldown_multiplier = esv(eff.berserk_bite_cooldown_multiplier, "berserk_bite_cooldown_multiplier", extras, time);
    eff.berserk_hp_ratio_threshold = esv(eff.berserk_hp_ratio_threshold, "berserk_hp_ratio_threshold", extras, time);
    // step-7 hoist: max_hp (`health`) floored at 1.0 to keep ratio
    // denominators safe (mirrors the raw `.max(1.0)` reads); and
    // active_cooldown_multiplier (scale_active_cooldown reads it off the
    // stats it's handed, which is now `eff` in every post-Phase-3 phase).
    eff.health = esv(eff.health, "health", extras, time).max(1.0);
    eff.active_cooldown_multiplier = esv(eff.active_cooldown_multiplier, "active_cooldown_multiplier", extras, time);
    // Phase 8 closeout: the last numeric fields. Each is read at its LIVE
    // consumption site from the eff struct (ctx.attacker/ctx.defender, which
    // are eff post the step-7 hoist), colocated with an already-routed field —
    // so routing here takes effect consistently with the rest of the set:
    //   damage_taken_multiplier_on_being_bitten → combat.rs melee helpers +
    //     effects.rs deal_typed (beside first_strike_pct / breath_resistance);
    //   first_strike_hp_ratio_threshold → combat.rs melee + conditional gates
    //     (beside first_strike_pct);
    //   quick_recovery_hp_ratio_threshold → effective_hp_regen_multiplier in
    //     the live regen tick (beside health_regen / health);
    //   plushie_reflect_avg_pct → apply_direct_damage_with_reflect in the live
    //     damage phases (beside unbreakable_damage_cap_pct).
    // Unclamped — every consumer guards (`> 0.0`) or clamps (`.max(0.0)`).
    eff.damage_taken_multiplier_on_being_bitten = esv(
        eff.damage_taken_multiplier_on_being_bitten,
        "damage_taken_multiplier_on_being_bitten",
        extras,
        time,
    );
    eff.first_strike_hp_ratio_threshold =
        esv(eff.first_strike_hp_ratio_threshold, "first_strike_hp_ratio_threshold", extras, time);
    eff.quick_recovery_hp_ratio_threshold =
        esv(eff.quick_recovery_hp_ratio_threshold, "quick_recovery_hp_ratio_threshold", extras, time);
    eff.plushie_reflect_avg_pct =
        esv(eff.plushie_reflect_avg_pct, "plushie_reflect_avg_pct", extras, time);
}

#[allow(clippy::too_many_arguments)]
pub(super) fn run_one_event_loop_iter(
    state: &mut LoopState,
    params: &LoopParams<'_>,
) -> LoopOutcome {
    if params.bench_count {
        crate::bench_counters::inc_loop_iteration();
    }
    // Round 36 / A10: reset per-iteration damage-kind bitmasks so
    // bite/breath/dot flags only reflect what happened in THIS
    // tick. Phases that deal damage OR-set the relevant bit.
    state.a.iter_damage_kinds_taken = 0;
    state.a.iter_damage_kinds_dealt = 0;
    state.b.iter_damage_kinds_taken = 0;
    state.b.iter_damage_kinds_dealt = 0;
    // Round 37 / A7: reset healing accumulator + snapshot the
    // user_active_until map for end-of-iter diff. We snapshot
    // ONLY keys whose value is > current time (still-active windows);
    // keys already in the past contribute nothing to OnActiveEnd.
    state.a.iter_healing_taken = 0.0;
    state.b.iter_healing_taken = 0.0;
    // Round 43 / A10b: reset raw-damage accumulators so
    // event.raw_damage / event.prevented_damage in OnTakeDamage /
    // OnDealDamage triggers reflect only THIS iteration.
    state.a.iter_raw_damage_taken = 0.0;
    state.a.iter_raw_damage_dealt = 0.0;
    state.b.iter_raw_damage_taken = 0.0;
    state.b.iter_raw_damage_dealt = 0.0;
    state.a.iter_user_active_until_pre.clear();
    state.b.iter_user_active_until_pre.clear();
    if !params.attacker.user_ability_ids.is_empty() {
        for (id, until) in &state.a.user_active_until {
            if *until > state.time {
                state.a.iter_user_active_until_pre.insert(id.clone(), *until);
            }
        }
    }
    if !params.defender.user_ability_ids.is_empty() {
        for (id, until) in &state.b.user_active_until {
            if *until > state.time {
                state.b.iter_user_active_until_pre.insert(id.clone(), *until);
            }
        }
    }
    // v2 Phase 4 (G5): mirror the user-window snapshot for BUILT-IN active
    // windows so OnActiveEnd fires when a built-in buff (Fortify, Harden,
    // Adrenaline, etc.) lapses this iteration. Gated on user abilities — the
    // only consumer of the trigger — so the no-user-ability hot path is
    // untouched.
    state.a.iter_builtin_active_until_pre.clear();
    state.b.iter_builtin_active_until_pre.clear();
    if !params.attacker.user_ability_ids.is_empty() {
        for (id, until) in state.a.builtin_active_windows() {
            if until > state.time {
                state.a.iter_builtin_active_until_pre.insert(id, until);
            }
        }
    }
    if !params.defender.user_ability_ids.is_empty() {
        for (id, until) in state.b.builtin_active_windows() {
            if until > state.time {
                state.b.iter_builtin_active_until_pre.insert(id, until);
            }
        }
    }
    // Tier-3: surface iteration counter to user expressions via
    // PolicySide.extras["combat.iteration_count"]. Only written
    // when at least one side has user abilities — keeps the
    // hot path branch-free for the no-user-ability case.
    if !params.attacker.user_ability_ids.is_empty() || !params.defender.user_ability_ids.is_empty() {
        let value = crate::policy::state::PolicyValue::Number(state.user_iteration_index as f64);
        state.a.user_extras
            .insert("combat.iteration_count".to_string(), value.clone());
        state.b.user_extras
            .insert("combat.iteration_count".to_string(), value);
    }
    state.user_iteration_index = state.user_iteration_index.saturating_add(1);
    // Sprint 5.x: drain any pending requests user effects wrote
    // into user_extras (next_hit_floor, breath_consume_pending,
    // breath_restore_pending) into the corresponding CombatSide
    // fields before the scheduler reads them.
    if !params.attacker.user_ability_ids.is_empty() {
        user_dispatch::drain_user_extras_into_combat_side(&mut state.a);
    }
    if !params.defender.user_ability_ids.is_empty() {
        user_dispatch::drain_user_extras_into_combat_side(&mut state.b);
    }
    // Phase 9 (programmable statuses): does either side carry a dynamic
    // (hook- / Expr-bearing) user status this iteration? Gates the entire
    // status-hook surface below. False ⇒ byte-identical — built-in /
    // parametric-only statuses never reach it (the check short-circuits on
    // the `user.` id prefix).
    let track_status_hooks = user_status_dispatch::side_has_dynamic_user_status(&state.a)
        || user_status_dispatch::side_has_dynamic_user_status(&state.b);
    // v2 step 7 (FormSwap): reverse HP reconciliation when a temporary
    // form's stat modifiers have expired. Time-based + idempotent — fires
    // once when `state.time` crosses the stored `form_revert.until`. Gated
    // on either side having user abilities (the only way a form marker can
    // exist); a FormSwap targeting the opponent stamps the marker on the
    // opponent's extras, so both sides are checked. Also runs when a dynamic
    // status is present: a status's on_apply may install a finite-duration
    // FormSwap whose timer-revert lives here.
    if !params.attacker.user_ability_ids.is_empty()
        || !params.defender.user_ability_ids.is_empty()
        || track_status_hooks
    {
        crate::effects::process_form_revert(&mut state.a.user_extras, &mut state.a.hp, params.attacker.health, state.time);
        crate::effects::process_form_revert(&mut state.b.user_extras, &mut state.b.hp, params.defender.health, state.time);
    }
    // Phase 9: resolve Expr-overridden status knobs for this iteration so the
    // damage / regen / cooldown seams read the resolved value (cached on each
    // instance). Only statuses with Expr overrides cache anything; others
    // clear to None ⇒ static knobs ⇒ byte-identical.
    if track_status_hooks {
        user_status_dispatch::resolve_expr_scalars_for_side(
            &mut state.a, params.attacker, &state.b, params.defender, state.time,
        );
        user_status_dispatch::resolve_expr_scalars_for_side(
            &mut state.b, params.defender, &state.a, params.attacker, state.time,
        );
    }
    // Larger Tier A: drain due scheduled effects. Both sides may
    // have queues from prior `ScheduleEffect` calls; fire any
    // whose due_at has elapsed. Gated behind the user-ability
    // check (no scheduled effects without user abilities).
    if !params.attacker.user_ability_ids.is_empty() {
        user_dispatch::drain_due_scheduled_effects_for_caster(
            &mut state.a, &mut state.b, params.attacker, params.defender,
            state.time, &mut state.combat_log, params.record_trace, "A",
        );
    }
    if !params.defender.user_ability_ids.is_empty() {
        user_dispatch::drain_due_scheduled_effects_for_caster(
            &mut state.b, &mut state.a, params.defender, params.attacker,
            state.time, &mut state.combat_log, params.record_trace, "B",
        );
    }
    // Sprint 5.5: snapshot HP at the start of each iteration so
    // we can fire damage triggers (on_take_damage / on_deal_damage)
    // by comparing post-iteration HP against this baseline. Only
    // computed when at least one side has user abilities attached
    // — keeps the no-user-ability hot path branch-free past this
    // point. Damage-event identity (which exact source dealt the
    // damage) is intentionally lost in this coarse observer; the
    // engine emits one `on_take_damage` / `on_deal_damage` trigger
    // per side per iteration with the summed delta.
    let track_damage_triggers =
        !params.attacker.user_ability_ids.is_empty() || !params.defender.user_ability_ids.is_empty();
    // Phase 9: status-hook dispatch needs the same pre-iteration snapshots
    // (apply/expire diff + HP baseline for teardown reconcile), so widen the
    // snapshot gate to `track_damage_triggers || track_status_hooks`.
    let track_reactive = track_damage_triggers || track_status_hooks;
    let hp_a_pre = if track_reactive { state.a.hp } else { 0.0 };
    let hp_b_pre = if track_reactive { state.b.hp } else { 0.0 };
    // Status snapshots for on_status_apply / on_status_expire
    // triggers. Cheap (BTreeMap clone of keys only) and gated
    // behind the reactive check to keep the no-user path
    // allocation-free.
    let status_keys_a_pre: Option<std::collections::BTreeSet<String>> =
        if track_reactive {
            Some(state.a.statuses.keys().cloned().collect())
        } else {
            None
        };
    let status_keys_b_pre: Option<std::collections::BTreeSet<String>> =
        if track_reactive {
            Some(state.b.statuses.keys().cloned().collect())
        } else {
            None
        };
    // Phase 9: per-side snapshot of carried `user.` status stack counts, for the
    // on_decay (stacks dropped while surviving) / on_restack (stacks gained)
    // diff in phase 16. Only `user.` statuses can carry those hooks, so snapshot
    // just those; gated on `track_status_hooks` (tighter than `track_reactive`).
    let status_stacks_a_pre: Option<std::collections::BTreeMap<String, f64>> =
        if track_status_hooks {
            Some(
                state.a.statuses.iter()
                    .filter(|(k, _)| k.starts_with("user."))
                    .map(|(k, v)| (k.clone(), v.stacks))
                    .collect(),
            )
        } else {
            None
        };
    let status_stacks_b_pre: Option<std::collections::BTreeMap<String, f64>> =
        if track_status_hooks {
            Some(
                state.b.statuses.iter()
                    .filter(|(k, _)| k.starts_with("user."))
                    .map(|(k, v)| (k.clone(), v.stacks))
                    .collect(),
            )
        } else {
            None
        };
    // First-strike state at start (post-iteration we'll
    // compare). first_strike_active = (hp_ratio >= threshold)
    // when first_strike_pct > 0; else permanently false.
    let first_strike_a_pre = compute_first_strike_active(params.attacker, state.a.hp);
    let first_strike_b_pre = compute_first_strike_active(params.defender, state.b.hp);
    // Death state at start — used for on_kill detection.
    let death_a_pre = state.a.death_time.is_some();
    let death_b_pre = state.b.death_time.is_some();
    // Phase 1: schedule next event + select phase. See `process_phase_1_scheduler`.
    let scheduler_flags = SchedulerPassiveFlags {
        has_any_thorn_trap: params.flags.has_any_thorn_trap,
        has_any_toxic_trap: params.flags.has_any_toxic_trap,
        has_any_frost_snare: params.flags.has_any_frost_snare,
        has_any_poison_area: params.flags.has_any_poison_area,
        has_any_yolk_bomb: params.flags.has_any_yolk_bomb,
        has_any_divination: params.flags.has_any_divination,
        has_any_aura: params.flags.has_any_aura,
        has_any_healing_step: params.flags.has_any_healing_step,
        has_any_healing_pulse: params.flags.has_any_healing_pulse,
        has_any_damage_trail: params.flags.has_any_damage_trail,
        has_any_active_ability: params.flags.has_any_active_ability,
        has_any_fortify: params.flags.has_any_fortify,
    };
    // Save pre-scheduler time + phase mask so we can revert if the
    // bound hook fires. Restored next_hit/next_breath values are
    // captured here so the post-scheduler restore stays inside the
    // same scope.
    let time_pre_scheduler = state.time;
    let phase_mask_pre_scheduler = state.same_time_processed_phases;
    let saved_a_next_hit = if params.iter_hooks.suppress_bite_in_scheduler {
        let v = state.a.next_hit;
        state.a.next_hit = f64::INFINITY;
        Some(v)
    } else {
        None
    };
    let saved_b_next_hit = if params.iter_hooks.suppress_bite_in_scheduler {
        let v = state.b.next_hit;
        state.b.next_hit = f64::INFINITY;
        Some(v)
    } else {
        None
    };
    let saved_a_next_breath = if params.iter_hooks.suppress_breath_in_scheduler {
        let v = state.a.next_breath;
        state.a.next_breath = f64::INFINITY;
        Some(v)
    } else {
        None
    };
    let saved_b_next_breath = if params.iter_hooks.suppress_breath_in_scheduler {
        let v = state.b.next_breath;
        state.b.next_breath = f64::INFINITY;
        Some(v)
    } else {
        None
    };
    // Posture-decision snap is meaningful only when posture decisions
    // are scheduled by `schedule_next_posture_decision`. In brute-
    // force script mode (`decide_override = Some` +
    // `decide_override_respects_schedule = false`) that function is
    // never called, so `posture_next_decision_at` stays at its initial
    // 0; passing the snap flag in that mode would loop the scheduler
    // forever at t=0.
    let posture_snap_enabled =
        params.decide_override.is_none() || params.decide_override_respects_schedule;
    let scheduler_result = process_phase_1_scheduler(
        &mut state.a,
        &mut state.b,
        params.attacker,
        params.defender,
        params.config,
        &mut state.combat_log,
        params.record_trace,
        &mut state.time,
        &mut state.same_time_processed_phases,
        params.event_phase_order,
        params.max_time_sec,
        &state.fortify_control,
        &scheduler_flags,
        posture_snap_enabled,
    );
    // Restore suppressed event times so post-scheduler phases and the
    // public snapshot view see the user-facing readiness state.
    if let Some(v) = saved_a_next_hit {
        state.a.next_hit = v;
    }
    if let Some(v) = saved_b_next_hit {
        state.b.next_hit = v;
    }
    if let Some(v) = saved_a_next_breath {
        state.a.next_breath = v;
    }
    if let Some(v) = saved_b_next_breath {
        state.b.next_breath = v;
    }
    // Bound check — if the scheduler advanced past the user-requested
    // target, revert the state mutations and signal the caller.
    if let Some(b) = params.iter_hooks.bound {
        if state.time > b + 1e-9 {
            state.time = time_pre_scheduler;
            state.same_time_processed_phases = phase_mask_pre_scheduler;
            return LoopOutcome::BoundExceeded;
        }
    }
    let selected_phase = match scheduler_result {
        SchedulerStep::Break => return LoopOutcome::Break,
        SchedulerStep::ContinueLoop => return LoopOutcome::Continue,
        SchedulerStep::Proceed { selected_phase } => selected_phase,
    };

    // First Tick Rule (ailments half): snapshot DoT statuses BEFORE any
    // status-mutating phase runs this iteration. `sweep_first_ailment_tick`
    // below uses the diff between snapshot and post-iteration state to
    // detect natural clearance and freshly applied DoTs.
    //
    // Perf gate: snapshot computation allocates a BTreeSet<String> with
    // per-entry String clones — up to 4 heap allocs per loop iteration.
    // `status_last_cleared_at` (the only output the snapshot feeds) is
    // read solely by the rearm check inside `sweep_first_ailment_tick`
    // when `first_tick_ailments` is enabled. If the flag is off for a
    // given side we can skip the snapshot AND the sweep for that side
    // entirely — Compare enables this flag, BB never does.
    let snapshot_a_dots = if params.config.attacker_compare_first_tick_ailments {
        snapshot_dot_status_keys(&state.a.statuses)
    } else {
        BTreeSet::new()
    };
    let snapshot_b_dots = if params.config.defender_compare_first_tick_ailments {
        snapshot_dot_status_keys(&state.b.statuses)
    } else {
        BTreeSet::new()
    };

    // Mirror TS stateTickRuntime.ts:297 `if (time <= state.lastUpdateAt) return;`
    // guard — both sides start with lastUpdateAt=0, so the very first tick at
    // t=0 must skip ability-policy decisions (HC, UR, LL). Bites/DoT/breath
    // still fire; only policy evaluation is deferred to the next tick, which
    // then sees post-first-bite HPs.
    let is_initial_tick = state.time <= 1e-9;

    // Phase posture-settle: if a side has a pending posture
    // transition whose completion time has elapsed, promote
    // `posture_current = posture_pending` BEFORE Phase 2 reads
    // multipliers for the iteration. Idempotent on settled sides.
    // The actual "start a transition" call comes from the posture
    // policy (Phase 3 of the posture roadmap); this settle phase
    // only consumes scheduled transitions.
    crate::composable::posture::process_posture_settle(
        &mut state.a, state.time, &mut state.combat_log, params.record_trace, "A",
    );
    crate::composable::posture::process_posture_settle(
        &mut state.b, state.time, &mut state.combat_log, params.record_trace, "B",
    );

    // Phase posture-policy: invoke per-side. The policy is
    // self-pacing — it advances `posture_next_decision_at` itself,
    // so the body here is a thin "due check + run + reschedule"
    // wrapper. The decision delegates to `decide_via_replay`, which
    // clones state and runs the engine forward ~17 s per candidate
    // (Stay / StartSit / StartLay / StandUp / sit↔lay swap). Cost
    // ~2.4× live loop on policy-on fights; zero on policy-off fights.
    // RegenAware vs RegenUnaware only affects WHEN decisions fire
    // (scheduling), not how candidates are scored — the projector
    // uses engine math directly, so regen-bonus is always honored
    // if the candidate's lay-window actually catches a tick.
    if !matches!(params.posture_policy_override, PosturePolicyMode::ForcedOff) {
        // Attacker (A) decision.
        // When `decide_override` is Some: fire every iter, no schedule
        //   gating — the override closure encodes both "what" and "when".
        //   Used by benchmark to apply scripted actions at exact
        //   scheduler-event timing (matches policy's natural timing).
        // Else: standard Module A gating via posture_next_decision_at.
        // Decide whether the side fires this iter. The two override
        // modes diverge:
        //   - override Some + respects_schedule=false (brute-force):
        //     every iter, closure applies its script.
        //   - override Some + respects_schedule=true (engine-replay):
        //     only at scheduled moments, mimicking live cadence.
        //   - override None: live policy, scheduled moments only.
        let a_scheduled = state.time + 1e-9 >= state.a.posture_next_decision_at;
        let a_fire = params.config.attacker_posture_policy_enabled
            && match (params.decide_override.is_some(), params.decide_override_respects_schedule) {
                (true, false) => true,
                _ => a_scheduled,
            };
        if a_fire {
            let action = if let Some(decide_fn) = params.decide_override {
                decide_fn(&state.a, &state.b, state.time, /* is_attacker */ true)
            } else {
                super::stance_bridge::decide_stance_now(
                    state, params, /* self_is_attacker */ true,
                )
            };
            apply_policy_action(
                &mut state.a, action, state.time, &mut state.combat_log, params.record_trace, "A",
            );
            if params.decide_override.is_none() || params.decide_override_respects_schedule {
                schedule_next_posture_decision(
                    &mut state.a, params.attacker, state.time,
                    params.config.attacker_posture_policy_regen_aware,
                );
            }
        }
        // Defender (B) decision.
        let b_scheduled = state.time + 1e-9 >= state.b.posture_next_decision_at;
        let b_fire = params.config.defender_posture_policy_enabled
            && match (params.decide_override.is_some(), params.decide_override_respects_schedule) {
                (true, false) => true,
                _ => b_scheduled,
            };
        if b_fire {
            let action = if let Some(decide_fn) = params.decide_override {
                decide_fn(&state.b, &state.a, state.time, /* is_attacker */ false)
            } else {
                super::stance_bridge::decide_stance_now(
                    state, params, /* self_is_attacker */ false,
                )
            };
            apply_policy_action(
                &mut state.b, action, state.time, &mut state.combat_log, params.record_trace, "B",
            );
            if params.decide_override.is_none() || params.decide_override_respects_schedule {
                schedule_next_posture_decision(
                    &mut state.b, params.defender, state.time,
                    params.config.defender_posture_policy_regen_aware,
                );
            }
        }
    }

    // v2-plan Phase 2 step 7 (hoist): effective-stats references threaded
    // through ALL phases. Initialized to raw params; reassigned to stage-1
    // eff after Phase 3 (modify_stat fields incl. max_hp=`health` +
    // active_cooldown_multiplier) and to stage-2 eff after Phase 4p
    // (activation weight bonuses + has_reflect, which only materialize
    // post-4p). Phases that run before the stage-1 reassign see
    // `eff_a == params.attacker` (same reference) — byte-identical.
    let eff_a_stage1_owned: SimpleCombatantStats;
    let eff_b_stage1_owned: SimpleCombatantStats;
    let eff_a_stage2_owned: SimpleCombatantStats;
    let eff_b_stage2_owned: SimpleCombatantStats;
    let (mut eff_a, mut eff_b): (&SimpleCombatantStats, &SimpleCombatantStats) =
        (params.attacker, params.defender);

    // Phase 2 + 2b: pre-step state. See `process_phase_2_pre_step`.
    {
        let mut ctx = PhaseContext {
            time: state.time,
            attacker: eff_a,
            defender: eff_b,
            attacker_breath: params.attacker_breath,
            defender_breath: params.defender_breath,
            config: params.config,
            record_trace: params.record_trace,
            a: &mut state.a,
            b: &mut state.b,
            combat_log: &mut state.combat_log,
        };
        process_phase_2_pre_step(&mut ctx);
    }

    if selected_phase == OrderedEventPhase::StatusDecay {
        // Phase 2.5 + Phase 3 + Phase 3c. See `process_phase_status_decay_gate`.
        let mut ctx = PhaseContext {
            time: state.time,
            attacker: eff_a,
            defender: eff_b,
            attacker_breath: params.attacker_breath,
            defender_breath: params.defender_breath,
            config: params.config,
            record_trace: params.record_trace,
            a: &mut state.a,
            b: &mut state.b,
            combat_log: &mut state.combat_log,
        };
        process_phase_status_decay_gate(&mut ctx);
    }

    if selected_phase == OrderedEventPhase::ActiveAbilities {
        // Phase 3b + 3b2 + 3c. See `process_phase_3_activations`.
        let mut ctx = PhaseContext {
            time: state.time,
            attacker: eff_a,
            defender: eff_b,
            attacker_breath: params.attacker_breath,
            defender_breath: params.defender_breath,
            config: params.config,
            record_trace: params.record_trace,
            a: &mut state.a,
            b: &mut state.b,
            combat_log: &mut state.combat_log,
        };
        process_phase_3_activations(&mut ctx, params.flags.has_any_rewind, params.ability_policy, &mut state.fortify_control);
    }

    // Placeholder — eff_a / eff_b are computed after Phase 4p (Reflect
    // activation) so has_reflect sees the fresh activation window.
    let has_any_harden = params.config.attacker_harden || params.config.defender_harden;
    // Defensive_Status (Broodwatcher) gives +10% weight when present. We
    // check the statuses map here so the Rust engine respects TS parity
    // even without a dedicated Broodwatcher config toggle.
    let a_has_defensive = state.a
        .statuses
        .get("Defensive_Status")
        .map(|i| i.stacks > 0.0 && i.remaining_sec > 0.0)
        .unwrap_or(false);
    let b_has_defensive = state.b
        .statuses
        .get("Defensive_Status")
        .map(|i| i.stacks > 0.0 && i.remaining_sec > 0.0)
        .unwrap_or(false);
    let needs_eff_override = params.flags.has_any_fortify
        || has_any_harden
        || params.config.attacker_reflect
        || params.config.defender_reflect
        || params.attacker.has_reflect
        || params.defender.has_reflect
        || (state.a.gourmandizer_weight_factor - 1.0).abs() > 1e-9
        || (state.b.gourmandizer_weight_factor - 1.0).abs() > 1e-9
        || a_has_defensive
        || b_has_defensive
        // Sprint 5.6: any user_extras key under modifier.*
        // forces eff-override so the effective-stat readers
        // pick up the modifier.
        || state.a.user_extras.keys().any(|k| k.starts_with(crate::effects::MODIFIER_KEY_PREFIX))
        || state.b.user_extras.keys().any(|k| k.starts_with(crate::effects::MODIFIER_KEY_PREFIX));

    // Stage 1: layer modify_stat fields onto eff now that Phase 3 activations
    // have run (so this-iteration trigger writes are visible). Weight bonuses
    // / has_reflect are activation-derived and only settle by Phase 4p, so
    // they're deferred to stage 2 — pre-4p phases don't read them.
    if needs_eff_override {
        let mut a_eff = params.attacker.clone();
        let mut b_eff = params.defender.clone();
        apply_stat_modifiers(&mut a_eff, &state.a.user_extras, state.time);
        apply_stat_modifiers(&mut b_eff, &state.b.user_extras, state.time);
        eff_a_stage1_owned = a_eff;
        eff_b_stage1_owned = b_eff;
        eff_a = &eff_a_stage1_owned;
        eff_b = &eff_b_stage1_owned;
    }

    if selected_phase == OrderedEventPhase::ActiveAbilities {
    // Phase 4: Hunker decisions. See `process_phase_4_hunker_decisions`.
    {
        let mut ctx = PhaseContext {
            time: state.time,
            attacker: eff_a,
            defender: eff_b,
            attacker_breath: params.attacker_breath,
            defender_breath: params.defender_breath,
            config: params.config,
            record_trace: params.record_trace,
            a: &mut state.a,
            b: &mut state.b,
            combat_log: &mut state.combat_log,
        };
        process_phase_4_hunker_decisions(
            &mut ctx,
            params.flags.has_any_hunker,
            params.flags.attacker_hunker_enabled,
            params.flags.defender_hunker_enabled,
            params.ability_policy,
            params.flags.hunker_decision_cadence_sec,
        );
    }
    // Phase 4b + 4b-bis: Trap clusters. See `process_phase_4_traps_cluster`.
    {
        let mut ctx = PhaseContext {
            time: state.time,
            attacker: eff_a,
            defender: eff_b,
            attacker_breath: params.attacker_breath,
            defender_breath: params.defender_breath,
            config: params.config,
            record_trace: params.record_trace,
            a: &mut state.a,
            b: &mut state.b,
            combat_log: &mut state.combat_log,
        };
        process_phase_4_traps_cluster(&mut ctx, params.flags.has_any_thorn_trap, params.flags.has_any_toxic_trap);
    }

    // Phase 4c + 4c-bis + 4c-ter + 4c-quat: Areas cluster. See `process_phase_4_areas_cluster`.
    {
        let mut ctx = PhaseContext {
            time: state.time,
            attacker: eff_a,
            defender: eff_b,
            attacker_breath: params.attacker_breath,
            defender_breath: params.defender_breath,
            config: params.config,
            record_trace: params.record_trace,
            a: &mut state.a,
            b: &mut state.b,
            combat_log: &mut state.combat_log,
        };
        process_phase_4_areas_cluster(
            &mut ctx,
            params.flags.has_any_frost_snare,
            params.flags.has_any_poison_area,
            params.flags.has_any_yolk_bomb,
            params.flags.has_any_divination,
        );
    }

    // Phase 4d + 4d-bis0: Aura + Damage Trails. See `process_phase_4_aura_and_trails_cluster`.
    {
        let mut ctx = PhaseContext {
            time: state.time,
            attacker: eff_a,
            defender: eff_b,
            attacker_breath: params.attacker_breath,
            defender_breath: params.defender_breath,
            config: params.config,
            record_trace: params.record_trace,
            a: &mut state.a,
            b: &mut state.b,
            combat_log: &mut state.combat_log,
        };
        process_phase_4_aura_and_trails_cluster(
            &mut ctx,
            params.flags.has_any_aura,
            params.flags.has_any_damage_trail,
            params.flags.attacker_aura_status,
            params.flags.defender_aura_status,
            &mut state.counters,
        );
    }

    // Phase 4d-bis + 4d-ter: Healing actives. See `process_phase_4_healing_actives_cluster`.
    {
        let mut ctx = PhaseContext {
            time: state.time,
            attacker: eff_a,
            defender: eff_b,
            attacker_breath: params.attacker_breath,
            defender_breath: params.defender_breath,
            config: params.config,
            record_trace: params.record_trace,
            a: &mut state.a,
            b: &mut state.b,
            combat_log: &mut state.combat_log,
        };
        process_phase_4_healing_actives_cluster(&mut ctx, params.flags.has_any_healing_step, params.flags.has_any_healing_pulse);
    }

    }

    let hunker_active_a = is_hunker_effect_active(state.a.hunker_on, state.a.hunker_effect_starts_at, state.time);
    let hunker_active_b = is_hunker_effect_active(state.b.hunker_on, state.b.hunker_effect_starts_at, state.time);

    if selected_phase == OrderedEventPhase::StatusTicks {
        // Phase 4d-quat: Healing Ailment ticks. See `process_phase_4_healing_ailment_tick`.
        let mut ctx = PhaseContext {
            time: state.time,
            attacker: eff_a,
            defender: eff_b,
            attacker_breath: params.attacker_breath,
            defender_breath: params.defender_breath,
            config: params.config,
            record_trace: params.record_trace,
            a: &mut state.a,
            b: &mut state.b,
            combat_log: &mut state.combat_log,
        };
        process_phase_4_healing_ailment_tick(&mut ctx);
    }

    if selected_phase == OrderedEventPhase::ActiveAbilities {
    // Phase 4e + 4f: Cursed Sigil + Drowsy Area. See `process_phase_4_status_applies_cluster`.
    {
        let mut ctx = PhaseContext {
            time: state.time,
            attacker: eff_a,
            defender: eff_b,
            attacker_breath: params.attacker_breath,
            defender_breath: params.defender_breath,
            config: params.config,
            record_trace: params.record_trace,
            a: &mut state.a,
            b: &mut state.b,
            combat_log: &mut state.combat_log,
        };
        process_phase_4_status_applies_cluster(&mut ctx);
    }

    // Phase 4g + 4h + 4i + 4j + 4k: delayed-activation policy actives.
    // See `process_phase_4_delayed_activations_cluster`.
    {
        let mut ctx = PhaseContext {
            time: state.time,
            attacker: eff_a,
            defender: eff_b,
            attacker_breath: params.attacker_breath,
            defender_breath: params.defender_breath,
            config: params.config,
            record_trace: params.record_trace,
            a: &mut state.a,
            b: &mut state.b,
            combat_log: &mut state.combat_log,
        };
        process_phase_4_delayed_activations_cluster(
            &mut ctx,
            params.ability_policy,
            is_initial_tick,
            &mut state.ability_timing_events_a,
            &mut state.ability_timing_events_b,
            &mut state.warden_rage_events_a,
            &mut state.warden_rage_events_b,
        );
    }

    // Phase 4la + 4l: Lich Mark + Spite. See `process_phase_4_lich_and_spite_cluster`.
    {
        let mut ctx = PhaseContext {
            time: state.time,
            attacker: eff_a,
            defender: eff_b,
            attacker_breath: params.attacker_breath,
            defender_breath: params.defender_breath,
            config: params.config,
            record_trace: params.record_trace,
            a: &mut state.a,
            b: &mut state.b,
            combat_log: &mut state.combat_log,
        };
        process_phase_4_lich_and_spite_cluster(&mut ctx);
    }

    // Phase 4m + 4n + 4o + 4p: tick-based actives. See `process_phase_4_tick_actives_cluster`.
    {
        let mut ctx = PhaseContext {
            time: state.time,
            attacker: eff_a,
            defender: eff_b,
            attacker_breath: params.attacker_breath,
            defender_breath: params.defender_breath,
            config: params.config,
            record_trace: params.record_trace,
            a: &mut state.a,
            b: &mut state.b,
            combat_log: &mut state.combat_log,
        };
        process_phase_4_tick_actives_cluster(
            &mut ctx,
            params.ability_policy,
            &mut state.counters,
            &mut state.ability_timing_events_a,
            &mut state.ability_timing_events_b,
        );
    }

    }

    // Stage 2: refresh eff AFTER Phase 4p so has_reflect sees the fresh
    // Reflect activation window and weight bonuses reflect post-activation
    // state (matching TS updateStateAt order). Rebuilds from raw params +
    // activation bonuses, then re-layers the modify_stat fields; reassigns
    // eff_a/eff_b for every post-4p phase. When `needs_eff_override` is
    // false, eff_a/eff_b stay pointed at raw params (byte-identical).
    if needs_eff_override {
        // Compose static weight factor: Gourmandizer (build-time or
        // dynamic) x Defensive_Status (+10% from Broodwatcher).
        let a_static = state.a.gourmandizer_weight_factor
            * crate::active_runtime::defensive_status_weight_factor(&state.a.statuses);
        let b_static = state.b.gourmandizer_weight_factor
            * crate::active_runtime::defensive_status_weight_factor(&state.b.statuses);
        let mut a_eff = with_active_weight_bonuses_and_static_factor(params.attacker, state.a.fortify_weight_bonus_until, state.a.harden_active_until, state.a.reflect_active_until, state.time, a_static);
        let mut b_eff = with_active_weight_bonuses_and_static_factor(params.defender, state.b.fortify_weight_bonus_until, state.b.harden_active_until, state.b.reflect_active_until, state.time, b_static);
        a_eff.has_reflect = params.config.attacker_reflect
            && state.a.reflect_active_until > 0.0
            && state.a.reflect_active_until > state.time;
        b_eff.has_reflect = params.config.defender_reflect
            && state.b.reflect_active_until > 0.0
            && state.b.reflect_active_until > state.time;
        apply_stat_modifiers(&mut a_eff, &state.a.user_extras, state.time);
        apply_stat_modifiers(&mut b_eff, &state.b.user_extras, state.time);
        eff_a_stage2_owned = a_eff;
        eff_b_stage2_owned = b_eff;
        eff_a = &eff_a_stage2_owned;
        eff_b = &eff_b_stage2_owned;
    }

    if selected_phase == OrderedEventPhase::ActiveAbilities {
    // Phase 4q + 4r + 4s + 4t + 4u: misc actives + cocoon. See `process_phase_4_misc_and_cocoon_cluster`.
    {
        let mut ctx = PhaseContext {
            time: state.time,
            attacker: eff_a,
            defender: eff_b,
            attacker_breath: params.attacker_breath,
            defender_breath: params.defender_breath,
            config: params.config,
            record_trace: params.record_trace,
            a: &mut state.a,
            b: &mut state.b,
            combat_log: &mut state.combat_log,
        };
        process_phase_4_misc_and_cocoon_cluster(&mut ctx, params.ability_policy, &mut state.counters);
    }

    }

    // Phase 5+6: Post-death regen + natural regen ticks.
    // See `process_phase_5_6_regen` — Phase 5 just notes that TS doesn't
    // disable regen for dead creatures (HP pinned to 1 at Phase 2 stays
    // pinned even as regen ticks).
    if selected_phase == OrderedEventPhase::Regen {
        let mut ctx = PhaseContext {
            time: state.time,
            attacker: eff_a,
            defender: eff_b,
            attacker_breath: params.attacker_breath,
            defender_breath: params.defender_breath,
            config: params.config,
            record_trace: params.record_trace,
            a: &mut state.a,
            b: &mut state.b,
            combat_log: &mut state.combat_log,
        };
        process_phase_5_6_regen(
            &mut ctx,
            &mut state.regen_healed_a,
            &mut state.regen_healed_b,
            &mut state.regen_ticks_a,
            &mut state.regen_ticks_b,
        );
    }

    // Phase 7: Self-Destruct passive. See `process_phase_7_self_destruct_passive`
    // for behaviour notes. Runs every iter regardless of `selected_phase`.
    {
        let mut ctx = PhaseContext {
            time: state.time,
            attacker: eff_a,
            defender: eff_b,
            attacker_breath: params.attacker_breath,
            defender_breath: params.defender_breath,
            config: params.config,
            record_trace: params.record_trace,
            a: &mut state.a,
            b: &mut state.b,
            combat_log: &mut state.combat_log,
        };
        process_phase_7_self_destruct_passive(&mut ctx, params.flags.has_any_self_destruct);
    }

    // Phase 8 (mid-loop death commit) deferred to Phase 16.

    if selected_phase == OrderedEventPhase::ActiveAbilities {
        // Phase 9: Lance aura ticks. See `process_phase_9_lance_aura`.
        let mut ctx = PhaseContext {
            time: state.time,
            attacker: eff_a,
            defender: eff_b,
            attacker_breath: params.attacker_breath,
            defender_breath: params.defender_breath,
            config: params.config,
            record_trace: params.record_trace,
            a: &mut state.a,
            b: &mut state.b,
            combat_log: &mut state.combat_log,
        };
        process_phase_9_lance_aura(&mut ctx, eff_a, eff_b, &mut state.counters);
    }

    if selected_phase == OrderedEventPhase::Bite {
        // Pre-resolve bite-variant via engine-replay BEFORE building
        // PhaseContext. The PhaseContext takes `&mut state.a` /
        // `&mut state.b` mutable borrows which would conflict with
        // the immutable `&state` borrow the bridge needs (Rust
        // borrow rules — disjoint borrows of LoopState fields can't
        // coexist with a whole-struct borrow across function calls).
        //
        // We pre-resolve only for the live engine path: when the
        // bite event is about to fire AND the side's mode is
        // Dynamic AND no decide_bite_variant_override is installed
        // by an outer caller (= we're NOT inside an inner replay /
        // benchmark, where the override drives selection directly).
        let use_engine_replay_for_bite = params.decide_bite_variant_override.is_none();
        let a_will_bite = (state.a.next_hit - state.time).abs() <= 1e-9;
        let b_will_bite = (state.b.next_hit - state.time).abs() <= 1e-9;
        let pre_resolved_variant_a: Option<&'static str> = if use_engine_replay_for_bite
            && a_will_bite
            && matches!(
                params.config.attacker_bite_variant_mode,
                super::config::SimpleBiteVariantMode::Dynamic
            )
            && params.attacker.damage2 > 0.0
        {
            Some(super::bite_variant_bridge::resolve_via_engine_replay(
                state, params, /* self_is_attacker */ true,
            ))
        } else {
            None
        };
        let pre_resolved_variant_b: Option<&'static str> = if use_engine_replay_for_bite
            && b_will_bite
            && matches!(
                params.config.defender_bite_variant_mode,
                super::config::SimpleBiteVariantMode::Dynamic
            )
            && params.defender.damage2 > 0.0
        {
            Some(super::bite_variant_bridge::resolve_via_engine_replay(
                state, params, /* self_is_attacker */ false,
            ))
        } else {
            None
        };

        // Phases 10+11: Melee A and B + the symmetric Cocoon Ph2
        // invincibility checks. See `process_phase_10_11_melee`.
        let mut ctx = PhaseContext {
            time: state.time,
            attacker: eff_a,
            defender: eff_b,
            attacker_breath: params.attacker_breath,
            defender_breath: params.defender_breath,
            config: params.config,
            record_trace: params.record_trace,
            a: &mut state.a,
            b: &mut state.b,
            combat_log: &mut state.combat_log,
        };
        process_phase_10_11_melee(
            &mut ctx,
            eff_a,
            eff_b,
            hunker_active_a,
            hunker_active_b,
            &mut state.counters,
            &mut state.bite_count_a,
            &mut state.bite_count_b,
            params.decide_bite_variant_override,
            pre_resolved_variant_a,
            pre_resolved_variant_b,
        );
    }

    if selected_phase == OrderedEventPhase::StatusTicks {
        // Phase 12: Status DOT ticks. See `process_phase_12_status_dot_ticks`.
        let mut ctx = PhaseContext {
            time: state.time,
            attacker: eff_a,
            defender: eff_b,
            attacker_breath: params.attacker_breath,
            defender_breath: params.defender_breath,
            config: params.config,
            record_trace: params.record_trace,
            a: &mut state.a,
            b: &mut state.b,
            combat_log: &mut state.combat_log,
        };
        process_phase_12_status_dot_ticks(&mut ctx, eff_a, eff_b, &mut state.counters);
    }

    // Phase 13 (post-DOT death commit) deferred to Phase 16.

    if selected_phase == OrderedEventPhase::Breath {
        // Phases 14+15: Breath A and Breath B. See `process_phase_14_15_breath`.
        let mut ctx = PhaseContext {
            time: state.time,
            attacker: eff_a,
            defender: eff_b,
            attacker_breath: params.attacker_breath,
            defender_breath: params.defender_breath,
            config: params.config,
            record_trace: params.record_trace,
            a: &mut state.a,
            b: &mut state.b,
            combat_log: &mut state.combat_log,
        };
        process_phase_14_15_breath(
            &mut ctx,
            eff_a,
            eff_b,
            hunker_active_a,
            hunker_active_b,
            &mut state.counters,
            &mut state.breath_tick_count_a,
            &mut state.breath_tick_count_b,
        );
    }

    // Phases 15b + 15c: post-breath hooks. See `process_phase_15b_15c_post_breath_hooks`.
    {
        let mut ctx = PhaseContext {
            time: state.time,
            attacker: eff_a,
            defender: eff_b,
            attacker_breath: params.attacker_breath,
            defender_breath: params.defender_breath,
            config: params.config,
            record_trace: params.record_trace,
            a: &mut state.a,
            b: &mut state.b,
            combat_log: &mut state.combat_log,
        };
        process_phase_15b_15c_post_breath_hooks(&mut ctx, params.flags.has_any_rewind, params.flags.has_any_self_destruct);
    }

    // Phase 16 + post-tick housekeeping. See `process_phase_16_post_tick`.
    {
        let mut ctx = PhaseContext {
            time: state.time,
            attacker: eff_a,
            defender: eff_b,
            attacker_breath: params.attacker_breath,
            defender_breath: params.defender_breath,
            config: params.config,
            record_trace: params.record_trace,
            a: &mut state.a,
            b: &mut state.b,
            combat_log: &mut state.combat_log,
        };
        process_phase_16_post_tick(
            &mut ctx,
            &mut state.counters,
            &mut state.hp_a_at_b_death,
            &mut state.hp_b_at_a_death,
            &snapshot_a_dots,
            &snapshot_b_dots,
            track_damage_triggers,
            track_status_hooks,
            params.attacker.health,
            params.defender.health,
            hp_a_pre,
            hp_b_pre,
            death_a_pre,
            death_b_pre,
            status_keys_a_pre.as_ref(),
            status_keys_b_pre.as_ref(),
            status_stacks_a_pre.as_ref(),
            status_stacks_b_pre.as_ref(),
            first_strike_a_pre,
            first_strike_b_pre,
            params.ability_policy,
        );
    }

    LoopOutcome::Advanced
}

