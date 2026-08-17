//! Status-related phase functions: DOT ticks (Phase 12), regen
//! (Phases 5+6), and the status-decay gate (Phases 2.5/3/3c).
//! Extracted from `phases/mod.rs`.

#![allow(clippy::too_many_arguments)]

use super::super::*;
use crate::contracts::SimpleBadOmenOutcome;

/// Decay entries the DOT tick produced. That path strips stacks in place and
/// reports only damage, so a Poison or a Burn that decayed leaves no entry in
/// the timeline while Paralyze - which decays in Phase 3 - does. Diffing the
/// stack counts across the call reports the same transitions without threading
/// a log through the tick.
fn decay_entries_from_dot(
    before: &[(String, f64)],
    after: &BTreeMap<String, SimpleStatusInstance>,
) -> Vec<StatusDecayLogEntry> {
    let mut entries = Vec::new();
    for (status_id, previous_stacks) in before {
        let new_stacks = after.get(status_id).map(|i| i.stacks).unwrap_or(0.0);
        if *previous_stacks - new_stacks > 1e-9 {
            entries.push(StatusDecayLogEntry {
                status_id: status_id.clone(),
                previous_stacks: *previous_stacks,
                new_stacks: new_stacks.max(0.0),
            });
        }
    }
    entries
}

/// Phase 12: Status DOT ticks. Every status on either side that carries
/// per-tick damage fires it and any side-effects (e.g. Necropoison ailment
/// reapply). Damage routes through `handle_simple_dot_ticks_full` which
/// applies unbreakable cap + records per-status log entries.
pub(in super::super) fn process_phase_12_status_dot_ticks(
    ctx: &mut PhaseContext<'_, '_>,
    eff_a: &SimpleCombatantStats,
    eff_b: &SimpleCombatantStats,
    counters: &mut DamageCounters,
) {
    use crate::composable::side::DAMAGE_KIND_DOT;
    // Radiation's additive multi-creature DOT (Reference: status_radiation): each
    // fighter's flat 0.5% Radiation tick scales by the number of nearby radiated
    // creatures = 1 self + N extras (config) + the other fighter when it is
    // currently radiated. Snapshot both sides' radiation BEFORE either side ticks
    // so the order the two sides resolve in this phase can't skew the multiplier.
    let radiation_extra = ctx.config.radiation_nearby_count.max(0.0);
    let a_radiated = ctx.a.statuses.get("Radiation_Status").map(|s| s.stacks > 0.0).unwrap_or(false);
    let b_radiated = ctx.b.statuses.get("Radiation_Status").map(|s| s.stacks > 0.0).unwrap_or(false);
    let rad_mult_a = 1.0 + radiation_extra + if b_radiated { 1.0 } else { 0.0 };
    let rad_mult_b = 1.0 + radiation_extra + if a_radiated { 1.0 } else { 0.0 };
    if !ctx.a.statuses.is_empty() {
        // Snapshot effective decay flag BEFORE taking mut borrows on
        // a.hp / a.statuses below. The override flag itself was refreshed
        // in Phase 2.5 from this tick's pre-DOT HP, so reading it here is
        // already up to date for the current tick.
        let a_block_decay =
            effective_block_persistent_decay(&*ctx.a, ctx.config.attacker_compare_block_persistent_decay);
        let mut tick_log: Vec<(String, f64, f64)> = Vec::new();
        let hp_before_dot_a = ctx.a.hp;
        let posture_decay_mult_a = ctx.a.posture_decay_mult();
        let recovery_mult_a = ctx.a.recoverable_recovery_mult();
        let a_laying = ctx.a.posture_is_settled_laying();
        let a_cocoon_invul = ctx.a.in_cocoon_phase_2(ctx.time);
        let stacks_before_a: Vec<(String, f64)> = if ctx.record_trace {
            ctx.a.statuses.iter().map(|(id, i)| (id.clone(), i.stacks)).collect()
        } else {
            Vec::new()
        };
        let side_effects = crate::statuses::handle_simple_dot_ticks_full(
            ctx.time,
            eff_a.health,
            eff_a.unbreakable_damage_cap_pct,
            &mut ctx.a.hp,
            &mut ctx.a.statuses,
            &mut counters.dealt_b,
            a_block_decay,
            if ctx.record_trace { Some(&mut tick_log) } else { None },
            posture_decay_mult_a,
            a_laying,
            a_cocoon_invul,
            rad_mult_a,
            recovery_mult_a,
        );
        // Route this iteration's DOT total through the pre-damage hook
        // (victim = A; dealer = B by the engine's DOT attribution
        // convention). Aggregate per iter - consistent with how on_take_damage
        // already coalesces DOT - applied post-hoc: the override replaces the
        // iter's DOT total. Skipped when nothing in the chain could move the
        // number, leaving hp untouched (byte-identical). The per-status trace
        // below still shows the pre-override ticks (cosmetic only).
        if damage_pipeline::chain_may_move_damage(&*ctx.a, ctx.attacker, ctx.defender)
            && ctx.a.hp < hp_before_dot_a
        {
            let applied = hp_before_dot_a - ctx.a.hp;
            let final_dot = damage_pipeline::resolve_incoming_damage(
                ctx.b, ctx.a, eff_b, eff_a, ctx.time,
                applied, applied, "dot",
                ctx.combat_log, ctx.record_trace, "B", "A",
            );
            if (final_dot - applied).abs() > 1e-9 {
                ctx.a.hp = (hp_before_dot_a - final_dot).max(0.0);
            }
        }
        // Tag iter mask if any DOT actually damaged A.
        // A "took" DOT damage -> bit on A. B "dealt" it (attribution
        // convention since B's prior applies put the status on A).
        if ctx.a.hp < hp_before_dot_a {
            ctx.a.iter_damage_kinds_taken |= DAMAGE_KIND_DOT;
            ctx.b.iter_damage_kinds_dealt |= DAMAGE_KIND_DOT;
        }
        // DOT damage reaches the combat counters, the sliding-window logs and
        // the raw-damage iteration totals through `record_damage_event`.
        // Attribution: B is the "dealer" by the same convention used
        // above for the DAMAGE_KIND_DOT bit (B applied the status to A).
        let dot_damage_to_a = (hp_before_dot_a - ctx.a.hp).max(0.0);
        if dot_damage_to_a > 0.0 {
            super::record_damage_event(ctx.b, ctx.a, ctx.time, dot_damage_to_a, dot_damage_to_a);
        }
        if ctx.record_trace {
            let decayed = decay_entries_from_dot(&stacks_before_a, &ctx.a.statuses);
            emit_status_decay_log(ctx.combat_log, ctx.time, "A", ctx.a.hp, &decayed);
            for (status_id, damage, hp_after) in tick_log {
                ctx.combat_log.push(crate::contracts::CombatLogEntry {
                    time: ctx.time,
                    entry_type: "dot".to_string(),
                    attacker: "B".to_string(),
                    damage,
                    healing: None,
                    actor_hp_after: ctx.b.hp.max(0.0),
                    hp_side: "A".to_string(),
                    hp_after,
                    description: Some(format!("{} tick", status_id)),
                    detail: None,
                    status_id: Some(status_id),
                });
            }
        }
        if !side_effects.is_empty() {
            apply_incoming_statuses_to_target_with_fortify_immunity(
                ctx.time,
                ctx.attacker,
                ctx.a.hp,
                &mut ctx.a.statuses,
                &side_effects,
                ctx.a.fortify_immune_until,
            );
        }
    }
    if !ctx.b.statuses.is_empty() {
        let b_block_decay =
            effective_block_persistent_decay(&*ctx.b, ctx.config.defender_compare_block_persistent_decay);
        let mut tick_log: Vec<(String, f64, f64)> = Vec::new();
        let hp_before_dot_b = ctx.b.hp;
        let posture_decay_mult_b = ctx.b.posture_decay_mult();
        let recovery_mult_b = ctx.b.recoverable_recovery_mult();
        let b_laying = ctx.b.posture_is_settled_laying();
        let b_cocoon_invul = ctx.b.in_cocoon_phase_2(ctx.time);
        let stacks_before_b: Vec<(String, f64)> = if ctx.record_trace {
            ctx.b.statuses.iter().map(|(id, i)| (id.clone(), i.stacks)).collect()
        } else {
            Vec::new()
        };
        let side_effects = crate::statuses::handle_simple_dot_ticks_full(
            ctx.time,
            eff_b.health,
            eff_b.unbreakable_damage_cap_pct,
            &mut ctx.b.hp,
            &mut ctx.b.statuses,
            &mut counters.dealt_a,
            b_block_decay,
            if ctx.record_trace { Some(&mut tick_log) } else { None },
            posture_decay_mult_b,
            b_laying,
            b_cocoon_invul,
            rad_mult_b,
            recovery_mult_b,
        );
        // Route B's iteration DOT total through the pre-damage hook
        // (victim = B; dealer = A). Symmetric to the A block above.
        if damage_pipeline::chain_may_move_damage(&*ctx.b, ctx.attacker, ctx.defender)
            && ctx.b.hp < hp_before_dot_b
        {
            let applied = hp_before_dot_b - ctx.b.hp;
            let final_dot = damage_pipeline::resolve_incoming_damage(
                ctx.a, ctx.b, eff_a, eff_b, ctx.time,
                applied, applied, "dot",
                ctx.combat_log, ctx.record_trace, "A", "B",
            );
            if (final_dot - applied).abs() > 1e-9 {
                ctx.b.hp = (hp_before_dot_b - final_dot).max(0.0);
            }
        }
        // B took DOT damage -> bit on B, A "dealt" it.
        if ctx.b.hp < hp_before_dot_b {
            ctx.b.iter_damage_kinds_taken |= DAMAGE_KIND_DOT;
            ctx.a.iter_damage_kinds_dealt |= DAMAGE_KIND_DOT;
        }
        // Symmetric to the A block: A is the dealer.
        let dot_damage_to_b = (hp_before_dot_b - ctx.b.hp).max(0.0);
        if dot_damage_to_b > 0.0 {
            super::record_damage_event(ctx.a, ctx.b, ctx.time, dot_damage_to_b, dot_damage_to_b);
        }
        if ctx.record_trace {
            let decayed = decay_entries_from_dot(&stacks_before_b, &ctx.b.statuses);
            emit_status_decay_log(ctx.combat_log, ctx.time, "B", ctx.b.hp, &decayed);
            for (status_id, damage, hp_after) in tick_log {
                ctx.combat_log.push(crate::contracts::CombatLogEntry {
                    time: ctx.time,
                    entry_type: "dot".to_string(),
                    attacker: "A".to_string(),
                    damage,
                    healing: None,
                    actor_hp_after: ctx.a.hp.max(0.0),
                    hp_side: "B".to_string(),
                    hp_after,
                    description: Some(format!("{} tick", status_id)),
                    detail: None,
                    status_id: Some(status_id),
                });
            }
        }
        if !side_effects.is_empty() {
            apply_incoming_statuses_to_target_with_fortify_immunity(
                ctx.time,
                ctx.defender,
                ctx.b.hp,
                &mut ctx.b.statuses,
                &side_effects,
                ctx.b.fortify_immune_until,
            );
        }
    }
}

/// Phase 5+6: Post-death regen management + natural regen ticks.
///
/// Regen is not disabled for a dead creature. Phase 5 does nothing; after
/// Phase 2 pins HP to 1, Phase 6 keeps healing that side. Phase 6 advances
/// each side's 15-second `next_regen` cadence, healing
/// `health x health_regen x mult x regen_bonus_factor x posture_regen_mult / 100`
/// per tick, where `health` and `health_regen` are the side's own stats, `mult`
/// is the status regen multiplier, `regen_bonus_factor` is the Compare regen
/// bonus written as `1 + pct / 100`, and `posture_regen_mult` is the sit/lay
/// multiplier. A tick that comes due while regen is suppressed (Warden's Rage,
/// Bleed, 10 stacks of Burn) buffers exactly one pending tick instead of
/// healing; the actual release is owned by [`process_regen_pending_release`],
/// which runs every iteration so the release lands on the suppression CLEAR
/// rather than the next 15 s boundary.
pub(in super::super) fn process_phase_5_6_regen(
    ctx: &mut PhaseContext<'_, '_>,
    regen_healed_a: &mut f64,
    regen_healed_b: &mut f64,
    regen_ticks_a: &mut u32,
    regen_ticks_b: &mut u32,
) {
    // Phase 5: post-death regen management.
    //
    // Phase 6: Compare-only regen bonus (Frosty, Volcanic, Pack Healer,
    // Clean water, Refreshed, Regen Boost, Mud Pile) is an aggregate
    // percentage-point bonus, applied multiplicatively as
    // (1 + bonus/100) on the heal amount.
    let attacker_regen_bonus_factor =
        1.0 + (ctx.config.attacker_compare_regen_bonus_pct.max(0.0) / 100.0);
    let defender_regen_bonus_factor =
        1.0 + (ctx.config.defender_compare_regen_bonus_pct.max(0.0) / 100.0);
    process_regen_ticks_for_side(
        ctx.a,
        ctx.attacker,
        attacker_regen_bonus_factor,
        "A",
        ctx.time,
        ctx.record_trace,
        ctx.combat_log,
        regen_healed_a,
        regen_ticks_a,
    );
    process_regen_ticks_for_side(
        ctx.b,
        ctx.defender,
        defender_regen_bonus_factor,
        "B",
        ctx.time,
        ctx.record_trace,
        ctx.combat_log,
        regen_healed_b,
        regen_ticks_b,
    );
}

/// Advance one side's natural-regen cadence. A tick that comes due while regen
/// is suppressed - Warden's Rage on (blocks the heal act, rate intact) or the
/// status multiplier fully zeroed (Bleed / 10 stacks of Burn) - buffers exactly one
/// pending tick (`regen_pending`) instead of healing; it is released later by
/// [`process_regen_pending_release`]. An unsuppressed tick heals at the current
/// multiplier.
fn process_regen_ticks_for_side(
    side: &mut CombatSide,
    stats: &SimpleCombatantStats,
    regen_bonus_factor: f64,
    label: &str,
    time: f64,
    record_trace: bool,
    combat_log: &mut Vec<crate::contracts::CombatLogEntry>,
    regen_healed: &mut f64,
    regen_ticks: &mut u32,
) {
    if !side.next_regen.is_finite() {
        return;
    }
    if stats.health_regen <= 0.0 {
        side.next_regen = f64::INFINITY;
        return;
    }
    while is_regen_tick_due(side.next_regen, time) {
        let tick_time = side.next_regen;
        let mult = effective_hp_regen_multiplier_with_actives(
            stats,
            side.hp,
            &side.statuses,
            time,
            side.harden_active_until,
        );
        if side.warden_rage_on || mult <= 0.0 {
            // Suppressed this tick: buffer at most one pending tick for release
            // once suppression lifts. Warden's Rage keeps the rate intact but
            // blocks the heal act; a status zeroes the rate. The timer keeps
            // running (suppressed time still counts) - only the output is held.
            side.regen_pending = true;
            side.next_regen += 15.0;
            continue;
        }
        if side.hp < stats.health {
            let heal = (stats.health * stats.health_regen * mult) / 100.0
                * regen_bonus_factor
                * side.posture_regen_mult();
            if heal > 0.0 {
                let hp_before = side.hp;
                side.hp = (side.hp + heal).min(stats.health);
                let healed = (side.hp - hp_before).max(0.0);
                *regen_healed += healed;
                // Accumulate for OnHeal trigger.
                side.iter_healing_taken += healed;
                if record_trace && healed > 0.0 {
                    combat_log.push(crate::contracts::CombatLogEntry {
                        time: tick_time,
                        entry_type: "ability".to_string(),
                        attacker: label.to_string(),
                        damage: 0.0,
                        healing: Some(healed),
                        actor_hp_after: side.hp.max(0.0),
                        hp_side: label.to_string(),
                        hp_after: side.hp.max(0.0),
                        description: Some("Natural regen".to_string()),
                        detail: None,
                        status_id: None,
                    });
                }
            }
        }
        *regen_ticks += 1;
        side.next_regen += 15.0;
    }
}

/// Delay before a buffered regen tick is released once suppression lifts.
/// Warden's Rage blocks the heal and not the rate, so its release is immediate.
/// A status that decayed below full block releases 1.5 seconds later, the delay
/// we measured in game.
const STATUS_REGEN_RELEASE_DELAY_SEC: f64 = 1.5;
const WARDEN_RAGE_REGEN_RELEASE_DELAY_SEC: f64 = 0.0;

/// Release the single buffered natural-regen tick once suppression lifts. Runs
/// EVERY iteration (from `loop_iter`, just after the Phase 3 status-decay gate
/// and Phase 12 DOT ticks) so a suppressor that decayed below full block THIS
/// iteration is seen cleared here, and the release is anchored to the CLEAR
/// event rather than the next 15 s regen boundary:
///
/// - Still suppressed with a pending tick -> cancel any schedule but KEEP the
///   pending tick (survives re-suppression inside the window).
/// - Just cleared -> schedule the release `time + delay` out, where delay is 0
///   for a Warden's Rage turn-off (instant) and ~1.5 s for a status decaying
///   below full block. On overlap, `regen_suppressed_prev` (last iteration's
///   Warden's Rage suppression) picks whichever suppressor lifts LAST.
/// - Scheduled and due -> deliver at the CURRENT multiplier (residual Burn
///   under-heals), clear the pending flag, reset the schedule to INFINITY.
///
/// Because `regen_release_at` is always either INFINITY or consumed here, and
/// this runs unconditionally every iteration, a stale finite schedule can never
/// pin the scheduler's `next_time <= time` (no early-break stall).
pub(in super::super) fn process_regen_pending_release(
    ctx: &mut PhaseContext<'_, '_>,
    regen_healed_a: &mut f64,
    regen_healed_b: &mut f64,
    regen_ticks_a: &mut u32,
    regen_ticks_b: &mut u32,
) {
    let attacker_regen_bonus_factor =
        1.0 + (ctx.config.attacker_compare_regen_bonus_pct.max(0.0) / 100.0);
    let defender_regen_bonus_factor =
        1.0 + (ctx.config.defender_compare_regen_bonus_pct.max(0.0) / 100.0);
    release_regen_pending_for_side(
        ctx.a,
        ctx.attacker,
        attacker_regen_bonus_factor,
        "A",
        ctx.time,
        ctx.record_trace,
        ctx.combat_log,
        regen_healed_a,
        regen_ticks_a,
    );
    release_regen_pending_for_side(
        ctx.b,
        ctx.defender,
        defender_regen_bonus_factor,
        "B",
        ctx.time,
        ctx.record_trace,
        ctx.combat_log,
        regen_healed_b,
        regen_ticks_b,
    );
}

fn release_regen_pending_for_side(
    side: &mut CombatSide,
    stats: &SimpleCombatantStats,
    regen_bonus_factor: f64,
    label: &str,
    time: f64,
    record_trace: bool,
    combat_log: &mut Vec<crate::contracts::CombatLogEntry>,
    regen_healed: &mut f64,
    regen_ticks: &mut u32,
) {
    // A side with no regen never buffers a tick, so there is nothing to
    // release. `health_regen` is fixed for the fight, so this side can never
    // become regen-capable later; the Warden's Rage history bit is still
    // written so the field stays consistent with the other exit.
    if stats.health_regen <= 0.0 {
        side.regen_suppressed_prev = side.warden_rage_on;
        return;
    }

    let mult = effective_hp_regen_multiplier_with_actives(
        stats,
        side.hp,
        &side.statuses,
        time,
        side.harden_active_until,
    );
    let suppressed_now = side.warden_rage_on || mult <= 0.0;

    if side.regen_pending {
        if suppressed_now {
            // Still (or again) suppressed: cancel any scheduled release but keep
            // the pending tick - a re-suppression inside the window must not
            // lose it.
            side.regen_release_at = f64::INFINITY;
        } else if !side.regen_release_at.is_finite() {
            // Suppression just lifted this iteration. Warden's Rage releases
            // instantly; a status that decayed below full block releases ~1.5 s
            // later. On overlap the suppressor that lifts LAST sets the delay:
            // `regen_suppressed_prev` is last iteration's Warden's Rage
            // suppression, so WR-off-now => instant, else a status was last to
            // clear.
            let delay = if side.regen_suppressed_prev {
                WARDEN_RAGE_REGEN_RELEASE_DELAY_SEC
            } else {
                STATUS_REGEN_RELEASE_DELAY_SEC
            };
            side.regen_release_at = time + delay;
        }

        if !suppressed_now
            && side.regen_release_at.is_finite()
            && time + 1e-9 >= side.regen_release_at
        {
            if side.hp < stats.health {
                let heal = (stats.health * stats.health_regen * mult) / 100.0
                    * regen_bonus_factor
                    * side.posture_regen_mult();
                if heal > 0.0 {
                    let hp_before = side.hp;
                    side.hp = (side.hp + heal).min(stats.health);
                    let healed = (side.hp - hp_before).max(0.0);
                    *regen_healed += healed;
                    side.iter_healing_taken += healed;
                    if record_trace && healed > 0.0 {
                        combat_log.push(crate::contracts::CombatLogEntry {
                            time,
                            entry_type: "ability".to_string(),
                            attacker: label.to_string(),
                            damage: 0.0,
                            healing: Some(healed),
                            actor_hp_after: side.hp.max(0.0),
                            hp_side: label.to_string(),
                            hp_after: side.hp.max(0.0),
                            description: Some("Natural regen".to_string()),
                            detail: None,
                            status_id: None,
                        });
                    }
                }
            }
            *regen_ticks += 1;
            side.regen_pending = false;
            side.regen_release_at = f64::INFINITY;
        }
    }

    // Remember this iteration's Warden's Rage suppression so the next clear can
    // distinguish a WR turn-off (instant) from a status decay (~1.5 s).
    side.regen_suppressed_prev = side.warden_rage_on;
}

/// Phase 2.5 + Phase 3 + Phase 3c (Bad Omen): the StatusDecay-gated
/// portion of the status family.
///
/// Phase 2.5 refreshes `trails_facetank_override_active` for both
/// sides BEFORE Phase 3 status duration updates and Phase 12 DOT ticks
/// read it via `effective_block_persistent_decay`. Phase 3 advances
/// status durations on both sides with the per-side persistent-decay
/// flag. Phase 3c applies the pre-resolved Bad Omen outcome to whichever
/// side had Bad_Omen present pre-iteration but absent post-Phase-3
/// (i.e. the status expired this tick).
pub(in super::super) fn process_phase_status_decay_gate(ctx: &mut PhaseContext<'_, '_>) {
    // Capture Bad_Omen presence pre-decay so Phase 3c can apply the follow-up
    // to whichever side's Bad_Omen expires this tick.
    let had_bad_omen_a = ctx.a.statuses.get("Bad_Omen").map(|s| s.stacks > 0.0).unwrap_or(false);
    let had_bad_omen_b = ctx.b.statuses.get("Bad_Omen").map(|s| s.stacks > 0.0).unwrap_or(false);

    // Phase 2.5: Trails/Step facetank override refresh.
    ctx.a.trails_facetank_override_active = any_trail_or_step_active_for_side(
        ctx.a.hp,
        ctx.attacker.health,
        ctx.config.attacker_flame_trail_value,
        ctx.config.attacker_frost_trail_value,
        ctx.config.attacker_plague_trail_value,
        ctx.config.attacker_toxic_trail_value,
        ctx.config.attacker_trail_value,
        ctx.config.attacker_healing_step_value,
    );
    ctx.b.trails_facetank_override_active = any_trail_or_step_active_for_side(
        ctx.b.hp,
        ctx.defender.health,
        ctx.config.defender_flame_trail_value,
        ctx.config.defender_frost_trail_value,
        ctx.config.defender_plague_trail_value,
        ctx.config.defender_toxic_trail_value,
        ctx.config.defender_trail_value,
        ctx.config.defender_healing_step_value,
    );

    // Phase 3: Status duration updates.
    let phase3_a_block_decay =
        effective_block_persistent_decay(&*ctx.a, ctx.config.attacker_compare_block_persistent_decay);
    let phase3_b_block_decay =
        effective_block_persistent_decay(&*ctx.b, ctx.config.defender_compare_block_persistent_decay);
    let mut decay_log_a: Vec<StatusDecayLogEntry> = Vec::new();
    let mut decay_log_b: Vec<StatusDecayLogEntry> = Vec::new();
    // Read the posture decay multiplier BEFORE the &mut borrow on
    // statuses - the borrow checker won't let us call &self methods
    // through ctx.a / ctx.b while a &mut borrow is live on a sub-field.
    let posture_decay_mult_a = ctx.a.posture_decay_mult();
    let posture_decay_mult_b = ctx.b.posture_decay_mult();
    let recovery_mult_a = ctx.a.recoverable_recovery_mult();
    let recovery_mult_b = ctx.b.recoverable_recovery_mult();
    crate::statuses::update_simple_status_durations_full(
        ctx.time,
        &mut ctx.a.statuses,
        phase3_a_block_decay,
        if ctx.record_trace { Some(&mut decay_log_a) } else { None },
        posture_decay_mult_a,
        recovery_mult_a,
    );
    crate::statuses::update_simple_status_durations_full(
        ctx.time,
        &mut ctx.b.statuses,
        phase3_b_block_decay,
        if ctx.record_trace { Some(&mut decay_log_b) } else { None },
        posture_decay_mult_b,
        recovery_mult_b,
    );
    if ctx.record_trace {
        emit_status_decay_log(ctx.combat_log, ctx.time, "A", ctx.a.hp, &decay_log_a);
        emit_status_decay_log(ctx.combat_log, ctx.time, "B", ctx.b.hp, &decay_log_b);
    }

    // Phase 3c: Bad Omen follow-up on expiry. Each side consumes the next entry
    // from the configured outcome list (a freshly-rolled random batch in
    // Compare/Sandbox, a single deterministic outcome in Best Builds), applied
    // through the standard traced path so it shows up in the timeline.
    apply_bad_omen_follow_up(
        ctx.time, ctx.attacker, had_bad_omen_a, "A", ctx.a,
        &ctx.config.bad_omen_outcomes,
        if ctx.record_trace { Some(ctx.combat_log) } else { None },
    );
    apply_bad_omen_follow_up(
        ctx.time, ctx.defender, had_bad_omen_b, "B", ctx.b,
        &ctx.config.bad_omen_outcomes,
        if ctx.record_trace { Some(ctx.combat_log) } else { None },
    );
}

/// Applies the next Bad Omen follow-up to a side whose Bad Omen expired this
/// tick (`had_bad_omen` true pre-decay, absent after Phase 3), through the
/// traced status path. Consumes one entry from `outcomes` via the side's expiry counter and
/// records the first-applied outcome for the summary.
fn apply_bad_omen_follow_up(
    time: f64,
    side_stats: &SimpleCombatantStats,
    had_bad_omen: bool,
    label: &str,
    side: &mut CombatSide,
    outcomes: &[SimpleBadOmenOutcome],
    combat_log: Option<&mut Vec<crate::contracts::CombatLogEntry>>,
) {
    if !had_bad_omen {
        return;
    }
    if side.statuses.get("Bad_Omen").map(|s| s.stacks > 0.0).unwrap_or(false) {
        return;
    }
    let Some(outcome) = crate::statuses::next_bad_omen_outcome(outcomes, &mut side.bad_omen_expiry_count)
    else {
        return;
    };
    let hp = side.hp;
    apply_statuses_with_trace(
        time,
        side_stats,
        hp,
        &mut side.statuses,
        &[SimpleAppliedStatus {
            status_id: outcome.status_id.clone(),
            stacks: outcome.stacks,
            ..Default::default()
        }],
        side.fortify_immune_until,
        label,
        hp,
        label,
        "Bad Omen",
        combat_log,
    );
    if side.bad_omen_applied.is_none() {
        side.bad_omen_applied = Some(outcome);
    }
}
