pub fn with_fortify_weight_bonus(
    stats: &crate::SimpleCombatantStats,
    fortify_weight_bonus_until: f64,
    time: f64,
) -> crate::SimpleCombatantStats {
    let mut adjusted = stats.clone();
    if fortify_weight_bonus_until > 0.0 && fortify_weight_bonus_until > time {
        adjusted.weight *= 1.05;
    }
    adjusted
}

#[cfg(test)]
pub fn with_active_weight_bonuses(
    stats: &crate::SimpleCombatantStats,
    fortify_weight_bonus_until: f64,
    harden_active_until: f64,
    reflect_active_until: f64,
    time: f64,
) -> crate::SimpleCombatantStats {
    with_active_weight_bonuses_and_static_factor(
        stats,
        fortify_weight_bonus_until,
        harden_active_until,
        reflect_active_until,
        time,
        1.0,
    )
}

/// Variant that also applies a static (time-independent) weight factor.
/// Used by Gourmandizer's compare-only build-time weight bonus (factor =
/// 1 + gourmandizer_bonus_pct / 100).
pub fn with_active_weight_bonuses_and_static_factor(
    stats: &crate::SimpleCombatantStats,
    fortify_weight_bonus_until: f64,
    harden_active_until: f64,
    reflect_active_until: f64,
    time: f64,
    static_weight_factor: f64,
) -> crate::SimpleCombatantStats {
    let mut adjusted = with_fortify_weight_bonus(stats, fortify_weight_bonus_until, time);
    if harden_active_until > 0.0 && harden_active_until > time {
        adjusted.weight *= 1.35;
    }
    adjusted.has_reflect = reflect_active_until > 0.0 && reflect_active_until > time;
    if static_weight_factor > 0.0 && (static_weight_factor - 1.0).abs() > 1e-9 {
        adjusted.weight *= static_weight_factor;
    }
    adjusted
}

/// TS parity: `getStatusDefinition("Defensive_Status")` in
/// `combatPrimitives.ts` gives `weightBoostPerStackPct: 10`, combined with the
/// `durationOnly` stack-cap in `combatMath.ts:149-151` (stacks clamped to
/// `[0,1]`). Broodwatcher always applies Defensive_Status in durationOnly
/// mode, so any non-zero stacks yields a flat +10% weight bonus.
///
/// Returns a multiplicative factor (1.0 when inactive). A status is only
/// considered inactive when `stacks <= 0` OR `remaining_sec <= 0`. Caller
/// guarantees the statuses map is up-to-date for the current tick.
pub fn defensive_status_weight_factor(
    statuses: &std::collections::BTreeMap<String, crate::SimpleStatusInstance>,
) -> f64 {
    let instance = match statuses.get("Defensive_Status") {
        Some(i) => i,
        None => return 1.0,
    };
    if instance.stacks <= 0.0 || instance.remaining_sec <= 0.0 {
        return 1.0;
    }
    // TS parity: durationOnly caps effective stacks to min(stacks, 1).
    // Broodwatcher always uses durationOnly; for non-durationOnly callers
    // (which don't exist yet) we keep the same 1-cap to stay conservative.
    let effective_stacks = instance.stacks.clamp(0.0, 1.0);
    1.0 + 0.10 * effective_stacks
}

/// TS parity: `getGourmandizerWeightBonusPctFromFillPct` in
/// `src/engine/compareHungerMath.ts`. Linear ramp 0% bonus at ≤100% fill to
/// 15% at ≥125% fill. Returns a multiplier factor (e.g. 1.15 for 125%).
pub fn gourmandizer_weight_factor_from_fill_pct(fill_pct: f64) -> f64 {
    if !fill_pct.is_finite() || fill_pct <= 100.0 {
        return 1.0;
    }
    let capped = fill_pct.min(125.0);
    let progress = (capped - 100.0) / 25.0;
    1.0 + 0.15 * progress
}

pub fn scale_active_cooldown(
    stats: &crate::SimpleCombatantStats,
    base_sec: f64,
) -> f64 {
    let multiplier = if stats.active_cooldown_multiplier > 0.0 {
        stats.active_cooldown_multiplier
    } else {
        1.0
    };
    base_sec * multiplier
}
