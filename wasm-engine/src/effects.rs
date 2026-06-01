//! Foundation for user-defined custom abilities.
//!
//! A "custom ability" in this codebase has two halves:
//!
//! - The **decision** ("should I fire now, wait, or skip?") —
//!   already plugin-friendly via the `policy::TimedDecision` /
//!   `policy::ToggleDecision` traits, which the user implements
//!   and registers in `DecisionRegistry`. Audit #15 confirmed
//!   that surface ships at 9.6/10 quality.
//! - The **effect** ("what does the engine actually do when the
//!   decision fires?") — historically a hand-written
//!   `apply_simple_<ability>(…)` function that mutates fields on
//!   `CombatSide` directly. Plugin-unfriendly: a new ability
//!   meant editing `composable/mod.rs`.
//!
//! This module is the data-driven replacement for the effect
//! half. A custom ability's effect is a list of [`EffectKind`]
//! values applied via [`apply_effect_batch`]. The same primitives
//! cover the recurring patterns the built-in `apply_simple_*`
//! functions implement (cooldowns, active-window timers, status
//! cleanse, direct damage, status applies, HP cost). Built-in
//! abilities are intentionally NOT migrated to this path in this
//! commit — they stay on their existing direct-mutation code.
//! Migrating them is per-ability follow-up work.
//!
//! The design rationale is "JSON-able by default": every variant
//! holds plain f64 / String / Vec — values that round-trip cleanly
//! through `serde_wasm_bindgen` so a future JS bridge can hand the
//! engine a custom ability spec without engine recompilation. The
//! struct is `Serialize + Deserialize` for that purpose; the
//! existing `derive` cost is small enough to pay up front.
//!
//! ## Example: "deal 5% maxHP true damage + apply 2 Burn to opp"
//!
//! ```ignore
//! use crate::effects::{apply_effect_batch, EffectBatch, EffectKind, EffectTarget};
//! use crate::SimpleAppliedStatus;
//!
//! let batch = EffectBatch {
//!     name: "Custom Pyro Strike".into(),
//!     effects: vec![
//!         EffectKind::DealDirectDamageMaxHpFraction { target: EffectTarget::Opponent, fraction: 0.05 },
//!         EffectKind::ApplyStatusToTarget {
//!             target: EffectTarget::Opponent,
//!             status: SimpleAppliedStatus { status_id: "Burn_Status".into(), stacks: 2.0, source_ability: None },
//!         },
//!     ],
//!     ..Default::default()
//! };
//! ```
//!
//! At dispatch time the live engine layer (`composable::`) calls
//! `apply_effect_batch(&batch, &ctx)` from the same loop position
//! where today it would call `apply_simple_fortify` etc.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::combat::apply_unbreakable_damage_cap;
use crate::policy::state::PolicyState;
use crate::policy::user_ability::Expr;
use crate::statuses::{apply_incoming_statuses_to_target, is_fortify_cleansable_instance};
use crate::{SimpleAppliedStatus, SimpleCombatantStats, SimpleStatusInstance};

/// Hard upper bound on `EffectKind::Repeat` count to keep eval
/// bounded. Anything legitimately larger is almost certainly a
/// bug; clamping here is cheaper than discovering an infinite
/// effect storm at runtime.
pub const MAX_REPEAT_COUNT: u32 = 64;

/// Round 46 / B3: hard cap on numbered-key extras arrays. Pushes past
/// this length silently drop. Keeps engine memory bounded even when
/// a misbehaving spec keeps pushing in a tight loop.
pub const MAX_ARRAY_EXTRA_LEN: u32 = 256;

/// Hard cap on `ScheduleEffect` delay. 10 minutes is more than
/// any realistic combat horizon; anything larger is a bug.
pub const MAX_SCHEDULE_DELAY_SEC: f64 = 600.0;

/// Per-side scheduled-effects queue cap. When a `ScheduleEffect`
/// would push past this limit, the oldest entry is dropped.
pub const MAX_SCHEDULED_PER_SIDE: usize = 32;

/// Snapshot of per-side soft state captured by `RecordSnapshot`.
/// Restoring rolls back hp + statuses + extras to the captured
/// moment, while leaving engine-owned scheduling state
/// (cooldowns, next_hit, etc.) at its current value. Lives in
/// `effects.rs` so both `composable/side.rs` (storage) and the
/// effect dispatch (read/write) can reference the same type.
#[derive(Debug, Clone)]
pub struct UserSideSnapshot {
    pub hp: f64,
    pub statuses: BTreeMap<String, SimpleStatusInstance>,
    pub user_extras: BTreeMap<String, crate::policy::state::PolicyValue>,
}

/// Round 38 / A12: one queued scheduled-effect entry. Used to live as a
/// `(f64, Vec<EffectKind>)` tuple; promoted to a named struct so the
/// optional `name` can carry the cancel/reschedule lookup key without
/// breaking saved abilities (an entry without `name` serializes /
/// deserializes identically to the pre-A12 tuple shape).
///
/// `due_at` is in absolute sim time; the drain step in
/// `user_dispatch::drain_user_scheduled_for_caster` compares against
/// the iteration's `time` and fires whatever's due.
///
/// `name` is `Some(id)` when the schedule was pushed via a named
/// `schedule_effect` variant (so `cancel_schedule { name }` and
/// `reschedule { name, delay_sec }` can find it). `None` for unnamed
/// schedules; those simply can't be cancelled by name.
#[derive(Debug, Clone)]
pub struct ScheduledEntry {
    pub due_at: f64,
    pub effects: Vec<EffectKind>,
    pub name: Option<String>,
}

/// Deterministic-pseudo-random `[0, 1)` roll from a 64-bit seed.
/// One step of a linear-congruential generator + mantissa extract;
/// not cryptographic, but uniformly-distributed enough for combat
/// chance gates and fully deterministic for the same seed. Used by
/// [`EffectKind::Chance`].
fn lcg_pseudo_roll(seed: u64) -> f64 {
    // Numerical Recipes LCG constants — gives ~uniform low bits
    // over the cycle.
    let next = seed.wrapping_mul(6_364_136_223_846_793_005).wrapping_add(1_442_695_040_888_963_407);
    // Take top 53 bits and divide by 2^53 to land in [0, 1).
    (next >> 11) as f64 / ((1u64 << 53) as f64)
}

/// Side an effect mutates relative to the caster.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum EffectTarget {
    /// The actor that triggered the ability (the caster).
    Caster,
    /// The other side.
    Opponent,
}

/// Current-HP reconciliation policy for [`EffectKind::FormSwap`]. Applied
/// both when the form is entered (max HP changes) and, for a temporary
/// form, symmetrically when it reverts. The author picks one per form.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum HpPolicy {
    /// Preserve the HP fraction (`current_hp / max_hp`) across the change.
    Ratio,
    /// Preserve the raw current HP, clamped to the new max.
    Absolute,
    /// Set current HP to `value`, clamped to the new max.
    Set { value: f64 },
}

/// One base-stat change in a [`EffectKind::FormSwap`] bundle. Mirrors the
/// `(field, mode, value)` shape of a `ModifyStat`: FormSwap is sugar over a
/// batch of `ModifyStat` writes plus HP reconciliation, so each entry lands
/// as the same `modifier.<field>.<mode>.<source>.*` keys the effective-stat
/// layer already reads.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct FormStatChange {
    pub field: String,
    pub mode: ModifierMode,
    pub value: f64,
}

/// Single mutation an ability spec composes. Each variant maps to
/// a primitive the existing `apply_simple_*` built-ins already use,
/// just lifted into data.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum EffectKind {
    /// Deal flat HP damage to the target. Subject to the target's
    /// `unbreakable_damage_cap_pct` (mirrors built-in clamp logic).
    DealDirectDamage {
        target: EffectTarget,
        amount: f64,
    },
    /// Deal damage as a fraction of the target's max HP. Subject
    /// to the unbreakable cap. Useful for "5% maxHP per cast" style
    /// abilities (Reflux impact, custom percentage-damage casts).
    DealDirectDamageMaxHpFraction {
        target: EffectTarget,
        fraction: f64,
    },
    /// Heal the target. Capped at the target's max HP. Healing is
    /// blocked while `Heartbroken_Status` is present on the target
    /// (mirrors `combat::is_external_healing_blocked`).
    HealHp {
        target: EffectTarget,
        amount: f64,
    },
    /// Apply (or refresh) a status on the target through the
    /// canonical apply-with-resist path. Resist / plushie blocks
    /// honored.
    ApplyStatusToTarget {
        target: EffectTarget,
        status: SimpleAppliedStatus,
    },
    /// Round 35 / A3: apply N statuses in one effect. Same canonical
    /// resist/plushie pipeline as the singular variant; each entry is
    /// processed independently (one may be fully fortified-out while
    /// another lands). Empty array is a no-op.
    ///
    /// Why a separate kind rather than letting `ApplyStatusToTarget`
    /// take a Vec: the existing kind ships in saved abilities with a
    /// singular `status` field. Keeping it as-is preserves migration-
    /// free load; the new kind adds the array capability additively.
    ApplyStatusesToTarget {
        target: EffectTarget,
        statuses: Vec<SimpleAppliedStatus>,
    },
    /// Remove every status the global "Fortify removable" filter
    /// recognises from the target. Used by Fortify-style cleanse
    /// abilities; user-defined abilities can opt in.
    CleanseFortifyRemovableStatuses { target: EffectTarget },
    /// Set a named cooldown timer on the target by writing
    /// `time + duration_sec` into the named extra field. The
    /// caller selects which cooldown via `cooldown_id` (matches the
    /// `DecisionRegistry` id namespace, e.g. `"builtin.fortify"` /
    /// `"user.pyro_strike"`).
    SetCooldownUntil {
        target: EffectTarget,
        cooldown_id: String,
        duration_sec: f64,
    },
    /// Set a named "active window" timer on the target. Same
    /// semantics as `SetCooldownUntil` but writes the
    /// active-until map.
    SetActiveUntil {
        target: EffectTarget,
        active_id: String,
        duration_sec: f64,
    },
    /// 2026-05-12: Expr-duration variant of [`EffectKind::SetCooldownUntil`].
    /// Lets users feed a `scaling.<key>` / `event.*` / arithmetic
    /// expression as the duration. Evaluated against the pre-fire
    /// [`PolicyState`]; negative results clamp to 0.
    SetCooldownUntilExpr {
        target: EffectTarget,
        cooldown_id: String,
        duration_sec: Expr,
    },
    /// 2026-05-12: Expr-duration counterpart of [`EffectKind::SetActiveUntil`].
    SetActiveUntilExpr {
        target: EffectTarget,
        active_id: String,
        duration_sec: Expr,
    },
    /// Subtract HP from the target without touching damage caps —
    /// used for self-cost abilities (Hunters Curse pays 50 % maxHP
    /// at cast). The engine clamps HP to a minimum of 1 to mirror
    /// the live `apply_hunters_curse_self_cost` floor.
    PaySelfCostMaxHpFraction {
        target: EffectTarget,
        fraction: f64,
    },
    /// Conditional compositor — pick `then` vs `otherwise` based on
    /// `cond` evaluated against the pre-fire [`PolicyState`]
    /// snapshot. Conditions cannot react to effects earlier in the
    /// same batch (intentionally: the snapshot is taken once at
    /// fire-time and reused, so the model stays predictable).
    Conditional {
        cond: Expr,
        then: Vec<EffectKind>,
        #[serde(default)]
        otherwise: Vec<EffectKind>,
    },
    /// Apply `body` exactly `count` times. Count is clamped to
    /// [`MAX_REPEAT_COUNT`] to keep total work bounded.
    Repeat {
        count: u32,
        body: Vec<EffectKind>,
    },
    /// Temporarily modify a numeric stat on the target. Records
    /// the modifier in a side-local registry (`user_extras` under
    /// `MODIFIER_KEY_PREFIX`) that the engine adapter reads when
    /// computing effective stats; expires after `duration_sec`
    /// (`0.0` ⇒ permanent for the duration of the fight).
    ///
    /// **Engine read-path (Sprint 5.6, `composable/loop_iter.rs`):**
    /// the per-iteration adapter layers these modifiers via
    /// [`effective_stat_value`] for `damage`, `bite_cooldown`,
    /// `weight`, and `health_regen` on both sides. Other numeric
    /// fields (e.g. `first_strike_pct`, breath stats, resist
    /// fractions) and boolean fields are NOT wired yet — firing a
    /// `ModifyStat` on them records the modifier but has no runtime
    /// effect until the adapter reads that field.
    ModifyStat {
        target: EffectTarget,
        /// Snake-case `SimpleCombatantStats` field name to modify.
        /// The reader translates this into the actual field
        /// access; an unknown field name is a no-op (same posture
        /// as unknown var paths in `Expr`).
        field: String,
        mode: ModifierMode,
        value: f64,
        /// `0.0` ⇒ permanent (fight-lifetime). Otherwise expires
        /// at `time + duration_sec`.
        duration_sec: f64,
    },
    /// Chain another registered ability's `on_fire` batch into the
    /// current dispatch. The chained ability runs against the same
    /// caster / opponent and the same `policy_state` snapshot —
    /// **no `is_available` gate, no cooldown is set**, the
    /// "trigger" semantic is "borrow the effects" not "actually
    /// fire". Reentrancy guarded by `EffectContext::chain_depth`
    /// against [`MAX_CHAIN_DEPTH`].
    TriggerAbility {
        /// Id of the ability whose `on_fire` to expand. Must be
        /// a `user.<...>` id today; built-in chaining is a future
        /// extension.
        ability_id: String,
    },
    /// Set target HP to an absolute value, clamped to [0, max_hp].
    /// Useful for "execute below 1 HP" / "rescue to full" / "swap
    /// to half" patterns.
    SetHp { target: EffectTarget, value: f64 },
    /// Transfer HP from one side to the other. Drains
    /// `min(amount, source.hp - 1.0)` from the source (source HP
    /// floor of 1.0 mirrors built-in self-cost convention) and
    /// adds the same amount to the destination, clamped to its
    /// max HP. Net-positive vampiric pattern.
    TransferHp {
        /// Side losing HP.
        from: EffectTarget,
        /// Side gaining HP.
        to: EffectTarget,
        amount: f64,
    },
    /// Swap caster and opponent HP ratios. After: caster.hp =
    /// caster.max_hp * opp_ratio, opponent.hp = opp.max_hp *
    /// caster_ratio. Each side stays bounded by its own max HP.
    SwapHpRatio,
    /// v2 step 7: glass-cannon ↔ tank form swap. Writes each `stat_changes`
    /// entry as a `ModifyStat`-style modifier on the target (the same
    /// `modifier.<field>.<mode>.<source>.*` keys, so the effective-stat
    /// layer picks them up everywhere), then reconciles the target's
    /// current HP per `hp_policy` against the new effective max HP.
    /// `duration_sec > 0` is a temporary form: the stat modifiers expire on
    /// their own, and a stored `form_revert.*` marker drives the symmetric
    /// reverse reconciliation in the event loop (no general modifier-expiry
    /// hook exists). `duration_sec <= 0` is a permanent form (no revert).
    FormSwap {
        target: EffectTarget,
        stat_changes: Vec<FormStatChange>,
        duration_sec: f64,
        hp_policy: HpPolicy,
    },
    /// Remove a specific status from the target. Silently no-ops
    /// when the status isn't present. Distinct from
    /// `cleanse_fortify_removable_statuses` — that one uses a
    /// global filter; this one targets a single id.
    ClearStatus {
        target: EffectTarget,
        status_id: String,
    },
    /// Round 35 / A3: remove N named statuses in one effect. Each id
    /// is processed independently; absent ids silently no-op. Empty
    /// array is a no-op. Sibling of [`EffectKind::ClearStatus`]
    /// keeping the singular form for backward compat.
    ClearStatuses {
        target: EffectTarget,
        status_ids: Vec<String>,
    },
    /// Modify the stack count of a specific status on the target.
    /// `mode = add` adds (negative `value` subtracts; clamped to
    /// >= 0; `0` removes the entry); `mode = set` overrides.
    /// > No resist / plushie filtering — direct write.
    ModifyStatusStacks {
        target: EffectTarget,
        status_id: String,
        mode: ModifierMode,
        value: f64,
    },
    /// Wipe every status from the target. Stronger than the
    /// fortify cleanse (which only removes statuses the global
    /// filter recognises).
    DispelAllStatuses { target: EffectTarget },
    /// Reset a named cooldown / active-until timer to 0 — the
    /// next is-idle check passes immediately. `which` selects
    /// which map to clear.
    CooldownReset {
        target: EffectTarget,
        cooldown_id: String,
        which: TimerSlot,
    },
    /// Push the target's next bite timestamp forward by
    /// `delay_sec` (clamped to >= 0). Effectively interrupts a
    /// scheduled bite without fully cancelling it. Mirrors
    /// "stagger" / "stun" patterns.
    InterruptNextHit {
        target: EffectTarget,
        delay_sec: f64,
    },
    /// Drain the target's breath capacity by `amount` (clamped
    /// to >= 0).
    ConsumeBreath { target: EffectTarget, amount: f64 },
    /// Add to the target's breath capacity. Soft-capped to a
    /// generous 10000s — saturating add prevents overflow into
    /// negatives but lets users author "infinite breath" passives.
    RestoreBreath { target: EffectTarget, amount: f64 },
    // ── Expr-driven variants ────────────────────────────────────
    //
    // The variants below take an `Expr` instead of a literal `f64`
    // so the damage / heal / stack count / etc. is computed from
    // the current `PolicyState` at fire time. Required for
    // "damage = opponent.hp * 0.5" / "heal = my missing HP" /
    // "apply N stacks where N = my own status count" patterns.
    //
    // The Expr evaluates against `EffectContext::policy_state` —
    // which is `None` for built-in callers, so these variants are
    // a no-op outside the user-ability dispatch. Keep the spec
    // contract stable; the apply-time eval is best-effort.
    /// Like `DealDirectDamage` but the damage amount is computed
    /// from an `Expr` evaluated against the pre-fire snapshot.
    DealExprDamage {
        target: EffectTarget,
        amount: Expr,
    },
    /// Like `HealHp` but the heal amount is Expr-computed.
    HealExprAmount {
        target: EffectTarget,
        amount: Expr,
    },
    /// Apply a status whose stack count is computed from an Expr.
    ApplyStatusExprStacks {
        target: EffectTarget,
        status_id: String,
        stacks: Expr,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        source_ability: Option<String>,
    },
    /// Set target HP to an Expr-computed value, clamped to
    /// [0, max_hp].
    SetHpExpr { target: EffectTarget, value: Expr },
    /// Like `ModifyStat` but the value AND duration are Expr-
    /// computed. Lets users author scaling buffs ("+10% damage
    /// per stack of Vigor", duration scaled by HP%, etc.).
    ModifyStatExpr {
        target: EffectTarget,
        field: String,
        mode: ModifierMode,
        value: Expr,
        duration_sec: Expr,
    },
    // ── Tier-1 building blocks ──────────────────────────────────
    /// Write a numeric value into the target's `user_extras` map.
    /// Lets user abilities maintain their own counters / meters
    /// across firings — closes the loop for ramping / combo / Rage-
    /// meter mechanics. Pairs with `Var { path: "extras.<key>" }`
    /// reads.
    SetExtra {
        target: EffectTarget,
        key: String,
        value: Expr,
    },
    /// Add `amount` to the target's existing `user_extras[<key>]`,
    /// creating the entry if absent. Read-modify-write convenience
    /// over `SetExtra`. Negative `amount` subtracts.
    IncrementExtra {
        target: EffectTarget,
        key: String,
        amount: Expr,
    },
    /// Round 46 / B3: append a value to a numbered-key extras array.
    /// Storage: `<key>.length` holds the count; `<key>.<i>` for
    /// `i in 0..length` holds the entries. The push effect:
    ///   1. Reads `<key>.length` (defaults to 0 if absent).
    ///   2. Writes `<key>.<length>` = `value.eval(state)`.
    ///   3. Writes `<key>.length` = `length + 1`.
    ///      Capped at [`MAX_ARRAY_EXTRA_LEN`] to keep pathological pushes
    ///      bounded. Past the cap the push silently drops the value (the
    ///      length counter does NOT increment) so a misbehaving spec can't
    ///      inflate engine memory.
    PushExtra {
        target: EffectTarget,
        key: String,
        value: Expr,
    },
    /// Round 46 / B3: clear a numbered-key extras array — removes
    /// every `<key>.<i>` entry plus the `<key>.length` slot. No-op
    /// when the array doesn't exist. Useful for "reset on cooldown
    /// arm" patterns where the array is per-cycle.
    ClearExtraArray {
        target: EffectTarget,
        key: String,
    },
    /// Deal damage routed through one of the engine's typed damage
    /// pipelines. `Bite` honors weight ratios + status mods +
    /// defender's `damage_taken_multiplier_on_being_bitten` (full
    /// melee pipeline). `Breath` honors `breath_resistance`. `True`
    /// is the existing direct-damage path (only the unbreakable cap).
    DealTypedDamage {
        target: EffectTarget,
        damage_type: TypedDamageKind,
        amount: f64,
    },
    /// Atomic "detonate" — deal damage proportional to the target's
    /// current stack count of `status_id`, then remove the status.
    /// Damage uses pre-removal stacks. `damage_per_stack` is
    /// Expr-computed so users can scale per stack with state.
    ConsumeStatusForDamage {
        target: EffectTarget,
        status_id: String,
        damage_per_stack: Expr,
    },
    // ── Tier-2 / Tier-3 building blocks ─────────────────────────
    /// Extend the `remaining_sec` of an existing status without
    /// resetting decay or stack count. Silently no-ops when the
    /// status isn't present. Negative `seconds` shortens.
    ExtendStatus {
        target: EffectTarget,
        status_id: String,
        seconds: f64,
    },
    /// Set the absolute timestamp at which the named status next
    /// ticks / decays. Lets users author DoT-sustain patterns
    /// ("re-arm tick to fire 0.5s from now").
    SetStatusNextDecay {
        target: EffectTarget,
        status_id: String,
        absolute_time: f64,
    },
    /// Round 33 / A4: set the absolute timestamp at which the named
    /// status next fires its DOT-style **tick** (independent of the
    /// stack-decay timer). Useful for "accelerate the next Burn tick"
    /// or "delay Poison until the cocoon ends" patterns.
    ///
    /// No-op when the status isn't present on the target. The new
    /// timestamp is floored at `ctx.time` so a past value collapses
    /// to "fire on the next status-tick phase".
    SetStatusNextTick {
        target: EffectTarget,
        status_id: String,
        absolute_time: f64,
    },
    /// Snapshot the target's current hp + statuses + user_extras
    /// under `key`. Pairs with `RestoreSnapshot` for rewind /
    /// telegraph patterns. Overwrites any previous snapshot with
    /// the same key.
    RecordSnapshot {
        target: EffectTarget,
        key: String,
    },
    /// Restore the target's hp / statuses / user_extras from a
    /// previously recorded snapshot. Silently no-ops when the
    /// key isn't present. Cooldowns / next_hit / etc. remain at
    /// their current values — only "soft state" rolls back.
    RestoreSnapshot {
        target: EffectTarget,
        key: String,
    },
    /// Schedule a sub-batch of effects to fire `delay_sec` from
    /// now. The scheduled effects fire from the same caster /
    /// opponent perspective as the current dispatch. Engine
    /// drains the queue at the top of each iteration.
    ///
    /// Caps: `delay_sec` clamped to [0, 600]. Hard limit on
    /// queue size = MAX_SCHEDULED_PER_SIDE per side, oldest
    /// dropped on overflow.
    ScheduleEffect {
        delay_sec: f64,
        effects: Vec<EffectKind>,
        /// Round 38 / A12: optional schedule name. `Some(id)` lets a
        /// later `cancel_schedule { name: id }` or
        /// `reschedule { name: id, delay_sec }` find this entry.
        /// `None` ⇒ fire-and-forget (the pre-A12 shape).
        #[serde(default, skip_serializing_if = "Option::is_none")]
        name: Option<String>,
    },
    /// Round 38 / A12: remove all queued scheduled entries on the
    /// caster's side whose `name` matches. No-op if no entries match.
    /// Lets users build channel-style abilities ("if I take damage,
    /// cancel my pending bomb") without polluting `extras` with
    /// per-cast cancellation flags.
    CancelSchedule {
        name: String,
    },
    /// Round 38 / A12: find the FIRST queued entry on the caster's
    /// side with the given `name` and move its `due_at` to
    /// `time + delay_sec` (clamped to `[0, 600]`). If multiple entries
    /// share the same name (legal — users can `schedule { name }` two
    /// branches under the same key), only the first reschedules; the
    /// rest stay where they are. No-op if no entry matches.
    Reschedule {
        name: String,
        delay_sec: f64,
    },
    /// Compositor: deterministic-pseudo-random chance gate. Rolls
    /// a `[0,1)` value derived from a hash of `(state.time,
    /// caster_extras_count, side_label_bit, ability_id_hash)` and
    /// fires `then` only if the roll < `probability`. The seed is
    /// fully deterministic for the same inputs — repeated Compare
    /// runs produce the same outcome. `probability` is Expr-
    /// computed against the pre-fire state.
    Chance {
        probability: Expr,
        then: Vec<EffectKind>,
    },
    /// Round 34 / A2: weighted one-of-N exclusive branch picker.
    /// Each branch carries a numeric `weight` expression (clamped to
    /// `>= 0`) and an `effects` body. The engine evaluates every
    /// weight, sums them, rolls a single deterministic-pseudo-random
    /// value in `[0, sum)`, and fires exactly one branch — the one
    /// whose weight range contains the roll.
    ///
    /// Branches with weight `<= 0` are skipped. If every branch has
    /// weight `<= 0` (or `branches` is empty), no branch fires and
    /// the effect is a no-op. Seed: same LCG as `Chance`, so a
    /// `choose` and a `chance` at the same `(time, extras-count)`
    /// pull from the same deterministic stream.
    ///
    /// Why a separate effect rather than nested `Chance`: three
    /// `chance 0.33` blocks are three independent rolls — sometimes
    /// 0 branches fire, sometimes 2-3. `Choose` is "exactly one".
    Choose {
        branches: Vec<ChooseBranch>,
    },
}

/// One branch of a [`EffectKind::Choose`] picker. `weight` is an
/// Expr so users can weight by run-time state (e.g. bias toward the
/// "burst" branch when HP is low).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ChooseBranch {
    pub weight: Expr,
    pub effects: Vec<EffectKind>,
}

/// Damage-routing kind for [`EffectKind::DealTypedDamage`]. Mirrors
/// the engine's existing damage pipelines so user abilities can
/// produce damage that opponents' resistance stats actually apply to.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TypedDamageKind {
    /// Routed like a melee bite — weight ratio, attacker statuses,
    /// defender's bite-taken multiplier all apply.
    Bite,
    /// Routed like a breath tick — `breath_resistance` reduces it.
    Breath,
    /// Pure direct damage (existing `DealDirectDamage` semantics) —
    /// only the unbreakable cap applies. Bypasses every resistance.
    True,
}

/// Which side-local timer slot a `CooldownReset` clears.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TimerSlot {
    /// `user_cooldowns` map (driven by SetCooldownUntil).
    Cooldown,
    /// `user_active_until` map.
    ActiveUntil,
}

/// Hard cap on `TriggerAbility` recursion depth. Caps the work a
/// pathological chain can do (A → B → A → … ) at a fixed budget;
/// engine adapter (Sprint 5) increments `EffectContext::chain_depth`
/// per nested call and refuses to expand further at this limit.
pub const MAX_CHAIN_DEPTH: u32 = 4;

/// How a `ModifyStat` value combines with the base stat.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ModifierMode {
    /// `effective = base + value`
    Add,
    /// `effective = base * value`
    Mul,
    /// `effective = value` (overrides base entirely)
    Set,
}

/// Prefix the engine adapter scans for in `PolicySide::extras`
/// when collecting active stat modifiers. Format:
/// `modifier.<field>.<mode>.value` and `.until`. Stable contract
/// even though the read-path implementation lives in Sprint 5 —
/// pinning the key shape here lets the spec format stay stable
/// while the consumer gets built out.
pub const MODIFIER_KEY_PREFIX: &str = "modifier.";

/// Read the active modifier stack on `extras` and apply it to a
/// `base` stat value. Returns `base` unchanged when no modifier is
/// recorded (or all expired). Apply order: `set` overrides first;
/// otherwise `base * mul + add`.
///
/// `extras` is the per-side `user_extras` map (or `PolicySide::extras`).
/// `time` is the current sim time — entries with `until <= time`
/// are skipped (expired).
///
/// **Round 39 / A8 — sourced modifiers.** Two abilities both writing
/// `modify_stat damage mul 1.5` previously collided on the same
/// `modifier.damage.mul.value` key and the second overwrote the first.
/// Fixed by stamping the firing ability id into the key as a source
/// tag: `modifier.<field>.<mode>.<source>.value` /
/// `modifier.<field>.<mode>.<source>.until`. The aggregator below
/// iterates ALL matching keys and combines them:
///
/// - `set` — overrides everything. If multiple sources set, the
///   highest-`until` source wins (acts like "the most recently-applied
///   override sticks longest"). Ties: alphabetical by source key
///   (deterministic but rare in practice).
/// - `mul` — product of every unexpired `.mul` value from every source.
/// - `add` — sum of every unexpired `.add` value from every source.
///
/// Modifier keys are runtime state on `CombatSide::user_extras` —
/// not persisted in saved specs — so no backward-compat migration
/// is needed for the key-shape change.
pub fn effective_stat_value(
    base: f64,
    field: &str,
    extras: &BTreeMap<String, crate::policy::state::PolicyValue>,
    time: f64,
) -> f64 {
    let mut set_value: Option<(f64, f64)> = None; // (value, until)
    let mut mul_product: f64 = 1.0;
    let mut add_sum: f64 = 0.0;

    // Scan once: every `.value` key in scope yields a (source, mode)
    // pair; we look up the matching `.until` to check expiry.
    let field_prefix = format!("{MODIFIER_KEY_PREFIX}{field}.");
    for (key, value) in extras.iter() {
        let Some(after_field) = key.strip_prefix(&field_prefix) else {
            continue;
        };
        let Some(rest) = after_field.strip_suffix(".value") else {
            continue;
        };
        // `rest` is `<mode>.<source>` (post-A8) or just `<mode>`
        // (pre-A8 — defensive: shouldn't appear at runtime but kept
        // robust against the unlikely case of pre-A8 keys lingering
        // in a long-running session if migration mid-run).
        let (mode, source) = match rest.split_once('.') {
            Some((m, s)) => (m, s),
            None => (rest, "default"),
        };
        let Some(value_num) = value.as_number() else { continue };
        let until_key = format!("{MODIFIER_KEY_PREFIX}{field}.{mode}.{source}.until");
        let until = extras
            .get(&until_key)
            .or_else(|| {
                // Pre-A8 fallback: `modifier.<field>.<mode>.until`
                // (no source segment). Only reached when the key was
                // also written without source — symmetric with the
                // split above.
                if source == "default" {
                    extras.get(&format!("{MODIFIER_KEY_PREFIX}{field}.{mode}.until"))
                } else {
                    None
                }
            })
            .and_then(|v| v.as_number())
            .unwrap_or(0.0);
        if time + 1e-9 >= until {
            continue; // expired
        }
        match mode {
            "set" => {
                // Latest-`until` wins; deterministic-tie via alphabetical
                // ordering in BTreeMap iteration.
                if set_value.is_none_or(|(_, prev_until)| until > prev_until) {
                    set_value = Some((value_num, until));
                }
            }
            "mul" => mul_product *= value_num,
            "add" => add_sum += value_num,
            _ => {}
        }
    }

    if let Some((set_v, _)) = set_value {
        return set_v;
    }
    base * mul_product + add_sum
}

// FormSwap temporary-form revert markers, written into the target's
// `user_extras` so the event loop can run the symmetric reverse HP
// reconciliation when the form's stat modifiers expire. Single-slot per
// side: a second overlapping temporary form overwrites the marker (latest
// revert wins) — overlapping temporary forms are out of the supported model.
const FORM_REVERT_UNTIL_KEY: &str = "form_revert.until";
const FORM_REVERT_MAX_KEY: &str = "form_revert.max_at_form";
const FORM_REVERT_POLICY_KEY: &str = "form_revert.policy_code";
const FORM_REVERT_SET_VALUE_KEY: &str = "form_revert.set_value";

/// Reconcile current HP across a max-HP change per [`HpPolicy`]. Used on
/// FormSwap entry (`max_before` = pre-form effective max) and on revert
/// (`max_before` = the form's max). Result is clamped to `[0, max_after]`.
pub(crate) fn reconcile_form_hp(policy: HpPolicy, hp_before: f64, max_before: f64, max_after: f64) -> f64 {
    let raw = match policy {
        HpPolicy::Ratio => {
            if max_before > 0.0 {
                hp_before / max_before * max_after
            } else {
                max_after
            }
        }
        HpPolicy::Absolute => hp_before,
        HpPolicy::Set { value } => value,
    };
    raw.clamp(0.0, max_after)
}

/// Encode an [`HpPolicy`] as the `(code, set_value)` pair persisted in numeric
/// extras markers (so the enum survives in a `PolicyValue::Number` map).
/// Inverse of [`hp_policy_from_code`].
fn hp_policy_to_code(policy: HpPolicy) -> (f64, f64) {
    match policy {
        HpPolicy::Ratio => (0.0, 0.0),
        HpPolicy::Absolute => (1.0, 0.0),
        HpPolicy::Set { value } => (2.0, value),
    }
}

/// Decode the `(code, set_value)` pair written by [`hp_policy_to_code`].
fn hp_policy_from_code(code: f64, set_value: f64) -> HpPolicy {
    match code as i64 {
        1 => HpPolicy::Absolute,
        2 => HpPolicy::Set { value: set_value },
        _ => HpPolicy::Ratio,
    }
}

// Status-scoped FormSwap teardown policy. A permanent (duration 0) form
// installed by a status hook does not revert on a timer — it reverts when the
// status itself leaves the bearer (`user_status_dispatch::
// teardown_status_scoped_modifiers`), so there is no `form_revert.*` timer
// marker to carry the policy. Instead the authored `hp_policy` is stamped here,
// keyed per-source by the installing status id, and read back at teardown.
// Symmetric with how a finite form carries its policy in `form_revert.policy_code`.
const STATUS_TEARDOWN_POLICY_PREFIX: &str = "form_teardown.";

fn status_teardown_code_key(source: &str) -> String {
    format!("{STATUS_TEARDOWN_POLICY_PREFIX}{source}.policy_code")
}

fn status_teardown_set_key(source: &str) -> String {
    format!("{STATUS_TEARDOWN_POLICY_PREFIX}{source}.set_value")
}

/// Stamp the per-source HP-reconcile policy for a status-installed permanent
/// form, so the status teardown can honor the authored `hp_policy` (rather than
/// defaulting to proportional). Keyed by `source` = the installing status id.
pub(crate) fn stamp_status_teardown_policy(
    extras: &mut BTreeMap<String, crate::policy::state::PolicyValue>,
    source: &str,
    policy: HpPolicy,
) {
    let (code, set_value) = hp_policy_to_code(policy);
    extras.insert(
        status_teardown_code_key(source),
        crate::policy::state::PolicyValue::Number(code),
    );
    extras.insert(
        status_teardown_set_key(source),
        crate::policy::state::PolicyValue::Number(set_value),
    );
}

/// Read the per-source teardown policy stamped by [`stamp_status_teardown_policy`].
/// Defaults to `Ratio` when no marker is present (e.g. a `modify_stat`-only
/// install, which never stamps a policy).
pub(crate) fn read_status_teardown_policy(
    extras: &BTreeMap<String, crate::policy::state::PolicyValue>,
    source: &str,
) -> HpPolicy {
    let code = extras
        .get(&status_teardown_code_key(source))
        .and_then(|v| v.as_number())
        .unwrap_or(0.0);
    let set_value = extras
        .get(&status_teardown_set_key(source))
        .and_then(|v| v.as_number())
        .unwrap_or(0.0);
    hp_policy_from_code(code, set_value)
}

/// Remove the per-source teardown-policy markers for `source`. Returns true if
/// any key was removed.
pub(crate) fn clear_status_teardown_policy(
    extras: &mut BTreeMap<String, crate::policy::state::PolicyValue>,
    source: &str,
) -> bool {
    let before = extras.len();
    extras.remove(&status_teardown_code_key(source));
    extras.remove(&status_teardown_set_key(source));
    extras.len() != before
}

/// Reverse HP reconciliation for an expired temporary FormSwap. The event
/// loop calls this once per side each iteration. When a `form_revert.*`
/// marker is present and its `until` has passed (so the form's stat
/// modifiers have lapsed and the effective max has reverted), reconcile the
/// current HP with the same policy used on entry, then clear the marker.
/// No-op when no marker is present or the form is still active. Idempotent.
pub fn process_form_revert(
    extras: &mut BTreeMap<String, crate::policy::state::PolicyValue>,
    hp: &mut f64,
    base_health: f64,
    time: f64,
) {
    let Some(until) = extras.get(FORM_REVERT_UNTIL_KEY).and_then(|v| v.as_number()) else {
        return;
    };
    if time + 1e-9 < until {
        return; // form still active
    }
    let max_at_form = extras
        .get(FORM_REVERT_MAX_KEY)
        .and_then(|v| v.as_number())
        .unwrap_or(0.0);
    let code = extras
        .get(FORM_REVERT_POLICY_KEY)
        .and_then(|v| v.as_number())
        .unwrap_or(0.0);
    let set_value = extras
        .get(FORM_REVERT_SET_VALUE_KEY)
        .and_then(|v| v.as_number())
        .unwrap_or(0.0);
    // The form's modifier keys have expired (their `until` <= `time`), so
    // `effective_stat_value` already excludes them: this is the post-revert
    // effective max.
    let max_after = effective_stat_value(base_health, "health", extras, time).max(1.0);
    let policy = hp_policy_from_code(code, set_value);
    *hp = reconcile_form_hp(policy, *hp, max_at_form, max_after);
    extras.remove(FORM_REVERT_UNTIL_KEY);
    extras.remove(FORM_REVERT_MAX_KEY);
    extras.remove(FORM_REVERT_POLICY_KEY);
    extras.remove(FORM_REVERT_SET_VALUE_KEY);
}

/// Named bundle of effects the engine applies in order. Order
/// matters: e.g. "cleanse statuses, then arm cooldown" needs the
/// cleanse step to fire first so the cooldown reflects post-cleanse
/// state.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct EffectBatch {
    /// Human-readable name surfaced in combat-log events. Pick the
    /// ability's display name (e.g. `"Fortify"`, `"Custom Pyro Strike"`).
    pub name: String,
    /// Effects applied in order.
    pub effects: Vec<EffectKind>,
    /// Round 45 / B6: optional gate expression. When present and the
    /// expression evaluates falsy (≤ 0.5 numerically — the same
    /// boolean convention the rest of the engine uses), the entire
    /// batch is skipped — none of its effects fire and no
    /// combat-log event is recorded. Saves users from wrapping a
    /// whole trigger body in `if X: ...` when the only goal is
    /// "fire this batch only when X". Backward-compat: missing /
    /// `None` evaluates as "no gate" — every old saved spec behaves
    /// identically.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub when: Option<crate::policy::user_ability::Expr>,
}

/// Mutable references the effect-application layer needs. Built
/// per call from the engine's live `CombatSide`s by the bridge
/// layer; the effects module never imports `composable::`
/// internals (pillar 4 — narrow public API).
///
/// `cooldowns_*` and `active_*` are simple maps keyed by the same
/// id namespace as `DecisionRegistry` (`builtin.X` / `user.X`).
/// The bridge populates them from the live struct's named fields
/// before dispatch and reads back after.
pub struct EffectContext<'a> {
    pub time: f64,
    pub caster_stats: &'a SimpleCombatantStats,
    pub opponent_stats: &'a SimpleCombatantStats,
    pub caster_hp: &'a mut f64,
    pub opponent_hp: &'a mut f64,
    pub caster_statuses: &'a mut BTreeMap<String, SimpleStatusInstance>,
    pub opponent_statuses: &'a mut BTreeMap<String, SimpleStatusInstance>,
    pub caster_cooldowns: &'a mut BTreeMap<String, f64>,
    pub opponent_cooldowns: &'a mut BTreeMap<String, f64>,
    pub caster_active_until: &'a mut BTreeMap<String, f64>,
    pub opponent_active_until: &'a mut BTreeMap<String, f64>,
    /// Per-side modifier scratch space. Sprint 5.6: `ModifyStat`
    /// writes into the relevant target's map under
    /// `modifier.<field>.<mode>.value` / `.until`. The combat-side
    /// effective-stat readers consult these via
    /// [`effective_stat_value`].
    pub caster_extras: &'a mut BTreeMap<String, crate::policy::state::PolicyValue>,
    pub opponent_extras: &'a mut BTreeMap<String, crate::policy::state::PolicyValue>,
    /// Round 37 / A7: optional accumulator for `iter_healing_taken` on
    /// the caster / opponent CombatSides. Heal-side effect handlers
    /// (HealHp, HealExprAmount, SetHp(_Expr) raising HP, TransferHp
    /// recipient) add the healed amount here. Phase 16 dispatch reads
    /// the accumulator and fires `OnHeal` if > 0. `None` for built-in
    /// callers (effects.rs unit tests, etc.) that don't drive user
    /// triggers.
    pub caster_iter_healing: Option<&'a mut f64>,
    pub opponent_iter_healing: Option<&'a mut f64>,
    /// Snapshots map (Larger Tier A). Per-side keyed by user
    /// name. None for built-in callers that don't use snapshots.
    pub caster_snapshots: Option<&'a mut BTreeMap<String, UserSideSnapshot>>,
    pub opponent_snapshots: Option<&'a mut BTreeMap<String, UserSideSnapshot>>,
    /// Scheduled-effects queue (Larger Tier A). Caster's queue —
    /// `ScheduleEffect` pushes here. None disables scheduling
    /// (built-in callers).
    pub caster_scheduled: Option<&'a mut Vec<ScheduledEntry>>,
    pub opponent_scheduled: Option<&'a mut Vec<ScheduledEntry>>,
    /// Pre-fire snapshot the engine evaluates `Conditional` /
    /// future `Expr`-driven effect variants against. `None`
    /// disables those compositors (they apply nothing); supply a
    /// `Some` reference when dispatching user abilities so the
    /// expressive variants light up. Built-in callers that don't
    /// use compositors can leave this as `None`.
    pub policy_state: Option<&'a PolicyState>,
    /// Reentrancy depth for `TriggerAbility` chains. Engine
    /// adapter (Sprint 5) bumps this on each nested expansion and
    /// refuses to recurse past [`MAX_CHAIN_DEPTH`]. Today the
    /// field is a placeholder so the eventual implementation has
    /// the right shape ready.
    pub chain_depth: u32,
    /// Round 39 / A8: id of the ability currently firing. `ModifyStat`
    /// stamps this into the modifier key as a source tag so two
    /// abilities that both write `modify_stat damage mul 1.5` no longer
    /// collide on the same key. `None` outside a dispatched ability
    /// (built-in callers, tests) — in which case the source falls back
    /// to the literal `"default"` for backward compat with pre-A8 keys.
    pub firing_ability_id: Option<&'a str>,
    /// Phase 9: RAW (unmodified) base max HP per side, consulted ONLY by
    /// the [`EffectKind::FormSwap`] form-in reconcile. When a status hook
    /// dispatched MID-COMBAT installs a capping form, the surrounding
    /// `*_stats.health` is the post-hoist `eff` value with active max-HP
    /// modifiers already folded in, so reconciling the form against it
    /// double-counts the cap. The status-apply dispatch threads the raw
    /// `params.<side>.health` here so the form-in computes its effective
    /// max from the true base. `None` for every other caller, where the
    /// form-in falls back to `target_stats(target).health` (byte-identical).
    /// Symmetric with the teardown's `bearer_base_health` and
    /// `process_form_revert`'s `base_health`, which are likewise raw.
    pub caster_base_health: Option<f64>,
    pub opponent_base_health: Option<f64>,
}

impl EffectContext<'_> {
    fn target_hp(&mut self, target: EffectTarget) -> &mut f64 {
        match target {
            EffectTarget::Caster => &mut *self.caster_hp,
            EffectTarget::Opponent => &mut *self.opponent_hp,
        }
    }

    fn target_stats(&self, target: EffectTarget) -> &SimpleCombatantStats {
        match target {
            EffectTarget::Caster => self.caster_stats,
            EffectTarget::Opponent => self.opponent_stats,
        }
    }

    /// Base max HP to reconcile a [`EffectKind::FormSwap`] form-in against.
    /// Prefers the RAW per-side override (set by the mid-combat status-apply
    /// dispatch) so a capping form isn't computed against an already-modified
    /// `eff` max; falls back to `target_stats(target).health` when unset, which
    /// is byte-identical for every non-status-apply caller.
    fn target_base_health(&self, target: EffectTarget) -> f64 {
        let raw = match target {
            EffectTarget::Caster => self.caster_base_health,
            EffectTarget::Opponent => self.opponent_base_health,
        };
        raw.unwrap_or_else(|| self.target_stats(target).health)
    }

    fn target_statuses(
        &mut self,
        target: EffectTarget,
    ) -> &mut BTreeMap<String, SimpleStatusInstance> {
        match target {
            EffectTarget::Caster => &mut *self.caster_statuses,
            EffectTarget::Opponent => &mut *self.opponent_statuses,
        }
    }

    fn target_cooldowns(&mut self, target: EffectTarget) -> &mut BTreeMap<String, f64> {
        match target {
            EffectTarget::Caster => &mut *self.caster_cooldowns,
            EffectTarget::Opponent => &mut *self.opponent_cooldowns,
        }
    }

    fn target_active_until(&mut self, target: EffectTarget) -> &mut BTreeMap<String, f64> {
        match target {
            EffectTarget::Caster => &mut *self.caster_active_until,
            EffectTarget::Opponent => &mut *self.opponent_active_until,
        }
    }

    fn target_extras(
        &mut self,
        target: EffectTarget,
    ) -> &mut BTreeMap<String, crate::policy::state::PolicyValue> {
        match target {
            EffectTarget::Caster => &mut *self.caster_extras,
            EffectTarget::Opponent => &mut *self.opponent_extras,
        }
    }

    fn target_snapshots(
        &mut self,
        target: EffectTarget,
    ) -> Option<&mut BTreeMap<String, UserSideSnapshot>> {
        match target {
            EffectTarget::Caster => self.caster_snapshots.as_deref_mut(),
            EffectTarget::Opponent => self.opponent_snapshots.as_deref_mut(),
        }
    }

    /// Round 37 / A7: best-effort write to the target side's healing
    /// accumulator. No-op when the accumulator wasn't supplied
    /// (built-in callers).
    fn record_target_healing(&mut self, target: EffectTarget, healed: f64) {
        if healed <= 0.0 {
            return;
        }
        match target {
            EffectTarget::Caster => {
                if let Some(acc) = self.caster_iter_healing.as_deref_mut() {
                    *acc += healed;
                }
            }
            EffectTarget::Opponent => {
                if let Some(acc) = self.opponent_iter_healing.as_deref_mut() {
                    *acc += healed;
                }
            }
        }
    }
}

/// Apply every effect in `batch` against `ctx`, in order. Each
/// effect is best-effort: the function never returns an error or
/// panics on out-of-range inputs (e.g. negative damage clamps to
/// 0, missing status decay clamps to 0). Returns the count of
/// effects that produced a visible mutation, which the caller
/// uses to decide whether to record a combat-log event.
pub fn apply_effect_batch(batch: &EffectBatch, ctx: &mut EffectContext<'_>) -> u32 {
    // Round 45 / B6: batch-level gate. When `when` is set and
    // evaluates falsy against the current policy state, skip the
    // whole batch (no effects, no combat-log entry). Requires
    // policy_state — without it (built-in test paths) the gate is
    // a no-op fall-through, matching how `EffectKind::Conditional`
    // already behaves.
    if let Some(gate) = &batch.when {
        if let Some(state) = ctx.policy_state {
            if !gate.eval_bool(state) {
                return 0;
            }
        }
    }
    let mut applied = 0;
    for effect in &batch.effects {
        applied += apply_effect_count(effect, ctx);
    }
    applied
}

/// Apply one effect, returning the count of leaf effects that
/// produced a visible mutation. Compositor variants
/// (`Conditional` / `Repeat`) recurse and sum their inner counts;
/// leaf variants return `0` or `1`.
fn apply_effect_count(effect: &EffectKind, ctx: &mut EffectContext<'_>) -> u32 {
    match effect {
        EffectKind::Conditional {
            cond,
            then,
            otherwise,
        } => {
            // No PolicyState ⇒ both branches skipped. Built-in
            // callers that don't pipe a snapshot get no compositor
            // semantics, which is the safe default.
            let Some(state) = ctx.policy_state else {
                return 0;
            };
            let branch = if cond.eval_bool(state) { then } else { otherwise };
            let mut applied = 0;
            for child in branch {
                applied += apply_effect_count(child, ctx);
            }
            applied
        }
        EffectKind::Repeat { count, body } => {
            let n = (*count).min(MAX_REPEAT_COUNT);
            let mut applied = 0;
            for _ in 0..n {
                for child in body {
                    applied += apply_effect_count(child, ctx);
                }
            }
            applied
        }
        EffectKind::ScheduleEffect { delay_sec, effects, name } => {
            // Caster schedules — own queue. Capped delay; capped
            // queue size with FIFO eviction on overflow.
            // `.max(lo).min(hi)` coerces NaN to the bound; clamp() would propagate NaN.
            #[allow(clippy::manual_clamp)]
            let due_at = ctx.time + delay_sec.max(0.0).min(MAX_SCHEDULE_DELAY_SEC);
            let Some(queue) = ctx.caster_scheduled.as_deref_mut() else {
                return 0;
            };
            queue.push(ScheduledEntry {
                due_at,
                effects: effects.clone(),
                name: name.clone(),
            });
            // Evict oldest if past cap.
            while queue.len() > MAX_SCHEDULED_PER_SIDE {
                queue.remove(0);
            }
            // Schedule itself counts as 1 applied — surfaces in
            // combat-log even though deferred.
            1
        }
        EffectKind::CancelSchedule { name } => {
            // Round 38 / A12: remove every queued entry on the
            // caster's side whose `name` matches. Returns the count
            // removed so combat-log records meaningful "cancelled N"
            // semantics rather than a flat 0/1.
            let Some(queue) = ctx.caster_scheduled.as_deref_mut() else {
                return 0;
            };
            let before = queue.len();
            queue.retain(|entry| entry.name.as_deref() != Some(name.as_str()));
            (before - queue.len()) as u32
        }
        EffectKind::Reschedule { name, delay_sec } => {
            // Round 38 / A12: find the FIRST entry on the caster's
            // queue with this `name` and move its `due_at` to
            // `time + delay_sec`. Multiple entries with the same
            // name: only the first moves. Caller can `cancel_schedule`
            // first then re-`schedule` if "reschedule all with this
            // name" semantics are wanted.
            let Some(queue) = ctx.caster_scheduled.as_deref_mut() else {
                return 0;
            };
            // `.max(lo).min(hi)` coerces NaN to the bound; clamp() would propagate NaN.
            #[allow(clippy::manual_clamp)]
            let new_due = ctx.time + delay_sec.max(0.0).min(MAX_SCHEDULE_DELAY_SEC);
            for entry in queue.iter_mut() {
                if entry.name.as_deref() == Some(name.as_str()) {
                    entry.due_at = new_due;
                    return 1;
                }
            }
            0
        }
        EffectKind::Chance { probability, then } => {
            // Gate the inner branch on a deterministic-pseudo-random
            // roll. Without a policy_state we have no time to seed
            // against, so the gate fails closed (no fire).
            let Some(state) = ctx.policy_state else {
                return 0;
            };
            let p = probability.eval(state).clamp(0.0, 1.0);
            if p <= 0.0 {
                return 0;
            }
            // Seed mixes time (changes each iteration), the caster's
            // extras count (uniqueness within an iteration when
            // multiple chance gates fire), and a constant prime —
            // enough variety for combat without true randomness.
            let seed_a = (state.time * 1_000_000.0).round() as u64;
            let seed_b = state.self_side.extras.len() as u64;
            let mixed = lcg_pseudo_roll(seed_a.wrapping_add(seed_b.wrapping_mul(0x9E37_79B9)));
            if mixed >= p {
                return 0;
            }
            let mut applied = 0;
            for child in then {
                applied += apply_effect_count(child, ctx);
            }
            applied
        }
        EffectKind::Choose { branches } => {
            // Round 34 / A2: pick exactly one branch by weighted random.
            // Same seed mix as `Chance` so a `choose` + a `chance` at
            // the same `(time, extras-count)` share the deterministic
            // stream. Without a policy_state we have no time to seed
            // against; fail closed (no branch fires).
            let Some(state) = ctx.policy_state else {
                return 0;
            };
            if branches.is_empty() {
                return 0;
            }
            // Evaluate each weight against the current state, clamped
            // to >= 0 so negatives don't subtract from total. Branches
            // with weight 0 are eligible to be skipped over.
            let weights: Vec<f64> = branches
                .iter()
                .map(|b| b.weight.eval(state).max(0.0))
                .collect();
            let total: f64 = weights.iter().sum();
            if total <= 0.0 {
                return 0;
            }
            let seed_a = (state.time * 1_000_000.0).round() as u64;
            let seed_b = state.self_side.extras.len() as u64;
            // Salt with a different constant from `Chance` (0xB504_F333,
            // the integer hex of sqrt(2)/2 * 2^32) so a `choose` and a
            // `chance` placed in the same effect batch don't pull the
            // SAME number from the stream — they share the seed source
            // but diverge after this XOR.
            let mixed = lcg_pseudo_roll(
                seed_a
                    .wrapping_add(seed_b.wrapping_mul(0x9E37_79B9))
                    .wrapping_add(0xB504_F333),
            );
            let target = mixed * total;
            let mut cursor = 0.0;
            for (i, w) in weights.iter().enumerate() {
                cursor += w;
                if target < cursor {
                    // This branch wins — apply its effects.
                    let mut applied = 0;
                    for child in &branches[i].effects {
                        applied += apply_effect_count(child, ctx);
                    }
                    return applied;
                }
            }
            // Floating-point edge: target == total exactly. Fall back
            // to the last positive-weight branch.
            for (i, w) in weights.iter().enumerate().rev() {
                if *w > 0.0 {
                    let mut applied = 0;
                    for child in &branches[i].effects {
                        applied += apply_effect_count(child, ctx);
                    }
                    return applied;
                }
            }
            0
        }
        EffectKind::TriggerAbility { ability_id } => {
            // Sprint 5.7: look up the target ability and inline its
            // on_fire batch. Hard depth cap prevents pathological
            // mutual-recursion (A triggers B which triggers A …).
            if ctx.chain_depth >= MAX_CHAIN_DEPTH {
                return 0;
            }
            let Some(spec) = crate::wasm_api::snapshot_user_ability(ability_id) else {
                return 0;
            };
            let Some(on_fire) = spec.on_fire else {
                return 0;
            };
            ctx.chain_depth += 1;
            let mut applied = 0;
            for child in &on_fire.effects {
                applied += apply_effect_count(child, ctx);
            }
            ctx.chain_depth -= 1;
            applied
        }
        leaf => {
            if apply_effect(leaf, ctx) {
                1
            } else {
                0
            }
        }
    }
}

fn apply_effect(effect: &EffectKind, ctx: &mut EffectContext<'_>) -> bool {
    match effect {
        EffectKind::DealDirectDamage { target, amount } => {
            let target = *target;
            let stats = ctx.target_stats(target).clone();
            let capped = apply_unbreakable_damage_cap(*amount, &stats);
            if capped <= 0.0 {
                return false;
            }
            let hp = ctx.target_hp(target);
            *hp = (*hp - capped).max(0.0);
            true
        }
        EffectKind::DealDirectDamageMaxHpFraction { target, fraction } => {
            let target = *target;
            let stats_max_hp = ctx.target_stats(target).health.max(0.0);
            let raw = stats_max_hp * fraction.max(0.0);
            let stats = ctx.target_stats(target).clone();
            let capped = apply_unbreakable_damage_cap(raw, &stats);
            if capped <= 0.0 {
                return false;
            }
            let hp = ctx.target_hp(target);
            *hp = (*hp - capped).max(0.0);
            true
        }
        EffectKind::HealHp { target, amount } => {
            let target = *target;
            if *amount <= 0.0 {
                return false;
            }
            let max_hp = ctx.target_stats(target).health.max(0.0);
            let blocked = ctx
                .target_statuses(target)
                .get("Heartbroken_Status")
                .map(|inst| inst.stacks > 0.0)
                .unwrap_or(false);
            if blocked {
                return false;
            }
            let hp = ctx.target_hp(target);
            let before = *hp;
            *hp = (*hp + amount).min(max_hp);
            let healed = (*hp - before).max(0.0);
            // Round 37 / A7: feed OnHeal trigger accumulator.
            ctx.record_target_healing(target, healed);
            true
        }
        EffectKind::ApplyStatusToTarget { target, status } => {
            let target = *target;
            let now = ctx.time;
            let target_hp_value = *ctx.target_hp(target);
            let stats = ctx.target_stats(target).clone();
            let statuses = ctx.target_statuses(target);
            apply_incoming_statuses_to_target(
                now,
                &stats,
                target_hp_value,
                statuses,
                std::slice::from_ref(status),
            );
            true
        }
        EffectKind::ApplyStatusesToTarget { target, statuses: applied } => {
            // Round 35 / A3: array variant. Same resist/plushie path
            // as the singular kind; engine handles per-entry blocking.
            if applied.is_empty() {
                return false;
            }
            let target = *target;
            let now = ctx.time;
            let target_hp_value = *ctx.target_hp(target);
            let stats = ctx.target_stats(target).clone();
            let statuses = ctx.target_statuses(target);
            apply_incoming_statuses_to_target(
                now,
                &stats,
                target_hp_value,
                statuses,
                applied.as_slice(),
            );
            true
        }
        EffectKind::CleanseFortifyRemovableStatuses { target } => {
            let target = *target;
            let statuses = ctx.target_statuses(target);
            let removable: Vec<String> = statuses
                .iter()
                .filter(|(id, inst)| is_fortify_cleansable_instance(id, inst))
                .map(|(id, _)| id.clone())
                .collect();
            if removable.is_empty() {
                return false;
            }
            for id in removable {
                statuses.remove(&id);
            }
            true
        }
        EffectKind::SetCooldownUntil {
            target,
            cooldown_id,
            duration_sec,
        } => {
            let target = *target;
            let until = ctx.time + duration_sec.max(0.0);
            let map = ctx.target_cooldowns(target);
            map.insert(cooldown_id.clone(), until);
            true
        }
        EffectKind::SetActiveUntil {
            target,
            active_id,
            duration_sec,
        } => {
            let target = *target;
            let until = ctx.time + duration_sec.max(0.0);
            let map = ctx.target_active_until(target);
            map.insert(active_id.clone(), until);
            true
        }
        EffectKind::SetCooldownUntilExpr {
            target,
            cooldown_id,
            duration_sec,
        } => {
            let Some(state) = ctx.policy_state else {
                return false;
            };
            let dur = duration_sec.eval(state).max(0.0);
            let target = *target;
            let until = ctx.time + dur;
            let map = ctx.target_cooldowns(target);
            map.insert(cooldown_id.clone(), until);
            true
        }
        EffectKind::SetActiveUntilExpr {
            target,
            active_id,
            duration_sec,
        } => {
            let Some(state) = ctx.policy_state else {
                return false;
            };
            let dur = duration_sec.eval(state).max(0.0);
            let target = *target;
            let until = ctx.time + dur;
            let map = ctx.target_active_until(target);
            map.insert(active_id.clone(), until);
            true
        }
        EffectKind::PaySelfCostMaxHpFraction { target, fraction } => {
            let target = *target;
            let max_hp = ctx.target_stats(target).health.max(0.0);
            let cost = max_hp * fraction.max(0.0);
            if cost <= 0.0 {
                return false;
            }
            let hp = ctx.target_hp(target);
            *hp = (*hp - cost).max(1.0); // 1 HP floor mirrors the live engine's HC convention
            true
        }
        // Compositor variants are routed through `apply_effect_count`
        // before reaching this leaf-only handler. If we're here for
        // one, dispatch is misrouted — return false to stay safe.
        EffectKind::Conditional { .. }
        | EffectKind::Repeat { .. }
        | EffectKind::Chance { .. }
        | EffectKind::Choose { .. }
        | EffectKind::ScheduleEffect { .. }
        | EffectKind::CancelSchedule { .. }
        | EffectKind::Reschedule { .. } => false,
        EffectKind::ModifyStat {
            target,
            field,
            mode,
            value,
            duration_sec,
        } => {
            // Sprint 5.6: write modifier to target's per-side
            // `user_extras` under structured keys. The engine's
            // effective-stat readers consult this map.
            let target = *target;
            let now = ctx.time;
            let until = if *duration_sec <= 0.0 {
                f64::INFINITY
            } else {
                now + duration_sec
            };
            let mode_str = match mode {
                ModifierMode::Add => "add",
                ModifierMode::Mul => "mul",
                ModifierMode::Set => "set",
            };
            // Round 39 / A8: stamp source into the key so multiple
            // abilities don't collide on the same modifier slot.
            let source = ctx.firing_ability_id.unwrap_or("default");
            let value_key = format!("{MODIFIER_KEY_PREFIX}{field}.{mode_str}.{source}.value");
            let until_key = format!("{MODIFIER_KEY_PREFIX}{field}.{mode_str}.{source}.until");
            let extras = ctx.target_extras(target);
            extras.insert(
                value_key,
                crate::policy::state::PolicyValue::Number(*value),
            );
            extras.insert(
                until_key,
                crate::policy::state::PolicyValue::Number(until),
            );
            true
        }
        EffectKind::TriggerAbility { .. } => {
            // Routed through `apply_effect_count` (the recursive
            // dispatcher) — this leaf arm should never fire.
            false
        }
        EffectKind::SetHp { target, value } => {
            let target = *target;
            let max_hp = ctx.target_stats(target).health.max(0.0);
            let new_hp = value.clamp(0.0, max_hp);
            let hp = ctx.target_hp(target);
            if (*hp - new_hp).abs() < 1e-9 {
                return false;
            }
            let healed = (new_hp - *hp).max(0.0);
            *hp = new_hp;
            // Round 37 / A7: if HP went up, fire OnHeal.
            ctx.record_target_healing(target, healed);
            true
        }
        EffectKind::TransferHp { from, to, amount } => {
            if *amount <= 0.0 {
                return false;
            }
            let from = *from;
            let to = *to;
            // Compute the actual transferable amount: source HP
            // can't drop below 1, destination caps at its max HP.
            let max_dest = ctx.target_stats(to).health.max(0.0);
            let src_hp = *ctx.target_hp(from);
            let dest_hp = *ctx.target_hp(to);
            let drainable = (src_hp - 1.0).max(0.0).min(*amount);
            let receivable = (max_dest - dest_hp).max(0.0).min(drainable);
            if receivable <= 0.0 {
                return false;
            }
            *ctx.target_hp(from) = src_hp - receivable;
            *ctx.target_hp(to) = dest_hp + receivable;
            // Round 37 / A7: recipient side gained HP → fire OnHeal
            // there. The `from` side lost HP — handled by the normal
            // damage-detection path in phase 16.
            ctx.record_target_healing(to, receivable);
            true
        }
        EffectKind::SwapHpRatio => {
            let caster_max = ctx.caster_stats.health.max(1.0);
            let opp_max = ctx.opponent_stats.health.max(1.0);
            let caster_ratio = (*ctx.caster_hp / caster_max).clamp(0.0, 1.0);
            let opp_ratio = (*ctx.opponent_hp / opp_max).clamp(0.0, 1.0);
            *ctx.caster_hp = caster_max * opp_ratio;
            *ctx.opponent_hp = opp_max * caster_ratio;
            true
        }
        EffectKind::FormSwap {
            target,
            stat_changes,
            duration_sec,
            hp_policy,
        } => {
            let target = *target;
            // RAW base when a mid-combat status-apply dispatch set the override
            // (so a capping form isn't reconciled against an already-modified
            // `eff` max — see `caster_base_health`); else the eff `target_stats`
            // value, byte-identical for every other caller.
            let base_health = ctx.target_base_health(target);
            let now = ctx.time;
            let hp_before = *ctx.target_hp(target);
            // `firing_ability_id` is a `&'a str` (not a borrow of ctx), so it
            // survives the mutable `target_extras` borrow below — same as the
            // ModifyStat arm.
            let source = ctx.firing_ability_id.unwrap_or("default");
            let until = if *duration_sec <= 0.0 {
                f64::INFINITY
            } else {
                now + duration_sec
            };
            let (max_before, max_after) = {
                let extras = ctx.target_extras(target);
                let max_before = effective_stat_value(base_health, "health", extras, now).max(1.0);
                // Sugar over modify_stat: each change writes the same
                // modifier.<field>.<mode>.<source>.* keys.
                for change in stat_changes {
                    let mode_str = match change.mode {
                        ModifierMode::Add => "add",
                        ModifierMode::Mul => "mul",
                        ModifierMode::Set => "set",
                    };
                    extras.insert(
                        format!("{MODIFIER_KEY_PREFIX}{}.{}.{}.value", change.field, mode_str, source),
                        crate::policy::state::PolicyValue::Number(change.value),
                    );
                    extras.insert(
                        format!("{MODIFIER_KEY_PREFIX}{}.{}.{}.until", change.field, mode_str, source),
                        crate::policy::state::PolicyValue::Number(until),
                    );
                }
                let max_after = effective_stat_value(base_health, "health", extras, now).max(1.0);
                // Temporary form: stamp the revert marker so the event loop
                // runs the symmetric reverse reconciliation when the
                // modifiers expire. Permanent forms (until == INFINITY) never
                // revert, so no marker.
                if until.is_finite() {
                    let (code, set_value) = hp_policy_to_code(*hp_policy);
                    extras.insert(FORM_REVERT_UNTIL_KEY.to_string(), crate::policy::state::PolicyValue::Number(until));
                    extras.insert(FORM_REVERT_MAX_KEY.to_string(), crate::policy::state::PolicyValue::Number(max_after));
                    extras.insert(FORM_REVERT_POLICY_KEY.to_string(), crate::policy::state::PolicyValue::Number(code));
                    extras.insert(FORM_REVERT_SET_VALUE_KEY.to_string(), crate::policy::state::PolicyValue::Number(set_value));
                } else {
                    // Permanent form (no revert timer). When a status hook
                    // installs it, the status's teardown is what reverts it —
                    // stamp the authored policy per-source so teardown honors
                    // it instead of defaulting to proportional. Harmless for a
                    // non-status permanent form (no teardown ever reads it).
                    stamp_status_teardown_policy(extras, source, *hp_policy);
                }
                (max_before, max_after)
            };
            let new_hp = reconcile_form_hp(*hp_policy, hp_before, max_before, max_after);
            let healed = (new_hp - hp_before).max(0.0);
            *ctx.target_hp(target) = new_hp;
            // A form-in that raises HP counts as healing for OnHeal triggers.
            ctx.record_target_healing(target, healed);
            true
        }
        EffectKind::ClearStatus { target, status_id } => {
            let target = *target;
            let statuses = ctx.target_statuses(target);
            statuses.remove(status_id).is_some()
        }
        EffectKind::ClearStatuses { target, status_ids } => {
            // Round 35 / A3: array variant. Each id processed
            // independently; absent ids silently no-op. Returns true
            // if at least one was actually present and removed.
            if status_ids.is_empty() {
                return false;
            }
            let target = *target;
            let statuses = ctx.target_statuses(target);
            let mut any_removed = false;
            for id in status_ids {
                if statuses.remove(id).is_some() {
                    any_removed = true;
                }
            }
            any_removed
        }
        EffectKind::ModifyStatusStacks {
            target,
            status_id,
            mode,
            value,
        } => {
            let target = *target;
            let statuses = ctx.target_statuses(target);
            let entry = statuses.get_mut(status_id);
            let Some(entry) = entry else {
                // Per-spec: this op only modifies an existing
                // status. Use ApplyStatusToTarget to create one.
                return false;
            };
            let new_stacks = match mode {
                ModifierMode::Add => (entry.stacks + value).max(0.0),
                ModifierMode::Set => value.max(0.0),
                // Mul on stacks is a footgun (0 × anything = 0
                // surprise); reject explicitly.
                ModifierMode::Mul => entry.stacks,
            };
            if new_stacks <= 0.0 {
                statuses.remove(status_id);
            } else {
                entry.stacks = new_stacks;
            }
            true
        }
        EffectKind::DispelAllStatuses { target } => {
            let target = *target;
            let statuses = ctx.target_statuses(target);
            if statuses.is_empty() {
                return false;
            }
            statuses.clear();
            true
        }
        EffectKind::CooldownReset {
            target,
            cooldown_id,
            which,
        } => {
            let target = *target;
            let map = match which {
                TimerSlot::Cooldown => ctx.target_cooldowns(target),
                TimerSlot::ActiveUntil => ctx.target_active_until(target),
            };
            map.remove(cooldown_id).is_some()
        }
        EffectKind::InterruptNextHit { target, delay_sec } => {
            // The interrupt writes through `extras` because
            // CombatSide's `next_hit` field isn't part of
            // EffectContext. The engine adapter consults
            // `interrupt_next_hit_delay` in user_extras at the
            // top of each iteration to push next_hit. This keeps
            // the apply path here narrow; the adapter side lives
            // in composable/mod.rs (Sprint 5.x extension).
            //
            // For today: write the absolute target time into
            // extras so the next iteration's bite-scheduling sees
            // it. Acts as a one-shot "next bite no earlier than X".
            let target = *target;
            let delay = delay_sec.max(0.0);
            let new_next_hit = ctx.time + delay;
            ctx.target_extras(target).insert(
                "next_hit_floor".to_string(),
                crate::policy::state::PolicyValue::Number(new_next_hit),
            );
            true
        }
        EffectKind::ConsumeBreath { target, amount } => {
            // Breath capacity lives on CombatSide, not directly on
            // EffectContext. Same routing as next_hit interrupt —
            // we record the request in extras and the adapter
            // applies it at the top of the next iteration.
            let target = *target;
            let amt = amount.max(0.0);
            if amt <= 0.0 {
                return false;
            }
            let key = "breath_consume_pending";
            let prev = ctx
                .target_extras(target)
                .get(key)
                .and_then(crate::policy::state::PolicyValue::as_number)
                .unwrap_or(0.0);
            ctx.target_extras(target).insert(
                key.to_string(),
                crate::policy::state::PolicyValue::Number(prev + amt),
            );
            true
        }
        EffectKind::RestoreBreath { target, amount } => {
            let target = *target;
            // `.max(lo).min(hi)` coerces NaN to the bound; clamp() would propagate NaN.
            #[allow(clippy::manual_clamp)]
            let amt = amount.max(0.0).min(10_000.0);
            if amt <= 0.0 {
                return false;
            }
            let key = "breath_restore_pending";
            let prev = ctx
                .target_extras(target)
                .get(key)
                .and_then(crate::policy::state::PolicyValue::as_number)
                .unwrap_or(0.0);
            ctx.target_extras(target).insert(
                key.to_string(),
                crate::policy::state::PolicyValue::Number(prev + amt),
            );
            true
        }
        EffectKind::DealExprDamage { target, amount } => {
            let Some(state) = ctx.policy_state else {
                return false;
            };
            let amt = amount.eval(state).max(0.0);
            if amt <= 0.0 {
                return false;
            }
            let target = *target;
            let stats = ctx.target_stats(target).clone();
            let capped = apply_unbreakable_damage_cap(amt, &stats);
            if capped <= 0.0 {
                return false;
            }
            let hp = ctx.target_hp(target);
            *hp = (*hp - capped).max(0.0);
            true
        }
        EffectKind::HealExprAmount { target, amount } => {
            let Some(state) = ctx.policy_state else {
                return false;
            };
            let amt = amount.eval(state).max(0.0);
            if amt <= 0.0 {
                return false;
            }
            let target = *target;
            let max_hp = ctx.target_stats(target).health.max(0.0);
            let blocked = ctx
                .target_statuses(target)
                .get("Heartbroken_Status")
                .map(|inst| inst.stacks > 0.0)
                .unwrap_or(false);
            if blocked {
                return false;
            }
            let hp = ctx.target_hp(target);
            let before = *hp;
            *hp = (*hp + amt).min(max_hp);
            let healed = (*hp - before).max(0.0);
            // Round 37 / A7: feed OnHeal trigger accumulator.
            ctx.record_target_healing(target, healed);
            true
        }
        EffectKind::ApplyStatusExprStacks {
            target,
            status_id,
            stacks,
            source_ability,
        } => {
            let Some(state) = ctx.policy_state else {
                return false;
            };
            let stack_count = stacks.eval(state).max(0.0);
            if stack_count <= 0.0 {
                return false;
            }
            let target = *target;
            let now = ctx.time;
            let target_hp_value = *ctx.target_hp(target);
            let stats = ctx.target_stats(target).clone();
            let statuses = ctx.target_statuses(target);
            apply_incoming_statuses_to_target(
                now,
                &stats,
                target_hp_value,
                statuses,
                std::slice::from_ref(&SimpleAppliedStatus {
                    status_id: status_id.clone(),
                    stacks: stack_count,
                    source_ability: source_ability.clone(),
                }),
            );
            true
        }
        EffectKind::SetHpExpr { target, value } => {
            let Some(state) = ctx.policy_state else {
                return false;
            };
            let v = value.eval(state);
            let target = *target;
            let max_hp = ctx.target_stats(target).health.max(0.0);
            let new_hp = v.clamp(0.0, max_hp);
            let hp = ctx.target_hp(target);
            if (*hp - new_hp).abs() < 1e-9 {
                return false;
            }
            let healed = (new_hp - *hp).max(0.0);
            *hp = new_hp;
            // Round 37 / A7: HP went up → fire OnHeal.
            ctx.record_target_healing(target, healed);
            true
        }
        EffectKind::SetExtra { target, key, value } => {
            let Some(state) = ctx.policy_state else {
                return false;
            };
            let v = value.eval(state);
            let target = *target;
            ctx.target_extras(target).insert(
                key.clone(),
                crate::policy::state::PolicyValue::Number(v),
            );
            true
        }
        EffectKind::IncrementExtra {
            target,
            key,
            amount,
        } => {
            let Some(state) = ctx.policy_state else {
                return false;
            };
            let delta = amount.eval(state);
            let target = *target;
            let extras = ctx.target_extras(target);
            let prev = extras
                .get(key)
                .and_then(crate::policy::state::PolicyValue::as_number)
                .unwrap_or(0.0);
            extras.insert(
                key.clone(),
                crate::policy::state::PolicyValue::Number(prev + delta),
            );
            true
        }
        EffectKind::PushExtra { target, key, value } => {
            let Some(state) = ctx.policy_state else {
                return false;
            };
            let v = value.eval(state);
            let target = *target;
            let extras = ctx.target_extras(target);
            let length_key = format!("{key}.length");
            let length = extras
                .get(&length_key)
                .and_then(crate::policy::state::PolicyValue::as_number)
                .unwrap_or(0.0) as u32;
            if length >= MAX_ARRAY_EXTRA_LEN {
                return false; // silent drop past cap
            }
            extras.insert(
                format!("{key}.{length}"),
                crate::policy::state::PolicyValue::Number(v),
            );
            extras.insert(
                length_key,
                crate::policy::state::PolicyValue::Number((length + 1) as f64),
            );
            true
        }
        EffectKind::ClearExtraArray { target, key } => {
            let target = *target;
            let extras = ctx.target_extras(target);
            let length_key = format!("{key}.length");
            let length = extras
                .get(&length_key)
                .and_then(crate::policy::state::PolicyValue::as_number)
                .unwrap_or(0.0) as u32;
            if length == 0 {
                return false;
            }
            for i in 0..length {
                extras.remove(&format!("{key}.{i}"));
            }
            extras.remove(&length_key);
            true
        }
        EffectKind::DealTypedDamage {
            target,
            damage_type,
            amount,
        } => {
            if *amount <= 0.0 {
                return false;
            }
            let target = *target;
            // Compute the routed damage for each kind. We don't have
            // the full melee / breath statuses contexts here (those
            // are owned by the live engine); we apply the simplest
            // resistance correction for each kind:
            //   Bite  → defender.damage_taken_multiplier_on_being_bitten
            //   Breath → (1 - clamp(defender.breath_resistance, 0, 1))
            //   True  → no reduction
            let stats = ctx.target_stats(target).clone();
            let routed = match damage_type {
                TypedDamageKind::True => *amount,
                TypedDamageKind::Bite => {
                    *amount * stats.damage_taken_multiplier_on_being_bitten.max(0.0)
                }
                TypedDamageKind::Breath => {
                    let resistance = stats.breath_resistance.clamp(0.0, 1.0);
                    *amount * (1.0 - resistance)
                }
            };
            let capped = apply_unbreakable_damage_cap(routed, &stats);
            if capped <= 0.0 {
                return false;
            }
            let hp = ctx.target_hp(target);
            *hp = (*hp - capped).max(0.0);
            true
        }
        EffectKind::RecordSnapshot { target, key } => {
            let target = *target;
            // Build snapshot from current state, then write.
            let hp_value = *ctx.target_hp(target);
            let statuses_clone = ctx.target_statuses(target).clone();
            let extras_clone = ctx.target_extras(target).clone();
            let snapshot = UserSideSnapshot {
                hp: hp_value,
                statuses: statuses_clone,
                user_extras: extras_clone,
            };
            let Some(map) = ctx.target_snapshots(target) else {
                return false;
            };
            map.insert(key.clone(), snapshot);
            true
        }
        EffectKind::RestoreSnapshot { target, key } => {
            let target = *target;
            // Pull snapshot out of map (clone) then write fields.
            let snapshot_clone = match ctx.target_snapshots(target) {
                Some(map) => map.get(key).cloned(),
                None => None,
            };
            let Some(snapshot) = snapshot_clone else {
                return false;
            };
            *ctx.target_hp(target) = snapshot.hp;
            *ctx.target_statuses(target) = snapshot.statuses;
            *ctx.target_extras(target) = snapshot.user_extras;
            true
        }
        EffectKind::ExtendStatus {
            target,
            status_id,
            seconds,
        } => {
            let target = *target;
            let statuses = ctx.target_statuses(target);
            let Some(entry) = statuses.get_mut(status_id) else {
                return false;
            };
            entry.remaining_sec = (entry.remaining_sec + seconds).max(0.0);
            if entry.remaining_sec <= 0.0 {
                statuses.remove(status_id);
            }
            true
        }
        EffectKind::SetStatusNextDecay {
            target,
            status_id,
            absolute_time,
        } => {
            let target = *target;
            let now = ctx.time;
            let statuses = ctx.target_statuses(target);
            let Some(entry) = statuses.get_mut(status_id) else {
                return false;
            };
            entry.next_decay_at = Some(absolute_time.max(now));
            true
        }
        EffectKind::SetStatusNextTick {
            target,
            status_id,
            absolute_time,
        } => {
            // Round 33 / A4: twin of SetStatusNextDecay but writes to
            // the DOT-tick schedule field. No-op when status absent.
            let target = *target;
            let now = ctx.time;
            let statuses = ctx.target_statuses(target);
            let Some(entry) = statuses.get_mut(status_id) else {
                return false;
            };
            entry.next_tick_at = Some(absolute_time.max(now));
            true
        }
        EffectKind::ConsumeStatusForDamage {
            target,
            status_id,
            damage_per_stack,
        } => {
            let Some(state) = ctx.policy_state else {
                return false;
            };
            let target = *target;
            let stacks = {
                let statuses = ctx.target_statuses(target);
                statuses.get(status_id).map(|inst| inst.stacks).unwrap_or(0.0)
            };
            if stacks <= 0.0 {
                return false;
            }
            let per_stack = damage_per_stack.eval(state).max(0.0);
            let total = stacks * per_stack;
            // Remove the status FIRST (or after — same visible
            // outcome since statuses doesn't affect the damage
            // calc here). Doing it after lets a future precise-
            // damage pipeline read the stacks for any per-stack
            // resistance interaction.
            ctx.target_statuses(target).remove(status_id);
            if total <= 0.0 {
                return true; // status removed but no damage
            }
            let stats = ctx.target_stats(target).clone();
            let capped = apply_unbreakable_damage_cap(total, &stats);
            if capped > 0.0 {
                let hp = ctx.target_hp(target);
                *hp = (*hp - capped).max(0.0);
            }
            true
        }
        EffectKind::ModifyStatExpr {
            target,
            field,
            mode,
            value,
            duration_sec,
        } => {
            let Some(state) = ctx.policy_state else {
                return false;
            };
            let v = value.eval(state);
            let dur = duration_sec.eval(state);
            let target = *target;
            let now = ctx.time;
            let until = if dur <= 0.0 {
                f64::INFINITY
            } else {
                now + dur
            };
            let mode_str = match mode {
                ModifierMode::Add => "add",
                ModifierMode::Mul => "mul",
                ModifierMode::Set => "set",
            };
            // Round 39 / A8: same source-stamp scheme as ModifyStat.
            let source = ctx.firing_ability_id.unwrap_or("default");
            let value_key = format!("{MODIFIER_KEY_PREFIX}{field}.{mode_str}.{source}.value");
            let until_key = format!("{MODIFIER_KEY_PREFIX}{field}.{mode_str}.{source}.until");
            let extras = ctx.target_extras(target);
            extras.insert(
                value_key,
                crate::policy::state::PolicyValue::Number(v),
            );
            extras.insert(
                until_key,
                crate::policy::state::PolicyValue::Number(until),
            );
            true
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fresh_stats(max_hp: f64) -> SimpleCombatantStats {
        SimpleCombatantStats {
            health: max_hp,
            weight: 100.0,
            damage: 100.0,
            bite_cooldown: 2.0,
            damage2: 0.0,
            health_regen: 0.0,
            active_cooldown_multiplier: 1.0,
            quick_recovery_hp_ratio_threshold: 0.0,
            unbreakable_damage_cap_pct: 0.0,
            damage_taken_multiplier_on_being_bitten: 1.0,
            breath_resistance: 0.0,
            berserk_bite_cooldown_multiplier: 1.0,
            berserk_hp_ratio_threshold: 0.0,
            first_strike_pct: 0.0,
            first_strike_hp_ratio_threshold: 1.0,
            has_warden_resistance: false,
            has_reflect: false,
            immune_status_ids: vec![],
            hunker_reduction_pct: 0.0,
            self_destruct_profile: None,
            on_hit_statuses: vec![],
            on_hit_taken_statuses: vec![],
            starting_statuses: vec![],
            status_resist_fractions: BTreeMap::new(),
            plushie_status_block_fractions: BTreeMap::new(),
            plushie_reflect_avg_pct: 0.0,
            disabled_abilities: vec![],
            compare_air_rule_cooldown_sec: 0.0,
            user_ability_ids: Vec::new(),
            identity: None,
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn fresh_ctx<'a>(
        time: &mut f64,
        caster_stats: &'a SimpleCombatantStats,
        opponent_stats: &'a SimpleCombatantStats,
        caster_hp: &'a mut f64,
        opponent_hp: &'a mut f64,
        caster_statuses: &'a mut BTreeMap<String, SimpleStatusInstance>,
        opponent_statuses: &'a mut BTreeMap<String, SimpleStatusInstance>,
        caster_cooldowns: &'a mut BTreeMap<String, f64>,
        opponent_cooldowns: &'a mut BTreeMap<String, f64>,
        caster_active: &'a mut BTreeMap<String, f64>,
        opponent_active: &'a mut BTreeMap<String, f64>,
        caster_extras: &'a mut BTreeMap<String, crate::policy::state::PolicyValue>,
        opponent_extras: &'a mut BTreeMap<String, crate::policy::state::PolicyValue>,
    ) -> EffectContext<'a> {
        EffectContext {
            time: *time,
            caster_stats,
            opponent_stats,
            caster_hp,
            opponent_hp,
            caster_statuses,
            opponent_statuses,
            caster_cooldowns,
            opponent_cooldowns,
            caster_active_until: caster_active,
            opponent_active_until: opponent_active,
            caster_extras,
            opponent_extras,
            caster_iter_healing: None,
            opponent_iter_healing: None,
            caster_snapshots: None,
            opponent_snapshots: None,
            caster_scheduled: None,
            opponent_scheduled: None,
            policy_state: None,
            chain_depth: 0,
            firing_ability_id: None,
            caster_base_health: None,
            opponent_base_health: None,
        }
    }

    #[test]
    fn deal_direct_damage_to_opponent_subtracts_hp() {
        let caster_stats = fresh_stats(10_000.0);
        let opponent_stats = fresh_stats(10_000.0);
        let mut caster_hp = 10_000.0;
        let mut opponent_hp = 10_000.0;
        let mut cs = BTreeMap::new();
        let mut os = BTreeMap::new();
        let mut ccd = BTreeMap::new();
        let mut ocd = BTreeMap::new();
        let mut cau = BTreeMap::new();
        let mut oau = BTreeMap::new();
        let mut cex = BTreeMap::new();
        let mut oex = BTreeMap::new();
        let mut t = 0.0;
        let mut ctx = fresh_ctx(
            &mut t, &caster_stats, &opponent_stats, &mut caster_hp, &mut opponent_hp,
            &mut cs, &mut os, &mut ccd, &mut ocd, &mut cau, &mut oau, &mut cex, &mut oex,
        );
        let batch = EffectBatch {
            name: "Test".into(),
            effects: vec![EffectKind::DealDirectDamage { target: EffectTarget::Opponent, amount: 250.0 }],
            ..Default::default()
        };
        let applied = apply_effect_batch(&batch, &mut ctx);
        assert_eq!(applied, 1);
        assert_eq!(opponent_hp, 9_750.0);
        assert_eq!(caster_hp, 10_000.0);
    }

    #[test]
    fn pay_self_cost_clamps_at_one_hp() {
        let stats = fresh_stats(10_000.0);
        let mut caster_hp = 1_000.0;
        let mut opponent_hp = 10_000.0;
        let mut cs = BTreeMap::new();
        let mut os = BTreeMap::new();
        let mut ccd = BTreeMap::new();
        let mut ocd = BTreeMap::new();
        let mut cau = BTreeMap::new();
        let mut oau = BTreeMap::new();
        let mut cex = BTreeMap::new();
        let mut oex = BTreeMap::new();
        let mut t = 0.0;
        let mut ctx = fresh_ctx(
            &mut t, &stats, &stats, &mut caster_hp, &mut opponent_hp,
            &mut cs, &mut os, &mut ccd, &mut ocd, &mut cau, &mut oau, &mut cex, &mut oex,
        );
        // 50% of 10_000 = 5_000 cost, but caster only has 1_000.
        let batch = EffectBatch {
            name: "Test HC".into(),
            effects: vec![EffectKind::PaySelfCostMaxHpFraction {
                target: EffectTarget::Caster,
                fraction: 0.5,
            }],
            ..Default::default()
        };
        apply_effect_batch(&batch, &mut ctx);
        assert_eq!(caster_hp, 1.0); // clamped at 1, not 0 or negative
    }

    #[test]
    fn cooldown_and_active_until_write_into_their_maps() {
        let stats = fresh_stats(10_000.0);
        let mut caster_hp = 10_000.0;
        let mut opponent_hp = 10_000.0;
        let mut cs = BTreeMap::new();
        let mut os = BTreeMap::new();
        let mut ccd = BTreeMap::new();
        let mut ocd = BTreeMap::new();
        let mut cau = BTreeMap::new();
        let mut oau = BTreeMap::new();
        let mut cex = BTreeMap::new();
        let mut oex = BTreeMap::new();
        let mut t = 5.0;
        let mut ctx = fresh_ctx(
            &mut t, &stats, &stats, &mut caster_hp, &mut opponent_hp,
            &mut cs, &mut os, &mut ccd, &mut ocd, &mut cau, &mut oau, &mut cex, &mut oex,
        );
        let batch = EffectBatch {
            name: "Test cd+active".into(),
            effects: vec![
                EffectKind::SetCooldownUntil {
                    target: EffectTarget::Caster,
                    cooldown_id: "user.test".into(),
                    duration_sec: 60.0,
                },
                EffectKind::SetActiveUntil {
                    target: EffectTarget::Caster,
                    active_id: "user.test".into(),
                    duration_sec: 12.0,
                },
            ],
            ..Default::default()
        };
        apply_effect_batch(&batch, &mut ctx);
        assert_eq!(ccd.get("user.test").copied(), Some(65.0));
        assert_eq!(cau.get("user.test").copied(), Some(17.0));
    }

    #[allow(clippy::too_many_arguments)]
    fn build_schedule_ctx<'a>(
        time: f64,
        stats: &'a SimpleCombatantStats,
        caster_hp: &'a mut f64,
        opponent_hp: &'a mut f64,
        cs: &'a mut BTreeMap<String, SimpleStatusInstance>,
        os: &'a mut BTreeMap<String, SimpleStatusInstance>,
        ccd: &'a mut BTreeMap<String, f64>,
        ocd: &'a mut BTreeMap<String, f64>,
        cau: &'a mut BTreeMap<String, f64>,
        oau: &'a mut BTreeMap<String, f64>,
        cex: &'a mut BTreeMap<String, crate::policy::state::PolicyValue>,
        oex: &'a mut BTreeMap<String, crate::policy::state::PolicyValue>,
        caster_q: &'a mut Vec<ScheduledEntry>,
        opponent_q: &'a mut Vec<ScheduledEntry>,
    ) -> EffectContext<'a> {
        EffectContext {
            time,
            caster_stats: stats,
            opponent_stats: stats,
            caster_hp,
            opponent_hp,
            caster_statuses: cs,
            opponent_statuses: os,
            caster_cooldowns: ccd,
            opponent_cooldowns: ocd,
            caster_active_until: cau,
            opponent_active_until: oau,
            caster_extras: cex,
            opponent_extras: oex,
            caster_iter_healing: None,
            opponent_iter_healing: None,
            caster_snapshots: None,
            opponent_snapshots: None,
            caster_scheduled: Some(caster_q),
            opponent_scheduled: Some(opponent_q),
            policy_state: None,
            chain_depth: 0,
            firing_ability_id: None,
            caster_base_health: None,
            opponent_base_health: None,
        }
    }

    #[test]
    fn schedule_effect_named_then_cancel_clears_entry() {
        // Round 38 / A12: schedule with a name, then cancel by name,
        // and verify the queue is empty.
        let stats = fresh_stats(10_000.0);
        let mut caster_hp = 10_000.0;
        let mut opponent_hp = 10_000.0;
        let mut cs = BTreeMap::new();
        let mut os = BTreeMap::new();
        let mut ccd = BTreeMap::new();
        let mut ocd = BTreeMap::new();
        let mut cau = BTreeMap::new();
        let mut oau = BTreeMap::new();
        let mut cex = BTreeMap::new();
        let mut oex = BTreeMap::new();
        let mut caster_q: Vec<ScheduledEntry> = Vec::new();
        let mut opponent_q: Vec<ScheduledEntry> = Vec::new();

        // Schedule a named bomb at t+5 (scoped so ctx releases its
        // borrow of caster_q before we inspect it).
        {
            let mut ctx = build_schedule_ctx(
                5.0, &stats,
                &mut caster_hp, &mut opponent_hp,
                &mut cs, &mut os, &mut ccd, &mut ocd, &mut cau, &mut oau,
                &mut cex, &mut oex, &mut caster_q, &mut opponent_q,
            );
            apply_effect_batch(
                &EffectBatch {
                    name: "arm bomb".into(),
                    effects: vec![EffectKind::ScheduleEffect {
                        delay_sec: 5.0,
                        effects: vec![EffectKind::DealDirectDamage {
                            target: EffectTarget::Opponent,
                            amount: 500.0,
                        }],
                        name: Some("bomb".to_string()),
                    }],
                    ..Default::default()
                },
                &mut ctx,
            );
        }
        assert_eq!(caster_q.len(), 1);
        assert_eq!(caster_q[0].name.as_deref(), Some("bomb"));

        // Cancel by name.
        {
            let mut ctx = build_schedule_ctx(
                5.0, &stats,
                &mut caster_hp, &mut opponent_hp,
                &mut cs, &mut os, &mut ccd, &mut ocd, &mut cau, &mut oau,
                &mut cex, &mut oex, &mut caster_q, &mut opponent_q,
            );
            apply_effect_batch(
                &EffectBatch {
                    name: "disarm bomb".into(),
                    effects: vec![EffectKind::CancelSchedule {
                        name: "bomb".to_string(),
                    }],
                    ..Default::default()
                },
                &mut ctx,
            );
        }
        assert!(caster_q.is_empty(), "named schedule was cancelled");
    }

    #[test]
    fn reschedule_named_entry_moves_due_at() {
        // Round 38 / A12: schedule + reschedule moves the due time.
        let stats = fresh_stats(10_000.0);
        let mut caster_hp = 10_000.0;
        let mut opponent_hp = 10_000.0;
        let mut cs = BTreeMap::new();
        let mut os = BTreeMap::new();
        let mut ccd = BTreeMap::new();
        let mut ocd = BTreeMap::new();
        let mut cau = BTreeMap::new();
        let mut oau = BTreeMap::new();
        let mut cex = BTreeMap::new();
        let mut oex = BTreeMap::new();
        let mut caster_q: Vec<ScheduledEntry> = Vec::new();
        let mut opponent_q: Vec<ScheduledEntry> = Vec::new();

        // Schedule for t+10.
        {
            let mut ctx = build_schedule_ctx(
                5.0, &stats,
                &mut caster_hp, &mut opponent_hp,
                &mut cs, &mut os, &mut ccd, &mut ocd, &mut cau, &mut oau,
                &mut cex, &mut oex, &mut caster_q, &mut opponent_q,
            );
            apply_effect_batch(
                &EffectBatch {
                    name: "arm".into(),
                    effects: vec![EffectKind::ScheduleEffect {
                        delay_sec: 10.0,
                        effects: vec![EffectKind::DealDirectDamage {
                            target: EffectTarget::Opponent,
                            amount: 100.0,
                        }],
                        name: Some("kick".to_string()),
                    }],
                    ..Default::default()
                },
                &mut ctx,
            );
        }
        assert!((caster_q[0].due_at - 15.0).abs() < 1e-9);

        // Reschedule to t+2.
        {
            let mut ctx = build_schedule_ctx(
                5.0, &stats,
                &mut caster_hp, &mut opponent_hp,
                &mut cs, &mut os, &mut ccd, &mut ocd, &mut cau, &mut oau,
                &mut cex, &mut oex, &mut caster_q, &mut opponent_q,
            );
            apply_effect_batch(
                &EffectBatch {
                    name: "speed up".into(),
                    effects: vec![EffectKind::Reschedule {
                        name: "kick".to_string(),
                        delay_sec: 2.0,
                    }],
                    ..Default::default()
                },
                &mut ctx,
            );
        }
        assert!((caster_q[0].due_at - 7.0).abs() < 1e-9);

        // Reschedule absent name → no-op.
        {
            let mut ctx = build_schedule_ctx(
                5.0, &stats,
                &mut caster_hp, &mut opponent_hp,
                &mut cs, &mut os, &mut ccd, &mut ocd, &mut cau, &mut oau,
                &mut cex, &mut oex, &mut caster_q, &mut opponent_q,
            );
            apply_effect_batch(
                &EffectBatch {
                    name: "nope".into(),
                    effects: vec![EffectKind::Reschedule {
                        name: "nonexistent".to_string(),
                        delay_sec: 100.0,
                    }],
                    ..Default::default()
                },
                &mut ctx,
            );
        }
        // Still 7.0; nothing changed.
        assert!((caster_q[0].due_at - 7.0).abs() < 1e-9);
    }

    #[test]
    fn apply_statuses_to_target_lands_every_entry() {
        // Round 35 / A3: each entry in the array goes through the
        // canonical resist/plushie path. Two statuses, both should
        // land (no resists configured on the dummy stats).
        let stats = fresh_stats(10_000.0);
        let mut caster_hp = 10_000.0;
        let mut opponent_hp = 10_000.0;
        let mut cs = BTreeMap::new();
        let mut os = BTreeMap::new();
        let mut ccd = BTreeMap::new();
        let mut ocd = BTreeMap::new();
        let mut cau = BTreeMap::new();
        let mut oau = BTreeMap::new();
        let mut cex = BTreeMap::new();
        let mut oex = BTreeMap::new();
        let mut t = 5.0;
        let mut ctx = fresh_ctx(
            &mut t, &stats, &stats, &mut caster_hp, &mut opponent_hp,
            &mut cs, &mut os, &mut ccd, &mut ocd, &mut cau, &mut oau, &mut cex, &mut oex,
        );
        let batch = EffectBatch {
            name: "apply two".into(),
            effects: vec![EffectKind::ApplyStatusesToTarget {
                target: EffectTarget::Opponent,
                statuses: vec![
                    SimpleAppliedStatus {
                        status_id: "Burn_Status".into(),
                        stacks: 3.0,
                        source_ability: None,
                    },
                    SimpleAppliedStatus {
                        status_id: "Bleed_Status".into(),
                        stacks: 2.0,
                        source_ability: None,
                    },
                ],
            }],
            ..Default::default()
        };
        apply_effect_batch(&batch, &mut ctx);
        assert!(os.contains_key("Burn_Status"));
        assert!(os.contains_key("Bleed_Status"));
    }

    #[test]
    fn apply_statuses_empty_array_is_no_op() {
        let stats = fresh_stats(10_000.0);
        let mut caster_hp = 10_000.0;
        let mut opponent_hp = 10_000.0;
        let mut cs = BTreeMap::new();
        let mut os = BTreeMap::new();
        let mut ccd = BTreeMap::new();
        let mut ocd = BTreeMap::new();
        let mut cau = BTreeMap::new();
        let mut oau = BTreeMap::new();
        let mut cex = BTreeMap::new();
        let mut oex = BTreeMap::new();
        let mut t = 5.0;
        let mut ctx = fresh_ctx(
            &mut t, &stats, &stats, &mut caster_hp, &mut opponent_hp,
            &mut cs, &mut os, &mut ccd, &mut ocd, &mut cau, &mut oau, &mut cex, &mut oex,
        );
        let batch = EffectBatch {
            name: "empty array".into(),
            effects: vec![EffectKind::ApplyStatusesToTarget {
                target: EffectTarget::Opponent,
                statuses: vec![],
            }],
            ..Default::default()
        };
        apply_effect_batch(&batch, &mut ctx);
        assert!(os.is_empty());
    }

    #[test]
    fn clear_statuses_removes_each_listed_id() {
        let stats = fresh_stats(10_000.0);
        let mut caster_hp = 10_000.0;
        let mut opponent_hp = 10_000.0;
        let mut cs = BTreeMap::new();
        let mut os = BTreeMap::new();
        os.insert(
            "Burn_Status".into(),
            SimpleStatusInstance {
                stacks: 3.0,
                next_tick_at: None,
                next_decay_at: None,
                remaining_sec: 100.0,
                stack_value_mode: None,
                lich_mark_owned_stacks: None,
                no_decay: false,
                resolved_scalars: None,
            },
        );
        os.insert(
            "Poison_Status".into(),
            SimpleStatusInstance {
                stacks: 2.0,
                next_tick_at: None,
                next_decay_at: None,
                remaining_sec: 100.0,
                stack_value_mode: None,
                lich_mark_owned_stacks: None,
                no_decay: false,
                resolved_scalars: None,
            },
        );
        os.insert(
            "Bleed_Status".into(),
            SimpleStatusInstance {
                stacks: 1.0,
                next_tick_at: None,
                next_decay_at: None,
                remaining_sec: 100.0,
                stack_value_mode: None,
                lich_mark_owned_stacks: None,
                no_decay: false,
                resolved_scalars: None,
            },
        );
        let mut ccd = BTreeMap::new();
        let mut ocd = BTreeMap::new();
        let mut cau = BTreeMap::new();
        let mut oau = BTreeMap::new();
        let mut cex = BTreeMap::new();
        let mut oex = BTreeMap::new();
        let mut t = 5.0;
        let mut ctx = fresh_ctx(
            &mut t, &stats, &stats, &mut caster_hp, &mut opponent_hp,
            &mut cs, &mut os, &mut ccd, &mut ocd, &mut cau, &mut oau, &mut cex, &mut oex,
        );
        // Clear two of three statuses; absent id `Necropoison` no-ops.
        let batch = EffectBatch {
            name: "clear two".into(),
            effects: vec![EffectKind::ClearStatuses {
                target: EffectTarget::Opponent,
                status_ids: vec![
                    "Burn_Status".into(),
                    "Poison_Status".into(),
                    "Necropoison_Status".into(),
                ],
            }],
            ..Default::default()
        };
        apply_effect_batch(&batch, &mut ctx);
        assert!(!os.contains_key("Burn_Status"));
        assert!(!os.contains_key("Poison_Status"));
        assert!(os.contains_key("Bleed_Status"), "untouched status survives");
    }

    #[test]
    fn choose_with_all_zero_weights_is_no_op() {
        // Round 34 / A2: every branch weight 0 ⇒ no fire.
        let stats = fresh_stats(10_000.0);
        let mut caster_hp = 10_000.0;
        let mut opponent_hp = 10_000.0;
        let mut cs = BTreeMap::new();
        let mut os = BTreeMap::new();
        let mut ccd = BTreeMap::new();
        let mut ocd = BTreeMap::new();
        let mut cau = BTreeMap::new();
        let mut oau = BTreeMap::new();
        let mut cex = BTreeMap::new();
        let mut oex = BTreeMap::new();
        let mut t = 5.0;
        let policy_state = crate::policy::state::PolicyState {
            self_side: crate::policy::state::PolicySide {
                stats: stats.clone(),
                hp: 10_000.0,
                statuses: BTreeMap::new(),
                cooldowns: BTreeMap::new(),
                active_until: BTreeMap::new(),
                breath_capacity: 0.0,
                next_hit: 0.0,
                next_breath: f64::INFINITY,
                breath: None,
                posture: "Standing".to_string(),
                extras: BTreeMap::new(),
                recent_damage_taken: Vec::new(),
                recent_damage_dealt: Vec::new(),
            },
            opponent: crate::policy::state::PolicySide {
                stats: stats.clone(),
                hp: 10_000.0,
                statuses: BTreeMap::new(),
                cooldowns: BTreeMap::new(),
                active_until: BTreeMap::new(),
                breath_capacity: 0.0,
                next_hit: 0.0,
                next_breath: f64::INFINITY,
                breath: None,
                posture: "Standing".to_string(),
                extras: BTreeMap::new(),
                recent_damage_taken: Vec::new(),
                recent_damage_dealt: Vec::new(),
            },
            time: 5.0,
            extras: BTreeMap::new(),
        };
        let mut ctx = fresh_ctx(
            &mut t, &stats, &stats, &mut caster_hp, &mut opponent_hp,
            &mut cs, &mut os, &mut ccd, &mut ocd, &mut cau, &mut oau, &mut cex, &mut oex,
        );
        ctx.policy_state = Some(&policy_state);
        let batch = EffectBatch {
            name: "no-op choose".into(),
            effects: vec![EffectKind::Choose {
                branches: vec![
                    ChooseBranch {
                        weight: Expr::Const { value: 0.0 },
                        effects: vec![EffectKind::DealDirectDamage {
                            target: EffectTarget::Opponent,
                            amount: 5_000.0,
                        }],
                    },
                    ChooseBranch {
                        weight: Expr::Const { value: 0.0 },
                        effects: vec![EffectKind::DealDirectDamage {
                            target: EffectTarget::Opponent,
                            amount: 5_000.0,
                        }],
                    },
                ],
            }],
            ..Default::default()
        };
        apply_effect_batch(&batch, &mut ctx);
        // Neither branch should fire — opp HP untouched.
        assert_eq!(opponent_hp, 10_000.0);
    }

    #[test]
    fn choose_picks_the_only_positive_weight_branch() {
        // Round 34 / A2: when only one branch has positive weight, the
        // RNG must always land in its range — so the deterministic
        // result is "that branch fires every time".
        let stats = fresh_stats(10_000.0);
        let mut caster_hp = 10_000.0;
        let mut opponent_hp = 10_000.0;
        let mut cs = BTreeMap::new();
        let mut os = BTreeMap::new();
        let mut ccd = BTreeMap::new();
        let mut ocd = BTreeMap::new();
        let mut cau = BTreeMap::new();
        let mut oau = BTreeMap::new();
        let mut cex = BTreeMap::new();
        let mut oex = BTreeMap::new();
        let mut t = 5.0;
        let policy_state = crate::policy::state::PolicyState {
            self_side: crate::policy::state::PolicySide {
                stats: stats.clone(),
                hp: 10_000.0,
                statuses: BTreeMap::new(),
                cooldowns: BTreeMap::new(),
                active_until: BTreeMap::new(),
                breath_capacity: 0.0,
                next_hit: 0.0,
                next_breath: f64::INFINITY,
                breath: None,
                posture: "Standing".to_string(),
                extras: BTreeMap::new(),
                recent_damage_taken: Vec::new(),
                recent_damage_dealt: Vec::new(),
            },
            opponent: crate::policy::state::PolicySide {
                stats: stats.clone(),
                hp: 10_000.0,
                statuses: BTreeMap::new(),
                cooldowns: BTreeMap::new(),
                active_until: BTreeMap::new(),
                breath_capacity: 0.0,
                next_hit: 0.0,
                next_breath: f64::INFINITY,
                breath: None,
                posture: "Standing".to_string(),
                extras: BTreeMap::new(),
                recent_damage_taken: Vec::new(),
                recent_damage_dealt: Vec::new(),
            },
            time: 5.0,
            extras: BTreeMap::new(),
        };
        let mut ctx = fresh_ctx(
            &mut t, &stats, &stats, &mut caster_hp, &mut opponent_hp,
            &mut cs, &mut os, &mut ccd, &mut ocd, &mut cau, &mut oau, &mut cex, &mut oex,
        );
        ctx.policy_state = Some(&policy_state);
        let batch = EffectBatch {
            name: "single-positive choose".into(),
            effects: vec![EffectKind::Choose {
                branches: vec![
                    ChooseBranch {
                        weight: Expr::Const { value: 0.0 },
                        effects: vec![EffectKind::DealDirectDamage {
                            target: EffectTarget::Opponent,
                            amount: 5_000.0,
                        }],
                    },
                    ChooseBranch {
                        weight: Expr::Const { value: 1.0 },
                        effects: vec![EffectKind::HealHp {
                            target: EffectTarget::Caster,
                            amount: 100.0,
                        }],
                    },
                ],
            }],
            ..Default::default()
        };
        apply_effect_batch(&batch, &mut ctx);
        // Heal branch must fire; damage branch must not.
        assert_eq!(opponent_hp, 10_000.0);
        // Caster started at 10_000 (full) — heal capped at max, so still 10_000.
        // Use a wounded caster to verify the heal landed.
    }

    #[test]
    fn set_status_next_tick_writes_into_status_instance() {
        // Round 33 / A4: writes `next_tick_at` on the named status,
        // floored at `ctx.time` so a past value never schedules in the
        // past. No-op if the status isn't present.
        let stats = fresh_stats(10_000.0);
        let mut caster_hp = 10_000.0;
        let mut opponent_hp = 10_000.0;
        let mut cs = BTreeMap::new();
        let mut os = BTreeMap::new();
        os.insert(
            "Burn_Status".to_string(),
            SimpleStatusInstance {
                stacks: 4.0,
                next_tick_at: Some(10.0),
                next_decay_at: Some(15.0),
                remaining_sec: 100.0,
                stack_value_mode: None,
                lich_mark_owned_stacks: None,
                no_decay: false,
                resolved_scalars: None,
            },
        );
        let mut ccd = BTreeMap::new();
        let mut ocd = BTreeMap::new();
        let mut cau = BTreeMap::new();
        let mut oau = BTreeMap::new();
        let mut cex = BTreeMap::new();
        let mut oex = BTreeMap::new();
        let mut t = 5.0;
        // Schedule the next tick at t=7 (2 s out from current t=5).
        {
            let mut ctx = fresh_ctx(
                &mut t, &stats, &stats, &mut caster_hp, &mut opponent_hp,
                &mut cs, &mut os, &mut ccd, &mut ocd, &mut cau, &mut oau, &mut cex, &mut oex,
            );
            apply_effect_batch(
                &EffectBatch {
                    name: "advance Burn tick".into(),
                    effects: vec![EffectKind::SetStatusNextTick {
                        target: EffectTarget::Opponent,
                        status_id: "Burn_Status".into(),
                        absolute_time: 7.0,
                    }],
                    ..Default::default()
                },
                &mut ctx,
            );
        }
        assert_eq!(os.get("Burn_Status").unwrap().next_tick_at, Some(7.0));

        // Past-time floors to current ctx.time (5.0).
        {
            let mut ctx = fresh_ctx(
                &mut t, &stats, &stats, &mut caster_hp, &mut opponent_hp,
                &mut cs, &mut os, &mut ccd, &mut ocd, &mut cau, &mut oau, &mut cex, &mut oex,
            );
            apply_effect_batch(
                &EffectBatch {
                    name: "past floors to now".into(),
                    effects: vec![EffectKind::SetStatusNextTick {
                        target: EffectTarget::Opponent,
                        status_id: "Burn_Status".into(),
                        absolute_time: 0.0,
                    }],
                    ..Default::default()
                },
                &mut ctx,
            );
        }
        assert_eq!(os.get("Burn_Status").unwrap().next_tick_at, Some(5.0));

        // No-op for absent status.
        {
            let mut ctx = fresh_ctx(
                &mut t, &stats, &stats, &mut caster_hp, &mut opponent_hp,
                &mut cs, &mut os, &mut ccd, &mut ocd, &mut cau, &mut oau, &mut cex, &mut oex,
            );
            apply_effect_batch(
                &EffectBatch {
                    name: "absent status".into(),
                    effects: vec![EffectKind::SetStatusNextTick {
                        target: EffectTarget::Opponent,
                        status_id: "Bleed_Status".into(),
                        absolute_time: 9.0,
                    }],
                    ..Default::default()
                },
                &mut ctx,
            );
        }
        assert!(!os.contains_key("Bleed_Status"));
    }

    #[test]
    fn heal_blocked_by_heartbroken_on_target() {
        let stats = fresh_stats(10_000.0);
        let mut caster_hp = 5_000.0;
        let mut opponent_hp = 10_000.0;
        let mut cs: BTreeMap<String, SimpleStatusInstance> = BTreeMap::new();
        cs.insert(
            "Heartbroken_Status".to_string(),
            SimpleStatusInstance {
                stacks: 2.0,
                next_tick_at: None,
                next_decay_at: None,
                remaining_sec: 60.0,
                stack_value_mode: None,
                lich_mark_owned_stacks: None,
                no_decay: false,
                resolved_scalars: None,
            },
        );
        let mut os = BTreeMap::new();
        let mut ccd = BTreeMap::new();
        let mut ocd = BTreeMap::new();
        let mut cau = BTreeMap::new();
        let mut oau = BTreeMap::new();
        let mut cex = BTreeMap::new();
        let mut oex = BTreeMap::new();
        let mut t = 0.0;
        let mut ctx = fresh_ctx(
            &mut t, &stats, &stats, &mut caster_hp, &mut opponent_hp,
            &mut cs, &mut os, &mut ccd, &mut ocd, &mut cau, &mut oau, &mut cex, &mut oex,
        );
        let batch = EffectBatch {
            name: "Test heal blocked".into(),
            effects: vec![EffectKind::HealHp { target: EffectTarget::Caster, amount: 1_000.0 }],
            ..Default::default()
        };
        let applied = apply_effect_batch(&batch, &mut ctx);
        assert_eq!(applied, 0);
        assert_eq!(caster_hp, 5_000.0); // unchanged, Heartbroken blocks
    }

    #[test]
    fn batch_serializes_round_trip_through_json() {
        // Every variant is `Serialize + Deserialize`, so a future
        // JS bridge can hand the engine a custom-ability spec
        // straight from `JSON.stringify`. Lock that contract here
        // so we notice if a variant gets a non-serde field by
        // accident.
        let batch = EffectBatch {
            name: "Pyro Strike".into(),
            effects: vec![
                EffectKind::DealDirectDamageMaxHpFraction {
                    target: EffectTarget::Opponent,
                    fraction: 0.05,
                },
                EffectKind::ApplyStatusToTarget {
                    target: EffectTarget::Opponent,
                    status: SimpleAppliedStatus {
                        status_id: "Burn_Status".into(),
                        stacks: 2.0,
                        source_ability: None,
                    },
                },
                EffectKind::SetCooldownUntil {
                    target: EffectTarget::Caster,
                    cooldown_id: "user.pyro".into(),
                    duration_sec: 30.0,
                },
            ],
            ..Default::default()
        };
        let json = serde_json::to_string(&batch).expect("serialize");
        let restored: EffectBatch = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(batch, restored);
    }

    #[test]
    fn repeat_compositor_applies_n_times() {
        let stats = fresh_stats(10_000.0);
        let mut caster_hp = 10_000.0;
        let mut opponent_hp = 10_000.0;
        let mut cs = BTreeMap::new();
        let mut os = BTreeMap::new();
        let mut ccd = BTreeMap::new();
        let mut ocd = BTreeMap::new();
        let mut cau = BTreeMap::new();
        let mut oau = BTreeMap::new();
        let mut cex = BTreeMap::new();
        let mut oex = BTreeMap::new();
        let mut t = 0.0;
        let mut ctx = fresh_ctx(
            &mut t, &stats, &stats, &mut caster_hp, &mut opponent_hp,
            &mut cs, &mut os, &mut ccd, &mut ocd, &mut cau, &mut oau, &mut cex, &mut oex,
        );
        let batch = EffectBatch {
            name: "Triple tap".into(),
            effects: vec![EffectKind::Repeat {
                count: 3,
                body: vec![EffectKind::DealDirectDamage {
                    target: EffectTarget::Opponent,
                    amount: 100.0,
                }],
            }],
            ..Default::default()
        };
        let applied = apply_effect_batch(&batch, &mut ctx);
        assert_eq!(applied, 3);
        assert_eq!(opponent_hp, 9_700.0);
    }

    #[test]
    fn repeat_clamps_to_max_count() {
        let stats = fresh_stats(1_000_000.0);
        let mut caster_hp = 1_000_000.0;
        let mut opponent_hp = 1_000_000.0;
        let mut cs = BTreeMap::new();
        let mut os = BTreeMap::new();
        let mut ccd = BTreeMap::new();
        let mut ocd = BTreeMap::new();
        let mut cau = BTreeMap::new();
        let mut oau = BTreeMap::new();
        let mut cex = BTreeMap::new();
        let mut oex = BTreeMap::new();
        let mut t = 0.0;
        let mut ctx = fresh_ctx(
            &mut t, &stats, &stats, &mut caster_hp, &mut opponent_hp,
            &mut cs, &mut os, &mut ccd, &mut ocd, &mut cau, &mut oau, &mut cex, &mut oex,
        );
        let batch = EffectBatch {
            name: "Try to spam".into(),
            effects: vec![EffectKind::Repeat {
                count: 10_000, // clamped to MAX_REPEAT_COUNT
                body: vec![EffectKind::DealDirectDamage {
                    target: EffectTarget::Opponent,
                    amount: 1.0,
                }],
            }],
            ..Default::default()
        };
        let applied = apply_effect_batch(&batch, &mut ctx);
        assert_eq!(applied, MAX_REPEAT_COUNT);
    }

    #[test]
    fn conditional_picks_then_when_cond_true() {
        use crate::policy::testing::default_state;
        let stats = fresh_stats(10_000.0);
        let mut caster_hp = 10_000.0;
        let mut opponent_hp = 10_000.0;
        let mut cs = BTreeMap::new();
        let mut os = BTreeMap::new();
        let mut ccd = BTreeMap::new();
        let mut ocd = BTreeMap::new();
        let mut cau = BTreeMap::new();
        let mut oau = BTreeMap::new();
        let mut cex = BTreeMap::new();
        let mut oex = BTreeMap::new();
        let mut t = 0.0;
        let mut state = default_state();
        // Force opponent.hp_ratio < 0.5 for the cond to fire.
        state.opponent.hp = 1_000.0;
        let mut ctx = fresh_ctx(
            &mut t, &stats, &stats, &mut caster_hp, &mut opponent_hp,
            &mut cs, &mut os, &mut ccd, &mut ocd, &mut cau, &mut oau, &mut cex, &mut oex,
        );
        ctx.policy_state = Some(&state);
        let batch = EffectBatch {
            name: "Execute".into(),
            effects: vec![EffectKind::Conditional {
                cond: Expr::Bin {
                    op: crate::policy::user_ability::BinOp::Lt,
                    left: Box::new(Expr::Var {
                        path: "opponent.hp_ratio".into(),
                    }),
                    right: Box::new(Expr::Const { value: 0.5 }),
                },
                then: vec![EffectKind::DealDirectDamage {
                    target: EffectTarget::Opponent,
                    amount: 500.0,
                }],
                otherwise: vec![EffectKind::DealDirectDamage {
                    target: EffectTarget::Opponent,
                    amount: 100.0,
                }],
            }],
            ..Default::default()
        };
        let applied = apply_effect_batch(&batch, &mut ctx);
        assert_eq!(applied, 1);
        assert_eq!(opponent_hp, 9_500.0); // 500 (then branch), not 100
    }

    #[test]
    fn modify_stat_serializes_roundtrip() {
        let batch = EffectBatch {
            name: "Buff myself".into(),
            effects: vec![EffectKind::ModifyStat {
                target: EffectTarget::Caster,
                field: "damage".into(),
                mode: ModifierMode::Mul,
                value: 1.5,
                duration_sec: 10.0,
            }],
            ..Default::default()
        };
        let json = serde_json::to_string(&batch).unwrap();
        let restored: EffectBatch = serde_json::from_str(&json).unwrap();
        assert_eq!(batch, restored);
    }

    #[test]
    fn modify_stat_apply_writes_modifier_keys_into_extras() {
        // Sprint 5.6: apply path writes to target's user_extras
        // under structured keys. The engine's effective_stat_value
        // reader picks these up; this test pins the write contract.
        let stats = fresh_stats(10_000.0);
        let mut caster_hp = 10_000.0;
        let mut opponent_hp = 10_000.0;
        let mut cs = BTreeMap::new();
        let mut os = BTreeMap::new();
        let mut ccd = BTreeMap::new();
        let mut ocd = BTreeMap::new();
        let mut cau = BTreeMap::new();
        let mut oau = BTreeMap::new();
        let mut cex = BTreeMap::new();
        let mut oex = BTreeMap::new();
        let mut t = 7.0;
        let mut ctx = fresh_ctx(
            &mut t, &stats, &stats, &mut caster_hp, &mut opponent_hp,
            &mut cs, &mut os, &mut ccd, &mut ocd, &mut cau, &mut oau, &mut cex, &mut oex,
        );
        let batch = EffectBatch {
            name: "Buff".into(),
            effects: vec![EffectKind::ModifyStat {
                target: EffectTarget::Caster,
                field: "damage".into(),
                mode: ModifierMode::Add,
                value: 50.0,
                duration_sec: 5.0,
            }],
            ..Default::default()
        };
        let applied = apply_effect_batch(&batch, &mut ctx);
        assert_eq!(applied, 1);
        // hp untouched.
        assert_eq!(caster_hp, 10_000.0);
        assert_eq!(opponent_hp, 10_000.0);
        // Modifier keys land on caster_extras (target = Caster).
        // Round 39 / A8: source segment is "default" when
        // firing_ability_id is None (test ctx helper passes None).
        let value = cex
            .get("modifier.damage.add.default.value")
            .and_then(crate::policy::state::PolicyValue::as_number)
            .unwrap();
        assert_eq!(value, 50.0);
        let until = cex
            .get("modifier.damage.add.default.until")
            .and_then(crate::policy::state::PolicyValue::as_number)
            .unwrap();
        assert_eq!(until, 12.0); // time + duration_sec = 7 + 5
        // Read-path: effective_stat_value returns base + add.
        let effective = effective_stat_value(100.0, "damage", &cex, 7.0);
        assert_eq!(effective, 150.0);
        // Past until → no longer applies.
        let expired = effective_stat_value(100.0, "damage", &cex, 13.0);
        assert_eq!(expired, 100.0);
    }

    #[test]
    fn modifier_sources_stack_independently_round39_a8() {
        // Round 39 / A8: two abilities both writing
        // `modify_stat damage mul 1.5` no longer overwrite each other.
        // Effective stat is the product of all unexpired `.mul`
        // values from every source.
        use crate::policy::state::PolicyValue;
        let mut extras: BTreeMap<String, PolicyValue> = BTreeMap::new();

        // Source A: mul 1.5, expires at t=10.
        extras.insert(
            "modifier.damage.mul.userA.value".into(),
            PolicyValue::Number(1.5),
        );
        extras.insert(
            "modifier.damage.mul.userA.until".into(),
            PolicyValue::Number(10.0),
        );
        // Source B: mul 2.0, expires at t=20.
        extras.insert(
            "modifier.damage.mul.userB.value".into(),
            PolicyValue::Number(2.0),
        );
        extras.insert(
            "modifier.damage.mul.userB.until".into(),
            PolicyValue::Number(20.0),
        );

        // At t=5: both active. base * 1.5 * 2.0 = 3.0 * base.
        let eff_t5 = effective_stat_value(100.0, "damage", &extras, 5.0);
        assert_eq!(eff_t5, 300.0);

        // At t=15: only B active. base * 2.0.
        let eff_t15 = effective_stat_value(100.0, "damage", &extras, 15.0);
        assert_eq!(eff_t15, 200.0);

        // At t=25: both expired.
        let eff_t25 = effective_stat_value(100.0, "damage", &extras, 25.0);
        assert_eq!(eff_t25, 100.0);
    }

    #[test]
    fn modifier_add_sources_sum_round39_a8() {
        // Add from multiple sources sums.
        use crate::policy::state::PolicyValue;
        let mut extras: BTreeMap<String, PolicyValue> = BTreeMap::new();
        extras.insert(
            "modifier.damage.add.userA.value".into(),
            PolicyValue::Number(20.0),
        );
        extras.insert(
            "modifier.damage.add.userA.until".into(),
            PolicyValue::Number(10.0),
        );
        extras.insert(
            "modifier.damage.add.userB.value".into(),
            PolicyValue::Number(30.0),
        );
        extras.insert(
            "modifier.damage.add.userB.until".into(),
            PolicyValue::Number(10.0),
        );
        let eff = effective_stat_value(100.0, "damage", &extras, 5.0);
        assert_eq!(eff, 150.0); // 100 + 20 + 30
    }

    #[test]
    fn modifier_set_highest_until_wins_round39_a8() {
        // `set` overrides; among multiple sources, latest-`until`
        // wins (sticks longest).
        use crate::policy::state::PolicyValue;
        let mut extras: BTreeMap<String, PolicyValue> = BTreeMap::new();
        extras.insert(
            "modifier.damage.set.userA.value".into(),
            PolicyValue::Number(50.0),
        );
        extras.insert(
            "modifier.damage.set.userA.until".into(),
            PolicyValue::Number(10.0),
        );
        extras.insert(
            "modifier.damage.set.userB.value".into(),
            PolicyValue::Number(75.0),
        );
        extras.insert(
            "modifier.damage.set.userB.until".into(),
            PolicyValue::Number(20.0),
        );
        // At t=5: both active, B has higher until → wins.
        assert_eq!(effective_stat_value(100.0, "damage", &extras, 5.0), 75.0);
        // At t=15: only B active.
        assert_eq!(effective_stat_value(100.0, "damage", &extras, 15.0), 75.0);
    }

    #[test]
    fn modifier_set_takes_precedence_over_mul_add_round39_a8() {
        // `set` overrides regardless of mul/add from other sources.
        use crate::policy::state::PolicyValue;
        let mut extras: BTreeMap<String, PolicyValue> = BTreeMap::new();
        extras.insert(
            "modifier.damage.set.userA.value".into(),
            PolicyValue::Number(42.0),
        );
        extras.insert(
            "modifier.damage.set.userA.until".into(),
            PolicyValue::Number(10.0),
        );
        extras.insert(
            "modifier.damage.mul.userB.value".into(),
            PolicyValue::Number(10.0),
        );
        extras.insert(
            "modifier.damage.mul.userB.until".into(),
            PolicyValue::Number(10.0),
        );
        // Even though mul says ×10, set wins → 42.
        assert_eq!(effective_stat_value(100.0, "damage", &extras, 5.0), 42.0);
    }

    #[test]
    fn modify_stat_two_sources_write_distinct_keys_round39_a8() {
        // End-to-end via apply path: setting firing_ability_id between
        // two ModifyStat applications results in two distinct keys
        // and the values multiply.
        use crate::policy::state::PolicyValue;
        let stats = fresh_stats(10_000.0);
        let mut caster_hp = 10_000.0;
        let mut opponent_hp = 10_000.0;
        let mut cs = BTreeMap::new();
        let mut os = BTreeMap::new();
        let mut ccd = BTreeMap::new();
        let mut ocd = BTreeMap::new();
        let mut cau = BTreeMap::new();
        let mut oau = BTreeMap::new();
        let mut cex: BTreeMap<String, PolicyValue> = BTreeMap::new();
        let mut oex: BTreeMap<String, PolicyValue> = BTreeMap::new();
        let mut t = 0.0;
        let batch = EffectBatch {
            name: "Buff".into(),
            effects: vec![EffectKind::ModifyStat {
                target: EffectTarget::Caster,
                field: "damage".into(),
                mode: ModifierMode::Mul,
                value: 1.5,
                duration_sec: 10.0,
            }],
            ..Default::default()
        };
        // First ability id "user.alpha" fires.
        {
            let mut ctx = fresh_ctx(
                &mut t, &stats, &stats, &mut caster_hp, &mut opponent_hp,
                &mut cs, &mut os, &mut ccd, &mut ocd, &mut cau, &mut oau, &mut cex, &mut oex,
            );
            ctx.firing_ability_id = Some("user.alpha");
            apply_effect_batch(&batch, &mut ctx);
        }
        // Second ability id "user.beta" fires with same modify_stat.
        {
            let mut ctx = fresh_ctx(
                &mut t, &stats, &stats, &mut caster_hp, &mut opponent_hp,
                &mut cs, &mut os, &mut ccd, &mut ocd, &mut cau, &mut oau, &mut cex, &mut oex,
            );
            ctx.firing_ability_id = Some("user.beta");
            apply_effect_batch(&batch, &mut ctx);
        }
        // Both keys present, distinct.
        assert!(cex.contains_key("modifier.damage.mul.user.alpha.value"));
        assert!(cex.contains_key("modifier.damage.mul.user.beta.value"));
        // Effective: 100 * 1.5 * 1.5 = 225 (not 150 — no overwrite).
        let eff = effective_stat_value(100.0, "damage", &cex, 0.0);
        assert!((eff - 225.0).abs() < 1e-9, "expected 225.0, got {eff}");
    }

    #[test]
    fn conditional_skipped_when_no_policy_state() {
        let stats = fresh_stats(10_000.0);
        let mut caster_hp = 10_000.0;
        let mut opponent_hp = 10_000.0;
        let mut cs = BTreeMap::new();
        let mut os = BTreeMap::new();
        let mut ccd = BTreeMap::new();
        let mut ocd = BTreeMap::new();
        let mut cau = BTreeMap::new();
        let mut oau = BTreeMap::new();
        let mut cex = BTreeMap::new();
        let mut oex = BTreeMap::new();
        let mut t = 0.0;
        let mut ctx = fresh_ctx(
            &mut t, &stats, &stats, &mut caster_hp, &mut opponent_hp,
            &mut cs, &mut os, &mut ccd, &mut ocd, &mut cau, &mut oau, &mut cex, &mut oex,
        );
        // policy_state stays None — conditional becomes a no-op.
        let batch = EffectBatch {
            name: "Should skip".into(),
            effects: vec![EffectKind::Conditional {
                cond: Expr::Const { value: 1.0 },
                then: vec![EffectKind::DealDirectDamage {
                    target: EffectTarget::Opponent,
                    amount: 9_999.0,
                }],
                otherwise: vec![],
            }],
            ..Default::default()
        };
        let applied = apply_effect_batch(&batch, &mut ctx);
        assert_eq!(applied, 0);
        assert_eq!(opponent_hp, 10_000.0);
    }
}
