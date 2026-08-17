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

use super::{
    aerial_dodge_incoming_lands, apply_direct_damage_with_reflect, apply_unbreakable_damage_cap,
    AerialDodgeChannel, CombatSide, DamageCounters,
};

/// Cloud Breath's Muddy self-proc chance per fire tick
/// (`Constants__BreathData.CloudBreath.AutomaticSelfAilments.Muddy.P = 40`).
const CLOUD_BREATH_MUDDY_GAME_PROC_CHANCE: f64 = 0.4;

/// One proc is worth two seconds of Muddy. The game applies the ailment's
/// `DefaultValue = 2` (`DATA_AilmentData.Muddy`) and Muddy sheds one point
/// per second instead of the usual three, so the value is also the lifetime
/// in seconds. The 90 s carried here before belongs to rolling in a mud pile
/// (Compare's Mud Pile toggle, `setup.rs`), not to a breath proc.
const CLOUD_BREATH_MUDDY_DURATION_SEC: f64 = 2.0;

const AUTO_FIRE_COOLDOWN_SEC: f64 = 120.0;

/// Per-tick share of a Muddy proc for the deterministic accumulator that
/// stands in for the 40% roll.
///
/// The accumulator is a pseudo-chance: it fires on a fixed cadence instead of
/// rolling, so it can match one statistic of the real roll and only one.
/// Matching the proc *rate* (fraction = 0.4) is the obvious choice and is the
/// right one whenever the proc's worth is linear in how often it lands - every
/// stacking breath ailment is calibrated that way. Muddy is not: it is
/// non-stacking and its worth is uptime, the share of the fight spent under the
/// +25% regen. Rate-matching would proc every 1.25 s against a 2 s life and
/// hold Muddy up 100% of the time, where the roll it stands for leaves gaps.
///
/// So the accumulator is calibrated on uptime instead. A proc covers
/// `n = duration / tick` ticks, the status is down only when all `n` miss, and
/// the deterministic cadence `duration / (n * fraction)` covers a `n * fraction`
/// share of the timeline:
///
/// ```text
/// uptime   = 1 - (1 - p)^n
/// fraction = uptime / n
/// ```
///
/// At the 2 Hz fire tick that is `n = 4`, `uptime = 1 - 0.6^4 = 0.8704`, and a
/// fraction of `0.2176` - a proc every 2.298 s carrying 2 s of Muddy. The
/// modeled regen bonus averages `25% x 0.8704 ~ 21.8%`, which is what the roll
/// is worth, rather than the flat 25% rate-matching would hand out.
fn cloud_breath_muddy_proc_fraction(breath_tick_sec: f64) -> f64 {
    if breath_tick_sec <= 0.0 {
        return CLOUD_BREATH_MUDDY_GAME_PROC_CHANCE;
    }
    let ticks_covered = CLOUD_BREATH_MUDDY_DURATION_SEC / breath_tick_sec;
    if ticks_covered <= 1.0 {
        // A proc expires before the next tick can land: the roll and the
        // accumulator agree that uptime is just the per-tick chance.
        return CLOUD_BREATH_MUDDY_GAME_PROC_CHANCE;
    }
    let uptime = 1.0 - (1.0 - CLOUD_BREATH_MUDDY_GAME_PROC_CHANCE).powf(ticks_covered);
    uptime / ticks_covered
}

/// Continuous breath-fuel regeneration.
///
/// The game regenerates a breath's fuel meter continuously while it is NOT
/// firing, by `(RegenAmount or 1) / RegenRate * dt` per step and from any
/// partial level. Firing and regen are mutually exclusive. Our capacity is
/// denominated in seconds of fire and drains 1 unit/s, so it maps directly
/// onto the game fuel and the correct regen is `1 / regen_rate` capacity
/// units per second.
///
/// When `true`, an empty breath meter spends its tick regenerating
/// `breath_tick_sec / regen_rate` fuel (capped at `capacity`) and does not
/// fire; a fuelled meter fires and drains exactly as before. This restores
/// the game's burst-then-refill duty cycle in place of the legacy discrete
/// refill-from-empty that dribbled one tick per `regen_rate`.
///
/// Flip to `false` to restore the legacy discrete model byte-for-byte (the
/// `else` branch of every consumer).
pub(crate) const BREATH_CONTINUOUS_REGEN: bool = true;

/// Whether continuous breath regen is engaged. Reads the compile-time
/// [`BREATH_CONTINUOUS_REGEN`] const in shipped builds; a `#[cfg(test)]`
/// thread-local override lets one test process exercise both flag states
/// (mirrors `fortify_rollout_bridge::fortify_rollout_enabled`).
#[cfg(not(test))]
#[inline(always)]
pub(crate) fn breath_continuous_regen_enabled() -> bool {
    BREATH_CONTINUOUS_REGEN
}

#[cfg(test)]
thread_local! {
    static BREATH_CONTINUOUS_REGEN_OVERRIDE: std::cell::Cell<Option<bool>> =
        const { std::cell::Cell::new(None) };
}

#[cfg(test)]
pub(crate) fn breath_continuous_regen_enabled() -> bool {
    BREATH_CONTINUOUS_REGEN_OVERRIDE
        .with(|c| c.get())
        .unwrap_or(BREATH_CONTINUOUS_REGEN)
}

/// Set (or clear) the test-only continuous-regen override.
#[cfg(test)]
pub(crate) fn set_breath_continuous_regen_override(v: Option<bool>) {
    BREATH_CONTINUOUS_REGEN_OVERRIDE.with(|c| c.set(v));
}

/// Breath burst / fuel-debt / chain-reset / policy model. Layered on top
/// of [`BREATH_CONTINUOUS_REGEN`]: with it on, a firing tick drains the
/// fuel meter with NO clamp (the drain may push capacity slightly
/// negative on the last tick of a run; regen resumes from there), the
/// breath chain resets to 0 the moment a firing run stops, the chain
/// advances only on a landed hit that deals > 0, and the per-side
/// [`SimpleBreathPolicyMode`](crate::composable::config::SimpleBreathPolicyMode)
/// governs whether the meter fires on availability or holds for a full
/// bar. With it OFF every consumer keeps the shipped path verbatim
/// (clamp on, chain never resets, chain increments unconditionally, no
/// policy) so a single flip reverts.
pub(crate) const BREATH_BURST_MODEL: bool = true;

/// Inter-chain recast: the delay after a firing run ends before the next
/// full-bar burst may start. Owner assertion (~1 s); negligible against a
/// chain breath's multi-second refill, but modeled so the field is real.
pub(crate) const BREATH_RECAST_SEC: f64 = 1.0;

/// Whether the burst model is engaged. Reads the compile-time
/// [`BREATH_BURST_MODEL`] const in shipped builds; a `#[cfg(test)]`
/// thread-local override lets one test process exercise both flag states
/// (mirrors [`breath_continuous_regen_enabled`]).
#[cfg(not(test))]
#[inline(always)]
pub(crate) fn breath_burst_model_enabled() -> bool {
    BREATH_BURST_MODEL
}

#[cfg(test)]
thread_local! {
    static BREATH_BURST_MODEL_OVERRIDE: std::cell::Cell<Option<bool>> =
        const { std::cell::Cell::new(None) };
}

#[cfg(test)]
pub(crate) fn breath_burst_model_enabled() -> bool {
    BREATH_BURST_MODEL_OVERRIDE
        .with(|c| c.get())
        .unwrap_or(BREATH_BURST_MODEL)
}

/// Set (or clear) the test-only burst-model override.
#[cfg(test)]
pub(crate) fn set_breath_burst_model_override(v: Option<bool>) {
    BREATH_BURST_MODEL_OVERRIDE.with(|c| c.set(v));
}

/// The concrete firing discipline the fuel stepper runs. `Ideal` is driven by
/// the per-side `breath_burst_open_at` commitment that
/// [`crate::composable::breath_ideal_bridge`] writes at each burst boundary -
/// the stepper holds fire until that clock time, opens a run, then reverts to
/// availability once the commitment clears.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum ResolvedBreathPolicy {
    OnAvailability,
    OnFullBar,
    Ideal,
}

pub(crate) fn resolve_breath_policy(
    mode: crate::composable::config::SimpleBreathPolicyMode,
) -> ResolvedBreathPolicy {
    use crate::composable::config::SimpleBreathPolicyMode as M;
    match mode {
        M::OnFullBar => ResolvedBreathPolicy::OnFullBar,
        M::Ideal => ResolvedBreathPolicy::Ideal,
        M::OnAvailability => ResolvedBreathPolicy::OnAvailability,
    }
}

/// One breath-fuel micro-step under the burst model. Given the current
/// meter, the resolved policy, and the burst state, decide whether the
/// breath FIRES this tick and advance the meter for a non-firing tick
/// (regen). Resets the chain to 0 the moment a firing run stops.
///
/// Does NOT drain on a fire and does NOT advance the chain: the caller
/// resolves the fire (damage + [`crate::combat::breath_chain_advance`] at
/// the landed-hit site) and then drains via [`breath_burst_drain`]. This
/// is the single shared stepper called by the real loop and both
/// projection oracles, so the fuel-sign / chain-reset / burst-transition
/// arithmetic lives in exactly one place.
#[allow(clippy::too_many_arguments)]
pub(crate) fn breath_burst_fuel_step(
    policy: ResolvedBreathPolicy,
    time: f64,
    max_capacity: f64,
    regen_rate: f64,
    tick_sec: f64,
    capacity: &mut f64,
    chain: &mut f64,
    bursting: &mut bool,
    recast_until: &mut f64,
    open_at: &mut f64,
) -> bool {
    let regen = |cap: &mut f64| {
        if regen_rate > 0.0 {
            *cap = (*cap + tick_sec / regen_rate).min(max_capacity);
        }
    };
    match policy {
        ResolvedBreathPolicy::OnAvailability => {
            if *capacity > 0.0 {
                *bursting = true;
                true
            } else {
                if *bursting {
                    // The run stopped this tick - reset the chain (game Stop).
                    *chain = 0.0;
                    *bursting = false;
                }
                regen(capacity);
                false
            }
        }
        ResolvedBreathPolicy::OnFullBar => {
            if *bursting {
                if *capacity > 0.0 {
                    true
                } else {
                    // Burst spent: reset the chain, arm the recast, refill.
                    *chain = 0.0;
                    *bursting = false;
                    *recast_until = time + BREATH_RECAST_SEC;
                    regen(capacity);
                    false
                }
            } else if *capacity + 1e-9 >= max_capacity && time + 1e-9 >= *recast_until {
                // Full bar past the recast window: open a fresh burst.
                *bursting = true;
                *chain = 0.0;
                true
            } else {
                regen(capacity);
                false
            }
        }
        ResolvedBreathPolicy::Ideal => {
            if open_at.is_finite() {
                // Committed cycle: hold (charge) until the picked open time,
                // fire the run until the meter drains, then release the
                // commitment so the next boundary re-decides.
                if *bursting {
                    if *capacity > 0.0 {
                        true
                    } else {
                        *chain = 0.0;
                        *bursting = false;
                        *recast_until = time + BREATH_RECAST_SEC;
                        *open_at = f64::INFINITY;
                        regen(capacity);
                        false
                    }
                } else if time + 1e-9 >= *open_at && *capacity > 0.0 {
                    // The commitment is a "no earlier than" open time; still
                    // only fire on real fuel, so a run never opens on an empty
                    // meter (the burst model's fire-while-positive invariant).
                    *bursting = true;
                    *chain = 0.0;
                    true
                } else {
                    regen(capacity);
                    false
                }
            } else if time + 1e-9 < *recast_until {
                // Uncommitted inside the post-run recast window: hold.
                regen(capacity);
                false
            } else {
                // Uncommitted past the recast: availability fallback. In the
                // live engine `breath_ideal_bridge` commits an open time
                // before the stepper runs, so this is reached only inside an
                // inner replay after its forced run drains - the
                // recursion-guard pin to availability.
                if *capacity > 0.0 {
                    *bursting = true;
                    true
                } else {
                    if *bursting {
                        *chain = 0.0;
                        *bursting = false;
                    }
                    regen(capacity);
                    false
                }
            }
        }
    }
}

/// Availability-semantics entry to [`breath_burst_fuel_step`] for the
/// projection oracles: they are inner what-if projections and never model
/// the full-bar charging state, so they always run `OnAvailability` with a
/// throwaway `bursting` / `recast_until`.
#[allow(clippy::too_many_arguments)]
pub(crate) fn breath_burst_fuel_step_availability(
    time: f64,
    max_capacity: f64,
    regen_rate: f64,
    tick_sec: f64,
    capacity: &mut f64,
    chain: &mut f64,
    bursting: &mut bool,
    recast_until: &mut f64,
) -> bool {
    // OnAvailability never reads or writes the Ideal open-time commitment,
    // so a throwaway keeps the oracle call sites unchanged.
    let mut open_at = f64::INFINITY;
    breath_burst_fuel_step(
        ResolvedBreathPolicy::OnAvailability,
        time,
        max_capacity,
        regen_rate,
        tick_sec,
        capacity,
        chain,
        bursting,
        recast_until,
        &mut open_at,
    )
}

/// Drain the fuel meter after a firing tick under the burst model - the
/// no-clamp counterpart to the legacy `.max(0.0)` drain. The debt may push
/// capacity slightly negative on the final tick of a run; the stepper then
/// regenerates from that negative value, which is what makes the
/// sustainable cadence fall out as `2/(1+RegenRate)` hits/s.
#[inline]
pub(crate) fn breath_burst_drain(capacity: &mut f64, step: f64) {
    *capacity -= step;
}

/// Whether `breath` uses the standard continuous-capacity path - the only
/// path the continuous-regen model applies to. Lance, Plasma Beam, and the
/// auto-fire family (Solar Beam / Spirit Glare / Heliolyth's Judgement) run
/// their own charge/cooldown capacity models and keep the legacy projection.
pub(crate) fn is_standard_breath(breath: &SimpleBreathProfile) -> bool {
    !matches!(
        breath.special_kind.as_deref(),
        Some("lance")
            | Some("plasma_beam")
            | Some("solar_beam")
            | Some("spirit_glare")
            | Some("heliolyth_judgement")
    )
}

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
    // two times per second" -> 0.5s per tick.
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
    // Pre-damage hook plumbing for the standard breath-damage path.
    combat_log: &mut Vec<CombatLogEntry>,
    record_trace: bool,
    dealer_label: &str,
    victim_label: &str,
    // Per-side breath firing policy - consulted only by the standard
    // burst-model path; lance / plasma / auto-fire ignore it.
    policy: crate::composable::config::SimpleBreathPolicyMode,
) {
    if ability_blocked_by_necropoison("Breath", &actor.statuses) {
        return;
    }
    // Posture gate: while the actor is settled in Sitting / Laying,
    // breath cannot fire. The transition window does NOT block -
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
            policy,
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
        let weight_lerp = crate::combat::lance_weight_lerp_factor(
            actor_stats,
            target_stats,
            &actor.statuses,
            &target.statuses,
            target.posture_incoming_damage_mult(),
        );
        let lance_damage = apply_unbreakable_damage_cap(
            target_stats.health * (breath.lance_damage_pct / 100.0) * weight_lerp,
            target_stats,
        )
        .min(target.hp.max(0.0));
        // Route the Lance impact through the pre-damage hook (breath).
        let lance_damage = super::damage_pipeline::resolve_incoming_damage(
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
                stacks: 2.0, ..Default::default() }],
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
/// startup. A new charge can't start until the `auto_fire_cooldown_sec`
/// recast has elapsed, measured from the previous charge's start (game
/// `RecastCooldown`), so charges cadence at `recast` intervals. Background
/// regen grants +1 charge every `charge_regen_sec` (capped at
/// `charges_max`).
///
/// State on `CombatSide`:
///   - `plasma_charges_remaining`: charges still available (incl. the one
///     currently firing)
///   - `plasma_next_charge_at`: clock time of the next background regen
///     (or `INFINITY` while charges are at cap)
///   - `breath_capacity`: per-charge fuel - drains by tick step, refilled
///     to `breath.capacity` at the start of each cycle
///   - `breath_auto_fire_delay_until`: the startup gate before a charge's
///     first tick
///   - `breath_auto_fire_cooldown_until`: the recast gate - a new charge
///     can't start before this clock time (charge start + recast)
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
    // Step 1: background charge regen. We don't loop here - the scheduler
    // ticks `tick_breath_side` at most every `runtime_breath_tick_sec`
    // (0.5 s) and `charge_regen_sec` is typically >= 40 s, so at most one
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

    // Step 2: if not currently firing (capacity drained), we still have a
    // stored charge, and the recast cooldown has elapsed, start a fresh
    // cycle: consume one charge, refill capacity to one charge's worth,
    // arm the startup delay, and re-arm the recast from this charge's
    // start. First time a charge drops below max, start the regen timer.
    if actor.breath_capacity <= 0.0
        && actor.plasma_charges_remaining > 0.0
        && time >= actor.breath_auto_fire_cooldown_until
    {
        actor.plasma_charges_remaining -= 1.0;
        actor.breath_capacity = breath.capacity.max(0.0);
        actor.breath_auto_fire_delay_until = Some(time + breath.auto_fire_delay_sec.max(0.0));
        actor.breath_auto_fire_cooldown_until = time + breath.auto_fire_cooldown_sec.max(0.0);
        if !actor.plasma_next_charge_at.is_finite() {
            actor.plasma_next_charge_at = time + breath.charge_regen_sec.max(0.0);
        }
    }

    // Step 3: no fuel and no stored charges - idle until regen.
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

/// Apply a self-heal breath's self-heal on the game's 1 s cadence.
///
/// In-game the self-heal rides `_updateRegenAndCapacity` (spawnLoop = 1 s)
/// while firing - `MaxHP * SelfHeal% per second`, not per fire tick. The
/// runtime fires breath ticks at 2 Hz, so we accumulate firing time and
/// heal once per whole second. `self_heal_pct` is the game SelfHeal value
/// (Cloud 1 / Heal 3 / Miasma 0.5). Heartbroken blocks the heal, but the
/// second still elapses (the loop ticks regardless).
fn tick_breath_self_heal(
    actor: &mut CombatSide,
    actor_stats: &SimpleCombatantStats,
    self_heal_pct: f64,
    breath_tick_sec: f64,
) {
    if self_heal_pct <= 0.0 {
        return;
    }
    actor.breath_self_heal_accum += breath_tick_sec;
    if actor.breath_self_heal_accum + 1e-9 < 1.0 {
        return;
    }
    actor.breath_self_heal_accum -= 1.0;
    // Heartbroken blocks all healing sources except natural regen.
    if is_external_healing_blocked(&actor.statuses) {
        return;
    }
    let heal = actor_stats.health * (self_heal_pct / 100.0);
    if heal > 0.0 {
        let before = actor.hp;
        actor.hp = (actor.hp + heal).min(actor_stats.health);
        actor.iter_healing_taken += (actor.hp - before).max(0.0); // on_heal accumulator
    }
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
    policy: crate::composable::config::SimpleBreathPolicyMode,
) {
    let breath_tick_sec = runtime_breath_tick_sec(actor_stats, breath);

    if breath_burst_model_enabled() {
        tick_breath_standard_burst(
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
            breath_tick_sec,
            policy,
        );
        return;
    }

    if breath_continuous_regen_enabled() {
        tick_breath_standard_continuous(
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
            breath_tick_sec,
        );
        return;
    }

    // ===== Legacy discrete refill-from-empty model (flag off). =====
    // Capacity refill. Advance breath_regen_at by regen_rate (not time + rate) so
    // fractional time between scheduler ticks carries over - avoids quantum snap
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

    fire_breath_standard_tick(
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
        breath_tick_sec,
    );

    actor.breath_capacity =
        (actor.breath_capacity - runtime_breath_capacity_step(actor_stats, breath)).max(0.0);
    actor.last_breath_tick = Some(time);
    if actor.breath_capacity <= 0.0 && !was_empty_at_tick_start {
        // First transition to empty this cycle - seed next regen time.
        // On refill+fire same-tick cycles (was_empty_at_tick_start=true), the
        // refill block already advanced breath_regen_at by rate, so leave it.
        actor.breath_regen_at = time + breath.regen_rate.max(0.0);
    }
}

/// Continuous-regen standard breath tick (flag on). Firing and regen are
/// mutually exclusive: an empty meter spends the tick regenerating
/// `breath_tick_sec / regen_rate` fuel and does not fire; a fuelled meter
/// fires and drains exactly as the legacy path. The channel-restart-delay
/// guard is preserved so a genuine gap in the channel (posture skip, Head
/// Start) still costs one restart tick; during normal regen/fire cycling
/// `last_breath_tick` advances every tick so the channel never falsely
/// breaks.
#[allow(clippy::too_many_arguments)]
fn tick_breath_standard_continuous(
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
    breath_tick_sec: f64,
) {
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

    if actor.breath_capacity <= 0.0 {
        // Empty meter: spend this tick regenerating, not firing. Accrue one
        // tick's worth of fuel (1/regen_rate fire-seconds per second) capped
        // at capacity. No fire/self-heal/damage this tick (mutual exclusion).
        let max_capacity = breath.capacity.max(0.0);
        if breath.regen_rate > 0.0 {
            actor.breath_capacity =
                (actor.breath_capacity + breath_tick_sec / breath.regen_rate).min(max_capacity);
        }
        actor.last_breath_tick = Some(time);
        return;
    }

    // Fuelled meter: fire + drain, identical to the legacy fire path.
    fire_breath_standard_tick(
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
        breath_tick_sec,
    );
    actor.breath_capacity =
        (actor.breath_capacity - runtime_breath_capacity_step(actor_stats, breath)).max(0.0);
    actor.last_breath_tick = Some(time);
}

/// Burst-model standard breath tick (`BREATH_BURST_MODEL` on). The shared
/// [`breath_burst_fuel_step`] owns the fuel-sign / chain-reset /
/// burst-transition arithmetic; a firing tick fires + drains with NO clamp
/// (debt kept), an empty/charging tick regenerates. The chain advances at
/// the landed-hit site inside `fire_breath_damage`, so a dodged or
/// fully-absorbed tick does not ramp it. The channel-restart-delay guard
/// is preserved from the continuous path so a genuine gap (posture skip,
/// Head Start) still costs one restart tick.
#[allow(clippy::too_many_arguments)]
fn tick_breath_standard_burst(
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
    breath_tick_sec: f64,
    policy: crate::composable::config::SimpleBreathPolicyMode,
) {
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

    let resolved = resolve_breath_policy(policy);
    let max_capacity = breath.capacity.max(0.0);
    let fire = breath_burst_fuel_step(
        resolved,
        time,
        max_capacity,
        breath.regen_rate,
        breath_tick_sec,
        &mut actor.breath_capacity,
        &mut actor.breath_chain,
        &mut actor.breath_bursting,
        &mut actor.breath_recast_until,
        &mut actor.breath_burst_open_at,
    );

    if fire {
        fire_breath_standard_tick(
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
            breath_tick_sec,
        );
        breath_burst_drain(
            &mut actor.breath_capacity,
            runtime_breath_capacity_step(actor_stats, breath),
        );
    }
    actor.last_breath_tick = Some(time);
}

/// Fire one standard breath tick: self-heal / Muddy / cleanse for the
/// support family (Heal / Cloud), damage otherwise, with Miasma self-heal
/// on the damage path. Does NOT touch capacity - the caller consumes the
/// step. Extracted verbatim from `tick_breath_standard` so the legacy and
/// continuous-regen paths share one fire implementation.
#[allow(clippy::too_many_arguments)]
fn fire_breath_standard_tick(
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
    breath_tick_sec: f64,
) {
    if matches!(breath.special_kind.as_deref(), Some("heal") | Some("cloud")) {
        // Self-heal runs on the 1 s regen loop (tick_breath_self_heal). The
        // Muddy proc and cleanse below stay on the 2 Hz fire tick: the game
        // applies the cleanse (SubtractDebuffAilments) on the fire path,
        // separate from the self-heal loop.
        tick_breath_self_heal(actor, actor_stats, breath.self_heal_pct, breath_tick_sec);
        if matches!(breath.special_kind.as_deref(), Some("cloud")) {
            actor.cloud_breath_muddy_progress += cloud_breath_muddy_proc_fraction(breath_tick_sec);
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
        if matches!(breath.special_kind.as_deref(), Some("miasma")) {
            // Miasma damages on the 2 Hz fire tick (above) but self-heals on
            // the 1 s regen loop, same as Heal / Cloud.
            tick_breath_self_heal(actor, actor_stats, breath.self_heal_pct, breath_tick_sec);
        }
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
    // Posture: the defender's settled-posture multiplier (x1.5 Sitting,
    // x2.0 Laying) scales every breath tick that lands on them. The
    // multiplier is layered after resolve_breath_damage's full math
    // (hunker / breath_resistance / chain / pseudo-crit) so it composes
    // cleanly with everything else - Shadow Barrage clones the already-
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
    // Aerial Dodge: a flier can weave away from a breath tick. On a dodge the
    // tick deals no damage and applies no breath statuses; the breather's
    // chain / capacity already advanced (resolve_breath_damage ran), so it
    // still counts as having fired. Wing Shredder (Shredded Wings) grounds the
    // target and forces the tick to land.
    if !aerial_dodge_incoming_lands(target_stats, target, AerialDodgeChannel::Breath) {
        if record_trace {
            combat_log.push(CombatLogEntry {
                time,
                entry_type: "dodge".to_string(),
                attacker: dealer_label.to_string(),
                damage: 0.0,
                healing: None,
                actor_hp_after: actor.hp.max(0.0),
                hp_side: victim_label.to_string(),
                hp_after: target.hp.max(0.0),
                description: Some("Dodged breath".to_string()),
                detail: None,
                status_id: None,
            });
        }
        return;
    }
    // Route the breath tick through the pre-damage hook (dealer = actor,
    // victim = target). raw == engine here - resolve_breath_damage already
    // applied hunker / breath_resistance / chain / crit / posture - but the
    // hook can still override the final via event.damage_override (shields,
    // absorb). No-op fast path inside when neither side has user abilities.
    let final_breath = if breath_damage > 0.0 {
        super::damage_pipeline::resolve_incoming_damage(
            actor, target, actor_stats, target_stats, time,
            breath_damage, breath_damage, "breath",
            combat_log, record_trace, dealer_label, victim_label,
        )
    } else {
        breath_damage
    };
    // Chain advance (burst model): the game increments the chain only on a
    // landed hit that deals more than 0. We are past the dodge return
    // here, so a dodged tick never reaches this point; gating on
    // `final_breath > 0` also skips a fully-absorbed tick. With the flag
    // off the chain is instead advanced inside the damage compute, so this
    // is inert.
    if breath_burst_model_enabled() && final_breath > 0.0 {
        crate::combat::breath_chain_advance(&mut actor.breath_chain, breath);
    }
    // Breath is never reflected in-game (Reflect only bounces melee bites), so
    // pass allow_reflect = false: the breath hit lands on the target normally
    // even against an active Reflect, and nothing bounces back to the breather.
    apply_direct_damage_with_reflect(
        final_breath,
        final_breath,
        actor_is_a,
        actor_stats,
        target_stats,
        &mut actor.hp,
        &mut target.hp,
        counters,
        target_hunker_active,
        false,
    );
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

#[cfg(test)]
mod cloud_breath_muddy_calibration_tests {
    use super::{
        cloud_breath_muddy_proc_fraction, CLOUD_BREATH_MUDDY_DURATION_SEC,
        CLOUD_BREATH_MUDDY_GAME_PROC_CHANCE,
    };

    /// The 2 Hz fire tick, restated here so the calibration is pinned against
    /// a literal rather than against the function that produces it.
    const FIRE_TICK_SEC: f64 = 0.5;

    #[test]
    fn accumulator_reproduces_the_uptime_of_the_forty_percent_roll() {
        let ticks_covered = CLOUD_BREATH_MUDDY_DURATION_SEC / FIRE_TICK_SEC;
        assert_eq!(ticks_covered, 4.0, "a 2 s proc must span four 0.5 s ticks");

        // The roll leaves Muddy down only when all four covered ticks miss.
        let roll_uptime = 1.0 - (1.0 - CLOUD_BREATH_MUDDY_GAME_PROC_CHANCE).powi(4);
        assert!(
            (roll_uptime - 0.8704).abs() < 1e-12,
            "1 - 0.6^4 must be 0.8704: got {roll_uptime}"
        );

        let fraction = cloud_breath_muddy_proc_fraction(FIRE_TICK_SEC);
        assert!(
            (fraction - 0.2176).abs() < 1e-12,
            "per-tick fraction must be 0.2176: got {fraction}"
        );

        // What the accumulator actually delivers: a proc every 1/fraction
        // ticks, each covering `ticks_covered` ticks.
        let modeled_uptime = fraction * ticks_covered;
        assert!(
            (modeled_uptime - roll_uptime).abs() < 1e-12,
            "modeled uptime {modeled_uptime} must equal the roll's {roll_uptime}"
        );

        // The regen bonus the model hands out on average, against Muddy's
        // registry magnitude of +25%.
        let average_bonus_pct = 25.0 * modeled_uptime;
        assert!(
            (average_bonus_pct - 21.76).abs() < 1e-9,
            "average regen bonus must be 21.76%: got {average_bonus_pct}"
        );
    }

    #[test]
    fn rate_matching_would_have_pinned_uptime_at_one() {
        // Why the calibration moved: the old fraction (the raw 40%) procs
        // every 1.25 s against a 2 s life, so Muddy would never lapse.
        let proc_interval_sec = FIRE_TICK_SEC / CLOUD_BREATH_MUDDY_GAME_PROC_CHANCE;
        assert!((proc_interval_sec - 1.25).abs() < 1e-12);
        assert!(
            proc_interval_sec < CLOUD_BREATH_MUDDY_DURATION_SEC,
            "rate-matching leaves no gap, which is the divergence being corrected"
        );

        // The uptime-calibrated cadence does leave one.
        let calibrated_interval = FIRE_TICK_SEC / cloud_breath_muddy_proc_fraction(FIRE_TICK_SEC);
        assert!(
            calibrated_interval > CLOUD_BREATH_MUDDY_DURATION_SEC,
            "calibrated cadence {calibrated_interval} must outrun the 2 s life"
        );
    }

    #[test]
    fn a_tick_slower_than_the_proc_life_falls_back_to_the_raw_chance() {
        // Degenerate guard: when one proc cannot survive to the next tick,
        // uptime is just the per-tick chance and there is nothing to correct.
        let fraction = cloud_breath_muddy_proc_fraction(CLOUD_BREATH_MUDDY_DURATION_SEC * 2.0);
        assert!((fraction - CLOUD_BREATH_MUDDY_GAME_PROC_CHANCE).abs() < 1e-12);
    }
}

#[cfg(test)]
mod continuous_regen_tests {
    use super::set_breath_continuous_regen_override;
    use crate::composable::config::ComposableAbilityConfig;
    use crate::composable::reference_tests::{default_breath, default_combatant};
    use crate::composable::simulate_composable_matchup;
    use crate::contracts::{SimpleAbilityTimingMode, SimpleBreathProfile, SimpleCombatantStats};

    fn cloud_healer() -> SimpleCombatantStats {
        let mut c = default_combatant();
        c.health = 17_000.0;
        c.damage = 60.0;
        c.bite_cooldown = 1.0;
        c.health_regen = 3.0;
        c
    }

    fn cloud_breath() -> SimpleBreathProfile {
        let mut b = default_breath();
        b.capacity = 15.0;
        b.regen_rate = 1.3;
        b.self_heal_pct = 1.0;
        b.special_kind = Some("cloud".to_string());
        b
    }

    fn bruiser() -> SimpleCombatantStats {
        let mut c = default_combatant();
        c.health = 10_750.0;
        c.damage = 450.0;
        c.bite_cooldown = 1.0;
        c
    }

    /// Run the healer-vs-bruiser matchup with the continuous-regen flag
    /// forced to `on`, returning (healer final HP, healer death time).
    fn run(on: bool, max_time_sec: f64) -> (f64, Option<f64>) {
        // The burst model supersedes the continuous path, so pin it off - this
        // A/B is specifically continuous-vs-legacy and must stay meaningful
        // once BREATH_BURST_MODEL flips on.
        super::set_breath_burst_model_override(Some(false));
        set_breath_continuous_regen_override(Some(on));
        let healer = cloud_healer();
        let breath = cloud_breath();
        let opponent = bruiser();
        let summary = simulate_composable_matchup(
            &healer,
            &opponent,
            Some(&breath),
            None,
            SimpleAbilityTimingMode::Fast,
            &ComposableAbilityConfig::default(),
            max_time_sec,
        );
        set_breath_continuous_regen_override(None);
        super::set_breath_burst_model_override(None);
        (summary.final_hp_a, summary.death_time_a)
    }

    #[test]
    fn continuous_regen_boosts_cloud_healer_survival() {
        let max_time_sec = 120.0;
        let (hp_off, death_off) = run(false, max_time_sec);
        let (hp_on, death_on) = run(true, max_time_sec);

        // Survival score: how long the healer stayed alive (death time, or
        // the full window if it never died). Continuous regen self-heals
        // faster, so the healer must survive strictly and substantially
        // longer with the flag on.
        let survival_off = death_off.unwrap_or(max_time_sec);
        let survival_on = death_on.unwrap_or(max_time_sec);

        eprintln!(
            "continuous_regen A/B: flag off -> final_hp_a={hp_off:.1}, death={death_off:?}; \
             flag on -> final_hp_a={hp_on:.1}, death={death_on:?}"
        );

        assert!(
            survival_on > survival_off + 1.0,
            "continuous regen should extend cloud-healer survival: off={survival_off:.2}s \
             (hp {hp_off:.1}), on={survival_on:.2}s (hp {hp_on:.1})"
        );
    }
}

#[cfg(test)]
mod burst_model_tests {
    use super::{runtime_breath_tick_sec, set_breath_burst_model_override, tick_breath_side};
    use crate::composable::config::{ComposableAbilityConfig, SimpleBreathPolicyMode};
    use crate::composable::reference_tests::{default_breath, default_combatant};
    use crate::composable::side::CombatSide;
    use crate::composable::{simulate_composable_matchup, DamageCounters};
    use crate::contracts::{
        CreatureIdentity, SimpleAbilityTimingMode, SimpleBreathProfile, SimpleCombatantStats,
    };

    struct TickRec {
        fired: bool,
        capacity: f64,
        chain: f64,
    }

    fn energy_breath() -> SimpleBreathProfile {
        let mut b = default_breath();
        b.dps_pct = 0.45;
        b.capacity = 8.0;
        b.regen_rate = 5.0;
        b.chain = 100.0;
        b.chain_max_stacks = 10.0;
        b.special_kind = Some("energy".to_string());
        b
    }

    fn lightning_breath() -> SimpleBreathProfile {
        let mut b = default_breath();
        b.dps_pct = 3.0;
        b.capacity = 5.0;
        b.regen_rate = 12.0;
        b.crit_chance_pct = 50.0;
        b.chain = 25.0;
        b.chain_max_stacks = 5.0;
        b
    }

    fn huge_target(max_hp: f64) -> SimpleCombatantStats {
        let mut c = default_combatant();
        c.health = max_hp;
        c.damage = 0.0;
        c.bite_cooldown = 1000.0;
        c.health_regen = 0.0;
        c
    }

    /// Drive `breath` on side A under `policy` against a huge passive B,
    /// calling `tick_breath_side` every `tick_sec` from t=tick_sec..=max_time.
    /// A fire is detected by the capacity dropping (the drain step) across the
    /// tick. `setup_target` seeds B (e.g. Aerial Dodge).
    fn drive(
        breath: &SimpleBreathProfile,
        policy: SimpleBreathPolicyMode,
        setup_target: impl Fn(&mut CombatSide, &mut SimpleCombatantStats),
        max_time: f64,
    ) -> Vec<TickRec> {
        let atk = default_combatant();
        let mut def_stats = huge_target(1.0e16);
        let mut a = CombatSide::new(&atk, Some(breath));
        let mut b = CombatSide::new(&def_stats, None);
        setup_target(&mut b, &mut def_stats);
        let mut counters = DamageCounters::default();
        let mut log = Vec::new();
        let tick_sec = runtime_breath_tick_sec(&atk, breath);
        let mut recs = Vec::new();
        let mut t = tick_sec;
        while t <= max_time + 1e-9 {
            let cap_before = a.breath_capacity;
            tick_breath_side(
                t, &atk, &def_stats, breath, true, &mut a, &mut b, false, false, &mut counters,
                &mut log, false, "A", "B", policy,
            );
            recs.push(TickRec {
                fired: a.breath_capacity < cap_before - 1e-9,
                capacity: a.breath_capacity,
                chain: a.breath_chain,
            });
            t += tick_sec;
        }
        recs
    }

    fn steady_rate(recs: &[TickRec], tick_sec: f64, window_start: f64) -> f64 {
        // Fires per second measured over [window_start, end], excluding the
        // opening full-meter dump transient.
        let start_idx = (window_start / tick_sec).ceil() as usize;
        let fires = recs[start_idx..].iter().filter(|r| r.fired).count();
        let span = (recs.len() - start_idx) as f64 * tick_sec;
        fires as f64 / span
    }

    #[test]
    fn cadence_matches_two_over_one_plus_regen_rate() {
        set_breath_burst_model_override(Some(true));
        let cases = [energy_breath(), lightning_breath()];
        for breath in cases {
            let recs = drive(&breath, SimpleBreathPolicyMode::OnAvailability, |_, _| {}, 320.0);
            let rate = steady_rate(&recs, 0.5, 60.0);
            let expected = 2.0 / (1.0 + breath.regen_rate);
            assert!(
                (rate - expected).abs() <= expected * 0.15,
                "regen_rate={} steady cadence {rate:.4} hits/s must be ~{expected:.4} \
                 (2/(1+RegenRate))",
                breath.regen_rate
            );
        }
        set_breath_burst_model_override(None);
    }

    #[test]
    fn chain_resets_between_on_full_bar_bursts() {
        set_breath_burst_model_override(Some(true));
        let breath = energy_breath();
        let recs = drive(&breath, SimpleBreathPolicyMode::OnFullBar, |_, _| {}, 60.0);
        let chains: Vec<f64> = recs.iter().map(|r| r.chain).collect();
        // Burst 1 ramps the chain to the cap.
        let cap = breath.chain_max_stacks;
        let first_cap = chains
            .iter()
            .position(|&c| (c - cap).abs() < 1e-9)
            .expect("first burst must ramp the chain to its cap");
        // After the cap, the burst drains and the chain resets to 0 (Stop).
        let reset = chains[first_cap..]
            .iter()
            .position(|&c| c == 0.0)
            .map(|i| i + first_cap)
            .expect("chain must reset to 0 when the first burst stops");
        // A second burst starts after the meter recharges, ramping again.
        let second = chains[reset..]
            .iter()
            .any(|&c| c > 0.0);
        assert!(
            second,
            "a second burst must build the chain again after the reset: {chains:?}"
        );
    }

    #[test]
    fn dodged_tick_does_not_advance_chain() {
        set_breath_burst_model_override(Some(true));
        let breath = energy_breath();
        // All ticks dodge (aerial, 0% land): the breath still fires + drains,
        // but a dodged tick must never advance the chain.
        let recs = drive(
            &breath,
            SimpleBreathPolicyMode::OnFullBar,
            |side, stats| {
                stats.identity = Some(CreatureIdentity { is_aerial: true, ..Default::default() });
                stats.aerial_dodge_hit_chance_pct = 0.0;
                side.aerial_dodge_active = true;
            },
            10.0,
        );
        assert!(
            recs.iter().any(|r| r.fired),
            "the breath must have fired (drained fuel) so the dodge gate is exercised"
        );
        assert!(
            recs.iter().all(|r| r.chain == 0.0),
            "no chain advance on dodged ticks: {:?}",
            recs.iter().map(|r| r.chain).collect::<Vec<_>>()
        );

        // Control: with dodging off the same burst DOES ramp the chain.
        let control = drive(&breath, SimpleBreathPolicyMode::OnFullBar, |_, _| {}, 10.0);
        assert!(
            control.iter().any(|r| r.chain > 0.0),
            "sanity: the un-dodged burst must ramp the chain"
        );
        set_breath_burst_model_override(None);
    }

    #[test]
    fn capacity_kept_negative_after_a_burst() {
        set_breath_burst_model_override(Some(true));
        let breath = energy_breath();
        let recs = drive(&breath, SimpleBreathPolicyMode::OnAvailability, |_, _| {}, 40.0);
        let min_cap = recs.iter().map(|r| r.capacity).fold(f64::INFINITY, f64::min);
        assert!(
            min_cap < -1e-9,
            "the drain debt must push capacity strictly negative (no clamp): min={min_cap}"
        );
        set_breath_burst_model_override(None);
    }

    #[test]
    fn flag_off_ignores_breath_policy() {
        // With the burst model off, the per-side policy is inert: a chain-breath
        // matchup is byte-identical whether the config leaves the policy at its
        // default or forces OnFullBar. (Global proof that flag-off is unchanged
        // is the rest of the suite passing under the default flag.)
        set_breath_burst_model_override(Some(false));
        let attacker = default_combatant();
        let defender = huge_target(30_000.0);
        let breath = energy_breath();

        let default_cfg = ComposableAbilityConfig::default();
        let mut full_bar_cfg = ComposableAbilityConfig::default();
        full_bar_cfg.attacker_breath_policy = SimpleBreathPolicyMode::OnFullBar;
        full_bar_cfg.defender_breath_policy = SimpleBreathPolicyMode::OnFullBar;

        let run = |cfg: &ComposableAbilityConfig| {
            simulate_composable_matchup(
                &attacker,
                &defender,
                Some(&breath),
                None,
                SimpleAbilityTimingMode::Fast,
                cfg,
                120.0,
            )
        };
        let a = run(&default_cfg);
        let b = run(&full_bar_cfg);
        set_breath_burst_model_override(None);
        assert_eq!(a.final_hp_a.to_bits(), b.final_hp_a.to_bits());
        assert_eq!(a.final_hp_b.to_bits(), b.final_hp_b.to_bits());
    }

    #[test]
    fn burst_model_is_load_bearing() {
        // The flag must actually change chain-breath outcomes (otherwise the
        // whole rework is inert). Same matchup, flag off vs on.
        let attacker = default_combatant();
        let defender = huge_target(40_000.0);
        let breath = energy_breath();
        let cfg = ComposableAbilityConfig::default();
        let run = || {
            simulate_composable_matchup(
                &attacker,
                &defender,
                Some(&breath),
                None,
                SimpleAbilityTimingMode::Fast,
                &cfg,
                120.0,
            )
            .final_hp_b
        };
        set_breath_burst_model_override(Some(false));
        let off = run();
        set_breath_burst_model_override(Some(true));
        let on = run();
        set_breath_burst_model_override(None);
        assert!(
            (off - on).abs() > 1e-6,
            "burst model must change the defender's end HP (off={off}, on={on})"
        );
    }
}

#[cfg(test)]
mod ideal_breath_tests {
    use super::set_breath_burst_model_override;
    use crate::composable::config::{ComposableAbilityConfig, SimpleBreathPolicyMode};
    use crate::composable::reference_tests::{default_breath, default_combatant};
    use crate::composable::simulate_composable_matchup;
    use crate::contracts::{SimpleAbilityTimingMode, SimpleBreathProfile, SimpleCombatantStats};

    /// Chain-breath actor (side A): the breath is its main damage source, so
    /// the burst discipline drives whether - and how fast - it kills B.
    fn breather() -> SimpleCombatantStats {
        let mut c = default_combatant();
        c.health = 50_000.0;
        c.damage = 25.0;
        c.bite_cooldown = 1.5;
        c.health_regen = 0.0;
        c
    }

    /// Bite-only bruiser (side B): no breath, no policy-gated abilities, so an
    /// inner fork models it exactly (it just bites on cadence).
    fn bruiser() -> SimpleCombatantStats {
        let mut c = default_combatant();
        c.health = 12_000.0;
        c.damage = 150.0;
        c.bite_cooldown = 1.0;
        c.health_regen = 0.0;
        c
    }

    fn chain_breath() -> SimpleBreathProfile {
        let mut b = default_breath();
        b.dps_pct = 2.0;
        b.capacity = 3.0;
        b.regen_rate = 8.0;
        b.chain = 50.0;
        b.chain_max_stacks = 6.0;
        b
    }

    /// A's outcome under `policy` (burst model forced `on`), scored by the very
    /// `compute_replay_fitness` the Ideal search - and the brute-force
    /// optimizer - use: A's own end HP while it lives, plus a kill bonus once B
    /// dies. In this engine a slain side is pinned to 1 HP and keeps biting to
    /// `max_time`, so a chain breath's timing shows up in whether (and when) B
    /// dies rather than in A's raw HP - which the fitness captures exactly.
    fn actor_fitness(policy: SimpleBreathPolicyMode, max_time: f64) -> f64 {
        set_breath_burst_model_override(Some(true));
        let attacker = breather();
        let defender = bruiser();
        let breath = chain_breath();
        let mut cfg = ComposableAbilityConfig::default();
        cfg.attacker_breath_policy = policy;
        let s = simulate_composable_matchup(
            &attacker,
            &defender,
            Some(&breath),
            None,
            SimpleAbilityTimingMode::Fast,
            &cfg,
            max_time,
        );
        set_breath_burst_model_override(None);
        crate::composable::posture_policy::compute_replay_fitness(
            s.final_hp_a,
            s.final_hp_b,
            s.death_time_a,
            s.death_time_b,
            None,
            None,
            /* self_is_attacker */ true,
        )
    }

    #[test]
    fn ideal_is_no_worse_than_availability_or_full_bar() {
        let max_time = 150.0;
        let avail = actor_fitness(SimpleBreathPolicyMode::OnAvailability, max_time);
        let full = actor_fitness(SimpleBreathPolicyMode::OnFullBar, max_time);
        let ideal = actor_fitness(SimpleBreathPolicyMode::Ideal, max_time);

        eprintln!("ideal breath fitness: availability={avail:.1}, full_bar={full:.1}, ideal={ideal:.1}");

        // The Ideal search picks the burst timing that maximizes A's own fitness,
        // enumerating candidates that include "open now" (availability) and
        // "charge to full" (full bar). Within the bounded-replay resolution it
        // must therefore be no worse than either shipped discipline; the
        // tolerance absorbs one regen tick of projection slack at the window
        // edge (mirrors the Fortify rollout's fitness-margin guard).
        let tol = 100.0;
        assert!(
            ideal + tol >= avail,
            "Ideal ({ideal:.1}) must not trail availability ({avail:.1}) by more than {tol}"
        );
        assert!(
            ideal + tol >= full,
            "Ideal ({ideal:.1}) must not trail full-bar ({full:.1}) by more than {tol}"
        );
    }

    #[test]
    fn ideal_diverges_from_availability() {
        // If the search were inert (Ideal == availability everywhere) the
        // no-worse invariant above would pass vacuously. Prove the burst-timing
        // choice actually moves the outcome on this matchup.
        let max_time = 150.0;
        let avail = actor_fitness(SimpleBreathPolicyMode::OnAvailability, max_time);
        let ideal = actor_fitness(SimpleBreathPolicyMode::Ideal, max_time);
        assert!(
            (avail - ideal).abs() > 1e-6,
            "Ideal must diverge from availability on at least one matchup \
             (availability={avail:.3}, ideal={ideal:.3})"
        );
    }

    #[test]
    fn flag_off_ideal_is_byte_identical_to_default() {
        // With the burst model off the per-side policy is inert: an Ideal
        // config must be byte-identical to the default (availability) config,
        // and neither may run the search.
        set_breath_burst_model_override(Some(false));
        let attacker = breather();
        let defender = bruiser();
        let breath = chain_breath();

        let default_cfg = ComposableAbilityConfig::default();
        let mut ideal_cfg = ComposableAbilityConfig::default();
        ideal_cfg.attacker_breath_policy = SimpleBreathPolicyMode::Ideal;
        ideal_cfg.defender_breath_policy = SimpleBreathPolicyMode::Ideal;

        let run_cfg = |cfg: &ComposableAbilityConfig| {
            simulate_composable_matchup(
                &attacker,
                &defender,
                Some(&breath),
                None,
                SimpleAbilityTimingMode::Fast,
                cfg,
                90.0,
            )
        };
        let a = run_cfg(&default_cfg);
        let b = run_cfg(&ideal_cfg);
        set_breath_burst_model_override(None);
        assert_eq!(a.final_hp_a.to_bits(), b.final_hp_a.to_bits());
        assert_eq!(a.final_hp_b.to_bits(), b.final_hp_b.to_bits());
    }
}
