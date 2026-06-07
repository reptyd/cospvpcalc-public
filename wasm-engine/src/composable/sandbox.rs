//! Sandbox-mode adapter over the composable engine.
//!
//! The Sandbox UI is a diagnostic / repro tool that drives the same combat
//! engine the Compare and Best Builds flows use, but in **single-step** mode:
//! the user pauses time, mutates state (seed status, set HP, force a bite),
//! and advances one event at a time. Implementation strategy:
//!
//! - [`SandboxRuntime`] owns its `CombatSide`s directly. After the 2026-05-12
//!   refactor, `CombatSide` carries no lifetime parameter - `stats` / `breath`
//!   are owned values, not `&'a` references. This means the runtime is fully
//!   safe (no `unsafe`, no self-referential gymnastics) AND override mutations
//!   are in-place field writes: `self.config.attacker_fortify = true;`,
//!   `self.attacker_stats.status_resist_fractions.insert(...);`, etc.
//! - All `process_phase_*` functions in [`super::phases`] are shared with
//!   the production loop - no duplicated combat logic. The wiring for
//!   "one event-loop iteration" is locally inlined in
//!   [`SandboxRuntime::step_to_next_event`] (deferred refactor: extract a
//!   `run_one_event_loop_iter` shared with `simulate_composable_matchup_with_trace_control`).
//! - Setup mirrors the production path via
//!   [`super::setup::populate_combat_sides_and_flags`] - no duplicated init
//!   either.
//!
//! `cargo test --lib` keeps both paths honest: the production engine's
//! existing fixture suite covers correctness of the `process_phase_*`
//! functions Sandbox calls into.

use serde::{Deserialize, Serialize};

use super::abilities::LICH_MARK_ARMED_WINDOW_SEC;
use super::setup::{populate_combat_sides_and_flags, ComposableLoopFlags};
use super::{
    normalize_ordered_event_phases, CombatSide, ComposableAbilityConfig, DamageCounters,
    FortifySimulationControl, OrderedEventPhase,
};
use crate::contracts::{
    apply_disabled_abilities, CombatLogEntry, SimpleAbilityTimingMode, SimpleBreathProfile,
    SimpleCombatantStats, SimpleStatusInstance,
};
use crate::statuses::is_fortify_cleansable_instance;

/// What `SandboxRuntime::step_to_next_event` produced.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum SandboxStepResult {
    /// One iter ran; time may or may not have advanced.
    Advanced,
    /// Scheduler returned `Break` - sim is done (death or no more events).
    Halted,
}

/// Single-side public projection for the UI. Serializes as JSON to TS.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SandboxSideView {
    pub name: String,
    pub max_hp: f64,
    pub hp: f64,
    pub hp_pct: f64,
    pub breath_capacity_left: f64,
    pub breath_capacity_max: f64,
    pub breath_capacity_pct: f64,
    pub next_hit_at: f64,
    pub next_breath_at: Option<f64>,
    pub bite_ready: bool,
    pub breath_ready: bool,
    pub bite_cooldown_left: f64,
    pub breath_cooldown_left: Option<f64>,
    pub statuses: Vec<SandboxStatusView>,
    /// Per-creature ability list: only abilities the runtime actually
    /// supports for this side. Each entry has a `ready` flag and
    /// `cooldown_left` so the UI can render the same "AbilityName (12.5s)"
    /// disabled-on-cooldown button the deleted TS Sandbox showed.
    pub abilities: Vec<SandboxAbilityView>,
    pub death_time: Option<f64>,
}

/// Per-ability button data - mirrors old TS Sandbox's `SandboxAbilityView`.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SandboxAbilityView {
    pub name: String,
    /// User-facing label - usually `name`, but flips to "Release Hunker" /
    /// "Release Warden Rage" / "Spite charging" when the ability is in a
    /// toggle / charging state.
    pub action_label: String,
    pub ready: bool,
    pub cooldown_left: f64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SandboxStatusView {
    pub id: String,
    pub stacks: f64,
    pub remaining_sec: f64,
    pub next_tick_at: Option<f64>,
    pub next_decay_at: Option<f64>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SandboxLogEntryView {
    pub time: f64,
    pub side: String,
    pub event_type: String,
    pub description: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SandboxView {
    pub time: f64,
    pub halted: bool,
    pub side_a: SandboxSideView,
    pub side_b: SandboxSideView,
    pub log: Vec<SandboxLogEntryView>,
}

/// Side selector for sandbox operations exposed to JS. Variants are
/// serialized as `"A"` / `"B"` to match the TS-side `SandboxSide` literal
/// type and the `name` field on `SandboxSideView`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum SandboxSide {
    A,
    B,
}

/// Bit values mirroring `composable::event_phase_bit`. Sandbox doesn't
/// depend on the production helper directly - keeping a small local copy
/// avoids surfacing the private fn through `pub(super)` just for the
/// Manual-mode phase filter.
const PHASE_BIT_BITE: u32 = 1 << 3;
const PHASE_BIT_BREATH: u32 = 1 << 4;
const PHASE_BIT_ACTIVE_ABILITIES: u32 = 1 << 5;

#[inline]
fn opponent_of(side: SandboxSide) -> SandboxSide {
    match side {
        SandboxSide::A => SandboxSide::B,
        SandboxSide::B => SandboxSide::A,
    }
}

/// Sandbox automation mode. **Manual** matches the deleted TS Sandbox's
/// "Manual" UX: the scheduler never picks `Bite` / `Breath` /
/// `ActiveAbilities` on its own - those phases only run when the user
/// explicitly invokes `force_bite` / `force_breath` / `force_ability`
/// (which briefly whitelist their phase for one iter). Passive phases
/// (`StatusDecay` / `StatusTicks` / `Regen` + Phase 7 / 16) still tick
/// in both modes.
///
/// **SemiAuto** lets the engine run its normal policy - bites fire on
/// cooldown, abilities activate per `ability_policy`, etc. - while the
/// user keeps the option to intervene via force buttons.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum SandboxAutomationMode {
    #[default]
    #[serde(rename = "manual")]
    Manual,
    #[serde(rename = "semiAuto")]
    SemiAuto,
}

/// One entry of the sandbox's replay log. Captured every time the user
/// invokes a state-mutating action; replayed verbatim by
/// [`SandboxRuntime::step_to_time`] when seeking backwards.
#[derive(Clone, Debug)]
enum SandboxAction {
    ApplyHp { time: f64, side: SandboxSide, hp: f64 },
    ApplyStatus { time: f64, side: SandboxSide, status_id: String, stacks: f64 },
    ForceBite { time: f64, side: SandboxSide },
    ForceBreath { time: f64, side: SandboxSide },
    ForceAbility { time: f64, side: SandboxSide, ability_name: String },
    OverrideStat { time: f64, side: SandboxSide, field: String, value: f64 },
    OverrideAbility { time: f64, side: SandboxSide, ability_name: String, enabled: bool },
    OverrideAbilityNumber { time: f64, side: SandboxSide, ability_name: String, value: f64 },
    OverrideAbilityString { time: f64, side: SandboxSide, ability_name: String, value: Option<String> },
    OverridePassiveBool { time: f64, side: SandboxSide, passive_name: String, enabled: bool },
    OverridePassiveNumber { time: f64, side: SandboxSide, passive_name: String, value: f64 },
    OverrideBreath { time: f64, side: SandboxSide, profile: Option<Box<SimpleBreathProfile>> },
    OverrideResist { time: f64, side: SandboxSide, status_id: String, fraction: f64 },
    OverrideOffensiveStatus { time: f64, side: SandboxSide, status_id: String, stacks: f64 },
    OverrideDefensiveStatus { time: f64, side: SandboxSide, status_id: String, stacks: f64 },
    ClearOverrides { time: f64, side: SandboxSide },
}

impl SandboxAction {
    fn time(&self) -> f64 {
        match self {
            SandboxAction::ApplyHp { time, .. }
            | SandboxAction::ApplyStatus { time, .. }
            | SandboxAction::ForceBite { time, .. }
            | SandboxAction::ForceBreath { time, .. }
            | SandboxAction::ForceAbility { time, .. }
            | SandboxAction::OverrideStat { time, .. }
            | SandboxAction::OverrideAbility { time, .. }
            | SandboxAction::OverrideAbilityNumber { time, .. }
            | SandboxAction::OverrideAbilityString { time, .. }
            | SandboxAction::OverridePassiveBool { time, .. }
            | SandboxAction::OverridePassiveNumber { time, .. }
            | SandboxAction::OverrideBreath { time, .. }
            | SandboxAction::OverrideResist { time, .. }
            | SandboxAction::OverrideOffensiveStatus { time, .. }
            | SandboxAction::OverrideDefensiveStatus { time, .. }
            | SandboxAction::ClearOverrides { time, .. } => *time,
        }
    }
}

/// Declarative table of every per-side ability/effect flag the
/// sandbox can toggle via Override Type → Ability / Effect. SINGLE
/// SOURCE OF TRUTH for:
///   - `set_config_ability_flag` (live runtime toggle from
///     `override_ability`),
///   - `clear_config_overrides_for_side` (snapshot restore on
///     "Clear A / Clear B"),
///   - `overridable_ability_names` (exposed via WASM so the UI
///     dropdown auto-syncs - adding a new ability here means it
///     appears in the Sandbox dropdown next reload without ANY
///     TS-side edit).
///
/// Adding a new ability:
///   1. Add the `attacker_X: bool` / `defender_X: bool` fields to
///      `ComposableAbilityConfig` (or use existing ones).
///   2. Append a single `AbilityFlagDef` entry below. The match
///      arms, restore loops, and UI dropdown all pick it up.
///
/// `aliases` lets one ability respond to multiple input spellings
/// (e.g. "Warden Rage" + "Warden's Rage") without separate entries.
struct AbilityFlagDef {
    /// Canonical display name (also what the UI shows).
    name: &'static str,
    /// Extra accepted strings (e.g. apostrophe variant). The
    /// canonical `name` is always accepted too.
    aliases: &'static [&'static str],
    set_attacker: fn(&mut ComposableAbilityConfig, bool),
    set_defender: fn(&mut ComposableAbilityConfig, bool),
    get_attacker: fn(&ComposableAbilityConfig) -> bool,
    get_defender: fn(&ComposableAbilityConfig) -> bool,
}

impl AbilityFlagDef {
    fn matches_name(&self, requested: &str) -> bool {
        self.name == requested || self.aliases.contains(&requested)
    }
}

/// Iterator over every override-flag entry as `(canonical_name,
/// aliases)`. Lets `composable::ability_metadata` assert (in a
/// `cfg(test)` guard) that every sandbox-exposed ability has a
/// matching metadata record - adding a new flag without declaring
/// its kind is then a CI failure rather than a silent runtime gap.
#[cfg(test)]
pub(crate) fn overridable_ability_flag_iter() -> impl Iterator<Item = (&'static str, &'static [&'static str])> {
    OVERRIDABLE_ABILITY_FLAGS.iter().map(|f| (f.name, f.aliases))
}

/// The canonical list. Ordered roughly by ability category for
/// readability; iteration order doesn't affect correctness.
const OVERRIDABLE_ABILITY_FLAGS: &[AbilityFlagDef] = &[
    // Self-buff / cleanse actives.
    AbilityFlagDef {
        name: "Fortify",
        aliases: &[],
        set_attacker: |c, v| c.attacker_fortify = v,
        set_defender: |c, v| c.defender_fortify = v,
        get_attacker: |c| c.attacker_fortify,
        get_defender: |c| c.defender_fortify,
    },
    AbilityFlagDef {
        name: "Hunker",
        aliases: &[],
        set_attacker: |c, v| c.attacker_hunker = v,
        set_defender: |c, v| c.defender_hunker = v,
        get_attacker: |c| c.attacker_hunker,
        get_defender: |c| c.defender_hunker,
    },
    AbilityFlagDef {
        name: "Harden",
        aliases: &[],
        set_attacker: |c, v| c.attacker_harden = v,
        set_defender: |c, v| c.defender_harden = v,
        get_attacker: |c| c.attacker_harden,
        get_defender: |c| c.defender_harden,
    },
    AbilityFlagDef {
        name: "Adrenaline",
        aliases: &[],
        set_attacker: |c, v| c.attacker_adrenaline = v,
        set_defender: |c, v| c.defender_adrenaline = v,
        get_attacker: |c| c.attacker_adrenaline,
        get_defender: |c| c.defender_adrenaline,
    },
    AbilityFlagDef {
        name: "Rewind",
        aliases: &[],
        set_attacker: |c, v| c.attacker_rewind = v,
        set_defender: |c, v| c.defender_rewind = v,
        get_attacker: |c| c.attacker_rewind,
        get_defender: |c| c.defender_rewind,
    },
    AbilityFlagDef {
        name: "Reflect",
        aliases: &[],
        set_attacker: |c, v| c.attacker_reflect = v,
        set_defender: |c, v| c.defender_reflect = v,
        get_attacker: |c| c.attacker_reflect,
        get_defender: |c| c.defender_reflect,
    },
    AbilityFlagDef {
        name: "Hunters Curse",
        aliases: &["Hunter's Curse"],
        set_attacker: |c, v| c.attacker_hunters_curse = v,
        set_defender: |c, v| c.defender_hunters_curse = v,
        get_attacker: |c| c.attacker_hunters_curse,
        get_defender: |c| c.defender_hunters_curse,
    },
    AbilityFlagDef {
        name: "Unbridled Rage",
        aliases: &[],
        set_attacker: |c, v| c.attacker_unbridled_rage = v,
        set_defender: |c, v| c.defender_unbridled_rage = v,
        get_attacker: |c| c.attacker_unbridled_rage,
        get_defender: |c| c.defender_unbridled_rage,
    },
    AbilityFlagDef {
        name: "Warden Rage",
        aliases: &["Warden's Rage"],
        set_attacker: |c, v| c.attacker_warden_rage = v,
        set_defender: |c, v| c.defender_warden_rage = v,
        get_attacker: |c| c.attacker_warden_rage,
        get_defender: |c| c.defender_warden_rage,
    },
    AbilityFlagDef {
        name: "Cocoon",
        aliases: &[],
        set_attacker: |c, v| c.attacker_cocoon = v,
        set_defender: |c, v| c.defender_cocoon = v,
        get_attacker: |c| c.attacker_cocoon,
        get_defender: |c| c.defender_cocoon,
    },
    AbilityFlagDef {
        name: "Frost Nova",
        aliases: &[],
        set_attacker: |c, v| c.attacker_frost_nova = v,
        set_defender: |c, v| c.defender_frost_nova = v,
        get_attacker: |c| c.attacker_frost_nova,
        get_defender: |c| c.defender_frost_nova,
    },
    AbilityFlagDef {
        name: "Reflux",
        aliases: &[],
        set_attacker: |c, v| c.attacker_reflux = v,
        set_defender: |c, v| c.defender_reflux = v,
        get_attacker: |c| c.attacker_reflux,
        get_defender: |c| c.defender_reflux,
    },
    AbilityFlagDef {
        name: "Totem",
        aliases: &[],
        set_attacker: |c, v| c.attacker_totem = v,
        set_defender: |c, v| c.defender_totem = v,
        get_attacker: |c| c.attacker_totem,
        get_defender: |c| c.defender_totem,
    },
    // Area / trap actives intentionally NOT listed - Thorn Trap, Toxic
    // Trap, Frost Snare, Poison Area, Yolk Bomb, Drowsy Area are
    // matchup-pair effects (placed-once-then-decays areas the opponent
    // must walk into) - they're compare-only and don't translate to
    // single-side Sandbox scripting. User-arbiter call (2026-05-23).
    // Status appliers / passives.
    AbilityFlagDef {
        name: "Divination",
        aliases: &[],
        set_attacker: |c, v| c.attacker_divination = v,
        set_defender: |c, v| c.defender_divination = v,
        get_attacker: |c| c.attacker_divination,
        get_defender: |c| c.defender_divination,
    },
    AbilityFlagDef {
        name: "Cause Fear",
        aliases: &[],
        set_attacker: |c, v| c.attacker_cause_fear = v,
        set_defender: |c, v| c.defender_cause_fear = v,
        get_attacker: |c| c.attacker_cause_fear,
        get_defender: |c| c.defender_cause_fear,
    },
    AbilityFlagDef {
        name: "Grim Lariat",
        aliases: &[],
        set_attacker: |c, v| c.attacker_grim_lariat = v,
        set_defender: |c, v| c.defender_grim_lariat = v,
        get_attacker: |c| c.attacker_grim_lariat,
        get_defender: |c| c.defender_grim_lariat,
    },
    AbilityFlagDef {
        name: "Lich Mark",
        aliases: &[],
        set_attacker: |c, v| c.attacker_lich_mark = v,
        set_defender: |c, v| c.defender_lich_mark = v,
        get_attacker: |c| c.attacker_lich_mark,
        get_defender: |c| c.defender_lich_mark,
    },
    // Compare-only flags (`Healing Pulse`, `Healing Pulse Once`,
    // `Expunge`, `Spite ready-at-start`, `Power Charge`, `Gore Charge`)
    // intentionally NOT listed here. Their `ComposableAbilityConfig`
    // fields are tagged "Compare-only" in
    // `wasm-engine/src/composable/config.rs` because their semantics
    // (matchup-pair effects, "first melee hit" charges that only make
    // sense when fighting another creature, full-window heal pulses
    // designed for the Compare scoring window) don't translate into
    // Sandbox's single-side scripting model. Spite still appears in
    // Sandbox via the value table (`OVERRIDABLE_ABILITY_VALUES`) -
    // `attacker_spite_value` IS the engine-side activation signal;
    // `spite_ready_at_start` is the Compare-only "pre-armed at t=0"
    // toggle that has no analog in a hand-scripted Sandbox fight.
];

/// List of all overridable ability/effect names - exposed to the
/// UI via WASM so the Sandbox dropdown auto-syncs with the engine.
/// Aliases are NOT included (UI shows canonical names only).
pub fn overridable_ability_names() -> Vec<&'static str> {
    OVERRIDABLE_ABILITY_FLAGS.iter().map(|d| d.name).collect()
}

/// Whether a value-bearing ability accepts a numeric value or a
/// categorical string. The Sandbox UI uses this to pick the right
/// input element - number input for `Number`, dropdown sourced from
/// `getAbilityValueOptions(name)` for `String`. Mirrors the
/// established custom-creature picker pattern in
/// `src/pages/CustomCreaturesPage.tsx` (see `getSelectedAbilityValueOptions`).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum AbilityValueKind {
    /// Numeric (`f64`) config field. UI renders a number input.
    Number,
    /// String (`Option<String>`) config field. UI renders a
    /// dropdown of curated values (Yolk Bomb / Lich Mark) or
    /// free-text input (Aura subtype etc.) per `abilityValueOptions.ts`.
    String,
}

/// Declarative table of every per-side ability **value** field the
/// sandbox can override via the Override panel. Complements
/// [`OVERRIDABLE_ABILITY_FLAGS`] (which covers bool toggles only).
///
/// Some abilities live in both tables: e.g. **Yolk Bomb** has a
/// boolean activation gate (in `OVERRIDABLE_ABILITY_FLAGS`) AND a
/// string payload (here). The UI surfaces them as one entry - the
/// toggle disables the ability outright, the value picker sets the
/// payload while the toggle is on.
///
/// Other abilities are value-only: **Cursed Sigil**, **Life Leech**,
/// **Spite** (the damage value, not the compare-only
/// `spite_ready_at_start`), **Shadow Barrage**, **Healing Step**, the
/// **Trail** family, and **Aura**. The engine treats `value > 0` (or
/// `Some(_)` for string fields) as the enabled state - no separate
/// bool gate.
struct AbilityValueDef {
    /// Canonical display name (also what the UI shows). Should match
    /// an `OVERRIDABLE_ABILITY_FLAGS` entry's name when the ability
    /// has a bool gate too, otherwise be its own dropdown row.
    name: &'static str,
    aliases: &'static [&'static str],
    kind: AbilityValueKind,
    set_attacker_number: Option<fn(&mut ComposableAbilityConfig, f64)>,
    set_defender_number: Option<fn(&mut ComposableAbilityConfig, f64)>,
    get_attacker_number: Option<fn(&ComposableAbilityConfig) -> f64>,
    get_defender_number: Option<fn(&ComposableAbilityConfig) -> f64>,
    set_attacker_string: Option<fn(&mut ComposableAbilityConfig, Option<String>)>,
    set_defender_string: Option<fn(&mut ComposableAbilityConfig, Option<String>)>,
    get_attacker_string: Option<fn(&ComposableAbilityConfig) -> Option<String>>,
    get_defender_string: Option<fn(&ComposableAbilityConfig) -> Option<String>>,
}

impl AbilityValueDef {
    fn matches_name(&self, requested: &str) -> bool {
        self.name == requested || self.aliases.contains(&requested)
    }
}

const OVERRIDABLE_ABILITY_VALUES: &[AbilityValueDef] = &[
    // ── Number-valued abilities ─────────────────────────────────────────
    AbilityValueDef {
        name: "Cursed Sigil",
        aliases: &[],
        kind: AbilityValueKind::Number,
        set_attacker_number: Some(|c, v| c.attacker_cursed_sigil_stacks = v),
        set_defender_number: Some(|c, v| c.defender_cursed_sigil_stacks = v),
        get_attacker_number: Some(|c| c.attacker_cursed_sigil_stacks),
        get_defender_number: Some(|c| c.defender_cursed_sigil_stacks),
        set_attacker_string: None,
        set_defender_string: None,
        get_attacker_string: None,
        get_defender_string: None,
    },
    AbilityValueDef {
        name: "Life Leech",
        aliases: &[],
        kind: AbilityValueKind::Number,
        set_attacker_number: Some(|c, v| c.attacker_life_leech_value = v),
        set_defender_number: Some(|c, v| c.defender_life_leech_value = v),
        get_attacker_number: Some(|c| c.attacker_life_leech_value),
        get_defender_number: Some(|c| c.defender_life_leech_value),
        set_attacker_string: None,
        set_defender_string: None,
        get_attacker_string: None,
        get_defender_string: None,
    },
    AbilityValueDef {
        name: "Spite",
        aliases: &[],
        kind: AbilityValueKind::Number,
        set_attacker_number: Some(|c, v| c.attacker_spite_value = v),
        set_defender_number: Some(|c, v| c.defender_spite_value = v),
        get_attacker_number: Some(|c| c.attacker_spite_value),
        get_defender_number: Some(|c| c.defender_spite_value),
        set_attacker_string: None,
        set_defender_string: None,
        get_attacker_string: None,
        get_defender_string: None,
    },
    AbilityValueDef {
        name: "Shadow Barrage",
        aliases: &[],
        kind: AbilityValueKind::Number,
        set_attacker_number: Some(|c, v| c.attacker_shadow_barrage_value = v),
        set_defender_number: Some(|c, v| c.defender_shadow_barrage_value = v),
        get_attacker_number: Some(|c| c.attacker_shadow_barrage_value),
        get_defender_number: Some(|c| c.defender_shadow_barrage_value),
        set_attacker_string: None,
        set_defender_string: None,
        get_attacker_string: None,
        get_defender_string: None,
    },
    // Healing Step is also gated by the Trails compare-only toggle
    // (reference notes "Healing Step is a Compare-only modeled
    // effect ... only runs when the Trails compare-only toggle is
    // enabled for the user") - same family as the trail entries
    // below, removed for the same reason. User-arbiter call
    // (2026-05-23).
    // Trail family (Flame/Frost/Plague/Toxic Trail) + Healing Step
    // intentionally NOT listed - reference content explicitly tags
    // them as "Compare-only modeled effect ... only runs when the
    // Trails compare-only toggle is enabled". User-arbiter call
    // (2026-05-23).
    // ── String-valued abilities ─────────────────────────────────────────
    AbilityValueDef {
        name: "Aura",
        aliases: &[],
        kind: AbilityValueKind::String,
        set_attacker_number: None,
        set_defender_number: None,
        get_attacker_number: None,
        get_defender_number: None,
        set_attacker_string: Some(|c, v| c.attacker_aura_subtype = v),
        set_defender_string: Some(|c, v| c.defender_aura_subtype = v),
        get_attacker_string: Some(|c| c.attacker_aura_subtype.clone()),
        get_defender_string: Some(|c| c.defender_aura_subtype.clone()),
    },
    // Yolk Bomb intentionally NOT listed - it's an area placement
    // (trap family) and therefore compare-only per the user-arbiter
    // call (2026-05-23). Lich Mark stays - it's a personal hit-mark,
    // not an area, and works in single-side scripting.
    AbilityValueDef {
        name: "Lich Mark",
        aliases: &[],
        kind: AbilityValueKind::String,
        set_attacker_number: None,
        set_defender_number: None,
        get_attacker_number: None,
        get_defender_number: None,
        set_attacker_string: Some(|c, v| {
            c.attacker_lich_mark = v.is_some();
            c.attacker_lich_mark_payload_status_id = v;
        }),
        set_defender_string: Some(|c, v| {
            c.defender_lich_mark = v.is_some();
            c.defender_lich_mark_payload_status_id = v;
        }),
        get_attacker_string: Some(|c| c.attacker_lich_mark_payload_status_id.clone()),
        get_defender_string: Some(|c| c.defender_lich_mark_payload_status_id.clone()),
    },
];

/// Returns `(name, kind)` pairs for every value-bearing ability the
/// Sandbox can override. UI uses this to render the right input
/// element (number vs. dropdown) per ability. Mirrors the established
/// custom-creature picker pattern.
pub fn overridable_ability_value_specs() -> Vec<(&'static str, AbilityValueKind)> {
    OVERRIDABLE_ABILITY_VALUES
        .iter()
        .map(|d| (d.name, d.kind))
        .collect()
}

/// Whether a stat-field passive ability needs a numeric value (HP
/// threshold, damage %, cap %) or is a bare boolean. The Sandbox UI
/// uses this to pick a number input vs. a plain enable toggle.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum PassiveAbilityKind {
    Number,
    Bool,
}

/// Declarative table of every stat-field passive ability the Sandbox
/// can override. Distinct from [`OVERRIDABLE_ABILITY_FLAGS`] (config
/// gates) and [`OVERRIDABLE_ABILITY_VALUES`] (config values) - these
/// mutate `SimpleCombatantStats` fields directly, mirroring how the
/// production combat path receives them from `FinalStats`.
///
/// On-hit passives (Serrated Teeth, Sticky Fur, Wing Shredder,
/// Spirit Glare, etc.) are NOT in this table - they live as
/// `on_hit_statuses` entries and the Sandbox already exposes them via
/// the "Offensive Status Attack" override panel.
///
/// Self-Destruct intentionally omitted - its `self_destruct_profile`
/// is a multi-field struct (detonation HP, radius damage, status
/// payload) that needs a dedicated editor; treat the existing
/// passive-vs-active rules in `docs/adding-an-ability.md` as the source
/// of truth.
struct PassiveAbilityDef {
    name: &'static str,
    aliases: &'static [&'static str],
    kind: PassiveAbilityKind,
    /// Numeric setter / getter for the underlying stat field. `None`
    /// when `kind == Bool`.
    set_number: Option<fn(&mut SimpleCombatantStats, f64)>,
    /// Read-back accessor; forward-scaffold for a not-yet-exposed get-passive API (set_* counterparts are live).
    #[allow(dead_code)]
    get_number: Option<fn(&SimpleCombatantStats) -> f64>,
    /// Bool setter / getter. `None` when `kind == Number`.
    set_bool: Option<fn(&mut SimpleCombatantStats, bool)>,
    /// Read-back accessor; forward-scaffold for a not-yet-exposed get-passive API (set_* counterparts are live).
    #[allow(dead_code)]
    get_bool: Option<fn(&SimpleCombatantStats) -> bool>,
}

impl PassiveAbilityDef {
    fn matches_name(&self, requested: &str) -> bool {
        self.name == requested || self.aliases.contains(&requested)
    }
}

const OVERRIDABLE_PASSIVE_ABILITIES: &[PassiveAbilityDef] = &[
    PassiveAbilityDef {
        name: "Berserk",
        aliases: &[],
        kind: PassiveAbilityKind::Bool,
        set_number: None,
        get_number: None,
        // Per `referenceContent.ts::ability_berserk`: activates at
        // HP < 20%, bite cooldown ×0.5. These thresholds are the same
        // for every creature with Berserk - engine reads
        // `berserk_hp_ratio_threshold` as the activation gate. Toggle
        // ON writes the standard values; OFF zeroes them (the
        // multiplier returns to the default 1.0 via the
        // `default_berserk_bite_cooldown_multiplier` serde default).
        set_bool: Some(|s, v| {
            if v {
                s.berserk_hp_ratio_threshold = 0.20;
                s.berserk_bite_cooldown_multiplier = 0.5;
            } else {
                s.berserk_hp_ratio_threshold = 0.0;
                s.berserk_bite_cooldown_multiplier = 1.0;
            }
        }),
        get_bool: Some(|s| s.berserk_hp_ratio_threshold > 0.0),
    },
    PassiveAbilityDef {
        name: "Quick Recovery",
        aliases: &[],
        kind: PassiveAbilityKind::Bool,
        set_number: None,
        get_number: None,
        // Per `referenceContent.ts::ability_quick_recovery`: starts
        // ramping below 100% HP, peaks (2x regen) at ≤40% HP. The 0.40
        // threshold is where the ramp tops out - engine uses it as
        // the "max effect" anchor; values below it cap the multiplier.
        // Same across every creature with Quick Recovery.
        set_bool: Some(|s, v| {
            if v {
                s.quick_recovery_hp_ratio_threshold = 0.40;
            } else {
                s.quick_recovery_hp_ratio_threshold = 0.0;
            }
        }),
        get_bool: Some(|s| s.quick_recovery_hp_ratio_threshold > 0.0),
    },
    PassiveAbilityDef {
        name: "Warden's Resistance",
        aliases: &["Warden Resistance", "Wardens Resistance"],
        kind: PassiveAbilityKind::Bool,
        set_number: None,
        get_number: None,
        set_bool: Some(|s, v| s.has_warden_resistance = v),
        get_bool: Some(|s| s.has_warden_resistance),
    },
    // ── Per-creature value exceptions ───────────────────────────────────
    // First Strike's damage bonus and Unbreakable's cap % are the
    // legitimate exceptions to the "standard value across all creatures"
    // rule - the listed value is creature-specific (per reference
    // examples "First Strike 0.25" / "Unbreakable (12)"). UI exposes
    // a numeric input for these two only.
    PassiveAbilityDef {
        name: "First Strike",
        aliases: &[],
        kind: PassiveAbilityKind::Number,
        // first_strike_pct = the listed value (creature-specific).
        // hp_ratio_threshold (0.75 = activates above 75% HP) is fixed
        // by spec - match the serde default so changing the listed
        // value alone doesn't drift the activation window.
        set_number: Some(|s, v| {
            s.first_strike_pct = v;
            s.first_strike_hp_ratio_threshold = 0.75;
        }),
        get_number: Some(|s| s.first_strike_pct),
        set_bool: None,
        get_bool: None,
    },
    PassiveAbilityDef {
        name: "Unbreakable",
        aliases: &[],
        kind: PassiveAbilityKind::Number,
        // Per-source damage cap as fraction of user max HP. Reference
        // example: Unbreakable (12) means 12% (= 0.12). Caller is
        // expected to enter the fraction (0.12), not the percent (12).
        set_number: Some(|s, v| s.unbreakable_damage_cap_pct = v),
        get_number: Some(|s| s.unbreakable_damage_cap_pct),
        set_bool: None,
        get_bool: None,
    },
];

/// Returns `(name, kind)` pairs for every stat-field passive the
/// Sandbox can override. UI uses this to render the right input
/// element per passive (numeric value vs. plain enable toggle).
pub fn overridable_passive_specs() -> Vec<(&'static str, PassiveAbilityKind)> {
    OVERRIDABLE_PASSIVE_ABILITIES
        .iter()
        .map(|d| (d.name, d.kind))
        .collect()
}

/// Owning sandbox state.
///
/// Sides hold their `stats` / `breath` directly (no lifetime parameter on
/// `CombatSide`), so the runtime is fully safe - no `unsafe`, no
/// self-referential gymnastics. Override mutations are in-place field
/// writes on `self.config` / `self.attacker_stats` / `self.defender_stats`.
pub struct SandboxRuntime {
    /// Source-of-truth config the user mutates via the Override panel.
    /// Engine phase fns read it via the `PhaseContext` built at each step.
    config: ComposableAbilityConfig,

    /// Per-side stats + breath. These now live on the runtime
    /// rather than inside `CombatSide` - production benefited from
    /// dropping the field (zero-clone construction at the BB hot path),
    /// and sandbox-side mutations like `target.stats.health = 500`
    /// trivially port to `self.attacker_stats.health = 500`. Phase
    /// contexts built each step pass `&self.attacker_stats` /
    /// `&self.defender_stats` into the shared engine surface.
    attacker_stats: SimpleCombatantStats,
    defender_stats: SimpleCombatantStats,
    attacker_breath: Option<SimpleBreathProfile>,
    defender_breath: Option<SimpleBreathProfile>,

    /// Embedded loop state - the same struct the live driver
    /// (`simulate_composable_matchup_with_trace_control`) builds and
    /// hands to `run_one_event_loop_iter`. Sandbox shares the same
    /// per-iter body via this struct so live + sandbox stay
    /// byte-identical for SemiAuto runs.
    pub(super) loop_state: super::loop_iter::LoopState,

    /// Pristine copies of the post-`apply_disabled_abilities` stats and
    /// original config, captured at [`SandboxRuntime::new`]. The
    /// `clear_overrides` action restores from these so the side returns
    /// to its build-time baseline without rebuilding the whole runtime.
    attacker_snapshot: SimpleCombatantStats,
    defender_snapshot: SimpleCombatantStats,
    config_snapshot: ComposableAbilityConfig,

    /// Replay log of every state-mutating user action (apply HP, apply
    /// status, force bite/breath/ability, all overrides). Used by
    /// [`SandboxRuntime::step_to_time`] when the target time is **before**
    /// the current sim time: the runtime rebuilds from
    /// `attacker_snapshot` / `defender_snapshot` / `config_snapshot`,
    /// then replays the log up to `target_time`, then forward-steps to
    /// the exact target. Replays the old TS Sandbox's
    /// `seekSandboxToTime(config, actionLog, targetTime)` UX.
    action_log: Vec<SandboxAction>,

    /// Guard flag: when set, public action methods skip log-recording.
    /// Used during replay so we don't double-record.
    replaying: bool,

    event_phase_order: Vec<OrderedEventPhase>,

    flags: ComposableLoopFlags,
    ability_policy: SimpleAbilityTimingMode,
    automation_mode: SandboxAutomationMode,
    /// Bitmask of `OrderedEventPhase`s the scheduler is allowed to pick on
    /// the **next** step iteration, **in addition** to the passive default
    /// set. `force_bite/breath/ability` set the matching bit before
    /// running their internal step loop and clear it after.
    manual_phase_override: u32,
    record_trace: bool,
    max_time_sec: f64,
    halted: bool,
}

impl SandboxRuntime {
    /// Build a fresh sandbox at `time = 0` with the given creatures and
    /// configuration. Returns a heap-owned runtime; the caller (WASM
    /// registry) is responsible for keeping it alive while the JS UI
    /// holds its id.
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        attacker: SimpleCombatantStats,
        defender: SimpleCombatantStats,
        attacker_breath: Option<SimpleBreathProfile>,
        defender_breath: Option<SimpleBreathProfile>,
        config: ComposableAbilityConfig,
        ability_policy: SimpleAbilityTimingMode,
        automation_mode: SandboxAutomationMode,
        max_time_sec: f64,
        record_trace: bool,
    ) -> Box<Self> {
        let mut attacker = attacker;
        let mut defender = defender;
        apply_disabled_abilities(&mut attacker);
        apply_disabled_abilities(&mut defender);

        let mut a = CombatSide::new(&attacker, attacker_breath.as_ref());
        let mut b = CombatSide::new(&defender, defender_breath.as_ref());
        let flags = populate_combat_sides_and_flags(
            &mut a,
            &mut b,
            &attacker,
            &defender,
            ability_policy,
            &config,
        );

        let event_phase_order = normalize_ordered_event_phases(&config.combat_event_order);

        // Manual mode: arm bites + breath at t=0 so the per-side "Bite" /
        // "Breath" buttons are usable from the very first frame. Mirrors
        // the deleted TS Sandbox's `automationMode === "manual"` branch in
        // `createSandboxSimulation`. SemiAuto path keeps the natural
        // creature cooldown so engine auto-fires kick in normally.
        if matches!(automation_mode, SandboxAutomationMode::Manual) {
            a.next_hit = 0.0;
            b.next_hit = 0.0;
            if let Some(p) = attacker_breath.as_ref() {
                a.next_breath = 0.0;
                if a.breath_capacity <= 0.0 && p.capacity > 0.0 {
                    a.breath_capacity = p.capacity;
                }
            }
            if let Some(p) = defender_breath.as_ref() {
                b.next_breath = 0.0;
                if b.breath_capacity <= 0.0 && p.capacity > 0.0 {
                    b.breath_capacity = p.capacity;
                }
            }
        }

        // Snapshot pristine post-`apply_disabled_abilities` state for the
        // `clear_overrides` action. Cloning here is a one-shot cost paid
        // at sandbox construction; subsequent overrides are in-place.
        let attacker_snapshot = attacker.clone();
        let defender_snapshot = defender.clone();
        let config_snapshot = config.clone();

        let loop_state = super::loop_iter::LoopState {
            a,
            b,
            combat_log: Vec::new(),
            counters: DamageCounters::default(),
            time: -1e-9,
            same_time_processed_phases: 0,
            user_iteration_index: 0,
            hp_a_at_b_death: None,
            hp_b_at_a_death: None,
            bite_count_a: 0,
            bite_count_b: 0,
            breath_tick_count_a: 0,
            breath_tick_count_b: 0,
            regen_ticks_a: 0,
            regen_ticks_b: 0,
            regen_healed_a: 0.0,
            regen_healed_b: 0.0,
            warden_rage_events_a: Vec::new(),
            warden_rage_events_b: Vec::new(),
            ability_timing_events_a: Vec::new(),
            ability_timing_events_b: Vec::new(),
            fortify_control: FortifySimulationControl::default(),
        };

        Box::new(Self {
            config,
            attacker_stats: attacker,
            defender_stats: defender,
            attacker_breath,
            defender_breath,
            loop_state,
            attacker_snapshot,
            defender_snapshot,
            config_snapshot,
            action_log: Vec::new(),
            replaying: false,
            event_phase_order,
            flags,
            ability_policy,
            automation_mode,
            manual_phase_override: 0,
            record_trace,
            max_time_sec,
            halted: false,
        })
    }

    /// Apply one event-loop iteration. Mirrors the body of the main loop in
    /// `simulate_composable_matchup_with_trace_control`. Returns whether
    /// time / state advanced or the sim halted.
    pub fn step_to_next_event(&mut self) -> SandboxStepResult {
        self.step_to_next_event_inner(None)
    }

    /// Bounded variant of [`SandboxRuntime::step_to_next_event`]. When
    /// `bound` is `Some(t)`, the scheduler is allowed to advance `self.loop_state.time`
    /// up to `t`; if the next event sits past `t`, time + phase mask are
    /// reverted to their pre-scheduler values and `Halted` is returned
    /// **without** flipping `self.halted` true. Used by
    /// [`SandboxRuntime::step_to_time_forward`] to walk a status/regen/decay
    /// timeline up to the user-requested target without overshooting on the
    /// last event (e.g. status tick at t = 12 when user seeks to t = 10).
    fn step_to_next_event_inner(&mut self, bound: Option<f64>) -> SandboxStepResult {
        if self.halted {
            return SandboxStepResult::Halted;
        }
        if self.loop_state.a.death_time.is_some() && self.loop_state.b.death_time.is_some() {
            self.halted = true;
            return SandboxStepResult::Halted;
        }
        if self.loop_state.time > self.max_time_sec {
            self.halted = true;
            return SandboxStepResult::Halted;
        }

        // Manual mode: filter Bite/Breath/ActiveAbilities out of the
        // scheduler unless the user briefly whitelisted them via
        // `manual_phase_override` (set by force_bite/force_breath/
        // force_ability for one iter). SemiAuto runs the unfiltered order.
        let manual_mode = matches!(self.automation_mode, SandboxAutomationMode::Manual);
        let override_bits = self.manual_phase_override;
        let suppress_bite = manual_mode && override_bits & PHASE_BIT_BITE == 0;
        let suppress_breath = manual_mode && override_bits & PHASE_BIT_BREATH == 0;
        let effective_phase_order: Vec<OrderedEventPhase> = match self.automation_mode {
            SandboxAutomationMode::SemiAuto => self.event_phase_order.clone(),
            SandboxAutomationMode::Manual => self
                .event_phase_order
                .iter()
                .copied()
                .filter(|p| match p {
                    OrderedEventPhase::StatusDecay
                    | OrderedEventPhase::StatusTicks
                    | OrderedEventPhase::Regen => true,
                    OrderedEventPhase::Bite => override_bits & PHASE_BIT_BITE != 0,
                    OrderedEventPhase::Breath => override_bits & PHASE_BIT_BREATH != 0,
                    OrderedEventPhase::ActiveAbilities => {
                        override_bits & PHASE_BIT_ACTIVE_ABILITIES != 0
                    }
                })
                .collect(),
        };

        let params = super::loop_iter::LoopParams {
            attacker: &self.attacker_stats,
            defender: &self.defender_stats,
            attacker_breath: self.attacker_breath.as_ref(),
            defender_breath: self.defender_breath.as_ref(),
            config: &self.config,
            flags: &self.flags,
            ability_policy: self.ability_policy,
            event_phase_order: &effective_phase_order,
            record_trace: self.record_trace,
            max_time_sec: self.max_time_sec,
            // Sandbox must NOT pollute the global benchmark counter.
            bench_count: false,
            posture_policy_override: super::loop_iter::PosturePolicyMode::Normal,
            iter_hooks: super::loop_iter::IterHooks {
                bound,
                suppress_bite_in_scheduler: suppress_bite,
                suppress_breath_in_scheduler: suppress_breath,
            },
            decide_override: None,
            decide_override_respects_schedule: false,
            decide_bite_variant_override: None,
        };

        match super::loop_iter::run_one_event_loop_iter(&mut self.loop_state, &params) {
            super::loop_iter::LoopOutcome::Break => {
                self.halted = true;
                SandboxStepResult::Halted
            }
            super::loop_iter::LoopOutcome::Continue => SandboxStepResult::Advanced,
            super::loop_iter::LoopOutcome::Advanced => SandboxStepResult::Advanced,
            super::loop_iter::LoopOutcome::BoundExceeded => SandboxStepResult::Halted,
        }
    }

    // ── User actions ───────────────────────────────────────────────────────

    /// Step the sim to `target_time`. Advances forward when target is in the
    /// future. When target is in the past, rebuilds the sim from baseline
    /// snapshots and replays the action log up to `target_time` (mirrors the
    /// old TS Sandbox's `seekSandboxToTime` replay flow).
    pub fn step_to_time(&mut self, target_time: f64) {
        let target_time = target_time.max(0.0);
        if target_time + 1e-9 < self.loop_state.time {
            self.rewind_to(target_time);
            return;
        }
        self.step_to_time_forward(target_time);
    }

    fn step_to_time_forward(&mut self, target_time: f64) {
        let mut guard = 0u32;
        while !self.halted && self.loop_state.time < target_time && guard < 200_000 {
            // Bounded step - if the next event would land past target_time,
            // the inner step reverts and returns Halted (without flipping
            // self.halted true). Without this bound the scheduler walks
            // past the user-requested time (e.g. seek to 10s with status
            // ticks at 3 / 6 / 9 / 12 → engine processes the 12s tick and
            // lands at t = 12 instead of stopping at 10).
            if self.step_to_next_event_inner(Some(target_time)) == SandboxStepResult::Halted {
                break;
            }
            guard += 1;
        }
        // Mirror old TS Sandbox's `advanceSandboxToTime` tail-advance: when
        // the scheduler ran out of events before `target_time` (which is
        // common in Manual mode - Bite / Breath / ActiveAbilities phases
        // are filtered out so passive ticks alone may not extend out to
        // the requested time) and both sides are still alive, snap to the
        // requested time directly. Without this, the "Next bite ready" /
        // "Next breath ready" / "Jump to time" buttons silently no-op.
        if self.loop_state.time < target_time
            && self.loop_state.a.death_time.is_none()
            && self.loop_state.b.death_time.is_none()
            && target_time <= self.max_time_sec
        {
            self.loop_state.time = target_time;
            self.halted = false;
        }
    }

    /// Rebuild the runtime from the post-construction snapshots, then replay
    /// every action whose recorded time is `<= target_time`. Each replay
    /// step advances simulated time forward to the action's time before
    /// firing it, then forward-stepping continues to the final
    /// `target_time` once the log is exhausted.
    fn rewind_to(&mut self, target_time: f64) {
        let log = std::mem::take(&mut self.action_log);

        // Reset all loop / side state from snapshots. Stats live on
        // `self.attacker_stats` / `self.defender_stats` directly, so the
        // snapshot restore rewrites them in place and CombatSide::new
        // borrows them - no extra clone beyond the snapshot copy itself.
        self.attacker_stats = self.attacker_snapshot.clone();
        self.defender_stats = self.defender_snapshot.clone();
        self.loop_state.a = CombatSide::new(&self.attacker_stats, self.attacker_breath.as_ref());
        self.loop_state.b = CombatSide::new(&self.defender_stats, self.defender_breath.as_ref());
        self.config = self.config_snapshot.clone();
        self.loop_state.time = -1e-9;
        self.loop_state.combat_log.clear();
        self.loop_state.counters = DamageCounters::default();
        self.loop_state.hp_a_at_b_death = None;
        self.loop_state.hp_b_at_a_death = None;
        self.loop_state.bite_count_a = 0;
        self.loop_state.bite_count_b = 0;
        self.loop_state.breath_tick_count_a = 0;
        self.loop_state.breath_tick_count_b = 0;
        self.loop_state.regen_ticks_a = 0;
        self.loop_state.regen_ticks_b = 0;
        self.loop_state.regen_healed_a = 0.0;
        self.loop_state.regen_healed_b = 0.0;
        self.loop_state.warden_rage_events_a.clear();
        self.loop_state.warden_rage_events_b.clear();
        self.loop_state.ability_timing_events_a.clear();
        self.loop_state.ability_timing_events_b.clear();
        self.event_phase_order = normalize_ordered_event_phases(&self.config.combat_event_order);
        self.loop_state.same_time_processed_phases = 0;
        self.loop_state.user_iteration_index = 0;
        self.loop_state.fortify_control = FortifySimulationControl::default();
        self.halted = false;
        let attacker_stats = self.attacker_stats.clone();
        let defender_stats = self.defender_stats.clone();
        self.flags = populate_combat_sides_and_flags(
            &mut self.loop_state.a,
            &mut self.loop_state.b,
            &attacker_stats,
            &defender_stats,
            self.ability_policy,
            &self.config,
        );
        // Re-apply Manual-mode initial arming so the post-rewind state
        // matches what the user saw at t = 0 the first time around: bite
        // and breath buttons immediately ready, breath capacity full. Without
        // this, the rewind leaks the post-`populate_combat_sides_and_flags`
        // natural cooldowns (e.g. Aereis Next breath at: 1s) which look
        // like a state drift after Back To 0.
        if matches!(self.automation_mode, SandboxAutomationMode::Manual) {
            self.loop_state.a.next_hit = 0.0;
            self.loop_state.b.next_hit = 0.0;
            if let Some(p) = self.attacker_breath.as_ref() {
                self.loop_state.a.next_breath = 0.0;
                if self.loop_state.a.breath_capacity <= 0.0 && p.capacity > 0.0 {
                    self.loop_state.a.breath_capacity = p.capacity;
                }
            }
            if let Some(p) = self.defender_breath.as_ref() {
                self.loop_state.b.next_breath = 0.0;
                if self.loop_state.b.breath_capacity <= 0.0 && p.capacity > 0.0 {
                    self.loop_state.b.breath_capacity = p.capacity;
                }
            }
        }

        // Replay every recorded action whose time <= target_time.
        self.replaying = true;
        for action in log.iter() {
            let action_time = action.time();
            if action_time > target_time + 1e-9 {
                break;
            }
            if action_time > self.loop_state.time {
                self.step_to_time_forward(action_time);
                if self.halted {
                    break;
                }
            }
            self.apply_action(action);
            self.action_log.push(action.clone());
        }
        self.replaying = false;
        self.step_to_time_forward(target_time);
    }

    fn apply_action(&mut self, action: &SandboxAction) {
        match action {
            SandboxAction::ApplyHp { side, hp, .. } => self.apply_hp(*side, *hp),
            SandboxAction::ApplyStatus { side, status_id, stacks, .. } => {
                self.apply_status(*side, status_id, *stacks)
            }
            SandboxAction::ForceBite { side, .. } => self.force_bite(*side),
            SandboxAction::ForceBreath { side, .. } => self.force_breath(*side),
            SandboxAction::ForceAbility { side, ability_name, .. } => {
                let _ = self.force_ability(*side, ability_name);
            }
            SandboxAction::OverrideStat { side, field, value, .. } => {
                self.override_stat(*side, field, *value)
            }
            SandboxAction::OverrideAbility { side, ability_name, enabled, .. } => {
                let _ = self.override_ability(*side, ability_name, *enabled);
            }
            SandboxAction::OverrideAbilityNumber { side, ability_name, value, .. } => {
                let _ = self.override_ability_number(*side, ability_name, *value);
            }
            SandboxAction::OverrideAbilityString { side, ability_name, value, .. } => {
                let _ = self.override_ability_string(*side, ability_name, value.clone());
            }
            SandboxAction::OverridePassiveBool { side, passive_name, enabled, .. } => {
                let _ = self.override_passive_bool(*side, passive_name, *enabled);
            }
            SandboxAction::OverridePassiveNumber { side, passive_name, value, .. } => {
                let _ = self.override_passive_number(*side, passive_name, *value);
            }
            SandboxAction::OverrideBreath { side, profile, .. } => {
                self.override_breath(*side, profile.as_deref().cloned());
            }
            SandboxAction::OverrideResist { side, status_id, fraction, .. } => {
                self.override_resist(*side, status_id, *fraction)
            }
            SandboxAction::OverrideOffensiveStatus { side, status_id, stacks, .. } => {
                self.override_offensive_status(*side, status_id, *stacks)
            }
            SandboxAction::OverrideDefensiveStatus { side, status_id, stacks, .. } => {
                self.override_defensive_status(*side, status_id, *stacks)
            }
            SandboxAction::ClearOverrides { side, .. } => self.clear_overrides(*side),
        }
    }

    fn record_action(&mut self, action: SandboxAction) {
        if !self.replaying {
            self.action_log.push(action);
        }
    }

    /// Set a side's HP directly. Mirrors "Apply HP Now" in the deleted Sandbox UI.
    pub fn apply_hp(&mut self, side: SandboxSide, hp: f64) {
        let max_hp = self.stats(side).health.max(1.0);
        let target = self.side_mut(side);
        target.hp = hp.clamp(0.0, max_hp);
        let time = self.loop_state.time;
        self.record_action(SandboxAction::ApplyHp { time, side, hp });
    }

    /// Apply a status with given stacks at the current sim time.
    pub fn apply_status(&mut self, side: SandboxSide, status_id: &str, stacks: f64) {
        if stacks <= 0.0 {
            self.side_mut(side).statuses.remove(status_id);
            let time = self.loop_state.time;
            self.record_action(SandboxAction::ApplyStatus {
                time,
                side,
                status_id: status_id.to_string(),
                stacks: 0.0,
            });
            return;
        }
        let now = self.loop_state.time.max(0.0);
        let duration = crate::statuses::status_decay_sec(status_id);
        let tick = crate::statuses::status_tick_sec(status_id);
        let target = self.side_mut(side);
        let entry = target
            .statuses
            .entry(status_id.to_string())
            .or_insert(SimpleStatusInstance {
                stacks: 0.0,
                next_tick_at: tick.map(|t| now + t),
                next_decay_at: Some(now + duration),
                remaining_sec: duration,
                stack_value_mode: None,
                lich_mark_owned_stacks: None,
                no_decay: false,
                resolved_scalars: None,
            });
        entry.stacks = stacks;
        entry.remaining_sec = duration;
        entry.next_decay_at = Some(now + duration);
        if let Some(t) = tick {
            entry.next_tick_at = Some(now + t);
        }
        let time = self.loop_state.time;
        self.record_action(SandboxAction::ApplyStatus {
            time,
            side,
            status_id: status_id.to_string(),
            stacks,
        });
    }

    /// Force the side's bite to fire **now**, exclusively. Mirrors the old
    /// TS Sandbox's `runSandboxBite(side)` which dispatched the bite handler
    /// for just one side via `core.hitRuntime.handleMeleeHit`. Rust's phase
    /// fn always processes both sides in lockstep, so we trampoline:
    ///
    /// 1. Save opponent's `next_hit`, set it to `+∞` (won't fire this iter).
    /// 2. Set actor's `next_hit = now` so the scheduler picks Bite this iter.
    /// 3. Whitelist the Bite phase (Manual mode would otherwise filter it).
    /// 4. Step until actor's `bite_count` increments OR scheduler halts.
    /// 5. Restore opponent's `next_hit` **exactly as it was** - no `max(now)`
    ///    fallback. The old fallback `opp.next_hit = now` re-armed the
    ///    opponent for an immediate next-iter bite, which produced the
    ///    "2 bites at 0 s" bug in Manual mode.
    pub fn force_bite(&mut self, side: SandboxSide) {
        let now = self.loop_state.time.max(0.0);
        let opp_side = opponent_of(side);
        let opp_saved_next_hit = self.side(opp_side).next_hit;
        self.side_mut(opp_side).next_hit = f64::INFINITY;
        self.side_mut(side).next_hit = now;
        // Clear the same-tick phase mask: it remembers which phases the
        // engine already ran at the current `time`, used to prevent the
        // same iter from re-firing them. When the user force-bites side B
        // immediately after force-biting side A (time still pinned at the
        // same tick), the mask carries the Bite bit from A's bite and
        // `select_ordered_event_phase` masks Bite out of `available`,
        // so the scheduler micro-advances time without ever firing B's
        // bite. The manual action is a fresh user intent - drop the
        // mask so the scheduler treats this tick like a clean iter.
        self.loop_state.same_time_processed_phases = 0;
        let prev_override = self.manual_phase_override;
        self.manual_phase_override |= PHASE_BIT_BITE;
        let pre_bite_count = match side {
            SandboxSide::A => self.loop_state.bite_count_a,
            SandboxSide::B => self.loop_state.bite_count_b,
        };
        for _ in 0..50 {
            if self.step_to_next_event() == SandboxStepResult::Halted {
                break;
            }
            let new_count = match side {
                SandboxSide::A => self.loop_state.bite_count_a,
                SandboxSide::B => self.loop_state.bite_count_b,
            };
            if new_count > pre_bite_count {
                break;
            }
        }
        self.manual_phase_override = prev_override;
        // Direct restore - preserves Manual mode's `+∞` and SemiAuto's
        // pre-existing schedule.
        self.side_mut(opp_side).next_hit = opp_saved_next_hit;
        let time = self.loop_state.time;
        self.record_action(SandboxAction::ForceBite { time, side });
    }

    /// Force the side's breath to fire **now**, exclusively. Same posture
    /// as [`SandboxRuntime::force_bite`] - suppresses the opponent's
    /// breath for the one-step duration so the actor's breath resolves
    /// alone, then restores the opponent's schedule exactly.
    pub fn force_breath(&mut self, side: SandboxSide) {
        let now = self.loop_state.time.max(0.0);
        let opp_side = opponent_of(side);
        let opp_saved_next_breath = self.side(opp_side).next_breath;
        self.side_mut(opp_side).next_breath = f64::INFINITY;
        let max_cap = match side {
            SandboxSide::A => self.attacker_breath.as_ref().map(|b| b.capacity).unwrap_or(0.0),
            SandboxSide::B => self.defender_breath.as_ref().map(|b| b.capacity).unwrap_or(0.0),
        };
        let actor = self.side_mut(side);
        actor.next_breath = now;
        if actor.breath_capacity <= 0.0 && max_cap > 0.0 {
            actor.breath_capacity = max_cap;
        }
        // Same-tick phase mask reset - see force_bite comment. Without it,
        // a force_breath issued at the same tick as a prior force_bite /
        // force_breath gets masked out of the scheduler and never fires.
        self.loop_state.same_time_processed_phases = 0;
        let prev_override = self.manual_phase_override;
        self.manual_phase_override |= PHASE_BIT_BREATH;
        let pre_breath_count = match side {
            SandboxSide::A => self.loop_state.breath_tick_count_a,
            SandboxSide::B => self.loop_state.breath_tick_count_b,
        };
        for _ in 0..50 {
            if self.step_to_next_event() == SandboxStepResult::Halted {
                break;
            }
            let new_count = match side {
                SandboxSide::A => self.loop_state.breath_tick_count_a,
                SandboxSide::B => self.loop_state.breath_tick_count_b,
            };
            if new_count > pre_breath_count {
                break;
            }
        }
        self.manual_phase_override = prev_override;
        // Direct restore - see force_bite comment.
        self.side_mut(opp_side).next_breath = opp_saved_next_breath;
        let time = self.loop_state.time;
        self.record_action(SandboxAction::ForceBreath { time, side });
    }

    /// Fire a named ability **right now**, exclusively. Mirrors the old TS
    /// Sandbox's `runSandboxAbility(side, name)` design choice: the manual
    /// click directly mutates side state with the activation's active /
    /// cooldown / charge / HP-cost / status-clear effects, **without**
    /// running an engine step. This guarantees only the requested ability
    /// fires - no scheduler races, no other side's planned_at firing in the
    /// same tick, no event-loop reentry - and matches what the user expects:
    /// "I clicked Reflect, so Reflect is on, and nothing else changed."
    ///
    /// Returns `false` when:
    /// - the name isn't recognised (UI can warn);
    /// - the ability is still on cooldown / mid-charge (UI keeps the button
    ///   disabled with `cooldown_left` shown);
    /// - a precondition fails (Self-Destruct already used, Spite already
    ///   armed, etc.).
    ///
    /// On success, the next call to `snapshot_view()` reflects the new
    /// `active_until` / `cooldown_until` so the button label flips to
    /// "Ability (Ns)" disabled-on-cooldown immediately. Subsequent
    /// `step_to_next_event` / `step_to_time` calls let the engine apply the
    /// active's effects naturally (damage bonus during Unbridled Rage,
    /// Reflect bounce on incoming hits, etc.).
    pub fn force_ability(&mut self, side: SandboxSide, ability_name: &str) -> bool {
        let recognised = self.arm_ability_for_side(side, ability_name);
        if recognised {
            let time = self.loop_state.time;
            self.record_action(SandboxAction::ForceAbility {
                time,
                side,
                ability_name: ability_name.to_string(),
            });
            // Emit a single combat-log entry so the Event Log surfaces the
            // manual activation between engine-driven entries.
            let (attacker_label, hp_after) = match side {
                SandboxSide::A => ("A".to_string(), self.loop_state.a.hp),
                SandboxSide::B => ("B".to_string(), self.loop_state.b.hp),
            };
            self.loop_state.combat_log.push(CombatLogEntry {
                time,
                entry_type: "ability".to_string(),
                attacker: attacker_label.clone(),
                damage: 0.0,
                healing: None,
                actor_hp_after: hp_after,
                hp_side: attacker_label,
                hp_after,
                description: Some(format!("Manual {ability_name}")),
                detail: None,
                status_id: None,
            });
        }
        recognised
    }

    /// Activate one ability on `side` **right now** if its natural cooldown
    /// has elapsed. This is the "manual click landed" handler - it directly
    /// mutates the side's activation state (active_until + cooldown_until +
    /// armed flag + on-activation effects like HP cost / status clear) so
    /// the result mirrors what the engine would have done if it picked the
    /// activation phase in the same tick. **No engine step is run** - the
    /// caller calls this from `force_ability`, which records the action and
    /// surfaces the updated view; subsequent `step_to_next_event` calls let
    /// the engine apply the buff's natural effects (e.g. Reflect bouncing
    /// incoming hits, Adrenaline's per-bite damage bump, etc.).
    ///
    /// This mirrors the deleted TS Sandbox's `runSandboxAbility` → activate*
    /// helper pattern, which also bypassed the engine event loop for the
    /// activation itself. Sandbox's value is "I get to script the fight"
    /// and that requires deterministic per-click activation, not a "fire
    /// when the scheduler agrees" gate.
    ///
    /// Returns `false` for unrecognised names AND for abilities still on
    /// cooldown / mid-charge / locked-out - both surface to the UI as
    /// "can't fire right now" (button stays disabled with cooldown shown).
    fn arm_ability_for_side(&mut self, side: SandboxSide, ability_name: &str) -> bool {
        let now = self.loop_state.time.max(0.0);
        // Instant-effect actives (Cause Fear / Grim Lariat / Cursed Sigil /
        // Drowsy Area) apply an opponent-side status (and damage, for Grim
        // Lariat) immediately and have no `active_until` window for the
        // engine to read later - the effect MUST land at click time.
        // Pre-fix these set only the user-side cooldown_until in the
        // future, which (a) used wrong CD values and (b) blocked the
        // engine's natural firing branch in `phases::process_phase_4_*`
        // for the next iter (the `time >= cooldown_until` gate evaluated
        // false), so the status never landed at all. Dispatch them
        // before the single-side `target, stats` destructure below so
        // they can take a both-sides + combat_log borrow.
        match ability_name {
            "Cause Fear" => return self.try_force_cause_fear(side, now),
            "Grim Lariat" => return self.try_force_grim_lariat(side, now),
            "Cursed Sigil" => return self.try_force_cursed_sigil(side, now),
            "Drowsy Area" => return self.try_force_drowsy_area(side, now),
            _ => {}
        }
        // Active-cooldown multiplier applies to every UI active (Gourmandizer
        // / similar - pulled from stats.active_cooldown_multiplier via the
        // shared helper). Read stats first so the mutable borrow on `target`
        // below doesn't conflict with the stats read.
        let (target, stats) = self.side_and_stats_mut(side);
        let cd_mult = if stats.active_cooldown_multiplier > 0.0 {
            stats.active_cooldown_multiplier
        } else {
            1.0
        };
        let max_hp = stats.health.max(1.0);
        match ability_name {
            "Fortify" => {
                if now + 1e-9 < target.fortify_cooldown_until {
                    return false;
                }
                // Fortify clears every removable debuff status + sets the
                // immunity / weight-bonus window for 12 s (4 stacks × 3 s)
                // + sets the 120 s cooldown. Mirrors `activateFortify`.
                let duration = 12.0;
                target
                    .statuses
                    .retain(|id, inst| !is_fortify_cleansable_instance(id, inst));
                target.fortify_immune_until = now + duration;
                target.fortify_weight_bonus_until = now + duration;
                target.fortify_cooldown_until = now + 120.0 * cd_mult;
                true
            }
            "Hunker" => {
                // Toggle - flip `hunker_on`. When turning on, set the
                // effect-start time so the engine's hit phase reads the
                // reduction immediately (or after the configured grace if
                // we're past the initial activation).
                if target.hunker_on {
                    target.hunker_on = false;
                    target.hunker_effect_starts_at = f64::INFINITY;
                } else {
                    target.hunker_on = true;
                    target.hunker_effect_starts_at = now;
                }
                true
            }
            "Harden" => {
                if now + 1e-9 < target.harden_cooldown_until.max(target.harden_active_until) {
                    return false;
                }
                target.harden_active_until = now + 30.0;
                target.harden_cooldown_until = now + 120.0 * cd_mult;
                true
            }
            "Adrenaline" => {
                if now + 1e-9
                    < target.adrenaline_cooldown_until.max(target.adrenaline_active_until)
                {
                    return false;
                }
                target.adrenaline_active_until = now + 30.0;
                target.adrenaline_cooldown_until = now + 90.0 * cd_mult;
                true
            }
            "Rewind" => {
                if now + 1e-9 < target.rewind_cooldown_until {
                    return false;
                }
                // The full rewind effect (HP / status restore from 9 s ago)
                // is tracked by the engine's continuous snapshot ring; the
                // sandbox manual click sets the cooldown so the button
                // disables, and the engine will apply the rewind on the
                // next step. Matches old TS `activateRewind` for the
                // simplified path (engine handles the actual rewind).
                target.rewind_cooldown_until = now + 100.0 * cd_mult;
                true
            }
            "Reflect" => {
                if now + 1e-9 < target.reflect_cooldown_until.max(target.reflect_active_until) {
                    return false;
                }
                target.reflect_active_until = now + 6.0;
                target.reflect_cooldown_until = now + 60.0 * cd_mult;
                true
            }
            "Life Leech" => {
                if now + 1e-9
                    < target.life_leech_cooldown_until.max(target.life_leech_active_until)
                {
                    return false;
                }
                target.life_leech_active_until = now + 12.0;
                target.life_leech_cooldown_until = now + 60.0 * cd_mult;
                true
            }
            "Hunters Curse" | "Hunter's Curse" => {
                if now + 1e-9
                    < target.hunters_curse_cooldown_until.max(target.hunters_curse_active_until)
                {
                    return false;
                }
                // 50 % max HP cost (clamped to >= 1 HP), per old
                // `activateHuntersCurse`. The engine's phase fn would apply
                // the same drain on natural activation; doing it here keeps
                // sandbox manual click feeling instant.
                target.hp = (target.hp - max_hp * 0.5).max(1.0);
                target.hunters_curse_active_until = now + 30.0;
                target.hunters_curse_cooldown_until = now + 120.0 * cd_mult;
                true
            }
            "Unbridled Rage" => {
                if now + 1e-9
                    < target.unbridled_rage_cooldown_until.max(target.unbridled_rage_active_until)
                {
                    return false;
                }
                target.unbridled_rage_active_until = now + 30.0;
                target.unbridled_rage_cooldown_until = now + 120.0 * cd_mult;
                true
            }
            "Warden Rage" | "Warden's Rage" => {
                // Toggle: turn on if off, off if on. No cooldown check on
                // release (matches old Sandbox).
                if target.warden_rage_on {
                    target.warden_rage_on = false;
                } else if now + 1e-9 < target.warden_rage_cooldown_until {
                    return false;
                } else {
                    target.warden_rage_on = true;
                    target.warden_rage_tap_until = now + 0.25;
                    target.warden_rage_cooldown_until = now + 30.0 * cd_mult;
                }
                true
            }
            "Cocoon" => {
                if now + 1e-9 < target.cocoon_cooldown_until {
                    return false;
                }
                target.cocoon_phase1_until = now + 2.0;
                target.cocoon_cooldown_until = now + 60.0 * cd_mult;
                true
            }
            "Frost Nova" => {
                if now + 1e-9 < target.frost_nova_cooldown_until {
                    return false;
                }
                target.frost_nova_active_until = now + 15.0;
                target.frost_nova_cooldown_until = now + 60.0 * cd_mult;
                true
            }
            "Reflux" => {
                if target.reflux_armed {
                    return false;
                }
                if now + 1e-9 < target.reflux_cooldown_until {
                    return false;
                }
                // Arm the charge - engine ticks the impact + puddle.
                target.reflux_armed = true;
                target.reflux_charge_ready_at = now + 5.0;
                true
            }
            "Totem" => {
                if (target.totem_active_until > now)
                    || (now + 1e-9 < target.totem_cooldown_until)
                {
                    return false;
                }
                target.totem_active_until = now + 20.0;
                target.totem_next_tick_at = Some(now + 3.0);
                target.totem_cooldown_until = now + 20.0 * cd_mult;
                true
            }
            "Thorn Trap" => {
                if now + 1e-9 < target.thorn_trap_cooldown_until {
                    return false;
                }
                target.next_thorn_trap = now;
                true
            }
            "Toxic Trap" => {
                if target.toxic_trap_bites_remaining > 0 {
                    return false;
                }
                if now + 1e-9 < target.toxic_trap_cooldown_until {
                    return false;
                }
                target.toxic_trap_bites_remaining = 25;
                target.toxic_trap_next_tick_at = Some(now + 3.0);
                true
            }
            "Frost Snare" => {
                if now + 1e-9 < target.frost_snare_cooldown_until {
                    return false;
                }
                target.next_frost_snare = now;
                true
            }
            "Poison Area" => {
                if now + 1e-9 < target.poison_area_cooldown_until {
                    return false;
                }
                target.next_poison_area = now;
                true
            }
            "Yolk Bomb" => {
                if now + 1e-9 < target.yolk_bomb_cooldown_until {
                    return false;
                }
                target.next_yolk_bomb = now;
                true
            }
            "Divination" => {
                if target.divination_charges_left > 0 {
                    return true;
                }
                if now + 1e-9 < target.divination_cooldown_until {
                    return false;
                }
                target.next_divination = now;
                true
            }
            // "Drowsy Area" / "Cause Fear" / "Grim Lariat" / "Cursed Sigil"
            // dispatched before this match (instant-effect - needs both sides).
            "Lich Mark" => {
                if now + 1e-9 < target.lich_mark_cooldown_until {
                    return false;
                }
                target.lich_mark_armed_until = now + LICH_MARK_ARMED_WINDOW_SEC;
                target.lich_mark_cooldown_until = now + 30.0 * cd_mult;
                true
            }
            "Spite" => {
                if target.spite_armed {
                    return false;
                }
                if now + 1e-9 < target.spite_cooldown_until {
                    return false;
                }
                target.spite_armed = true;
                target.spite_charge_ready_at = now + 5.0;
                target.spite_cooldown_until = now + 20.0 * cd_mult;
                true
            }
            "Shadow Barrage" => {
                if target.shadow_barrage_remaining_hits > 0 || target.shadow_barrage_next_hit_at.is_some() {
                    return false;
                }
                if now + 1e-9 < target.shadow_barrage_cooldown_until {
                    return false;
                }
                target.shadow_barrage_remaining_hits = 10;
                target.shadow_barrage_next_hit_at = Some(now + 0.5);
                true
            }
            // "Cursed Sigil" dispatched before this match (instant-effect).
            "Self-Destruct" => {
                // Passive - only meaningful when armed by HP threshold.
                false
            }
            _ => false,
        }
    }

    /// Manually fire Cause Fear: 10 stacks Fear to opponent + 120 s
    /// cooldown on user. Delegates to the canonical helper shared with
    /// `phases::process_phase_4_misc_and_cocoon_cluster` so the click
    /// path and the engine path stay in lock-step. `record_trace=false`
    /// because `force_ability` records a separate "Manual <name>" log
    /// entry around this call.
    fn try_force_cause_fear(&mut self, side: SandboxSide, now: f64) -> bool {
        let cooldown_until = match side {
            SandboxSide::A => self.loop_state.a.cause_fear_cooldown_until,
            SandboxSide::B => self.loop_state.b.cause_fear_cooldown_until,
        };
        if now + 1e-9 < cooldown_until {
            return false;
        }
        match side {
            SandboxSide::A => super::phases::apply_cause_fear_effect(
                now,
                &self.attacker_stats,
                &self.defender_stats,
                &mut self.loop_state.a,
                &mut self.loop_state.b,
                "A",
                &mut self.loop_state.combat_log,
                false,
            ),
            SandboxSide::B => super::phases::apply_cause_fear_effect(
                now,
                &self.defender_stats,
                &self.attacker_stats,
                &mut self.loop_state.b,
                &mut self.loop_state.a,
                "B",
                &mut self.loop_state.combat_log,
                false,
            ),
        }
        true
    }

    fn try_force_grim_lariat(&mut self, side: SandboxSide, now: f64) -> bool {
        let cooldown_until = match side {
            SandboxSide::A => self.loop_state.a.grim_lariat_cooldown_until,
            SandboxSide::B => self.loop_state.b.grim_lariat_cooldown_until,
        };
        if now + 1e-9 < cooldown_until {
            return false;
        }
        match side {
            SandboxSide::A => super::phases::apply_grim_lariat_effect(
                now,
                &self.attacker_stats,
                &self.defender_stats,
                &mut self.loop_state.a,
                &mut self.loop_state.b,
                "A",
                &mut self.loop_state.combat_log,
                false,
                &mut self.loop_state.counters.dealt_a,
            ),
            SandboxSide::B => super::phases::apply_grim_lariat_effect(
                now,
                &self.defender_stats,
                &self.attacker_stats,
                &mut self.loop_state.b,
                &mut self.loop_state.a,
                "B",
                &mut self.loop_state.combat_log,
                false,
                &mut self.loop_state.counters.dealt_b,
            ),
        }
        true
    }

    fn try_force_cursed_sigil(&mut self, side: SandboxSide, now: f64) -> bool {
        let cooldown_until = match side {
            SandboxSide::A => self.loop_state.a.cursed_sigil_cooldown_until,
            SandboxSide::B => self.loop_state.b.cursed_sigil_cooldown_until,
        };
        if now + 1e-9 < cooldown_until {
            return false;
        }
        let stacks = match side {
            SandboxSide::A => self.config.attacker_cursed_sigil_stacks,
            SandboxSide::B => self.config.defender_cursed_sigil_stacks,
        };
        if stacks <= 0.0 {
            // Stack count is config-driven; matches phases.rs gate
            // (`config.X_cursed_sigil_stacks > 0.0`).
            return false;
        }
        match side {
            SandboxSide::A => super::phases::apply_cursed_sigil_effect(
                now,
                &self.attacker_stats,
                &self.defender_stats,
                &mut self.loop_state.a,
                &mut self.loop_state.b,
                stacks,
                "A",
                &mut self.loop_state.combat_log,
                false,
            ),
            SandboxSide::B => super::phases::apply_cursed_sigil_effect(
                now,
                &self.defender_stats,
                &self.attacker_stats,
                &mut self.loop_state.b,
                &mut self.loop_state.a,
                stacks,
                "B",
                &mut self.loop_state.combat_log,
                false,
            ),
        }
        true
    }

    fn try_force_drowsy_area(&mut self, side: SandboxSide, now: f64) -> bool {
        let cooldown_until = match side {
            SandboxSide::A => self.loop_state.a.drowsy_area_cooldown_until,
            SandboxSide::B => self.loop_state.b.drowsy_area_cooldown_until,
        };
        if now + 1e-9 < cooldown_until {
            return false;
        }
        match side {
            SandboxSide::A => super::phases::apply_drowsy_area_effect(
                now,
                &self.attacker_stats,
                &self.defender_stats,
                &mut self.loop_state.a,
                &mut self.loop_state.b,
                "A",
                &mut self.loop_state.combat_log,
                false,
            ),
            SandboxSide::B => super::phases::apply_drowsy_area_effect(
                now,
                &self.defender_stats,
                &self.attacker_stats,
                &mut self.loop_state.b,
                &mut self.loop_state.a,
                "B",
                &mut self.loop_state.combat_log,
                false,
            ),
        }
        true
    }

    /// Override a numeric runtime stat. There are two paths:
    ///
    /// - `"health"` mutates `stats.health` (max HP) directly and clamps
    ///   the current HP into the new envelope. The "current HP > new max"
    ///   case is the common one - user types `Health: 500` on a creature
    ///   sitting at 800 HP, expects the bar to snap to 500/500.
    /// - `"damage"`, `"bite_cooldown"`, `"weight"`, `"health_regen"` write
    ///   a `modifier.<field>` entry into the side's `user_extras`. The
    ///   composable engine's `effective_stat_value` reads these on every
    ///   relevant computation, so the override takes effect on the next
    ///   event without rebuilding state.
    ///
    /// Other field names are silently ignored (no panic - the UI rejects
    /// unsupported names client-side).
    pub fn override_stat(&mut self, side: SandboxSide, field: &str, value: f64) {
        if !matches!(
            field,
            "health" | "damage" | "bite_cooldown" | "weight" | "health_regen"
        ) {
            return;
        }
        match field {
            "health" => {
                let new_max = value.max(1.0);
                self.stats_mut(side).health = new_max;
                let target = self.side_mut(side);
                if target.hp > new_max {
                    target.hp = new_max;
                }
            }
            "damage" => {
                self.stats_mut(side).damage = value.max(0.0);
            }
            "bite_cooldown" => {
                self.stats_mut(side).bite_cooldown = value.max(0.1);
            }
            "weight" => {
                self.stats_mut(side).weight = value.max(1.0);
            }
            "health_regen" => {
                self.stats_mut(side).health_regen = value.max(0.0);
            }
            _ => return,
        }
        let time = self.loop_state.time;
        self.record_action(SandboxAction::OverrideStat {
            time,
            side,
            field: field.to_string(),
            value,
        });
    }

    /// Clear all overrides on a side. Restores effective stats to the
    /// build-time values AND removes any `extra_*` entries (abilities /
    /// resists / status attacks) added via `override_ability` /
    /// `override_resist` / `override_offensive_status` /
    /// `override_defensive_status`. The base creature returns to its
    /// post-build state.
    pub fn clear_overrides(&mut self, side: SandboxSide) {
        let time = self.loop_state.time;
        self.record_action(SandboxAction::ClearOverrides { time, side });
        // Drop modifier.X entries written by override_stat.
        let prefix = crate::effects::MODIFIER_KEY_PREFIX;
        let target = self.side_mut(side);
        target
            .user_extras
            .retain(|k, _| !k.starts_with(prefix));
        // Drop sandbox-injected statuses / resists. We track them via the
        // `sandbox_override.*` namespace on user_extras so the clear
        // operation knows which entries to remove. Since override_*
        // methods mutate stats directly, we additionally re-clone the
        // creature's pre-override snapshot the runtime captured at
        // construction time (see [`SandboxRuntime::snapshots`]).
        let snapshot = match side {
            SandboxSide::A => self.attacker_snapshot.clone(),
            SandboxSide::B => self.defender_snapshot.clone(),
        };
        *self.stats_mut(side) = snapshot;
        // Sandbox-config overrides (extra abilities) are cleared in
        // `clear_config_overrides_for_side` below; this method only
        // resets the side-level state.
        self.clear_config_overrides_for_side(side);
        self.recompute_flags();
    }

    /// Inject an extra ability into the side's runtime config flag.
    /// Mirrors the deleted Sandbox UI's "Override Type → Ability/Effect"
    /// → Add path. Recognised names are mapped to the relevant
    /// `ComposableAbilityConfig` flag; unknown names return `false`.
    pub fn override_ability(&mut self, side: SandboxSide, ability_name: &str, enabled: bool) -> bool {
        let recognised = self.set_config_ability_flag(side, ability_name, enabled);
        if recognised {
            self.recompute_flags();
            let time = self.loop_state.time;
            self.record_action(SandboxAction::OverrideAbility {
                time,
                side,
                ability_name: ability_name.to_string(),
                enabled,
            });
        }
        recognised
    }

    /// Override the numeric value of a value-bearing ability (e.g.
    /// Cursed Sigil stacks, Life Leech %, Spite damage value, Trail
    /// fractions). Names recognised here come from
    /// [`OVERRIDABLE_ABILITY_VALUES`] with `kind == Number`. Setting
    /// the value to 0 effectively disables the ability - the engine
    /// gates each value ability on `> 0`.
    pub fn override_ability_number(
        &mut self,
        side: SandboxSide,
        ability_name: &str,
        value: f64,
    ) -> bool {
        let recognised = self.set_config_ability_number(side, ability_name, value);
        if recognised {
            self.recompute_flags();
            let time = self.loop_state.time;
            self.record_action(SandboxAction::OverrideAbilityNumber {
                time,
                side,
                ability_name: ability_name.to_string(),
                value,
            });
        }
        recognised
    }

    /// Override the string value (categorical payload) of a
    /// value-bearing ability. `None` clears the payload; the engine
    /// treats `Some(_)` as the enabled state for value-only string
    /// abilities (Aura subtype). For abilities with a separate bool
    /// gate (Yolk Bomb, Lich Mark) the toggle is handled via
    /// [`override_ability`]; this only sets the payload.
    pub fn override_ability_string(
        &mut self,
        side: SandboxSide,
        ability_name: &str,
        value: Option<String>,
    ) -> bool {
        let recognised = self.set_config_ability_string(side, ability_name, value.clone());
        if recognised {
            self.recompute_flags();
            let time = self.loop_state.time;
            self.record_action(SandboxAction::OverrideAbilityString {
                time,
                side,
                ability_name: ability_name.to_string(),
                value,
            });
        }
        recognised
    }

    /// Toggle a Bool-kind passive (Berserk, Quick Recovery, Warden's
    /// Resistance) by writing its standard stat-field activation
    /// signal. The user passes `enabled=true` to activate; the table
    /// entry knows the spec-defined thresholds (e.g. 20% for Berserk,
    /// 40% for Quick Recovery - same for every creature with that
    /// passive).
    pub fn override_passive_bool(
        &mut self,
        side: SandboxSide,
        passive_name: &str,
        enabled: bool,
    ) -> bool {
        let recognised = self.set_stats_passive_bool(side, passive_name, enabled);
        if recognised {
            self.recompute_flags();
            let time = self.loop_state.time;
            self.record_action(SandboxAction::OverridePassiveBool {
                time,
                side,
                passive_name: passive_name.to_string(),
                enabled,
            });
        }
        recognised
    }

    /// Replace the side's breath profile (or clear it with `None`).
    /// The caller (Sandbox UI bridge) constructs the
    /// `SimpleBreathProfile` from a breath ability name via
    /// `buildBreathProfileByName` in `rustBestBuildsRuntime.ts`; this
    /// method just swaps the runtime field and resets the per-side
    /// breath state so the new profile takes effect immediately.
    ///
    /// Resets `breath_capacity` to the new profile's `capacity` (or 0
    /// for clear) and `next_breath` to 0 so the new breath is ready
    /// to fire at the current time. Other side state (HP, statuses,
    /// other ability cooldowns) is preserved.
    pub fn override_breath(&mut self, side: SandboxSide, profile: Option<SimpleBreathProfile>) {
        let (slot, side_state) = match side {
            SandboxSide::A => (&mut self.attacker_breath, &mut self.loop_state.a),
            SandboxSide::B => (&mut self.defender_breath, &mut self.loop_state.b),
        };
        *slot = profile.clone();
        // Re-seed the per-side breath state from the new profile.
        let new_capacity = profile.as_ref().map(|p| p.capacity).unwrap_or(0.0);
        side_state.breath_capacity = new_capacity;
        side_state.next_breath = 0.0;
        let time = self.loop_state.time;
        self.record_action(SandboxAction::OverrideBreath {
            time,
            side,
            profile: profile.map(Box::new),
        });
    }

    /// Set the numeric stat field of a Number-kind passive (First
    /// Strike pct, Unbreakable cap pct). These are the per-creature
    /// exceptions where the listed value varies; bool toggles aren't
    /// enough. Pass 0 to disable.
    pub fn override_passive_number(
        &mut self,
        side: SandboxSide,
        passive_name: &str,
        value: f64,
    ) -> bool {
        let recognised = self.set_stats_passive_number(side, passive_name, value);
        if recognised {
            self.recompute_flags();
            let time = self.loop_state.time;
            self.record_action(SandboxAction::OverridePassiveNumber {
                time,
                side,
                passive_name: passive_name.to_string(),
                value,
            });
        }
        recognised
    }

    /// Add (or replace) a status-resist fraction on the side's stats.
    /// `fraction` is a value in [0, 1] - 0.25 means "25 % of incoming
    /// stacks of this status are blocked". Values above 1 clamp to 1.
    ///
    /// Sentinel: `fraction <= 0` REMOVES any sandbox-injected entry
    /// for this status (matches the offensive / defensive_status
    /// "stacks ≤ 0 deletes" convention so the UI's per-override
    /// Remove button can use a single API shape across all
    /// non-stat overrides). Mirrors the deleted Sandbox UI's
    /// "Override Type → Resist" panel.
    pub fn override_resist(&mut self, side: SandboxSide, status_id: &str, fraction: f64) {
        let value = fraction.clamp(0.0, 1.0);
        let stats = self.stats_mut(side);
        if value <= 0.0 {
            stats.status_resist_fractions.remove(status_id);
        } else {
            stats
                .status_resist_fractions
                .insert(status_id.to_string(), value);
        }
        let time = self.loop_state.time;
        self.record_action(SandboxAction::OverrideResist {
            time,
            side,
            status_id: status_id.to_string(),
            fraction: value,
        });
    }

    /// Add an on-hit ("offensive") status the side will apply when it
    /// bites or breaths. Mirrors the deleted Sandbox UI's
    /// "Override Type → Offensive Status Attack" panel. Stacks ≤ 0
    /// removes any sandbox-injected entry with the same status id.
    pub fn override_offensive_status(&mut self, side: SandboxSide, status_id: &str, stacks: f64) {
        let stats = self.stats_mut(side);
        if stacks <= 0.0 {
            stats
                .on_hit_statuses
                .retain(|entry| entry.status_id != status_id || entry.source_ability.is_some());
        } else {
            stats
                .on_hit_statuses
                .retain(|entry| entry.status_id != status_id || entry.source_ability.is_some());
            stats.on_hit_statuses.push(crate::contracts::SimpleAppliedStatus {
                status_id: status_id.to_string(),
                stacks,
                source_ability: None,
            });
        }
        let time = self.loop_state.time;
        self.record_action(SandboxAction::OverrideOffensiveStatus {
            time,
            side,
            status_id: status_id.to_string(),
            stacks,
        });
    }

    /// Add an on-hit-taken ("defensive") status the side will apply to
    /// the attacker when bitten. Mirrors the deleted Sandbox UI's
    /// "Override Type → Defensive Status Attack" panel. Stacks ≤ 0
    /// removes any sandbox-injected entry with the same status id.
    pub fn override_defensive_status(&mut self, side: SandboxSide, status_id: &str, stacks: f64) {
        let stats = self.stats_mut(side);
        if stacks <= 0.0 {
            stats
                .on_hit_taken_statuses
                .retain(|entry| entry.status_id != status_id || entry.source_ability.is_some());
        } else {
            stats
                .on_hit_taken_statuses
                .retain(|entry| entry.status_id != status_id || entry.source_ability.is_some());
            stats.on_hit_taken_statuses.push(crate::contracts::SimpleAppliedStatus {
                status_id: status_id.to_string(),
                stacks,
                source_ability: None,
            });
        }
        let time = self.loop_state.time;
        self.record_action(SandboxAction::OverrideDefensiveStatus {
            time,
            side,
            status_id: status_id.to_string(),
            stacks,
        });
    }

    /// Recompute setup-time flags after a config-affecting override. Mirrors
    /// the production path's one-shot setup so phase fns see consistent
    /// `flags.has_any_*` values.
    fn recompute_flags(&mut self) {
        let attacker_stats = self.attacker_stats.clone();
        let defender_stats = self.defender_stats.clone();
        // `populate_combat_sides_and_flags` mutates side fields and returns
        // flags. Calling it on an already-initialized side re-applies
        // setup-only mutations (e.g. status seeding, hunker resolution) -
        // these are idempotent at time = 0 but become re-trigger noise
        // mid-fight. To avoid that, we only refresh flags here; the side
        // mutations stay as-is from the original setup.
        //
        // Implementation: spin up a temporary "scratch" side with the
        // current stats, run populate, and harvest just the flags.
        let mut scratch_a = CombatSide::new(&attacker_stats, self.attacker_breath.as_ref());
        let mut scratch_b = CombatSide::new(&defender_stats, self.defender_breath.as_ref());
        let flags = populate_combat_sides_and_flags(
            &mut scratch_a,
            &mut scratch_b,
            &attacker_stats,
            &defender_stats,
            self.ability_policy,
            &self.config,
        );
        self.flags = flags;
    }

    /// Map a UI ability name to the corresponding `ComposableAbilityConfig`
    /// flag and toggle it. Returns whether the name was recognised.
    fn set_config_ability_flag(&mut self, side: SandboxSide, ability_name: &str, enabled: bool) -> bool {
        let Some(def) = OVERRIDABLE_ABILITY_FLAGS
            .iter()
            .find(|d| d.matches_name(ability_name))
        else {
            return false;
        };
        match side {
            SandboxSide::A => (def.set_attacker)(&mut self.config, enabled),
            SandboxSide::B => (def.set_defender)(&mut self.config, enabled),
        }
        true
    }

    fn set_config_ability_number(
        &mut self,
        side: SandboxSide,
        ability_name: &str,
        value: f64,
    ) -> bool {
        let Some(def) = OVERRIDABLE_ABILITY_VALUES
            .iter()
            .find(|d| d.matches_name(ability_name))
        else {
            return false;
        };
        if def.kind != AbilityValueKind::Number {
            return false;
        }
        let setter = match side {
            SandboxSide::A => def.set_attacker_number,
            SandboxSide::B => def.set_defender_number,
        };
        if let Some(set) = setter {
            set(&mut self.config, value);
            true
        } else {
            false
        }
    }

    fn set_config_ability_string(
        &mut self,
        side: SandboxSide,
        ability_name: &str,
        value: Option<String>,
    ) -> bool {
        let Some(def) = OVERRIDABLE_ABILITY_VALUES
            .iter()
            .find(|d| d.matches_name(ability_name))
        else {
            return false;
        };
        if def.kind != AbilityValueKind::String {
            return false;
        }
        let setter = match side {
            SandboxSide::A => def.set_attacker_string,
            SandboxSide::B => def.set_defender_string,
        };
        if let Some(set) = setter {
            set(&mut self.config, value);
            true
        } else {
            false
        }
    }

    fn set_stats_passive_bool(
        &mut self,
        side: SandboxSide,
        passive_name: &str,
        enabled: bool,
    ) -> bool {
        let Some(def) = OVERRIDABLE_PASSIVE_ABILITIES
            .iter()
            .find(|d| d.matches_name(passive_name))
        else {
            return false;
        };
        if def.kind != PassiveAbilityKind::Bool {
            return false;
        }
        if let Some(set) = def.set_bool {
            let stats = self.stats_mut(side);
            set(stats, enabled);
            true
        } else {
            false
        }
    }

    fn set_stats_passive_number(
        &mut self,
        side: SandboxSide,
        passive_name: &str,
        value: f64,
    ) -> bool {
        let Some(def) = OVERRIDABLE_PASSIVE_ABILITIES
            .iter()
            .find(|d| d.matches_name(passive_name))
        else {
            return false;
        };
        if def.kind != PassiveAbilityKind::Number {
            return false;
        }
        if let Some(set) = def.set_number {
            let stats = self.stats_mut(side);
            set(stats, value);
            true
        } else {
            false
        }
    }

    /// Restore the side's per-side ability flags to the original config
    /// snapshot captured at construction time. Cross-side flags
    /// (`combat_event_order`, `compare_*` toggles, etc.) stay as-is.
    fn clear_config_overrides_for_side(&mut self, side: SandboxSide) {
        // Iterate the single-source-of-truth ABILITY_FLAGS table -
        // every entry knows how to read its baseline value out of
        // the snapshot AND write the live flag. Adding a new
        // ability to the override panel = one entry in
        // `OVERRIDABLE_ABILITY_FLAGS`; this loop picks it up
        // automatically.
        for def in OVERRIDABLE_ABILITY_FLAGS {
            let snap_val = match side {
                SandboxSide::A => (def.get_attacker)(&self.config_snapshot),
                SandboxSide::B => (def.get_defender)(&self.config_snapshot),
            };
            match side {
                SandboxSide::A => (def.set_attacker)(&mut self.config, snap_val),
                SandboxSide::B => (def.set_defender)(&mut self.config, snap_val),
            }
        }
        // Value-bearing abilities (number + string) restore from
        // snapshot via the same single-source-of-truth pattern.
        for def in OVERRIDABLE_ABILITY_VALUES {
            match def.kind {
                AbilityValueKind::Number => {
                    let getter = match side {
                        SandboxSide::A => def.get_attacker_number,
                        SandboxSide::B => def.get_defender_number,
                    };
                    let setter = match side {
                        SandboxSide::A => def.set_attacker_number,
                        SandboxSide::B => def.set_defender_number,
                    };
                    if let (Some(get), Some(set)) = (getter, setter) {
                        let snap = get(&self.config_snapshot);
                        set(&mut self.config, snap);
                    }
                }
                AbilityValueKind::String => {
                    let getter = match side {
                        SandboxSide::A => def.get_attacker_string,
                        SandboxSide::B => def.get_defender_string,
                    };
                    let setter = match side {
                        SandboxSide::A => def.set_attacker_string,
                        SandboxSide::B => def.set_defender_string,
                    };
                    if let (Some(get), Some(set)) = (getter, setter) {
                        let snap = get(&self.config_snapshot);
                        set(&mut self.config, snap);
                    }
                }
            }
        }
    }

    fn side_mut(&mut self, side: SandboxSide) -> &mut CombatSide {
        match side {
            SandboxSide::A => &mut self.loop_state.a,
            SandboxSide::B => &mut self.loop_state.b,
        }
    }

    fn stats(&self, side: SandboxSide) -> &SimpleCombatantStats {
        match side {
            SandboxSide::A => &self.attacker_stats,
            SandboxSide::B => &self.defender_stats,
        }
    }

    fn stats_mut(&mut self, side: SandboxSide) -> &mut SimpleCombatantStats {
        match side {
            SandboxSide::A => &mut self.attacker_stats,
            SandboxSide::B => &mut self.defender_stats,
        }
    }

    /// Disjoint-field mutable borrow of state + stats for the same side.
    /// Lets call sites like `arm_ability_for_side` read stats (for
    /// `active_cooldown_multiplier`) while mutating side state without
    /// fighting the borrow checker.
    fn side_and_stats_mut(
        &mut self,
        side: SandboxSide,
    ) -> (&mut CombatSide, &SimpleCombatantStats) {
        match side {
            SandboxSide::A => (&mut self.loop_state.a, &self.attacker_stats),
            SandboxSide::B => (&mut self.loop_state.b, &self.defender_stats),
        }
    }

    fn side(&self, side: SandboxSide) -> &CombatSide {
        match side {
            SandboxSide::A => &self.loop_state.a,
            SandboxSide::B => &self.loop_state.b,
        }
    }

    // ── View ──────────────────────────────────────────────────────────────

    /// Build the public projection. Stays JSON-stable for the TS side.
    pub fn snapshot_view(&self) -> SandboxView {
        SandboxView {
            time: self.loop_state.time.max(0.0),
            halted: self.halted,
            side_a: self.side_view(SandboxSide::A, "A"),
            side_b: self.side_view(SandboxSide::B, "B"),
            log: self
                .loop_state
                .combat_log
                .iter()
                .map(|entry| SandboxLogEntryView {
                    time: entry.time,
                    side: entry.attacker.clone(),
                    event_type: entry.entry_type.clone(),
                    description: entry.description.clone().unwrap_or_default(),
                })
                .collect(),
        }
    }

    fn side_view(&self, side: SandboxSide, label: &str) -> SandboxSideView {
        let s = self.side(side);
        let stats = self.stats(side);
        let breath = match side {
            SandboxSide::A => self.attacker_breath.as_ref(),
            SandboxSide::B => self.defender_breath.as_ref(),
        };
        let max_hp = stats.health.max(1.0);
        let breath_capacity_max = breath.map(|b| b.capacity).unwrap_or(0.0);
        let bite_ready = s.next_hit <= self.loop_state.time + 1e-9;
        let breath_ready = s.next_breath.is_finite() && s.next_breath <= self.loop_state.time + 1e-9;
        SandboxSideView {
            name: label.to_string(),
            max_hp,
            hp: s.hp.max(0.0),
            hp_pct: (s.hp.max(0.0) / max_hp * 100.0).clamp(0.0, 100.0),
            breath_capacity_left: s.breath_capacity.max(0.0),
            breath_capacity_max,
            breath_capacity_pct: if breath_capacity_max > 0.0 {
                (s.breath_capacity / breath_capacity_max * 100.0).clamp(0.0, 100.0)
            } else {
                0.0
            },
            // Clamp displayed `Next bite/breath at` to the current sim
            // time when the side hasn't yet acted (raw `next_hit` is the
            // initial 0 while `loop_state.time` has advanced from another
            // side's actions). Without clamping, the UI shows
            // "Next bite at: 0s" while current time is, say, 10.8s - which
            // reads as "fires at the past" instead of "ready right now".
            // Engine state itself stays untouched; force_bite still reads
            // the raw `next_hit` so the fire path is unchanged.
            next_hit_at: s.next_hit.max(self.loop_state.time),
            next_breath_at: if s.next_breath.is_finite() {
                Some(s.next_breath.max(self.loop_state.time))
            } else {
                None
            },
            bite_ready,
            breath_ready,
            bite_cooldown_left: (s.next_hit - self.loop_state.time).max(0.0),
            breath_cooldown_left: if s.next_breath.is_finite() {
                Some((s.next_breath - self.loop_state.time).max(0.0))
            } else {
                None
            },
            statuses: s
                .statuses
                .iter()
                .map(|(id, instance)| SandboxStatusView {
                    id: id.clone(),
                    stacks: instance.stacks,
                    remaining_sec: instance.remaining_sec,
                    next_tick_at: instance.next_tick_at,
                    next_decay_at: instance.next_decay_at,
                })
                .collect(),
            abilities: self.ability_views_for(side),
            death_time: s.death_time,
        }
    }

    /// Build the per-side ability list the deleted TS Sandbox surfaced under
    /// each Side State Card's "Manual abilities" subsection. Only abilities
    /// the side actually owns are included (presence detected via runtime /
    /// config flags). Each entry carries the same `cooldownLeft` /
    /// `actionLabel` / `ready` payload the old UI consumed so the buttons
    /// can flip between "Hunters Curse" / "Hunters Curse (12.5s)" / "Release
    /// Hunker" as state evolves.
    fn ability_views_for(&self, side: SandboxSide) -> Vec<SandboxAbilityView> {
        let stats = self.stats(side);
        let s = self.side(side);
        let now = self.loop_state.time.max(0.0);
        let is_a = matches!(side, SandboxSide::A);
        let cfg = &self.config;
        let mut out: Vec<SandboxAbilityView> = Vec::new();
        let mut push = |name: &str, action_label: String, cooldown_left: f64, ready: bool| {
            out.push(SandboxAbilityView {
                name: name.to_string(),
                action_label,
                cooldown_left: cooldown_left.max(0.0),
                ready,
            });
        };

        // Each ability is gated by a config flag (set by the build / overrides).
        // We mirror the deleted TS Sandbox's `buildAbilityList` shape: surface
        // only abilities the side has, with their natural cooldown / toggle
        // state. Self-Destruct is the one passive listed because the old UI
        // exposed an "is it armed?" indicator.

        // Fortify
        if (is_a && cfg.attacker_fortify) || (!is_a && cfg.defender_fortify) {
            let cd = (s.fortify_cooldown_until - now).max(0.0);
            push("Fortify", "Fortify".to_string(), cd, cd <= 1e-9);
        }
        // Hunker - toggle. "Release Hunker" when on. Always ready.
        if stats.hunker_reduction_pct > 0.0
            && ((is_a && cfg.attacker_hunker) || (!is_a && cfg.defender_hunker))
        {
            let label = if s.hunker_on { "Release Hunker" } else { "Hunker" };
            push("Hunker", label.to_string(), 0.0, true);
        }
        // Harden
        if (is_a && cfg.attacker_harden) || (!is_a && cfg.defender_harden) {
            let cd_until = s.harden_cooldown_until.max(s.harden_active_until);
            let cd = (cd_until - now).max(0.0);
            push("Harden", "Harden".to_string(), cd, cd <= 1e-9);
        }
        // Adrenaline
        if (is_a && cfg.attacker_adrenaline) || (!is_a && cfg.defender_adrenaline) {
            let active_until = s.adrenaline_active_until;
            let cd_until = s.adrenaline_cooldown_until.max(active_until);
            let cd = (cd_until - now).max(0.0);
            push("Adrenaline", "Adrenaline".to_string(), cd, cd <= 1e-9);
        }
        // Rewind
        if (is_a && cfg.attacker_rewind) || (!is_a && cfg.defender_rewind) {
            let cd = (s.rewind_cooldown_until - now).max(0.0);
            push("Rewind", "Rewind".to_string(), cd, cd <= 1e-9);
        }
        // Reflect
        if (is_a && cfg.attacker_reflect) || (!is_a && cfg.defender_reflect) {
            let cd_until = s.reflect_cooldown_until.max(s.reflect_active_until);
            let cd = (cd_until - now).max(0.0);
            push("Reflect", "Reflect".to_string(), cd, cd <= 1e-9);
        }
        // Life Leech - value-based active. The button must surface as soon as
        // the creature is configured to have Life Leech (life_leech_value > 0),
        // not only after the first activation. Mirrors Spite / Shadow Barrage /
        // Cursed Sigil below - the older `cooldown_until > 0 || active_until > 0`
        // gate hid the button on a fresh match because both fields are 0
        // until the first force-activation, making Life Leech un-clickable.
        let life_leech_value = if is_a {
            cfg.attacker_life_leech_value
        } else {
            cfg.defender_life_leech_value
        };
        if life_leech_value > 0.0 {
            let cd_until = s.life_leech_cooldown_until.max(s.life_leech_active_until);
            let cd = (cd_until - now).max(0.0);
            push("Life Leech", "Life Leech".to_string(), cd, cd <= 1e-9);
        }
        // Hunters Curse
        if (is_a && cfg.attacker_hunters_curse) || (!is_a && cfg.defender_hunters_curse) {
            let cd_until = s.hunters_curse_cooldown_until.max(s.hunters_curse_active_until);
            let cd = (cd_until - now).max(0.0);
            push("Hunters Curse", "Hunters Curse".to_string(), cd, cd <= 1e-9);
        }
        // Unbridled Rage
        if (is_a && cfg.attacker_unbridled_rage) || (!is_a && cfg.defender_unbridled_rage) {
            let cd_until = s.unbridled_rage_cooldown_until.max(s.unbridled_rage_active_until);
            let cd = (cd_until - now).max(0.0);
            push("Unbridled Rage", "Unbridled Rage".to_string(), cd, cd <= 1e-9);
        }
        // Warden Rage - toggle.
        if (is_a && cfg.attacker_warden_rage) || (!is_a && cfg.defender_warden_rage) {
            let label = if s.warden_rage_on { "Release Warden Rage" } else { "Warden Rage" };
            let cd = if s.warden_rage_on {
                0.0
            } else {
                (s.warden_rage_cooldown_until - now).max(0.0)
            };
            push("Warden Rage", label.to_string(), cd, s.warden_rage_on || cd <= 1e-9);
        }
        // Cocoon
        if (is_a && cfg.attacker_cocoon) || (!is_a && cfg.defender_cocoon) {
            let cd = (s.cocoon_cooldown_until - now).max(0.0);
            push("Cocoon", "Cocoon".to_string(), cd, cd <= 1e-9);
        }
        // Frost Nova
        if (is_a && cfg.attacker_frost_nova) || (!is_a && cfg.defender_frost_nova) {
            let cd = (s.frost_nova_cooldown_until - now).max(0.0);
            push("Frost Nova", "Frost Nova".to_string(), cd, cd <= 1e-9);
        }
        // Reflux
        if (is_a && cfg.attacker_reflux) || (!is_a && cfg.defender_reflux) {
            let cd_until = s
                .reflux_cooldown_until
                .max(s.reflux_puddle_until)
                .max(if s.reflux_armed { s.reflux_charge_ready_at } else { 0.0 });
            let cd = (cd_until - now).max(0.0);
            let label = if s.reflux_armed { "Reflux charging" } else { "Reflux" };
            push("Reflux", label.to_string(), cd, !s.reflux_armed && cd <= 1e-9);
        }
        // Totem
        if (is_a && cfg.attacker_totem) || (!is_a && cfg.defender_totem) {
            let cd = (s.totem_cooldown_until.max(s.totem_active_until) - now).max(0.0);
            push("Totem", "Totem".to_string(), cd, cd <= 1e-9);
        }
        // Thorn Trap
        if (is_a && cfg.attacker_thorn_trap) || (!is_a && cfg.defender_thorn_trap) {
            let cd = (s.thorn_trap_cooldown_until - now).max(0.0);
            push("Thorn Trap", "Thorn Trap".to_string(), cd, cd <= 1e-9);
        }
        // Toxic Trap
        if (is_a && cfg.attacker_toxic_trap) || (!is_a && cfg.defender_toxic_trap) {
            let cd = (s.toxic_trap_cooldown_until - now).max(0.0);
            push("Toxic Trap", "Toxic Trap".to_string(), cd, cd <= 1e-9);
        }
        // Frost Snare
        if (is_a && cfg.attacker_frost_snare) || (!is_a && cfg.defender_frost_snare) {
            let cd = (s.frost_snare_cooldown_until - now).max(0.0);
            push("Frost Snare", "Frost Snare".to_string(), cd, cd <= 1e-9);
        }
        // Poison Area
        if (is_a && cfg.attacker_poison_area) || (!is_a && cfg.defender_poison_area) {
            let cd = (s.poison_area_cooldown_until - now).max(0.0);
            push("Poison Area", "Poison Area".to_string(), cd, cd <= 1e-9);
        }
        // Yolk Bomb
        if (is_a && cfg.attacker_yolk_bomb) || (!is_a && cfg.defender_yolk_bomb) {
            let cd = (s.yolk_bomb_cooldown_until - now).max(0.0);
            push("Yolk Bomb", "Yolk Bomb".to_string(), cd, cd <= 1e-9);
        }
        // Divination
        if (is_a && cfg.attacker_divination) || (!is_a && cfg.defender_divination) {
            let cd = if s.divination_charges_left > 0 {
                0.0
            } else {
                (s.divination_cooldown_until - now).max(0.0)
            };
            push(
                "Divination",
                "Divination".to_string(),
                cd,
                s.divination_charges_left > 0 || cd <= 1e-9,
            );
        }
        // Drowsy Area
        if (is_a && cfg.attacker_drowsy_area) || (!is_a && cfg.defender_drowsy_area) {
            let cd = (s.drowsy_area_cooldown_until - now).max(0.0);
            push("Drowsy Area", "Drowsy Area".to_string(), cd, cd <= 1e-9);
        }
        // Cause Fear
        if (is_a && cfg.attacker_cause_fear) || (!is_a && cfg.defender_cause_fear) {
            let cd = (s.cause_fear_cooldown_until - now).max(0.0);
            push("Cause Fear", "Cause Fear".to_string(), cd, cd <= 1e-9);
        }
        // Grim Lariat
        if (is_a && cfg.attacker_grim_lariat) || (!is_a && cfg.defender_grim_lariat) {
            let cd = (s.grim_lariat_cooldown_until - now).max(0.0);
            push("Grim Lariat", "Grim Lariat".to_string(), cd, cd <= 1e-9);
        }
        // Lich Mark
        if (is_a && cfg.attacker_lich_mark) || (!is_a && cfg.defender_lich_mark) {
            let cd = (s.lich_mark_cooldown_until - now).max(0.0);
            push("Lich Mark", "Lich Mark".to_string(), cd, cd <= 1e-9);
        }
        // Spite
        let spite_value = if is_a {
            cfg.attacker_spite_value
        } else {
            cfg.defender_spite_value
        };
        if spite_value != 0.0 {
            let label = if s.spite_armed && s.spite_charge_ready_at <= now + 1e-9 {
                "Spite charged - Bite"
            } else if s.spite_armed {
                "Spite charging"
            } else {
                "Spite"
            };
            let cd = if s.spite_armed {
                (s.spite_charge_ready_at - now).max(0.0)
            } else {
                (s.spite_cooldown_until - now).max(0.0)
            };
            push("Spite", label.to_string(), cd, !s.spite_armed && cd <= 1e-9);
        }
        // Shadow Barrage
        let shadow_value = if is_a {
            cfg.attacker_shadow_barrage_value
        } else {
            cfg.defender_shadow_barrage_value
        };
        if shadow_value > 0.0 {
            let cd_until = s
                .shadow_barrage_cooldown_until
                .max(s.shadow_barrage_next_hit_at.unwrap_or(0.0));
            let cd = (cd_until - now).max(0.0);
            let ready = s.shadow_barrage_remaining_hits <= 0
                && s.shadow_barrage_next_hit_at.is_none()
                && cd <= 1e-9;
            push("Shadow Barrage", "Shadow Barrage".to_string(), cd, ready);
        }
        // Cursed Sigil
        let cursed_value = if is_a {
            cfg.attacker_cursed_sigil_stacks
        } else {
            cfg.defender_cursed_sigil_stacks
        };
        if cursed_value > 0.0 {
            let cd = (s.cursed_sigil_cooldown_until - now).max(0.0);
            push("Cursed Sigil", "Cursed Sigil".to_string(), cd, cd <= 1e-9);
        }
        // Self-Destruct - passive, surfaced as info-only entry.
        if stats.self_destruct_profile.is_some() {
            let label = if s.self_destruct_armed {
                "Self-Destruct armed"
            } else {
                "Self-Destruct"
            };
            let cd = (s.self_destruct_cooldown_until - now).max(0.0);
            push("Self-Destruct", label.to_string(), cd, false);
        }

        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn basic_stats(health: f64, damage: f64) -> SimpleCombatantStats {
        SimpleCombatantStats {
            health,
            weight: 100.0,
            damage,
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
            immune_status_ids: Vec::new(),
            hunker_reduction_pct: 0.0,
            self_destruct_profile: None,
            on_hit_statuses: Vec::new(),
            on_hit_taken_statuses: Vec::new(),
            starting_statuses: Vec::new(),
            status_resist_fractions: std::collections::BTreeMap::new(),
            plushie_status_block_fractions: std::collections::BTreeMap::new(),
            plushie_reflect_avg_pct: 0.0,
            disabled_abilities: Vec::new(),
            compare_air_rule_cooldown_sec: 0.0,
            user_ability_ids: Vec::new(),
            identity: None,
        }
    }

    #[test]
    fn sandbox_starts_at_full_hp_and_advances() {
        let attacker = basic_stats(500.0, 50.0);
        let defender = basic_stats(500.0, 50.0);
        let mut rt = SandboxRuntime::new(
            attacker,
            defender,
            None,
            None,
            ComposableAbilityConfig::default(),
            SimpleAbilityTimingMode::Ideal,
            SandboxAutomationMode::SemiAuto,
            120.0,
            false,
        );

        let view0 = rt.snapshot_view();
        assert!((view0.side_a.hp - 500.0).abs() < 1e-6);
        assert!((view0.side_b.hp - 500.0).abs() < 1e-6);
        assert!(!view0.halted);

        for _ in 0..50 {
            if rt.step_to_next_event() == SandboxStepResult::Halted {
                break;
            }
        }
        let view1 = rt.snapshot_view();
        assert!(view1.time > 0.0, "sim time should advance past 0");
    }

    #[test]
    fn apply_hp_and_status_take_effect() {
        let attacker = basic_stats(500.0, 50.0);
        let defender = basic_stats(500.0, 50.0);
        let mut rt = SandboxRuntime::new(
            attacker,
            defender,
            None,
            None,
            ComposableAbilityConfig::default(),
            SimpleAbilityTimingMode::Ideal,
            SandboxAutomationMode::SemiAuto,
            120.0,
            false,
        );

        rt.apply_hp(SandboxSide::A, 100.0);
        rt.apply_status(SandboxSide::B, "Poison_Status", 5.0);
        let view = rt.snapshot_view();
        assert!((view.side_a.hp - 100.0).abs() < 1e-6);
        let poison = view
            .side_b
            .statuses
            .iter()
            .find(|s| s.id == "Poison_Status")
            .expect("Poison_Status should be on side B");
        assert!((poison.stacks - 5.0).abs() < 1e-6);
    }

    fn build_manual_sandbox(hp: f64, dmg: f64) -> Box<SandboxRuntime> {
        SandboxRuntime::new(
            basic_stats(hp, dmg),
            basic_stats(hp, dmg),
            None,
            None,
            ComposableAbilityConfig::default(),
            SimpleAbilityTimingMode::Ideal,
            SandboxAutomationMode::Manual,
            120.0,
            false,
        )
    }

    /// Tier 2 override - `override_stat("health", value)` must rewrite max HP
    /// and clamp the current HP into the new envelope. Regression guard for
    /// the UI bug where the dropdown sent `health_regen` instead of `health`.
    #[test]
    fn override_stat_health_resets_max_and_clamps_hp() {
        let mut rt = build_manual_sandbox(1000.0, 50.0);
        // Side A starts at 1000 HP (Manual init = full HP).
        rt.override_stat(SandboxSide::A, "health", 500.0);
        let view = rt.snapshot_view();
        assert!((view.side_a.max_hp - 500.0).abs() < 1e-6);
        assert!((view.side_a.hp - 500.0).abs() < 1e-6, "current HP should clamp into new max");
    }

    #[test]
    fn override_stat_damage_is_direct_write() {
        let mut rt = build_manual_sandbox(1000.0, 50.0);
        rt.override_stat(SandboxSide::A, "damage", 777.0);
        // The damage override writes `stats.damage` directly so the next
        // step uses the new value verbatim - no `modifier.damage` extras
        // that would have added on top of the base.
        assert!((rt.stats(SandboxSide::A).damage - 777.0).abs() < 1e-6);
    }

    /// Tier 2 override - Set then Clear restores from the snapshot.
    #[test]
    fn clear_overrides_restores_baseline_stats() {
        let mut rt = build_manual_sandbox(1000.0, 50.0);
        rt.override_stat(SandboxSide::A, "damage", 777.0);
        rt.override_stat(SandboxSide::A, "bite_cooldown", 10.0);
        rt.clear_overrides(SandboxSide::A);
        let stats = rt.stats(SandboxSide::A);
        assert!((stats.damage - 50.0).abs() < 1e-6, "damage restored to baseline");
        assert!((stats.bite_cooldown - 2.0).abs() < 1e-6, "bite_cooldown restored");
    }

    /// Tier 2 override - `override_resist` adds a per-status fraction.
    #[test]
    fn override_resist_then_clear() {
        let mut rt = build_manual_sandbox(1000.0, 50.0);
        rt.override_resist(SandboxSide::A, "Bleed_Status", 0.5);
        let stats = rt.stats(SandboxSide::A);
        assert_eq!(stats.status_resist_fractions.get("Bleed_Status").copied(), Some(0.5));
        rt.clear_overrides(SandboxSide::A);
        assert!(!rt
            .stats(SandboxSide::A)
            .status_resist_fractions
            .contains_key("Bleed_Status"));
    }

    /// Tier 2 override - `override_offensive_status` adds an on-hit status.
    #[test]
    fn override_offensive_status_appears_in_on_hit_list() {
        let mut rt = build_manual_sandbox(1000.0, 50.0);
        rt.override_offensive_status(SandboxSide::A, "Burn_Status", 3.0);
        let stats = rt.stats(SandboxSide::A);
        assert!(
            stats
                .on_hit_statuses
                .iter()
                .any(|s| s.status_id == "Burn_Status" && (s.stacks - 3.0).abs() < 1e-6),
            "Burn_Status entry should be present with 3 stacks",
        );
    }

    /// Tier 2 override - `override_defensive_status` adds an on-hit-taken status.
    #[test]
    fn override_defensive_status_appears_in_on_hit_taken_list() {
        let mut rt = build_manual_sandbox(1000.0, 50.0);
        rt.override_defensive_status(SandboxSide::A, "Poison_Status", 2.0);
        let stats = rt.stats(SandboxSide::A);
        assert!(
            stats
                .on_hit_taken_statuses
                .iter()
                .any(|s| s.status_id == "Poison_Status" && (s.stacks - 2.0).abs() < 1e-6),
            "Poison_Status entry should be present on hit-taken with 2 stacks",
        );
    }

    /// Tier 2 override - `override_ability` flips the per-side config flag.
    #[test]
    fn override_ability_toggles_config_flag() {
        let mut rt = build_manual_sandbox(1000.0, 50.0);
        let recognised = rt.override_ability(SandboxSide::A, "Reflect", true);
        assert!(recognised, "Reflect is a known ability flag");
        assert!(rt.config.attacker_reflect);
        rt.clear_overrides(SandboxSide::A);
        // After clear the snapshot value is restored (default = false).
        assert!(!rt.config.attacker_reflect);
    }

    /// Status time-advance - applying a 10-stack poison and stepping to
    /// `target_time = 10` must tick the DOT three times (t = 3, 6, 9),
    /// decay three stacks, and land exactly on `time = 10` (not overshoot
    /// to t = 12 like the pre-2026-05-12 bounded-step bug did).
    #[test]
    fn manual_status_advances_within_bound() {
        let mut rt = build_manual_sandbox(2000.0, 50.0);
        rt.apply_status(SandboxSide::B, "Poison_Status", 10.0);
        let hp_b_before = rt.side(SandboxSide::B).hp;
        rt.step_to_time(10.0);
        let view = rt.snapshot_view();
        assert!((view.time - 10.0).abs() < 1e-6, "time lands exactly on 10s, got {}", view.time);
        let poison = view
            .side_b
            .statuses
            .iter()
            .find(|s| s.id == "Poison_Status")
            .expect("Poison still present at t=10");
        assert!((poison.stacks - 7.0).abs() < 1e-6, "10 → 7 stacks (3 decays)");
        let hp_b_after = rt.side(SandboxSide::B).hp;
        assert!(hp_b_after < hp_b_before, "DOT should have applied damage");
    }

    /// Force-ability - clicking Reflect at t=0 must set both
    /// `reflect_active_until` and `reflect_cooldown_until` directly (no
    /// engine step needed). Regression guard for the pre-2026-05-12 bug
    /// where the arm only set `active_until` and the cooldown stayed at 0.
    #[test]
    fn force_ability_reflect_sets_active_and_cooldown() {
        let mut rt = build_manual_sandbox(1000.0, 50.0);
        rt.config.attacker_reflect = true;
        let recognised = rt.force_ability(SandboxSide::A, "Reflect");
        assert!(recognised);
        let s = rt.side(SandboxSide::A);
        assert!(s.reflect_active_until > 0.0, "active window set");
        assert!(s.reflect_cooldown_until > 0.0, "cooldown set");
        assert!(s.reflect_cooldown_until > s.reflect_active_until, "cd outlasts active window");
    }

    /// Regression guard for the pre-fix bug: Sandbox `force_ability("Cause
    /// Fear")` set ONLY a cooldown (and the wrong value, 60 s instead of
    /// 120 s) and never applied Fear_Status to the opponent. Worse, the
    /// future-set cooldown blocked the engine's natural firing branch in
    /// `phases::process_phase_4_misc_and_cocoon_cluster` (gate
    /// `time >= cause_fear_cooldown_until` evaluated false), so the
    /// status never landed on subsequent steps either. After the fix
    /// the click delegates to `phases::apply_cause_fear_effect`, the
    /// shared helper with the engine path.
    #[test]
    fn force_ability_cause_fear_applies_10_fear_and_120s_cooldown() {
        let mut rt = build_manual_sandbox(1000.0, 50.0);
        rt.config.attacker_cause_fear = true;
        let recognised = rt.force_ability(SandboxSide::A, "Cause Fear");
        assert!(recognised, "Cause Fear must be recognised");
        let view = rt.snapshot_view();
        let fear = view
            .side_b
            .statuses
            .iter()
            .find(|s| s.id == "Fear_Status")
            .expect("Cause Fear must apply Fear_Status to opponent");
        assert!(
            (fear.stacks - 10.0).abs() < 1e-6,
            "Cause Fear applies 10 stacks, got {}",
            fear.stacks
        );
        let s = rt.side(SandboxSide::A);
        assert!(
            (s.cause_fear_cooldown_until - 120.0).abs() < 1e-6,
            "Cause Fear cooldown must be 120s (reference spec), got {}",
            s.cause_fear_cooldown_until
        );
    }

    /// Regression guard: pre-fix `force_ability("Grim Lariat")` set a
    /// 30 s cooldown (reference is 60 s) and skipped the damage burst +
    /// Heartbroken_Status application. After the fix the manual click
    /// uses the shared `phases::apply_grim_lariat_effect`.
    #[test]
    fn force_ability_grim_lariat_applies_damage_heartbroken_and_60s_cooldown() {
        let mut rt = build_manual_sandbox(1000.0, 50.0);
        rt.config.attacker_grim_lariat = true;
        let hp_b_before = rt.side(SandboxSide::B).hp;
        let recognised = rt.force_ability(SandboxSide::A, "Grim Lariat");
        assert!(recognised, "Grim Lariat must be recognised");
        let hp_b_after = rt.side(SandboxSide::B).hp;
        // attacker damage 50 × 0.5 = 25 → defender HP drops by 25.
        assert!(
            (hp_b_before - hp_b_after - 25.0).abs() < 1e-6,
            "Grim Lariat deals 0.5x attacker damage = 25 HP, got {} → {}",
            hp_b_before,
            hp_b_after
        );
        let view = rt.snapshot_view();
        let heartbroken = view
            .side_b
            .statuses
            .iter()
            .find(|s| s.id == "Heartbroken_Status")
            .expect("Grim Lariat must apply Heartbroken_Status");
        assert!(
            (heartbroken.stacks - 8.0).abs() < 1e-6,
            "Grim Lariat applies 8 stacks Heartbroken, got {}",
            heartbroken.stacks
        );
        let s = rt.side(SandboxSide::A);
        assert!(
            (s.grim_lariat_cooldown_until - 60.0).abs() < 1e-6,
            "Grim Lariat cooldown must be 60s, got {}",
            s.grim_lariat_cooldown_until
        );
    }

    /// Regression guard: pre-fix `force_ability("Cursed Sigil")` set a
    /// 30 s cooldown (reference is 85 s) and skipped applying Bad_Omen.
    /// After the fix the manual click uses the shared
    /// `phases::apply_cursed_sigil_effect` with the same
    /// `config.X_cursed_sigil_stacks` gate as the engine path.
    #[test]
    fn force_ability_cursed_sigil_applies_bad_omen_and_85s_cooldown() {
        let mut rt = build_manual_sandbox(1000.0, 50.0);
        rt.config.attacker_cursed_sigil_stacks = 5.0;
        let recognised = rt.force_ability(SandboxSide::A, "Cursed Sigil");
        assert!(recognised, "Cursed Sigil must be recognised");
        let view = rt.snapshot_view();
        let bad_omen = view
            .side_b
            .statuses
            .iter()
            .find(|s| s.id == "Bad_Omen")
            .expect("Cursed Sigil must apply Bad_Omen");
        assert!(
            (bad_omen.stacks - 5.0).abs() < 1e-6,
            "Cursed Sigil applies config-valued stacks (5), got {}",
            bad_omen.stacks
        );
        let s = rt.side(SandboxSide::A);
        assert!(
            (s.cursed_sigil_cooldown_until - 85.0).abs() < 1e-6,
            "Cursed Sigil cooldown must be 85s, got {}",
            s.cursed_sigil_cooldown_until
        );
    }

    /// Regression guard: pre-fix `force_ability("Drowsy Area")` set the
    /// correct 60 s cooldown but never applied Drowsy_Status. After the
    /// fix the manual click uses the shared
    /// `phases::apply_drowsy_area_effect`.
    #[test]
    fn force_ability_drowsy_area_applies_5_drowsy_and_60s_cooldown() {
        let mut rt = build_manual_sandbox(1000.0, 50.0);
        rt.config.attacker_drowsy_area = true;
        let recognised = rt.force_ability(SandboxSide::A, "Drowsy Area");
        assert!(recognised, "Drowsy Area must be recognised");
        let view = rt.snapshot_view();
        let drowsy = view
            .side_b
            .statuses
            .iter()
            .find(|s| s.id == "Drowsy_Status")
            .expect("Drowsy Area must apply Drowsy_Status");
        assert!(
            (drowsy.stacks - 5.0).abs() < 1e-6,
            "Drowsy Area applies 5 stacks Drowsy, got {}",
            drowsy.stacks
        );
        let s = rt.side(SandboxSide::A);
        assert!(
            (s.drowsy_area_cooldown_until - 60.0).abs() < 1e-6,
            "Drowsy Area cooldown must be 60s, got {}",
            s.drowsy_area_cooldown_until
        );
    }

    /// Value override (number) - `override_ability_number("Cursed Sigil",
    /// 5)` must write the f64 field on the right side and return
    /// `recognised = true`. Unknown names return `false` without mutating
    /// state.
    #[test]
    fn override_ability_number_cursed_sigil_writes_config_field() {
        let mut rt = build_manual_sandbox(1000.0, 50.0);
        assert!(rt.config.attacker_cursed_sigil_stacks.abs() < 1e-12, "starts at 0");
        let recognised = rt.override_ability_number(SandboxSide::A, "Cursed Sigil", 5.0);
        assert!(recognised, "Cursed Sigil must be recognised");
        assert!(
            (rt.config.attacker_cursed_sigil_stacks - 5.0).abs() < 1e-9,
            "value written into attacker_cursed_sigil_stacks, got {}",
            rt.config.attacker_cursed_sigil_stacks
        );
        // Defender stays untouched.
        assert!(rt.config.defender_cursed_sigil_stacks.abs() < 1e-12);
    }

    /// Value override (number) - unknown name returns false without
    /// mutating any field. Defender-side write hits the defender field
    /// only.
    #[test]
    fn override_ability_number_rejects_unknown_and_routes_per_side() {
        let mut rt = build_manual_sandbox(1000.0, 50.0);
        assert!(!rt.override_ability_number(SandboxSide::A, "Made-Up Ability", 1.0));
        assert!(!rt.override_ability_number(SandboxSide::A, "Fortify", 1.0),
            "bool-only ability must NOT accept a number override");
        let ok = rt.override_ability_number(SandboxSide::B, "Life Leech", 0.25);
        assert!(ok);
        assert!(rt.config.attacker_life_leech_value.abs() < 1e-12, "attacker untouched");
        assert!((rt.config.defender_life_leech_value - 0.25).abs() < 1e-9);
    }

    /// Value override (string) - Lich Mark's string payload writes
    /// through to the right config field AND auto-enables the bool
    /// activation gate, mirroring the custom-creature picker UX
    /// (attaching the ability implicitly enables it). Clearing the
    /// payload disables the bool too.
    #[test]
    fn override_ability_string_lich_mark_auto_enables_bool_gate() {
        let mut rt = build_manual_sandbox(1000.0, 50.0);
        assert!(rt.config.attacker_lich_mark_payload_status_id.is_none(), "starts unset");
        assert!(!rt.config.attacker_lich_mark, "starts off");
        let recognised = rt.override_ability_string(
            SandboxSide::A,
            "Lich Mark",
            Some("Bad Omen".to_string()),
        );
        assert!(recognised);
        assert_eq!(rt.config.attacker_lich_mark_payload_status_id.as_deref(), Some("Bad Omen"));
        assert!(rt.config.attacker_lich_mark, "bool gate auto-enabled on payload set");
        // Clearing with None drops the payload and the bool gate.
        let cleared = rt.override_ability_string(SandboxSide::A, "Lich Mark", None);
        assert!(cleared);
        assert!(rt.config.attacker_lich_mark_payload_status_id.is_none());
        assert!(!rt.config.attacker_lich_mark, "bool gate cleared on payload clear");
    }

    /// Passive override (bool) - toggling Berserk writes the spec
    /// standard thresholds onto the side's stats (HP < 20% activation,
    /// 0.5x bite-cooldown multiplier). Toggling off zeroes the
    /// activation gate.
    #[test]
    fn override_passive_bool_berserk_writes_spec_standards() {
        let mut rt = build_manual_sandbox(1000.0, 50.0);
        assert!(rt.stats(SandboxSide::A).berserk_hp_ratio_threshold.abs() < 1e-12);
        let recognised = rt.override_passive_bool(SandboxSide::A, "Berserk", true);
        assert!(recognised);
        let s = rt.stats(SandboxSide::A);
        assert!((s.berserk_hp_ratio_threshold - 0.20).abs() < 1e-9, "20% HP gate");
        assert!((s.berserk_bite_cooldown_multiplier - 0.5).abs() < 1e-9, "0.5x bite CD");
        // Toggle off.
        rt.override_passive_bool(SandboxSide::A, "Berserk", false);
        let s = rt.stats(SandboxSide::A);
        assert!(s.berserk_hp_ratio_threshold.abs() < 1e-12);
        assert!((s.berserk_bite_cooldown_multiplier - 1.0).abs() < 1e-9, "back to 1.0x default");
    }

    /// Passive override (number) - First Strike's listed value is the
    /// per-creature exception; toggling it sets `first_strike_pct`
    /// directly AND fixes the activation threshold at the spec-
    /// standard 75% so changing the value alone doesn't drift the
    /// gate.
    #[test]
    fn override_passive_number_first_strike_writes_pct_and_fixes_threshold() {
        let mut rt = build_manual_sandbox(1000.0, 50.0);
        let recognised = rt.override_passive_number(SandboxSide::A, "First Strike", 0.25);
        assert!(recognised);
        let s = rt.stats(SandboxSide::A);
        assert!((s.first_strike_pct - 0.25).abs() < 1e-9);
        assert!((s.first_strike_hp_ratio_threshold - 0.75).abs() < 1e-9, "75% gate fixed");
    }

    /// Cross-kind dispatch - calling the number method with a Bool-
    /// kind passive (or vice versa) must return false without
    /// mutating stats.
    #[test]
    fn override_passive_rejects_kind_mismatch_and_unknown_names() {
        let mut rt = build_manual_sandbox(1000.0, 50.0);
        assert!(!rt.override_passive_number(SandboxSide::A, "Berserk", 0.5),
            "Berserk is Bool-kind, number override must be rejected");
        assert!(!rt.override_passive_bool(SandboxSide::A, "First Strike", true),
            "First Strike is Number-kind, bool override must be rejected");
        assert!(!rt.override_passive_bool(SandboxSide::A, "Made-Up", true));
        // Stats unchanged.
        assert!(rt.stats(SandboxSide::A).berserk_hp_ratio_threshold.abs() < 1e-12);
        assert!(rt.stats(SandboxSide::A).first_strike_pct.abs() < 1e-12);
    }

    /// `clear_overrides` must roll value fields back to the construction
    /// snapshot, matching the bool-flag restore behavior.
    #[test]
    fn clear_overrides_restores_value_fields_to_snapshot() {
        let mut rt = build_manual_sandbox(1000.0, 50.0);
        rt.override_ability_number(SandboxSide::A, "Cursed Sigil", 7.0);
        rt.override_ability_string(
            SandboxSide::A,
            "Aura",
            Some("Disease".to_string()),
        );
        rt.clear_overrides(SandboxSide::A);
        assert!(rt.config.attacker_cursed_sigil_stacks.abs() < 1e-12, "number restored");
        assert!(rt.config.attacker_aura_subtype.is_none(), "string restored");
    }

    // ─── Property-style invariants ────────────────────────────────────────
    //
    // No `proptest` / `quickcheck` dep - deterministic parameter sweep
    // covers the same ground for the engine surface we care about.
    // Invariants checked against every combination in the sweep:
    //   I1: time is monotone non-decreasing across step_to_next_event calls
    //   I2: HP stays in [0, max_hp] regardless of damage / overrides
    //   I3: A fully-decayed status disappears from the side's status map
    //   I4: clear_overrides + apply_status are idempotent w.r.t. baseline
    //   I5: force_ability for a recognised name leaves the side's
    //       ability_X_cooldown_until strictly greater than `now` (or sets
    //       an armed flag) - no "ability fired but cooldown didn't move"

    fn sweep_stats() -> Vec<(f64, f64)> {
        // Mid-range health/damage pairs the engine handles smoothly.
        // Edge values (1.0 HP, 100 000 HP) trigger different fast-paths
        // we want to exercise.
        vec![
            (100.0, 10.0),
            (500.0, 50.0),
            (1000.0, 100.0),
            (5000.0, 250.0),
            (100_000.0, 1000.0),
        ]
    }

    #[test]
    fn property_time_monotone_under_repeated_steps() {
        // I1: stepping never moves time backwards.
        for (hp, dmg) in sweep_stats() {
            let mut rt = build_manual_sandbox(hp, dmg);
            rt.apply_status(SandboxSide::B, "Poison_Status", 5.0);
            let mut last_time = rt.snapshot_view().time;
            for _ in 0..30 {
                rt.step_to_next_event();
                let now = rt.snapshot_view().time;
                assert!(
                    now >= last_time - 1e-9,
                    "time regressed: {now} < {last_time} (hp={hp}, dmg={dmg})"
                );
                last_time = now;
                if rt.snapshot_view().halted {
                    break;
                }
            }
        }
    }

    #[test]
    fn property_hp_stays_in_bounds() {
        // I2: HP stays in [0, max_hp] regardless of damage / step count /
        // overrides. Sweep damage * status combos that could blow HP past
        // its envelope if the engine misclamps.
        for (hp, dmg) in sweep_stats() {
            let mut rt = build_manual_sandbox(hp, dmg);
            rt.apply_status(SandboxSide::A, "Poison_Status", 10.0);
            rt.apply_status(SandboxSide::B, "Bleed_Status", 10.0);
            for _ in 0..60 {
                rt.step_to_next_event();
                let view = rt.snapshot_view();
                assert!(
                    view.side_a.hp >= -1e-9 && view.side_a.hp <= view.side_a.max_hp + 1e-9,
                    "A HP out of [0, {}]: {}", view.side_a.max_hp, view.side_a.hp
                );
                assert!(
                    view.side_b.hp >= -1e-9 && view.side_b.hp <= view.side_b.max_hp + 1e-9,
                    "B HP out of [0, {}]: {}", view.side_b.max_hp, view.side_b.hp
                );
                if view.halted {
                    break;
                }
            }
        }
    }

    /// Repro: Venuella vs Venuella in Manual mode reportedly halts the
    /// sandbox clock once the user applies a status manually. The mirror
    /// matchup carries both `attacker_toxic_trap=true` and
    /// `defender_toxic_trap=true` plus `attacker_reflux=true` and
    /// `defender_reflux=true` on the config, which feed
    /// `has_any_toxic_trap` / `has_any_active_ability` into the scheduler.
    ///
    /// The test sets up the same shape: mirror creature with health_regen
    /// = 4 (next_regen = 15 s scheduled at start), no breath, manual
    /// automation. After applying Burn (3-tick cadence) to B, we step a
    /// dozen events and assert (a) time advances at all and (b) at least
    /// one Burn tick lands.
    #[test]
    fn manual_mirror_with_toxic_trap_flags_keeps_clock_moving() {
        let mut stats = basic_stats(9500.0, 320.0);
        stats.health_regen = 4.0;
        stats.weight = 45_000.0;
        stats.bite_cooldown = 1.0;
        let mut config = ComposableAbilityConfig::default();
        config.attacker_toxic_trap = true;
        config.defender_toxic_trap = true;
        config.attacker_reflux = true;
        config.defender_reflux = true;
        let mut rt = SandboxRuntime::new(
            stats.clone(),
            stats,
            None,
            None,
            config,
            SimpleAbilityTimingMode::Ideal,
            SandboxAutomationMode::Manual,
            300.0,
            false,
        );
        rt.apply_status(SandboxSide::B, "Burn_Status", 3.0);
        // Step through ~20 events and track the minimum HP B ever has.
        // Burn ticks at t=3, 6, 9 ought to bring B below max before regen
        // at t=15 restores it. The test fails when the scheduler was
        // stuck micro-advancing (B HP never moved off 9500).
        let mut b_min_hp = rt.snapshot_view().side_b.hp;
        let mut t_max = rt.snapshot_view().time;
        for _ in 0..20 {
            rt.step_to_next_event();
            let v = rt.snapshot_view();
            b_min_hp = b_min_hp.min(v.side_b.hp);
            t_max = t_max.max(v.time);
            if v.halted {
                break;
            }
        }
        assert!(
            t_max > 9.0,
            "sandbox clock must reach the 3rd Burn tick (t=9 s); stalled at t={t_max}"
        );
        assert!(
            b_min_hp < 9500.0 - 1e-9,
            "Burn should have dealt at least one tick worth of damage; B min HP across the run was {b_min_hp}"
        );
    }

    /// Diagnostic: does Toxic Trap actually fire in Sandbox SemiAuto mode
    /// with both sides Venuella-shaped (config flag set)? User reports it
    /// "doesn't apply effectively, no effect". If the trap fires at t=0
    /// and ticks Poison every 3 s, B should accumulate Poison stacks and
    /// take meaningful damage in the first ~30 seconds.
    #[test]
    fn semi_auto_mirror_with_toxic_trap_actually_applies_poison() {
        let mut stats = basic_stats(9500.0, 320.0);
        stats.health_regen = 4.0;
        stats.weight = 45_000.0;
        stats.bite_cooldown = 1.0;
        let mut config = ComposableAbilityConfig::default();
        config.attacker_toxic_trap = true;
        config.defender_toxic_trap = true;
        let mut rt = SandboxRuntime::new(
            stats.clone(),
            stats,
            None,
            None,
            config,
            SimpleAbilityTimingMode::Ideal,
            SandboxAutomationMode::SemiAuto,
            120.0,
            true,
        );
        // Step ~10 seconds - by then both traps should have fired at t=0
        // and emitted at least 3 Poison ticks (t=3, 6, 9).
        rt.step_to_time(10.0);
        let view = rt.snapshot_view();
        let b_poison = view
            .side_b
            .statuses
            .iter()
            .find(|s| s.id == "Poison_Status")
            .map(|s| s.stacks)
            .unwrap_or(0.0);
        eprintln!("at t=10: B Poison stacks = {b_poison}, B hp = {}", view.side_b.hp);
        // Toxic Trap fires at t=0 on side A, applies 5 stacks Poison to B
        // every 3 s. Even with natural decay (~1 stack/3s) B should have
        // visible Poison present.
        assert!(
            b_poison > 0.0,
            "Toxic Trap on A should have applied Poison to B by t=10s; got 0 stacks"
        );
    }

    #[test]
    fn property_fully_decayed_status_removed() {
        // I3: stepping past a status' lifetime removes it from the map.
        // Poison default duration = 3s * stacks → 30s for 10 stacks.
        let mut rt = build_manual_sandbox(2000.0, 50.0);
        rt.apply_status(SandboxSide::B, "Poison_Status", 10.0);
        rt.step_to_time(40.0);
        let view = rt.snapshot_view();
        assert!(
            view.side_b.statuses.iter().all(|s| s.id != "Poison_Status"),
            "Poison should have fully decayed by t=40s, statuses still present: {:?}",
            view.side_b.statuses.iter().map(|s| &s.id).collect::<Vec<_>>(),
        );
    }

    #[test]
    fn property_clear_overrides_restores_baseline() {
        // I4: override → clear should restore stats to the pre-override
        // snapshot. Repeated cycles should also be idempotent.
        let mut rt = build_manual_sandbox(1000.0, 50.0);
        let baseline = (
            rt.stats(SandboxSide::A).damage,
            rt.stats(SandboxSide::A).bite_cooldown,
            rt.stats(SandboxSide::A).weight,
        );
        for _ in 0..3 {
            rt.override_stat(SandboxSide::A, "damage", 777.0);
            rt.override_stat(SandboxSide::A, "bite_cooldown", 0.5);
            rt.override_stat(SandboxSide::A, "weight", 9999.0);
            rt.clear_overrides(SandboxSide::A);
            let stats = rt.stats(SandboxSide::A);
            assert!((stats.damage - baseline.0).abs() < 1e-6);
            assert!((stats.bite_cooldown - baseline.1).abs() < 1e-6);
            assert!((stats.weight - baseline.2).abs() < 1e-6);
        }
    }

    #[test]
    fn property_force_ability_advances_cooldown() {
        // I5: a successful force_ability on a recognised name must leave
        // **some** visible after-state - either a cooldown_until in the
        // future or an armed flag. Anti-regression for the "click did
        // nothing visible" class of bugs.
        let mut rt = build_manual_sandbox(1000.0, 50.0);
        rt.config.attacker_reflect = true;
        rt.config.attacker_adrenaline = true;
        rt.config.attacker_harden = true;
        rt.config.attacker_fortify = true;

        #[allow(clippy::type_complexity)] // one-off test table; a type alias is heavier than the inline type
        let cases: &[(&str, fn(&CombatSide) -> bool)] = &[
            ("Reflect", |s: &CombatSide| s.reflect_cooldown_until > 0.0),
            ("Adrenaline", |s: &CombatSide| s.adrenaline_cooldown_until > 0.0),
            ("Harden", |s: &CombatSide| s.harden_cooldown_until > 0.0),
            ("Fortify", |s: &CombatSide| s.fortify_cooldown_until > 0.0),
        ];
        for (name, check) in cases {
            // Fresh sandbox so each ability tests in isolation.
            let mut rt = build_manual_sandbox(1000.0, 50.0);
            rt.config.attacker_reflect = true;
            rt.config.attacker_adrenaline = true;
            rt.config.attacker_harden = true;
            rt.config.attacker_fortify = true;
            assert!(
                rt.force_ability(SandboxSide::A, name),
                "{name} should be recognised"
            );
            assert!(
                check(rt.side(SandboxSide::A)),
                "{name} did not leave a cooldown-after-state"
            );
        }
    }

    /// Live driver and sandbox SemiAuto must produce byte-identical
    /// outcomes for a representative matchup with regen + DoT-eligible
    /// bites + breath. Anti-regression for the shared `loop_iter`
    /// extraction: any divergence here means the migration broke
    /// parity with the production engine.
    #[test]
    fn semi_auto_sandbox_matches_live_driver_byte_identical() {
        use super::super::reference_tests::default_combatant;
        use super::super::simulate_composable_matchup_with_trace;

        let mut attacker = default_combatant();
        attacker.health = 8000.0;
        attacker.damage = 120.0;
        attacker.bite_cooldown = 1.2;
        attacker.health_regen = 8.0;
        attacker.weight = 3000.0;
        let mut defender = default_combatant();
        defender.health = 7000.0;
        defender.damage = 100.0;
        defender.bite_cooldown = 1.5;
        defender.health_regen = 6.0;
        defender.weight = 2800.0;
        let config = ComposableAbilityConfig::default();
        let max_time = 90.0;

        // Live driver run.
        let live = simulate_composable_matchup_with_trace(
            &attacker,
            &defender,
            None,
            None,
            SimpleAbilityTimingMode::Fast,
            &config,
            max_time,
            true,
        );

        // Sandbox SemiAuto run, drained to completion.
        let mut sandbox = SandboxRuntime::new(
            attacker.clone(),
            defender.clone(),
            None,
            None,
            config.clone(),
            SimpleAbilityTimingMode::Fast,
            SandboxAutomationMode::SemiAuto,
            max_time,
            true,
        );
        while !sandbox.halted {
            let _ = sandbox.step_to_next_event();
        }

        assert_eq!(sandbox.loop_state.a.death_time, live.death_time_a);
        assert_eq!(sandbox.loop_state.b.death_time, live.death_time_b);
        // `final_hp_*` on the summary normalises a dead side to 0.0
        // (mod.rs:1297-1298); the engine-internal HP stays pinned at 1
        // post-death. Compare on the same normalised projection so the
        // parity test exercises the engine math, not the summary
        // post-processing rules.
        let sandbox_final_hp_a = if sandbox.loop_state.a.death_time.is_some() {
            0.0
        } else {
            sandbox.loop_state.a.hp.max(0.0)
        };
        let sandbox_final_hp_b = if sandbox.loop_state.b.death_time.is_some() {
            0.0
        } else {
            sandbox.loop_state.b.hp.max(0.0)
        };
        assert!(
            (sandbox_final_hp_a - live.final_hp_a).abs() < 1e-6,
            "side-A HP: sandbox={} live={}",
            sandbox_final_hp_a,
            live.final_hp_a,
        );
        assert!(
            (sandbox_final_hp_b - live.final_hp_b).abs() < 1e-6,
            "side-B HP: sandbox={} live={}",
            sandbox_final_hp_b,
            live.final_hp_b,
        );
        assert!(
            (sandbox.loop_state.counters.dealt_a - live.damage_dealt_a).abs() < 1e-6,
            "damage A: sandbox={} live={}",
            sandbox.loop_state.counters.dealt_a,
            live.damage_dealt_a,
        );
        assert!(
            (sandbox.loop_state.counters.dealt_b - live.damage_dealt_b).abs() < 1e-6,
            "damage B: sandbox={} live={}",
            sandbox.loop_state.counters.dealt_b,
            live.damage_dealt_b,
        );
    }
}
