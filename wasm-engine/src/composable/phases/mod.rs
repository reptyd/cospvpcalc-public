//! Phase processor functions extracted from the main driver loop.
//!
//! All 23 `process_phase_*` functions live here, plus the local types
//! they depend on (`SchedulerStep`, `SchedulerPassiveFlags`). The driver
//! loop in `mod.rs` calls these via `phases::process_phase_*`.
//!
//! Visibility: child modules (this file, `phase_tests.rs`) can access
//! parent module private items directly - `use super::*;` brings in
//! the `pub` surface, and private helpers are reachable by path.
//! No widening of any item's visibility was required by this split.

#![allow(clippy::too_many_arguments)]

mod post_tick;
pub(super) use post_tick::process_phase_16_post_tick;

mod phase4;
pub(super) use phase4::*;

mod misc;
pub(super) use misc::*;

mod status;
pub(super) use status::*;

mod breath;
pub(super) use breath::*;

mod melee;
pub(super) use melee::*;

mod scheduler;
pub(super) use scheduler::*;

use super::*;

/// Add `delta` to a cumulative counter living on a
/// side's `user_extras`. Missing keys read as 0.0. Used to drive
/// `combat.bites_dealt` / `combat.bites_taken` /
/// `combat.damage_dealt_total` / `combat.damage_taken_total` for
/// user expressions, matching the engine's existing pattern for
/// `combat.iteration_count`.
fn bump_combat_counter(
    extras: &mut std::collections::BTreeMap<String, crate::policy::state::PolicyValue>,
    key: &str,
    delta: f64,
) {
    use crate::policy::state::PolicyValue;
    let prev = extras
        .get(key)
        .and_then(PolicyValue::as_number)
        .unwrap_or(0.0);
    extras.insert(key.to_string(), PolicyValue::Number(prev + delta));
}

/// Maximum sliding-window length retained on the per-
/// side recent-damage logs. Any window longer than this is unreliable
/// (entries get pruned). 30s covers every realistic "danger detected"
/// pattern; longer windows imply a structural problem with the spec.
pub(super) const B2_MAX_WINDOW_SEC: f64 = 30.0;

/// Resolve which bite variant (primary vs. secondary) the
/// attacker should use at this firing event. The cadence (`next_hit`)
/// is identical for both variants; this picks the *flavor* of the
/// bite that's about to land.
///
/// - `PrimaryOnly` / `SecondaryOnly` short-circuit to a forced
///   variant. Secondary-forced falls back to primary when
///   `damage2 <= 0` (i.e. the creature has no in-game secondary
///   attack - keeps `compareSecondaryAttackOnly` safe for any
///   creature regardless of wiki coverage).
/// - `Dynamic` - only reached when `pre_resolved_variant_a` is
///   `None` (non-live callers without a pre-resolved variant).
///   The analytic path was removed; returns `PRIMARY_VARIANT` as
///   the safe default (live runs always pre-resolve via
///   `BuiltinBiteVariantReplayDecision` before melee fires).
fn resolve_bite_variant_attacker(
    ctx: &PhaseContext<'_, '_>,
    eff_a: &SimpleCombatantStats,
    _eff_b: &SimpleCombatantStats,
    bite_variant_override: Option<&super::loop_iter::BiteVariantOverrideFn<'_>>,
) -> &'static str {
    use crate::composable::config::SimpleBiteVariantMode;
    use crate::policy::decisions::bite_variant::{PRIMARY_VARIANT, SECONDARY_VARIANT};
    // External override (benchmark scripts AND engine-replay inner
    // replays) wins over the config-driven mode unconditionally. For
    // secondary requests we still honor the `damage2 > 0` gate so a
    // script asking for "secondary" on a creature without a wiki
    // secondary attack falls back to primary, matching the
    // SecondaryOnly behavior.
    if let Some(decide_fn) = bite_variant_override {
        let pick = decide_fn(&*ctx.a, &*ctx.b, ctx.time, /* is_attacker */ true);
        if pick == SECONDARY_VARIANT && eff_a.damage2 <= 0.0 {
            return PRIMARY_VARIANT;
        }
        return pick;
    }
    match ctx.config.attacker_bite_variant_mode {
        SimpleBiteVariantMode::PrimaryOnly => PRIMARY_VARIANT,
        SimpleBiteVariantMode::SecondaryOnly => {
            if eff_a.damage2 > 0.0 {
                SECONDARY_VARIANT
            } else {
                PRIMARY_VARIANT
            }
        }
        // Live runs pre-resolve the variant via
        // `BuiltinBiteVariantReplayDecision` before melee fires and
        // pass it in as `pre_resolved_variant_a`. Reaching this arm
        // means no pre-resolved variant was supplied (e.g. a caller
        // that does not use the bite-variant bridge). Return the safe
        // primary default.
        SimpleBiteVariantMode::Dynamic => PRIMARY_VARIANT,
    }
}

/// Mirror of [`resolve_bite_variant_attacker`] for the defender's
/// own bite event (the B→A swing). The roles are flipped:
/// "self" = B, "opp" = A.
fn resolve_bite_variant_defender(
    ctx: &PhaseContext<'_, '_>,
    _eff_a: &SimpleCombatantStats,
    eff_b: &SimpleCombatantStats,
    bite_variant_override: Option<&super::loop_iter::BiteVariantOverrideFn<'_>>,
) -> &'static str {
    use crate::composable::config::SimpleBiteVariantMode;
    use crate::policy::decisions::bite_variant::{PRIMARY_VARIANT, SECONDARY_VARIANT};
    if let Some(decide_fn) = bite_variant_override {
        let pick = decide_fn(&*ctx.b, &*ctx.a, ctx.time, /* is_attacker */ false);
        if pick == SECONDARY_VARIANT && eff_b.damage2 <= 0.0 {
            return PRIMARY_VARIANT;
        }
        return pick;
    }
    match ctx.config.defender_bite_variant_mode {
        SimpleBiteVariantMode::PrimaryOnly => PRIMARY_VARIANT,
        SimpleBiteVariantMode::SecondaryOnly => {
            if eff_b.damage2 > 0.0 {
                SECONDARY_VARIANT
            } else {
                PRIMARY_VARIANT
            }
        }
        // Live runs pre-resolve via `BuiltinBiteVariantReplayDecision`
        // before melee fires. Reaching this arm means no pre-resolved
        // variant was supplied - return primary default.
        SimpleBiteVariantMode::Dynamic => PRIMARY_VARIANT,
    }
}

/// Cheap "build a bite-effective stats clone for secondary" helper.
/// Returns `None` on primary (no clone needed - caller uses the
/// existing `eff` ref); returns `Some(clone)` on secondary, with
/// `damage` swapped to `damage2`. The caller chains
/// `clone.as_ref().unwrap_or(eff)` to get a unified `&SimpleCombatantStats`.
fn bite_eff_for_secondary(
    eff: &SimpleCombatantStats,
    variant: &str,
) -> Option<SimpleCombatantStats> {
    use crate::policy::decisions::bite_variant::SECONDARY_VARIANT;
    if variant == SECONDARY_VARIANT && eff.damage2 > 0.0 {
        let mut clone = eff.clone();
        clone.damage = eff.damage2;
        Some(clone)
    } else {
        None
    }
}

/// Push a `(time, amount)` entry to a sliding-window
/// damage log, pruning entries older than `B2_MAX_WINDOW_SEC` so the
/// buffer stays bounded over long fights. `amount <= 0` is a no-op so
/// we don't pollute the log with 0-damage (fully-shielded) events.
fn push_damage_window(log: &mut Vec<(f64, f64)>, time: f64, amount: f64) {
    if amount <= 0.0 {
        return;
    }
    let cutoff = time - B2_MAX_WINDOW_SEC;
    log.retain(|&(t, _)| t >= cutoff);
    log.push((time, amount));
}

/// 2026-05-12: record a damage event on a (dealer, victim) pair into
/// every per-iteration accumulator: combat-counters, sliding-
/// window buffers, raw-damage iteration totals.
///
/// `raw` is the pre-mitigation amount, `applied` is the engine's
/// post-mitigation amount that actually landed. For bite, the
/// pre-damage hook layer lives at a different layer so we pass
/// raw == applied here - the bite site already populates iter raws
/// via direct field writes before calling its own hook. For breath
/// and DOT this helper is the only writer.
///
/// Bite damage uses this AFTER its own pre-damage hook is done, to
/// keep the counter increments consistent with what actually landed.
/// We call it as part of the bite path's post-application bookkeeping
/// AND from new instrumentation in breath / DOT phases.
fn record_damage_event(
    dealer: &mut CombatSide,
    victim: &mut CombatSide,
    time: f64,
    raw: f64,
    applied: f64,
) {
    if applied <= 0.0 && raw <= 0.0 {
        return;
    }
    let r = raw.max(0.0);
    let a = applied.max(0.0);
    dealer.iter_raw_damage_dealt += r;
    victim.iter_raw_damage_taken += r;
    bump_combat_counter(&mut dealer.user_extras, "combat.damage_dealt_total", a);
    bump_combat_counter(&mut victim.user_extras, "combat.damage_taken_total", a);
    push_damage_window(&mut dealer.recent_damage_dealt, time, a);
    push_damage_window(&mut victim.recent_damage_taken, time, a);
}
