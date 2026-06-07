//! Phase 9: dispatch programmable-status hooks into the live combat loop.
//!
//! Sibling of [`super::user_dispatch`]. Where that module drives hooks owned by
//! a side's *abilities* (`SimpleCombatantStats::user_ability_ids`), this one
//! drives hooks owned by the *statuses a side currently carries* - behaviour
//! that rides with the status onto any bearer, no ability required.
//!
//! **Frame (locked):** a status hook fires with the BEARER as `Caster`/`self`
//! and the other side as `Opponent` - matching the engine's DOT attribution
//! and the `apply_user_batch` frame. Effects target `Caster` = bearer.
//!
//! **Status-scoped modifiers:** every hook runs with
//! `EffectContext.firing_ability_id = Some(status_id)`, so any `modify_stat` /
//! `form_swap` it installs lands under `modifier.<field>.<mode>.<status_id>.*`
//! keys (`effects::effective_stat_value`'s sourced-modifier layer). On expiry
//! [`teardown_status_scoped_modifiers`] strips exactly those keys and
//! reconciles HP with the FormSwap machinery - so "when the status falls off,
//! it removes its own effect" holds for arbitrary installed modifiers.
//!
//! **Zero-cost gate:** [`side_has_dynamic_user_status`] short-circuits on the
//! `user.` id prefix, so built-in / parametric-only statuses never reach any
//! of this and the iteration stays byte-identical.

use std::collections::BTreeMap;

use crate::contracts::{CombatLogEntry, ResolvedStatusScalars, SimpleCombatantStats};
use crate::effects::{
    clear_status_teardown_policy, effective_stat_value, read_status_teardown_policy,
    reconcile_form_hp, EffectBatch, MODIFIER_KEY_PREFIX,
};
use crate::user_status::UserStatusSpec;
use crate::policy::state::{PolicyState, PolicyValue};
use crate::policy::user_ability::MIN_TICK_INTERVAL_SEC;

use super::user_dispatch::apply_user_batch;
use super::{policy_bridge, CombatSide};

/// Cheap gate: does this side CARRY any dynamic (hook- or Expr-bearing) user
/// status? Built-in ids fail the `user.` prefix instantly; parametric-only
/// user statuses fail `has_dynamic()`. When false for both sides the whole
/// status-hook path is skipped and the iteration is byte-identical.
pub fn side_has_dynamic_user_status(side: &CombatSide) -> bool {
    side.statuses.keys().any(|id| {
        id.starts_with("user.")
            && crate::wasm_api::snapshot_user_status(id)
                .is_some_and(|spec| spec.has_dynamic())
    })
}

/// Build the per-hook `PolicyState`: bearer = `self`, other = `opponent`, with
/// the carrying status's `status.stacks` / `status.max_hp` seeded into extras
/// (resolved by the `status.*` arm in `lookup_var`) so hook effects can read
/// them. `extra_seed` carries any per-hook context (e.g. `tick_index`).
#[allow(clippy::too_many_arguments)]
fn build_status_hook_state(
    bearer: &CombatSide,
    bearer_stats: &SimpleCombatantStats,
    other: &CombatSide,
    other_stats: &SimpleCombatantStats,
    time: f64,
    stacks: f64,
    status_id: &str,
    extra_seed: &[(&str, f64)],
) -> PolicyState {
    let self_side =
        policy_bridge::build_policy_side(bearer, bearer_stats, None, std::iter::empty());
    let opponent =
        policy_bridge::build_policy_side(other, other_stats, None, std::iter::empty());
    let mut extras: BTreeMap<String, PolicyValue> = BTreeMap::new();
    extras.insert("status.stacks".to_string(), PolicyValue::Number(stacks));
    extras.insert(
        "status.max_hp".to_string(),
        PolicyValue::Number(bearer_stats.health.max(1.0)),
    );
    // `status.age` = seconds this status has been on the bearer (`time` minus
    // the applied-at stamp; 0 when unseeded, e.g. a hook firing the same
    // iteration it was applied). The `status.*` arm in `lookup_var` surfaces it.
    let applied_at = bearer.status_applied_at.get(status_id).copied().unwrap_or(time);
    extras.insert(
        "status.age".to_string(),
        PolicyValue::Number((time - applied_at).max(0.0)),
    );
    for (k, v) in extra_seed {
        extras.insert((*k).to_string(), PolicyValue::Number(*v));
    }
    PolicyState {
        self_side,
        opponent,
        time,
        extras,
    }
}

/// Fire `on_apply` for each freshly-applied dynamic user status on the bearer,
/// and seed its `on_tick` schedule. `applied_ids` is the per-iteration
/// apply-diff (keys present now but not at iteration start).
#[allow(clippy::too_many_arguments)]
pub fn dispatch_status_apply_for_bearer(
    bearer: &mut CombatSide,
    other: &mut CombatSide,
    bearer_stats: &SimpleCombatantStats,
    other_stats: &SimpleCombatantStats,
    // RAW base max HP of the bearer for the form-in reconcile. MUST be the
    // unmodified `params.<side>.health`, NOT `bearer_stats.health` - in the
    // phase-16 call `bearer_stats` is the post-hoist `eff` struct whose
    // `health` already has any active max-HP modifier folded in, so a capping
    // `form_swap` installed by an on_apply hook would reconcile against the
    // already-capped max (double-count). Symmetric with the teardown's
    // `bearer_base_health` and `process_form_revert`, which are likewise fed
    // `params.<side>.health`. Only the FormSwap form-in `base_health` consumes
    // this; every other on_apply seam keeps the `eff` stats.
    bearer_base_health: f64,
    time: f64,
    applied_ids: &[String],
    combat_log: &mut Vec<CombatLogEntry>,
    record_trace: bool,
    bearer_label: &str,
) {
    for id in applied_ids {
        if !id.starts_with("user.") {
            continue;
        }
        let Some(spec) = crate::wasm_api::snapshot_user_status(id) else {
            continue;
        };
        // Stamp the applied-at time for `status.age` (first apply only; an
        // existing entry means this is a restack the diff mis-classified, which
        // can't happen - applied_ids is the absent→present set). Seeded for
        // every dynamic status, not just on_apply carriers, since other hooks
        // (on_tick / reactive) read `status.age`.
        bearer.status_applied_at.entry(id.clone()).or_insert(time);
        // Seed the tick schedule so the first tick lands one interval out
        // (never the same iteration as on_apply).
        if let Some(tick) = spec.on_tick.as_ref() {
            let interval = tick.interval_sec.max(MIN_TICK_INTERVAL_SEC);
            bearer
                .status_tick_due_at
                .entry(id.clone())
                .or_insert(time + interval);
        }
        let Some(batch) = spec.on_apply.clone() else {
            continue;
        };
        let stacks = bearer.statuses.get(id).map_or(0.0, |s| s.stacks);
        let state = build_status_hook_state(
            bearer, bearer_stats, other, other_stats, time, stacks, id, &[],
        );
        let label = format!("{} · on_apply", spec.display_name);
        apply_user_batch(
            bearer, other, bearer_stats, other_stats, time, &batch, &state, &label,
            Some(id.as_str()), combat_log, record_trace, bearer_label, false,
            // RAW base for a capping form-in installed by this on_apply hook.
            Some(bearer_base_health),
        );
    }
}

/// Fire `on_expire` then tear down installed modifiers for each dynamic user
/// status that left the bearer this iteration. `expired_ids` is the
/// per-iteration expire-diff (keys present at iteration start, gone now).
#[allow(clippy::too_many_arguments)]
pub fn dispatch_status_expire_for_bearer(
    bearer: &mut CombatSide,
    other: &mut CombatSide,
    bearer_stats: &SimpleCombatantStats,
    other_stats: &SimpleCombatantStats,
    // RAW base max HP for the teardown reconcile. MUST be the unmodified
    // `params.<side>.health`, NOT `bearer_stats.health` - in the phase-16 call
    // `bearer_stats` is the post-hoist `eff` struct whose `health` already has
    // the status's own cap folded in, so reconciling against it would re-apply
    // the cap (double-count). Symmetric with `process_form_revert`, which is
    // likewise fed `params.<side>.health`.
    bearer_base_health: f64,
    time: f64,
    expired_ids: &[String],
    combat_log: &mut Vec<CombatLogEntry>,
    record_trace: bool,
    bearer_label: &str,
) {
    for id in expired_ids {
        if !id.starts_with("user.") {
            continue;
        }
        let Some(spec) = crate::wasm_api::snapshot_user_status(id) else {
            continue;
        };
        if !spec.has_dynamic() {
            continue;
        }
        // The corpse-pin already ran this iteration, so reconciling a dead
        // bearer's HP would move a pinned corpse - fire on_expire + reconcile
        // only while alive. The modifier keys are stripped regardless (hygiene).
        if bearer.death_time.is_none() {
            if let Some(batch) = spec.on_expire.clone() {
                let state = build_status_hook_state(
                    bearer, bearer_stats, other, other_stats, time, 0.0, id, &[],
                );
                let label = format!("{} · on_expire", spec.display_name);
                apply_user_batch(
                    bearer, other, bearer_stats, other_stats, time, &batch, &state, &label,
                    Some(id.as_str()), combat_log, record_trace, bearer_label, false,
                    // on_expire reconcile is handled by teardown_status_scoped_modifiers
                    // below; the hook batch itself keeps the eff base (byte-identical).
                    None,
                );
            }
            teardown_status_scoped_modifiers(
                &mut bearer.user_extras,
                &mut bearer.hp,
                bearer_base_health,
                time,
                id,
            );
        } else {
            strip_status_modifier_keys(&mut bearer.user_extras, id);
        }
        bearer.status_tick_due_at.remove(id);
        bearer.status_tick_index.remove(id);
        bearer.status_applied_at.remove(id);
    }
}

/// Fire due `on_tick` hooks for every dynamic user status carried by the
/// bearer. At most one tick per status per iteration (mirrors ability ticks);
/// next-due advances by `due + interval` so a heavy iteration that overshoots
/// doesn't permanently drift the cadence.
#[allow(clippy::too_many_arguments)]
pub fn dispatch_status_ticks_for_bearer(
    bearer: &mut CombatSide,
    other: &mut CombatSide,
    bearer_stats: &SimpleCombatantStats,
    other_stats: &SimpleCombatantStats,
    time: f64,
    combat_log: &mut Vec<CombatLogEntry>,
    record_trace: bool,
    bearer_label: &str,
) {
    // Snapshot ids so we don't hold a borrow on `bearer.statuses` while
    // `apply_user_batch` mutates `bearer`.
    let ids: Vec<String> = bearer
        .statuses
        .keys()
        .filter(|id| id.starts_with("user."))
        .cloned()
        .collect();
    for id in &ids {
        let Some(spec) = crate::wasm_api::snapshot_user_status(id) else {
            continue;
        };
        let Some(tick) = spec.on_tick.as_ref() else {
            continue;
        };
        let interval = tick.interval_sec.max(MIN_TICK_INTERVAL_SEC);
        let due_at = bearer.status_tick_due_at.get(id).copied().unwrap_or(0.0);
        if time + 1e-9 < due_at {
            continue;
        }
        let tick_index = bearer.status_tick_index.get(id).copied().unwrap_or(0);
        let stacks = bearer.statuses.get(id).map_or(0.0, |s| s.stacks);
        let batch = tick.effects.clone();
        let state = build_status_hook_state(
            bearer,
            bearer_stats,
            other,
            other_stats,
            time,
            stacks,
            id,
            &[("tick_index", tick_index as f64)],
        );
        let label = format!("{} · on_tick", spec.display_name);
        apply_user_batch(
            bearer, other, bearer_stats, other_stats, time, &batch, &state, &label,
            Some(id.as_str()), combat_log, record_trace, bearer_label, false,
            // on_tick: not the apply diff this fix targets; eff base (byte-identical).
            None,
        );
        bearer
            .status_tick_due_at
            .insert(id.clone(), due_at + interval);
        bearer
            .status_tick_index
            .insert(id.clone(), tick_index + 1);
    }
}

/// Fire a bearer-reactive trigger (on_take_damage / on_kill / on_heal / …) for
/// every dynamic user status the bearer carries that defines it. Mirror of
/// [`crate::composable::user_dispatch::dispatch_user_trigger_for_caster`] but
/// iterates the bearer's `user.` statuses instead of its abilities: the status
/// behaviour rides with it onto any bearer, firing with bearer = `self` /
/// other side = `opponent`. `select` picks the trigger's batch off the spec;
/// `event_extras` is the per-trigger context (raw keys resolved as
/// `event.<key>`), shared verbatim with the ability dispatch so both react to
/// the same iteration deltas. No-op when no carried status defines the trigger.
#[allow(clippy::too_many_arguments)]
pub fn dispatch_status_trigger_for_bearer(
    bearer: &mut CombatSide,
    other: &mut CombatSide,
    bearer_stats: &SimpleCombatantStats,
    other_stats: &SimpleCombatantStats,
    time: f64,
    select: fn(&UserStatusSpec) -> Option<&EffectBatch>,
    event_extras: &[(String, f64)],
    label_suffix: &str,
    combat_log: &mut Vec<CombatLogEntry>,
    record_trace: bool,
    bearer_label: &str,
) {
    // Snapshot ids so we don't hold a borrow on `bearer.statuses` while
    // `apply_user_batch` mutates `bearer`. BTreeMap key order = deterministic.
    let ids: Vec<String> = bearer
        .statuses
        .keys()
        .filter(|id| id.starts_with("user."))
        .cloned()
        .collect();
    for id in &ids {
        dispatch_status_trigger_for_id(
            bearer, other, bearer_stats, other_stats, time, id, select, event_extras,
            label_suffix, combat_log, record_trace, bearer_label,
        );
    }
}

/// Fire `select`'s hook for ONE specific carried status. Used both by
/// [`dispatch_status_trigger_for_bearer`] (per carried id) and by the
/// per-status on_decay / on_restack diff, where the event belongs to that one
/// status (its stack count changed), not every carrier. No-op if the status
/// isn't a present `user.` status or doesn't define the hook.
#[allow(clippy::too_many_arguments)]
pub fn dispatch_status_trigger_for_id(
    bearer: &mut CombatSide,
    other: &mut CombatSide,
    bearer_stats: &SimpleCombatantStats,
    other_stats: &SimpleCombatantStats,
    time: f64,
    status_id: &str,
    select: fn(&UserStatusSpec) -> Option<&EffectBatch>,
    event_extras: &[(String, f64)],
    label_suffix: &str,
    combat_log: &mut Vec<CombatLogEntry>,
    record_trace: bool,
    bearer_label: &str,
) {
    if !status_id.starts_with("user.") {
        return;
    }
    let Some(spec) = crate::wasm_api::snapshot_user_status(status_id) else {
        return;
    };
    let Some(batch) = select(&spec).cloned() else {
        return;
    };
    let stacks = bearer.statuses.get(status_id).map_or(0.0, |s| s.stacks);
    let mut state =
        build_status_hook_state(bearer, bearer_stats, other, other_stats, time, stacks, status_id, &[]);
    for (k, v) in event_extras {
        state.extras.insert(k.clone(), PolicyValue::Number(*v));
    }
    let label = format!("{} · {}", spec.display_name, label_suffix);
    apply_user_batch(
        bearer, other, bearer_stats, other_stats, time, &batch, &state, &label,
        Some(status_id), combat_log, record_trace, bearer_label, false,
        // reactive status trigger: not the apply diff; eff base (byte-identical).
        None,
    );
}

/// Resolve every Expr-overridden numeric knob for the dynamic user statuses
/// this side carries, caching the result on each instance for the seams to
/// read. Runs once at the top of each iteration (where a `PolicyState`
/// exists). Statuses with no Expr overrides get `resolved_scalars = None`, so
/// their seams fall back to the static spec knob → byte-identical.
pub fn resolve_expr_scalars_for_side(
    side: &mut CombatSide,
    side_stats: &SimpleCombatantStats,
    other: &CombatSide,
    other_stats: &SimpleCombatantStats,
    time: f64,
) {
    let ids: Vec<String> = side
        .statuses
        .keys()
        .filter(|id| id.starts_with("user."))
        .cloned()
        .collect();
    for id in &ids {
        let Some(spec) = crate::wasm_api::snapshot_user_status(id) else {
            continue;
        };
        if !spec.has_expr_scalars() {
            if let Some(inst) = side.statuses.get_mut(id) {
                inst.resolved_scalars = None;
            }
            continue;
        }
        let stacks = side.statuses.get(id).map_or(0.0, |s| s.stacks);
        let state =
            build_status_hook_state(side, side_stats, other, other_stats, time, stacks, id, &[]);
        let resolved = ResolvedStatusScalars {
            tick_amount: spec.tick_amount_expr.as_ref().map(|e| e.eval(&state)),
            incoming_damage_mult: spec.incoming_damage_mult_expr.as_ref().map(|e| e.eval(&state)),
            outgoing_damage_mult: spec.outgoing_damage_mult_expr.as_ref().map(|e| e.eval(&state)),
            bite_cooldown_mult: spec.bite_cooldown_mult_expr.as_ref().map(|e| e.eval(&state)),
            regen_mod_pct: spec.regen_mod_expr.as_ref().map(|e| e.eval(&state)),
        };
        if let Some(inst) = side.statuses.get_mut(id) {
            inst.resolved_scalars = Some(resolved);
        }
    }
}

/// Strip every modifier the status installed (keyed by `status_id` as the
/// source segment), recompute the bearer's effective max HP, and reconcile
/// current HP per the policy the installing `form_swap` stamped for this
/// source. Reuses the FormSwap reconcile machinery - this is
/// `process_form_revert` scoped to one source rather than the single per-side
/// `form_revert.*` slot. No-op when the status installed no modifiers.
fn teardown_status_scoped_modifiers(
    extras: &mut BTreeMap<String, PolicyValue>,
    hp: &mut f64,
    base_health: f64,
    time: f64,
    status_id: &str,
) {
    let max_before = effective_stat_value(base_health, "health", extras, time).max(1.0);
    // Block-controlled: read the HP-reconcile policy the installing `form_swap`
    // stamped for this source (default `Ratio` for a `modify_stat`-only install,
    // which stamps none), then clear the marker. Honoring it makes a
    // status-scoped permanent form revert symmetrically with a finite form
    // (which already carries its policy in `form_revert.*`).
    let policy = read_status_teardown_policy(extras, status_id);
    clear_status_teardown_policy(extras, status_id);
    if !strip_status_modifier_keys(extras, status_id) {
        return; // installed no modifiers - nothing to reconcile
    }
    let max_after = effective_stat_value(base_health, "health", extras, time).max(1.0);
    if (max_after - max_before).abs() > 1e-9 {
        // The status "removes its own effect" on expiry, reconciling HP across
        // the max change per the authored policy (proportional by default).
        *hp = reconcile_form_hp(policy, *hp, max_before, max_after);
    }
}

/// Remove all `modifier.<field>.<mode>.<status_id>.{value,until}` keys from
/// `extras`. Returns true if any key was removed. Mirrors how
/// [`effective_stat_value`] extracts the source segment: strip the
/// `modifier.` prefix and the `.value`/`.until` suffix, then take everything
/// after `<field>.<mode>.` as the source (status ids contain dots, so the
/// source must be matched as the whole remainder, not a single segment).
fn strip_status_modifier_keys(
    extras: &mut BTreeMap<String, PolicyValue>,
    status_id: &str,
) -> bool {
    let before = extras.len();
    extras.retain(|key, _| {
        let Some(rest) = key.strip_prefix(MODIFIER_KEY_PREFIX) else {
            return true;
        };
        let core = match rest.strip_suffix(".value").or_else(|| rest.strip_suffix(".until")) {
            Some(c) => c,
            None => return true,
        };
        // core = "<field>.<mode>.<source>" - source keeps its own dots.
        let mut it = core.splitn(3, '.');
        let _field = it.next();
        let _mode = it.next();
        match it.next() {
            Some(source) => source != status_id,
            None => true, // legacy unsourced key (`<field>.<mode>`) - keep
        }
    });
    extras.len() != before
}

#[cfg(test)]
mod tests {
    use super::*;

    fn modifier_pair(
        field: &str,
        mode: &str,
        source: &str,
        value: f64,
        until: f64,
    ) -> [(String, PolicyValue); 2] {
        [
            (
                format!("{MODIFIER_KEY_PREFIX}{field}.{mode}.{source}.value"),
                PolicyValue::Number(value),
            ),
            (
                format!("{MODIFIER_KEY_PREFIX}{field}.{mode}.{source}.until"),
                PolicyValue::Number(until),
            ),
        ]
    }

    #[test]
    fn strip_targets_only_the_named_status_even_with_dotted_ids() {
        let mut extras: BTreeMap<String, PolicyValue> = BTreeMap::new();
        // Status ids contain dots - the source segment must be matched as the
        // whole remainder, not a single dot-segment.
        for (k, v) in modifier_pair("health", "mul", "user.Frail", 0.3, f64::INFINITY) {
            extras.insert(k, v);
        }
        // A second status modifying the SAME field - must survive.
        for (k, v) in modifier_pair("health", "mul", "user.Brittle", 0.5, f64::INFINITY) {
            extras.insert(k, v);
        }
        // A non-modifier scratch key - must survive.
        extras.insert("next_hit_floor".to_string(), PolicyValue::Number(5.0));

        assert!(strip_status_modifier_keys(&mut extras, "user.Frail"));
        assert!(!extras.contains_key(&format!("{MODIFIER_KEY_PREFIX}health.mul.user.Frail.value")));
        assert!(!extras.contains_key(&format!("{MODIFIER_KEY_PREFIX}health.mul.user.Frail.until")));
        assert!(extras.contains_key(&format!("{MODIFIER_KEY_PREFIX}health.mul.user.Brittle.value")));
        assert!(extras.contains_key("next_hit_floor"));
        // Stripping an absent source removes nothing.
        assert!(!strip_status_modifier_keys(&mut extras, "user.Frail"));
    }

    #[test]
    fn teardown_restores_max_hp_and_reconciles_ratio() {
        // user.Frail caps max HP to 30% (mul 0.3); base 1000 ⇒ eff 300. The
        // bearer sits at the capped full (hp 300). Teardown strips the cap
        // (eff max → 1000) and Ratio-reconciles hp 300 → 1000 - the
        // "proportionally restore on expire" acceptance behaviour.
        let base = 1000.0;
        let mut extras: BTreeMap<String, PolicyValue> = BTreeMap::new();
        for (k, v) in modifier_pair("health", "mul", "user.Frail", 0.3, f64::INFINITY) {
            extras.insert(k, v);
        }
        assert!((effective_stat_value(base, "health", &extras, 0.0) - 300.0).abs() < 1e-9);
        let mut hp = 300.0;
        teardown_status_scoped_modifiers(&mut extras, &mut hp, base, 0.0, "user.Frail");
        assert!((effective_stat_value(base, "health", &extras, 0.0) - 1000.0).abs() < 1e-9);
        assert!((hp - 1000.0).abs() < 1e-9, "expected restored 1000, got {hp}");
    }

    #[test]
    fn teardown_with_no_installed_modifiers_is_a_noop() {
        let mut extras: BTreeMap<String, PolicyValue> = BTreeMap::new();
        let mut hp = 742.0;
        teardown_status_scoped_modifiers(&mut extras, &mut hp, 1000.0, 0.0, "user.Frail");
        assert_eq!(hp, 742.0);
        assert!(extras.is_empty());
    }

    #[test]
    fn teardown_honors_stamped_absolute_policy() {
        // Same cap as the ratio test (base 1000, mul 0.3 ⇒ eff max 300), but the
        // installing form stamped hp:absolute. On teardown the current HP is
        // KEPT (200 → 200), not scaled up to the restored max - proving the
        // policy is read per-source from the marker rather than hardcoded Ratio.
        let base = 1000.0;
        let mut extras: BTreeMap<String, PolicyValue> = BTreeMap::new();
        for (k, v) in modifier_pair("health", "mul", "user.Frail", 0.3, f64::INFINITY) {
            extras.insert(k, v);
        }
        crate::effects::stamp_status_teardown_policy(
            &mut extras,
            "user.Frail",
            crate::effects::HpPolicy::Absolute,
        );
        let mut hp = 200.0;
        teardown_status_scoped_modifiers(&mut extras, &mut hp, base, 0.0, "user.Frail");
        assert!((effective_stat_value(base, "health", &extras, 0.0) - 1000.0).abs() < 1e-9);
        assert!((hp - 200.0).abs() < 1e-9, "Absolute keeps hp=200, got {hp}");
        // The per-source policy marker is cleaned up alongside the modifiers.
        assert!(!extras.keys().any(|k| k.starts_with("form_teardown.")));
    }
}
