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
import {
  ATTACK_STATUS_MAP,
  BLOCK_STATUS_MAP,
  DEFENSIVE_STATUS_MAP,
  resolveAttackStatusId,
  resolveBlockStatusId,
  resolveDefensiveStatusId,
} from "../src/engine/effectDerivation";

// The name->statusId tables and their resolvers live in
// src/engine/effectDerivation.ts so the custom-creature synthesis shares the
// exact same mapping. Re-exported here for the existing tools consumers.
export {
  ATTACK_STATUS_MAP,
  BLOCK_STATUS_MAP,
  DEFENSIVE_STATUS_MAP,
  resolveAttackStatusId,
  resolveBlockStatusId,
  resolveDefensiveStatusId,
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
    selfAfterExplode: { hpFloorPct: 15 },
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
 * Look up an ability's structured `def` block (for
 * specialAbilitiesDetailed). Returns `null` if the ability doesn't have
 * a registered def - in which case it goes into `otherAbilities`.
 */
export function resolveAbilityDef(
  abilityName: string,
): SpecialAbilityDef | null {
  return ABILITY_DEFS[abilityName] ?? null;
}
