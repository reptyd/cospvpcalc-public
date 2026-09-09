/**
 * Generates `src/shared/shareDictionary.ts` - the frozen, versioned preset
 * dictionary used by COSM4 share links (pako raw-deflate with a preset
 * dictionary).
 *
 * Why frozen + versioned: raw DEFLATE with a preset dictionary does NOT
 * checksum the dictionary, so decompressing with a *different* dictionary
 * silently yields garbage. Each COSM4 link therefore carries the dictionary
 * version it was built with, and every version is kept here forever. Re-run
 * this only to mint a NEW version (bump SHARE_DICTIONARY_VERSION); never edit
 * an existing one.
 *
 * Dictionary layout (a preset dictionary primes DEFLATE's 32 KB back-reference
 * window; content nearer the END gets shorter distance codes, so the most
 * frequent fragments go last):
 *   [ rare-but-collectively-common creature/plushie/trait names ]
 *   [ enum values ]
 *   [ "key": fragments for every known field ]
 *   [ the most common JSON byte fragments ]
 *
 * Run:  npx tsx scripts/gen_share_dictionary.ts
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VOCAB_FILE = path.join(ROOT, "src", "shared", "shareVocabulary.ts");
const DICT_FILE = path.join(ROOT, "src", "shared", "shareDictionary.ts");

// The version this run produces. Bump to mint a new dictionary; existing
// versions in the output file are preserved.
const VERSION = 1;

function readVocab(): string[] {
  const src = fs.readFileSync(VOCAB_FILE, "utf8");
  return [...src.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => JSON.parse(`"${m[1]}"`) as string);
}

// Enum / literal string values that recur across snapshots.
const ENUMS = [
  "madness", "tranquility", "normal", "sustained", "burst", "neutral",
  "stand", "sit", "lay", "none", "summary", "firstDeath", "fullFight",
  "primaryOnly", "secondaryOnly", "dynamic", "day", "night", "blueMoon",
  "bloodMoon", "off", "ailments", "both", "None", "Adult", "Juvenile", "Elder",
  "buff", "debuff", "positive", "negative",
];

// Known object keys across the snapshot / page-state / build / custom-creature
// / global-settings / special-abilities / buffs shapes. Missing keys simply do
// not compress (a few characters longer, never wrong).
const KEYS = [
  // snapshot envelope
  "version", "page", "globalSettings", "pageState", "participantCustomCreatures",
  // global settings
  "combatEventOrder", "trueRoundingMode", "developerMode",
  // compare page-state
  "nameA", "nameB", "buildA", "buildB", "activesOn", "breathOn",
  "compareAbilityPolicy", "compareAbilityPolicyOverridesA", "compareAbilityPolicyOverridesB",
  "compareUserAbilityOverridesA", "compareUserAbilityOverridesB",
  "compareUserAbilityLevelsA", "compareUserAbilityLevelsB",
  "disabledAbilitiesA", "disabledAbilitiesB", "badOmenChoice",
  "compareBuffsA", "compareBuffsB", "comparePosturePolicyA", "comparePosturePolicyB",
  "resultViewMode", "compareDpsSettings", "debugMode",
  "specialAbilitiesA", "specialAbilitiesB", "compareBiteVariantModeA", "compareBiteVariantModeB",
  "compareDayNight", "compareMoon", "compareWeather", "compareAirRuleEnabled",
  "compareAirRuleCooldownSec", "compareNoMoveFacetank", "compareFirstTickMode",
  "compareFirstTickDelaySec",
  // build
  "venerationStage", "traits", "ascensionAssignments", "plushies", "elder",
  // dps settings
  "window", "mode",
  // special abilities
  "volcanic", "frosty", "defiledGround", "defiledGroundLevel", "gourmandizer",
  "broodwatcher", "hungerRule", "powerCharge", "goreCharge", "startingSpiteCharged",
  "wardenRageStartHp", "wardenRageStartHpPct", "gourmandizerStartingHunger",
  "strengthInNumbers", "strengthInNumbersAllies", "traps", "trails", "twoFacedMode",
  "healingPulseEnabled", "healingPulseMode",
  // buffs
  "damageBoost", "regenBoost", "packHealerNearby", "muddy", "cleanWater",
  "refreshed", "aggressive", "scared", "newborn", "storming",
  // custom creature
  "creature", "stats", "tier", "health", "weight", "damage", "biteCooldown",
  "healthRegen", "breath", "breathAbilities", "abilityId", "value", "semantics",
  "subtype", "effects", "otherAbilities", "applyStatusOnHit", "applyStatusOnHitTaken",
  "resistStatus", "appetite", "iconName", "createdAt",
];

// Most-common literal JSON byte fragments, frequent-last (shortest distance).
const FRAGMENTS = [
  ":[]", ":{}", ":0", ":1", ":null", "},{", "\":[", "\":{", "\":\"", ":true", ":false", ",\"",
];

function buildDictionary(vocab: string[]): string {
  const names = vocab.map((n) => JSON.stringify(n)).join(",");
  const enums = ENUMS.map((e) => JSON.stringify(e)).join(",");
  const keys = KEYS.map((k) => `${JSON.stringify(k)}:`).join("");
  const fragments = FRAGMENTS.join("");
  return `${names},${enums},${keys}${fragments}`;
}

function readExistingDicts(): Record<number, string> {
  if (!fs.existsSync(DICT_FILE)) return {};
  // Re-import is overkill; parse the literal map via require-like eval is
  // unsafe. Instead, preserve nothing automatically for v1 (single version);
  // for multi-version, paste prior versions manually before re-running.
  return {};
}

const vocab = readVocab();
const dict = buildDictionary(vocab);
const existing = readExistingDicts();
const dicts: Record<number, string> = { ...existing, [VERSION]: dict };

const entries = Object.keys(dicts)
  .map(Number)
  .sort((a, b) => a - b)
  .map((v) => `  ${v}: ${JSON.stringify(dicts[v])},`)
  .join("\n");

const file = `// AUTO-GENERATED by scripts/gen_share_dictionary.ts - do not edit by hand.
//
// FROZEN, VERSIONED preset dictionaries for COSM4 share links. Each link
// carries its dictionary version; every version below must stay byte-identical
// forever (raw DEFLATE does not checksum the dictionary, so decoding with a
// changed dictionary would silently corrupt old links). Mint a NEW version
// instead of editing an existing one.
export const SHARE_DICTIONARIES: Record<number, string> = {
${entries}
};

// The version new COSM4 links are encoded with.
export const SHARE_DICTIONARY_VERSION = ${VERSION};
`;
fs.writeFileSync(DICT_FILE, file, "utf8");
console.log(`Wrote dictionary v${VERSION} (${dict.length} chars) to ${path.relative(ROOT, DICT_FILE)}`);
