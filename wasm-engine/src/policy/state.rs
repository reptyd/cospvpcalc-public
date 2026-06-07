//! `PolicyState` - the snapshot a decision sees at evaluation time.
//!
//! Two parts:
//!
//! - Strongly-typed Rust fields for combat state the engine knows
//!   how to project (HP, statuses, cooldowns, time, …). Built-in
//!   decisions read these directly.
//! - An `extras` map of tagged values for user-added or
//!   constructor-built fields. User decisions read from `extras` by
//!   key without engine-side support.
//!
//! `PolicyState` is **owned and immutable** at the call site. The
//! engine projects forward by *cloning and mutating the clone*, never
//! by mutating the input. This is what guarantees `utility` purity
//! (see `traits.rs`).

use std::collections::BTreeMap;

use crate::contracts::{SimpleBreathProfile, SimpleCombatantStats, SimpleStatusInstance};

/// Tagged value carried in the `extras` map. Round-trips through JS
/// JSON via wasm_bindgen in the future bridge.
#[derive(Debug, Clone, PartialEq)]
pub enum PolicyValue {
    Number(f64),
    Bool(bool),
    Text(String),
    List(Vec<PolicyValue>),
    Map(BTreeMap<String, PolicyValue>),
}

impl PolicyValue {
    pub fn as_number(&self) -> Option<f64> {
        if let PolicyValue::Number(v) = self {
            Some(*v)
        } else {
            None
        }
    }

    pub fn as_bool(&self) -> Option<bool> {
        if let PolicyValue::Bool(v) = self {
            Some(*v)
        } else {
            None
        }
    }
}

/// One side of the matchup as seen by a decision. The fields are a
/// subset of the live `composable::CombatSide` - only the parts a
/// decision is allowed to read. This keeps the policy engine
/// independent of `composable::` internals.
#[derive(Debug, Clone)]
pub struct PolicySide {
    /// Static stats (max HP, base damage, weight, regen, …). Cloned
    /// once at the call boundary; never mutated by the engine.
    pub stats: SimpleCombatantStats,
    /// Current HP at the snapshot time.
    pub hp: f64,
    /// Active statuses with their stacks / decay schedule.
    pub statuses: BTreeMap<String, SimpleStatusInstance>,
    /// Per-ability cooldown timestamps. Keys use the same id
    /// namespace as `TimedDecision::id` (`builtin.fortify`,
    /// `user.foo`, …) so a decision can look up its own cooldown.
    pub cooldowns: BTreeMap<String, f64>,
    /// Per-ability "active until" timestamps for buff windows.
    /// Same key namespace as `cooldowns`.
    pub active_until: BTreeMap<String, f64>,
    /// Breath capacity in seconds remaining (0 if no breath).
    pub breath_capacity: f64,
    /// Sim-time at which this side's next melee bite is scheduled.
    /// Surfaced on the policy snapshot so user
    /// abilities can express "fire when opponent is about to bite"
    /// without piggy-backing on extras.
    pub next_hit: f64,
    /// Sim-time at which this side's next breath tick is scheduled
    /// (or `f64::INFINITY` if the side has no breath profile).
    pub next_breath: f64,
    /// Breath profile for the side, if it has one. Decisions that
    /// reason about breath-applied statuses (e.g. Fortify's immunity
    /// value) read this; cloned at the bridge so the policy engine
    /// owns its snapshot independent of `composable::CombatSide`.
    pub breath: Option<SimpleBreathProfile>,
    /// Per-side extras for user/constructor fields.
    pub extras: BTreeMap<String, PolicyValue>,
    /// Sliding-window damage logs (cloned from
    /// `CombatSide.recent_damage_*` at policy-state build time).
    /// Each entry `(time, post_mitigation_amount)`. Read by the
    /// `self.damage_taken_last.<N>` / `self.damage_dealt_last.<N>`
    /// var paths in `lookup_var`. Bite-only currently; extends to
    /// breath/DOT/trap sources alongside the pre-damage hook.
    pub recent_damage_taken: Vec<(f64, f64)>,
    pub recent_damage_dealt: Vec<(f64, f64)>,
    /// The side's committed posture as a stable label
    /// (`"Standing"` / `"Sitting"` / `"Laying"`). Populated by
    /// `build_policy_side` from `CombatSide.posture_current`; read by
    /// the `<side>.is_posture.<P>` var path (case-insensitive). Stored
    /// as a label rather than the `composable::Posture` enum so the
    /// policy engine stays independent of `composable::` internals.
    /// Defaults to `"Standing"` in synthetic test states.
    pub posture: String,
}

/// The full state a decision evaluates against.
///
/// Engine treats `self` and `opponent` symmetrically - flipping
/// them flips the perspective. `time` is the current simulation
/// time at the snapshot.
#[derive(Debug, Clone)]
pub struct PolicyState {
    /// The actor whose decision we are evaluating.
    pub self_side: PolicySide,
    /// The actor on the other side.
    pub opponent: PolicySide,
    /// Current simulation time (seconds).
    pub time: f64,
    /// Top-level extras (state-level, not per-side).
    pub extras: BTreeMap<String, PolicyValue>,
}

impl PolicySide {
    /// Convenience: stack count of a status, 0 if not present.
    pub fn status_stacks(&self, status_id: &str) -> f64 {
        self.statuses
            .get(status_id)
            .map(|inst| inst.stacks)
            .unwrap_or(0.0)
    }

    /// Convenience: total stacks across the supplied status ids.
    /// Part of the `PolicySide` query surface; currently unused - kept for
    /// hard-gate-style decisions (e.g. "Fortify ≥ 15 removable stacks").
    pub fn total_stacks_of(&self, ids: &[&str]) -> f64 {
        ids.iter()
            .map(|id| self.status_stacks(id))
            .sum()
    }

    /// HP fraction in [0, 1].
    pub fn hp_ratio(&self) -> f64 {
        let max = self.stats.health.max(1.0);
        (self.hp / max).clamp(0.0, 1.0)
    }

    /// Steady-state melee DPS: `damage / max(bite_cooldown, 0.1)`.
    /// Used by every utility heuristic that estimates "damage during
    /// a window"; collapses a 2-line read pattern into one call.
    pub fn bite_dps(&self) -> f64 {
        self.stats.damage / self.stats.bite_cooldown.max(0.1)
    }

    /// Cooldown timestamp for the named decision, or `0.0` if none
    /// is recorded. Decisions consult this in `is_available` /
    /// utility horizons; the bridge layer populates it from the
    /// live engine's cooldown fields.
    pub fn cooldown_until(&self, decision_id: &str) -> f64 {
        self.cooldowns.get(decision_id).copied().unwrap_or(0.0)
    }

    /// Active-window timestamp for the named decision, or `0.0` if
    /// none is recorded. Used to gate "already firing, can't double-
    /// fire" checks.
    pub fn active_until_for(&self, decision_id: &str) -> f64 {
        self.active_until.get(decision_id).copied().unwrap_or(0.0)
    }

    /// True when the named decision is past both its cooldown and
    /// any active window at `time`. Collapses the standard
    /// `is_available` shape (cooldown + active gate) into one call.
    /// `1e-9` slack absorbs float wobble from cooldown-rounding.
    pub fn is_idle_for(&self, time: f64, decision_id: &str) -> bool {
        const EPS: f64 = 1e-9;
        time + EPS >= self.cooldown_until(decision_id)
            && time + EPS >= self.active_until_for(decision_id)
    }
}

impl PolicyState {
    /// Cheap analytic ttk estimate used by per-decision utility
    /// functions. Returns the time until either side dies under
    /// steady-state DPS, capped at 120 s and floored at 0.
    ///
    /// **This is a heuristic for utility ranking, not a real sim.**
    /// Regen, ability cooldowns, and damage-modifier statuses are
    /// all ignored. The live engine's full simulation is the true
    /// ttk source; decisions only need this estimate to be monotone
    /// across candidate states under the same actor.
    // `.max(lo).min(hi)` coerces NaN to the bound; clamp() would propagate NaN.
    #[allow(clippy::manual_clamp)]
    pub fn remaining_fight_sec(&self, out_dps: f64, in_dps: f64) -> f64 {
        let opp_ttk = if out_dps > 0.0 {
            self.opponent.hp / out_dps
        } else {
            f64::INFINITY
        };
        let self_ttk = if in_dps > 0.0 {
            self.self_side.hp / in_dps
        } else {
            f64::INFINITY
        };
        opp_ttk.min(self_ttk).min(120.0).max(0.0)
    }
}
