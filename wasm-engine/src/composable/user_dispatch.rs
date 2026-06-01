//! Sprint 5: user-ability dispatch into the live combat loop.
//!
//! Glues the spec layer (`crate::policy::user_ability::UserAbilitySpec`,
//! authored by users via the Custom > Abilities tab) to the actual
//! combat iteration. The data flow:
//!
//!   1. Each creature carries `SimpleCombatantStats::user_ability_ids` —
//!      a list of `user.<...>` ids. Sprint 5.1 wired the data path.
//!   2. At dispatch time, this module looks up each id against the
//!      global `wasm_api::snapshot_user_ability` registry. Missing ids
//!      drop silently (the user may have unregistered the ability after
//!      attaching it to a creature; we don't fail combat over it).
//!   3. For each spec with a populated `on_fire`, the policy bridge
//!      runs the same decision pipeline built-ins use — same timing
//!      modes, same projection, same `is_available` / `utility`
//!      semantics. Only the registry source differs.
//!   4. When the policy says NOW, `apply_effect_batch` runs against
//!      an `EffectContext` that points at the caster's `user_*` runtime
//!      maps on `CombatSide`. SetCooldownUntil / SetActiveUntil writes
//!      land there; the next decision tick reads them back via the
//!      policy bridge merge in `build_policy_side`.
//!
//! Triggers (`on_round_start` / `on_take_damage` / `on_deal_damage` /
//! `on_tick`) wire in subsequent commits against the same dispatcher
//! shape — see Sprint 5.3-5.5.

use crate::contracts::{CombatLogEntry, SimpleCombatantStats};
use crate::effects::{apply_effect_batch, EffectBatch, EffectContext};
use crate::policy::state::{PolicyState, PolicyValue};
use crate::policy::user_ability::{TriggerHook, UserAbilitySpec, UserDecision};

use super::policy_bridge;
use super::status_helpers::record_ability_event;
use super::CombatSide;

/// Round 40 / A11: build the `scaling.<key>` extras snapshot for a
/// spec at its effective active level. Returns an empty map if the
/// spec has no scaling (pre-A11 specs and level-1-only specs).
///
/// `active_level` is the per-fight level applied to this spec — looked
/// up via [`active_level_for_spec`] which consults the caster's
/// `user_levels` override map (seeded from the Compare picker) before
/// falling back to `spec.default_level`.
///
/// The returned map is merged into the `PolicyState.extras` consumed
/// by both the decision pass (utility / is_available) and the apply
/// pass (Conditional / Expr-driven effects), so users can write
/// `Expr::Var { path: "scaling.<key>" }` and see the same value in
/// both phases.
fn scaling_extras_for_spec(
    spec: &UserAbilitySpec,
    active_level: u32,
) -> std::collections::BTreeMap<String, PolicyValue> {
    let mut out = std::collections::BTreeMap::new();
    if spec.scaling.is_empty() {
        return out;
    }
    // Clamp into 1..=levels for safety — `seed_user_levels_into_side`
    // already does this, but a stale or hand-crafted override could
    // sneak through if the spec was edited after seeding.
    let lvl = active_level.clamp(1, spec.levels.max(1));
    let idx = (lvl - 1) as usize;
    for (key, values) in &spec.scaling {
        let value = values
            .get(idx)
            .copied()
            .or_else(|| values.last().copied())
            .unwrap_or(0.0);
        out.insert(format!("scaling.{key}"), PolicyValue::Number(value));
    }
    out
}

/// Round 42 / A11: resolve the effective active level for a spec on
/// `caster`. Reads the per-fight override seeded at simulation start;
/// falls back to the spec's `default_level` (or `1` when neither
/// source is set — degenerate, but keeps the engine deterministic).
fn active_level_for_spec(caster: &CombatSide, spec: &UserAbilitySpec) -> u32 {
    caster
        .user_levels
        .get(&spec.id)
        .copied()
        .unwrap_or(spec.default_level)
        .max(1)
}

/// Drain due scheduled effects from `caster.user_scheduled` and
/// dispatch each entry against the current state. Called once per
/// iteration after `drain_user_extras_into_combat_side`. Caster
/// owns the queue; effects fire from caster→opponent perspective.
///
/// Caps recursion depth via the EffectContext chain_depth, same
/// as TriggerAbility — pathological scheduled-effect chains
/// terminate at MAX_CHAIN_DEPTH.
#[allow(clippy::too_many_arguments)]
pub fn drain_due_scheduled_effects_for_caster(
    caster: &mut CombatSide,
    opponent: &mut CombatSide,
    caster_stats: &SimpleCombatantStats,
    opponent_stats: &SimpleCombatantStats,
    time: f64,
    combat_log: &mut Vec<CombatLogEntry>,
    record_trace: bool,
    caster_side_label: &str,
) {
    if caster.user_scheduled.is_empty() {
        return;
    }
    // Round 38 / A12: drain due entries; push back not-yet-due.
    // Each entry is `ScheduledEntry { due_at, effects, name }`. The
    // `name` is only needed for cancel/reschedule lookups while the
    // entry sits in the queue — once it fires, the effects flatten
    // into a single batch and the name drops away.
    let mut due: Vec<Vec<crate::effects::EffectKind>> = Vec::new();
    let mut still_pending: Vec<crate::effects::ScheduledEntry> = Vec::new();
    for entry in caster.user_scheduled.drain(..) {
        if time + 1e-9 >= entry.due_at {
            due.push(entry.effects);
        } else {
            still_pending.push(entry);
        }
    }
    caster.user_scheduled = still_pending;
    if due.is_empty() {
        return;
    }
    // Build a fresh PolicyState for Conditional / Expr-driven
    // variants inside the deferred effects.
    let self_side =
        policy_bridge::build_policy_side(caster, caster_stats, None, std::iter::empty());
    let opp_side =
        policy_bridge::build_policy_side(opponent, opponent_stats, None, std::iter::empty());
    let apply_state = PolicyState {
        self_side,
        opponent: opp_side,
        time,
        extras: Default::default(),
    };
    let batch = crate::effects::EffectBatch {
        name: "Scheduled".into(),
        effects: due.into_iter().flatten().collect(),
        ..Default::default()
    };
    apply_user_batch(
        caster,
        opponent,
        caster_stats,
        opponent_stats,
        time,
        &batch,
        &apply_state,
        "scheduled",
        None, // scheduled drain merges multiple specs — no single source id
        combat_log,
        record_trace,
        caster_side_label,
        false, // scheduled drain is not an active fire — no "activated" entry
        None,  // scheduled drain: not a status-apply, eff base (byte-identical)
    );
}

/// Drain side-extras requests written by Sprint 5.x effects that
/// need to write into CombatSide fields the EffectContext doesn't
/// directly expose. Called once per iteration before the
/// scheduler reads `next_hit` / `breath_capacity`.
///
/// Currently handled:
///   - `next_hit_floor` — `InterruptNextHit` writes the absolute
///     timestamp the next bite must respect. Adapter pushes
///     `side.next_hit` to that value (clamped to >= current).
///   - `breath_consume_pending` — `ConsumeBreath` write. Adapter
///     subtracts from `side.breath_capacity` (clamped to >= 0).
///   - `breath_restore_pending` — `RestoreBreath` write. Adapter
///     adds to `side.breath_capacity` (clamped to <= 10000).
pub fn drain_user_extras_into_combat_side(side: &mut CombatSide) {
    use crate::policy::state::PolicyValue;
    if let Some(PolicyValue::Number(target_next_hit)) = side.user_extras.remove("next_hit_floor")
    {
        if target_next_hit > side.next_hit {
            side.next_hit = target_next_hit;
        }
    }
    if let Some(PolicyValue::Number(amount)) =
        side.user_extras.remove("breath_consume_pending")
    {
        side.breath_capacity = (side.breath_capacity - amount).max(0.0);
    }
    if let Some(PolicyValue::Number(amount)) =
        side.user_extras.remove("breath_restore_pending")
    {
        side.breath_capacity = (side.breath_capacity + amount).min(10_000.0);
    }
}

/// Run the active-decision pass for every user ability owned by
/// `caster_stats.user_ability_ids`. For each spec that the policy
/// engine decides to fire NOW, apply its `on_fire` batch and record
/// a combat-log event.
///
/// `caster` / `opponent` are the live engine sides; the dispatcher
/// borrows `caster.user_*` mutably to let SetCooldownUntil land there.
/// `opponent.user_*` is borrowed mutably too so an effect that
/// targets the opponent (e.g. `set_cooldown_until` on an opponent's
/// shared cooldown id) can land — symmetric with built-in actives.
#[allow(clippy::too_many_arguments)]
pub fn dispatch_user_actives_for_caster(
    caster: &mut CombatSide,
    opponent: &mut CombatSide,
    caster_stats: &SimpleCombatantStats,
    opponent_stats: &SimpleCombatantStats,
    time: f64,
    mode: crate::policy::TimingMode,
    // Per-user-ability runtime override map. Keyed by user.<id>;
    // when present, pins the timing for that ability for this
    // fight, overriding spec.timing_user_override and
    // spec.timing_mode_override. Stale user-timing-id values
    // fall back to spec defaults silently.
    user_overrides: &std::collections::BTreeMap<String, crate::contracts::AbilityTimingChoice>,
    combat_log: &mut Vec<CombatLogEntry>,
    record_trace: bool,
    caster_side_label: &str,
) {
    if caster_stats.user_ability_ids.is_empty() {
        return;
    }

    // Snapshot the id list up front. The store accessor clones the
    // spec on each lookup, so we can iterate without holding the
    // registry lock open.
    let ids: Vec<String> = caster_stats.user_ability_ids.clone();

    for id in &ids {
        let Some(spec) = crate::wasm_api::snapshot_user_ability(id) else {
            continue;
        };
        let Some(on_fire) = spec.on_fire.clone() else {
            continue;
        };

        // Build the policy snapshot. We re-build per-ability because
        // a previous iteration may have mutated state via apply_effect_batch
        // (cooldowns, hp, statuses), and the next decision must see
        // post-state.
        let self_policy_side =
            policy_bridge::build_policy_side(caster, caster_stats, None, std::iter::empty());
        let opp_policy_side =
            policy_bridge::build_policy_side(opponent, opponent_stats, None, std::iter::empty());

        let decision = UserDecision::new(spec.clone());
        // Round 40 / A11: scaling.<key> entries injected into both the
        // decision PolicyState (here) and the apply PolicyState (below).
        // Round 42 / A11: active level honors the per-fight Compare
        // override stored on the caster.
        let active_level = active_level_for_spec(caster, &spec);
        let scaling_extras = scaling_extras_for_spec(&spec, active_level);
        // Resolution priority:
        //   1. user_overrides[id]            — per-fight override
        //   2. spec.timing_user_override     — custom policy on the spec
        //   3. spec.timing_mode_override     — built-in mode on the spec
        //   4. mode (session default)
        // A stale user-timing id at any level falls through to the
        // next; we never silently disable the ability.
        let activate = match user_overrides.get(id) {
            Some(crate::contracts::AbilityTimingChoice::User { timing_id }) => {
                if let Some(timing_spec) = crate::wasm_api::snapshot_user_timing(timing_id) {
                    let user_policy = crate::policy::user_timing::UserPolicy::new(timing_spec);
                    policy_bridge::user_should_activate_with_policy(
                        &decision,
                        &user_policy,
                        self_policy_side,
                        opp_policy_side,
                        time,
                        scaling_extras.clone(),
                    )
                } else {
                    // Stale runtime override — fall back to spec defaults.
                    let effective_mode = match spec.timing_mode_override {
                        Some(m) => policy_bridge::map_timing_mode(m),
                        None => mode,
                    };
                    policy_bridge::user_should_activate_now(
                        &decision,
                        self_policy_side,
                        opp_policy_side,
                        time,
                        effective_mode,
                        scaling_extras.clone(),
                    )
                }
            }
            Some(crate::contracts::AbilityTimingChoice::BuiltIn { mode: forced_mode }) => {
                let effective_mode = policy_bridge::map_timing_mode(*forced_mode);
                policy_bridge::user_should_activate_now(
                    &decision,
                    self_policy_side,
                    opp_policy_side,
                    time,
                    effective_mode,
                    scaling_extras.clone(),
                )
            }
            None => {
                if let Some(timing_id) = spec.timing_user_override.as_deref() {
                    if let Some(timing_spec) = crate::wasm_api::snapshot_user_timing(timing_id) {
                        let user_policy =
                            crate::policy::user_timing::UserPolicy::new(timing_spec);
                        policy_bridge::user_should_activate_with_policy(
                            &decision,
                            &user_policy,
                            self_policy_side,
                            opp_policy_side,
                            time,
                            scaling_extras.clone(),
                        )
                    } else {
                        let effective_mode = match spec.timing_mode_override {
                            Some(m) => policy_bridge::map_timing_mode(m),
                            None => mode,
                        };
                        policy_bridge::user_should_activate_now(
                            &decision,
                            self_policy_side,
                            opp_policy_side,
                            time,
                            effective_mode,
                            scaling_extras.clone(),
                        )
                    }
                } else {
                    let effective_mode = match spec.timing_mode_override {
                        Some(m) => policy_bridge::map_timing_mode(m),
                        None => mode,
                    };
                    policy_bridge::user_should_activate_now(
                        &decision,
                        self_policy_side,
                        opp_policy_side,
                        time,
                        effective_mode,
                        scaling_extras.clone(),
                    )
                }
            }
        };
        if !activate {
            continue;
        }

        // Re-build PolicyState for the apply path so EffectKind::Conditional
        // sees the same snapshot the policy decided against. (Policy
        // consumed the previous build above by value.)
        let self_apply_side =
            policy_bridge::build_policy_side(caster, caster_stats, None, std::iter::empty());
        let opp_apply_side =
            policy_bridge::build_policy_side(opponent, opponent_stats, None, std::iter::empty());
        let apply_state = PolicyState {
            self_side: self_apply_side,
            opponent: opp_apply_side,
            time,
            // Round 40 / A11: scaling visible inside Conditional / Expr-
            // driven effects on the apply pass too.
            extras: scaling_extras.clone(),
        };

        // 2026-05-12: snapshot status stacks for the apply-log diff
        // (same shape as apply_user_batch — the active-fire path doesn't
        // share that helper because of the extra bookkeeping below).
        let opp_label = if caster_side_label == "A" { "B" } else { "A" };
        let pre_caster_statuses: Vec<(String, f64)> = if record_trace {
            caster
                .statuses
                .iter()
                .map(|(id, inst)| (id.clone(), inst.stacks))
                .collect()
        } else {
            Vec::new()
        };
        let pre_opponent_statuses: Vec<(String, f64)> = if record_trace {
            opponent
                .statuses
                .iter()
                .map(|(id, inst)| (id.clone(), inst.stacks))
                .collect()
        } else {
            Vec::new()
        };

        let mut ctx = EffectContext {
            time,
            caster_stats,
            opponent_stats,
            caster_hp: &mut caster.hp,
            opponent_hp: &mut opponent.hp,
            caster_statuses: &mut caster.statuses,
            opponent_statuses: &mut opponent.statuses,
            caster_cooldowns: &mut caster.user_cooldowns,
            opponent_cooldowns: &mut opponent.user_cooldowns,
            caster_active_until: &mut caster.user_active_until,
            opponent_active_until: &mut opponent.user_active_until,
            caster_extras: &mut caster.user_extras,
            opponent_extras: &mut opponent.user_extras,
            // Round 37 / A7: heal accumulators for OnHeal trigger.
            caster_iter_healing: Some(&mut caster.iter_healing_taken),
            opponent_iter_healing: Some(&mut opponent.iter_healing_taken),
            caster_snapshots: Some(&mut caster.user_snapshots),
            opponent_snapshots: Some(&mut opponent.user_snapshots),
            caster_scheduled: Some(&mut caster.user_scheduled),
            opponent_scheduled: Some(&mut opponent.user_scheduled),
            policy_state: Some(&apply_state),
            chain_depth: 0,
            // Round 39 / A8: stamp source onto ModifyStat keys so two
            // abilities don't collide on the same modifier slot.
            firing_ability_id: Some(spec.id.as_str()),
            // Ability fires (not a mid-combat status-apply): the FormSwap
            // form-in keeps the eff base. Byte-identical.
            caster_base_health: None,
            opponent_base_health: None,
        };

        let applied = apply_effect_batch(&on_fire, &mut ctx);
        if applied > 0 {
            if record_trace {
                emit_user_apply_log_deltas(
                    combat_log,
                    time,
                    &spec.display_name,
                    caster_side_label,
                    caster.hp,
                    &pre_caster_statuses,
                    &caster.statuses,
                    caster_side_label,
                    caster.hp,
                );
                emit_user_apply_log_deltas(
                    combat_log,
                    time,
                    &spec.display_name,
                    caster_side_label,
                    caster.hp,
                    &pre_opponent_statuses,
                    &opponent.statuses,
                    opp_label,
                    opponent.hp,
                );
            }
            // Tier-1 B: auto-bookkeep fire_count + last_fire for the
            // var-path introspection. Use structured keys readable
            // via `self.fired_count.<id>` / `self.last_fire_time.<id>`
            // / `self.time_since_fire.<id>` (resolved in lookup_var).
            use crate::policy::state::PolicyValue;
            let fire_count_key = format!("fire_count.{}", spec.id);
            let last_fire_key = format!("last_fire.{}", spec.id);
            let prev_count = caster
                .user_extras
                .get(&fire_count_key)
                .and_then(PolicyValue::as_number)
                .unwrap_or(0.0);
            caster.user_extras.insert(
                fire_count_key,
                PolicyValue::Number(prev_count + 1.0),
            );
            caster
                .user_extras
                .insert(last_fire_key, PolicyValue::Number(time));

            record_ability_event(
                caster,
                caster_side_label,
                combat_log,
                record_trace,
                time,
                &spec.display_name,
            );
        }
    }
}

/// Sprint 5.4: fire any due `on_tick` triggers for the caster side.
/// One iteration may fire AT MOST ONE tick per ability, even if
/// time has advanced past multiple intervals — keeps the dispatch
/// bounded and predictable. The next tick is scheduled at
/// `due_at + interval` (not `time + interval`) so a heavy
/// iteration that overshoots the schedule doesn't permanently drift
/// the period; the engine catches up one tick per iteration until
/// it's back on cadence.
#[allow(clippy::too_many_arguments)]
pub fn dispatch_user_ticks_for_caster(
    caster: &mut CombatSide,
    opponent: &mut CombatSide,
    caster_stats: &SimpleCombatantStats,
    opponent_stats: &SimpleCombatantStats,
    time: f64,
    combat_log: &mut Vec<CombatLogEntry>,
    record_trace: bool,
    caster_side_label: &str,
) {
    use crate::policy::user_ability::MIN_TICK_INTERVAL_SEC;
    if caster_stats.user_ability_ids.is_empty() {
        return;
    }
    let ids: Vec<String> = caster_stats.user_ability_ids.clone();
    for id in &ids {
        let Some(spec) = crate::wasm_api::snapshot_user_ability(id) else {
            continue;
        };
        let Some(tick) = spec.triggers.on_tick.as_ref() else {
            continue;
        };
        let interval = tick.interval_sec.max(MIN_TICK_INTERVAL_SEC);
        let due_at = caster.user_tick_due_at.get(id).copied().unwrap_or(0.0);
        // 1e-9 slack absorbs float-add wobble on the schedule.
        if time + 1e-9 < due_at {
            continue;
        }
        let tick_index = caster.user_tick_index.get(id).copied().unwrap_or(0);
        let batch = tick.effects.clone();
        // 2026-05-12: suffix the tick label for the same reason as
        // trigger dispatch above — so combat log distinguishes active
        // fires from periodic ticks.
        let display_name = format!("{} · on_tick", spec.display_name);

        // Build PolicyState with event.tick_index populated.
        let mut self_side =
            policy_bridge::build_policy_side(caster, caster_stats, None, std::iter::empty());
        self_side.extras.insert(
            "tick_index".to_string(),
            crate::policy::state::PolicyValue::Number(tick_index as f64),
        );
        let opp_side =
            policy_bridge::build_policy_side(opponent, opponent_stats, None, std::iter::empty());
        let active_level = active_level_for_spec(caster, &spec);
        let mut state_extras = scaling_extras_for_spec(&spec, active_level);
        state_extras.insert(
            "tick_index".to_string(),
            crate::policy::state::PolicyValue::Number(tick_index as f64),
        );
        let apply_state = PolicyState {
            self_side,
            opponent: opp_side,
            time,
            extras: state_extras,
        };

        apply_user_batch(
            caster,
            opponent,
            caster_stats,
            opponent_stats,
            time,
            &batch,
            &apply_state,
            &display_name,
            Some(id.as_str()),
            combat_log,
            record_trace,
            caster_side_label,
            false,
            None, // ability on_tick: not a status-apply, eff base (byte-identical)
        );

        caster.user_tick_due_at.insert(id.clone(), due_at + interval);
        caster.user_tick_index.insert(id.clone(), tick_index + 1);
    }
}

/// Sprint 5.3: fire each attached user ability's `on_round_start`
/// hook for the caster side at simulation start (`time = 0`). Same
/// shape as [`dispatch_user_actives_for_caster`] but bypasses the
/// policy gate — triggers fire unconditionally per their contract.
#[allow(clippy::too_many_arguments)]
pub fn dispatch_user_round_start_for_caster(
    caster: &mut CombatSide,
    opponent: &mut CombatSide,
    caster_stats: &SimpleCombatantStats,
    opponent_stats: &SimpleCombatantStats,
    time: f64,
    combat_log: &mut Vec<CombatLogEntry>,
    record_trace: bool,
    caster_side_label: &str,
) {
    dispatch_user_trigger_for_caster(
        caster,
        opponent,
        caster_stats,
        opponent_stats,
        time,
        TriggerHook::OnRoundStart,
        std::iter::empty(),
        combat_log,
        record_trace,
        caster_side_label,
    );
}

/// Shared trigger-dispatch core. Iterates the caster's
/// user_ability_ids, looks up each spec, finds the matching trigger
/// batch (if any), applies it via `apply_effect_batch` with
/// `event.<key>` extras populated for the trigger's lifetime.
///
/// `event_extras` carries the per-trigger context (e.g.
/// `("damage_taken", 100.0)` for OnTakeDamage); it's merged into
/// the `PolicyState.extras` map so `Expr::Var { path: "event.<key>" }`
/// resolves correctly inside Conditional / utility branches.
#[allow(clippy::too_many_arguments)]
pub fn dispatch_user_trigger_for_caster(
    caster: &mut CombatSide,
    opponent: &mut CombatSide,
    caster_stats: &SimpleCombatantStats,
    opponent_stats: &SimpleCombatantStats,
    time: f64,
    hook: TriggerHook,
    event_extras: impl IntoIterator<Item = (String, f64)> + Clone,
    combat_log: &mut Vec<CombatLogEntry>,
    record_trace: bool,
    caster_side_label: &str,
) {
    if caster_stats.user_ability_ids.is_empty() {
        return;
    }
    let ids: Vec<String> = caster_stats.user_ability_ids.clone();
    for id in &ids {
        let Some(spec) = crate::wasm_api::snapshot_user_ability(id) else {
            continue;
        };
        let Some(batch) = spec.triggers.get(hook).cloned() else {
            continue;
        };
        // `_decision` not used here — triggers bypass policy. The
        // UserDecision adapter is only relevant for active firing.
        let _: UserDecision = UserDecision::new(spec.clone());

        // Build PolicyState with event extras so Conditional /
        // utility expressions inside the trigger see event.<key>.
        let mut self_apply_side =
            policy_bridge::build_policy_side(caster, caster_stats, None, std::iter::empty());
        for (k, v) in event_extras.clone() {
            self_apply_side.extras.insert(
                k,
                crate::policy::state::PolicyValue::Number(v),
            );
        }
        let opp_apply_side =
            policy_bridge::build_policy_side(opponent, opponent_stats, None, std::iter::empty());
        let active_level = active_level_for_spec(caster, &spec);
        let mut state_extras = scaling_extras_for_spec(&spec, active_level);
        for (k, v) in event_extras.clone() {
            state_extras.insert(k, crate::policy::state::PolicyValue::Number(v));
        }
        let apply_state = PolicyState {
            self_side: self_apply_side,
            opponent: opp_apply_side,
            time,
            extras: state_extras,
        };

        // 2026-05-12: combat-log clarity — pre-fix, both on_fire and
        // every trigger invocation logged as `"<DisplayName> activated"`,
        // which made users believe the active fire happened every bite
        // (it was really `on_deal_damage` re-running). Suffix the trigger
        // hook so the log can be told apart at a glance.
        let hook_label = match hook {
            TriggerHook::OnRoundStart => "on_round_start",
            TriggerHook::OnTakeDamage => "on_take_damage",
            TriggerHook::OnDealDamage => "on_deal_damage",
            TriggerHook::OnTick => "on_tick",
            TriggerHook::OnStatusApply => "on_status_apply",
            TriggerHook::OnStatusExpire => "on_status_expire",
            TriggerHook::OnKill => "on_kill",
            TriggerHook::OnFirstStrike => "on_first_strike",
            TriggerHook::OnHeal => "on_heal",
            TriggerHook::OnActiveEnd => "on_active_end",
            TriggerHook::OnBeforeTakeDamage => "on_before_take_damage",
            TriggerHook::OnBeforeDealDamage => "on_before_deal_damage",
        };
        let trigger_display = format!("{} · {}", spec.display_name, hook_label);

        apply_user_batch(
            caster,
            opponent,
            caster_stats,
            opponent_stats,
            time,
            &batch,
            &apply_state,
            &trigger_display,
            Some(spec.id.as_str()),
            combat_log,
            record_trace,
            caster_side_label,
            false,
            None, // ability trigger: not a status-apply, eff base (byte-identical)
        );
    }
}

/// Apply a single user-batch with the caster/opponent borrows wired
/// into a fresh `EffectContext`. Extracted so trigger-dispatch and
/// the on_fire path share the same EffectContext shape.
///
/// `firing_ability_id` is stamped onto `ModifyStat` keys (Round 39 /
/// A8) so two abilities don't collide on the same modifier slot.
/// Pass `None` for batches that don't originate from a specific
/// spec (e.g. the merged scheduled-effects drain).
///
/// `is_active_fire` differentiates on_fire activations from trigger
/// applications. Active fires get a `"<Display> activated"` log
/// entry; triggers don't (otherwise every bite-triggered batch would
/// look the same as a real active fire). Status apply/remove entries
/// are diffed and emitted for both kinds.
#[allow(clippy::too_many_arguments)]
pub(super) fn apply_user_batch(
    caster: &mut CombatSide,
    opponent: &mut CombatSide,
    caster_stats: &SimpleCombatantStats,
    opponent_stats: &SimpleCombatantStats,
    time: f64,
    batch: &EffectBatch,
    apply_state: &PolicyState,
    display_name: &str,
    firing_ability_id: Option<&str>,
    combat_log: &mut Vec<CombatLogEntry>,
    record_trace: bool,
    caster_side_label: &str,
    is_active_fire: bool,
    // Phase 9: RAW base max HP of the caster (= status bearer), threaded ONLY
    // by the mid-combat status-apply dispatch so a capping FormSwap form-in
    // reconciles against the true base rather than the post-hoist `eff` max
    // (double-count fix). `None` for every other caller (eff base, byte-identical).
    caster_base_health: Option<f64>,
) {
    // 2026-05-12: snapshot status stacks for diff-based apply log.
    // Cheap (a few entries per side) and only used when tracing is on,
    // so we still pay the BTreeMap walk but avoid pointless allocs
    // outside trace mode.
    let opp_label = if caster_side_label == "A" { "B" } else { "A" };
    let pre_caster_statuses: Vec<(String, f64)> = if record_trace {
        caster
            .statuses
            .iter()
            .map(|(id, inst)| (id.clone(), inst.stacks))
            .collect()
    } else {
        Vec::new()
    };
    let pre_opponent_statuses: Vec<(String, f64)> = if record_trace {
        opponent
            .statuses
            .iter()
            .map(|(id, inst)| (id.clone(), inst.stacks))
            .collect()
    } else {
        Vec::new()
    };

    let mut ctx = EffectContext {
        time,
        caster_stats,
        opponent_stats,
        caster_hp: &mut caster.hp,
        opponent_hp: &mut opponent.hp,
        caster_statuses: &mut caster.statuses,
        opponent_statuses: &mut opponent.statuses,
        caster_cooldowns: &mut caster.user_cooldowns,
        opponent_cooldowns: &mut opponent.user_cooldowns,
        caster_active_until: &mut caster.user_active_until,
        opponent_active_until: &mut opponent.user_active_until,
        caster_extras: &mut caster.user_extras,
        opponent_extras: &mut opponent.user_extras,
        caster_iter_healing: Some(&mut caster.iter_healing_taken),
        opponent_iter_healing: Some(&mut opponent.iter_healing_taken),
        caster_snapshots: Some(&mut caster.user_snapshots),
        opponent_snapshots: Some(&mut opponent.user_snapshots),
        caster_scheduled: Some(&mut caster.user_scheduled),
        opponent_scheduled: Some(&mut opponent.user_scheduled),
        policy_state: Some(apply_state),
        chain_depth: 0,
        firing_ability_id,
        // Bearer is framed as Caster; only the status-apply dispatch supplies a
        // raw base, so the override rides on the caster side. Opponent form-ins
        // (rare from a self-status hook) keep the eff base.
        caster_base_health,
        opponent_base_health: None,
    };
    let applied = apply_effect_batch(batch, &mut ctx);
    if applied > 0 {
        if record_trace {
            emit_user_apply_log_deltas(
                combat_log,
                time,
                display_name,
                caster_side_label,
                caster.hp,
                &pre_caster_statuses,
                &caster.statuses,
                caster_side_label,
                caster.hp,
            );
            emit_user_apply_log_deltas(
                combat_log,
                time,
                display_name,
                caster_side_label,
                caster.hp,
                &pre_opponent_statuses,
                &opponent.statuses,
                opp_label,
                opponent.hp,
            );
        }
        if is_active_fire {
            record_ability_event(
                caster,
                caster_side_label,
                combat_log,
                record_trace,
                time,
                display_name,
            );
        }
    }
}

/// Emit `"<source_ability> applied <Label> (<N>)"` /
/// `"<source_ability> removed <Label> (<N>)"` log entries for every
/// status whose stacks changed on the given side. Mirrors
/// `apply_statuses_with_trace` but operates on an already-applied
/// batch via pre/post stacks rather than the apply-time snapshot.
#[allow(clippy::too_many_arguments)]
fn emit_user_apply_log_deltas(
    combat_log: &mut Vec<CombatLogEntry>,
    time: f64,
    source_ability: &str,
    source_side: &str,
    source_hp: f64,
    pre_stacks: &[(String, f64)],
    post_statuses: &std::collections::BTreeMap<String, crate::contracts::SimpleStatusInstance>,
    target_side: &str,
    target_hp: f64,
) {
    use crate::composable::status_helpers::{format_stacks, format_status_label};
    let source_hp_after = source_hp.max(0.0);
    let target_hp_after = target_hp.max(0.0);
    // Diff existing entries.
    let mut seen: std::collections::BTreeSet<String> = std::collections::BTreeSet::new();
    for (id, prev_stacks) in pre_stacks {
        seen.insert(id.clone());
        let post = post_statuses.get(id).map(|s| s.stacks).unwrap_or(0.0);
        let delta = post - *prev_stacks;
        if delta.abs() > 1e-9 {
            let (verb, stacks) = if delta > 0.0 {
                ("applied", delta)
            } else {
                ("removed", -delta)
            };
            combat_log.push(CombatLogEntry {
                time,
                entry_type: "ability".to_string(),
                attacker: source_side.to_string(),
                damage: 0.0,
                healing: None,
                actor_hp_after: source_hp_after,
                hp_side: target_side.to_string(),
                hp_after: target_hp_after,
                description: Some(format!(
                    "{} {} {} ({})",
                    source_ability,
                    verb,
                    format_status_label(id),
                    format_stacks(stacks)
                )),
                detail: None,
                status_id: Some(id.clone()),
            });
        }
    }
    // New entries (not in pre-stacks).
    for (id, inst) in post_statuses.iter() {
        if seen.contains(id) {
            continue;
        }
        if inst.stacks > 1e-9 {
            combat_log.push(CombatLogEntry {
                time,
                entry_type: "ability".to_string(),
                attacker: source_side.to_string(),
                damage: 0.0,
                healing: None,
                actor_hp_after: source_hp_after,
                hp_side: target_side.to_string(),
                hp_after: target_hp_after,
                description: Some(format!(
                    "{} applied {} ({})",
                    source_ability,
                    format_status_label(id),
                    format_stacks(inst.stacks)
                )),
                detail: None,
                status_id: Some(id.clone()),
            });
        }
    }
}

/// Round 43 / A13: pre-damage hook wrapper. Fires
/// `on_before_deal_damage` on the dealer THEN `on_before_take_damage`
/// on the victim, then returns the final damage amount the engine
/// should apply.
///
/// The hooks see `event.raw_damage` (pre-mitigation), `event.damage_taken`
/// (the engine's post-mitigation amount as a starting point), and
/// `event.prevented_damage` (raw - taken). Either handler may write
/// `set_extra self damage_override = N` (no `event.` prefix on the
/// key) to replace the final value. Dealer override applies first;
/// the victim hook then sees the post-amplification number in
/// `event.damage_taken` and can defend against it.
///
/// Conventions:
/// - `damage_override` must be ≥ 0 (negative values clamp to 0, which
///   makes the damage event a no-op — useful for "full absorb").
/// - Override keys are one-shot: cleared from both sides' user_extras
///   on entry AND after read-back, so a second damage event in the
///   same iteration starts clean.
/// - When no side has any user ability, the dispatch is a no-op and
///   the function returns `engine_damage` unchanged (cheap fast path).
///
/// `source_ability` is a short tag the engine passes describing what
/// caused the damage (`"bite"`, `"breath"`, etc.). The hook sees it as
/// `event.source_ability` numerically encoded — we store the tag in a
/// side-specific extras slot for now since `PolicyValue` is numeric.
/// Convention: `event.is_bite` / `event.is_breath` / `event.is_dot`
/// already exist (A10) so users can branch on damage kind there.
#[allow(clippy::too_many_arguments)]
pub fn run_pre_damage_hooks(
    dealer: &mut CombatSide,
    victim: &mut CombatSide,
    dealer_stats: &SimpleCombatantStats,
    victim_stats: &SimpleCombatantStats,
    time: f64,
    raw_damage: f64,
    engine_damage: f64,
    source_ability: &str,
    combat_log: &mut Vec<CombatLogEntry>,
    record_trace: bool,
    dealer_label: &str,
    victim_label: &str,
) -> f64 {
    // Fast path — no abilities AND no dynamic user statuses on either side ⇒
    // no pre-damage hooks ⇒ engine value passes through (byte-identical).
    use crate::composable::user_status_dispatch::{
        dispatch_status_trigger_for_bearer, side_has_dynamic_user_status,
    };
    let dealer_has_status = side_has_dynamic_user_status(dealer);
    let victim_has_status = side_has_dynamic_user_status(victim);
    if dealer_stats.user_ability_ids.is_empty()
        && victim_stats.user_ability_ids.is_empty()
        && !dealer_has_status
        && !victim_has_status
    {
        return engine_damage;
    }
    type StatusSpec = crate::user_status::UserStatusSpec;
    type Batch = crate::effects::EffectBatch;

    const OVERRIDE_KEY: &str = "damage_override";

    // Damage-kind mask for `event.is_bite/breath/dot` — we infer
    // from source_ability so each pre-damage hook has the same kind
    // visibility as the post-damage on_take_damage trigger.
    let (is_bite, is_breath, is_dot) = match source_ability {
        "bite" => (1.0, 0.0, 0.0),
        "breath" => (0.0, 1.0, 0.0),
        "dot" => (0.0, 0.0, 1.0),
        _ => (0.0, 0.0, 0.0),
    };

    let make_extras = |damage_taken: f64| -> Vec<(String, f64)> {
        vec![
            ("raw_damage".to_string(), raw_damage),
            ("damage_taken".to_string(), damage_taken),
            ("prevented_damage".to_string(), (raw_damage - damage_taken).max(0.0)),
            ("is_bite".to_string(), is_bite),
            ("is_breath".to_string(), is_breath),
            ("is_dot".to_string(), is_dot),
        ]
    };

    let mut current = engine_damage;
    let select_bdd: fn(&StatusSpec) -> Option<&Batch> = |s| s.on_before_deal_damage.as_ref();
    let select_btd: fn(&StatusSpec) -> Option<&Batch> = |s| s.on_before_take_damage.as_ref();

    // Dealer hooks fire first (ability then status). A status pre-damage hook
    // shares the ability contract: it may write `set_extra self damage_override
    // = N` to replace the amount; the value is read back and cleared one-shot.
    if !dealer_stats.user_ability_ids.is_empty() {
        // Clear any stale override key from a prior damage event.
        dealer.user_extras.remove(OVERRIDE_KEY);
        dispatch_user_trigger_for_caster(
            dealer, victim, dealer_stats, victim_stats, time,
            TriggerHook::OnBeforeDealDamage,
            make_extras(current),
            combat_log, record_trace, dealer_label,
        );
        if let Some(override_value) = dealer
            .user_extras
            .remove(OVERRIDE_KEY)
            .and_then(|v| v.as_number())
        {
            current = override_value.max(0.0);
        }
    }
    if dealer_has_status {
        dealer.user_extras.remove(OVERRIDE_KEY);
        dispatch_status_trigger_for_bearer(
            dealer, victim, dealer_stats, victim_stats, time,
            select_bdd, &make_extras(current), "on_before_deal_damage",
            combat_log, record_trace, dealer_label,
        );
        if let Some(override_value) = dealer
            .user_extras
            .remove(OVERRIDE_KEY)
            .and_then(|v| v.as_number())
        {
            current = override_value.max(0.0);
        }
    }

    // Victim hooks fire second (ability then status) — they see the
    // post-amplification damage in `event.damage_taken`.
    if !victim_stats.user_ability_ids.is_empty() {
        victim.user_extras.remove(OVERRIDE_KEY);
        dispatch_user_trigger_for_caster(
            victim, dealer, victim_stats, dealer_stats, time,
            TriggerHook::OnBeforeTakeDamage,
            make_extras(current),
            combat_log, record_trace, victim_label,
        );
        if let Some(override_value) = victim
            .user_extras
            .remove(OVERRIDE_KEY)
            .and_then(|v| v.as_number())
        {
            current = override_value.max(0.0);
        }
    }
    if victim_has_status {
        victim.user_extras.remove(OVERRIDE_KEY);
        dispatch_status_trigger_for_bearer(
            victim, dealer, victim_stats, dealer_stats, time,
            select_btd, &make_extras(current), "on_before_take_damage",
            combat_log, record_trace, victim_label,
        );
        if let Some(override_value) = victim
            .user_extras
            .remove(OVERRIDE_KEY)
            .and_then(|v| v.as_number())
        {
            current = override_value.max(0.0);
        }
    }

    current
}
