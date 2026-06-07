// Composable-engine helper module.
//
// The bespoke `simulate_simple_rewind_breath_matchup` function was deleted
// on 2026-04-10 after full fixture parity with the composable engine. Only
// the rewind policy / snapshot helpers survive here because composable.rs
// imports them directly.

use std::collections::BTreeMap;

use crate::contracts::{SimpleCombatantStats, SimpleStatusInstance};

pub(crate) fn record_rewind_snapshot(
    history: &mut Vec<(f64, f64, BTreeMap<String, SimpleStatusInstance>)>,
    time: f64,
    hp: f64,
    statuses: &BTreeMap<String, SimpleStatusInstance>,
) {
    history.push((time, hp, statuses.clone()));
    history.retain(|snapshot| snapshot.0 >= time - 12.0);
}

/// Look up the snapshot ~9 s in the past in `rewind_history` and
/// return the (restored_hp_delta, status_count_delta) pair the new
/// policy decision needs. Returns `None` when no eligible snapshot
/// exists (history too short, all entries newer than the target).
///
/// `restored_hp_delta` is post-cap (HP gain capped at 25 % maxHP).
/// `status_count_delta` is `current_status_count − snapshot_status_count`
/// - positive when Rewind would strip statuses.
pub(crate) fn rewind_snapshot_deltas(
    time: f64,
    runtime: &SimpleCombatantStats,
    hp: f64,
    statuses: &BTreeMap<String, SimpleStatusInstance>,
    rewind_history: &[(f64, f64, BTreeMap<String, SimpleStatusInstance>)],
) -> Option<(f64, f64)> {
    let target_time = time - 9.0;
    let mut snapshot: Option<(f64, usize)> = None;
    for entry in rewind_history {
        if entry.0 > target_time {
            break;
        }
        snapshot = Some((entry.1, entry.2.len()));
    }
    let (snapshot_hp, snapshot_status_count) = snapshot?;
    let hp_delta_raw = snapshot_hp - hp;
    let healed_hp = if hp_delta_raw > 0.0 {
        (runtime.health * 0.25).min(hp_delta_raw)
    } else {
        hp_delta_raw
    };
    let status_count_delta = statuses.len() as f64 - snapshot_status_count as f64;
    Some((healed_hp, status_count_delta))
}

/// Restoration-only helper, used by the new policy decision flow:
/// caller has already decided "fire Rewind now"; this function
/// performs the snapshot restore and arms the cooldown.
///
/// Returns `true` when the restoration applied; `false` when no
/// snapshot was available.
pub(crate) fn apply_rewind_restoration(
    time: f64,
    runtime: &SimpleCombatantStats,
    hp: &mut f64,
    statuses: &mut BTreeMap<String, SimpleStatusInstance>,
    rewind_cooldown_until: &mut f64,
    rewind_history: &[(f64, f64, BTreeMap<String, SimpleStatusInstance>)],
) -> bool {
    let target_time = time - 9.0;
    let mut snapshot: Option<(f64, BTreeMap<String, SimpleStatusInstance>)> = None;
    for entry in rewind_history {
        if entry.0 > target_time {
            break;
        }
        snapshot = Some((entry.1, entry.2.clone()));
    }
    let Some((snapshot_hp, mut snapshot_statuses)) = snapshot else {
        return false;
    };
    let hp_delta = snapshot_hp - *hp;
    let healed_hp = if hp_delta > 0.0 {
        (runtime.health * 0.25).min(hp_delta)
    } else {
        hp_delta
    };
    let restored_hp = (*hp + healed_hp).max(0.0).min(runtime.health);
    *hp = restored_hp;
    // 2026-05-12 freeze-bug fix: the snapshot's status instances carry
    // `next_tick_at` / `next_decay_at` values from up to ~9 s ago. If we
    // restore them verbatim, the composable scheduler picks them as the
    // "next event" candidate, sees a timestamp in the past, and bails
    // via `SchedulerStep::Break` (battle stalls mid-fight). Normalize
    // those timers to fire one tick / decay interval FROM NOW so DOTs
    // and decay resume cleanly.
    for (status_id, instance) in snapshot_statuses.iter_mut() {
        if let Some(tick) = instance.next_tick_at {
            if tick <= time + 1e-9 {
                let tick_sec = crate::statuses::status_tick_sec(status_id).unwrap_or(3.0);
                instance.next_tick_at = Some(time + tick_sec);
            }
        }
        if let Some(decay) = instance.next_decay_at {
            if decay <= time + 1e-9 {
                let decay_sec = crate::statuses::status_decay_sec(status_id);
                instance.next_decay_at = Some(time + decay_sec);
            }
        }
    }
    *statuses = snapshot_statuses;
    *rewind_cooldown_until =
        time + crate::active_runtime::scale_active_cooldown(runtime, 100.0);
    true
}

