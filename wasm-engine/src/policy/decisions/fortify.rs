//! Built-in Fortify decision.
//!
//! Reference: `ability_fortify` in `src/pages/referenceContent.ts`.
//!
//! Value composition (pillar 3a — `utility()` is internally
//! decomposable, externally a single number):
//!
//! - **Cleanse value** — for each removable status currently on
//!   the actor, sum the projected DoT damage, regen-disruption HP
//!   loss, and bite-cooldown debuff that the actor would suffer
//!   *if Fortify were not used*. That's how much HP-equivalent
//!   value a clean now would save.
//! - **Self-buff value** — Fortify gives 5 % effective weight for
//!   9 s. Translated to outgoing-damage gain: `damage_in_window ×
//!   (weight_ratio_with_buff / weight_ratio_now − 1)`. We skip
//!   modeling the symmetric incoming-damage reduction at this
//!   layer; the live engine's full sim covers it through breath
//!   resistance / weight ratios.
//! - **Immunity value** — 9 s status-immunity window. Estimated
//!   as the number of incoming applies the opponent could deliver
//!   in that window. The light projection does not model
//!   ability-driven applies, so this contribution is approximated
//!   from the opponent's `on_hit_statuses` list and bite cadence.
//!
//! ReallyFast hard gate: ≥ 15 total removable stacks (matches the
//! existing `policy_framework::should_activate_fortify` invariant
//! and the documented Reference text).
//!
//! This file is the **only** place Fortify-specific policy logic
//! lives. The engine never special-cases Fortify by name.

use crate::policy::state::{PolicyState, PolicyValue};
use crate::policy::traits::{TimedDecision, POLICY_SEARCH_DELAY_KEY};
use crate::statuses::compute_simple_dot_damage;

/// Status ids that Fortify removes on activation.
/// Mirrors `is_fortify_removable_status` in `statuses.rs` —
/// duplicated here because the policy layer is intentionally
/// independent of the live engine module structure.
const REMOVABLE_STATUS_IDS: &[&str] = &[
    "Bleed_Status",
    "Burn_Status",
    "Poison_Status",
    "Corrosion_Status",
    "Necropoison_Status",
    "Frostbite_Status",
    "Disease_Status",
    "Drowsy_Status",
    "Fear_Status",
    "Heartbroken_Status",
    "Confusion_Status",
    "Bad_Omen",
    "Aftershock",
    "Sticky_Teeth_Status",
    "Hypothermia_Status",
    "Heat_Wave_Status",
    "Shredded_Wings",
    "Injury_Status",
    "Broken_Bones_Status",
    "Torn_Ligaments_Status",
    "Deep_Wounds_Status",
    "Slow_Status",
];

/// ReallyFast threshold (matches Reference text).
const REALLY_FAST_MIN_TOTAL_STACKS: f64 = 15.0;

/// Active duration of the Fortify buff window.
const FORTIFY_ACTIVE_SEC: f64 = 9.0;

/// Effective weight bonus while Fortify is active.
const FORTIFY_WEIGHT_BONUS_PCT: f64 = 5.0;

/// Stable id under which this decision registers.
pub const FORTIFY_DECISION_ID: &str = "builtin.fortify";

/// Built-in Fortify timed decision.
///
/// Construct with [`FortifyDecision::new`]. Stateless — the actor's
/// runtime state lives entirely in the [`PolicyState`] passed to
/// each method. That keeps it cheap to clone and trivially
/// thread-safe (pillar: object-safe Send + Sync).
#[derive(Debug, Default, Clone)]
pub struct FortifyDecision;

impl FortifyDecision {
    pub fn new() -> Self {
        Self
    }
}

impl TimedDecision for FortifyDecision {
    fn id(&self) -> &str {
        FORTIFY_DECISION_ID
    }

    fn utility(&self, state: &PolicyState) -> f64 {
        cleanse_value(state) + self_buff_value(state) + immunity_value(state)
    }

    fn is_available(&self, state: &PolicyState) -> bool {
        state.self_side.is_idle_for(state.time, FORTIFY_DECISION_ID)
            && total_removable_stacks(state) > 0.0
    }

    fn really_fast_gate(&self, state: &PolicyState) -> Option<bool> {
        if !state.self_side.is_idle_for(state.time, FORTIFY_DECISION_ID) {
            return Some(false);
        }
        Some(total_removable_stacks(state) >= REALLY_FAST_MIN_TOTAL_STACKS)
    }
}

fn total_removable_stacks(state: &PolicyState) -> f64 {
    // Skip permanent (no_decay) instances — Fortify can't strip the weather
    // cataclysms, so they don't count toward "is there enough to cleanse?".
    REMOVABLE_STATUS_IDS
        .iter()
        .filter_map(|id| state.self_side.statuses.get(*id))
        .filter(|inst| !inst.no_decay)
        .map(|inst| inst.stacks)
        .sum()
}

/// Read the candidate-search delay from `state.extras`.
///
/// `CandidateSearchPolicy` inserts the candidate's delay under
/// [`POLICY_SEARCH_DELAY_KEY`] before invoking `decision.utility`,
/// so the decision can compensate for projection blind-spots that
/// scale with delay. ReallyFast / non-search paths leave the key
/// unset → `0.0` (current-tick semantics).
///
/// Negative or non-finite values clamp to 0.
fn search_delay_sec(state: &PolicyState) -> f64 {
    state
        .extras
        .get(POLICY_SEARCH_DELAY_KEY)
        .and_then(PolicyValue::as_number)
        .map(|n| if n.is_finite() && n > 0.0 { n } else { 0.0 })
        .unwrap_or(0.0)
}

/// Expected per-status stack count the opponent would have applied
/// to the actor over the next `delay` seconds, assuming they keep
/// biting / breathing at their advertised cadence. Used by Fortify
/// to fix the projection blind-spot: light_projection only decays
/// existing statuses during a forward project, it never adds new
/// ones from opp's continued offence — so without this term the
/// utility curve falls monotonically with delay and Ideal fires at
/// t=0 even when a 10 s wait would have built far more pressure to
/// cleanse. Mirrors `immunity_value`'s bite + breath cadence
/// reasoning but applies the result to the *firing-time* stacks
/// instead of the post-firing immunity window.
///
/// Bite-cadence applies and breath-cadence applies are summed. Both
/// are clamped by available windows (breath capacity, bite cooldown
/// shape). Burst-apply abilities (Cause Fear, Poison Area, Frost
/// Nova, …) are *not* modelled here yet — their cooldowns are not
/// plumbed into `PolicyState` today. The conservative omission
/// under-estimates pressure rather than over-fires, which matches
/// the "don't fire too early" goal.
fn opp_apply_during_delay(state: &PolicyState, status_id: &str, delay: f64) -> f64 {
    if delay <= 0.0 {
        return 0.0;
    }
    let opp = &state.opponent;
    let mut total = 0.0;

    let bite_cd = opp.stats.bite_cooldown.max(0.1);
    let bites = (delay / bite_cd).floor().max(0.0);
    if bites > 0.0 {
        for applied in &opp.stats.on_hit_statuses {
            if applied.status_id == status_id {
                total += applied.stacks * bites;
            }
        }
    }

    if let Some(breath) = &opp.breath {
        const BREATH_TICK_SEC: f64 = 0.5;
        let breath_window = delay.min(opp.breath_capacity.max(0.0));
        let breath_ticks = (breath_window / BREATH_TICK_SEC).floor().max(0.0);
        if breath_ticks > 0.0 {
            for applied in &breath.special_statuses {
                if applied.status_id == status_id {
                    total += applied.stacks * breath_ticks;
                }
            }
        }
    }

    total
}

/// Cleanse value = projected DoT damage that the actor would suffer
/// over the next ~9 s if Fortify is NOT fired at the candidate
/// firing time. Higher value ⇒ more pressure on the actor at that
/// time ⇒ stronger reason to fire then.
///
/// **Fix for "Fortify fires too early" (P4):** the *firing-time*
/// stacks are not the projected stacks alone. Light projection only
/// decays existing statuses across the wait; it doesn't model opp's
/// continued bites / breath applies during `[now, now+delay]`. Add
/// the expected applies opp would have landed by then. Without this
/// correction the utility curve falls monotonically with delay
/// (decay is a one-way trip in the projection) and Ideal collapses
/// to "fire at t=0" even when waiting another N seconds would put
/// far more removable pressure on the actor.
fn cleanse_value(state: &PolicyState) -> f64 {
    const HORIZON_SEC: f64 = 9.0;
    const TICK_SEC: f64 = 3.0;
    let max_hp = state.self_side.stats.health.max(1.0);
    let delay = search_delay_sec(state);
    let mut value = 0.0;

    let ticks = (HORIZON_SEC / TICK_SEC).floor() as i64;
    for status_id in REMOVABLE_STATUS_IDS {
        let projected_stacks = state.self_side.status_stacks(status_id);
        let accumulated_during_wait = opp_apply_during_delay(state, status_id, delay);
        let mut stacks = projected_stacks + accumulated_during_wait;
        if stacks <= 0.0 {
            continue;
        }
        // Sum DoT contribution over the ticks for which the status
        // would still have stacks (decay 1 per tick).
        for _ in 0..ticks {
            if stacks <= 0.0 {
                break;
            }
            value += compute_simple_dot_damage(max_hp, status_id, stacks, TICK_SEC);
            stacks -= 1.0;
        }
    }
    value
}

/// Self-buff value = expected outgoing-damage gain from the +5%
/// effective weight over a 9 s active window.
fn self_buff_value(state: &PolicyState) -> f64 {
    let actor = &state.self_side;
    let opp = &state.opponent;
    let bite_cd = actor.stats.bite_cooldown.max(0.1);
    let bites_in_window = (FORTIFY_ACTIVE_SEC / bite_cd).floor().max(0.0);
    if bites_in_window <= 0.0 {
        return 0.0;
    }
    // Damage formula (mirrors `compute_melee_damage_per_hit`):
    // `damage * (1 + weight_ratio) / 2`, where weight_ratio is
    // `min(attacker_weight / defender_weight, 3)`.
    let aw = actor.stats.weight.max(1.0);
    let dw = opp.stats.weight.max(1.0);
    let ratio_now = (aw / dw).min(3.0);
    let buffed_aw = aw * (1.0 + FORTIFY_WEIGHT_BONUS_PCT / 100.0);
    let ratio_buffed = (buffed_aw / dw).min(3.0);
    let dmg_now = actor.stats.damage * (1.0 + ratio_now) / 2.0;
    let dmg_buffed = actor.stats.damage * (1.0 + ratio_buffed) / 2.0;
    let per_bite_gain = (dmg_buffed - dmg_now).max(0.0);
    per_bite_gain * bites_in_window
}

/// Immunity value — HP-equivalent damage prevented by the 9 s
/// total-immunity window. Reference text: Fortify "grants immunity
/// to all negative status applications for 9 s," not just on-hit.
///
/// Two sources of incoming applies are modelled:
///
/// - **Bite-applied** statuses from `opponent.stats.on_hit_statuses`,
///   delivered once per opponent bite (bite cadence over the window).
/// - **Breath-applied** statuses from `opponent.breath.special_statuses`,
///   delivered once per breath damage tick (0.5 s cadence in the live
///   engine). Capacity limits are not modelled at this layer; the
///   estimate is conservative for short-capacity breaths.
///
/// Per-status accumulated stacks `N` (sum across all blocked applies
/// in the window) translate to total decay-integrated DoT damage:
/// `N*(N+1)/2 * per_stack_per_tick` — i.e. the actor would carry the
/// pile post-window and tick it down (1 stack/3 s for DoT statuses).
/// Non-DoT statuses (Slow, Drowsy, …) score 0 here; their disruption
/// value is not in scope for this heuristic.
fn immunity_value(state: &PolicyState) -> f64 {
    /// Live engine breath damage tick cadence.
    const BREATH_TICK_SEC: f64 = 0.5;
    /// DoT decay cadence: 1 stack removed per 3 s for every DoT
    /// status. Same constant `cleanse_value` integrates over.
    const DOT_TICK_SEC: f64 = 3.0;

    let opp = &state.opponent;
    let max_hp = state.self_side.stats.health.max(1.0);

    let bite_cd = opp.stats.bite_cooldown.max(0.1);
    let opp_bites = (FORTIFY_ACTIVE_SEC / bite_cd).floor().max(0.0);
    // Breath ticks are gated by remaining capacity at the projected
    // state — at long projection delays the opponent may have run
    // its breath dry, so we shouldn't count immunity value against
    // breath that won't fire.
    let breath_fire_window = FORTIFY_ACTIVE_SEC.min(opp.breath_capacity.max(0.0));
    let breath_ticks = (breath_fire_window / BREATH_TICK_SEC).floor();

    let mut applied_stacks: std::collections::BTreeMap<&str, f64> =
        std::collections::BTreeMap::new();
    for applied in &opp.stats.on_hit_statuses {
        if !REMOVABLE_STATUS_IDS.contains(&applied.status_id.as_str()) {
            continue;
        }
        *applied_stacks.entry(applied.status_id.as_str()).or_default() +=
            applied.stacks * opp_bites;
    }
    if let Some(breath) = &opp.breath {
        for applied in &breath.special_statuses {
            if !REMOVABLE_STATUS_IDS.contains(&applied.status_id.as_str()) {
                continue;
            }
            *applied_stacks.entry(applied.status_id.as_str()).or_default() +=
                applied.stacks * breath_ticks;
        }
    }

    let mut value = 0.0;
    for (status_id, stacks) in applied_stacks {
        if stacks <= 0.0 {
            continue;
        }
        let per_stack_per_tick = compute_simple_dot_damage(max_hp, status_id, 1.0, DOT_TICK_SEC);
        if per_stack_per_tick <= 0.0 {
            continue;
        }
        value += per_stack_per_tick * stacks * (stacks + 1.0) / 2.0;
    }
    value
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::contracts::SimpleAppliedStatus;
    use crate::policy::state::PolicyState;
    use crate::policy::testing::{default_state, status_instance};

    /// Fortify utility tests assume a 50-damage actor (smaller than the
    /// default 100) so the buff value contribution is visible without
    /// dwarfing cleanse / immunity terms.
    fn fresh_state() -> PolicyState {
        let mut s = default_state();
        s.self_side.stats.damage = 50.0;
        s.opponent.stats.damage = 50.0;
        s
    }

    fn instance(stacks: f64) -> crate::contracts::SimpleStatusInstance {
        status_instance(stacks)
    }

    #[test]
    fn id_is_in_builtin_namespace() {
        assert_eq!(FortifyDecision::new().id(), "builtin.fortify");
    }

    #[test]
    fn unavailable_when_no_removable_statuses() {
        let state = fresh_state();
        let d = FortifyDecision::new();
        assert!(!d.is_available(&state));
    }

    #[test]
    fn unavailable_when_cooldown_pending() {
        let mut state = fresh_state();
        state
            .self_side
            .statuses
            .insert("Bleed_Status".to_string(), instance(5.0));
        state
            .self_side
            .cooldowns
            .insert(FORTIFY_DECISION_ID.to_string(), 90.0);
        state.time = 30.0;
        let d = FortifyDecision::new();
        assert!(!d.is_available(&state));
    }

    #[test]
    fn really_fast_gate_fires_at_or_above_fifteen_total_stacks() {
        let mut state = fresh_state();
        // 5 + 5 + 5 = 15 total → fire.
        state
            .self_side
            .statuses
            .insert("Bleed_Status".to_string(), instance(5.0));
        state
            .self_side
            .statuses
            .insert("Burn_Status".to_string(), instance(5.0));
        state
            .self_side
            .statuses
            .insert("Poison_Status".to_string(), instance(5.0));
        let d = FortifyDecision::new();
        assert_eq!(d.really_fast_gate(&state), Some(true));
    }

    #[test]
    fn really_fast_gate_skips_below_threshold() {
        let mut state = fresh_state();
        // 5 + 5 = 10 < 15 → skip.
        state
            .self_side
            .statuses
            .insert("Bleed_Status".to_string(), instance(5.0));
        state
            .self_side
            .statuses
            .insert("Burn_Status".to_string(), instance(5.0));
        let d = FortifyDecision::new();
        assert_eq!(d.really_fast_gate(&state), Some(false));
    }

    #[test]
    fn really_fast_gate_skips_during_cooldown_even_with_huge_pressure() {
        let mut state = fresh_state();
        state
            .self_side
            .statuses
            .insert("Bleed_Status".to_string(), instance(50.0));
        state
            .self_side
            .cooldowns
            .insert(FORTIFY_DECISION_ID.to_string(), 90.0);
        state.time = 5.0;
        let d = FortifyDecision::new();
        assert_eq!(d.really_fast_gate(&state), Some(false));
    }

    #[test]
    fn utility_zero_when_no_pressure_no_buff() {
        let state = fresh_state();
        let d = FortifyDecision::new();
        // No statuses, no opponent on-hit, but self-buff still
        // contributes (3 bites × buff gain). It should be small but
        // strictly > 0.
        let u = d.utility(&state);
        assert!(
            u > 0.0,
            "self-buff value alone should be positive: got {u}"
        );
    }

    #[test]
    fn utility_increases_monotonically_with_burn_stacks() {
        let mut state = fresh_state();
        let d = FortifyDecision::new();

        let u_clean = d.utility(&state);
        state
            .self_side
            .statuses
            .insert("Burn_Status".to_string(), instance(3.0));
        let u_3 = d.utility(&state);
        state
            .self_side
            .statuses
            .insert("Burn_Status".to_string(), instance(10.0));
        let u_10 = d.utility(&state);

        assert!(u_3 > u_clean, "more pressure → higher utility");
        assert!(u_10 > u_3, "still more pressure → still higher utility");
    }

    #[test]
    fn utility_grows_with_opponent_on_hit_payload() {
        let mut state = fresh_state();
        let d = FortifyDecision::new();
        let baseline = d.utility(&state);

        state
            .opponent
            .stats
            .on_hit_statuses
            .push(SimpleAppliedStatus {
                status_id: "Bleed_Status".to_string(),
                stacks: 5.0,
                source_ability: None,
            });
        let with_payload = d.utility(&state);
        assert!(
            with_payload > baseline,
            "immunity value must lift utility when opp has on-hit Bleed: \
             baseline={baseline}, with_payload={with_payload}"
        );
    }

    /// Reference text — Fortify "grants immunity to ALL negative
    /// status applications for 9 s." Breath-applied DoTs must
    /// contribute to immunity value, not only on-hit applications.
    #[test]
    fn immunity_value_counts_breath_applied_statuses() {
        let mut without_breath = fresh_state();
        without_breath
            .self_side
            .statuses
            .insert("Bleed_Status".to_string(), instance(1.0)); // make it available
        let baseline = FortifyDecision::new().utility(&without_breath);

        let mut with_breath = without_breath.clone();
        with_breath.opponent.breath_capacity = 30.0; // enough fire-time to cover a 9 s window
        with_breath.opponent.breath = Some(crate::contracts::SimpleBreathProfile {
            dps_pct: 0.0,
            capacity: 100.0,
            regen_rate: 0.0,
            crit_chance_pct: 0.0,
            chain: 0.0,
            chain_max_stacks: 0.0,
            special_kind: None,
            self_heal_pct: 0.0,
            cleanse_stacks: 0.0,
            lance_damage_pct: 0.0,
            lance_charge_sec: 0.0,
            lance_cooldown_sec: 0.0,
            lance_status_id: None,
            auto_fire_delay_sec: 0.0,
            auto_fire_cooldown_sec: 0.0,
            charges_max: 0.0,
            charge_regen_sec: 0.0,
            special_statuses: vec![SimpleAppliedStatus {
                status_id: "Burn_Status".to_string(),
                stacks: 0.5,
                source_ability: None,
            }],
        });
        let with = FortifyDecision::new().utility(&with_breath);
        assert!(
            with > baseline,
            "breath-applied negative statuses must lift immunity_value: \
             baseline={baseline}, with={with}"
        );
    }

    /// Full decay-integrated DoT damage: N stacks of a 3 s-tick
    /// status decay-tick at N + (N-1) + … + 1 stack-ticks total.
    /// The utility should reflect that quadratic-ish growth, not the
    /// flat single-tick approximation that preceded this rewrite.
    #[test]
    fn immunity_value_scales_quadratically_with_accumulated_stacks() {
        let make_state = |stacks_per_bite: f64| {
            let mut s = fresh_state();
            // Trigger availability so utility is computed.
            s.self_side
                .statuses
                .insert("Bleed_Status".to_string(), instance(1.0));
            s.opponent
                .stats
                .on_hit_statuses
                .push(SimpleAppliedStatus {
                    status_id: "Burn_Status".to_string(),
                    stacks: stacks_per_bite,
                    source_ability: None,
                });
            s
        };
        let d = FortifyDecision::new();
        // Doubling stacks-per-bite should more than double the
        // immunity contribution (since damage ~ N*(N+1)/2).
        let single = d.utility(&make_state(1.0));
        let double = d.utility(&make_state(2.0));
        let baseline = d.utility(&fresh_state_with_bleed_for_availability());
        let single_immunity = single - baseline;
        let double_immunity = double - baseline;
        assert!(
            double_immunity > 2.0 * single_immunity,
            "stack accumulation should grow super-linearly: \
             single={single_immunity}, double={double_immunity}"
        );
    }

    /// Non-DoT negative statuses (Slow, Drowsy) carry no per-tick
    /// damage, so they must not contribute to the DoT-equivalent
    /// immunity heuristic. (Their disruption value is out of scope
    /// for this approximation — flagged in the docstring.)
    #[test]
    fn immunity_value_ignores_non_dot_negative_statuses() {
        let mut state = fresh_state_with_bleed_for_availability();
        state
            .opponent
            .stats
            .on_hit_statuses
            .push(SimpleAppliedStatus {
                status_id: "Slow_Status".to_string(),
                stacks: 5.0,
                source_ability: None,
            });
        let with_slow = FortifyDecision::new().utility(&state);
        let baseline = FortifyDecision::new().utility(&fresh_state_with_bleed_for_availability());
        assert!(
            (with_slow - baseline).abs() < 1e-9,
            "Slow_Status carries no DoT, so immunity_value must not budge: \
             baseline={baseline}, with_slow={with_slow}"
        );
    }

    fn fresh_state_with_bleed_for_availability() -> PolicyState {
        let mut s = fresh_state();
        s.self_side
            .statuses
            .insert("Bleed_Status".to_string(), instance(1.0));
        s
    }
}
