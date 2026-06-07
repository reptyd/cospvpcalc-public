/**
 * Effects-catalog rules - single source of truth for deriving
 * `data/effects_catalog.runtime.v2.json` from `data/creatures.runtime.json`.
 *
 * Why this file exists: pre-2026-05-12 the effects catalog was
 * hand-maintained. Every new creature added via wiki-sync silently
 * dropped from the catalog (12 such drift cases by the time the gap
 * was found, including Sequidliom). Several abilities also had
 * legacy mis-mappings (e.g. `Block Necropoison` → `Poison_Status`
 * across 65 entries even though Necropoison is a distinct status).
 *
 * The rules below codify the wiki → engine mapping. The companion
 * generator (`sync_effects_catalog.ts`) reads creatures.runtime and
 * rebuilds the catalog deterministically. Adding a new ability now
 * means editing this file (one place), not 451 entries.
 *
 * Per-creature variance lives only in:
 *   - `value` from creatures.runtime.passiveAbilities[i].value
 *   - `stacks` for status-applying abilities (from the same value)
 *   - `fraction` for block abilities (from the same value)
 *
 * Everything else (def shape, status-id mapping, semantics) is
 * uniform across creatures - confirmed by inspecting all 196
 * historical `def` blocks and finding exactly 1 distinct signature
 * per ability name.
 */

import type { SpecialAbilityDef } from "../src/engine/types";

/**
 * `Block X` passive → which status id its `fraction` resists.
 *
 * Necropoison is intentionally split from Poison: pre-fix the catalog
 * mapped both to `Poison_Status`, but the engine treats
 * `Necropoison_Status` as a distinct status (see
 * `wasm-engine/src/statuses.rs:56`, `lich_mark.rs:245`). Only Silligie
 * had the correct mapping; the other 65 entries were legacy bugs.
 */
export const BLOCK_STATUS_MAP: Record<string, string> = {
  "Block Bleed": "Bleed_Status",
  "Block Burn": "Burn_Status",
  "Block Disease": "Disease_Status",
  "Block Frostbite": "Frostbite_Status",
  "Block Injury": "Injury_Status",
  "Block Necropoison": "Necropoison_Status",
  "Block Poison": "Poison_Status",
};

/**
 * Offensive `X Attack` / `Ligament Tear` passive → status id applied
 * on bite. Stack count comes from creature's `value` field.
 */
export const ATTACK_STATUS_MAP: Record<string, string> = {
  "Bleed Attack": "Bleed_Status",
  "Burn Attack": "Burn_Status",
  "Corrosion Attack": "Corrosion_Status",
  "Disease Attack": "Disease_Status",
  "Frostbite Attack": "Frostbite_Status",
  "Injury Attack": "Injury_Status",
  "Necropoison Attack": "Necropoison_Status",
  "Poison Attack": "Poison_Status",
  // Ligament Tear is special - it applies Torn_Ligaments_Status on hit
  // AND carries an `onHitStatus` def. We keep both: list-level mapping
  // here (so applyStatusOnHit gets populated) and the def below.
  "Ligament Tear": "Torn_Ligaments_Status",
};

/**
 * Defensive `Defensive X` passive → status id applied to attacker on
 * being bitten.
 */
export const DEFENSIVE_STATUS_MAP: Record<string, string> = {
  "Defensive Bleed": "Bleed_Status",
  "Defensive Burn": "Burn_Status",
  "Defensive Corrosion": "Corrosion_Status",
  "Defensive Disease": "Disease_Status",
  "Defensive Frostbite": "Frostbite_Status",
  "Defensive Injury": "Injury_Status",
  "Defensive Necropoison": "Necropoison_Status",
  "Defensive Paralyze": "Paralyze_Status",
  "Defensive Poison": "Poison_Status",
};

/**
 * Abilities that get a `specialAbilitiesDetailed` entry with a
 * structured `def` block. Defs encode trigger thresholds, multipliers,
 * etc. that the engine reads (see
 * `src/optimizer/rustBestBuildsRuntime.ts:363-475`).
 *
 * Defs are uniform across all creatures owning the same ability -
 * verified by enumerating the catalog: each ability name maps to
 * exactly 1 distinct signature. Per-creature variance lives in
 * `specialAbilitiesDetailed[i].value` (copied from passive value).
 *
 * Abilities not listed here go into `otherAbilities` instead (the
 * 45 modeled-but-def-less abilities like Life Leech, Reflect,
 * Fortify, Hunker, etc.).
 */
export const ABILITY_DEFS: Record<string, SpecialAbilityDef> = {
  "Aura (Disease)": {
    type: "diseaseAura",
    notes:
      "TS stand-and-fight approximation: pulses Disease on the in-range opponent every 3 seconds.",
  },
  Berserk: {
    type: "conditionalMultiStat",
    trigger: { hpRatioLt: 0.2 },
    mods: { stamRegenMultiplier: 2, biteCooldownMultiplier: 0.5 },
  },
  "Breath Resistance": {
    type: "breathDamageReduction",
    paramFromCreatureValue: true,
    notes:
      "Value should be interpreted as fraction (1.0=100% immune to breath damage).",
  },
  Channeling: {
    type: "conditionalAuraStatusPulse",
    trigger: { hpRatioLte: 0.25 },
    pulseSec: 5,
    apply: [
      { statusId: "Shock_Status", stacks: 3 },
      { statusId: "Confusion_Status", stacks: 2 },
    ],
    notes: "Stacks apply each pulse.",
  } as SpecialAbilityDef,
  "First Strike": {
    type: "conditionalDamageBoost",
    trigger: { hpRatioGte: 0.75 },
    paramFromCreatureValue: true,
    notes: "Boost amount comes from creature sheet value.",
  },
  Gourmandizer: {
    type: "passiveUtility",
    paramUnknown: true,
    notes:
      "Modeled as a neutral support passive; no direct combat scalar is applied yet.",
  },
  "Grim Lariat": {
    type: "targetedBurstStatus",
    notes:
      "TS stand-and-fight approximation: 60s cooldown, guaranteed hit on the single opponent, deals 50% of current damage, and applies 8 Heartbroken.",
  },
  Guilt: {
    type: "damageTakenMultiplier",
    when: "onBeingBitten",
    multiplier: 0.5,
  },
  "Iron Stomach": {
    type: "passiveUtility",
    paramUnknown: true,
    notes:
      "Modeled as a neutral support passive; no direct combat scalar is applied yet.",
  },
  "Ligament Tear": {
    type: "onHitStatus",
    notes:
      "Applies Torn Ligaments on hit; current stand-and-fight model intentionally ignores stamina, glide, and movement penalties.",
  },
  "Quick Recovery": {
    type: "conditionalHpRegenBoost",
    trigger: { hpRatioLt: 0.4 },
    paramUnknown: true,
    notes:
      "Wiki: lower HP => higher regen boost; numeric function not specified in sheet.",
  },
  "Self-Destruct": {
    type: "conditionalDelayedExplosion",
    trigger: { hpRatioLte: 0.15 },
    cooldownSec: 300,
    onExplode: {
      dealDamage: { mode: "percentTargetMaxHp", pct: 10 },
      applyStatus: [{ statusId: "Burn_Status", stacks: 10 }],
    },
    selfAfterExplode: { hpFloorPct: 5 },
  },
  "Stubborn Stacker": {
    type: "plushieOverride",
    notes:
      "Replaces specific offensive ailment plushie payloads with creature-specific stat and block bonuses.",
  },
  Unbreakable: {
    type: "statusImmunity",
    immuneTo: ["Bleed_Status", "Injury_Status"],
  },
};

/**
 * Look up a Block name's resisted status id. Returns `null` for
 * unknown names (caller treats as ability without resist effect).
 */
export function resolveBlockStatusId(sourceAbility: string): string | null {
  return BLOCK_STATUS_MAP[sourceAbility] ?? null;
}

/**
 * Look up an offensive attack ability's applied status id. Returns
 * `null` for non-attack abilities (e.g. `Wing Shredder`, `Ligament Tear`
 * value-only passives - but Ligament Tear is in the map).
 */
export function resolveAttackStatusId(sourceAbility: string): string | null {
  return ATTACK_STATUS_MAP[sourceAbility] ?? null;
}

/**
 * Look up a `Defensive X` ability's applied-on-being-bitten status id.
 */
export function resolveDefensiveStatusId(sourceAbility: string): string | null {
  return DEFENSIVE_STATUS_MAP[sourceAbility] ?? null;
}

/**
 * Look up an ability's structured `def` block (for
 * specialAbilitiesDetailed). Returns `null` if the ability doesn't have
 * a registered def - in which case it goes into `otherAbilities`.
 */
export function resolveAbilityDef(
  abilityName: string,
): SpecialAbilityDef | null {
  return ABILITY_DEFS[abilityName] ?? null;
}
