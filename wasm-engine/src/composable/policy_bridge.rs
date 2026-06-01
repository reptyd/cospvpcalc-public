//! Bridge between the live composable engine and the policy decision
//! engine under `crate::policy::`.
//!
//! Phase 2 of the policy migration: each ability that has been moved
//! over to a `TimedDecision` impl uses this bridge to consult the
//! policy engine instead of `policy_framework::should_activate_*`.
//! Built-in ability registries are constructed once (lazy static) and
//! shared across calls.
//!
//! ## Why a bridge module
//!
//! The policy engine is intentionally decoupled from
//! `composable::CombatSide` (pillar 4 — narrow public API surface).
//! The bridge translates `CombatSide` into the policy engine's
//! [`PolicyState`] and back, so the engine itself never imports any
//! `composable::` types.

use std::sync::OnceLock;

use crate::contracts::{SimpleBreathProfile, SimpleCombatantStats};
use crate::policy::decisions::{
    life_leech::LEECH_VALUE_EXTRA_KEY,
    rewind::{RESTORED_HP_DELTA_KEY, RESTORED_STATUS_DELTA_KEY},
    wardens_rage::CURRENT_STATE_EXTRA_KEY as WR_ON_KEY,
    AdrenalineDecision, CocoonDecision, FortifyDecision, HunkerDecision, HuntersCurseDecision,
    LifeLeechDecision, ReflectDecision, RewindDecision, UnbridledRageDecision,
    WardensRageDecision,
};
use crate::policy::light_projection::CombatStateProjection;
use crate::policy::registry::{DecisionRegistry, PolicyRegistry};
use crate::policy::state::{PolicySide, PolicyState, PolicyValue};
use crate::policy::timing_mode::TimingMode;
use crate::policy::traits::TimedChoice;

use super::CombatSide;

/// Lazily-initialised registry of built-in decisions (Fortify, Life
/// Leech, …). Constructed once on first use and shared across all
/// engine invocations — `OnceLock` guarantees thread-safe init even
/// though combat sims are single-threaded today.
fn decision_registry() -> &'static DecisionRegistry {
    static REG: OnceLock<DecisionRegistry> = OnceLock::new();
    REG.get_or_init(|| {
        let mut reg = DecisionRegistry::new();
        reg.register(Box::new(AdrenalineDecision::new()));
        reg.register(Box::new(CocoonDecision::new()));
        reg.register(Box::new(FortifyDecision::new()));
        reg.register(Box::new(HuntersCurseDecision::new()));
        reg.register(Box::new(LifeLeechDecision::new()));
        reg.register(Box::new(ReflectDecision::new()));
        reg.register(Box::new(RewindDecision::new()));
        reg.register(Box::new(UnbridledRageDecision::new()));
        // Toggle decisions:
        reg.register_toggle(Box::new(HunkerDecision::new()));
        reg.register_toggle(Box::new(WardensRageDecision::new()));
        reg
    })
}

/// Lazily-initialised registry of built-in policies (the five
/// timing modes).
fn policy_registry() -> &'static PolicyRegistry {
    static REG: OnceLock<PolicyRegistry> = OnceLock::new();
    REG.get_or_init(PolicyRegistry::with_builtins)
}

/// Shared projector instance.
fn projector() -> &'static CombatStateProjection {
    static PROJ: OnceLock<CombatStateProjection> = OnceLock::new();
    PROJ.get_or_init(|| CombatStateProjection)
}

/// Map from `SimpleAbilityTimingMode` to the engine's `TimingMode`.
pub fn map_timing_mode(mode: crate::contracts::SimpleAbilityTimingMode) -> TimingMode {
    use crate::contracts::SimpleAbilityTimingMode as M;
    match mode {
        M::ReallyFast => TimingMode::ReallyFast,
        M::Fast => TimingMode::Fast,
        M::SemiIdeal => TimingMode::SemiIdeal,
        M::Ideal => TimingMode::Ideal,
        M::Extreme => TimingMode::Extreme,
    }
}

/// Build a `PolicySide` snapshot from a live `CombatSide`. The policy
/// engine treats this snapshot as immutable — modifications inside
/// `decide_*` never affect the live `CombatSide`.
///
/// Cooldown / active-until plumbing for every migrated decision is
/// populated here, so individual call sites no longer need ad-hoc
/// `cooldowns.insert(...)` rituals before invoking the bridge. Adding
/// a new decision means adding one entry to this function and the
/// corresponding `_cooldown_until` / `_active_until` field on
/// `CombatSide`.
pub fn build_policy_side(
    side: &CombatSide,
    stats: &SimpleCombatantStats,
    breath: Option<&SimpleBreathProfile>,
    extras: impl IntoIterator<Item = (&'static str, PolicyValue)>,
) -> PolicySide {
    use crate::policy::decisions;
    let mut cooldowns = std::collections::BTreeMap::new();
    let mut active_until = std::collections::BTreeMap::new();

    cooldowns.insert(
        decisions::adrenaline::ADRENALINE_DECISION_ID.to_string(),
        side.adrenaline_cooldown_until,
    );
    active_until.insert(
        decisions::adrenaline::ADRENALINE_DECISION_ID.to_string(),
        side.adrenaline_active_until,
    );
    cooldowns.insert(
        decisions::cocoon::COCOON_DECISION_ID.to_string(),
        side.cocoon_cooldown_until,
    );
    cooldowns.insert(
        decisions::fortify::FORTIFY_DECISION_ID.to_string(),
        side.fortify_cooldown_until,
    );
    cooldowns.insert(
        decisions::hunters_curse::HUNTERS_CURSE_DECISION_ID.to_string(),
        side.hunters_curse_cooldown_until,
    );
    active_until.insert(
        decisions::hunters_curse::HUNTERS_CURSE_DECISION_ID.to_string(),
        side.hunters_curse_active_until,
    );
    cooldowns.insert(
        decisions::life_leech::LIFE_LEECH_DECISION_ID.to_string(),
        side.life_leech_cooldown_until,
    );
    active_until.insert(
        decisions::life_leech::LIFE_LEECH_DECISION_ID.to_string(),
        side.life_leech_active_until,
    );
    cooldowns.insert(
        decisions::reflect::REFLECT_DECISION_ID.to_string(),
        side.reflect_cooldown_until,
    );
    active_until.insert(
        decisions::reflect::REFLECT_DECISION_ID.to_string(),
        side.reflect_active_until,
    );
    cooldowns.insert(
        decisions::rewind::REWIND_DECISION_ID.to_string(),
        side.rewind_cooldown_until,
    );
    cooldowns.insert(
        decisions::unbridled_rage::UNBRIDLED_RAGE_DECISION_ID.to_string(),
        side.unbridled_rage_cooldown_until,
    );
    active_until.insert(
        decisions::unbridled_rage::UNBRIDLED_RAGE_DECISION_ID.to_string(),
        side.unbridled_rage_active_until,
    );
    cooldowns.insert(
        decisions::wardens_rage::WARDEN_RAGE_DECISION_ID.to_string(),
        side.warden_rage_cooldown_until,
    );

    // Sprint 5: merge per-side user-ability state. Built-in-only
    // sims have empty maps here (the ids come from the
    // `user.<...>` namespace), so this is free for legacy callers.
    for (id, until) in &side.user_cooldowns {
        cooldowns.insert(id.clone(), *until);
    }
    for (id, until) in &side.user_active_until {
        active_until.insert(id.clone(), *until);
    }

    let mut policy_side = PolicySide {
        stats: stats.clone(),
        hp: side.hp,
        statuses: side.statuses.clone(),
        cooldowns,
        active_until,
        breath_capacity: side.breath_capacity,
        breath: breath.cloned(),
        next_hit: side.next_hit,
        next_breath: side.next_breath,
        // Phase 5 / G9: surface the committed posture as a label so
        // `<side>.is_posture.<P>` resolves against the live snapshot.
        posture: crate::composable::posture::posture_label(side.posture_current).to_string(),
        extras: side.user_extras.clone(),
        // Round 46 / B2: snapshot the sliding-window logs so
        // `self.damage_taken_last.<N>` resolves at decision/apply time.
        recent_damage_taken: side.recent_damage_taken.clone(),
        recent_damage_dealt: side.recent_damage_dealt.clone(),
    };
    for (key, value) in extras {
        policy_side.extras.insert(key.to_string(), value);
    }
    policy_side
}

/// Convenience: ask whether a given decision id should fire NOW for
/// the actor side at the given simulation time. Returns `true` only
/// for [`TimedChoice::Now`]. Wait/Skip both map to `false` (the live
/// engine re-checks every tick — same effective behavior).
#[allow(clippy::too_many_arguments)]
pub fn should_activate_now(
    decision_id: &str,
    self_side: PolicySide,
    opponent: PolicySide,
    time: f64,
    mode: TimingMode,
) -> bool {
    let Some(decision) = decision_registry().get(decision_id) else {
        return false;
    };
    let Some(policy) = policy_registry().for_mode(mode) else {
        return false;
    };
    let state = PolicyState {
        self_side,
        opponent,
        time,
        extras: Default::default(),
    };
    matches!(
        policy.decide(decision, &state, projector()),
        TimedChoice::Now
    )
}

/// Helper for ability-specific extras key/value inserts at the call
/// site. Returns a tuple builder for ergonomic chaining.
pub fn life_leech_value_extra(value: f64) -> (&'static str, PolicyValue) {
    (LEECH_VALUE_EXTRA_KEY, PolicyValue::Number(value))
}

/// Extras builder for Warden's Rage current toggle state. The
/// decision uses this in `is_eligible` to grandfather "stay on"
/// past the cooldown gate (cooldown only applies to fresh turn-ons).
pub fn warden_rage_currently_on_extra(currently_on: bool) -> (&'static str, PolicyValue) {
    (WR_ON_KEY, PolicyValue::Bool(currently_on))
}

/// Extras builder for Hunker's current toggle state. The decision
/// applies hysteresis (a max-HP-fraction dead-zone) using this
/// flag — staying ON unless the raw on/off delta drops below
/// `-dead_zone`, and staying OFF unless it climbs above `+dead_zone`.
/// Stops the per-tick flicker in long fights when blocked-incoming
/// ≈ lost-outgoing. The key is read from `self_side.extras`; absent
/// ⇒ treated as `false` (off).
pub fn hunker_currently_on_extra(currently_on: bool) -> (&'static str, PolicyValue) {
    (
        crate::policy::decisions::hunker::CURRENTLY_ON_EXTRA_KEY,
        PolicyValue::Bool(currently_on),
    )
}

/// Extras builders for the Rewind decision's snapshot inputs.
/// `restored_hp_delta` is the *post-cap* HP gain Rewind would
/// produce if fired now (can be negative if the snapshot HP is
/// below current HP). `status_count_delta` is `current_count -
/// snapshot_count` — positive when Rewind would strip statuses.
pub fn rewind_extras(
    restored_hp_delta: f64,
    status_count_delta: f64,
) -> [(&'static str, PolicyValue); 2] {
    [
        (RESTORED_HP_DELTA_KEY, PolicyValue::Number(restored_hp_delta)),
        (
            RESTORED_STATUS_DELTA_KEY,
            PolicyValue::Number(status_count_delta),
        ),
    ]
}

/// User-ability variant of [`should_activate_now`] — takes a
/// `&dyn TimedDecision` directly rather than looking up by id in
/// the global built-in registry. The user-ability dispatcher
/// constructs `UserDecision` adapters per spec on the fly.
pub fn user_should_activate_now(
    decision: &dyn crate::policy::traits::TimedDecision,
    self_side: PolicySide,
    opponent: PolicySide,
    time: f64,
    mode: TimingMode,
    // Round 40 / A11: scaling.<key> entries are injected here so
    // `Expr::Var { path: "scaling.<key>" }` resolves during the
    // decision (utility / is_available) eval. Empty map ⇒ no
    // scaling entries visible (pre-A11 behavior).
    extras: std::collections::BTreeMap<String, crate::policy::state::PolicyValue>,
) -> bool {
    let Some(policy) = policy_registry().for_mode(mode) else {
        return false;
    };
    let state = PolicyState {
        self_side,
        opponent,
        time,
        extras,
    };
    matches!(policy.decide(decision, &state, projector()), TimedChoice::Now)
}

/// User-ability + user-timing variant: takes BOTH a `&dyn
/// TimedDecision` and a `&dyn Policy` directly so the caller can
/// stack a user-defined policy (e.g. UserPolicy from a registered
/// UserTimingSpec) on top of a user-defined decision. Bypasses the
/// built-in policy registry entirely. Used by user_dispatch when
/// `timing_user_override` is set on the spec.
pub fn user_should_activate_with_policy(
    decision: &dyn crate::policy::traits::TimedDecision,
    policy: &dyn crate::policy::traits::Policy,
    self_side: PolicySide,
    opponent: PolicySide,
    time: f64,
    // Round 40 / A11: see `user_should_activate_now`.
    extras: std::collections::BTreeMap<String, crate::policy::state::PolicyValue>,
) -> bool {
    let state = PolicyState {
        self_side,
        opponent,
        time,
        extras,
    };
    matches!(policy.decide(decision, &state, projector()), TimedChoice::Now)
}

/// Toggle counterpart of [`should_activate_now`]: ask whether a
/// registered toggle decision should be ON for the actor side at
/// the given simulation time, under the given timing mode.
///
/// Returns `false` if the decision id is not registered or is not
/// a toggle entry, so the caller can use it as a drop-in for "is
/// the toggle on right now?" without separate availability checks.
pub fn toggle_state_now(
    decision_id: &str,
    self_side: PolicySide,
    opponent: PolicySide,
    time: f64,
    mode: TimingMode,
) -> bool {
    let Some(decision) = decision_registry().get_toggle(decision_id) else {
        return false;
    };
    let Some(policy) = policy_registry().toggle_for_mode(mode) else {
        return false;
    };
    let state = PolicyState {
        self_side,
        opponent,
        time,
        extras: Default::default(),
    };
    policy.decide(decision, &state, projector())
}
