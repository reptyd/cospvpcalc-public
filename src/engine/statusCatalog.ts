//! Single source of truth for the status pickers across the site.
//!
//! Pickers that previously kept their own hand-maintained list
//! (Lich Mark payload dropdown, Yolk Bomb value dropdown, the
//! Custom-Creatures status picker, …) now read this catalog. Adding
//! a new status means:
//!
//! 1. Add a Reference entry to `referenceContent.ts` under
//!    `STATUS_REFERENCE_DRAFTS` with `status: "Modeled" | "Partial"`.
//! 2. Add one row to `NAME_TO_ENGINE_ID` below mapping the
//!    Reference display name to the engine's `*_Status` id.
//!
//! After that the status appears in every picker automatically —
//! no per-picker edits, no curated arrays drifting from the Reference
//! catalog, no "13 options in Lich Mark but 31 in Custom Creatures"
//! inconsistency that the user reported on 2026-05-18.
//!
//! Entries with `status: "Out of model" | "Not modeled yet" | …`
//! are deliberately excluded — picking them in the UI would let the
//! user configure something the engine can't simulate.

import {
  STATUS_REFERENCE_DRAFTS,
  type StatusReferenceEntry,
} from "../pages/referenceContent";

/**
 * Display-name (as it appears in `STATUS_REFERENCE_DRAFTS`) → engine
 * status id. Hand-curated; cross-referenced against the engine's
 * `is_fortify_removable_status` list in `wasm-engine/src/statuses.rs`
 * and the legacy `LICH_MARK_PAYLOAD_STATUS_IDS` map in
 * `hitStatusRuntime.ts`.
 */
const NAME_TO_ENGINE_ID: Record<string, string> = {
  "Acid Rain": "Acid_Rain_Status",
  "Bad Omen": "Bad_Omen",
  "Bleed": "Bleed_Status",
  "Blessing's Boon": "Blessings_Boon",
  "Blurred Vision": "Blurred_Vision_Status",
  "Broken Bones": "Broken_Bones_Status",
  "Burn": "Burn_Status",
  "Clean Water": "Clean_Water_Status",
  "Confusion": "Confusion_Status",
  "Corrosion": "Corrosion_Status",
  "Deep Wounds": "Deep_Wounds_Status",
  "Disease": "Disease_Status",
  "Drowsy": "Drowsy_Status",
  "Fear": "Fear_Status",
  "Flowering": "Flowering_Status",
  "Freeze": "Freeze_Status",
  "Frostbite": "Frostbite_Status",
  "Gale": "Water_Gale_Status",
  "Healing Ailment": "Healing_Ailment",
  "Heartbroken": "Heartbroken_Status",
  "Heat Wave": "Heat_Wave_Status",
  "Hypothermia": "Hypothermia_Status",
  "Injury": "Injury_Status",
  "Malice's Mark": "Malices_Mark",
  "Muddy": "Muddy_Status",
  "Necropoison": "Necropoison_Status",
  "Poison": "Poison_Status",
  "Refreshed": "Refreshed_Status",
  "Shock": "Shock_Status",
  "Shredded Wings": "Shredded_Wings",
  "Slowed": "Slow_Status",
  "Sticky Teeth": "Sticky_Teeth_Status",
  "Stolen Speed": "Stolen_Speed_Status",
  "Torn Ligaments": "Torn_Ligaments_Status",
  "Water Regeneration": "Water_Regeneration_Status",
  // --- Item 2: engine-only statuses now backed by Reference + meta ---
  // These were in is_fortify_removable_status as hardcoded ids; adding
  // them here lets the catalog drive Fortify cleanse polarity via
  // Item 2 + Phase 5c.
  "Aftershock": "Aftershock",
  "Ashy Lungs": "Ashy_Lungs",
  "Broken Legs": "Broken_Legs_Status",
  "Paralyze": "Paralyze_Status",
  "Radiation": "Radiation_Status",
  "Scared": "Scared_Status",
  "Scared (Bear)": "Scared_Bear_Status",
  "Sickly": "Sickly_Status",
  "Sticky Trap": "Sticky_Trap_Status",
};

// ===== Phase 2: Effect registry extension =====
// See docs/effects_registry_design.md for the design.
//
// Reference prose (summary / mechanics) stays hand-authored under
// STATUS_REFERENCE_DRAFTS — that catalog is the project's mini-wiki
// and the test-backed spec the author works against. The structured
// metadata below is the machine-readable companion: polarity,
// category, timing, stack rule, effect shape, apply sources.
//
// Backfill sources cross-checked:
//   - is_fortify_removable_status (wasm-engine/src/statuses.rs) →
//     polarity "negative" for every id listed there.
//   - YOLK_BOMB_VALUE_OPTIONS SELF list (abilityValueOptions.ts) →
//     polarity "positive", sources includes "yolk_bomb_self".
//   - YOLK_BOMB_VALUE_OPTIONS ENEMY list → sources includes
//     "yolk_bomb_enemy".
//   - status_tick_sec → defaultTickSec.
//   - status_decay_sec (90 for Muddy, 3 per stack default) →
//     defaultDurationSec for non-stacking; null for stacking with
//     per-stack decay (Phase 3 will fill explicit values).
//   - status_max_stacks (Sticky Teeth = 10) → defaultMaxStacks.
//
// Phase 2 leaves `effect: { kind: "meta_marker" }` as a placeholder
// for almost every entry; Phase 3 fills real EffectShape values once
// consumers (Compare buff init, regen multiplier display) need them.

export type EffectPolarity = "positive" | "negative" | "neutral";

export type EffectCategory =
  | "regen_buff"
  | "stat_buff"
  | "stat_debuff"
  | "dot_damage"
  | "tick_heal"
  | "control"
  | "ailment_meta"
  | "neutral_marker";

export type EffectStackRule = "stacking" | "non_stacking" | "unique";

export type EffectSource =
  | "compare_toggle"
  | "yolk_bomb_self"
  | "yolk_bomb_enemy"
  | "lich_mark_payload"
  | "ability_apply"
  | "plushie";

export type EffectShape =
  | { kind: "stat_modifier"; mods: Partial<Record<string, number>>; opStyle: "add_pct" | "mult" | "add_flat" | "per_stack_pct" }
  | { kind: "dot_damage"; damagePerStackPerTick: number }
  | { kind: "tick_heal"; healPerStackPerTick: number; healUnit?: "flat" | "pct_max_hp" }
  | { kind: "control"; disables: string[] }
  | { kind: "meta_marker" }
  | { kind: "composite"; parts: EffectShape[] };

type EffectMeta = {
  polarity: EffectPolarity;
  category: EffectCategory;
  defaultDurationSec: number | null;
  defaultTickSec: number | null;
  defaultMaxStacks: number | null;
  stackRule: EffectStackRule;
  effect: EffectShape;
  sources: EffectSource[];
  displayGroup?: string;
};

const NAME_TO_EFFECT_META: Record<string, EffectMeta> = {
  "Acid Rain": {
    polarity: "negative", category: "dot_damage",
    defaultDurationSec: null, defaultTickSec: 3, defaultMaxStacks: null,
    stackRule: "stacking", effect: { kind: "meta_marker" },
    // Weather-only: applied by the Acid Rain cataclysm selector, never by
    // an ability/yolk/lich, so the source is the battle-settings toggle.
    sources: ["compare_toggle"],
  },
  "Bad Omen": {
    polarity: "negative", category: "ailment_meta",
    defaultDurationSec: null, defaultTickSec: null, defaultMaxStacks: null,
    stackRule: "stacking",
    // Composite: while active Bad Omen reduces passive health regen
    // by 25% flat; when it ends it applies one random follow-up
    // status (meta_marker — the random pick lives in engine code,
    // not the catalog).
    effect: {
      kind: "composite",
      parts: [
        { kind: "stat_modifier", mods: { healthRegenPct: -25 }, opStyle: "add_pct" },
        { kind: "meta_marker" },
      ],
    },
    // No yolk_bomb_enemy source — Yolk Bomb picker shows "BadOmen"
    // (legacy CamelCase) via SUPPLEMENTAL_YOLK_BOMB_ENEMY so existing
    // creatures.runtime.json data round-trips canonical.
    sources: ["lich_mark_payload", "ability_apply"],
  },
  "Bleed": {
    polarity: "negative", category: "dot_damage",
    defaultDurationSec: null, defaultTickSec: 3, defaultMaxStacks: null,
    stackRule: "stacking",
    // Composite: 2 damage per stack per tick + full natural regen
    // block (modeled as -100% flat healthRegenPct so the regen
    // multiplier collapses to 0 while any Bleed stack is active).
    effect: {
      kind: "composite",
      parts: [
        { kind: "dot_damage", damagePerStackPerTick: 2 },
        { kind: "stat_modifier", mods: { healthRegenPct: -100 }, opStyle: "add_pct" },
      ],
    },
    sources: ["yolk_bomb_enemy", "lich_mark_payload", "ability_apply"],
  },
  "Blessing's Boon": {
    polarity: "positive", category: "tick_heal",
    defaultDurationSec: null, defaultTickSec: 3, defaultMaxStacks: null,
    stackRule: "stacking", effect: { kind: "meta_marker" },
    sources: ["yolk_bomb_self", "lich_mark_payload", "ability_apply"],
  },
  "Blurred Vision": {
    polarity: "negative", category: "neutral_marker",
    defaultDurationSec: null, defaultTickSec: null, defaultMaxStacks: null,
    stackRule: "stacking", effect: { kind: "meta_marker" },
    // No yolk_bomb_enemy source — see Bad Omen note. Picker shows
    // "BlurredVision" via SUPPLEMENTAL_YOLK_BOMB_ENEMY.
    sources: ["lich_mark_payload", "ability_apply"],
  },
  "Broken Bones": {
    polarity: "negative", category: "neutral_marker",
    defaultDurationSec: null, defaultTickSec: null, defaultMaxStacks: null,
    stackRule: "stacking", effect: { kind: "meta_marker" },
    sources: ["yolk_bomb_enemy", "lich_mark_payload", "ability_apply"],
  },
  "Burn": {
    polarity: "negative", category: "dot_damage",
    defaultDurationSec: null, defaultTickSec: 3, defaultMaxStacks: null,
    stackRule: "stacking",
    // Composite: DoT damage (formula in compute_simple_dot_damage —
    // the catalog doesn't model the damage value yet, placeholder
    // meta_marker covers the tick channel) + per-stack regen
    // reduction (-10% per stack, so 10 stacks fully block regen).
    effect: {
      kind: "composite",
      parts: [
        { kind: "meta_marker" },
        { kind: "stat_modifier", mods: { healthRegenPct: -10 }, opStyle: "per_stack_pct" },
      ],
    },
    sources: ["yolk_bomb_enemy", "lich_mark_payload", "ability_apply"],
  },
  "Clean Water": {
    polarity: "positive", category: "regen_buff",
    defaultDurationSec: 180, defaultTickSec: null, defaultMaxStacks: null,
    stackRule: "non_stacking",
    effect: { kind: "stat_modifier", mods: { healthRegenPct: 20 }, opStyle: "add_pct" },
    sources: ["compare_toggle", "ability_apply"],
    displayGroup: "compare_temp_buff",
  },
  "Confusion": {
    polarity: "negative", category: "control",
    defaultDurationSec: null, defaultTickSec: null, defaultMaxStacks: null,
    stackRule: "stacking", effect: { kind: "meta_marker" },
    sources: ["yolk_bomb_enemy", "lich_mark_payload", "ability_apply"],
  },
  "Corrosion": {
    polarity: "negative", category: "dot_damage",
    defaultDurationSec: null, defaultTickSec: 3, defaultMaxStacks: null,
    stackRule: "stacking", effect: { kind: "meta_marker" },
    sources: ["yolk_bomb_enemy", "lich_mark_payload", "ability_apply"],
  },
  "Deep Wounds": {
    polarity: "negative", category: "stat_debuff",
    defaultDurationSec: null, defaultTickSec: null, defaultMaxStacks: null,
    stackRule: "stacking", effect: { kind: "meta_marker" },
    sources: ["yolk_bomb_enemy", "lich_mark_payload", "ability_apply"],
  },
  "Disease": {
    polarity: "negative", category: "stat_debuff",
    defaultDurationSec: null, defaultTickSec: null, defaultMaxStacks: null,
    stackRule: "stacking",
    // Per-stack health regen reduction: -15% per stack.
    effect: { kind: "stat_modifier", mods: { healthRegenPct: -15 }, opStyle: "per_stack_pct" },
    sources: ["yolk_bomb_enemy", "lich_mark_payload", "ability_apply"],
  },
  "Drowsy": {
    polarity: "negative", category: "control",
    defaultDurationSec: null, defaultTickSec: null, defaultMaxStacks: null,
    stackRule: "stacking", effect: { kind: "meta_marker" },
    sources: ["yolk_bomb_enemy", "lich_mark_payload", "ability_apply"],
  },
  "Fear": {
    polarity: "negative", category: "control",
    defaultDurationSec: null, defaultTickSec: null, defaultMaxStacks: null,
    stackRule: "stacking", effect: { kind: "meta_marker" },
    sources: ["yolk_bomb_enemy", "lich_mark_payload", "ability_apply"],
  },
  "Flowering": {
    polarity: "positive", category: "stat_buff",
    defaultDurationSec: null, defaultTickSec: null, defaultMaxStacks: null,
    stackRule: "stacking", effect: { kind: "meta_marker" },
    sources: ["yolk_bomb_self", "lich_mark_payload", "ability_apply"],
  },
  "Freeze": {
    polarity: "negative", category: "control",
    defaultDurationSec: null, defaultTickSec: null, defaultMaxStacks: null,
    stackRule: "stacking", effect: { kind: "meta_marker" },
    sources: ["yolk_bomb_enemy", "lich_mark_payload", "ability_apply"],
  },
  "Frostbite": {
    polarity: "negative", category: "stat_debuff",
    defaultDurationSec: null, defaultTickSec: null, defaultMaxStacks: null,
    stackRule: "stacking", effect: { kind: "meta_marker" },
    sources: ["yolk_bomb_enemy", "lich_mark_payload", "ability_apply"],
  },
  "Gale": {
    polarity: "negative", category: "control",
    defaultDurationSec: null, defaultTickSec: null, defaultMaxStacks: null,
    stackRule: "stacking", effect: { kind: "meta_marker" },
    sources: ["yolk_bomb_enemy", "lich_mark_payload", "ability_apply"],
  },
  "Healing Ailment": {
    polarity: "positive", category: "stat_buff",
    defaultDurationSec: null, defaultTickSec: null, defaultMaxStacks: null,
    stackRule: "stacking", effect: { kind: "meta_marker" },
    sources: ["yolk_bomb_self", "lich_mark_payload", "ability_apply"],
  },
  "Heartbroken": {
    polarity: "negative", category: "stat_debuff",
    defaultDurationSec: null, defaultTickSec: null, defaultMaxStacks: null,
    stackRule: "stacking", effect: { kind: "meta_marker" },
    sources: ["yolk_bomb_enemy", "lich_mark_payload", "ability_apply"],
  },
  "Heat Wave": {
    polarity: "negative", category: "dot_damage",
    defaultDurationSec: null, defaultTickSec: 3, defaultMaxStacks: null,
    stackRule: "stacking", effect: { kind: "meta_marker" },
    // No yolk_bomb_enemy source — see Bad Omen note. Picker shows
    // "Heatwave" (legacy single-word) via SUPPLEMENTAL_YOLK_BOMB_ENEMY.
    sources: ["lich_mark_payload", "ability_apply"],
  },
  "Hypothermia": {
    polarity: "negative", category: "dot_damage",
    defaultDurationSec: null, defaultTickSec: 3, defaultMaxStacks: null,
    stackRule: "stacking", effect: { kind: "meta_marker" },
    sources: ["yolk_bomb_enemy", "lich_mark_payload", "ability_apply"],
  },
  "Injury": {
    polarity: "negative", category: "neutral_marker",
    defaultDurationSec: null, defaultTickSec: null, defaultMaxStacks: null,
    stackRule: "stacking", effect: { kind: "meta_marker" },
    sources: ["yolk_bomb_enemy", "lich_mark_payload", "ability_apply"],
  },
  "Malice's Mark": {
    polarity: "negative", category: "ailment_meta",
    defaultDurationSec: null, defaultTickSec: null, defaultMaxStacks: null,
    stackRule: "stacking", effect: { kind: "meta_marker" },
    sources: ["yolk_bomb_enemy", "lich_mark_payload", "ability_apply"],
  },
  "Muddy": {
    polarity: "positive", category: "regen_buff",
    defaultDurationSec: 90, defaultTickSec: null, defaultMaxStacks: null,
    stackRule: "non_stacking",
    effect: { kind: "stat_modifier", mods: { healthRegenPct: 25 }, opStyle: "add_pct" },
    sources: ["compare_toggle", "ability_apply"],
    displayGroup: "compare_temp_buff",
  },
  "Necropoison": {
    polarity: "negative", category: "ailment_meta",
    defaultDurationSec: null, defaultTickSec: null, defaultMaxStacks: null,
    stackRule: "stacking", effect: { kind: "meta_marker" },
    // No defaultTickSec: Necropoison is a meta-marker status — at 10+
    // stacks it disables active abilities (is_actives_disabled_by_necro
    // in statuses.rs). It does not produce a periodic DoT tick the way
    // Bleed / Burn / Poison do.
    sources: ["yolk_bomb_enemy", "lich_mark_payload", "ability_apply"],
  },
  "Poison": {
    polarity: "negative", category: "dot_damage",
    defaultDurationSec: null, defaultTickSec: 3, defaultMaxStacks: null,
    stackRule: "stacking", effect: { kind: "meta_marker" },
    sources: ["yolk_bomb_enemy", "lich_mark_payload", "ability_apply"],
  },
  "Refreshed": {
    polarity: "positive", category: "regen_buff",
    defaultDurationSec: 180, defaultTickSec: null, defaultMaxStacks: null,
    stackRule: "non_stacking",
    effect: { kind: "stat_modifier", mods: { healthRegenPct: 5 }, opStyle: "add_pct" },
    sources: ["compare_toggle", "ability_apply"],
    displayGroup: "compare_temp_buff",
  },
  "Shock": {
    polarity: "negative", category: "control",
    defaultDurationSec: null, defaultTickSec: null, defaultMaxStacks: null,
    stackRule: "stacking", effect: { kind: "meta_marker" },
    sources: ["yolk_bomb_enemy", "lich_mark_payload", "ability_apply"],
  },
  "Shredded Wings": {
    polarity: "negative", category: "neutral_marker",
    defaultDurationSec: null, defaultTickSec: null, defaultMaxStacks: null,
    stackRule: "stacking", effect: { kind: "meta_marker" },
    sources: ["yolk_bomb_enemy", "lich_mark_payload", "ability_apply"],
  },
  "Slowed": {
    polarity: "negative", category: "stat_debuff",
    defaultDurationSec: null, defaultTickSec: null, defaultMaxStacks: null,
    stackRule: "stacking", effect: { kind: "meta_marker" },
    sources: ["yolk_bomb_enemy", "lich_mark_payload", "ability_apply"],
  },
  "Sticky Teeth": {
    polarity: "negative", category: "stat_debuff",
    defaultDurationSec: null, defaultTickSec: null, defaultMaxStacks: 10,
    stackRule: "stacking", effect: { kind: "meta_marker" },
    sources: ["yolk_bomb_enemy", "lich_mark_payload", "ability_apply"],
  },
  "Stolen Speed": {
    polarity: "negative", category: "stat_debuff",
    defaultDurationSec: null, defaultTickSec: null, defaultMaxStacks: null,
    stackRule: "stacking", effect: { kind: "meta_marker" },
    sources: ["yolk_bomb_enemy", "lich_mark_payload", "ability_apply"],
  },
  "Torn Ligaments": {
    polarity: "negative", category: "stat_debuff",
    defaultDurationSec: null, defaultTickSec: null, defaultMaxStacks: null,
    stackRule: "stacking", effect: { kind: "meta_marker" },
    sources: ["yolk_bomb_enemy", "lich_mark_payload", "ability_apply"],
  },
  "Water Regeneration": {
    polarity: "positive", category: "tick_heal",
    defaultDurationSec: null, defaultTickSec: 3, defaultMaxStacks: null,
    stackRule: "stacking", effect: { kind: "meta_marker" },
    sources: ["yolk_bomb_self", "lich_mark_payload", "ability_apply"],
  },
  // --- Item 2: engine-only statuses now in the catalog ---
  "Aftershock": {
    polarity: "negative", category: "neutral_marker",
    defaultDurationSec: null, defaultTickSec: null, defaultMaxStacks: null,
    stackRule: "stacking", effect: { kind: "meta_marker" },
    sources: ["ability_apply"],
  },
  "Ashy Lungs": {
    polarity: "negative", category: "neutral_marker",
    defaultDurationSec: null, defaultTickSec: null, defaultMaxStacks: null,
    stackRule: "stacking", effect: { kind: "meta_marker" },
    sources: ["ability_apply"],
  },
  "Broken Legs": {
    polarity: "negative", category: "neutral_marker",
    defaultDurationSec: null, defaultTickSec: null, defaultMaxStacks: null,
    stackRule: "stacking", effect: { kind: "meta_marker" },
    sources: ["ability_apply"],
  },
  "Paralyze": {
    polarity: "negative", category: "control",
    defaultDurationSec: null, defaultTickSec: null, defaultMaxStacks: null,
    stackRule: "stacking", effect: { kind: "meta_marker" },
    sources: ["ability_apply"],
  },
  "Radiation": {
    polarity: "negative", category: "neutral_marker",
    defaultDurationSec: null, defaultTickSec: null, defaultMaxStacks: null,
    stackRule: "stacking", effect: { kind: "meta_marker" },
    // Radiation_Status is an alias the engine kept after the Aura
    // subtype-driven mechanic generalisation retired the dedicated
    // Radiation path (see commit a1dc5a8). Tracked in the catalog so
    // Fortify still recognises it as a negative status.
    sources: ["ability_apply"],
  },
  "Scared": {
    polarity: "negative", category: "stat_debuff",
    defaultDurationSec: 10, defaultTickSec: null, defaultMaxStacks: null,
    stackRule: "non_stacking",
    // -50% multiplicative on outgoing damage for 10 seconds.
    effect: { kind: "stat_modifier", mods: { damagePct: -50 }, opStyle: "add_pct" },
    sources: ["compare_toggle", "ability_apply"],
  },
  "Scared (Bear)": {
    polarity: "negative", category: "stat_debuff",
    defaultDurationSec: 10, defaultTickSec: null, defaultMaxStacks: null,
    stackRule: "non_stacking",
    // Bear-plushie variant: -40% outgoing damage for 10 seconds
    // (softer than plain Scared's -50%).
    effect: { kind: "stat_modifier", mods: { damagePct: -40 }, opStyle: "add_pct" },
    sources: ["compare_toggle", "ability_apply"],
  },
  "Sickly": {
    polarity: "negative", category: "stat_debuff",
    defaultDurationSec: null, defaultTickSec: null, defaultMaxStacks: null,
    stackRule: "stacking",
    // -20% multiplicative on passive health regen while active.
    effect: { kind: "stat_modifier", mods: { healthRegenPct: -20 }, opStyle: "add_pct" },
    sources: ["ability_apply"],
  },
  "Sticky Trap": {
    polarity: "negative", category: "control",
    defaultDurationSec: null, defaultTickSec: null, defaultMaxStacks: null,
    stackRule: "stacking", effect: { kind: "meta_marker" },
    sources: ["ability_apply"],
  },
};

export type StatusCatalogEntry = {
  /** Engine status id (e.g. `"Bleed_Status"`). Stable; safe to
   *  persist across sessions. */
  id: string;
  /** Reference display name (e.g. `"Bleed"`). Matches the Reference
   *  entry's `name`, with no `_Status` suffix. */
  name: string;
  /** Reference status — only `Modeled` and `Partial` are present. */
  referenceStatus: "Modeled" | "Partial";
  /** One-liner summary from the Reference catalog. */
  summary: string;
  /** Full mechanics bullet list from the Reference catalog. Pickers
   *  may slice this to keep the UI compact. */
  mechanics: string[];
  /** Positive (buff), negative (debuff), or neutral marker. Drives
   *  Yolk Bomb SELF/ENEMY routing, Fortify cleanse, and UI colour. */
  polarity: EffectPolarity;
  /** High-level category for grouping and filtering. */
  category: EffectCategory;
  /** Default fixed duration in seconds, or `null` if the status
   *  decays per-stack (Muddy = 90 fixed; Bleed = null, decays 3 s
   *  per stack via Rust `status_decay_sec` default). */
  defaultDurationSec: number | null;
  /** Default DoT / heal-over-time tick interval in seconds, or `null`
   *  if the status has no tick (control / marker statuses). */
  defaultTickSec: number | null;
  /** Maximum stack count or `null` for unbounded. Sticky Teeth = 10. */
  defaultMaxStacks: number | null;
  /** How stacks compose: `stacking` (default), `non_stacking` (re-apply
   *  refreshes duration only), `unique` (single instance, no stacks). */
  stackRule: EffectStackRule;
  /** Machine-readable effect content. Phase 2 backfill uses
   *  `{ kind: "meta_marker" }` placeholder for most entries; Phase 3
   *  fills real EffectShape values once consumers need them. */
  effect: EffectShape;
  /** Where this effect can come from. Drives picker visibility
   *  (Yolk Bomb shows entries with yolk_bomb_self/enemy; Lich Mark
   *  shows entries with lich_mark_payload; Compare buff toggles
   *  show entries with compare_toggle). */
  sources: EffectSource[];
  /** Optional display grouping for UI (e.g. `compare_temp_buff` to
   *  collect Muddy / Clean Water / Refreshed under one StatCard
   *  row). */
  displayGroup?: string;
};

// Conservative defaults for any Reference entry whose effect meta
// has not yet been hand-curated in NAME_TO_EFFECT_META. Lets the
// catalog still build (no hard error) while a `console.warn` surfaces
// the gap to whoever added the Reference entry. Safer than throwing
// because Reference content moves faster than meta backfill.
const EFFECT_META_FALLBACK: EffectMeta = {
  polarity: "neutral",
  category: "neutral_marker",
  defaultDurationSec: null,
  defaultTickSec: null,
  defaultMaxStacks: null,
  stackRule: "stacking",
  effect: { kind: "meta_marker" },
  sources: ["ability_apply"],
};

function buildCatalog(): StatusCatalogEntry[] {
  const out: StatusCatalogEntry[] = [];
  const seenNames = new Set<string>();
  for (const entry of STATUS_REFERENCE_DRAFTS) {
    if (entry.status !== "Modeled" && entry.status !== "Partial") continue;
    if (seenNames.has(entry.name)) continue;
    const engineId = NAME_TO_ENGINE_ID[entry.name];
    if (!engineId) {
      // A Reference entry with no engine id is a wiring bug — the
      // status is marked modeled/partial but no picker knows how to
      // route it to the engine. Surface it in dev console rather
      // than silently dropping (production users won't see this).
      if (typeof console !== "undefined") {
        console.warn(
          `[statusCatalog] missing engine id for Reference entry "${entry.name}" — add to NAME_TO_ENGINE_ID`,
        );
      }
      continue;
    }
    const meta = NAME_TO_EFFECT_META[entry.name];
    if (!meta && typeof console !== "undefined") {
      console.warn(
        `[statusCatalog] missing effect meta for Reference entry "${entry.name}" — add to NAME_TO_EFFECT_META`,
      );
    }
    const resolvedMeta = meta ?? EFFECT_META_FALLBACK;
    seenNames.add(entry.name);
    out.push({
      id: engineId,
      name: entry.name,
      referenceStatus: entry.status,
      summary: entry.summary,
      mechanics: entry.mechanics ?? [],
      polarity: resolvedMeta.polarity,
      category: resolvedMeta.category,
      defaultDurationSec: resolvedMeta.defaultDurationSec,
      defaultTickSec: resolvedMeta.defaultTickSec,
      defaultMaxStacks: resolvedMeta.defaultMaxStacks,
      stackRule: resolvedMeta.stackRule,
      effect: resolvedMeta.effect,
      sources: resolvedMeta.sources,
      displayGroup: resolvedMeta.displayGroup,
    });
  }
  return out.sort((left, right) => left.name.localeCompare(right.name));
}

/**
 * Single ordered list of every modeled / partial status available
 * for the user to pick from anywhere in the UI. Sorted by display
 * name for stable rendering.
 */
export const STATUS_CATALOG: StatusCatalogEntry[] = buildCatalog();

/**
 * Index of catalog entries by Reference display name (case-
 * insensitive). Useful for callers that have the human-readable
 * name and need the engine id.
 */
const BY_NORMALIZED_NAME: Map<string, StatusCatalogEntry> = (() => {
  const m = new Map<string, StatusCatalogEntry>();
  for (const entry of STATUS_CATALOG) {
    m.set(entry.name.trim().toLowerCase(), entry);
  }
  return m;
})();

/** Look up the engine status id from a display name. Returns `null`
 *  for unknown names. */
export function lookupStatusEngineId(displayName: string): string | null {
  return BY_NORMALIZED_NAME.get(displayName.trim().toLowerCase())?.id ?? null;
}

/** Look up the full catalog entry from a display name. */
export function lookupStatusEntry(displayName: string): StatusCatalogEntry | null {
  return BY_NORMALIZED_NAME.get(displayName.trim().toLowerCase()) ?? null;
}

/** Build the legacy `displayName → engine_id` map for callers that
 *  still need the lookup table form (e.g. the engine-side Lich Mark
 *  resolver, which iterates entries by display name received from
 *  the wiki/JSON data). */
export function statusEngineIdMap(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const entry of STATUS_CATALOG) {
    out[entry.name] = entry.id;
  }
  return out;
}

/** True if the given display name maps to a Reference entry — used
 *  by tests and by `referenceContent.ts` coverage gates that probe
 *  whether a string the wiki uses is a recognised status. */
export function isCatalogedStatus(displayName: string): boolean {
  return BY_NORMALIZED_NAME.has(displayName.trim().toLowerCase());
}

/** Helper exposed for the dev-mode picker tests — re-runs catalog
 *  construction so a test can mutate `STATUS_REFERENCE_DRAFTS` in
 *  a stub and verify the catalog responds. */
export function rebuildStatusCatalogForTests(): StatusCatalogEntry[] {
  return buildCatalog();
}

// Re-export so consumers don't need a separate import for the
// upstream Reference type.
export type { StatusReferenceEntry };
