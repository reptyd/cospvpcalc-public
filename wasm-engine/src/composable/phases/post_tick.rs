//! Phase 16 + post-tick housekeeping.
//!
//! Extracted from `phases/mod.rs`; contains exactly one public function,
//! `process_phase_16_post_tick`, and no private helpers (the function
//! uses only items from the parent composable namespace).

#![allow(clippy::too_many_arguments)]

use super::super::{
    compute_first_strike_active, policy_bridge, user_dispatch, user_status_dispatch,
    DamageCounters, PhaseContext,
};
use super::super::status_helpers::sweep_first_ailment_tick;
use crate::contracts::SimpleAbilityTimingMode;
use std::collections::BTreeSet;

/// Phase 16 + post-tick housekeeping: final death checks, per-tick
/// corpse pin, first-tick-rule sweep, and the full reactive-trigger
/// surface (damage / status apply / status expire / kill / first-strike
/// transitions, gated on `track_damage_triggers`), plus user-ability
/// dispatch (actives + ticks). Runs unconditionally at the end of every
/// loop iteration. The 13 phase-specific args carry iter-scope state
/// computed earlier in the loop body that this phase needs to read /
/// mutate.
#[allow(clippy::too_many_arguments)]
pub(in super::super) fn process_phase_16_post_tick(
    ctx: &mut PhaseContext<'_, '_>,
    counters: &mut DamageCounters,
    hp_a_at_b_death: &mut Option<f64>,
    hp_b_at_a_death: &mut Option<f64>,
    snapshot_a_dots: &BTreeSet<String>,
    snapshot_b_dots: &BTreeSet<String>,
    track_damage_triggers: bool,
    track_status_hooks: bool,
    // RAW base max HP per side (`params.<side>.health`), for the status-scoped
    // teardown reconcile. NOT `ctx.attacker/defender.health`, which here are the
    // post-hoist `eff` structs carrying the status's own cap.
    attacker_base_health: f64,
    defender_base_health: f64,
    hp_a_pre: f64,
    hp_b_pre: f64,
    death_a_pre: bool,
    death_b_pre: bool,
    status_keys_a_pre: Option<&BTreeSet<String>>,
    status_keys_b_pre: Option<&BTreeSet<String>>,
    // Phase 9: pre-iteration `user.` status stack counts, for the on_decay
    // (stacks dropped while surviving) / on_restack (stacks gained) diff.
    status_stacks_a_pre: Option<&std::collections::BTreeMap<String, f64>>,
    status_stacks_b_pre: Option<&std::collections::BTreeMap<String, f64>>,
    first_strike_a_pre: bool,
    first_strike_b_pre: bool,
    ability_policy: SimpleAbilityTimingMode,
) {
    // Phase 16: Final death checks
    if ctx.b.hp <= 0.0 && ctx.b.death_time.is_none() {
        ctx.b.death_time = Some(ctx.time);
        counters.dealt_a_at_b_death = counters.dealt_a;
        *hp_a_at_b_death = Some(ctx.a.hp.max(0.0));
        ctx.b.hp = 1.0;
    }
    if ctx.a.hp <= 0.0 && ctx.a.death_time.is_none() {
        ctx.a.death_time = Some(ctx.time);
        counters.dealt_b_at_a_death = counters.dealt_b;
        *hp_b_at_a_death = Some(ctx.b.hp.max(0.0));
        ctx.a.hp = 1.0;
    }

    // Per-tick corpse pin.
    if ctx.a.death_time.is_some() {
        ctx.a.hp = 1.0;
    }
    if ctx.b.death_time.is_some() {
        ctx.b.hp = 1.0;
    }

    // First Tick Rule (ailments half): post-iteration sweep.
    if ctx.config.attacker_compare_first_tick_ailments {
        sweep_first_ailment_tick(
            ctx.a,
            ctx.time,
            snapshot_a_dots,
            ctx.config.attacker_compare_first_tick_ailments,
            ctx.config.attacker_compare_first_tick_delay_sec,
        );
    }
    if ctx.config.defender_compare_first_tick_ailments {
        sweep_first_ailment_tick(
            ctx.b,
            ctx.time,
            snapshot_b_dots,
            ctx.config.defender_compare_first_tick_ailments,
            ctx.config.defender_compare_first_tick_delay_sec,
        );
    }

    // Type aliases for the status-trigger selector fn pointers, shared by the
    // damage block and the Tier A reactive block below (Phase 9 status↔ability
    // trigger parity).
    type StatusSpec = crate::user_status::UserStatusSpec;
    type Batch = crate::effects::EffectBatch;

    // Sprint 5.5: damage-event triggers. Phase 9: also entered for a dynamic
    // user status alone (no abilities) so status on_take/deal_damage fire off
    // the same deltas.
    if track_damage_triggers || track_status_hooks {
        use crate::composable::side::{DAMAGE_KIND_BITE, DAMAGE_KIND_BREATH, DAMAGE_KIND_DOT};
        // Round 36 / A10: derive per-kind event flags from the iter mask.
        // The dispatch sees the mask of whatever phases actually ran damage
        // this iteration; user abilities read `event.is_bite/breath/dot`
        // to react to specific damage kinds.
        let kinds_taken_a = ctx.a.iter_damage_kinds_taken;
        let kinds_taken_b = ctx.b.iter_damage_kinds_taken;
        let kinds_dealt_a = ctx.a.iter_damage_kinds_dealt;
        let kinds_dealt_b = ctx.b.iter_damage_kinds_dealt;
        let kind_extras = |mask: u32| -> Vec<(String, f64)> {
            vec![
                ("is_bite".to_string(), if mask & DAMAGE_KIND_BITE != 0 { 1.0 } else { 0.0 }),
                ("is_breath".to_string(), if mask & DAMAGE_KIND_BREATH != 0 { 1.0 } else { 0.0 }),
                ("is_dot".to_string(), if mask & DAMAGE_KIND_DOT != 0 { 1.0 } else { 0.0 }),
            ]
        };

        let delta_a = (hp_a_pre - ctx.a.hp).max(0.0);
        let delta_b = (hp_b_pre - ctx.b.hp).max(0.0);
        // Round 43 / A10b: pre-mitigation totals seen by the
        // post-damage triggers. `event.raw_damage` = sum of raw inputs
        // before built-in mitigation + user pre-damage hooks;
        // `event.prevented_damage` = raw - taken.
        let raw_taken_a = ctx.a.iter_raw_damage_taken;
        let raw_taken_b = ctx.b.iter_raw_damage_taken;
        let raw_dealt_a = ctx.a.iter_raw_damage_dealt;
        let raw_dealt_b = ctx.b.iter_raw_damage_dealt;
        // Each side's event context is built once and shared between the
        // ability dispatch and the status dispatch so both react to identical
        // numbers. The status dispatch (gated on `track_status_hooks`) iterates
        // the bearer's `user.` statuses for the matching trigger batch.
        let select_take: fn(&StatusSpec) -> Option<&Batch> = |s| s.on_take_damage.as_ref();
        let select_deal: fn(&StatusSpec) -> Option<&Batch> = |s| s.on_deal_damage.as_ref();
        if delta_a > 0.0 {
            let mut taken_a = vec![
                ("damage_taken".to_string(), delta_a),
                ("raw_damage".to_string(), raw_taken_a),
                ("prevented_damage".to_string(), (raw_taken_a - delta_a).max(0.0)),
            ];
            taken_a.extend(kind_extras(kinds_taken_a));
            if !ctx.attacker.user_ability_ids.is_empty() {
                user_dispatch::dispatch_user_trigger_for_caster(
                    ctx.a, ctx.b, ctx.attacker, ctx.defender, ctx.time,
                    crate::policy::user_ability::TriggerHook::OnTakeDamage,
                    taken_a.clone(),
                    ctx.combat_log, ctx.record_trace, "A",
                );
            }
            if track_status_hooks {
                user_status_dispatch::dispatch_status_trigger_for_bearer(
                    ctx.a, ctx.b, ctx.attacker, ctx.defender, ctx.time,
                    select_take, &taken_a, "on_take_damage",
                    ctx.combat_log, ctx.record_trace, "A",
                );
            }
            let mut dealt_b = vec![
                ("damage_dealt".to_string(), delta_a),
                ("raw_damage".to_string(), raw_dealt_b),
                ("prevented_damage".to_string(), (raw_dealt_b - delta_a).max(0.0)),
            ];
            dealt_b.extend(kind_extras(kinds_dealt_b));
            if !ctx.defender.user_ability_ids.is_empty() {
                user_dispatch::dispatch_user_trigger_for_caster(
                    ctx.b, ctx.a, ctx.defender, ctx.attacker, ctx.time,
                    crate::policy::user_ability::TriggerHook::OnDealDamage,
                    dealt_b.clone(),
                    ctx.combat_log, ctx.record_trace, "B",
                );
            }
            if track_status_hooks {
                user_status_dispatch::dispatch_status_trigger_for_bearer(
                    ctx.b, ctx.a, ctx.defender, ctx.attacker, ctx.time,
                    select_deal, &dealt_b, "on_deal_damage",
                    ctx.combat_log, ctx.record_trace, "B",
                );
            }
        }
        if delta_b > 0.0 {
            let mut taken_b = vec![
                ("damage_taken".to_string(), delta_b),
                ("raw_damage".to_string(), raw_taken_b),
                ("prevented_damage".to_string(), (raw_taken_b - delta_b).max(0.0)),
            ];
            taken_b.extend(kind_extras(kinds_taken_b));
            if !ctx.defender.user_ability_ids.is_empty() {
                user_dispatch::dispatch_user_trigger_for_caster(
                    ctx.b, ctx.a, ctx.defender, ctx.attacker, ctx.time,
                    crate::policy::user_ability::TriggerHook::OnTakeDamage,
                    taken_b.clone(),
                    ctx.combat_log, ctx.record_trace, "B",
                );
            }
            if track_status_hooks {
                user_status_dispatch::dispatch_status_trigger_for_bearer(
                    ctx.b, ctx.a, ctx.defender, ctx.attacker, ctx.time,
                    select_take, &taken_b, "on_take_damage",
                    ctx.combat_log, ctx.record_trace, "B",
                );
            }
            let mut dealt_a = vec![
                ("damage_dealt".to_string(), delta_b),
                ("raw_damage".to_string(), raw_dealt_a),
                ("prevented_damage".to_string(), (raw_dealt_a - delta_b).max(0.0)),
            ];
            dealt_a.extend(kind_extras(kinds_dealt_a));
            if !ctx.attacker.user_ability_ids.is_empty() {
                user_dispatch::dispatch_user_trigger_for_caster(
                    ctx.a, ctx.b, ctx.attacker, ctx.defender, ctx.time,
                    crate::policy::user_ability::TriggerHook::OnDealDamage,
                    dealt_a.clone(),
                    ctx.combat_log, ctx.record_trace, "A",
                );
            }
            if track_status_hooks {
                user_status_dispatch::dispatch_status_trigger_for_bearer(
                    ctx.a, ctx.b, ctx.attacker, ctx.defender, ctx.time,
                    select_deal, &dealt_a, "on_deal_damage",
                    ctx.combat_log, ctx.record_trace, "A",
                );
            }
        }
    }

    // Larger Tier A: full reactive trigger surface.
    // Phase 9: also entered when only a dynamic user status is present (no
    // abilities) so status-OWNED on_apply / on_expire fire off the same diff.
    if track_damage_triggers || track_status_hooks {
        // on_status_apply / on_status_expire — diff status keys.
        if let (Some(pre_a), Some(pre_b)) = (status_keys_a_pre, status_keys_b_pre) {
            let post_a: std::collections::BTreeSet<String> = ctx.a.statuses.keys().cloned().collect();
            let post_b: std::collections::BTreeSet<String> = ctx.b.statuses.keys().cloned().collect();
            // Round 33 / A9: collect the actual per-id sets, not just counts.
            // Each applied/expired id becomes a 1.0 flag at `event.applied.<id>`
            // / `event.expired.<id>` so user abilities can write counter-mechanics
            // like `if event.applied.Poison_Status: apply_status opp Disease_Status 3`.
            let applied_a: Vec<&String> = post_a.difference(pre_a).collect();
            let expired_a: Vec<&String> = pre_a.difference(&post_a).collect();
            let applied_b: Vec<&String> = post_b.difference(pre_b).collect();
            let expired_b: Vec<&String> = pre_b.difference(&post_b).collect();
            let added_a = applied_a.len() as f64;
            let removed_a = expired_a.len() as f64;
            let added_b = applied_b.len() as f64;
            let removed_b = expired_b.len() as f64;
            if !ctx.attacker.user_ability_ids.is_empty() {
                if added_a > 0.0 {
                    let mut extras = vec![("applied_status_count".to_string(), added_a)];
                    for id in &applied_a {
                        extras.push((format!("applied.{}", id), 1.0));
                    }
                    user_dispatch::dispatch_user_trigger_for_caster(
                        ctx.a, ctx.b, ctx.attacker, ctx.defender, ctx.time,
                        crate::policy::user_ability::TriggerHook::OnStatusApply,
                        extras,
                        ctx.combat_log, ctx.record_trace, "A",
                    );
                }
                if removed_a > 0.0 {
                    let mut extras = vec![("expired_status_count".to_string(), removed_a)];
                    for id in &expired_a {
                        extras.push((format!("expired.{}", id), 1.0));
                    }
                    user_dispatch::dispatch_user_trigger_for_caster(
                        ctx.a, ctx.b, ctx.attacker, ctx.defender, ctx.time,
                        crate::policy::user_ability::TriggerHook::OnStatusExpire,
                        extras,
                        ctx.combat_log, ctx.record_trace, "A",
                    );
                }
            }
            if !ctx.defender.user_ability_ids.is_empty() {
                if added_b > 0.0 {
                    let mut extras = vec![("applied_status_count".to_string(), added_b)];
                    for id in &applied_b {
                        extras.push((format!("applied.{}", id), 1.0));
                    }
                    user_dispatch::dispatch_user_trigger_for_caster(
                        ctx.b, ctx.a, ctx.defender, ctx.attacker, ctx.time,
                        crate::policy::user_ability::TriggerHook::OnStatusApply,
                        extras,
                        ctx.combat_log, ctx.record_trace, "B",
                    );
                }
                if removed_b > 0.0 {
                    let mut extras = vec![("expired_status_count".to_string(), removed_b)];
                    for id in &expired_b {
                        extras.push((format!("expired.{}", id), 1.0));
                    }
                    user_dispatch::dispatch_user_trigger_for_caster(
                        ctx.b, ctx.a, ctx.defender, ctx.attacker, ctx.time,
                        crate::policy::user_ability::TriggerHook::OnStatusExpire,
                        extras,
                        ctx.combat_log, ctx.record_trace, "B",
                    );
                }
            }
            // Phase 9: status-OWNED on_apply / on_expire. Same apply/expire
            // diff, but keyed on the carried status's spec (fired with the
            // bearer as caster) instead of the side's abilities. Expire runs
            // before apply within an iteration so a status that re-applies on
            // expire is treated as a fresh apply; expire also tears down any
            // stat modifiers the status installed.
            if track_status_hooks {
                let applied_a_owned: Vec<String> =
                    applied_a.iter().map(|s| (*s).clone()).collect();
                let expired_a_owned: Vec<String> =
                    expired_a.iter().map(|s| (*s).clone()).collect();
                let applied_b_owned: Vec<String> =
                    applied_b.iter().map(|s| (*s).clone()).collect();
                let expired_b_owned: Vec<String> =
                    expired_b.iter().map(|s| (*s).clone()).collect();
                user_status_dispatch::dispatch_status_expire_for_bearer(
                    ctx.a, ctx.b, ctx.attacker, ctx.defender, attacker_base_health, ctx.time,
                    &expired_a_owned, ctx.combat_log, ctx.record_trace, "A",
                );
                user_status_dispatch::dispatch_status_expire_for_bearer(
                    ctx.b, ctx.a, ctx.defender, ctx.attacker, defender_base_health, ctx.time,
                    &expired_b_owned, ctx.combat_log, ctx.record_trace, "B",
                );
                user_status_dispatch::dispatch_status_apply_for_bearer(
                    ctx.a, ctx.b, ctx.attacker, ctx.defender, attacker_base_health, ctx.time,
                    &applied_a_owned, ctx.combat_log, ctx.record_trace, "A",
                );
                user_status_dispatch::dispatch_status_apply_for_bearer(
                    ctx.b, ctx.a, ctx.defender, ctx.attacker, defender_base_health, ctx.time,
                    &applied_b_owned, ctx.combat_log, ctx.record_trace, "B",
                );
                // Phase 9 reactive: a carried status can react to ANOTHER status
                // arriving / leaving the bearer (mirror of the ability
                // on_status_apply / on_status_expire). Fired AFTER lifecycle so
                // the newly-applied statuses are fully installed; an expired
                // status is already gone, so only survivors react to it.
                let select_status_apply: fn(&StatusSpec) -> Option<&Batch> =
                    |s| s.on_status_apply.as_ref();
                let select_status_expire: fn(&StatusSpec) -> Option<&Batch> =
                    |s| s.on_status_expire.as_ref();
                let applied_extras = |ids: &[String]| -> Vec<(String, f64)> {
                    let mut e = vec![("applied_status_count".to_string(), ids.len() as f64)];
                    for id in ids {
                        e.push((format!("applied.{}", id), 1.0));
                    }
                    e
                };
                let expired_extras = |ids: &[String]| -> Vec<(String, f64)> {
                    let mut e = vec![("expired_status_count".to_string(), ids.len() as f64)];
                    for id in ids {
                        e.push((format!("expired.{}", id), 1.0));
                    }
                    e
                };
                if !expired_a_owned.is_empty() {
                    let ex = expired_extras(&expired_a_owned);
                    user_status_dispatch::dispatch_status_trigger_for_bearer(
                        ctx.a, ctx.b, ctx.attacker, ctx.defender, ctx.time,
                        select_status_expire, &ex, "on_status_expire",
                        ctx.combat_log, ctx.record_trace, "A",
                    );
                }
                if !expired_b_owned.is_empty() {
                    let ex = expired_extras(&expired_b_owned);
                    user_status_dispatch::dispatch_status_trigger_for_bearer(
                        ctx.b, ctx.a, ctx.defender, ctx.attacker, ctx.time,
                        select_status_expire, &ex, "on_status_expire",
                        ctx.combat_log, ctx.record_trace, "B",
                    );
                }
                if !applied_a_owned.is_empty() {
                    let ap = applied_extras(&applied_a_owned);
                    user_status_dispatch::dispatch_status_trigger_for_bearer(
                        ctx.a, ctx.b, ctx.attacker, ctx.defender, ctx.time,
                        select_status_apply, &ap, "on_status_apply",
                        ctx.combat_log, ctx.record_trace, "A",
                    );
                }
                if !applied_b_owned.is_empty() {
                    let ap = applied_extras(&applied_b_owned);
                    user_status_dispatch::dispatch_status_trigger_for_bearer(
                        ctx.b, ctx.a, ctx.defender, ctx.attacker, ctx.time,
                        select_status_apply, &ap, "on_status_apply",
                        ctx.combat_log, ctx.record_trace, "B",
                    );
                }
            }
        }
        // Phase 9 per-status: on_decay (a SURVIVING status lost stacks) /
        // on_restack (a present status gained stacks). Brand-new applies are
        // on_apply, drops to 0 are on_expire (both handled above); this covers
        // only statuses present BOTH before and after with a changed count. The
        // event belongs to that ONE status, so it dispatches per-id.
        if let (Some(sa_pre), Some(sb_pre)) = (status_stacks_a_pre, status_stacks_b_pre) {
            let select_decay: fn(&StatusSpec) -> Option<&Batch> = |s| s.on_decay.as_ref();
            let select_restack: fn(&StatusSpec) -> Option<&Batch> = |s| s.on_restack.as_ref();
            // Collect (id, delta) before dispatching so we don't hold a borrow
            // on `statuses` while a hook mutates the side. delta<0 = decay.
            let deltas_a: Vec<(String, f64)> = sa_pre
                .iter()
                .filter_map(|(id, &p)| ctx.a.statuses.get(id).map(|i| (id.clone(), i.stacks - p)))
                .filter(|(_, d)| d.abs() > 1e-9)
                .collect();
            let deltas_b: Vec<(String, f64)> = sb_pre
                .iter()
                .filter_map(|(id, &p)| ctx.b.statuses.get(id).map(|i| (id.clone(), i.stacks - p)))
                .filter(|(_, d)| d.abs() > 1e-9)
                .collect();
            for (id, delta) in deltas_a {
                let (sel, ev, lbl) = if delta < 0.0 {
                    (select_decay, vec![("stacks_lost".to_string(), -delta)], "on_decay")
                } else {
                    (select_restack, vec![("stacks_gained".to_string(), delta)], "on_restack")
                };
                user_status_dispatch::dispatch_status_trigger_for_id(
                    ctx.a, ctx.b, ctx.attacker, ctx.defender, ctx.time, &id,
                    sel, &ev, lbl, ctx.combat_log, ctx.record_trace, "A",
                );
            }
            for (id, delta) in deltas_b {
                let (sel, ev, lbl) = if delta < 0.0 {
                    (select_decay, vec![("stacks_lost".to_string(), -delta)], "on_decay")
                } else {
                    (select_restack, vec![("stacks_gained".to_string(), delta)], "on_restack")
                };
                user_status_dispatch::dispatch_status_trigger_for_id(
                    ctx.b, ctx.a, ctx.defender, ctx.attacker, ctx.time, &id,
                    sel, &ev, lbl, ctx.combat_log, ctx.record_trace, "B",
                );
            }
        }
        // on_kill — alive → dead this iteration. Ability + status share the
        // same `event.damage_dealt` (final blow); each gated on its own surface.
        let death_a_post = ctx.a.death_time.is_some();
        let death_b_post = ctx.b.death_time.is_some();
        let select_kill: fn(&StatusSpec) -> Option<&Batch> = |s| s.on_kill.as_ref();
        let select_fs: fn(&StatusSpec) -> Option<&Batch> = |s| s.on_first_strike.as_ref();
        let select_heal: fn(&StatusSpec) -> Option<&Batch> = |s| s.on_heal.as_ref();
        if !death_b_pre && death_b_post {
            let kill_extras = vec![("damage_dealt".to_string(), (hp_b_pre - ctx.b.hp).max(0.0))];
            if !ctx.attacker.user_ability_ids.is_empty() {
                user_dispatch::dispatch_user_trigger_for_caster(
                    ctx.a, ctx.b, ctx.attacker, ctx.defender, ctx.time,
                    crate::policy::user_ability::TriggerHook::OnKill,
                    kill_extras.clone(),
                    ctx.combat_log, ctx.record_trace, "A",
                );
            }
            if track_status_hooks {
                user_status_dispatch::dispatch_status_trigger_for_bearer(
                    ctx.a, ctx.b, ctx.attacker, ctx.defender, ctx.time,
                    select_kill, &kill_extras, "on_kill",
                    ctx.combat_log, ctx.record_trace, "A",
                );
            }
        }
        if !death_a_pre && death_a_post {
            let kill_extras = vec![("damage_dealt".to_string(), (hp_a_pre - ctx.a.hp).max(0.0))];
            if !ctx.defender.user_ability_ids.is_empty() {
                user_dispatch::dispatch_user_trigger_for_caster(
                    ctx.b, ctx.a, ctx.defender, ctx.attacker, ctx.time,
                    crate::policy::user_ability::TriggerHook::OnKill,
                    kill_extras.clone(),
                    ctx.combat_log, ctx.record_trace, "B",
                );
            }
            if track_status_hooks {
                user_status_dispatch::dispatch_status_trigger_for_bearer(
                    ctx.b, ctx.a, ctx.defender, ctx.attacker, ctx.time,
                    select_kill, &kill_extras, "on_kill",
                    ctx.combat_log, ctx.record_trace, "B",
                );
            }
        }
        // on_first_strike — transition either direction.
        let first_strike_a_post = compute_first_strike_active(ctx.attacker, ctx.a.hp);
        let first_strike_b_post = compute_first_strike_active(ctx.defender, ctx.b.hp);
        if first_strike_a_post != first_strike_a_pre {
            let fs_extras = vec![("first_strike_active".to_string(), if first_strike_a_post { 1.0 } else { 0.0 })];
            if !ctx.attacker.user_ability_ids.is_empty() {
                user_dispatch::dispatch_user_trigger_for_caster(
                    ctx.a, ctx.b, ctx.attacker, ctx.defender, ctx.time,
                    crate::policy::user_ability::TriggerHook::OnFirstStrike,
                    fs_extras.clone(),
                    ctx.combat_log, ctx.record_trace, "A",
                );
            }
            if track_status_hooks {
                user_status_dispatch::dispatch_status_trigger_for_bearer(
                    ctx.a, ctx.b, ctx.attacker, ctx.defender, ctx.time,
                    select_fs, &fs_extras, "on_first_strike",
                    ctx.combat_log, ctx.record_trace, "A",
                );
            }
        }
        if first_strike_b_post != first_strike_b_pre {
            let fs_extras = vec![("first_strike_active".to_string(), if first_strike_b_post { 1.0 } else { 0.0 })];
            if !ctx.defender.user_ability_ids.is_empty() {
                user_dispatch::dispatch_user_trigger_for_caster(
                    ctx.b, ctx.a, ctx.defender, ctx.attacker, ctx.time,
                    crate::policy::user_ability::TriggerHook::OnFirstStrike,
                    fs_extras.clone(),
                    ctx.combat_log, ctx.record_trace, "B",
                );
            }
            if track_status_hooks {
                user_status_dispatch::dispatch_status_trigger_for_bearer(
                    ctx.b, ctx.a, ctx.defender, ctx.attacker, ctx.time,
                    select_fs, &fs_extras, "on_first_strike",
                    ctx.combat_log, ctx.record_trace, "B",
                );
            }
        }
        // Round 37 / A7: on_heal — dispatch if accumulator > 0.
        if ctx.a.iter_healing_taken > 0.0 {
            let heal_extras = vec![("heal_amount".to_string(), ctx.a.iter_healing_taken)];
            if !ctx.attacker.user_ability_ids.is_empty() {
                user_dispatch::dispatch_user_trigger_for_caster(
                    ctx.a, ctx.b, ctx.attacker, ctx.defender, ctx.time,
                    crate::policy::user_ability::TriggerHook::OnHeal,
                    heal_extras.clone(),
                    ctx.combat_log, ctx.record_trace, "A",
                );
            }
            if track_status_hooks {
                user_status_dispatch::dispatch_status_trigger_for_bearer(
                    ctx.a, ctx.b, ctx.attacker, ctx.defender, ctx.time,
                    select_heal, &heal_extras, "on_heal",
                    ctx.combat_log, ctx.record_trace, "A",
                );
            }
        }
        if ctx.b.iter_healing_taken > 0.0 {
            let heal_extras = vec![("heal_amount".to_string(), ctx.b.iter_healing_taken)];
            if !ctx.defender.user_ability_ids.is_empty() {
                user_dispatch::dispatch_user_trigger_for_caster(
                    ctx.b, ctx.a, ctx.defender, ctx.attacker, ctx.time,
                    crate::policy::user_ability::TriggerHook::OnHeal,
                    heal_extras.clone(),
                    ctx.combat_log, ctx.record_trace, "B",
                );
            }
            if track_status_hooks {
                user_status_dispatch::dispatch_status_trigger_for_bearer(
                    ctx.b, ctx.a, ctx.defender, ctx.attacker, ctx.time,
                    select_heal, &heal_extras, "on_heal",
                    ctx.combat_log, ctx.record_trace, "B",
                );
            }
        }
        // Round 37 / A7: on_active_end — diff the pre-iter snapshot
        // against the current `user_active_until` map. Any key whose
        // value was > pre-time but now <= current time has just expired
        // naturally. The current `until` may also have been ADVANCED
        // by effects in this iter, in which case the key is not
        // considered ended (it's still in the future).
        let collect_ended = |pre: &std::collections::BTreeMap<String, f64>,
                             current: &std::collections::BTreeMap<String, f64>,
                             time: f64|
         -> Vec<(String, f64)> {
            let mut out = Vec::new();
            for id in pre.keys() {
                let current_until = current.get(id).copied().unwrap_or(0.0);
                if current_until <= time {
                    out.push((format!("ended.{}", id), 1.0));
                }
            }
            out
        };
        if !ctx.attacker.user_ability_ids.is_empty()
            && (!ctx.a.iter_user_active_until_pre.is_empty()
                || !ctx.a.iter_builtin_active_until_pre.is_empty())
        {
            let cur_builtin = ctx.a.builtin_active_windows();
            let mut ended = collect_ended(
                &ctx.a.iter_user_active_until_pre,
                &ctx.a.user_active_until,
                ctx.time,
            );
            // G5: also diff the built-in active windows.
            ended.extend(collect_ended(
                &ctx.a.iter_builtin_active_until_pre,
                &cur_builtin,
                ctx.time,
            ));
            if !ended.is_empty() {
                let mut extras = vec![("ended_count".to_string(), ended.len() as f64)];
                extras.extend(ended);
                user_dispatch::dispatch_user_trigger_for_caster(
                    ctx.a, ctx.b, ctx.attacker, ctx.defender, ctx.time,
                    crate::policy::user_ability::TriggerHook::OnActiveEnd,
                    extras,
                    ctx.combat_log, ctx.record_trace, "A",
                );
            }
        }
        if !ctx.defender.user_ability_ids.is_empty()
            && (!ctx.b.iter_user_active_until_pre.is_empty()
                || !ctx.b.iter_builtin_active_until_pre.is_empty())
        {
            let cur_builtin = ctx.b.builtin_active_windows();
            let mut ended = collect_ended(
                &ctx.b.iter_user_active_until_pre,
                &ctx.b.user_active_until,
                ctx.time,
            );
            // G5: also diff the built-in active windows.
            ended.extend(collect_ended(
                &ctx.b.iter_builtin_active_until_pre,
                &cur_builtin,
                ctx.time,
            ));
            if !ended.is_empty() {
                let mut extras = vec![("ended_count".to_string(), ended.len() as f64)];
                extras.extend(ended);
                user_dispatch::dispatch_user_trigger_for_caster(
                    ctx.b, ctx.a, ctx.defender, ctx.attacker, ctx.time,
                    crate::policy::user_ability::TriggerHook::OnActiveEnd,
                    extras,
                    ctx.combat_log, ctx.record_trace, "B",
                );
            }
        }
    }

    // Sprint 5.2: dispatch user (custom) abilities for both sides.
    if !ctx.attacker.user_ability_ids.is_empty() {
        let mode = policy_bridge::map_timing_mode(ability_policy);
        user_dispatch::dispatch_user_actives_for_caster(
            ctx.a, ctx.b, ctx.attacker, ctx.defender,
            ctx.time, mode,
            &ctx.config.attacker_ability_policy_overrides.user_ability_overrides,
            ctx.combat_log, ctx.record_trace, "A",
        );
        user_dispatch::dispatch_user_ticks_for_caster(
            ctx.a, ctx.b, ctx.attacker, ctx.defender,
            ctx.time, ctx.combat_log, ctx.record_trace, "A",
        );
    }
    if !ctx.defender.user_ability_ids.is_empty() {
        let mode = policy_bridge::map_timing_mode(ability_policy);
        user_dispatch::dispatch_user_actives_for_caster(
            ctx.b, ctx.a, ctx.defender, ctx.attacker,
            ctx.time, mode,
            &ctx.config.defender_ability_policy_overrides.user_ability_overrides,
            ctx.combat_log, ctx.record_trace, "B",
        );
        user_dispatch::dispatch_user_ticks_for_caster(
            ctx.b, ctx.a, ctx.defender, ctx.attacker,
            ctx.time, ctx.combat_log, ctx.record_trace, "B",
        );
    }

    // Phase 9: status-OWNED on_tick hooks, after ability ticks. Each dynamic
    // user status carried by a side fires on its own cadence with the bearer
    // as caster.
    if track_status_hooks {
        user_status_dispatch::dispatch_status_ticks_for_bearer(
            ctx.a, ctx.b, ctx.attacker, ctx.defender,
            ctx.time, ctx.combat_log, ctx.record_trace, "A",
        );
        user_status_dispatch::dispatch_status_ticks_for_bearer(
            ctx.b, ctx.a, ctx.defender, ctx.attacker,
            ctx.time, ctx.combat_log, ctx.record_trace, "B",
        );
    }
}
