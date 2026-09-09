//! The defender chain - everything that stands between a damage source and the
//! victim's HP.
//!
//! Every site that takes HP off a side routes its amount through
//! [`resolve_incoming_damage`]: bites and the damage they reflect back, breath
//! ticks and the Lance impact, DOT totals, damage trails, the Lance aura and
//! Grim Lariat. The user hooks run first, then the built-in reductions the
//! victim's statuses carry, so a reduction added here reaches every damage kind
//! without touching a phase.

use crate::contracts::{CombatLogEntry, SimpleCombatantStats};

use super::user_dispatch::run_user_pre_damage_hooks;
use super::CombatSide;

/// Engine id of the status Guardians Passage applies.
pub const GUARDIAN_SEAL_STATUS: &str = "Guardian_Seal_Status";

/// What is left of a hit after the seal. Flat - the stack count sets how long
/// the seal lasts, not how much it takes off.
const GUARDIAN_SEAL_MULTIPLIER: f64 =
    1.0 - crate::spec_constants::GUARDIAN_SEAL_DAMAGE_REDUCTION_PCT / 100.0;

/// Whether `side` currently holds the seal.
pub fn side_is_sealed(side: &CombatSide) -> bool {
    side.statuses
        .get(GUARDIAN_SEAL_STATUS)
        .is_some_and(|instance| instance.stacks > 0.0)
}

/// Whether the chain can move the number for this pair.
///
/// The sites that apply damage first and correct it afterwards (DOT totals,
/// reflected damage, trail ticks) ask this before running the pass; a false
/// answer means the amount would come back unchanged.
pub fn chain_may_move_damage(
    victim: &CombatSide,
    a_stats: &SimpleCombatantStats,
    b_stats: &SimpleCombatantStats,
) -> bool {
    side_is_sealed(victim)
        || victim.overshield > 0.0
        || !a_stats.user_ability_ids.is_empty()
        || !b_stats.user_ability_ids.is_empty()
}

/// Take what the overshield can from one hit and return what is left for HP.
///
/// The bar stands above health and is spent before it: a hit smaller than the
/// bar reaches HP as nothing, a larger one reaches HP as the remainder. Nothing
/// refills it - health regeneration does not, and a hit that empties it leaves
/// it empty for the rest of the fight unless something grants it again.
pub fn absorb_with_overshield(victim: &mut CombatSide, damage: f64) -> f64 {
    if damage <= 0.0 || victim.overshield <= 0.0 {
        return damage.max(0.0);
    }
    let absorbed = damage.min(victim.overshield);
    victim.overshield -= absorbed;
    damage - absorbed
}

/// Run the defender chain over one damage event and return what reaches HP.
#[allow(clippy::too_many_arguments)]
pub fn resolve_incoming_damage(
    dealer: &mut CombatSide,
    victim: &mut CombatSide,
    dealer_stats: &SimpleCombatantStats,
    victim_stats: &SimpleCombatantStats,
    time: f64,
    raw_damage: f64,
    engine_damage: f64,
    source_ability: &str,
    combat_log: &mut Vec<CombatLogEntry>,
    record_trace: bool,
    dealer_label: &str,
    victim_label: &str,
) -> f64 {
    let after_hooks = run_user_pre_damage_hooks(
        dealer,
        victim,
        dealer_stats,
        victim_stats,
        time,
        raw_damage,
        engine_damage,
        source_ability,
        combat_log,
        record_trace,
        dealer_label,
        victim_label,
    );
    // The seal runs last of the reductions, on whatever the victim's others
    // left. The overshield is not a reduction: it stands in front of HP and
    // takes what it can of whatever the reductions settled on.
    let after_seal = if side_is_sealed(victim) {
        after_hooks * GUARDIAN_SEAL_MULTIPLIER
    } else {
        after_hooks
    };
    absorb_with_overshield(victim, after_seal)
}
