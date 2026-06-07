//! Composable combat simulation engine - the unified event-loop driver.
//!
//! A single event loop with modular ability handlers, replacing the bespoke
//! contour architecture (breath.rs, life_leech_breath.rs, etc.).
//!
//! Architecture:
//!   CombatSide  - per-side mutable state (HP, timers, breath, statuses, hunker, etc.)
//!   ComposableAbilityConfig - which activated abilities each side has
//!   simulate_composable_matchup - the unified event loop
//!
//! The event loop follows the same phase ordering as breath.rs (the most mature contour)
//! with ability-specific hooks at each phase. Abilities are enabled/disabled via config
//! flags - disabled abilities are zero-cost (branch prediction).

mod abilities;
mod breath;
mod config;
pub(crate) mod posture;
pub mod posture_policy;
pub(crate) mod policy_bridge;
pub(crate) mod user_dispatch;
pub(crate) mod user_status_dispatch;
mod side;
mod status_helpers;
mod phases;
mod setup;
mod loop_iter;
mod stance_bridge;
mod bite_variant_bridge;
pub mod ability_metadata;
pub mod sandbox;
pub(crate) mod actives {}

// Phase processor functions (`process_phase_*`) live in `phases.rs`.
// The glob-import below is test-only: phase_tests.rs reaches these via
// `use super::*`. Non-test callers (loop_iter.rs) import directly from
// the phases sub-module. All items are `pub(super)` - visibility is
// unchanged from the pre-split single-file layout.
#[cfg(test)]
use phases::*;

pub use config::{CombatEventPhase, ComposableAbilityConfig};
pub use side::CombatSide;

use abilities::{
    apply_lich_mark_on_melee_hit, apply_yolk_bomb, LICH_MARK_ARMED_WINDOW_SEC,
    LICH_MARK_COOLDOWN_SEC,
};
use breath::{runtime_breath_capacity_step, runtime_breath_tick_sec, tick_breath_side};
use status_helpers::{
    advance_side_hunger, apply_status_delta, apply_statuses_with_per_effect_trace,
    apply_statuses_with_trace, emit_status_decay_log, format_stacks, format_status_label,
    record_ability_event,
};

use std::collections::BTreeMap;

use crate::active_runtime::{
    scale_active_cooldown,
};
use crate::compare_hunger;
use crate::actives::{
    apply_hunker_to_damage, apply_hunker_to_incoming, apply_simple_fortify,
    hunker_decision_cadence_reached, is_hunker_effect_active, resolve_hunker_effect_starts_at,
    simulate_simple_life_leech_hit, trigger_self_destruct_explosion,
    update_simple_self_destruct_state, SelfDestructEvent,
};
use crate::combat::{
    effective_hp_regen_multiplier_with_actives, is_external_healing_blocked, is_regen_tick_due,
};
use crate::abilities::rewind_breath::{
    apply_rewind_restoration, record_rewind_snapshot, rewind_snapshot_deltas,
};

const WARDEN_RAGE_TAP_SEC: f64 = 0.25;
use crate::combat::{
    compute_melee_damage_per_hit_with_actor_and_target_statuses,
    compute_simple_breath_damage_with_actor_and_target_statuses,
    compute_simple_breath_extended_damage, compute_simple_reflected_breath_damage,
    compute_simple_reflected_melee_damage, current_simple_bite_cooldown_with_statuses,
    handle_simple_regen_with_statuses, scale_direct_attack_offensive_ailment_statuses,
    wardens_rage_multiplier, wardens_rage_stacks_from_hp_ratio,
};
use crate::contracts::{
    apply_disabled_abilities, resolve_ability_policy, BestBuildsMatchupSummary,
    SimpleAbilityTimingMode, SimpleAppliedStatus, SimpleBreathProfile, SimpleCombatantStats,
    SimpleStatusInstance,
};
use crate::statuses::{
    apply_incoming_statuses_to_target, apply_incoming_statuses_to_target_with_fortify_immunity,
    apply_simple_status_list, handle_simple_dot_ticks_with_log_and_cap,
    is_actives_disabled_by_necro,
    next_status_decay_at, next_status_tick_at,
    update_simple_status_durations,
    StatusDecayLogEntry,
    WARDEN_RESISTANCE_HP_RATIO_THRESHOLD,
};
// Test-only re-exports: tests.rs reaches these via `use super::*`.
#[cfg(test)]
use status_helpers::sweep_first_ailment_tick;

pub(super) const AURA_TICK_SEC: f64 = 3.0;
const AURA_AILMENT_STACKS: f64 = 3.0;

/// Translate the policy's chosen action into the corresponding
/// `request_posture_transition` call. Stay is a no-op (covers both
/// "stay standing" and "stay in flight to my current pending posture"
/// - the request fn is idempotent on same-pending requests).
pub(super) fn apply_policy_action(
    side: &mut crate::composable::side::CombatSide,
    action: crate::composable::posture_policy::PostureAction,
    time: f64,
    combat_log: &mut Vec<crate::contracts::CombatLogEntry>,
    record_trace: bool,
    side_label: &str,
) {
    use crate::composable::posture::{request_posture_transition, Posture};
    use crate::composable::posture_policy::PostureAction;
    match action {
        PostureAction::Stay => {} // no-op
        PostureAction::StartSit => {
            request_posture_transition(side, Posture::Sitting, time, combat_log, record_trace, side_label);
        }
        PostureAction::StartLay => {
            request_posture_transition(side, Posture::Laying, time, combat_log, record_trace, side_label);
        }
        PostureAction::StandUp => {
            request_posture_transition(side, Posture::Standing, time, combat_log, record_trace, side_label);
        }
    }
}

/// Advance `posture_next_decision_at` after a policy evaluation. The
/// next decision fires `DECISION_PERIODIC_SEC` from now by default; in
/// RegenAware mode we ALSO check whether an upcoming regen tick is
/// close enough that a Standing → Laying transition (2 s) could land
/// the side in Laying just in time for the tick. If so, the next
/// decision fires `REGEN_LEAD_SEC` (2 s) before that tick so the
/// policy can request the lay-down at the optimal moment.
pub(super) fn schedule_next_posture_decision(
    side: &mut crate::composable::side::CombatSide,
    stats: &crate::contracts::SimpleCombatantStats,
    time: f64,
    _regen_aware: bool,
) {
    // Schedule the next decision moment. Always considers pre-tick
    // and post-tick moments alongside the periodic cadence.
    //
    // History (2026-05-22): the `regen_aware` flag previously gated
    // pre/post-tick scheduling. With it false (the serde-default for
    // `posture_policy_regen_aware`), the policy fired only on the
    // periodic 5 s cadence - which structurally misses the narrow
    // pre-tick window where settled-Lay must be set up. Real users
    // got the unaware default and effectively no posture-policy
    // benefit. Bench scenarios 9 / 11 captured this case (defender
    // regen-unaware) at 0-29 % vs an ideal that brute-force WAS
    // allowed to reach pre-tick moments at. The fix surfaces the
    // pre-tick decision unconditionally so the live policy can
    // realise it. The `regen_aware` flag is kept on the config
    // struct for backwards-compat serde wiring; the parameter to
    // this function is now ignored (`_regen_aware`).
    // Strict 5-s decision grid anchored on t=0: 5, 10, 15, 20, 25, ...
    // rather than `time + 5` (sliding from previous decision). Drift
    // history: with `time + 5`, a decision firing at t=5.6 (because
    // first scheduler-event lands there) sets next=10.6. State.time
    // advances to t=10 (Spirit Glare breath tick) without firing the
    // policy (10 < 10.6), then to t=11.2 (next bite). The strict-grid
    // moment t=10 - which brute-force's benchmark schedule DOES use
    // - was missed. Strict grid removes the drift.
    //
    // Tick-boundary skip: a strict-grid moment that lands within 0.5
    // s of `next_regen` would fire the policy AT the tick boundary,
    // before the tick's Regen phase processes. A Stand@tick decision
    // would then put the side back to Standing BEFORE the tick,
    // throwing away the ×2 settled-Lay regen bonus the policy
    // arranged. Skip such conflicting periodic moments; the post-
    // tick decision (next_regen + ε) handles "stand up after the
    // tick" instead.
    let cadence = crate::composable::posture_policy::DECISION_PERIODIC_SEC;
    let mut periodic_next = ((time / cadence).floor() + 1.0) * cadence;
    if side.next_regen.is_finite() {
        while (periodic_next - side.next_regen).abs() < 0.5 {
            periodic_next += cadence;
        }
    }
    let mut next = periodic_next;
    if stats.health_regen > 0.0 && side.next_regen.is_finite() {
        // 2.0 = REGEN_LEAD_SEC (private to posture_policy).
        let regen_lead_sec = 2.0;
        let regen_pre_tick = side.next_regen - regen_lead_sec;
        if regen_pre_tick > time + 1e-9 && regen_pre_tick < next {
            next = regen_pre_tick;
        }
        // Post-tick decision: lets the policy stand the side up
        // immediately after capturing the ×2 / ×1.5 regen bonus,
        // before the ×1.75 settled-state incoming-damage penalty
        // accumulates past the next periodic decision (up to 5 s
        // wasted).
        let regen_post_tick = side.next_regen + 1e-6;
        if regen_post_tick > time + 1e-9 && regen_post_tick < next {
            next = regen_post_tick;
        }
    }
    side.posture_next_decision_at = next;
}

/// Map an aura subtype name to its ailment status id. Adding a new subtype
/// here is the only change required to support a new "Aura (X)" ability,
/// provided the matching status already exists in the catalog.
pub(super) fn aura_status_id(subtype: &str) -> Option<&'static str> {
    match subtype {
        "Disease" => Some("Disease_Status"),
        "Corrosion" => Some("Corrosion_Status"),
        "Burn" => Some("Burn_Status"),
        _ => None,
    }
}
// Healing Step (Reference: referenceContent.ts, TS: subsystems/timing.ts):
//   HEALING_STEP_TICK_SEC = 3, HEALING_STEP_THRESHOLD_HP_FRACTION = 0.65.
// Gated by Trails compare-only toggle in TS; in Rust the per-side value (0.0 =
// disabled) serves both as the flag and the heal percent.
pub(super) const HEALING_STEP_TICK_SEC: f64 = 3.0;
const HEALING_STEP_THRESHOLD_HP_FRACTION: f64 = 0.65;
// Healing Pulse / Healing Ailment (Compare-only disputed ability + status).
// Reference: COMPARE_ONLY_REFERENCE_DRAFTS "Healing Pulse" + STATUS_REFERENCE_DRAFTS "Healing Ailment".
// Each cast of Healing Pulse applies 10 stacks of Healing_Ailment (1 stack = 3s duration).
// Healing Ailment ticks every 15s while stacks > 0, healing +7% max HP flat per tick.
// Bypasses bleed/burn regen-disable (applied as direct heal, not a regen modifier).
const HEALING_PULSE_COOLDOWN_SEC: f64 = 90.0;
const HEALING_PULSE_STACKS_PER_CAST: f64 = 10.0;
const HEALING_AILMENT_TICK_SEC: f64 = 15.0;
const HEALING_AILMENT_HEAL_PCT_PER_TICK: f64 = 7.0;
// Expunge (Compare-only disputed active). See COMPARE_ONLY_REFERENCE_DRAFTS
// "Expunge". Consumes all Bleed stacks on the target at bite time; bonus
// damage = D_normal × 0.05 × bleed (post-hoc); heal = 0.5 × baseAttack × 0.05
// × bleed flat HP. Ideal policy fires only when target's Bleed ≥ threshold.
const EXPUNGE_COOLDOWN_SEC: f64 = 45.0;
const EXPUNGE_DAMAGE_PER_STACK: f64 = 0.05;
const EXPUNGE_HEAL_FRACTION_OF_BONUS: f64 = 0.5;
const EXPUNGE_HEAL_SAVE_SAFETY_RATIO: f64 = 0.05;
// Damage trails family (Flame/Frost/Plague/Toxic Trail):
//   DAMAGE_TRAIL_TICK_SEC = 1, damage per active trail = 2% opponent max HP,
//   plus 2 stacks of the trail's status (Flame→Burn, Frost→Frostbite,
//   Plague→Disease, Toxic→Poison). Threshold normalization matches TS
//   normalizeTrailThresholdFraction: value > 1 → value/100 else raw.
pub(super) const DAMAGE_TRAIL_TICK_SEC: f64 = 1.0;
const DAMAGE_TRAIL_DAMAGE_FRACTION: f64 = 0.02;
const DAMAGE_TRAIL_STATUS_STACKS: f64 = 2.0;
const FROST_NOVA_TICK_SEC: f64 = 3.0;
const FROST_NOVA_ACTIVE_DURATION: f64 = 15.0;
const FROST_NOVA_COOLDOWN: f64 = 60.0;
const EVENT_TIME_EPS: f64 = 1e-9;

use setup::populate_combat_sides_and_flags;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum OrderedEventPhase {
    StatusTicks,
    StatusDecay,
    Regen,
    Bite,
    Breath,
    ActiveAbilities,
}

// Default mirrors the pre-da525db monolithic source order:
//   Phase 3 (StatusDecay) → Phase 3b-4q (ActiveAbilities) → Phase 5 (Regen) →
//   Phase 8 (Bite) → Phase 12 (StatusTicks DOT) → Phase 14 (Breath).
// Phase 7 (Self-Destruct) is now a passive (runs every iter, not via this list).
const DEFAULT_ORDERED_EVENT_PHASES: [OrderedEventPhase; 6] = [
    OrderedEventPhase::StatusDecay,
    OrderedEventPhase::ActiveAbilities,
    OrderedEventPhase::Regen,
    OrderedEventPhase::Bite,
    OrderedEventPhase::StatusTicks,
    OrderedEventPhase::Breath,
];

fn event_phase_bit(phase: OrderedEventPhase) -> u32 {
    match phase {
        OrderedEventPhase::StatusTicks => 1 << 0,
        OrderedEventPhase::StatusDecay => 1 << 1,
        OrderedEventPhase::Regen => 1 << 2,
        OrderedEventPhase::Bite => 1 << 3,
        OrderedEventPhase::Breath => 1 << 4,
        OrderedEventPhase::ActiveAbilities => 1 << 5,
    }
}

fn map_config_event_phase(phase: CombatEventPhase) -> Option<OrderedEventPhase> {
    match phase {
        CombatEventPhase::Passives => None,
        CombatEventPhase::StatusTicks => Some(OrderedEventPhase::StatusTicks),
        CombatEventPhase::StatusDecay => Some(OrderedEventPhase::StatusDecay),
        CombatEventPhase::Regen => Some(OrderedEventPhase::Regen),
        CombatEventPhase::Bite => Some(OrderedEventPhase::Bite),
        CombatEventPhase::Breath => Some(OrderedEventPhase::Breath),
        CombatEventPhase::ActiveAbilities => Some(OrderedEventPhase::ActiveAbilities),
    }
}

fn normalize_ordered_event_phases(config_order: &[CombatEventPhase]) -> Vec<OrderedEventPhase> {
    let mut out = Vec::with_capacity(DEFAULT_ORDERED_EVENT_PHASES.len());
    let mut seen = 0u32;
    for phase in config_order.iter().filter_map(|phase| map_config_event_phase(*phase)) {
        let bit = event_phase_bit(phase);
        if seen & bit == 0 {
            seen |= bit;
            out.push(phase);
        }
    }
    for phase in DEFAULT_ORDERED_EVENT_PHASES {
        let bit = event_phase_bit(phase);
        if seen & bit == 0 {
            seen |= bit;
            out.push(phase);
        }
    }
    out
}

fn is_event_due_at(value: f64, time: f64) -> bool {
    value.is_finite() && (value - time).abs() <= EVENT_TIME_EPS
}

fn select_ordered_event_phase(
    event_phase_order: &[OrderedEventPhase],
    due_mask: u32,
    processed_mask: u32,
) -> Option<OrderedEventPhase> {
    let available = due_mask & !processed_mask;
    event_phase_order
        .iter()
        .copied()
        .find(|phase| available & event_phase_bit(*phase) != 0)
}

/// Test-side hooks for forcing Fortify activation at a specific
/// simulation time on a given side. Used by `simulate_composable_matchup_with_trace_control`
/// for fixture-driven scenario testing. Production callers leave
/// both fields at `None`.
#[derive(Clone, Copy, Debug, Default)]
pub(crate) struct FortifySimulationControl {
    pub(crate) attacker_forced_fortify_at: Option<f64>,
    pub(crate) defender_forced_fortify_at: Option<f64>,
}

// ---------------------------------------------------------------------------
// Helper functions (shared with `composable::breath` and the extracted
// phase fns above the driver).
// ---------------------------------------------------------------------------

/// Normalize the raw effects_catalog `value` for a damage trail into a
/// threshold fraction (matches TS normalizeTrailThresholdFraction).
/// Values > 1 are treated as percent (e.g. 50 → 0.5); otherwise taken as-is.
/// Returns None for zero/invalid values.
fn normalize_trail_threshold_fraction(value: f64) -> Option<f64> {
    if !value.is_finite() || value <= 0.0 {
        return None;
    }
    Some(if value > 1.0 { value / 100.0 } else { value })
}

fn is_damage_trail_active(owner_hp: f64, owner_max_hp: f64, value: f64) -> bool {
    if owner_max_hp <= 0.0 {
        return false;
    }
    match normalize_trail_threshold_fraction(value) {
        Some(threshold) => owner_hp / owner_max_hp <= threshold + 1e-9,
        None => false,
    }
}

/// Healing Step is active while the owner's HP is at or below 65% of max HP
/// AND `value` (heal % per tick) is non-zero. Mirrors TS `isHealingStepActive`
/// in `specialEventsRuntime.ts:410-415`.
fn is_healing_step_active_for_owner(owner_hp: f64, owner_max_hp: f64, value: f64) -> bool {
    if value <= 0.0 || owner_max_hp <= 0.0 {
        return false;
    }
    owner_hp / owner_max_hp <= HEALING_STEP_THRESHOLD_HP_FRACTION + 1e-9
}

/// True when the owner has at least one trail (Flame/Frost/Plague/Toxic) or
/// Healing Step ability that is currently meeting its HP-threshold gate.
/// Used to drive `trails_facetank_override_active`. Mirrors the
/// `anyActive = activeDamageTrails.length > 0 || healingActive` calculation
/// in TS `updateTrails` (`specialEventsRuntime.ts:460-462`).
fn any_trail_or_step_active_for_side(
    owner_hp: f64,
    owner_max_hp: f64,
    flame_value: f64,
    frost_value: f64,
    plague_value: f64,
    toxic_value: f64,
    healing_step_value: f64,
) -> bool {
    is_damage_trail_active(owner_hp, owner_max_hp, flame_value)
        || is_damage_trail_active(owner_hp, owner_max_hp, frost_value)
        || is_damage_trail_active(owner_hp, owner_max_hp, plague_value)
        || is_damage_trail_active(owner_hp, owner_max_hp, toxic_value)
        || is_healing_step_active_for_owner(owner_hp, owner_max_hp, healing_step_value)
}

/// Effective `block_persistent_decay` for a side at the current tick.
///
/// Encoding chain:
/// - Rust `block_persistent_decay = !state.compareNoMoveFacetank` (TS).
/// - Reference (`compare_no_move_facetank`): "When [No Move Facetank] is
///   disabled, Poison, Burn, Bleed, Corrosion, Necropoison, and Frostbite
///   stop naturally decaying."
///   ⇒ NMF disabled (=false) → block=true → decay stops.
/// - Reference (each trail / `ability_healing_step`): "While any of the
///   owner's trail or step abilities is active, No Move Facetank is
///   automatically overridden off."
///   ⇒ override active → NMF=false → block=true → decay stops.
///
/// So override-active ⇒ block=true; else use config_value.
fn effective_block_persistent_decay(
    side: &CombatSide,
    config_value: bool,
) -> bool {
    side.trails_facetank_override_active || config_value
}

fn conditional_berserk_active(side: &CombatSide, stats: &SimpleCombatantStats) -> bool {
    stats.berserk_hp_ratio_threshold > 0.0
        && stats.berserk_bite_cooldown_multiplier > 0.0
        && (side.hp / stats.health.max(1.0)) < stats.berserk_hp_ratio_threshold
}

fn conditional_first_strike_active(side: &CombatSide, stats: &SimpleCombatantStats) -> bool {
    stats.first_strike_pct > 0.0
        && (side.hp / stats.health.max(1.0)) >= stats.first_strike_hp_ratio_threshold
}

fn conditional_warden_resistance_active(side: &CombatSide, stats: &SimpleCombatantStats) -> bool {
    stats.has_warden_resistance
        && (side.hp / stats.health.max(1.0)) <= WARDEN_RESISTANCE_HP_RATIO_THRESHOLD
}

fn push_conditional_passive_event(
    combat_log: &mut Vec<crate::contracts::CombatLogEntry>,
    record_trace: bool,
    time: f64,
    side_label: &str,
    side_hp: f64,
    name: &str,
    active: bool,
) {
    if !record_trace {
        return;
    }
    let hp_after = side_hp.max(0.0);
    combat_log.push(crate::contracts::CombatLogEntry {
        time,
        entry_type: "ability".to_string(),
        attacker: side_label.to_string(),
        damage: 0.0,
        healing: None,
        actor_hp_after: hp_after,
        hp_side: side_label.to_string(),
        hp_after,
        description: Some(format!(
            "{} {}",
            name,
            if active { "activated" } else { "deactivated" }
        )),
        detail: None,
        status_id: None,
    });
}

fn breath_heal_description(breath: &SimpleBreathProfile) -> Option<&'static str> {
    match breath.special_kind.as_deref() {
        Some("heal") => Some("Heal Breath heal"),
        Some("cloud") => Some("Cloud Breath heal"),
        Some("miasma") => Some("Miasma Breath heal"),
        _ => None,
    }
}

fn push_breath_heal_log(
    combat_log: &mut Vec<crate::contracts::CombatLogEntry>,
    time: f64,
    side_label: &str,
    hp_before: f64,
    hp_after: f64,
    breath: &SimpleBreathProfile,
) {
    let healed = (hp_after - hp_before).max(0.0);
    if healed <= 0.0 {
        return;
    }
    let Some(description) = breath_heal_description(breath) else {
        return;
    };
    let hp_after = hp_after.max(0.0);
    // Logged as "breath" so Compare's Breath Time counts heal-only
    // breaths (Heal Breath) and the heal half of damage+heal breaths
    // (Cloud, Miasma). Compare derives Breath Time from unique
    // timestamps of breath-typed entries, so logging both damage and
    // heal halves of a single tick at the same time is collapsed
    // into one tick and doesn't double-count.
    combat_log.push(crate::contracts::CombatLogEntry {
        time,
        entry_type: "breath".to_string(),
        attacker: side_label.to_string(),
        damage: 0.0,
        healing: Some(healed),
        actor_hp_after: hp_after,
        hp_side: side_label.to_string(),
        hp_after,
        description: Some(description.to_string()),
        detail: None,
        status_id: None,
    });
}

fn sync_conditional_passive_events(
    side: &mut CombatSide,
    stats: &SimpleCombatantStats,
    side_label: &str,
    combat_log: &mut Vec<crate::contracts::CombatLogEntry>,
    record_trace: bool,
    time: f64,
) {
    let first_strike_active = conditional_first_strike_active(side, stats);
    if first_strike_active != side.first_strike_active_logged {
        side.first_strike_active_logged = first_strike_active;
        push_conditional_passive_event(
            combat_log,
            record_trace,
            time,
            side_label,
            side.hp,
            "First Strike",
            first_strike_active,
        );
    }

    let warden_resistance_active = conditional_warden_resistance_active(side, stats);
    if warden_resistance_active != side.warden_resistance_active_logged {
        side.warden_resistance_active_logged = warden_resistance_active;
        push_conditional_passive_event(
            combat_log,
            record_trace,
            time,
            side_label,
            side.hp,
            "Warden's Resistance",
            warden_resistance_active,
        );
    }

    let berserk_active = conditional_berserk_active(side, stats);
    if berserk_active != side.berserk_active_logged {
        side.berserk_active_logged = berserk_active;
        push_conditional_passive_event(
            combat_log,
            record_trace,
            time,
            side_label,
            side.hp,
            "Berserk",
            berserk_active,
        );
    }
}



#[derive(Debug, Default, Clone, Copy)]
pub(crate) struct DamageCounters {
    pub dealt_a: f64,
    pub dealt_b: f64,
    pub dealt_a_at_b_death: f64,
    pub dealt_b_at_a_death: f64,
}

pub(super) use crate::combat::apply_unbreakable_damage_cap;

pub(super) fn apply_hunters_curse_self_cost(hp: f64, stats: &SimpleCombatantStats) -> f64 {
    let raw_cost = stats.health.max(0.0) * 0.5;
    let cost = apply_unbreakable_damage_cap(raw_cost, stats);
    (hp - cost).max(1.0)
}

/// Returns the reflected damage amount (0.0 if no reflect fired). Callers
/// can use this to emit a combat log entry when tracing.
#[allow(clippy::too_many_arguments)]
pub(super) fn apply_direct_damage_with_reflect(
    received_damage: f64,
    source_is_a: bool,
    is_breath: bool,
    source_stats: &SimpleCombatantStats,
    target_stats: &SimpleCombatantStats,
    source_statuses: &BTreeMap<String, SimpleStatusInstance>,
    target_statuses: &BTreeMap<String, SimpleStatusInstance>,
    hp_source: &mut f64,
    hp_target: &mut f64,
    counters: &mut DamageCounters,
    target_hunker_active: bool,
) -> f64 {
    let attempted_damage =
        apply_unbreakable_damage_cap(received_damage, target_stats).min((*hp_target).max(0.0));
    if attempted_damage <= 0.0 {
        return 0.0;
    }
    if target_stats.has_reflect {
        let reflected_damage_raw = if is_breath {
            compute_simple_reflected_breath_damage(
                attempted_damage,
                target_stats,
                source_stats,
                target_statuses,
                source_statuses,
            )
        } else {
            compute_simple_reflected_melee_damage(
                attempted_damage,
                target_stats,
                source_stats,
                target_statuses,
                source_statuses,
            )
        };
        let reflected_damage = apply_unbreakable_damage_cap(reflected_damage_raw, source_stats)
            .min((*hp_source).max(0.0));
        *hp_source -= reflected_damage;
        if source_is_a {
            counters.dealt_b += reflected_damage;
        } else {
            counters.dealt_a += reflected_damage;
        }
        reflected_damage
    } else {
        *hp_target -= attempted_damage;
        if source_is_a {
            counters.dealt_a += attempted_damage;
        } else {
            counters.dealt_b += attempted_damage;
        }
        // Knight plushie: reflect % of damage back to attacker. Wiki:
        // "as long as the defender is not using hunker" - fully blocked when
        // defender hunkers, regardless of hunker reduction percentage.
        let pct = target_stats.plushie_reflect_avg_pct;
        if pct > 0.0 && !target_hunker_active {
            let reflect = apply_unbreakable_damage_cap(attempted_damage * pct / 100.0, source_stats)
                .min((*hp_source).max(0.0));
            if reflect > 0.0 {
                *hp_source -= reflect;
            }
        }
        0.0
    }
}

fn projection_dummy_target(defender: &SimpleCombatantStats) -> SimpleCombatantStats {
    let mut stripped = defender.clone();
    stripped.breath_resistance = 0.0;
    stripped.has_warden_resistance = false;
    stripped.immune_status_ids.clear();
    stripped.hunker_reduction_pct = 0.0;
    stripped.self_destruct_profile = None;
    stripped.on_hit_statuses.clear();
    stripped.on_hit_taken_statuses.clear();
    stripped.starting_statuses.clear();
    stripped.status_resist_fractions.clear();
    stripped.plushie_status_block_fractions.clear();
    stripped
}


// ---------------------------------------------------------------------------
// Extended damage projection (status-aware)
// ---------------------------------------------------------------------------

/// Whether the side currently has first-strike state active. Mirrors
/// the gate in `combat::compute_melee_damage_per_hit` - if
/// `first_strike_pct > 0` AND `hp_ratio >= first_strike_hp_ratio_threshold`,
/// first-strike is active. Used by user-ability `on_first_strike`
/// triggers to detect transitions across iterations.
pub(super) fn compute_first_strike_active(stats: &SimpleCombatantStats, hp: f64) -> bool {
    if stats.first_strike_pct <= 0.0 {
        return false;
    }
    let max = stats.health.max(1.0);
    let hp_ratio = (hp / max).clamp(0.0, 1.0);
    hp_ratio >= stats.first_strike_hp_ratio_threshold
}

#[allow(clippy::too_many_arguments)]
fn compute_status_aware_breath_extended_damage(
    attacker: &SimpleCombatantStats,
    defender: &SimpleCombatantStats,
    attacker_breath: Option<&SimpleBreathProfile>,
    current_time: f64,
    starting_hp: f64,
    starting_statuses_a: &BTreeMap<String, SimpleStatusInstance>,
    next_hit_at: f64,
    next_breath_at: f64,
    current_breath_capacity: f64,
    breath_regen_at: f64,
    initial_chain_stacks: f64,
    next_regen_at: f64,
) -> f64 {
    let extra_max_sec = 30.0_f64;
    let horizon_end = current_time + extra_max_sec;
    let mut time = current_time;
    let mut hp_a = starting_hp.max(0.0);
    let mut hp_b = 1.0e9_f64;
    let mut statuses_a = starting_statuses_a.clone();
    let mut statuses_b: BTreeMap<String, SimpleStatusInstance> = BTreeMap::new();
    let mut next_hit = if next_hit_at.is_finite() && next_hit_at > current_time {
        next_hit_at
    } else {
        current_time + current_simple_bite_cooldown_with_statuses(attacker, hp_a, &statuses_a)
    };
    let mut next_breath = next_breath_at;
    let mut next_breath_regen = breath_regen_at;
    let mut next_regen = next_regen_at;
    let mut breath_capacity = current_breath_capacity.max(0.0);
    let mut breath_chain = initial_chain_stacks.max(0.0);
    let mut total = 0.0_f64;
    let mut next_status_tick_a = next_status_tick_at(&statuses_a);
    let mut next_status_tick_b = next_status_tick_at(&statuses_b);

    while time <= horizon_end && hp_a > 0.0 {
        let next_time = next_hit
            .min(next_breath)
            .min(next_breath_regen)
            .min(next_regen)
            .min(next_status_tick_a)
            .min(next_status_tick_b);
        if !next_time.is_finite() || next_time > horizon_end {
            break;
        }
        if next_time <= time {
            time += 0.001;
            continue;
        }
        time = next_time;

        update_simple_status_durations(time, &mut statuses_a);
        update_simple_status_durations(time, &mut statuses_b);
        next_status_tick_a = next_status_tick_at(&statuses_a);
        next_status_tick_b = next_status_tick_at(&statuses_b);

        handle_simple_regen_with_statuses(time, attacker, &mut hp_a, &mut next_regen, &statuses_a);

        if (next_hit - time).abs() <= 1e-9 {
            let damage = compute_melee_damage_per_hit_with_actor_and_target_statuses(
                attacker,
                defender,
                hp_a,
                &statuses_a,
                &statuses_b,
            );
            let applied = apply_unbreakable_damage_cap(damage, defender).min(hp_b.max(0.0));
            hp_b -= applied;
            if applied > 0.0 {
                total += applied;
            }
            next_hit =
                time + current_simple_bite_cooldown_with_statuses(attacker, hp_a, &statuses_a);
        }

        if (next_breath_regen - time).abs() <= 1e-9 {
            if let Some(breath) = attacker_breath {
                let max_capacity = breath.capacity.max(0.0);
                if max_capacity > 0.0 {
                    breath_capacity = (breath_capacity
                        + runtime_breath_capacity_step(attacker, breath))
                    .min(max_capacity);
                    next_breath_regen = if breath_capacity >= max_capacity {
                        f64::INFINITY
                    } else {
                        time + breath.regen_rate.max(0.0)
                    };
                    next_breath = if breath_capacity > 0.0 {
                        time + runtime_breath_tick_sec(attacker, breath)
                    } else {
                        f64::INFINITY
                    };
                }
            }
        }

        if (next_breath - time).abs() <= 1e-9 {
            if let Some(breath) = attacker_breath {
                if breath_capacity > 0.0 {
                    if !matches!(breath.special_kind.as_deref(), Some("heal") | Some("cloud")) {
                        let damage = compute_simple_breath_damage_with_actor_and_target_statuses(
                            attacker,
                            defender,
                            breath,
                            &mut breath_chain,
                            &statuses_a,
                            &statuses_b,
                        );
                        let applied =
                            apply_unbreakable_damage_cap(damage, defender).min(hp_b.max(0.0));
                        hp_b -= applied;
                        if applied > 0.0 {
                            total += applied;
                        }
                        if !breath.special_statuses.is_empty() {
                            apply_incoming_statuses_to_target(
                                time,
                                defender,
                                hp_b,
                                &mut statuses_b,
                                &breath.special_statuses,
                            );
                            next_status_tick_b = next_status_tick_at(&statuses_b);
                        }
                    }
                    breath_capacity = (breath_capacity
                        - runtime_breath_capacity_step(attacker, breath))
                    .max(0.0);
                    if breath_capacity <= 0.0 {
                        next_breath_regen = if matches!(
                            breath.special_kind.as_deref(),
                            Some("solar_beam") | Some("spirit_glare")
                        ) {
                            time + breath.auto_fire_cooldown_sec.max(120.0)
                        } else {
                            time + breath.regen_rate.max(0.0)
                        };
                    }
                    next_breath = time + runtime_breath_tick_sec(attacker, breath);
                } else {
                    next_breath = time + runtime_breath_tick_sec(attacker, breath);
                }
            } else {
                next_breath = f64::INFINITY;
            }
        }

        if !statuses_a.is_empty() {
            let mut ignored_damage = 0.0_f64;
            let side_effects = handle_simple_dot_ticks_with_log_and_cap(
                time,
                attacker.health,
                attacker.unbreakable_damage_cap_pct,
                &mut hp_a,
                &mut statuses_a,
                &mut ignored_damage,
                None,
            );
            if !side_effects.is_empty() {
                apply_incoming_statuses_to_target(
                    time,
                    attacker,
                    hp_a,
                    &mut statuses_a,
                    &side_effects,
                );
            }
            next_status_tick_a = next_status_tick_at(&statuses_a);
        }
        if !statuses_b.is_empty() {
            let side_effects = handle_simple_dot_ticks_with_log_and_cap(
                time,
                defender.health,
                defender.unbreakable_damage_cap_pct,
                &mut hp_b,
                &mut statuses_b,
                &mut total,
                None,
            );
            if !side_effects.is_empty() {
                apply_incoming_statuses_to_target(
                    time,
                    defender,
                    hp_b,
                    &mut statuses_b,
                    &side_effects,
                );
            }
            next_status_tick_b = next_status_tick_at(&statuses_b);
        }
    }

    total.max(0.0)
}


// ---------------------------------------------------------------------------
// Main composable simulation
// ---------------------------------------------------------------------------

#[cfg(test)]
pub fn simulate_composable_matchup(
    attacker: &SimpleCombatantStats,
    defender: &SimpleCombatantStats,
    attacker_breath: Option<&SimpleBreathProfile>,
    defender_breath: Option<&SimpleBreathProfile>,
    ability_policy: SimpleAbilityTimingMode,
    config: &ComposableAbilityConfig,
    max_time_sec: f64,
) -> BestBuildsMatchupSummary {
    simulate_composable_matchup_with_trace(
        attacker,
        defender,
        attacker_breath,
        defender_breath,
        ability_policy,
        config,
        max_time_sec,
        false,
    )
}

#[allow(clippy::too_many_arguments)]
pub fn simulate_composable_matchup_with_trace(
    attacker: &SimpleCombatantStats,
    defender: &SimpleCombatantStats,
    attacker_breath: Option<&SimpleBreathProfile>,
    defender_breath: Option<&SimpleBreathProfile>,
    ability_policy: SimpleAbilityTimingMode,
    config: &ComposableAbilityConfig,
    max_time_sec: f64,
    _record_trace: bool,
) -> BestBuildsMatchupSummary {
    simulate_composable_matchup_with_trace_control(
        attacker,
        defender,
        attacker_breath,
        defender_breath,
        ability_policy,
        config,
        max_time_sec,
        _record_trace,
        FortifySimulationControl::default(),
        None,
        None,
    )
}

/// Same as `simulate_composable_matchup_with_trace` but accepts a scripted
/// posture timeline that overrides the engine's posture policy decision
/// on the indicated side. Used by the policy-vs-math-ideal benchmark
/// to evaluate arbitrary posture trajectories under FULL Compare
/// conditions without duplicating `toRustComposableArgsFromCompare`'s
/// 100+ field wiring in test fixtures. The script is applied via
/// `decide_override` with `respects_schedule=false`, so each (time,
/// action) tuple fires at the first engine iter past `time`.
#[allow(clippy::too_many_arguments)]
pub fn simulate_composable_matchup_with_posture_script(
    attacker: &SimpleCombatantStats,
    defender: &SimpleCombatantStats,
    attacker_breath: Option<&SimpleBreathProfile>,
    defender_breath: Option<&SimpleBreathProfile>,
    ability_policy: SimpleAbilityTimingMode,
    config: &ComposableAbilityConfig,
    max_time_sec: f64,
    posture_script: &[(f64, crate::composable::posture_policy::PostureAction)],
    self_is_attacker: bool,
) -> BestBuildsMatchupSummary {
    let cursor = std::cell::RefCell::new(0_usize);
    let script = posture_script;
    let override_closure = move |
        _a: &crate::composable::side::CombatSide,
        _b: &crate::composable::side::CombatSide,
        time: f64,
        is_attacker: bool,
    | -> crate::composable::posture_policy::PostureAction {
        if is_attacker != self_is_attacker {
            return crate::composable::posture_policy::PostureAction::Stay;
        }
        let mut idx = cursor.borrow_mut();
        if *idx < script.len() && time + 1e-9 >= script[*idx].0 {
            let (_, action) = script[*idx];
            *idx += 1;
            return action;
        }
        crate::composable::posture_policy::PostureAction::Stay
    };
    let override_fn: &loop_iter::DecideOverrideFn<'_> = &override_closure;
    // Need policy enabled on the side we're scripting so the override
    // gets invoked (loop_iter gates on `*_posture_policy_enabled`).
    let mut cfg = config.clone();
    if self_is_attacker {
        cfg.attacker_posture_policy_enabled = true;
    } else {
        cfg.defender_posture_policy_enabled = true;
    }
    simulate_composable_matchup_with_trace_control(
        attacker,
        defender,
        attacker_breath,
        defender_breath,
        ability_policy,
        &cfg,
        max_time_sec,
        false,
        FortifySimulationControl::default(),
        Some(override_fn),
        None,
    )
}

/// Same shape as `simulate_composable_matchup_with_posture_script`
/// but scripts the bite-variant pick at each bite event on the
/// indicated side. Script entries are `(time, variant)` pairs;
/// the override returns the LAST entry with `time ≤ now` (and
/// PRIMARY for the very first bites if no entry covers them).
/// Falls back to primary on creatures with `damage2 <= 0`.
#[allow(clippy::too_many_arguments)]
pub fn simulate_composable_matchup_with_bite_variant_script(
    attacker: &SimpleCombatantStats,
    defender: &SimpleCombatantStats,
    attacker_breath: Option<&SimpleBreathProfile>,
    defender_breath: Option<&SimpleBreathProfile>,
    ability_policy: SimpleAbilityTimingMode,
    config: &ComposableAbilityConfig,
    max_time_sec: f64,
    bite_variant_script: &[(f64, &'static str)],
    self_is_attacker: bool,
) -> BestBuildsMatchupSummary {
    use crate::policy::decisions::bite_variant::{PRIMARY_VARIANT, SECONDARY_VARIANT};
    let script: Vec<(f64, &'static str)> = bite_variant_script.to_vec();
    let override_closure = move |
        _self_side: &crate::composable::side::CombatSide,
        _opp_side: &crate::composable::side::CombatSide,
        time: f64,
        is_attacker: bool,
    | -> &'static str {
        if is_attacker != self_is_attacker {
            return PRIMARY_VARIANT;
        }
        // Find the LAST script entry with time ≤ now.
        let mut pick = PRIMARY_VARIANT;
        for (t, v) in &script {
            if time + 1e-9 >= *t {
                pick = if *v == SECONDARY_VARIANT { SECONDARY_VARIANT } else { PRIMARY_VARIANT };
            } else {
                break;
            }
        }
        pick
    };
    let override_fn: &loop_iter::BiteVariantOverrideFn<'_> = &override_closure;
    // Force the relevant side into Dynamic mode so the override is
    // actually consulted (PrimaryOnly / SecondaryOnly short-circuit
    // BEFORE the override check would have fired - except we wired
    // the override check first in resolve_*. Belt-and-braces:
    // explicit Dynamic mode keeps caller intent visible to readers).
    let mut cfg = config.clone();
    if self_is_attacker {
        cfg.attacker_bite_variant_mode = crate::composable::config::SimpleBiteVariantMode::Dynamic;
    } else {
        cfg.defender_bite_variant_mode = crate::composable::config::SimpleBiteVariantMode::Dynamic;
    }
    simulate_composable_matchup_with_trace_control(
        attacker,
        defender,
        attacker_breath,
        defender_breath,
        ability_policy,
        &cfg,
        max_time_sec,
        false,
        FortifySimulationControl::default(),
        None,
        Some(override_fn),
    )
}

fn normalized_compare_start_hp(max_hp: f64, pct: f64) -> Option<f64> {
    if !pct.is_finite() || pct <= 0.0 {
        return None;
    }
    let health = max_hp.max(1.0);
    let clamped_pct = pct.clamp(1.0, 100.0);
    Some((health * (clamped_pct / 100.0)).clamp(1.0, health))
}

pub(super) fn apply_compare_start_hp(
    side: &mut CombatSide,
    stats: &SimpleCombatantStats,
    pct: f64,
) {
    if let Some(start_hp) = normalized_compare_start_hp(stats.health, pct) {
        side.hp = start_hp;
    }
}

/// Write the five `env.*` flags into a side's
/// `user_extras` so user abilities can read them via the
/// `env.is_day` / `env.is_night` / `env.is_blue_moon` /
/// `env.is_blood_moon` / `env.air_rule_active` expression paths.
///
/// Values are 0.0 or 1.0 (booleans encoded as numbers - matches how
/// the rest of `extras` carries boolean-like data through the
/// `PolicyValue::Number` arm). The flags are constant for the entire
/// simulation; seeding once at startup is sufficient - no per-tick
/// refresh needed.
pub(super) fn seed_env_extras_into_side(
    side: &mut CombatSide,
    stats: &SimpleCombatantStats,
    config: &ComposableAbilityConfig,
) {
    use crate::policy::state::PolicyValue;
    let day_night = config.compare_day_night.as_deref().unwrap_or("none");
    let moon = config.compare_moon.as_deref().unwrap_or("none");
    // Air rule lives on `SimpleCombatantStats` (compare_air_rule_cooldown_sec)
    // rather than on the config - non-zero on either side ⇒ rule is in play
    // for both sides (Compare always enables it symmetrically). Passed in
    // from the caller's owned ref (the side itself no longer carries stats).
    let air_rule_active = stats.compare_air_rule_cooldown_sec > 0.0;
    let entries: [(&str, f64); 5] = [
        ("env.is_day", if day_night == "day" { 1.0 } else { 0.0 }),
        ("env.is_night", if day_night == "night" { 1.0 } else { 0.0 }),
        ("env.is_blue_moon", if moon == "blueMoon" { 1.0 } else { 0.0 }),
        ("env.is_blood_moon", if moon == "bloodMoon" { 1.0 } else { 0.0 }),
        ("env.air_rule_active", if air_rule_active { 1.0 } else { 0.0 }),
    ];
    for (key, value) in entries {
        side.user_extras
            .insert(key.to_string(), PolicyValue::Number(value));
    }
}

/// Seed each attached user ability's active level into
/// `side.user_levels`. Resolution order, per id:
///   1. `overrides[id]` from the Compare-page per-matchup picker -
///      clamped into `1..=spec.levels`. Out-of-range silently falls back
///      to (2).
///   2. `spec.default_level` from the registered spec.
///      Missing specs (id attached to a creature but unregistered) leave the
///      slot empty; the dispatcher's lookup falls back to 1.
pub(super) fn seed_user_levels_into_side(
    side: &mut CombatSide,
    stats: &SimpleCombatantStats,
    overrides: &std::collections::BTreeMap<String, u32>,
) {
    for id in &stats.user_ability_ids {
        let Some(spec) = crate::wasm_api::snapshot_user_ability(id) else {
            continue;
        };
        let resolved = match overrides.get(id) {
            Some(&n) if n >= 1 && n <= spec.levels => n,
            _ => spec.default_level,
        };
        side.user_levels.insert(id.clone(), resolved);
    }
}

/// State bundle threaded through every extracted `process_phase_*`
/// function. Two lifetimes: `'state` is the lifetime of the
/// long-lived attacker/defender/breath/config refs (they outlive the
/// driver's loop iterations), and `'phase` is the lifetime of
/// the per-phase `&mut` reborrows of the tick-mutable state (sides,
/// log). The constraint `'state: 'phase` keeps the immutable refs
/// alive at least as long as any phase invocation.
///
/// Each phase fn takes `&mut PhaseContext` plus whatever phase-specific
/// state the rubric forces (e.g. `&mut DamageCounters` for damage-recording
/// phases, regen counters for Phase 5+6). Constructing `ctx` in a tight
/// block scope inside the loop body lets the rest of the driver
/// keep direct access to `a`, `b`, `combat_log` between phase calls -
/// the borrow releases as soon as the block ends.
pub(super) struct PhaseContext<'state, 'phase>
where
    'state: 'phase,
{
    pub time: f64,
    pub attacker: &'state SimpleCombatantStats,
    pub defender: &'state SimpleCombatantStats,
    pub attacker_breath: Option<&'state SimpleBreathProfile>,
    pub defender_breath: Option<&'state SimpleBreathProfile>,
    pub config: &'state ComposableAbilityConfig,
    pub record_trace: bool,
    pub a: &'phase mut CombatSide,
    pub b: &'phase mut CombatSide,
    pub combat_log: &'phase mut Vec<crate::contracts::CombatLogEntry>,
}


#[allow(clippy::too_many_arguments)]
fn simulate_composable_matchup_with_trace_control(
    attacker: &SimpleCombatantStats,
    defender: &SimpleCombatantStats,
    attacker_breath: Option<&SimpleBreathProfile>,
    defender_breath: Option<&SimpleBreathProfile>,
    ability_policy: SimpleAbilityTimingMode,
    config: &ComposableAbilityConfig,
    max_time_sec: f64,
    _record_trace: bool,
    fortify_control: FortifySimulationControl,
    decide_override: Option<&loop_iter::DecideOverrideFn<'_>>,
    decide_bite_variant_override: Option<&loop_iter::BiteVariantOverrideFn<'_>>,
) -> BestBuildsMatchupSummary {
    // Honor disabled-abilities list by preprocessing owned clones before
    // building combat sides. Mirrors TS `filterEffectsByDisabled` +
    // passive-flag zeroing in `combatantRuntimeFactory`.
    let mut attacker_owned = attacker.clone();
    let mut defender_owned = defender.clone();
    apply_disabled_abilities(&mut attacker_owned);
    apply_disabled_abilities(&mut defender_owned);
    let attacker = &attacker_owned;
    let defender = &defender_owned;

    // Initialize sides. All setup-time mutations + flag computation are in
    // populate_combat_sides_and_flags (composable/setup.rs); the loop reads
    // flags.has_any_* / flags.flags.attacker_hunker_enabled / etc. via the bundle.
    let mut a = CombatSide::new(attacker, attacker_breath);
    let mut b = CombatSide::new(defender, defender_breath);
    let flags = populate_combat_sides_and_flags(
        &mut a, &mut b, attacker, defender, ability_policy, config,
    );

    let time = -1e-9_f64;
    let counters = DamageCounters::default();
    let hp_a_at_b_death: Option<f64> = None;
    let hp_b_at_a_death: Option<f64> = None;
    let mut combat_log: Vec<crate::contracts::CombatLogEntry> = if _record_trace {
        Vec::with_capacity(256)
    } else {
        Vec::new()
    };
    if flags.attacker_aura_status.is_some() {
        if let Some(subtype) = config.attacker_aura_subtype.as_deref() {
            let display = format!("Aura ({})", subtype);
            record_ability_event(&mut a, "A", &mut combat_log, _record_trace, 0.0, display.as_str());
        }
    }
    if flags.defender_aura_status.is_some() {
        if let Some(subtype) = config.defender_aura_subtype.as_deref() {
            let display = format!("Aura ({})", subtype);
            record_ability_event(&mut b, "B", &mut combat_log, _record_trace, 0.0, display.as_str());
        }
    }
    sync_conditional_passive_events(&mut a, attacker, "A", &mut combat_log, _record_trace, 0.0);
    sync_conditional_passive_events(&mut b, defender, "B", &mut combat_log, _record_trace, 0.0);
    // Debug counters - only maintained when tracing is on. Populated into
    // `SimulationDebugBySide` at the tail of this function.
    let bite_count_a: u32 = 0;
    let bite_count_b: u32 = 0;
    let breath_tick_count_a: u32 = 0;
    let breath_tick_count_b: u32 = 0;
    let regen_ticks_a: u32 = 0;
    let regen_ticks_b: u32 = 0;
    let regen_healed_a: f64 = 0.0;
    let regen_healed_b: f64 = 0.0;
    let warden_rage_events_a: Vec<String> = Vec::new();
    let warden_rage_events_b: Vec<String> = Vec::new();
    let ability_timing_events_a: Vec<String> = Vec::new();
    let ability_timing_events_b: Vec<String> = Vec::new();
    let event_phase_order = normalize_ordered_event_phases(&config.combat_event_order);
    let same_time_processed_phases = 0u32;

    // Fire `on_round_start` for every user ability on
    // each side before the main loop opens. Order: attacker first,
    // then defender - symmetric with the bite/breath schedule. Hooks
    // fire unconditionally; gating belongs inside the hook.
    user_dispatch::dispatch_user_round_start_for_caster(
        &mut a, &mut b, attacker, defender,
        time, &mut combat_log, _record_trace, "A",
    );
    user_dispatch::dispatch_user_round_start_for_caster(
        &mut b, &mut a, defender, attacker,
        time, &mut combat_log, _record_trace, "B",
    );
    // Phase 9: fire on_apply (+ seed on_tick schedule) for any dynamic user
    // status PRESENT at t=0 (starting_statuses). The per-iteration apply diff
    // only catches statuses that appear DURING the loop; a starting status is
    // already present at the first pre-snapshot, so seed its on_apply here.
    {
        let starting_a: Vec<String> = a
            .statuses
            .keys()
            .filter(|id| id.starts_with("user."))
            .cloned()
            .collect();
        let starting_b: Vec<String> = b
            .statuses
            .keys()
            .filter(|id| id.starts_with("user."))
            .cloned()
            .collect();
        // Raw base health: at t=0 `attacker`/`defender` are the raw input stats
        // (no hoist has run), so `*.health` is already the unmodified base.
        user_status_dispatch::dispatch_status_apply_for_bearer(
            &mut a, &mut b, attacker, defender, attacker.health,
            time, &starting_a, &mut combat_log, _record_trace, "A",
        );
        user_status_dispatch::dispatch_status_apply_for_bearer(
            &mut b, &mut a, defender, attacker, defender.health,
            time, &starting_b, &mut combat_log, _record_trace, "B",
        );
        // Phase 9: status on_round_start fires once at t=0 for any status
        // present at fight start (mirror of the ability OnRoundStart hook). Raw
        // base stats here, same as the on_apply pass above.
        let select_round_start: fn(&crate::user_status::UserStatusSpec)
            -> Option<&crate::effects::EffectBatch> = |s| s.on_round_start.as_ref();
        user_status_dispatch::dispatch_status_trigger_for_bearer(
            &mut a, &mut b, attacker, defender, time,
            select_round_start, &[], "on_round_start",
            &mut combat_log, _record_trace, "A",
        );
        user_status_dispatch::dispatch_status_trigger_for_bearer(
            &mut b, &mut a, defender, attacker, time,
            select_round_start, &[], "on_round_start",
            &mut combat_log, _record_trace, "B",
        );
    }

    // -----------------------------------------------------------------------
    // Main event loop
    // -----------------------------------------------------------------------
    let user_iteration_index: u32 = 0;

    let mut state = loop_iter::LoopState {
        a,
        b,
        combat_log,
        counters,
        time,
        same_time_processed_phases,
        user_iteration_index,
        hp_a_at_b_death,
        hp_b_at_a_death,
        bite_count_a,
        bite_count_b,
        breath_tick_count_a,
        breath_tick_count_b,
        regen_ticks_a,
        regen_ticks_b,
        regen_healed_a,
        regen_healed_b,
        warden_rage_events_a,
        warden_rage_events_b,
        ability_timing_events_a,
        ability_timing_events_b,
        fortify_control,
    };
    let params = loop_iter::LoopParams {
        attacker,
        defender,
        attacker_breath,
        defender_breath,
        config,
        flags: &flags,
        ability_policy,
        event_phase_order: &event_phase_order,
        record_trace: _record_trace,
        max_time_sec,
        bench_count: true,
        posture_policy_override: loop_iter::PosturePolicyMode::Normal,
        iter_hooks: loop_iter::IterHooks::default(),
        decide_override,
        decide_override_respects_schedule: false,
        decide_bite_variant_override,
    };
    while state.time <= params.max_time_sec
        && (state.a.death_time.is_none() || state.b.death_time.is_none())
    {
        match loop_iter::run_one_event_loop_iter(&mut state, &params) {
            loop_iter::LoopOutcome::Break => break,
            loop_iter::LoopOutcome::Continue => continue,
            loop_iter::LoopOutcome::Advanced => {}
            // Live driver never sets `iter_hooks.bound`, so the hook
            // never trips. Treated as Break for exhaustiveness.
            loop_iter::LoopOutcome::BoundExceeded => break,
        }
    }
    // Unpack state so the summary section reads the post-loop values.
    let loop_iter::LoopState {
        a,
        b,
        combat_log,
        counters,
        time,
        hp_a_at_b_death,
        hp_b_at_a_death,
        bite_count_a,
        bite_count_b,
        breath_tick_count_a,
        breath_tick_count_b,
        regen_ticks_a,
        regen_ticks_b,
        regen_healed_a,
        regen_healed_b,
        warden_rage_events_a,
        warden_rage_events_b,
        ability_timing_events_a,
        ability_timing_events_b,
        ..
    } = state;
    let _ = user_iteration_index;

    // -----------------------------------------------------------------------
    // Compute summary
    // -----------------------------------------------------------------------
    let winner = match (a.death_time, b.death_time) {
        (Some(death_a), Some(death_b)) => {
            if (death_a - death_b).abs() <= 1e-9 {
                crate::contracts::Winner::Draw
            } else if death_a < death_b {
                crate::contracts::Winner::B
            } else {
                crate::contracts::Winner::A
            }
        }
        (Some(_), None) => crate::contracts::Winner::B,
        (None, Some(_)) => crate::contracts::Winner::A,
        (None, None) => crate::contracts::Winner::Draw,
    };

    let damage_a_at_relevant_end = if b.death_time.is_some() {
        counters.dealt_a_at_b_death
    } else {
        counters.dealt_a
    };
    let damage_b_at_relevant_end = if a.death_time.is_some() {
        counters.dealt_b_at_a_death
    } else {
        counters.dealt_b
    };
    let dps_window_a = if b.death_time.is_some() {
        b.death_time.unwrap_or(max_time_sec)
    } else {
        time
    };
    let dps_elapsed_a = if dps_window_a > 0.0 {
        dps_window_a
    } else {
        max_time_sec.max(1e-9)
    };
    let dps_window_b = if a.death_time.is_some() {
        a.death_time.unwrap_or(max_time_sec)
    } else {
        time
    };
    let dps_elapsed_b = if dps_window_b > 0.0 {
        dps_window_b
    } else {
        max_time_sec.max(1e-9)
    };

    let extended_damage_potential_a = if winner == crate::contracts::Winner::A && a.death_time.is_none() {
        if a.statuses.is_empty()
            && attacker_breath
                .map(|breath| breath.special_statuses.is_empty())
                .unwrap_or(true)
        {
            compute_simple_breath_extended_damage(
                attacker,
                defender,
                attacker_breath,
                time,
                a.next_hit,
                a.next_breath,
                a.breath_capacity,
                a.breath_regen_at,
                a.breath_chain,
            )
        } else {
            let projection_defender = projection_dummy_target(defender);
            compute_status_aware_breath_extended_damage(
                attacker,
                &projection_defender,
                attacker_breath,
                time,
                a.hp,
                &a.statuses,
                a.next_hit,
                a.next_breath,
                a.breath_capacity,
                a.breath_regen_at,
                a.breath_chain,
                a.next_regen,
            )
        }
    } else {
        0.0
    };
    let extended_damage_potential_b = if winner == crate::contracts::Winner::B && b.death_time.is_none() {
        if b.statuses.is_empty()
            && defender_breath
                .map(|breath| breath.special_statuses.is_empty())
                .unwrap_or(true)
        {
            compute_simple_breath_extended_damage(
                defender,
                attacker,
                defender_breath,
                time,
                b.next_hit,
                b.next_breath,
                b.breath_capacity,
                b.breath_regen_at,
                b.breath_chain,
            )
        } else {
            let projection_attacker = projection_dummy_target(attacker);
            compute_status_aware_breath_extended_damage(
                defender,
                &projection_attacker,
                defender_breath,
                time,
                b.hp,
                &b.statuses,
                b.next_hit,
                b.next_breath,
                b.breath_capacity,
                b.breath_regen_at,
                b.breath_chain,
                b.next_regen,
            )
        }
    } else {
        0.0
    };

    BestBuildsMatchupSummary {
        winner,
        death_time_a: a.death_time,
        death_time_b: b.death_time,
        max_time_sec,
        dps_a_to_b: damage_a_at_relevant_end / dps_elapsed_a,
        dps_b_to_a: damage_b_at_relevant_end / dps_elapsed_b,
        ttk_a_to_b: b.death_time.unwrap_or(max_time_sec),
        ttk_b_to_a: a.death_time.unwrap_or(max_time_sec),
        damage_dealt_a: counters.dealt_a,
        damage_dealt_b: counters.dealt_b,
        damage_dealt_a_at_b_death: damage_a_at_relevant_end,
        damage_dealt_b_at_a_death: damage_b_at_relevant_end,
        extended_damage_potential_a,
        extended_damage_potential_b,
        final_hp_a: if a.death_time.is_some() { 0.0 } else { a.hp.max(0.0) },
        final_hp_b: if b.death_time.is_some() { 0.0 } else { b.hp.max(0.0) },
        max_hp_a: attacker.health,
        max_hp_b: defender.health,
        hp_a_at_b_death: hp_a_at_b_death.unwrap_or(a.hp.max(0.0)),
        hp_b_at_a_death: hp_b_at_a_death.unwrap_or(b.hp.max(0.0)),
        damage_dealt_a_until_b_death: damage_a_at_relevant_end,
        damage_dealt_b_until_a_death: damage_b_at_relevant_end,
        ehp_a: estimate_ehp(attacker, &a, time),
        ehp_b: estimate_ehp(defender, &b, time),
        regen_healed_a,
        regen_healed_b,
        regen_ticks_a,
        regen_ticks_b,
        combat_log: if _record_trace { Some(combat_log) } else { None },
        debug: if _record_trace {
            Some(crate::contracts::SimulationDebugBySide {
                a: snapshot_debug(
                    &a,
                    attacker,
                    defender,
                    bite_count_a,
                    breath_tick_count_a,
                    regen_ticks_a,
                    regen_healed_a,
                    warden_rage_events_a,
                    ability_timing_events_a,
                    config.attacker_compare_starting_hunger,
                ),
                b: snapshot_debug(
                    &b,
                    defender,
                    attacker,
                    bite_count_b,
                    breath_tick_count_b,
                    regen_ticks_b,
                    regen_healed_b,
                    warden_rage_events_b,
                    ability_timing_events_b,
                    config.defender_compare_starting_hunger,
                ),
            })
        } else {
            None
        },
        bad_omen_outcome: config.bad_omen_outcome.clone(),
    }
}

/// Cap-200 push for ability-timing event log, mirroring TS
/// `appendAbilityTimingEvent` semantics in `policyRuntime.ts`.
fn push_timing_event(events: &mut Vec<String>, entry: String) {
    if events.len() >= 200 {
        return;
    }
    events.push(entry);
}

/// Bump a cocoon-gated active's contribution to `next_time` past cocoon Ph2
/// end **only when the scheduled event falls inside the P2 invincibility
/// window**. P1 is no longer a lockout (post-2026-05-12 Cocoon rework - the
/// user keeps playing during the 5-second wind-up), so events scheduled in
/// P1 fire normally; only events in `[phase1_until, phase2_until)` need to
/// jump to P2 end where the gate re-opens.
///
/// Pre-rework this pushed any event under `phase2_until` forward, which
/// silently swallowed all scheduled actives during the entire 10-second
/// window.
fn cocoon_aware_schedule(
    scheduled: f64,
    phase1_until: f64,
    phase2_until: f64,
    time: f64,
) -> f64 {
    if phase2_until > time
        && scheduled.is_finite()
        && scheduled >= phase1_until
        && scheduled < phase2_until
    {
        phase2_until
    } else {
        scheduled
    }
}

fn scheduled_active_time(
    next_at: f64,
    statuses: &BTreeMap<String, SimpleStatusInstance>,
    phase1_until: f64,
    phase2_until: f64,
    time: f64,
) -> f64 {
    if next_at <= time + 1e-9 && is_actives_disabled_by_necro(statuses) {
        next_status_decay_at(statuses, time)
    } else {
        cocoon_aware_schedule(next_at, phase1_until, phase2_until, time)
    }
}

fn planned_active_time(
    planned_at: f64,
    statuses: &BTreeMap<String, SimpleStatusInstance>,
    phase1_until: f64,
    phase2_until: f64,
    time: f64,
) -> f64 {
    if planned_at <= 0.0 {
        f64::INFINITY
    } else if planned_at <= time + 1e-9 && is_actives_disabled_by_necro(statuses) {
        next_status_decay_at(statuses, time)
    } else {
        cocoon_aware_schedule(planned_at, phase1_until, phase2_until, time)
    }
}

/// End-of-fight snapshot of per-side event-loop state into the `SimulationDebug`
/// shape consumed by the Compare DebugPanel. Direct reads only - fields that
/// require per-event tracking (totalDamageDealt, statusStacksApplied,
/// plushieOffensive/Defensive stacks, abilitiesApplied, abilityPolicyOverrides,
/// compareHunger*) remain at their Default::default() and are populated by
/// later commits.
fn planned_fortify_time(
    planned_at: f64,
    statuses: &BTreeMap<String, SimpleStatusInstance>,
    phase1_until: f64,
    phase2_until: f64,
    time: f64,
    cooldown_until: f64,
) -> f64 {
    if planned_at <= 0.0 {
        return f64::INFINITY;
    }
    if planned_at <= time + 1e-9 {
        if is_actives_disabled_by_necro(statuses) {
            return next_status_decay_at(statuses, time);
        }
        if cooldown_until > time {
            return cooldown_until;
        }
        return f64::INFINITY;
    }
    cocoon_aware_schedule(planned_at, phase1_until, phase2_until, time)
}

#[allow(clippy::too_many_arguments)]
fn snapshot_debug(
    side: &CombatSide,
    stats: &SimpleCombatantStats,
    opponent_stats: &SimpleCombatantStats,
    bite_count: u32,
    breath_tick_count: u32,
    regen_ticks: u32,
    regen_healed: f64,
    warden_rage_events: Vec<String>,
    ability_timing_events: Vec<String>,
    compare_starting_hunger: f64,
) -> crate::contracts::SimulationDebug {
    let weight_ratio_cap = 3.0_f64;
    let attacker_weight = stats.weight;
    let opponent_weight = opponent_stats.weight;
    let raw_ratio = attacker_weight / opponent_weight.max(1.0);
    let capped_ratio = raw_ratio.min(weight_ratio_cap);
    let warden_resistance_active = stats.has_warden_resistance
        && (side.hp / stats.health.max(1.0)) <= WARDEN_RESISTANCE_HP_RATIO_THRESHOLD;
    let next_regen_at = if side.next_regen.is_finite() {
        Some(side.next_regen)
    } else {
        None
    };
    let mut abilities_applied: Vec<crate::contracts::AbilityAppliedCount> = Vec::new();
    if side.hunters_curse_activation_count > 0 {
        abilities_applied.push(crate::contracts::AbilityAppliedCount {
            name: "Hunters Curse".to_string(),
            count: side.hunters_curse_activation_count,
        });
    }
    if side.hunker_activation_count > 0 {
        abilities_applied.push(crate::contracts::AbilityAppliedCount {
            name: "Hunker".to_string(),
            count: side.hunker_activation_count,
        });
    }
    for (name, count) in &side.ability_activation_counts {
        if *count == 0 {
            continue;
        }
        abilities_applied.push(crate::contracts::AbilityAppliedCount {
            name: name.clone(),
            count: *count,
        });
    }
    crate::contracts::SimulationDebug {
        bite_count,
        breath_tick_count,
        regen_ticks,
        regen_healed,
        attacker_weight,
        opponent_weight,
        weight_ratio: capped_ratio,
        weight_ratio_cap_hit: raw_ratio >= weight_ratio_cap,
        warden_rage_on: side.warden_rage_on,
        warden_rage_stacks: side.warden_rage_stacks,
        warden_rage_cooldown_until: side.warden_rage_cooldown_until,
        warden_rage_tap_until: side.warden_rage_tap_until,
        next_regen_at,
        warden_resistance_active,
        reflect_active_until: side.reflect_active_until,
        totem_next_tick_at: side.totem_next_tick_at,
        drowsy_active: side.statuses.contains_key("Drowsy_Status"),
        warden_rage_events,
        ability_timing_events,
        abilities_applied,
        compare_hunger: side.compare_hunger,
        compare_starting_hunger,
        compare_appetite_base: side.compare_appetite_base,
        compare_hunger_rule_enabled: side.compare_hunger_rule_enabled,
        ..Default::default()
    }
}

/// Effective HP estimate: max_hp / incoming_damage_multiplier computed from
/// final state. Matches TS `estimateEhp` in debugMetricsRuntime.ts: aggregates
/// hunker reduction (when active) and Guilt's damage-taken multiplier. Status
/// damageReductionPct is always 0 in this codebase - no status defines it.
fn estimate_ehp(stats: &SimpleCombatantStats, side: &CombatSide, time: f64) -> f64 {
    let mut multiplier = 1.0_f64;
    if is_hunker_effect_active(side.hunker_on, side.hunker_effect_starts_at, time) {
        multiplier *= 1.0 - (stats.hunker_reduction_pct / 100.0).clamp(0.0, 1.0);
    }
    multiplier *= stats.damage_taken_multiplier_on_being_bitten.max(0.0);
    if multiplier <= 0.0 {
        f64::INFINITY
    } else {
        stats.health / multiplier
    }
}


// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------


// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
//
// Historically this module contained ~1,100 lines of parity tests comparing
// composable against each bespoke contour (simple_melee, status_melee,
// active_melee, life_leech_melee, breath.rs, thorn_trap_breath, ...).
//
// Those tests were deleted on 2026-04-10 together with the bespoke contour
// functions. The fixture-parity verification they performed is now
// redundant - the bespoke functions they compared against no longer exist.
//
// If a composable regression is suspected in the future, lift one of these
// tests from git history (commit before 2026-04-10) and adapt it to compare
// composable against fixture-baked expected summaries instead of a live
// bespoke call.


#[cfg(test)]
mod tests;

#[cfg(test)]
mod reference_tests;

#[cfg(test)]
mod posture_tests;

#[cfg(test)]
mod posture_benchmark;

#[cfg(test)]
mod phase_tests;

#[cfg(test)]
mod engine_property_tests;
