// Breath tick handling for the composable engine.
//
// Extracted from composable/mod.rs (light split, behavior-preserving).
//
// Covers the breath family: runtime tick/capacity helpers, damage resolution,
// and per-tick drivers for standard/lance/auto-fire variants.

use std::collections::BTreeMap;

use crate::actives::{apply_hunker_to_damage, apply_hunker_to_incoming};
use crate::combat::{
    compute_simple_breath_damage_with_actor_and_target_statuses, is_external_healing_blocked,
    simple_breath_capacity_step, simple_breath_tick_sec,
};
use crate::contracts::{
    CombatLogEntry, SimpleAppliedStatus, SimpleBreathProfile, SimpleCombatantStats,
    SimpleStatusInstance,
};
use crate::statuses::{
    apply_incoming_statuses_to_target_with_fortify_immunity, heal_simple_status_stacks,
};

use crate::composable::ability_metadata::ability_blocked_by_necropoison;

use super::{apply_direct_damage_with_reflect, apply_unbreakable_damage_cap, CombatSide, DamageCounters};

const CLOUD_BREATH_MUDDY_PROC_FRACTION_PER_TICK: f64 = 0.4;
const CLOUD_BREATH_MUDDY_DURATION_SEC: f64 = 90.0;
const AUTO_FIRE_COOLDOWN_SEC: f64 = 120.0;

fn is_auto_fire_breath(breath: &SimpleBreathProfile) -> bool {
    matches!(
        breath.special_kind.as_deref(),
        Some("solar_beam") | Some("spirit_glare") | Some("heliolyth_judgement")
    )
}

fn is_plasma_beam(breath: &SimpleBreathProfile) -> bool {
    matches!(breath.special_kind.as_deref(), Some("plasma_beam"))
}

fn auto_fire_delay_sec(breath: &SimpleBreathProfile) -> f64 {
    if breath.auto_fire_delay_sec > 0.0 {
        breath.auto_fire_delay_sec
    } else if matches!(
        breath.special_kind.as_deref(),
        Some("solar_beam") | Some("heliolyth_judgement")
    ) {
        3.0
    } else {
        0.0
    }
}

fn auto_fire_cooldown_sec(breath: &SimpleBreathProfile) -> f64 {
    if breath.auto_fire_cooldown_sec > 0.0 {
        breath.auto_fire_cooldown_sec
    } else {
        AUTO_FIRE_COOLDOWN_SEC
    }
}

pub(super) fn runtime_breath_tick_sec(
    stats: &SimpleCombatantStats,
    breath: &SimpleBreathProfile,
) -> f64 {
    // TS uses a flat BREATH_TICK_SEC = 0.5 for every breath (see
    // src/engine/subsystems/timing.ts). Spirit Glare Reference: "Deals damage
    // two times per second" → 0.5s per tick.
    if stats.hunker_reduction_pct > 0.0
        || matches!(
            breath.special_kind.as_deref(),
            Some("lance") | Some("solar_beam") | Some("spirit_glare") | Some("heliolyth_judgement")
        )
    {
        0.5
    } else {
        simple_breath_tick_sec(breath)
    }
}

pub(super) fn runtime_breath_capacity_step(
    _stats: &SimpleCombatantStats,
    breath: &SimpleBreathProfile,
) -> f64 {
    simple_breath_capacity_step(breath)
}

#[allow(clippy::too_many_arguments)]
fn resolve_breath_damage(
    attacker: &SimpleCombatantStats,
    defender: &SimpleCombatantStats,
    breath: &SimpleBreathProfile,
    chain_stacks: &mut f64,
    attacker_statuses: &BTreeMap<String, SimpleStatusInstance>,
    defender_statuses: &BTreeMap<String, SimpleStatusInstance>,
    attacker_hunker_on: bool,
    defender_hunker_on: bool,
) -> f64 {
    // Warden's Rage multiplies bite damage only; breath damage is not
    // affected. Earlier code multiplied here, but no owner of Warden's
    // Rage also has a breath in the live data, so the bug had no observable
    // effect until Heliolyth's Judgement made the divergence testable.
    let base_damage = if matches!(breath.special_kind.as_deref(), Some("heliolyth_judgement"))
    {
        defender.health.max(1.0) * (breath.dps_pct / 100.0) * 0.5
    } else {
        compute_simple_breath_damage_with_actor_and_target_statuses(
            attacker,
            defender,
            breath,
            chain_stacks,
            attacker_statuses,
            defender_statuses,
        )
    };
    let outgoing_damage = if matches!(breath.special_kind.as_deref(), Some("energy")) {
        base_damage
    } else {
        apply_hunker_to_damage(base_damage, attacker_hunker_on)
    };
    apply_hunker_to_incoming(
        outgoing_damage,
        defender.hunker_reduction_pct,
        defender_hunker_on,
    )
}

#[allow(clippy::too_many_arguments)]
pub(super) fn tick_breath_side(
    time: f64,
    actor_stats: &SimpleCombatantStats,
    target_stats: &SimpleCombatantStats,
    breath: &SimpleBreathProfile,
    actor_is_a: bool,
    actor: &mut CombatSide,
    target: &mut CombatSide,
    actor_hunker_active: bool,
    target_hunker_active: bool,
    counters: &mut DamageCounters,
    // G3: pre-damage hook plumbing for the standard breath-damage path.
    combat_log: &mut Vec<CombatLogEntry>,
    record_trace: bool,
    dealer_label: &str,
    victim_label: &str,
) {
    if ability_blocked_by_necropoison("Breath", &actor.statuses) {
        return;
    }
    // Posture gate: while the actor is settled in Sitting / Laying,
    // breath cannot fire. The transition window does NOT block —
    // matches the multiplier gate (Phase 1). No timeline event here:
    // a "missed breath tick" is silent in the log; the actor's next
    // breath tick is rescheduled on the standard cadence so the
    // scheduler keeps making progress.
    if actor.posture_settled_non_standing() {
        actor.next_breath += runtime_breath_tick_sec(actor_stats, breath);
        return;
    }

    if matches!(breath.special_kind.as_deref(), Some("lance")) {
        tick_breath_lance(
            time,
            actor_stats,
            target_stats,
            breath,
            actor_is_a,
            actor,
            target,
            actor_hunker_active,
            target_hunker_active,
            counters,
            combat_log,
            record_trace,
            dealer_label,
            victim_label,
        );
    } else if is_plasma_beam(breath) {
        tick_breath_plasma(
            time,
            actor_stats,
            target_stats,
            breath,
            actor_is_a,
            actor,
            target,
            actor_hunker_active,
            target_hunker_active,
            counters,
            combat_log,
            record_trace,
            dealer_label,
            victim_label,
        );
    } else if is_auto_fire_breath(breath) {
        tick_breath_auto_fire(
            time,
            actor_stats,
            target_stats,
            breath,
            actor_is_a,
            actor,
            target,
            actor_hunker_active,
            target_hunker_active,
            counters,
            combat_log,
            record_trace,
            dealer_label,
            victim_label,
        );
    } else {
        tick_breath_standard(
            time,
            actor_stats,
            target_stats,
            breath,
            actor_is_a,
            actor,
            target,
            actor_hunker_active,
            target_hunker_active,
            counters,
            combat_log,
            record_trace,
            dealer_label,
            victim_label,
        );
    }
}

#[allow(clippy::too_many_arguments)]
fn tick_breath_lance(
    time: f64,
    actor_stats: &SimpleCombatantStats,
    target_stats: &SimpleCombatantStats,
    breath: &SimpleBreathProfile,
    actor_is_a: bool,
    actor: &mut CombatSide,
    target: &mut CombatSide,
    _actor_hunker_active: bool,
    _target_hunker_active: bool,
    counters: &mut DamageCounters,
    combat_log: &mut Vec<CombatLogEntry>,
    record_trace: bool,
    dealer_label: &str,
    victim_label: &str,
) {
    if actor.lance_armed_until <= 0.0 {
        if time >= actor.lance_cooldown_until {
            actor.lance_armed_until = time + breath.lance_charge_sec.max(0.0);
            actor.lance_cooldown_until = time + breath.lance_cooldown_sec.max(0.0);
        }
    } else if time >= actor.lance_armed_until {
        let lance_damage = apply_unbreakable_damage_cap(
            target_stats.health * (breath.lance_damage_pct / 100.0),
            target_stats,
        )
        .min(target.hp.max(0.0));
        // G3: route the Lance impact through the pre-damage hook (breath).
        let lance_damage = super::user_dispatch::run_pre_damage_hooks(
            actor, target, actor_stats, target_stats, time,
            lance_damage, lance_damage, "breath",
            combat_log, record_trace, dealer_label, victim_label,
        );
        target.hp -= lance_damage;
        if actor_is_a {
            counters.dealt_a += lance_damage;
        } else {
            counters.dealt_b += lance_damage;
        }
        apply_incoming_statuses_to_target_with_fortify_immunity(
            time,
            target_stats,
            target.hp,
            &mut target.statuses,
            &[SimpleAppliedStatus {
                status_id: "Slow_Status".to_string(),
                stacks: 2.0, source_ability: None }],
            target.fortify_immune_until,
        );
        actor.lance_armed_until = 0.0;
        actor.lance_aura_until = time + 5.0;
        actor.lance_aura_next_tick_at = Some(time + 1.0);
        if target.hp <= 0.0 && target.death_time.is_none() {
            target.death_time = Some(time);
            if actor_is_a {
                counters.dealt_a_at_b_death = counters.dealt_a;
            } else {
                counters.dealt_b_at_a_death = counters.dealt_b;
            }
            target.hp = 1.0;
        }
    }
}

#[allow(clippy::too_many_arguments)]
fn tick_breath_auto_fire(
    time: f64,
    actor_stats: &SimpleCombatantStats,
    target_stats: &SimpleCombatantStats,
    breath: &SimpleBreathProfile,
    actor_is_a: bool,
    actor: &mut CombatSide,
    target: &mut CombatSide,
    actor_hunker_active: bool,
    target_hunker_active: bool,
    counters: &mut DamageCounters,
    combat_log: &mut Vec<CombatLogEntry>,
    record_trace: bool,
    dealer_label: &str,
    victim_label: &str,
) {
    if actor.breath_capacity <= 0.0 {
        if time < actor.breath_auto_fire_cooldown_until {
            return;
        }
        actor.breath_capacity = breath.capacity;
        actor.breath_auto_fire_delay_until = Some(time + auto_fire_delay_sec(breath));
        actor.breath_auto_fire_cooldown_until = time + auto_fire_cooldown_sec(breath);
    } else if actor.breath_auto_fire_cooldown_until <= 0.0
        && actor.breath_auto_fire_delay_until.is_none()
    {
        actor.breath_auto_fire_delay_until = Some(time + auto_fire_delay_sec(breath));
        actor.breath_auto_fire_cooldown_until = time + auto_fire_cooldown_sec(breath);
    }
    if let Some(delay_until) = actor.breath_auto_fire_delay_until {
        if time < delay_until {
            return;
        }
        actor.breath_auto_fire_delay_until = None;
        if actor.breath_capacity > 0.0 {
            fire_breath_damage(
                time,
                actor_stats,
                target_stats,
                breath,
                actor_is_a,
                actor,
                target,
                actor_hunker_active,
                target_hunker_active,
                counters,
                combat_log,
                record_trace,
                dealer_label,
                victim_label,
            );
            actor.breath_capacity =
                (actor.breath_capacity - runtime_breath_capacity_step(actor_stats, breath)).max(0.0);
            if actor.breath_capacity <= 0.0 {
                actor.breath_regen_at = actor.breath_auto_fire_cooldown_until;
            }
        }
    } else if actor.breath_capacity > 0.0 {
        fire_breath_damage(
            time,
            actor_stats,
            target_stats,
            breath,
            actor_is_a,
            actor,
            target,
            actor_hunker_active,
            target_hunker_active,
            counters,
            combat_log,
            record_trace,
            dealer_label,
            victim_label,
        );
        actor.breath_capacity =
            (actor.breath_capacity - runtime_breath_capacity_step(actor_stats, breath)).max(0.0);
        if actor.breath_capacity <= 0.0 {
            actor.breath_regen_at = actor.breath_auto_fire_cooldown_until;
        }
    }
}

/// Plasma Beam: discrete-charge beam, distinct from both standard
/// (continuous capacity) and auto-fire (single-cycle on long cooldown).
///
/// Reference: Plasma Beam fires up to `charges_max` discrete charges. Each
/// charge is one full capacity worth of ticks (e.g. capacity 1.5 at 0.5
/// per tick = 3 ticks per charge), gated by an `auto_fire_delay_sec`
/// startup. Consecutive charges fire back-to-back — only the startup
/// delay separates them, NO inter-charge cooldown — until all charges
/// are spent. Background regen grants +1 charge every `charge_regen_sec`
/// (capped at `charges_max`).
///
/// State on `CombatSide`:
///   - `plasma_charges_remaining`: charges still available (incl. the one
///     currently firing)
///   - `plasma_next_charge_at`: clock time of the next background regen
///     (or `INFINITY` while charges are at cap)
///   - `breath_capacity`: per-charge fuel — drains by tick step, refilled
///     to `breath.capacity` at the start of each cycle
///   - `breath_auto_fire_delay_until`: the 1 s "winding up" gate between
///     cycles
#[allow(clippy::too_many_arguments)]
fn tick_breath_plasma(
    time: f64,
    actor_stats: &SimpleCombatantStats,
    target_stats: &SimpleCombatantStats,
    breath: &SimpleBreathProfile,
    actor_is_a: bool,
    actor: &mut CombatSide,
    target: &mut CombatSide,
    actor_hunker_active: bool,
    target_hunker_active: bool,
    counters: &mut DamageCounters,
    combat_log: &mut Vec<CombatLogEntry>,
    record_trace: bool,
    dealer_label: &str,
    victim_label: &str,
) {
    // Step 1: background charge regen. We don't loop here — the scheduler
    // ticks `tick_breath_side` at most every `runtime_breath_tick_sec`
    // (0.5 s) and `charge_regen_sec` is typically ≥ 40 s, so at most one
    // tick is granted per call. If the user ever asks for sub-tick regen
    // we'd need a while loop, but currently a single conditional is
    // sufficient and easier to reason about.
    let charges_max = breath.charges_max.max(0.0);
    if time >= actor.plasma_next_charge_at && actor.plasma_charges_remaining < charges_max {
        actor.plasma_charges_remaining = (actor.plasma_charges_remaining + 1.0).min(charges_max);
        actor.plasma_next_charge_at = if actor.plasma_charges_remaining >= charges_max {
            f64::INFINITY
        } else {
            actor.plasma_next_charge_at + breath.charge_regen_sec.max(0.0)
        };
    }

    // Step 2: if not currently firing (capacity drained) and we still
    // have a stored charge, start a fresh cycle: consume one charge,
    // refill capacity to one charge's worth, and arm the startup delay.
    // First time a charge drops below max, start the regen timer.
    if actor.breath_capacity <= 0.0 && actor.plasma_charges_remaining > 0.0 {
        actor.plasma_charges_remaining -= 1.0;
        actor.breath_capacity = breath.capacity.max(0.0);
        actor.breath_auto_fire_delay_until = Some(time + breath.auto_fire_delay_sec.max(0.0));
        if !actor.plasma_next_charge_at.is_finite() {
            actor.plasma_next_charge_at = time + breath.charge_regen_sec.max(0.0);
        }
    }

    // Step 3: no fuel and no stored charges — idle until regen.
    if actor.breath_capacity <= 0.0 {
        return;
    }

    // Step 4: respect startup delay between cycles.
    if let Some(delay_until) = actor.breath_auto_fire_delay_until {
        if time < delay_until {
            return;
        }
        actor.breath_auto_fire_delay_until = None;
    }

    // Step 5: fire one tick.
    fire_breath_damage(
        time,
        actor_stats,
        target_stats,
        breath,
        actor_is_a,
        actor,
        target,
        actor_hunker_active,
        target_hunker_active,
        counters,
        combat_log,
        record_trace,
        dealer_label,
        victim_label,
    );
    actor.breath_capacity =
        (actor.breath_capacity - runtime_breath_capacity_step(actor_stats, breath)).max(0.0);
    // When the current charge exhausts and another is stored, the NEXT
    // scheduler tick will see `breath_capacity <= 0 && charges > 0` and
    // walk back through Step 2 (next cycle starts with its own startup
    // delay). No action required here.
}

#[allow(clippy::too_many_arguments)]
fn tick_breath_standard(
    time: f64,
    actor_stats: &SimpleCombatantStats,
    target_stats: &SimpleCombatantStats,
    breath: &SimpleBreathProfile,
    actor_is_a: bool,
    actor: &mut CombatSide,
    target: &mut CombatSide,
    actor_hunker_active: bool,
    target_hunker_active: bool,
    counters: &mut DamageCounters,
    combat_log: &mut Vec<CombatLogEntry>,
    record_trace: bool,
    dealer_label: &str,
    victim_label: &str,
) {
    let breath_tick_sec = runtime_breath_tick_sec(actor_stats, breath);

    // Capacity refill. Advance breath_regen_at by regen_rate (not time + rate) so
    // fractional time between scheduler ticks carries over — avoids quantum snap
    // eating breathRegenPct boosts (e.g. Baby Dragon) for rates like Miasma 2.5.
    let was_empty_at_tick_start = actor.breath_capacity <= 0.0;
    let mut refilled_support_breath = false;
    if actor.breath_capacity <= 0.0 && time >= actor.breath_regen_at {
        let max_capacity = breath.capacity.max(0.0);
        actor.breath_capacity = (actor.breath_capacity
            + runtime_breath_capacity_step(actor_stats, breath))
        .min(max_capacity);
        refilled_support_breath = matches!(
            breath.special_kind.as_deref(),
            Some("heal") | Some("cloud")
        );
        actor.breath_regen_at = if actor.breath_capacity >= max_capacity {
            f64::INFINITY
        } else {
            actor.breath_regen_at + breath.regen_rate.max(0.0)
        };
    }

    // Channel restart delay
    let mut resolved_restart_delay = false;
    if let Some(delay_until) = actor.breath_restart_delay_until {
        if time >= delay_until {
            resolved_restart_delay = true;
            actor.breath_restart_delay_until = None;
        }
    }
    let channel_broken = actor
        .last_breath_tick
        .map(|last_tick| time - last_tick > breath_tick_sec)
        .unwrap_or(false);
    if channel_broken && !resolved_restart_delay {
        if actor.breath_restart_delay_until.is_none() {
            actor.breath_restart_delay_until = Some(time + breath_tick_sec);
        }
        return;
    }

    if actor.breath_capacity <= 0.0 || refilled_support_breath {
        return;
    }

    // Fire breath
    if matches!(breath.special_kind.as_deref(), Some("heal") | Some("cloud")) {
        // Heartbroken blocks all healing sources except natural regen
        // (status_heartbroken Reference). Cleanse stacks below are
        // status removal, not HP heal — they are NOT gated.
        if !is_external_healing_blocked(&actor.statuses) {
            let heal = actor_stats.health * (breath.self_heal_pct / 100.0);
            if heal > 0.0 {
                let before = actor.hp;
                actor.hp = (actor.hp + heal).min(actor_stats.health);
                actor.iter_healing_taken += (actor.hp - before).max(0.0); // G4: on_heal accumulator
            }
        }
        if matches!(breath.special_kind.as_deref(), Some("cloud")) {
            actor.cloud_breath_muddy_progress += CLOUD_BREATH_MUDDY_PROC_FRACTION_PER_TICK;
            if actor.cloud_breath_muddy_progress >= 1.0 {
                actor.cloud_breath_muddy_progress -= 1.0;
                actor.statuses.insert(
                    "Muddy_Status".to_string(),
                    SimpleStatusInstance {
                        stacks: 1.0,
                        next_tick_at: None,
                        next_decay_at: Some(time + CLOUD_BREATH_MUDDY_DURATION_SEC),
                        remaining_sec: CLOUD_BREATH_MUDDY_DURATION_SEC,
                        stack_value_mode: None,
                        lich_mark_owned_stacks: None,
                        no_decay: false,
                        resolved_scalars: None,
                    },
                );
            }
        }
        if breath.cleanse_stacks > 0.0 {
            heal_simple_status_stacks(time, &mut actor.statuses, breath.cleanse_stacks);
        }
    } else {
        fire_breath_damage(
            time,
            actor_stats,
            target_stats,
            breath,
            actor_is_a,
            actor,
            target,
            actor_hunker_active,
            target_hunker_active,
            counters,
            combat_log,
            record_trace,
            dealer_label,
            victim_label,
        );
        if matches!(breath.special_kind.as_deref(), Some("miasma"))
            && !is_external_healing_blocked(&actor.statuses)
        {
            let heal = actor_stats.health * (breath.self_heal_pct / 100.0);
            if heal > 0.0 {
                let before = actor.hp;
                actor.hp = (actor.hp + heal).min(actor_stats.health);
                actor.iter_healing_taken += (actor.hp - before).max(0.0); // G4: on_heal accumulator
            }
        }
    }

    actor.breath_capacity =
        (actor.breath_capacity - runtime_breath_capacity_step(actor_stats, breath)).max(0.0);
    actor.last_breath_tick = Some(time);
    if actor.breath_capacity <= 0.0 && !was_empty_at_tick_start {
        // First transition to empty this cycle — seed next regen time.
        // On refill+fire same-tick cycles (was_empty_at_tick_start=true), the
        // refill block already advanced breath_regen_at by rate, so leave it.
        actor.breath_regen_at = time + breath.regen_rate.max(0.0);
    }
}

#[allow(clippy::too_many_arguments)]
fn fire_breath_damage(
    time: f64,
    actor_stats: &SimpleCombatantStats,
    target_stats: &SimpleCombatantStats,
    breath: &SimpleBreathProfile,
    actor_is_a: bool,
    actor: &mut CombatSide,
    target: &mut CombatSide,
    actor_hunker_active: bool,
    target_hunker_active: bool,
    counters: &mut DamageCounters,
    combat_log: &mut Vec<CombatLogEntry>,
    record_trace: bool,
    dealer_label: &str,
    victim_label: &str,
) {
    // Posture: the defender's settled-posture multiplier (×1.5 Sitting,
    // ×1.75 Laying) scales every breath tick that lands on them. The
    // multiplier is layered after resolve_breath_damage's full math
    // (hunker / breath_resistance / chain / pseudo-crit) so it composes
    // cleanly with everything else — Shadow Barrage clones the already-
    // multiplied bite event, so it inherits the posture mult without
    // re-applying it.
    let breath_damage = resolve_breath_damage(
        actor_stats,
        target_stats,
        breath,
        &mut actor.breath_chain,
        &actor.statuses,
        &target.statuses,
        actor_hunker_active,
        target_hunker_active,
    ) * target.posture_incoming_damage_mult();
    // G3: route the breath tick through the pre-damage hook (dealer = actor,
    // victim = target). raw == engine here — resolve_breath_damage already
    // applied hunker / breath_resistance / chain / crit / posture — but the
    // hook can still override the final via event.damage_override (shields,
    // absorb). No-op fast path inside when neither side has user abilities.
    let final_breath = if breath_damage > 0.0 {
        super::user_dispatch::run_pre_damage_hooks(
            actor, target, actor_stats, target_stats, time,
            breath_damage, breath_damage, "breath",
            combat_log, record_trace, dealer_label, victim_label,
        )
    } else {
        breath_damage
    };
    let reflected_to_actor = apply_direct_damage_with_reflect(
        final_breath,
        actor_is_a,
        true,
        actor_stats,
        target_stats,
        &actor.statuses,
        &target.statuses,
        &mut actor.hp,
        &mut target.hp,
        counters,
        target_hunker_active,
    );
    // G3: route reflected breath self-damage through the pre-damage hook —
    // dealer = target (reflector), victim = actor. Post-hoc hp adjust; no-op
    // fast path when no user ability (byte-identical).
    if reflected_to_actor > 0.0
        && (!actor_stats.user_ability_ids.is_empty()
            || !target_stats.user_ability_ids.is_empty())
    {
        let final_reflect = super::user_dispatch::run_pre_damage_hooks(
            target, actor, target_stats, actor_stats, time,
            reflected_to_actor, reflected_to_actor, "reflect",
            combat_log, record_trace, victim_label, dealer_label,
        );
        if (final_reflect - reflected_to_actor).abs() > 1e-9 {
            actor.hp = (actor.hp + reflected_to_actor - final_reflect).max(0.0);
        }
    }
    if !breath.special_statuses.is_empty() {
        if actor.filter_corrosion_from_breath {
            let filtered: Vec<SimpleAppliedStatus> = breath
                .special_statuses
                .iter()
                .filter(|s| s.status_id != "Corrosion_Status")
                .cloned()
                .collect();
            if !filtered.is_empty() {
                apply_incoming_statuses_to_target_with_fortify_immunity(
                    time,
                    target_stats,
                    target.hp,
                    &mut target.statuses,
                    &filtered,
                    target.fortify_immune_until,
                );
            }
        } else {
            apply_incoming_statuses_to_target_with_fortify_immunity(
                time,
                target_stats,
                target.hp,
                &mut target.statuses,
                &breath.special_statuses,
                target.fortify_immune_until,
            );
        }
    }
    // Death commit from breath damage is deferred to Phase 16 of the main
    // event loop. This preserves same-tick life-leech rescue semantics
    // (TS runtime): if the defender's breath in Phase 15 leeches enough to
    // lift hp back above 0, no death is registered this tick. Phase 16's
    // final death check runs regardless of which phase delivered the lethal
    // damage, and captures `counters.dealt_a_at_b_death` / `dealt_b_at_a_death`
    // there.
    let _ = counters;
    let _ = actor_is_a;
}
