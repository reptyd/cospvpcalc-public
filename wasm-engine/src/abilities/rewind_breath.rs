// Composable-engine helper module.
//
// The bespoke `simulate_simple_rewind_breath_matchup` function was deleted
// on 2026-04-10 after full fixture parity with the composable engine. Only
// the rewind policy / snapshot helpers survive here because composable.rs
// imports them directly.

use crate::contracts::SimpleCombatantStats;
use crate::spec_constants::REWIND_HEAL_CAP_PCT_MAX_HP;

pub(crate) fn record_rewind_snapshot(history: &mut Vec<(f64, f64)>, time: f64, hp: f64) {
    history.push((time, hp));
    history.retain(|snapshot| snapshot.0 >= time - 12.0);
}

/// Find the snapshot ~9 s in the past and return the HP Rewind would heal if
/// fired now (post-cap, capped at REWIND_HEAL_CAP_PCT_MAX_HP% of max HP). A
/// negative value means the actor had LESS HP 9 s ago, so firing would heal
/// backwards. Returns `None` when no eligible snapshot exists.
///
/// Game Rewind restores HP only (OnAnyTick snapshots just Health+CFrame), so
/// the policy decision is a pure function of the HP delta - no status term.
pub(crate) fn rewind_snapshot_deltas(
    time: f64,
    runtime: &SimpleCombatantStats,
    hp: f64,
    rewind_history: &[(f64, f64)],
) -> Option<f64> {
    let snapshot_hp = rewind_snapshot_hp(time, rewind_history)?;
    let hp_delta_raw = snapshot_hp - hp;
    Some(cap_rewind_heal(runtime, hp_delta_raw))
}

/// Restoration-only helper: caller has decided "fire Rewind now". Heals HP
/// toward the 9-s-ago snapshot (capped) and arms the cooldown. Game Rewind
/// touches only HP - it does NOT roll statuses back - so this never reads or
/// writes the status map. Returns `true` when a snapshot was available.
pub(crate) fn apply_rewind_restoration(
    time: f64,
    runtime: &SimpleCombatantStats,
    hp: &mut f64,
    rewind_cooldown_until: &mut f64,
    rewind_history: &[(f64, f64)],
) -> bool {
    let Some(snapshot_hp) = rewind_snapshot_hp(time, rewind_history) else {
        return false;
    };
    let healed_hp = cap_rewind_heal(runtime, snapshot_hp - *hp);
    *hp = (*hp + healed_hp).max(0.0).min(runtime.health);
    *rewind_cooldown_until = time + crate::active_runtime::scale_active_cooldown(runtime, 100.0);
    true
}

/// HP recorded in the latest snapshot at or before `time - 9 s`.
fn rewind_snapshot_hp(time: f64, rewind_history: &[(f64, f64)]) -> Option<f64> {
    let target_time = time - 9.0;
    let mut snapshot_hp: Option<f64> = None;
    for entry in rewind_history {
        if entry.0 > target_time {
            break;
        }
        snapshot_hp = Some(entry.1);
    }
    snapshot_hp
}

/// Positive heal is capped at REWIND_HEAL_CAP_PCT_MAX_HP% of max HP; a negative
/// delta (would heal backwards) passes through so the policy ranks it as a skip.
fn cap_rewind_heal(runtime: &SimpleCombatantStats, hp_delta: f64) -> f64 {
    if hp_delta > 0.0 {
        (runtime.health * REWIND_HEAL_CAP_PCT_MAX_HP / 100.0).min(hp_delta)
    } else {
        hp_delta
    }
}

