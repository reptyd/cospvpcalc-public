// Status-handling helpers for the composable engine.
//
// Extracted from composable/mod.rs (light split, behavior-preserving).
//
// Covers: formatting helpers used by combat-log emission, natural-decay log
// emitter, trace-aware status apply wrapper, compare-only hunger ticker,
// DoT snapshot/First-Tick sweep, and the `apply_status_delta` primitive used
// by the Lich Mark family.

use std::collections::{BTreeMap, BTreeSet};

use crate::compare_hunger;
use crate::contracts::{
    CombatLogEntry, SimpleAppliedStatus, SimpleCombatantStats, SimpleStatusInstance,
};
use crate::statuses::{
    apply_incoming_statuses_to_target_with_fortify_immunity, apply_simple_status, status_tick_sec,
    StatusDecayLogEntry,
};

use super::CombatSide;

/// Mirror of TS `formatStatusLabel` (statusDurationRuntime.ts:37-42):
/// strips a trailing `_Status` suffix and replaces remaining underscores with spaces.
pub(super) fn format_status_label(status_id: &str) -> String {
    let trimmed = if status_id.len() >= 7
        && status_id[status_id.len() - 7..].eq_ignore_ascii_case("_Status")
    {
        &status_id[..status_id.len() - 7]
    } else {
        status_id
    };
    trimmed.replace('_', " ").trim().to_string()
}

/// Mirror of TS `formatStacks` (statusDurationRuntime.ts:44-46):
/// integer stacks render as the integer, non-integer as 2-decimal with trailing zeros stripped.
pub(super) fn format_stacks(stacks: f64) -> String {
    if (stacks - stacks.round()).abs() < 1e-9 {
        format!("{}", stacks.round() as i64)
    } else {
        let s = format!("{:.2}", stacks);
        let trimmed = s.trim_end_matches('0').trim_end_matches('.');
        trimmed.to_string()
    }
}

/// Increment `side.ability_activation_counts[name]` and, if `record_trace`
/// is true, push a `"<name> activated"` combat_log entry. Used by each
/// ability's fire site to give the UI a single consistent event shape
/// (Timeline + "Abilities Used" panel) without per-ability bespoke logs.
pub(super) fn record_ability_event(
    side: &mut CombatSide,
    side_label: &str,
    combat_log: &mut Vec<CombatLogEntry>,
    record_trace: bool,
    time: f64,
    name: &str,
) {
    *side
        .ability_activation_counts
        .entry(name.to_string())
        .or_insert(0) += 1;
    if record_trace {
        let hp_after = side.hp.max(0.0);
        combat_log.push(CombatLogEntry {
            time,
            entry_type: "ability".to_string(),
            attacker: side_label.to_string(),
            damage: 0.0,
            healing: None,
            actor_hp_after: hp_after,
            hp_side: side_label.to_string(),
            hp_after,
            description: Some(format!("{} activated", name)),
            detail: None,
            status_id: None,
        });
    }
}

/// Emit natural-decay / natural-expiry combat_log entries for a side.
pub(super) fn emit_status_decay_log(
    combat_log: &mut Vec<CombatLogEntry>,
    time: f64,
    side_label: &str,
    side_hp: f64,
    decay_log: &[StatusDecayLogEntry],
) {
    for entry in decay_log {
        let hp_after = side_hp.max(0.0);
        let (description, detail) = if entry.new_stacks <= 0.0 {
            (
                format!("{} naturally expired", format_status_label(&entry.status_id)),
                format!("{} -> 0 stacks", format_stacks(entry.previous_stacks)),
            )
        } else {
            (
                format!("{} naturally decayed", format_status_label(&entry.status_id)),
                format!(
                    "{} -> {} stacks",
                    format_stacks(entry.previous_stacks),
                    format_stacks(entry.new_stacks)
                ),
            )
        };
        combat_log.push(CombatLogEntry {
            time,
            entry_type: "ability".to_string(),
            attacker: side_label.to_string(),
            damage: 0.0,
            healing: None,
            actor_hp_after: hp_after,
            hp_side: side_label.to_string(),
            hp_after,
            description: Some(description),
            detail: Some(detail),
            status_id: Some(entry.status_id.clone()),
        });
    }
}

/// Trace-aware wrapper around `apply_incoming_statuses_to_target_with_fortify_immunity`.
/// Snapshots target stacks pre-apply, runs the standard apply, then diffs and
/// emits "<ability_name> applied <Label> (<N>)" or
/// "<ability_name> removed <Label> (<N>)" combat_log entries for each status
/// whose stacks changed. No-op when `combat_log` is `None`.
///
/// Mirrors TS `statusApplyRuntime.ts:137-148` push shape: type=ability,
/// attacker=source side, hpSide=target side, damage=0, statusId populated.
#[allow(clippy::too_many_arguments)]
pub(super) fn apply_statuses_with_trace(
    time: f64,
    target: &SimpleCombatantStats,
    target_hp: f64,
    target_statuses: &mut BTreeMap<String, SimpleStatusInstance>,
    applied: &[SimpleAppliedStatus],
    fortify_immune_until: f64,
    source_side: &str,
    source_hp: f64,
    target_side: &str,
    source_ability: &str,
    combat_log: Option<&mut Vec<CombatLogEntry>>,
) {
    let mut before: Vec<(String, f64)> = Vec::new();
    if combat_log.is_some() {
        before.reserve(applied.len());
        for effect in applied {
            let prev = target_statuses
                .get(&effect.status_id)
                .map(|s| s.stacks)
                .unwrap_or(0.0);
            before.push((effect.status_id.clone(), prev));
        }
    }
    apply_incoming_statuses_to_target_with_fortify_immunity(
        time,
        target,
        target_hp,
        target_statuses,
        applied,
        fortify_immune_until,
    );
    if let Some(log) = combat_log {
        let source_hp_after = source_hp.max(0.0);
        let target_hp_after = target_hp.max(0.0);
        for (status_id, before_stacks) in before.iter() {
            let after_stacks = target_statuses
                .get(status_id)
                .map(|s| s.stacks)
                .unwrap_or(0.0);
            let delta = after_stacks - *before_stacks;
            if delta.abs() > 1e-9 {
                let (verb, stacks) = if delta > 0.0 {
                    ("applied", delta)
                } else {
                    ("removed", -delta)
                };
                log.push(CombatLogEntry {
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
                        format_status_label(status_id),
                        format_stacks(stacks)
                    )),
                    detail: Some(format!(
                        "{} -> {} stacks",
                        format_stacks(*before_stacks),
                        format_stacks(after_stacks)
                    )),
                    status_id: Some(status_id.clone()),
                });
            }
        }
    }
}

#[allow(clippy::too_many_arguments)]
pub(super) fn apply_statuses_with_per_effect_trace(
    time: f64,
    target: &SimpleCombatantStats,
    target_hp: f64,
    target_statuses: &mut BTreeMap<String, SimpleStatusInstance>,
    applied: &[SimpleAppliedStatus],
    fortify_immune_until: f64,
    source_side: &str,
    source_hp: f64,
    target_side: &str,
    fallback_source_ability: &str,
    mut combat_log: Option<&mut Vec<CombatLogEntry>>,
) {
    for effect in applied {
        let source_ability = effect
            .source_ability
            .as_deref()
            .unwrap_or(fallback_source_ability);
        apply_statuses_with_trace(
            time,
            target,
            target_hp,
            target_statuses,
            std::slice::from_ref(effect),
            fortify_immune_until,
            source_side,
            source_hp,
            target_side,
            source_ability,
            combat_log.as_deref_mut(),
        );
    }
}

/// Advance the compare-only appetite meter for one side, using the same
/// delta-since-last-update clock as TS `updateCompareHunger`
/// (stateTickRuntime.ts:319-337). Also updates `gourmandizer_weight_factor`
/// dynamically when both the hunger rule and Gourmandizer are on, so the
/// weight bonus tracks the shrinking fill% as appetite drains. No-op if the
/// hunger rule is off (but `last_hunger_update_at` is still advanced so a
/// late-enable stays consistent).
pub(super) fn advance_side_hunger(side: &mut CombatSide, time: f64) {
    let delta = time - side.last_hunger_update_at;
    side.last_hunger_update_at = time;
    if !side.compare_hunger_rule_enabled || delta <= 0.0 {
        return;
    }
    let disease_stacks = side
        .statuses
        .get("Disease_Status")
        .map(|i| i.stacks)
        .unwrap_or(0.0);
    let consumption = compare_hunger::defiled_ground_consumption_multiplier(
        side.compare_defiled_ground_level,
        side.compare_defiled_ground_weakness_enabled,
    ) * side.compare_plushie_drain_multiplier;
    side.compare_hunger = compare_hunger::advance_compare_hunger(
        side.compare_hunger,
        side.compare_appetite_base,
        delta,
        disease_stacks,
        side.compare_gourmandizer_enabled,
        consumption,
    );
    if side.compare_gourmandizer_enabled {
        side.gourmandizer_weight_factor = compare_hunger::gourmandizer_weight_factor_from_hunger(
            side.compare_hunger,
            side.compare_appetite_base,
        );
    }
}

/// Compare-only First Tick Rule (ailments half): snapshot the set of DoT
/// status IDs currently present on the side. Taken at the top of each main
/// loop iteration, compared against post-iteration state by
/// `sweep_first_ailment_tick` to (a) track clearance times and (b) detect
/// freshly applied DoTs whose first tick should be shortened.
pub(super) fn snapshot_dot_status_keys(
    statuses: &BTreeMap<String, SimpleStatusInstance>,
) -> BTreeSet<String> {
    statuses
        .iter()
        .filter_map(|(id, inst)| {
            if status_tick_sec(id).is_some() && inst.stacks > 0.0 {
                Some(id.clone())
            } else {
                None
            }
        })
        .collect()
}

/// Compare-only First Tick Rule (ailments half): post-iteration sweep.
/// - Records time-of-clearance for any DoT status present in the snapshot
///   but absent now (natural decay or heal to zero).
/// - If `first_tick_ailments` is enabled, overrides `next_tick_at` for any
///   freshly applied DoT (not present in snapshot) to fire at
///   `time + min(delay_sec, tick_sec)`, provided the rearm gate is satisfied
///   (either never cleared before, or cleared ≥ 3 s ago). Mirrors TS
///   `shouldUseCompareFirstAilmentTick` + initial `nextTickAt` assignment in
///   statusApplyRuntime.ts:41-52, 194-204.
pub(super) fn sweep_first_ailment_tick(
    side: &mut CombatSide,
    time: f64,
    snapshot: &BTreeSet<String>,
    first_tick_ailments: bool,
    delay_sec: f64,
) {
    // Clearance tracking: statuses present in snapshot that are now absent or
    // at zero stacks → mark cleared at current time.
    for id in snapshot {
        let absent = match side.statuses.get(id) {
            None => true,
            Some(inst) => inst.stacks <= 0.0,
        };
        if absent {
            side.status_last_cleared_at.insert(id.clone(), time);
        }
    }
    if !first_tick_ailments {
        return;
    }
    let delay = delay_sec.max(0.0);
    // Freshly applied DoTs: present now but not in snapshot → override next_tick_at.
    for (id, instance) in side.statuses.iter_mut() {
        if snapshot.contains(id) {
            continue;
        }
        let Some(tick_sec) = status_tick_sec(id) else {
            continue;
        };
        if instance.stacks <= 0.0 {
            continue;
        }
        let rearmed = match side.status_last_cleared_at.get(id) {
            Some(t) => time - *t >= 3.0 - 1e-9,
            None => true,
        };
        if !rearmed {
            continue;
        }
        let next = time + delay.min(tick_sec);
        match instance.next_tick_at {
            Some(existing) if existing <= next => {}
            _ => instance.next_tick_at = Some(next),
        }
    }
}

pub(super) fn apply_status_delta(
    time: f64,
    statuses: &mut BTreeMap<String, SimpleStatusInstance>,
    status_id: &str,
    stacks: f64,
) {
    let existing = statuses.get(status_id).cloned();
    let mut slot = existing;
    apply_simple_status(time, status_id, stacks, &mut slot);
    match slot {
        Some(instance) => {
            statuses.insert(status_id.to_string(), instance);
        }
        None => {
            statuses.remove(status_id);
        }
    }
}
