use std::collections::BTreeMap;

use crate::{SimpleAppliedStatus, SimpleBadOmenOutcome, SimpleCombatantStats, SimpleStatusInstance};

pub const WARDEN_RESISTANCE_HP_RATIO_THRESHOLD: f64 = 0.5;

/// Warden's Resistance blocks every ailment that reaches its owner below the
/// HP gate, with one exception the game names explicitly: Shredded Wings
/// bypasses the block and lands. That exception is what leaves a Warden
/// unable to dodge while Shredded Wings is on it.
fn warden_resistance_blocks(status_id: &str) -> bool {
    status_id != "Shredded_Wings"
}

// Resolve a user-defined status spec by id. Gated on the
// `user.` namespace prefix so built-in status ticks pay only a cheap
// `starts_with` check (no registry lock) on the hot path. All the
// metadata seams below consult this user-first, then fall back to the
// generated catalog.
pub(crate) fn user_status_spec(status_id: &str) -> Option<crate::user_status::UserStatusSpec> {
    if status_id.starts_with("user.") {
        crate::wasm_api::snapshot_user_status(status_id)
    } else {
        None
    }
}

// Per-stack DoT / heal-over-time tick interval. Source of truth:
// NAME_TO_EFFECT_META in src/engine/statusCatalog.ts -> codegen ->
// effects_registry::default_tick_sec. Statuses without a registry
// entry return None (no periodic tick). User statuses (Phase 6) carry
// their own tick interval on the spec.
pub fn status_tick_sec(status_id: &str) -> Option<f64> {
    if let Some(spec) = user_status_spec(status_id) {
        return spec.periodic_tick_sec();
    }
    crate::effects_registry::default_tick_sec(status_id)
}

// Per-stack decay interval (seconds until one stack ticks off).
// Muddy, Clean Water and Refreshed are single-instance buffs - non-stacking,
// so their whole lifetime is that one decay step (90 s / 180 s / 180 s,
// registered as defaultDurationSec). All other statuses use the 3-second
// engine baseline. Source of truth: NAME_TO_EFFECT_META -> codegen.
pub fn status_decay_sec(status_id: &str) -> f64 {
    if let Some(spec) = user_status_spec(status_id) {
        return spec.decay_interval_sec;
    }
    crate::effects_registry::default_duration_sec(status_id).unwrap_or(3.0)
}

// Fixed-value statuses: the game grants one instance at a set magnitude and
// never goes above it, so a re-application refreshes the instance instead of
// piling on. Source of truth: NAME_TO_EFFECT_META stackRule -> codegen.
pub fn status_is_stacking_none(status_id: &str) -> bool {
    matches!(
        crate::effects_registry::stack_rule(status_id),
        Some(crate::effects_registry::StackRule::NonStacking)
    )
}

// Maximum stack cap. Source of truth: NAME_TO_EFFECT_META -> codegen
// (Sticky Teeth = 5, the lone capped status today).
pub fn status_max_stacks(status_id: &str) -> Option<f64> {
    if let Some(spec) = user_status_spec(status_id) {
        return spec.max_stacks;
    }
    crate::effects_registry::default_max_stacks(status_id)
}


pub fn is_fortify_removable_status(status_id: &str) -> bool {
    // User statuses (Phase 6) derive cleanse-eligibility from polarity, exactly
    // like built-ins below: a negative status is Fortify-removable, positive /
    // neutral are not. (Game cleanse is polarity-keyed; a separate flag would
    // be a redundant knob.)
    if let Some(spec) = user_status_spec(status_id) {
        return spec.polarity == crate::user_status::UserStatusPolarity::Negative;
    }
    // Catalog-driven via registry polarity. Any status with
    // polarity "negative" in NAME_TO_EFFECT_META is Fortify-removable.
    // After Item 2 (all 9 engine-only negative statuses got Reference
    // entries + meta rows) the hand-written fallback list became
    // empty and the function reduces to a single registry lookup.
    matches!(
        crate::effects_registry::polarity(status_id),
        Some(crate::effects_registry::Polarity::Negative)
    )
}

/// Whether a status instance is actually stripped by Fortify / cleanse.
/// A negative status type is removable (`is_fortify_removable_status`)
/// EXCEPT when the instance is permanent (`no_decay`): the environmental
/// weather cataclysms (Acid Rain / Heat Wave / Hypothermia) and Storming are
/// seeded once at fight start as `no_decay` and model the *environment* -
/// Fortify can't clear the weather (user-arbitrated 2026-05-30). Ability-
/// applied (decaying) instances of the same status types stay cleansable.
/// `is_fortify_removable_status` (the TYPE-level predicate) is intentionally
/// left unchanged so the Fortify-immunity gate still blocks incoming
/// negatives by type.
pub fn is_fortify_cleansable_instance(
    status_id: &str,
    instance: &SimpleStatusInstance,
) -> bool {
    is_fortify_removable_status(status_id) && !instance.no_decay
}

pub fn is_actives_disabled_by_necro(statuses: &BTreeMap<String, SimpleStatusInstance>) -> bool {
    statuses
        .get("Necropoison_Status")
        .map(|instance| instance.stacks >= 10.0)
        .unwrap_or(false)
}

fn compute_simple_remaining_sec_for_status(status_id: &str, stacks: f64, next_decay_at: Option<f64>, time: f64) -> f64 {
    if !stacks.is_finite() || stacks <= 0.0 {
        return 0.0;
    }
    let decay_sec = status_decay_sec(status_id);
    let next_decay_delay = match next_decay_at {
        Some(value) => decay_sec.min((value - time).max(0.0)),
        None => decay_sec,
    };
    ((stacks - 1.0).max(0.0) * decay_sec) + next_decay_delay
}

pub fn apply_simple_status(
    time: f64,
    status_id: &str,
    stacks: f64,
    status: &mut Option<SimpleStatusInstance>,
) {

    if stacks == 0.0 {
        return;
    }

    let is_healing = stacks < 0.0;
    let existing = status.clone().unwrap_or(SimpleStatusInstance {
        stacks: 0.0,
        next_tick_at: None,
        next_decay_at: None,
        remaining_sec: 0.0,
        stack_value_mode: None,
        lich_mark_owned_stacks: None,
        no_decay: false,
        resolved_scalars: None,
    });

    // A fixed-value status pins to a single stack and restarts its timer on
    // every application - the second dose refreshes the first instead of
    // adding to it. Healing still walks the normal subtract path so a cleanse
    // can strip the instance.
    let refreshes_instead_of_stacking = !is_healing && status_is_stacking_none(status_id);

    let mut instance = existing;
    let previous_stacks = instance.stacks;
    if refreshes_instead_of_stacking {
        instance.stacks = 1.0;
        instance.next_decay_at = None;
    } else {
        instance.stacks += stacks;
    }
    if instance.stacks <= 0.0 {
        *status = None;
        return;
    }

    if let Some(max_stacks) = status_max_stacks(status_id) {
        instance.stacks = instance.stacks.min(max_stacks);
    }
    let removed_stacks = (previous_stacks - instance.stacks).max(0.0);
    if let Some(owned) = instance.lich_mark_owned_stacks {
        let next_owned = (owned - removed_stacks).max(0.0).min(instance.stacks);
        instance.lich_mark_owned_stacks = if next_owned > 1e-9 {
            Some(next_owned)
        } else {
            None
        };
    }

    if instance.next_decay_at.is_none() {
        instance.next_decay_at = Some(time + status_decay_sec(status_id));
    }
    if status_tick_sec(status_id).is_some() && instance.next_tick_at.is_none() {
        instance.next_tick_at = Some(time + status_tick_sec(status_id).unwrap_or(3.0));
    }
    instance.remaining_sec = compute_simple_remaining_sec_for_status(status_id, instance.stacks, instance.next_decay_at, time);
    *status = Some(instance);
}

pub fn compute_simple_dot_damage(max_hp: f64, status_id: &str, stacks: f64) -> f64 {
    // An ailment's damage is per TICK, never scaled by the tick interval or by
    // elapsed time: the listed magnitude is what it deals each time it fires,
    // and the cadence (`status_tick_sec`) only decides how often it fires.
    //
    // Stacks here is the post-decay stack count (the count after this tick's
    // decay has been applied). Burn base 0.025% + 0.1% per remaining stack
    // matches empirical PvP data: stationary 1 stack decays to 0 first, so the
    // tick deals base only (~0.025%). Moving 1 stack keeps the stack, so the
    // tick deals 0.125%. The 5x stationary/moving ratio at 1 stack drops out
    // of this formula automatically, no separate movement multiplier needed.
    let stacks = stacks.max(0.0);
    // User statuses compute DoT parametrically from the spec
    // (flat or %-max-hp, base + per-stack). Built-ins keep bespoke formulas.
    if let Some(spec) = user_status_spec(status_id) {
        return spec.dot_damage(max_hp, stacks);
    }
    match status_id {
        "Poison_Status" => (max_hp * (0.2 + 0.05 * stacks)) / 100.0,
        "Burn_Status" => (max_hp * (0.025 + 0.1 * stacks)) / 100.0,
        "Corrosion_Status" => (max_hp * 0.5) / 100.0,
        // Radiation deals a small, unscaling 0.5% max-HP DOT per tick - flat,
        // independent of stack count (Reference: status_radiation). The
        // multi-creature "additive nearby Radiation" rule is out of the 1v1
        // stand-and-fight model, so a single source ticks a flat 0.5%.
        "Radiation_Status" => (max_hp * 0.5) / 100.0,
        "Bleed_Status" => 2.0 * stacks,
        // Starvation and dehydration. Unblockable in game, which costs nothing
        // to honour here: nobody applies them, so no block stat is in the path.
        "Hungry_Status" | "Thirsty_Status" => {
            crate::compare_hunger::starving_damage(max_hp, stacks)
        }
        "Hypothermia_Status" => (max_hp * 0.75) / 100.0,
        "Heat_Wave_Status" => (max_hp * 1.0) / 100.0,
        "Acid_Rain_Status" => (max_hp * 3.0) / 100.0,
        _ => 0.0,
    }
}

fn apply_status_application_in_place(
    time: f64,
    status_id: &str,
    stacks: f64,
    statuses: &mut BTreeMap<String, SimpleStatusInstance>,
    resist_fraction: f64,
    plushie_block_fraction: f64,
    elder_block_fraction: f64,
) {
    let is_healing = stacks < 0.0;

    // Radiation lowers the target's positive ailment blocks for every OTHER
    // ailment (Reference: status_radiation). The reduction is
    // 99*((x/99)^2.5)% of the block - multiplicative, and capped at 99% by the
    // 99-stack cap - applied to the native block and any plushie block, both of
    // which are per-ailment stat blocks. The umbrella/all-ailment block
    // (`elder_block_fraction`, game `BlockAilment`) is NOT in Radiation's target
    // list, so it stays intact. Ailment weaknesses (negative blocks) are never
    // altered, the block never drops below 0 (multiplicative reduction of a
    // positive value can't), and Radiation's own application is unaffected.
    // Healing ignores block entirely, so it short-circuits here too. Warden's
    // Resistance and breath resistance live on separate paths (see
    // apply_incoming_statuses_to_target and combat.rs) and are left untouched.
    let (resist_fraction, plushie_block_fraction) = if is_healing
        || status_id == "Radiation_Status"
    {
        (resist_fraction, plushie_block_fraction)
    } else {
        let radiation_stacks = statuses
            .get("Radiation_Status")
            .map(|instance| instance.stacks)
            .unwrap_or(0.0);
        if radiation_stacks > 0.0 {
            let x = radiation_stacks.clamp(0.0, 99.0);
            let keep = (1.0 - 0.99 * (x / 99.0).powf(2.5)).clamp(0.0, 1.0);
            let reduce = |block: f64| if block > 0.0 { block * keep } else { block };
            (reduce(resist_fraction), reduce(plushie_block_fraction))
        } else {
            (resist_fraction, plushie_block_fraction)
        }
    };

    // A negative fraction is a weakness and multiplies the incoming stacks up;
    // a positive one joins the block that divides them down. Both the creature's
    // own resistance and a plushie's can be negative - Sparkler pays for its
    // three blocks with a Bleed weakness - so both are split the same way. Summing
    // a weakness into the block instead lets it cancel an unrelated block, and on
    // its own it clamped to zero and did nothing at all.
    let vulnerability_multiplier = if is_healing {
        1.0
    } else {
        (1.0 - resist_fraction.min(0.0)) * (1.0 - plushie_block_fraction.min(0.0))
    };
    let total_block_fraction = if is_healing {
        0.0
    } else {
        (resist_fraction.max(0.0) + plushie_block_fraction.max(0.0) + elder_block_fraction.max(0.0))
            .clamp(0.0, 1.0)
    };
    let applied_stacks =
        stacks * vulnerability_multiplier * (1.0 - total_block_fraction).max(0.0);

    let existing = statuses.get(status_id).cloned();
    let mut slot = existing;
    apply_simple_status(time, status_id, applied_stacks, &mut slot);
    match slot {
        Some(instance) => {
            statuses.insert(status_id.to_string(), instance);
        }
        None => {
            statuses.remove(status_id);
        }
    }
}

pub fn next_status_tick_at(statuses: &BTreeMap<String, SimpleStatusInstance>) -> f64 {
    if statuses.is_empty() {
        return f64::INFINITY;
    }
    statuses
        .values()
        .filter_map(|instance| instance.next_tick_at)
        .fold(f64::INFINITY, f64::min)
}

/// Returns the earliest `next_decay_at` across all status instances that
/// is strictly after `after_time`.  This mirrors the TS `nextStatusDecayAt`
/// timeline function (which guards `nextDecayAt > state.lastUpdateAt`) so
/// that the composable event loop jumps to stack-decay boundaries even for
/// statuses that have no DOT tick (e.g. Injury_Status) while ignoring
/// stale values from blocked decays (e.g. Bleed blocked by Deep_Wounds).
pub fn next_status_decay_at(statuses: &BTreeMap<String, SimpleStatusInstance>, after_time: f64) -> f64 {
    if statuses.is_empty() {
        return f64::INFINITY;
    }
    statuses
        .values()
        .filter_map(|instance| instance.next_decay_at)
        .filter(|&d| d > after_time + 1e-9)
        .fold(f64::INFINITY, f64::min)
}

/// Move a just-applied instance off the registry's per-stack decay pacing and
/// onto the lifetime the application asked for. `no_decay` clears the decay
/// timer outright (the weather / `seed_permanent_status` idiom); `remaining_sec`
/// pushes the next decay boundary out to the caller's duration, which is how a
/// Compare buff seeded at t=0 keeps its full window instead of expiring after
/// one registry decay step. An application that pins neither leaves the
/// instance exactly as `apply_simple_status` built it.
fn pin_applied_lifetime(
    time: f64,
    effect: &SimpleAppliedStatus,
    statuses: &mut BTreeMap<String, SimpleStatusInstance>,
) {
    if !effect.no_decay && effect.remaining_sec.is_none() && effect.stack_value_mode.is_none() {
        return;
    }
    let Some(instance) = statuses.get_mut(&effect.status_id) else {
        return;
    };
    if effect.stack_value_mode.is_some() {
        instance.stack_value_mode = effect.stack_value_mode.clone();
    }
    if effect.no_decay {
        instance.no_decay = true;
        instance.next_decay_at = None;
        return;
    }
    let seconds = effect.remaining_sec.unwrap_or(0.0);
    if !seconds.is_finite() || seconds <= 0.0 {
        return;
    }
    instance.next_decay_at = Some(time + seconds);
    instance.remaining_sec = seconds;
}

pub fn apply_simple_status_list(
    time: f64,
    statuses: &mut BTreeMap<String, SimpleStatusInstance>,
    applied: &[SimpleAppliedStatus],
) {
    for effect in applied {
        let existing = statuses.get(&effect.status_id).cloned();
        let mut slot = existing;
        apply_simple_status(time, &effect.status_id, effect.stacks, &mut slot);
        match slot {
            Some(instance) => {
                statuses.insert(effect.status_id.clone(), instance);
            }
            None => {
                statuses.remove(&effect.status_id);
            }
        }
        pin_applied_lifetime(time, effect, statuses);
    }
}

/// Engine status id for a weather cataclysm value, or None for an
/// unknown / "none" value. Mirrors the TS `WEATHER_OPTIONS` mapping.
pub fn weather_status_id(weather: &str) -> Option<&'static str> {
    match weather {
        "heatWave" => Some("Heat_Wave_Status"),
        "blizzard" => Some("Hypothermia_Status"),
        "acidRain" => Some("Acid_Rain_Status"),
        _ => None,
    }
}

/// Seed a single permanent status stack on a side. The stack never decays
/// (`no_decay`); if the status has a periodic tick it keeps firing every
/// `status_tick_sec`, so the effect persists for the whole fight. Used by
/// the weather cataclysm setup (Heat Wave / Blizzard / Acid Rain) and the
/// Storming debuff. Safe to call when the side already carries the status -
/// the stack count is pinned back to a single permanent stack.
pub fn seed_permanent_status(
    time: f64,
    statuses: &mut BTreeMap<String, SimpleStatusInstance>,
    status_id: &str,
) {
    let mut slot = statuses.get(status_id).cloned();
    apply_simple_status(time, status_id, 1.0, &mut slot);
    if let Some(mut instance) = slot {
        instance.stacks = 1.0;
        instance.no_decay = true;
        instance.next_decay_at = None;
        statuses.insert(status_id.to_string(), instance);
    }
}

pub fn apply_incoming_statuses_to_target(
    time: f64,
    target: &SimpleCombatantStats,
    target_hp: f64,
    statuses: &mut BTreeMap<String, SimpleStatusInstance>,
    applied: &[SimpleAppliedStatus],
) {
    for effect in applied {
        if target
            .immune_status_ids
            .iter()
            .any(|immune| immune == &effect.status_id)
        {
            continue;
        }
        if target.has_warden_resistance
            && warden_resistance_blocks(&effect.status_id)
            && target_hp / target.health.max(1.0) <= WARDEN_RESISTANCE_HP_RATIO_THRESHOLD
        {
            continue;
        }
        apply_status_application_in_place(
            time,
            &effect.status_id,
            effect.stacks,
            statuses,
            *target
                .status_resist_fractions
                .get(&effect.status_id)
                .unwrap_or(&0.0),
            *target
                .plushie_status_block_fractions
                .get(&effect.status_id)
                .unwrap_or(&0.0),
            target.elder_block_fraction,
        );
        pin_applied_lifetime(time, effect, statuses);
    }
}

pub fn apply_incoming_statuses_to_target_with_fortify_immunity(
    time: f64,
    target: &SimpleCombatantStats,
    target_hp: f64,
    statuses: &mut BTreeMap<String, SimpleStatusInstance>,
    applied: &[SimpleAppliedStatus],
    fortify_immune_until: f64,
) {
    for effect in applied {
        if target
            .immune_status_ids
            .iter()
            .any(|immune| immune == &effect.status_id)
        {
            continue;
        }
        if fortify_immune_until > 0.0
            && fortify_immune_until > time
            && is_fortify_removable_status(&effect.status_id)
        {
            continue;
        }
        if target.has_warden_resistance
            && warden_resistance_blocks(&effect.status_id)
            && target_hp / target.health.max(1.0) <= WARDEN_RESISTANCE_HP_RATIO_THRESHOLD
        {
            continue;
        }
        apply_status_application_in_place(
            time,
            &effect.status_id,
            effect.stacks,
            statuses,
            *target
                .status_resist_fractions
                .get(&effect.status_id)
                .unwrap_or(&0.0),
            *target
                .plushie_status_block_fractions
                .get(&effect.status_id)
                .unwrap_or(&0.0),
            target.elder_block_fraction,
        );
        pin_applied_lifetime(time, effect, statuses);
    }
}

/// Picks the follow-up outcome for the Nth Bad Omen expiry, cycling the list and
/// advancing the counter. None when the list is empty (no follow-up configured).
/// Bad Omen is random in-game; the caller pre-fills `outcomes` (a freshly-rolled
/// batch for Compare/Sandbox, a single deterministic entry for Best Builds).
pub fn next_bad_omen_outcome(
    outcomes: &[SimpleBadOmenOutcome],
    expiry_count: &mut u32,
) -> Option<SimpleBadOmenOutcome> {
    if outcomes.is_empty() {
        return None;
    }
    let index = (*expiry_count as usize) % outcomes.len();
    *expiry_count = expiry_count.wrapping_add(1);
    Some(outcomes[index].clone())
}

pub fn heal_simple_status_stacks(
    time: f64,
    statuses: &mut BTreeMap<String, SimpleStatusInstance>,
    stacks_to_heal: f64,
) {
    if stacks_to_heal <= 0.0 {
        return;
    }

    let healable_statuses = [
        "Poison_Status",
        "Burn_Status",
        "Bleed_Status",
        "Corrosion_Status",
    ];
    let bleed_healing_blocked = statuses
        .get("Deep_Wounds_Status")
        .map(|instance| instance.stacks > 0.0)
        .unwrap_or(false);
    // Mud Pile (Muddy_Status) doubles the healing rate for Poison/Bleed only.
    // Mirrors TS statusDotRuntime.ts healStatusStacks muddyBoost.
    let muddy_boost = if statuses.contains_key("Muddy_Status") {
        2.0_f64
    } else {
        1.0_f64
    };
    let mut remaining_heal = stacks_to_heal;
    for status_id in healable_statuses {
        if remaining_heal <= 0.0 {
            break;
        }
        if status_id == "Bleed_Status" && bleed_healing_blocked {
            continue;
        }
        let current_stacks = statuses
            .get(status_id)
            .map(|instance| instance.stacks)
            .unwrap_or(0.0);
        if current_stacks <= 0.0 {
            continue;
        }
        let multiplier =
            if status_id == "Poison_Status" || status_id == "Bleed_Status" {
                muddy_boost
            } else {
                1.0
            };
        let heal_capacity = remaining_heal * multiplier;
        let heal_amount = heal_capacity.min(current_stacks);
        let existing = statuses.get(status_id).cloned();
        let mut slot = existing;
        apply_simple_status(time, status_id, -heal_amount, &mut slot);
        match slot {
            Some(instance) => {
                statuses.insert(status_id.to_string(), instance);
            }
            None => {
                statuses.remove(status_id);
            }
        }
        remaining_heal -= heal_amount / multiplier;
    }
}

pub fn handle_simple_dot_ticks_with_log_and_cap(
    time: f64,
    target_max_hp: f64,
    damage_cap_pct: f64,
    target_hp: &mut f64,
    statuses: &mut BTreeMap<String, SimpleStatusInstance>,
    source_damage_dealt: &mut f64,
    tick_log: Option<&mut Vec<(String, f64, f64)>>,
) -> Vec<SimpleAppliedStatus> {
    handle_simple_dot_ticks_with_log_and_cap_and_decay_flags(
        time,
        target_max_hp,
        damage_cap_pct,
        target_hp,
        statuses,
        source_damage_dealt,
        false,
        tick_log,
    )
}

#[allow(clippy::too_many_arguments)]
pub fn handle_simple_dot_ticks_with_log_and_cap_and_decay_flags(
    time: f64,
    target_max_hp: f64,
    damage_cap_pct: f64,
    target_hp: &mut f64,
    statuses: &mut BTreeMap<String, SimpleStatusInstance>,
    source_damage_dealt: &mut f64,
    block_persistent_decay: bool,
    tick_log: Option<&mut Vec<(String, f64, f64)>>,
) -> Vec<SimpleAppliedStatus> {
    handle_simple_dot_ticks_full(
        time,
        target_max_hp,
        damage_cap_pct,
        target_hp,
        statuses,
        source_damage_dealt,
        block_persistent_decay,
        tick_log,
        1.0,
        false,
        false,
        1.0,
        1.0,
    )
}

/// Posture-aware DOT tick variant. `negative_ailment_decay_mult > 1.0`
/// compresses the natural per-stack decay interval for statuses whose
/// id matches `composable::posture::is_negative_ailment`. Other statuses
/// keep the standard interval.
#[allow(clippy::too_many_arguments)]
pub fn handle_simple_dot_ticks_full(
    time: f64,
    target_max_hp: f64,
    damage_cap_pct: f64,
    target_hp: &mut f64,
    statuses: &mut BTreeMap<String, SimpleStatusInstance>,
    source_damage_dealt: &mut f64,
    block_persistent_decay: bool,
    mut tick_log: Option<&mut Vec<(String, f64, f64)>>,
    negative_ailment_decay_mult: f64,
    // True when the target side is settled in the Laying posture. Laying
    // nullifies Hypothermia damage (the creature curls up to conserve
    // heat) - the status persists but deals 0 damage while laying. Other
    // DoTs are unaffected. Spec: weather Blizzard, generalized to any
    // Hypothermia source (user-arbitrated 2026-05-29).
    laying: bool,
    // True while the bearer is sealed in Cocoon Phase 2 (fully invincible /
    // ImmuneToAilmentDamage). All DoT damage is suppressed for the window; the
    // statuses keep ticking and decaying so they resume / wear off as normal
    // once Phase 2 ends. Mirrors the `laying` Hypothermia-damage suppression.
    cocoon_invul: bool,
    // Radiation's additive multi-creature DOT: its flat 0.5% max-HP tick is
    // multiplied by the number of nearby radiated creatures (1 self + N extras +
    // the other fighter when it is currently radiated). 1.0 = a single source =
    // the plain 0.5% baseline. Only applied to Radiation_Status.
    radiation_dot_mult: f64,
    // Sit/lay-gated ailment-recovery accelerator (Defiled Ground level x
    // Darkstar plushie), composed by the caller. > 1.0 multiplies the
    // per-tick stack strip for Defiled-Ground-recoverable statuses only,
    // on top of the posture decay multiplier above. 1.0 = no acceleration.
    recoverable_recovery_mult: f64,
) -> Vec<SimpleAppliedStatus> {
    let mut side_effects: Vec<SimpleAppliedStatus> = Vec::new();
    if statuses.is_empty() {
        return side_effects;
    }
    let bleed_decay_blocked = statuses
        .get("Deep_Wounds_Status")
        .map(|instance| instance.stacks > 0.0)
        .unwrap_or(false);
    // Reference status_heartbroken: "Heartbroken blocks all healing
    // sources except the creature's natural health regeneration." Read
    // the gate once before the iter_mut loop so the per-tick branches
    // (Blessings_Boon below) can consult it without re-borrowing the
    // map.
    let external_heal_blocked = statuses
        .get("Heartbroken_Status")
        .map(|instance| instance.stacks > 0.0)
        .unwrap_or(false);
    // Per-tick order: decay first, then damage using post-decay stacks. If
    // decay reduces stacks to 0 the effect still ticks once (it existed at
    // the start of the tick), but only the base contribution is dealt - for
    // Burn that means 0.025%, while at full stacks the same tick deals
    // 0.025% + 0.1% per stack. Statuses removed by decay are collected and
    // dropped after the iteration so we can keep `iter_mut` here.
    let mut to_remove: Vec<String> = Vec::new();
    for (key, instance) in statuses.iter_mut() {
        let Some(next_tick_at) = instance.next_tick_at else {
            continue;
        };
        if next_tick_at > time + 1e-9 {
            continue;
        }
        let tick_sec = status_tick_sec(key).unwrap_or(3.0);

        if key == "Blessings_Boon" {
            // Heartbroken blocks the heal but the scheduler stays alive
            // so the next tick re-checks once Heartbroken expires.
            if !external_heal_blocked {
                let heal = (target_max_hp * 3.0) / 100.0;
                if heal > 0.0 {
                    *target_hp = (*target_hp + heal).min(target_max_hp);
                }
            }
            instance.next_tick_at = Some(time + tick_sec);
            continue;
        }

        let stacks_before = instance.stacks;

        // 1. Apply decay first (mirrors live game: a stack expires before the
        //    matching damage tick fires). Decay is suppressed for persistent
        //    PvP statuses while moving (block_persistent_decay) and for Bleed
        //    while Deep Wounds is active.
        let decay_blocked = (block_persistent_decay && is_persistent_pvp_status(key))
            || (bleed_decay_blocked && key == "Bleed_Status")
            // Weather/permanent instances never decay: the single stack
            // persists for the whole fight while the tick keeps firing.
            || instance.no_decay;
        if decay_blocked {
            instance.remaining_sec =
                compute_simple_remaining_sec_for_status(key, instance.stacks, instance.next_decay_at, time);
        } else {
            // Posture spec: tick interval stays at status_decay_sec
            // (typically 3 s); per-tick stack strip is multiplied by
            // `negative_ailment_decay_mult` (x2 sitting, x4 laying)
            // for negative ailments only. Other statuses still strip
            // exactly 1 stack per natural tick.
            let posture_strip = if negative_ailment_decay_mult > 1.0
                && crate::composable::posture::is_negative_ailment(key)
            {
                negative_ailment_decay_mult
            } else {
                1.0
            };
            // Defiled Ground / Darkstar recovery accelerator: an extra
            // multiplier on the per-tick strip for the recoverable-ailment
            // subset only, composed multiplicatively with the posture
            // strip. Gated by the caller to sit/lay; 1.0 here = no boost.
            let recovery_bonus = if recoverable_recovery_mult > 1.0
                && crate::composable::posture::is_defiled_ground_recoverable(key)
            {
                recoverable_recovery_mult
            } else {
                1.0
            };
            let strip_per_tick = posture_strip * recovery_bonus;
            while instance
                .next_decay_at
                .is_some_and(|decay| decay <= time + 1e-9)
            {
                instance.stacks -= strip_per_tick;
                if let Some(owned) = instance.lich_mark_owned_stacks {
                    let next_owned = (owned - strip_per_tick).max(0.0).min(instance.stacks.max(0.0));
                    instance.lich_mark_owned_stacks = if next_owned > 1e-9 {
                        Some(next_owned)
                    } else {
                        None
                    };
                }
                if instance.stacks <= 0.0 {
                    break;
                }
                if let Some(decay) = instance.next_decay_at.as_mut() {
                    *decay += status_decay_sec(key);
                }
            }
        }

        // 2. Damage with post-decay stack count. Always fire if the status
        //    existed at the start of the tick - even if decay just dropped
        //    it to 0, the base contribution still lands. Negative stacks are
        //    clamped inside compute_simple_dot_damage.
        // Laying nullifies Hypothermia damage (any source) while settled
        // in the Laying posture. The status still ticks (and decays, if it
        // is an ability-applied decaying instance) - only the HP damage is
        // suppressed.
        // Phase 9: a user status with an Expr-resolved tick override supplies
        // the per-tick coefficient (read from the instance cache); else fall
        // back to the static formula via `compute_simple_dot_damage`.
        let resolved_tick_coeff = instance.resolved_scalars.as_ref().and_then(|r| r.tick_amount);
        let hypothermia_damage_suppressed = laying && key == "Hypothermia_Status";
        if stacks_before > 0.0 && !hypothermia_damage_suppressed && !cocoon_invul {
            let post_decay_stacks = instance.stacks.max(0.0);
            let raw_damage = match resolved_tick_coeff {
                Some(coeff) => user_status_spec(key)
                    .map_or(0.0, |spec| spec.dot_damage_from_coeff(target_max_hp, coeff)),
                None => compute_simple_dot_damage(target_max_hp, key, post_decay_stacks),
            };
            // Radiation scales with nearby radiated creatures (see param doc).
            let raw_damage = if key == "Radiation_Status" {
                raw_damage * radiation_dot_mult
            } else {
                raw_damage
            };
            let damage = apply_damage_cap(raw_damage, target_max_hp, damage_cap_pct);
            if damage > 0.0 {
                *target_hp -= damage;
                *source_damage_dealt += damage;
                if let Some(log) = tick_log.as_deref_mut() {
                    log.push((key.clone(), damage, (*target_hp).max(0.0)));
                }
            }
        }

        // User-defined heal-over-time tick. Symmetric to the
        // DoT damage block above - heals the bearer by the per-tick amount
        // computed from post-decay stacks. DoT user statuses return 0 here
        // (they landed their damage above), so there is no double-handling.
        // Built-in heal statuses (Blessings_Boon) keep their bespoke branch.
        if stacks_before > 0.0 {
            if let Some(spec) = user_status_spec(key) {
                let heal = match resolved_tick_coeff {
                    Some(coeff) => spec.tick_heal_amount_from_coeff(target_max_hp, coeff),
                    None => spec.tick_heal_amount(target_max_hp, instance.stacks.max(0.0)),
                };
                if heal > 0.0 {
                    *target_hp = (*target_hp + heal).min(target_max_hp);
                }
            }
        }

        // Heat Wave applies +2 Burn stacks per tick on top of its own damage.
        if key == "Heat_Wave_Status" && stacks_before > 0.0 {
            side_effects.push(SimpleAppliedStatus {
                status_id: "Burn_Status".to_string(),
                stacks: 2.0,
                ..Default::default()
            });
        }

        // Acid Rain applies +2 Poison stacks per tick on top of its own
        // damage (parallel to Heat Wave's Burn). The Poison stacks follow
        // the standard stack-as-duration model (they decay normally).
        if key == "Acid_Rain_Status" && stacks_before > 0.0 {
            side_effects.push(SimpleAppliedStatus {
                status_id: "Poison_Status".to_string(),
                stacks: 2.0,
                ..Default::default()
            });
        }

        // 3. Schedule next tick or queue removal if decay drained the status.
        if instance.stacks > 0.0 {
            instance.next_tick_at = Some(time + tick_sec);
            instance.remaining_sec =
                compute_simple_remaining_sec_for_status(key, instance.stacks, instance.next_decay_at, time);
        } else {
            to_remove.push(key.clone());
        }
    }
    for key in to_remove {
        statuses.remove(&key);
    }
    side_effects
}

fn apply_damage_cap(damage: f64, target_max_hp: f64, cap_pct: f64) -> f64 {
    let damage = damage.max(0.0);
    if !cap_pct.is_finite() || cap_pct <= 0.0 {
        return damage;
    }
    let fraction = if cap_pct > 1.0 { cap_pct / 100.0 } else { cap_pct };
    damage.min(target_max_hp.max(0.0) * fraction.clamp(0.0, 1.0))
}

pub fn update_simple_status_durations(
    time: f64,
    statuses: &mut BTreeMap<String, SimpleStatusInstance>,
) {
    update_simple_status_durations_with_flags(time, statuses, false);
}

/// PvP-persistent statuses (TS: PERSISTENT_STATUS_IDS in subsystems/statuses.ts).
/// When `compareNoMoveFacetank` is disabled on the TS side, these statuses
/// skip natural decay (stacks stay put, remaining_sec recomputed).
pub fn is_persistent_pvp_status(status_id: &str) -> bool {
    matches!(
        status_id,
        "Poison_Status"
            | "Burn_Status"
            | "Bleed_Status"
            | "Corrosion_Status"
            | "Necropoison_Status"
            | "Frostbite_Status"
            | "Radiation_Status"
            | "Hypothermia_Status"
            | "Sickly_Status"
            | "Injury_Status"
    )
}

/// Aggressive (and its Bear variant) follow the in-game rule "stacks do not
/// decrease until the player moves": while the owning side is stationary (No
/// Move Facetank enabled) the buff persists for the whole fight instead of
/// expiring after its 10-second window. Gated INVERSELY to
/// `is_persistent_pvp_status` - persistent ailments are held while MOVING,
/// Aggressive is held while STATIONARY (see `update_simple_status_durations_full`).
pub fn is_no_move_persistent_buff(status_id: &str) -> bool {
    matches!(status_id, "Aggressive_Status" | "Aggressive_Bear_Status")
}

/// Extended variant used by the main composable loop. When
/// `block_persistent_decay` is true, PvP-persistent statuses skip natural
/// decay and only have their `remaining_sec` recomputed (mirrors TS
/// `!compareNoMoveFacetank` branch in statusDurationRuntime.ts).
pub fn update_simple_status_durations_with_flags(
    time: f64,
    statuses: &mut BTreeMap<String, SimpleStatusInstance>,
    block_persistent_decay: bool,
) {
    update_simple_status_durations_with_flags_and_log(time, statuses, block_persistent_decay, None);
}

/// Log entry for natural decay/expiry transitions. `new_stacks == 0.0` means
/// expired (status removed); otherwise decayed (partial stack drop).
pub struct StatusDecayLogEntry {
    pub status_id: String,
    pub previous_stacks: f64,
    pub new_stacks: f64,
}

/// Extended variant that optionally collects decay/expire transitions into
/// `decay_log`. Only pushes when stacks change (decayed) or the instance is
/// removed (expired). Blocked (persistent PvP / Bleed-under-Deep-Wounds)
/// branches never log.
pub fn update_simple_status_durations_with_flags_and_log(
    time: f64,
    statuses: &mut BTreeMap<String, SimpleStatusInstance>,
    block_persistent_decay: bool,
    decay_log: Option<&mut Vec<StatusDecayLogEntry>>,
) {
    update_simple_status_durations_full(time, statuses, block_persistent_decay, decay_log, 1.0, 1.0);
}

/// Posture-aware variant: `negative_ailment_decay_mult` (>1.0) compresses
/// the natural decay interval for statuses identified by
/// `composable::posture::is_negative_ailment` so they expire sooner while
/// the holder is settled in Sitting / Laying. Other statuses (positive,
/// neutral, persistent-PvP) keep the standard interval.
pub fn update_simple_status_durations_full(
    time: f64,
    statuses: &mut BTreeMap<String, SimpleStatusInstance>,
    block_persistent_decay: bool,
    mut decay_log: Option<&mut Vec<StatusDecayLogEntry>>,
    negative_ailment_decay_mult: f64,
    // Sit/lay-gated ailment-recovery accelerator (Defiled Ground level x
    // Darkstar plushie). > 1.0 multiplies the per-tick stack strip for
    // Defiled-Ground-recoverable statuses only, composed multiplicatively
    // with `negative_ailment_decay_mult`. 1.0 = no acceleration.
    recoverable_recovery_mult: f64,
) {
    if statuses.is_empty() {
        return;
    }

    let bleed_decay_blocked = statuses
        .get("Deep_Wounds_Status")
        .map(|instance| instance.stacks > 0.0)
        .unwrap_or(false);

    statuses.retain(|key, instance| {
        if bleed_decay_blocked && key == "Bleed_Status" {
            instance.remaining_sec =
                compute_simple_remaining_sec_for_status(key, instance.stacks, instance.next_decay_at, time);
            return true;
        }
        if block_persistent_decay && is_persistent_pvp_status(key) {
            instance.remaining_sec =
                compute_simple_remaining_sec_for_status(key, instance.stacks, instance.next_decay_at, time);
            return true;
        }
        // Aggressive "stacks do not decrease until the player moves": while the
        // owning side is stationary (No Move Facetank enabled => effective
        // block_persistent_decay == false) the buff does not decay, so the +25%
        // (Bear +37.5%) persists for the whole fight instead of the 10-second
        // window. Inverse polarity to the persistent-ailment gate above; reads
        // the effective per-tick flag, so a trail/step ability that flips No
        // Move Facetank off mid-fight resumes the normal 10-second expiry.
        if !block_persistent_decay && is_no_move_persistent_buff(key) {
            instance.remaining_sec =
                compute_simple_remaining_sec_for_status(key, instance.stacks, instance.next_decay_at, time);
            return true;
        }
        if status_tick_sec(key).is_some()
            && instance
                .next_tick_at
                .is_some_and(|tick| tick <= time + 1e-9)
            && instance
                .next_decay_at
                .is_some_and(|decay| decay <= time + 1e-9)
        {
            instance.remaining_sec =
                compute_simple_remaining_sec_for_status(key, instance.stacks, instance.next_decay_at, time);
            return true;
        }
        let previous_stacks = instance.stacks;
        let posture_strip = if negative_ailment_decay_mult > 1.0
            && crate::composable::posture::is_negative_ailment(key)
        {
            negative_ailment_decay_mult
        } else {
            1.0
        };
        let recovery_bonus = if recoverable_recovery_mult > 1.0
            && crate::composable::posture::is_defiled_ground_recoverable(key)
        {
            recoverable_recovery_mult
        } else {
            1.0
        };
        let strip_per_tick = posture_strip * recovery_bonus;
        while instance
            .next_decay_at
            .is_some_and(|d| d <= time + 1e-9)
        {
            instance.stacks -= strip_per_tick;
            if let Some(owned) = instance.lich_mark_owned_stacks {
                let next_owned = (owned - strip_per_tick).max(0.0).min(instance.stacks.max(0.0));
                instance.lich_mark_owned_stacks = if next_owned > 1e-9 {
                    Some(next_owned)
                } else {
                    None
                };
            }
            if instance.stacks <= 0.0 {
                if previous_stacks > 0.0 {
                    if let Some(log) = decay_log.as_deref_mut() {
                        log.push(StatusDecayLogEntry {
                            status_id: key.clone(),
                            previous_stacks,
                            new_stacks: 0.0,
                        });
                    }
                }
                return false;
            }
            if let Some(d) = instance.next_decay_at.as_mut() {
                *d += status_decay_sec(key);
            }
        }
        if instance.stacks <= 0.0 {
            if previous_stacks > 0.0 {
                if let Some(log) = decay_log.as_deref_mut() {
                    log.push(StatusDecayLogEntry {
                        status_id: key.clone(),
                        previous_stacks,
                        new_stacks: 0.0,
                    });
                }
            }
            return false;
        }
        if instance.stacks < previous_stacks - 1e-9 {
            if let Some(log) = decay_log.as_deref_mut() {
                log.push(StatusDecayLogEntry {
                    status_id: key.clone(),
                    previous_stacks,
                    new_stacks: instance.stacks,
                });
            }
        }
        instance.remaining_sec =
            compute_simple_remaining_sec_for_status(key, instance.stacks, instance.next_decay_at, time);
        true
    });
}
