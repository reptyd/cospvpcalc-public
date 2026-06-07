/**
 * Wiki Sync - fetch creature data from the CoS Fandom wiki and sync
 * with the local creatures.runtime.json.
 *
 * Usage:
 *   npx tsx tools/wiki-sync.ts                 # interactive: show diff, pick creatures
 *   npx tsx tools/wiki-sync.ts --all           # sync all creatures
 *   npx tsx tools/wiki-sync.ts Sigmatox Boreal # sync specific creatures
 *   npx tsx tools/wiki-sync.ts --dry           # show diff without saving
 *   npx tsx tools/wiki-sync.ts --pvp           # show only PvP-relevant changes (no speed/stamina)
 *   npx tsx tools/wiki-sync.ts --icons         # also download icons for creatures touched by this run
 *   npx tsx tools/wiki-sync.ts --icons-all     # backfill icons for every creature missing one
 *   npx tsx tools/wiki-sync.ts --all --push-prod
 *                                             # commit/push applied wiki-sync data changes to origin/current branch
 *   npx tsx tools/wiki-sync.ts --send-discord --no-apply
 *                                             # send preview to Discord without touching local files
 *
 * Discord webhook:
 *   - env COS_WIKI_SYNC_DISCORD_WEBHOOK
 *   - or tools/wiki-sync.webhook.local
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import {
  canonicalAbilityNameKey,
  normalizeAbilityDisplayName as normalizeAbilityDisplayNameShared,
} from "../src/shared/abilityNameAliases";
import { MODELED_OTHER_ABILITIES } from "../src/shared/modeledOtherAbilities";
import { syncEffectsCatalog } from "./sync_effects_catalog";

// Ability names that are canonically stored with a parenthesized subtype,
// e.g. "Aura (Disease)". When wiki text shows the same shape, we must keep
// the parens as part of the name instead of treating "Disease" as a value
// (which would silently break engine lookups like
// hasActivatedAbilityNamed("Aura (Disease)")).
const PARENS_NAME_CANONICAL_KEYS = new Set(
  MODELED_OTHER_ABILITIES.filter((name) => /\([^)]+\)/.test(name)).map((name) =>
    canonicalAbilityNameKey(name),
  ),
);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const DATA = path.join(ROOT, "data");
const CREATURES_FILE = path.join(DATA, "creatures.runtime.json");
const ICONS_FILE = path.join(DATA, "creatures.icons.json");
const EFFECTS_CATALOG_FILE = path.join(DATA, "effects_catalog.runtime.v2.json");
const ICONS_DIR = path.join(ROOT, "public", "icons", "creatures");
const WEBHOOK_FILE = path.join(ROOT, "tools", "wiki-sync.webhook.local");
// Subspecies: wiki has no proper category for them and returns broken/missing
// data, which would cause wiki-sync to delete them. Maintained manually.
const SUBSPECIES_CREATURES = new Set([
  "Feral Korathos",
  "Ancient Galiryn",
  "Battle Kendyll",
  "Origin Caldonterrus",
]);

const WIKI_API =
  "https://creatures-of-sonaria-official.fandom.com/api.php";
const WIKI_PAGE_BASE = "https://creatures-of-sonaria-official.fandom.com/wiki/";
const USER_AGENT = "CoS-PvP-Calc/2.0 (wiki-sync)";
const PROD_PUSH_COMMIT_MESSAGE = "Sync wiki creature stats";
const DEFAULT_DIFF_BRANCH = "main";

type AbilityCategory = "passive" | "activated" | "breath";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface AbilityRef {
  abilityId: string;
  name: string;
  value: number | string | null;
  semantics: string;
  subtype: string | null;
}

interface CreatureStats {
  tier: number;
  health: number;
  weight: number;
  damage: number;
  biteCooldown: number;
  damage2: number | null;
  healthRegen: number | null;
  stamina: number | null;
  stamRegen: number | null;
  walkAndSwimSpeed: number | null;
  sprintSpeed: number | null;
  turn: number | null;
  venerationRate: number | null;
  diet: string;
  type: string;
  mobilityOverride: string;
  breath: string;
  breathResistance?: number | null;
  appetite: number | null;
  beachSpeed: number | null;
  flySpeed: number | null;
  flySprintMultiplier: number | null;
  glideStaminaRegen: number | null;
  takeoffMultiplier: number | null;
  jumpPower: number | null;
  jumpStamina: number | null;
  jumpAge: number | null;
  dartPower: number | null;
  dartStamina: number | null;
  nightvision: number | null;
  ambush: number | null;
  growthTime: number | null;
  hungerDrain: number | null;
  thirstDrain: number | null;
  moistureTime: number | null;
  oxygenTime: number | null;
}

interface CreatureRuntime {
  name: string;
  stats: CreatureStats;
  passiveAbilities: AbilityRef[];
  activatedAbilities: AbilityRef[];
  breathAbilities: AbilityRef[];
}

interface StatChange {
  field: keyof CreatureStats;
  oldValue: CreatureStats[keyof CreatureStats];
  newValue: CreatureStats[keyof CreatureStats];
  pvpRelevant: boolean;
}

interface UserSpecificStatChange {
  field: keyof CreatureStats;
  local: CreatureStats[keyof CreatureStats];
  wiki: CreatureStats[keyof CreatureStats];
  source: string;
  note: string;
}

interface AbilityValueChange {
  name: string;
  oldValue: number | string | null;
  newValue: number | string | null;
}

interface UserSpecificAbilityChange {
  source: string;
  note: string;
  local: AbilityRef;
  wiki: AbilityRef | null;
  reason: "wiki-missing" | "wiki-different";
}

interface AbilityDiff {
  added: AbilityRef[];
  removed: AbilityRef[];
  valueChanged: AbilityValueChange[];
  blocked: AbilityRef[];
  userSpecific: UserSpecificAbilityChange[];
}

interface CreatureDiff {
  name: string;
  kind: "new" | "changed" | "removed";
  merged?: CreatureRuntime;
  wiki?: WikiCreature;
  statsChanged: StatChange[];
  statsUserSpecific: UserSpecificStatChange[];
  passive: AbilityDiff;
  activated: AbilityDiff;
  breath: AbilityDiff;
}

interface IconSyncRequest {
  name: string;
  wiki?: WikiCreature;
  preferredUrl?: string | null;
}

interface WikiCreature {
  common: string;
  health: string;
  healthRegen: string;
  damage: string;
  damage2: string;
  biteCooldown: string;
  weight: string;
  tier: string;
  diet: string;
  type: string;
  walkAndSwimSpeed: string;
  sprintSpeed: string;
  stamina: string;
  stamRegen: string;
  turn: string;
  venerationRate: string;
  breath: string;
  passive: string;
  activated: string;
  imageLink: string;
  mobilityOverride: string;
  breathResistance?: string;
  appetite: string;
  beachSpeed: string;
  flySpeed: string;
  flySprintMultiplier: string;
  glideStaminaRegen: string;
  takeoffMultiplier: string;
  jumpPower: string;
  jumpStamina: string;
  jumpAge: string;
  dartPower: string;
  dartStamina: string;
  nightvision: string;
  ambush: string;
  growthTime: string;
  hungerDrain: string;
  thirstDrain: string;
  moistureTime: string;
  oxygenTime: string;
  [key: string]: string | undefined;
}

interface UserSpecificAbilityOverride {
  creature: string;
  category: AbilityCategory;
  matchAbilityName?: string;
  ability?: AbilityRef;
  abilities?: AbilityRef[];
  source: string;
  note: string;
}

const USER_SPECIFIC_ABILITY_OVERRIDES: UserSpecificAbilityOverride[] = [
  {
    creature: "Cryptoth",
    category: "passive",
    ability: {
      abilityId: "Burn_Attack",
      name: "Burn Attack",
      value: 2,
      semantics: "offensive",
      subtype: null,
    },
    source: "Crimson",
    note: "user reported Cryptoth has 2 Burn Attack in-game",
  },
  {
    creature: "Turrim",
    category: "passive",
    matchAbilityName: "Keen Observer Unbreakable",
    abilities: [
      {
        abilityId: "Keen_Observer",
        name: "Keen Observer",
        value: null,
        semantics: "neutral",
        subtype: null,
      },
      {
        abilityId: "Unbreakable",
        name: "Unbreakable",
        value: 2.25,
        semantics: "neutral",
        subtype: null,
      },
    ],
    source: "Tymamatyty",
    note: "user reported wiki missed the comma between Keen Observer and Unbreakable; Unbreakable keeps the listed 2.25 value",
  },
];

const USER_SPECIFIC_STAT_OVERRIDES: Array<{
  creature: string;
  field: keyof CreatureStats;
  value: CreatureStats[keyof CreatureStats];
  source: string;
  note: string;
}> = [
  {
    creature: "Imeaorn",
    field: "weight",
    value: 6000,
    source: "Senku",
    note: "user reported Imeaorn is 6k weight in-game",
  },
];

/* ------------------------------------------------------------------ */
/*  Wiki API                                                           */
/* ------------------------------------------------------------------ */

async function fetchWikiModule(): Promise<string> {
  const url = `${WIKI_API}?action=parse&page=Module:CreatureData/data&prop=wikitext&format=json`;
  console.log("  Fetching Module:CreatureData/data from wiki...");
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) throw new Error(`Wiki API returned ${res.status}`);
  const json = await res.json();
  return json.parse.wikitext["*"] as string;
}

/* ------------------------------------------------------------------ */
/*  Lua parser                                                         */
/* ------------------------------------------------------------------ */

function parseLuaCreatures(lua: string): Map<string, WikiCreature> {
  const creatures = new Map<string, WikiCreature>();

  // Wiki Lua format: each creature is one long line like:
  //   ["Adharcaiin"] = { ['common'] = "Adharcaiin", ['health'] = "1000", ... },
  // Split by entry pattern and parse each.

  const entryRegex =
    /\["([^"]+)"\]\s*=\s*\{([^}]+)\}/g;

  let match: RegExpExecArray | null;
  while ((match = entryRegex.exec(lua)) !== null) {
    const body = match[2];
    const creature: Record<string, string> = {};

    // Parse ['key'] = "value" or ['key'] = 'value'
    const kvRegex = /\['(\w+)'\]\s*=\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)')/g;
    let kv: RegExpExecArray | null;
    while ((kv = kvRegex.exec(body)) !== null) {
      const key = kv[1];
      const val = kv[2] !== undefined ? kv[2] : kv[3];
      creature[key] = val;
    }

    if (creature.common) {
      creatures.set(creature.common, creature as unknown as WikiCreature);
    }
  }

  return creatures;
}

/* ------------------------------------------------------------------ */
/*  Ability parsing                                                    */
/* ------------------------------------------------------------------ */

/**
 * Parse wiki ability string like:
 *   "Block Bleed (0.25), Poison Attack (4), Agile Swimmer, First Strike (0.2), Unbreakable 30"
 * into AbilityRef[].
 */
function parseAbilityString(
  raw: string,
  category: "passive" | "activated" | "breath"
): AbilityRef[] {
  if (!raw || raw === "N/A" || raw === "None" || raw.trim() === "")
    return [];

  const abilities: AbilityRef[] = [];
  // Split by comma, but be careful with nested parentheses
  const parts = raw.split(/,(?![^(]*\))/);

  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;

    // Match "Name (value)" or just "Name"
    const m = trimmed.match(/^(.+?)\s*(?:\(([^)]+)\))?\s*$/);
    if (!m) continue;

    let name = m[1].trim();
    let rawVal = m[2]?.trim();

    if (rawVal !== undefined && rawVal !== "") {
      // If "Name (Subtype)" matches a canonical parens-form ability (e.g.
      // "Aura (Disease)"), keep the parens as part of the name. Otherwise
      // the engine's exact-match lookups (hasActivatedAbilityNamed,
      // rustBestBuildsRuntime, etc.) would never find the ability.
      const candidate = `${name} (${rawVal})`;
      if (PARENS_NAME_CANONICAL_KEYS.has(canonicalAbilityNameKey(candidate))) {
        name = candidate;
        rawVal = undefined;
      }
    }

    if (rawVal === undefined || rawVal === "") {
      const trailingValue = parseTrailingAbilityValue(name);
      if (trailingValue) {
        name = trailingValue.name;
        rawVal = trailingValue.rawValue;
      }
    }

    name = normalizeAbilityDisplayName(name);

    let value: number | string | null = null;
    if (rawVal !== undefined && rawVal !== "") {
      const num = parseFloat(rawVal);
      value = isNaN(num) ? rawVal : num;
    }

    const abilityId = name.replace(/\s+/g, "_");
    const semantics = guessSemantic(name);

    abilities.push({
      abilityId,
      name,
      value,
      semantics,
      subtype: category === "breath" ? name : null,
    });
  }

  return abilities;
}

function parseTrailingAbilityValue(rawName: string): { name: string; rawValue: string } | null {
  const match = rawName.match(/^(.+?)\s+([+-]?\d+(?:\.\d+)?%?)$/);
  if (!match) return null;
  const name = match[1].trim();
  const rawValue = match[2].trim();
  if (!name) return null;
  return { name, rawValue };
}

function guessSemantic(name: string): string {
  const lc = name.toLowerCase();
  if (lc.startsWith("block")) return "block";
  if (
    lc.includes("attack") ||
    lc.includes("shredder") ||
    lc.includes("curse") ||
    lc.includes("venom") ||
    lc.includes("radiation") ||
    lc.includes("necropoison") &&
      !lc.startsWith("block")
  )
    return "offensive";
  if (
    lc.includes("resist") ||
    lc.includes("shield") ||
    lc.includes("fortify") ||
    lc.includes("guard")
  )
    return "defensive";
  return "neutral";
}

/* ------------------------------------------------------------------ */
/*  Conversion: Wiki → Runtime format                                  */
/* ------------------------------------------------------------------ */

function wikiToRuntime(w: WikiCreature): CreatureRuntime {
  const num = (s: string | undefined): number | null => {
    if (!s || s === "N/A" || s === "nil" || s === "") return null;
    // Handle percentage like "5%" → 5
    const cleaned = s.replace(/%/g, "").trim();
    const n = parseFloat(cleaned);
    return isNaN(n) ? null : n;
  };

  const numReq = (s: string | undefined, fallback: number): number => {
    const n = num(s);
    return n !== null ? n : fallback;
  };

  // Wiki stores healthRegen as a decimal fraction (0.07 = 7%).
  // Our local format uses the percentage number directly (7.0).
  let healthRegen = num(w.healthRegen);
  if (healthRegen !== null && healthRegen > 0 && healthRegen < 1) {
    healthRegen = Math.round(healthRegen * 100 * 100) / 100; // 0.07 → 7
  }

  const stats: CreatureStats = {
    tier: numReq(w.tier, 1),
    health: numReq(w.health, 100),
    weight: numReq(w.weight, 100),
    damage: numReq(w.damage, 10),
    biteCooldown: numReq(w.biteCooldown, 1),
    damage2: num(w.damage2),
    healthRegen,
    stamina: num(w.stamina),
    stamRegen: num(w.stamRegen),
    walkAndSwimSpeed: num(w.walkAndSwimSpeed),
    sprintSpeed: num(w.sprintSpeed),
    turn: num(w.turn),
    venerationRate: num(w.venerationRate),
    diet: w.diet || "",
    type: w.type || "",
    mobilityOverride: w.mobilityOverride || "",
    breath: w.breath || "N/A",
    appetite: num(w.appetite),
    beachSpeed: num(w.beachSpeed),
    flySpeed: num(w.flySpeed),
    flySprintMultiplier: num(w.flySprintMultiplier),
    glideStaminaRegen: num(w.glideStaminaRegen),
    takeoffMultiplier: num(w.takeoffMultiplier),
    jumpPower: num(w.jumpPower),
    jumpStamina: num(w.jumpStamina),
    jumpAge: num(w.jumpAge),
    dartPower: num(w.dartPower),
    dartStamina: num(w.dartStamina),
    nightvision: num(w.nightvision),
    ambush: num(w.ambush),
    growthTime: num(w.growthTime),
    hungerDrain: num(w.hungerDrain),
    thirstDrain: num(w.thirstDrain),
    moistureTime: num(w.moistureTime),
    oxygenTime: num(w.oxygenTime),
  };

  // Parse breath resistance if present
  if (w.breathResistance && w.breathResistance !== "N/A") {
    const br = parseFloat(w.breathResistance);
    if (!isNaN(br)) stats.breathResistance = br;
  }

  // Parse abilities
  const passiveAbilities = parseAbilityString(w.passive ?? "", "passive");
  const activatedAbilities = parseAbilityString(
    w.activated ?? "",
    "activated"
  );

  // Build breath abilities from the breath stat
  const breathAbilities: AbilityRef[] = [];
  if (stats.breath && stats.breath !== "N/A") {
    breathAbilities.push({
      abilityId: "Breath",
      name: stats.breath,
      value: null,
      semantics: "neutral",
      subtype: stats.breath,
    });
  }

  return {
    name: w.common,
    stats,
    passiveAbilities,
    activatedAbilities,
    breathAbilities,
  };
}

function createEmptyAbilityDiff(): AbilityDiff {
  return {
    added: [],
    removed: [],
    valueChanged: [],
    blocked: [],
    userSpecific: [],
  };
}

function createEmptyCreatureDiff(
  name: string,
  kind: CreatureDiff["kind"],
  wiki?: WikiCreature,
): CreatureDiff {
  return {
    name,
    kind,
    wiki,
    statsChanged: [],
    statsUserSpecific: [],
    passive: createEmptyAbilityDiff(),
    activated: createEmptyAbilityDiff(),
    breath: createEmptyAbilityDiff(),
  };
}

function formatValue(value: number | string | null | undefined): string {
  if (value === undefined || value === null || value === "") return "none";
  return String(value);
}

function formatAbilityRef(ability: AbilityRef): string {
  return ability.value !== null && ability.value !== undefined
    ? `${ability.name} (${formatValue(ability.value)})`
    : ability.name;
}

function normalizeAbilityDisplayName(name: string): string {
  return normalizeAbilityDisplayNameShared(name);
}

function canonicalAbilityName(name: string): string {
  return canonicalAbilityNameKey(name);
}

function canonicalAbilityKey(ability: Pick<AbilityRef, "name" | "value">): string {
  if (typeof ability.value === "string" && ability.value.trim() !== "") {
    return canonicalAbilityName(ability.name + " " + ability.value);
  }
  return canonicalAbilityName(ability.name);
}

function isAuraAbilityName(name: string): boolean {
  return name.trim().toLowerCase().startsWith("aura");
}

function isRepresentationOnlyValueShift(localAbility: AbilityRef, wikiAbility: AbilityRef): boolean {
  if (localAbility.value === wikiAbility.value) {
    return false;
  }
  const hasStringValue =
    typeof localAbility.value === "string" ||
    typeof wikiAbility.value === "string";
  return hasStringValue && canonicalAbilityKey(localAbility) === canonicalAbilityKey(wikiAbility);
}

function userSpecificOverridesFor(creatureName: string, category: AbilityCategory) {
  return USER_SPECIFIC_ABILITY_OVERRIDES.filter(
    (entry) =>
      entry.category === category &&
      entry.creature.toLowerCase() === creatureName.toLowerCase(),
  );
}

function userSpecificStatOverridesFor(creatureName: string) {
  return USER_SPECIFIC_STAT_OVERRIDES.filter(
    (entry) => entry.creature.toLowerCase() === creatureName.toLowerCase(),
  );
}

function applyUserSpecificStatOverrides(creature: CreatureRuntime): CreatureRuntime {
  const overrides = userSpecificStatOverridesFor(creature.name);
  if (overrides.length === 0) return creature;
  const patched = JSON.parse(JSON.stringify(creature)) as CreatureRuntime;
  for (const override of overrides) {
    (patched.stats as Record<string, unknown>)[override.field] = override.value;
  }
  return patched;
}

function findUserSpecificOverride(
  overrides: ReturnType<typeof userSpecificOverridesFor>,
  ability: AbilityRef,
) {
  return overrides.find((entry) => canonicalAbilityName(userSpecificOverrideMatchName(entry)) === canonicalAbilityName(ability.name));
}

function userSpecificOverrideMatchName(override: UserSpecificAbilityOverride): string {
  return override.matchAbilityName ?? override.ability?.name ?? override.abilities?.[0]?.name ?? "";
}

function userSpecificOverrideAbilities(override: UserSpecificAbilityOverride): AbilityRef[] {
  return (override.abilities ?? (override.ability ? [override.ability] : [])).map((ability) => ({ ...ability }));
}

function abilityListEquivalent(left: AbilityRef[], right: AbilityRef[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((ability, index) => abilitiesEquivalent(ability, right[index]));
}

function abilitiesEquivalent(left: AbilityRef, right: AbilityRef): boolean {
  return (
    canonicalAbilityKey(left) === canonicalAbilityKey(right) &&
    JSON.stringify(left.value) === JSON.stringify(right.value) &&
    left.abilityId === right.abilityId &&
    left.semantics === right.semantics &&
    left.subtype === right.subtype
  );
}

function abilityDiffHasChanges(diff: AbilityDiff): boolean {
  return (
    diff.added.length > 0 ||
    diff.removed.length > 0 ||
    diff.valueChanged.length > 0 ||
    diff.userSpecific.length > 0
  );
}

function creatureDiffHasVisibleChanges(diff: CreatureDiff, pvpOnly: boolean): boolean {
  const statsChanged = pvpOnly
    ? diff.statsChanged.filter((entry) => entry.pvpRelevant)
    : diff.statsChanged;
  return (
    diff.kind !== "changed" ||
    statsChanged.length > 0 ||
    diff.statsUserSpecific.length > 0 ||
    abilityDiffHasChanges(diff.passive) ||
    abilityDiffHasChanges(diff.activated) ||
    abilityDiffHasChanges(diff.breath)
  );
}

function buildRemovedCreatureDiff(name: string): CreatureDiff {
  return createEmptyCreatureDiff(name, "removed");
}

/* ------------------------------------------------------------------ */
/*  Preserve local overrides                                           */
/* ------------------------------------------------------------------ */

/**
 * When merging wiki data into existing local data, we preserve
 * local semantics overrides for matching abilities, but the
 * creature-sheet ability list itself follows the wiki.
 */
function mergeCreature(
  local: CreatureRuntime,
  wiki: CreatureRuntime
): { merged: CreatureRuntime; diff: CreatureDiff } {
  const diff = createEmptyCreatureDiff(local.name, "changed");

  const merged = applyUserSpecificStatOverrides(wiki);

  const PVP_STATS = new Set<string>([
    "tier", "health", "weight", "damage", "damage2",
    "biteCooldown", "healthRegen", "breath", "breathResistance",
    "appetite",
  ]);

  for (const override of userSpecificStatOverridesFor(local.name)) {
    const wikiValue = wiki.stats[override.field];
    if (JSON.stringify(wikiValue) === JSON.stringify(override.value)) continue;
    diff.statsUserSpecific.push({
      field: override.field,
      local: override.value,
      wiki: wikiValue,
      source: override.source,
      note: override.note,
    });
  }

  for (const key of Object.keys(merged.stats) as (keyof CreatureStats)[]) {
    const oldVal = local.stats[key];
    const newVal = merged.stats[key];
    if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
      diff.statsChanged.push({
        field: key,
        oldValue: oldVal,
        newValue: newVal,
        pvpRelevant: PVP_STATS.has(key),
      });
    }
  }

  const wikiAbilityCanonicals = new Set(
    [...wiki.passiveAbilities, ...wiki.activatedAbilities, ...wiki.breathAbilities].map((ability) =>
      canonicalAbilityKey(ability)
    )
  );

  function mergeAbilities(
    category: AbilityCategory,
    localAbs: AbilityRef[],
    wikiAbs: AbilityRef[],
    abilityDiff: AbilityDiff
  ): AbilityRef[] {
    const result: AbilityRef[] = [];
    const remainingLocal = [...localAbs];
    const userOverrides = userSpecificOverridesFor(local.name, category);

    for (const wa of wikiAbs) {
      const localMatchIndex = remainingLocal.findIndex(
        (localAbility) =>
          canonicalAbilityKey(localAbility) === canonicalAbilityKey(wa)
      );
      const localMatch = localMatchIndex >= 0 ? remainingLocal[localMatchIndex] : null;
      if (localMatch) {
        const userOverride = findUserSpecificOverride(userOverrides, localMatch);
        if (userOverride) {
          const replacementAbilities = userSpecificOverrideAbilities(userOverride);
          if (!abilityListEquivalent(replacementAbilities, [wa])) {
            for (const replacementAbility of replacementAbilities) {
              abilityDiff.userSpecific.push({
                source: userOverride.source,
                note: userOverride.note,
                local: { ...replacementAbility },
                wiki: { ...wa },
                reason: "wiki-different",
              });
            }
          }
          result.push(...replacementAbilities);
          remainingLocal.splice(localMatchIndex, 1);
          continue;
        }

        const ab = { ...wa };
        if (localMatch.semantics !== wa.semantics) {
          ab.semantics = localMatch.semantics;
        }
        if (localMatch.abilityId !== wa.abilityId) {
          ab.abilityId = localMatch.abilityId;
        }
        if (
          JSON.stringify(localMatch.value) !== JSON.stringify(wa.value) &&
          !isRepresentationOnlyValueShift(localMatch, wa)
        ) {
          abilityDiff.valueChanged.push({
            name: wa.name,
            oldValue: localMatch.value,
            newValue: wa.value,
          });
        }
        result.push(ab);
        remainingLocal.splice(localMatchIndex, 1);
      } else if (findUserSpecificOverride(userOverrides, wa)) {
        const userOverride = findUserSpecificOverride(userOverrides, wa)!;
        const replacementAbilities = userSpecificOverrideAbilities(userOverride);
        result.push(...replacementAbilities);
        for (const replacementAbility of replacementAbilities) {
          abilityDiff.userSpecific.push({
            source: userOverride.source,
            note: userOverride.note,
            local: { ...replacementAbility },
            wiki: { ...wa },
            reason: "wiki-different",
          });
        }
      } else {
        abilityDiff.added.push(wa);
        result.push(wa);
      }
    }

    for (const localOnly of remainingLocal) {
      const hiddenAsCategoryMismatch = wikiAbilityCanonicals.has(canonicalAbilityKey(localOnly));
      const userOverride = findUserSpecificOverride(userOverrides, localOnly);
      if (userOverride) {
        const replacementAbilities = userSpecificOverrideAbilities(userOverride);
        result.push(...replacementAbilities);
        for (const replacementAbility of replacementAbilities) {
          abilityDiff.userSpecific.push({
            source: userOverride.source,
            note: userOverride.note,
            local: { ...replacementAbility },
            wiki: null,
            reason: "wiki-missing",
          });
        }
        continue;
      }
      if (hiddenAsCategoryMismatch) {
        continue;
      }
      abilityDiff.removed.push(localOnly);
    }

    for (const userOverride of userOverrides) {
      const replacementAbilities = userSpecificOverrideAbilities(userOverride);
      const alreadyPresent = replacementAbilities.every((replacementAbility) =>
        result.some((ability) => canonicalAbilityName(ability.name) === canonicalAbilityName(replacementAbility.name)),
      );
      if (alreadyPresent) continue;
      for (const replacementAbility of replacementAbilities) {
        const replacementAlreadyPresent = result.some(
          (ability) => canonicalAbilityName(ability.name) === canonicalAbilityName(replacementAbility.name),
        );
        if (replacementAlreadyPresent) continue;
        result.push({ ...replacementAbility });
        abilityDiff.userSpecific.push({
          source: userOverride.source,
          note: userOverride.note,
          local: { ...replacementAbility },
          wiki: null,
          reason: "wiki-missing",
        });
      }
    }

    return result;
  }

  merged.passiveAbilities = mergeAbilities(
    "passive",
    local.passiveAbilities,
    wiki.passiveAbilities,
    diff.passive
  );
  merged.activatedAbilities = mergeAbilities(
    "activated",
    local.activatedAbilities,
    wiki.activatedAbilities,
    diff.activated
  );
  merged.breathAbilities = mergeAbilities(
    "breath",
    local.breathAbilities,
    wiki.breathAbilities,
    diff.breath
  );

  return { merged, diff };
}

/* ------------------------------------------------------------------ */
/*  Icons                                                              */
/* ------------------------------------------------------------------ */

const creaturePageImageCache = new Map<string, string[]>();
const creaturePageApiImageCache = new Map<string, string[]>();

function canonicalCreatureToken(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function buildCreaturePageUrl(name: string): string {
  return WIKI_PAGE_BASE + encodeURIComponent(name.replace(/\s+/g, "_"));
}

function normalizeWikiImageUrl(url: string): string {
  return url
    .replace(/&amp;/g, "&")
    .replace(/\/revision\/latest\/scale-to-width-down\/\d+/i, "/revision/latest");
}

function scoreCreatureImageCandidate(name: string, url: string): number {
  const lc = url.toLowerCase();
  const creatureToken = canonicalCreatureToken(name);
  const basename = lc.split("/").pop() ?? lc;
  const basenameToken = canonicalCreatureToken(basename);
  let score = 0;

  if (basenameToken.includes(creatureToken)) score += 100;
  if (lc.includes("male-stock") || lc.includes("female-stock")) score += 80;
  if (lc.includes("stock")) score += 60;
  if (lc.includes("render")) score += 40;
  if (lc.includes("concept")) score -= 40;
  if (lc.includes("icon")) score -= 10;
  if (lc.includes("/revision/latest")) score += 5;
  if (/\.(png)(?:$|[?/])/i.test(url)) score += 5;

  return score;
}

function extractCreaturePageImageCandidates(name: string, html: string): string[] {
  const token = canonicalCreatureToken(name);
  const matches = html.match(/https:\/\/static\.wikia\.nocookie\.net\/[^"'<>\s)]+/gi) ?? [];
  const deduped = new Map<string, number>();

  for (const rawMatch of matches) {
    const candidate = normalizeWikiImageUrl(rawMatch);
    if (!/\.(png|jpg|jpeg|webp|gif)(?:$|[?/])/i.test(candidate)) continue;
    const basename = candidate.split("/").pop() ?? candidate;
    if (!canonicalCreatureToken(basename).includes(token)) continue;
    deduped.set(candidate, scoreCreatureImageCandidate(name, candidate));
  }

  return [...deduped.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([candidate]) => candidate);
}

async function fetchCreaturePageImageCandidates(name: string): Promise<string[]> {
  const cached = creaturePageImageCache.get(name);
  if (cached) return cached;

  try {
    const res = await fetch(buildCreaturePageUrl(name), {
      headers: { "User-Agent": USER_AGENT },
    });
    if (!res.ok) {
      creaturePageImageCache.set(name, []);
      return [];
    }
    const html = await res.text();
    const candidates = extractCreaturePageImageCandidates(name, html);
    creaturePageImageCache.set(name, candidates);
    return candidates;
  } catch {
    creaturePageImageCache.set(name, []);
    return [];
  }
}

async function fetchCreaturePageApiImageCandidates(name: string): Promise<string[]> {
  const cached = creaturePageApiImageCache.get(name);
  if (cached) return cached;

  try {
    const parseUrl =
      `${WIKI_API}?action=parse&page=${encodeURIComponent(name)}&prop=images&format=json`;
    const parseJson = await fetch(parseUrl, {
      headers: { "User-Agent": USER_AGENT },
    }).then((res) => {
      if (!res.ok) throw new Error(`parse images failed: ${res.status}`);
      return res.json();
    });

    const images = (parseJson.parse?.images ?? []) as string[];
    const likelyFiles = images.filter((fileName) => {
      const lc = fileName.toLowerCase();
      return /\.(png|jpg|jpeg|webp|gif)$/i.test(fileName) && (
        lc.includes("stock") ||
        lc.includes(name.toLowerCase().replace(/[^a-z0-9]+/g, "")) ||
        canonicalCreatureToken(fileName).includes(canonicalCreatureToken(name))
      );
    });

    if (likelyFiles.length === 0) {
      creaturePageApiImageCache.set(name, []);
      return [];
    }

    const titles = likelyFiles.map((fileName) => `File:${fileName}`).join("|");
    const imageInfoUrl =
      `${WIKI_API}?action=query&titles=${encodeURIComponent(titles)}&prop=imageinfo&iiprop=url&format=json`;
    const imageInfoJson = await fetch(imageInfoUrl, {
      headers: { "User-Agent": USER_AGENT },
    }).then((res) => {
      if (!res.ok) throw new Error(`imageinfo failed: ${res.status}`);
      return res.json();
    });

    const pages = Object.values(imageInfoJson.query?.pages ?? {}) as Array<{
      imageinfo?: Array<{ url?: string }>;
    }>;
    const candidates = pages
      .flatMap((page) => page.imageinfo ?? [])
      .map((entry) => entry.url ?? "")
      .filter(Boolean)
      .map((url) => normalizeWikiImageUrl(url));

    creaturePageApiImageCache.set(name, candidates);
    return candidates;
  } catch {
    creaturePageApiImageCache.set(name, []);
    return [];
  }
}

async function resolveIconCandidates(request: IconSyncRequest): Promise<string[]> {
  const deduped = new Map<string, number>();
  const push = (candidate: string | null | undefined) => {
    if (!candidate || candidate === "N/A") return;
    const normalized = normalizeWikiImageUrl(candidate);
    deduped.set(normalized, scoreCreatureImageCandidate(request.name, normalized));
  };

  push(request.preferredUrl);
  push(request.wiki?.imageLink);

  for (const candidate of await fetchCreaturePageApiImageCandidates(request.name)) {
    push(candidate);
  }

  for (const candidate of await fetchCreaturePageImageCandidates(request.name)) {
    push(candidate);
  }

  return [...deduped.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([candidate]) => candidate);
}

async function downloadIcon(
  name: string,
  imageUrls: string[]
): Promise<string | null> {
  if (imageUrls.length === 0) return null;
  try {
    const safeName = name
      .replace(/['']/g, "")
      .replace(/[^a-zA-Z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 120);
    for (const imageUrl of imageUrls) {
      const ext =
        imageUrl.match(/\.(png|jpg|jpeg|webp|gif)(?:\?|\/|$)/i)?.[1]
          ?.toLowerCase()
          .replace("jpeg", "jpg") ?? "png";
      const fileName = `${safeName}.${ext}`;
      const outPath = path.join(ICONS_DIR, fileName);

      if (fs.existsSync(outPath)) return `/icons/creatures/${fileName}`;

      const res = await fetch(imageUrl, {
        headers: { "User-Agent": USER_AGENT },
      });
      if (!res.ok) {
        continue;
      }
      const buf = Buffer.from(await res.arrayBuffer());
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, buf);
      console.log(`  Downloaded icon: ${fileName}`);
      return `/icons/creatures/${fileName}`;
    }

    console.warn(`  Icon download failed for ${name}: no usable image candidates`);
    return null;
  } catch (e) {
    console.warn(
      `  Icon download error for ${name}: ${e instanceof Error ? e.message : e}`
    );
    return null;
  }
}

/* ------------------------------------------------------------------ */
/*  Local data I/O                                                     */
/* ------------------------------------------------------------------ */

function readLocalCreatures(): CreatureRuntime[] {
  const raw = JSON.parse(fs.readFileSync(CREATURES_FILE, "utf-8"));
  return raw.creatures as CreatureRuntime[];
}

function wikiSyncDiffBranch(): string {
  return process.env.COS_WIKI_SYNC_DIFF_BRANCH?.trim() || DEFAULT_DIFF_BRANCH;
}

function readDiffBaselineCreatures(): CreatureRuntime[] {
  const branch = wikiSyncDiffBranch();
  const repoPath = path.relative(ROOT, CREATURES_FILE).replace(/\\/g, "/");
  const rawText = execFileSync("git", ["show", `${branch}:${repoPath}`], {
    cwd: ROOT,
    encoding: "utf-8",
    maxBuffer: 16 * 1024 * 1024,
  });
  const raw = JSON.parse(rawText);
  return raw.creatures as CreatureRuntime[];
}

function writeLocalCreatures(creatures: CreatureRuntime[]) {
  const sorted = [...creatures].sort((a, b) =>
    a.name.localeCompare(b.name, "en", { sensitivity: "base" })
  );
  fs.writeFileSync(
    CREATURES_FILE,
    JSON.stringify({ creatures: sorted }, null, 2) + "\n",
    "utf-8"
  );
}

function readIcons(): Record<string, string> {
  try {
    const raw = JSON.parse(fs.readFileSync(ICONS_FILE, "utf-8"));
    return raw.icons ?? {};
  } catch {
    return {};
  }
}

function writeIcons(icons: Record<string, string>) {
  const sorted = Object.fromEntries(
    Object.entries(icons).sort(([a], [b]) => a.localeCompare(b))
  );
  fs.writeFileSync(
    ICONS_FILE,
    JSON.stringify(
      {
        source: "local-cache",
        count: Object.keys(sorted).length,
        icons: sorted,
      },
      null,
      2
    ) + "\n",
    "utf-8"
  );
}

function queueIconRequest(
  requests: IconSyncRequest[],
  seen: Set<string>,
  name: string,
  wiki?: WikiCreature,
  preferredUrl?: string | null,
) {
  const key = name.toLowerCase();
  if (seen.has(key)) return;
  seen.add(key);
  requests.push({ name, wiki, preferredUrl });
}

/* ------------------------------------------------------------------ */
/*  Rendering / Discord                                                */
/* ------------------------------------------------------------------ */

function pushCategoryLines(
  lines: string[],
  label: string,
  diff: AbilityDiff,
) {
  if (diff.added.length > 0) {
    lines.push(`  ${label} added: ${diff.added.map(formatAbilityRef).join(", ")}`);
  }
  if (diff.valueChanged.length > 0) {
    lines.push(
      `  ${label} value: ${diff.valueChanged
        .map((entry) => `${entry.name} (${formatValue(entry.oldValue)} -> ${formatValue(entry.newValue)})`)
        .join(", ")}`,
    );
  }
  if (diff.removed.length > 0) {
    lines.push(`  ${label} removed from wiki: ${diff.removed.map(formatAbilityRef).join(", ")}`);
  }
  if (diff.userSpecific.length > 0) {
    lines.push(
      `  ${label} user-specific: ${diff.userSpecific
        .map((entry) => {
          const wikiText = entry.wiki ? formatAbilityRef(entry.wiki) : "missing from wiki";
          return `${formatAbilityRef(entry.local)} kept; wiki ${wikiText}; source ${entry.source}; ${entry.note}`;
        })
        .join(", ")}`,
    );
  }
}

function renderCreatureDiff(diff: CreatureDiff, pvpOnly: boolean): string[] {
  const lines: string[] = [];
  if (diff.kind === "new") {
    const merged = diff.merged;
    lines.push(`${diff.name}:`);
    lines.push("  new creature from wiki");
    if (merged) {
      lines.push(
        `  stats: tier ${merged.stats.tier}, health ${merged.stats.health}, weight ${merged.stats.weight}, damage ${merged.stats.damage}, biteCooldown ${merged.stats.biteCooldown}, breath ${merged.stats.breath}`,
      );
      if (merged.passiveAbilities.length > 0) {
        lines.push(`  passive added: ${merged.passiveAbilities.map(formatAbilityRef).join(", ")}`);
      }
      if (merged.activatedAbilities.length > 0) {
        lines.push(`  activated added: ${merged.activatedAbilities.map(formatAbilityRef).join(", ")}`);
      }
      if (merged.breathAbilities.length > 0) {
        lines.push(`  breath added: ${merged.breathAbilities.map(formatAbilityRef).join(", ")}`);
      }
    }
    return lines;
  }

  if (diff.kind === "removed") {
    lines.push(`${diff.name}:`);
    lines.push("  removed from wiki");
    return lines;
  }

  const statsChanged = pvpOnly
    ? diff.statsChanged.filter((entry) => entry.pvpRelevant)
    : diff.statsChanged;
  lines.push(`${diff.name}:`);
  for (const entry of statsChanged) {
    const tag = entry.pvpRelevant ? "" : " [speed/misc]";
    lines.push(`  stat ${entry.field}: ${formatValue(entry.oldValue)} -> ${formatValue(entry.newValue)}${tag}`);
  }
  if (diff.statsUserSpecific.length > 0) {
    lines.push(
      `  stat user-specific: ${diff.statsUserSpecific
        .map(
          (entry) =>
            `${String(entry.field)} kept ${formatValue(entry.local)}; wiki ${formatValue(entry.wiki)}; source ${entry.source}; ${entry.note}`,
        )
        .join(", ")}`,
    );
  }
  pushCategoryLines(lines, "passive", diff.passive);
  pushCategoryLines(lines, "activated", diff.activated);
  pushCategoryLines(lines, "breath", diff.breath);
  return lines;
}

function formatCount(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function buildDiscordSummary(newCount: number, changedCount: number, removedCount: number): string {
  return [
    "Wiki sync update",
    `${formatCount(newCount, "new creature", "new creatures")}, ${formatCount(changedCount, "changed creature", "changed creatures")}, ${formatCount(removedCount, "removed creature", "removed creatures")}.`,
  ].join("\n");
}

function buildDiscordBlocks(
  diffs: CreatureDiff[],
  pvpOnly: boolean,
  summary?: string,
): string[] {
  const blocks = diffs
    .filter((diff) => creatureDiffHasVisibleChanges(diff, pvpOnly))
    .map((diff) => renderCreatureDiff(diff, pvpOnly).join("\n"));

  const messages: string[] = [];
  let current = summary ?? "";
  for (const block of blocks) {
    if (!block) continue;
    const candidate = current ? `${current}\n\n${block}` : block;
    if (candidate.length > 1800 && current) {
      messages.push(current);
      current = block;
    } else {
      current = candidate;
    }
  }
  if (current) messages.push(current);
  return messages;
}

function readDiscordWebhook(): string | null {
  const fromEnv = process.env.COS_WIKI_SYNC_DISCORD_WEBHOOK?.trim();
  if (fromEnv) return fromEnv;
  try {
    const fromFile = fs.readFileSync(WEBHOOK_FILE, "utf-8").trim();
    return fromFile || null;
  } catch {
    return null;
  }
}

async function sendDiscordMessages(webhookUrl: string, messages: string[]): Promise<void> {
  for (const content of messages) {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": USER_AGENT,
      },
      body: JSON.stringify({ content }),
    });
    if (!res.ok) {
      throw new Error(`Discord webhook returned ${res.status}`);
    }
  }
}

/* ------------------------------------------------------------------ */
/*  Interactive prompt                                                 */
/* ------------------------------------------------------------------ */

function ask(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function gitPath(absolutePath: string): string {
  return path.relative(ROOT, absolutePath).replace(/\\/g, "/");
}

function prodPushPaths(includeIcons: boolean): string[] {
  // effects_catalog is re-derived from creatures.runtime by syncEffectsCatalog()
  // on every run, so it MUST ship in the same push - otherwise the committed
  // catalog drifts behind creatures.runtime (a newly-synced creature ends up
  // missing its catalog entry and fails the effectsCatalogDrift test on prod CI).
  const paths = [gitPath(CREATURES_FILE), gitPath(EFFECTS_CATALOG_FILE)];
  if (includeIcons) {
    paths.push(gitPath(ICONS_FILE), gitPath(ICONS_DIR));
  }
  return paths;
}

function gitOutput(args: string[]): string {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf-8" }).trim();
}

function gitInherit(args: string[]): void {
  execFileSync("git", args, { cwd: ROOT, stdio: "inherit" });
}

function gitStatusFor(paths: string[]): string {
  return gitOutput(["status", "--porcelain", "--", ...paths]);
}

function ensureProdPushPathsClean(paths: string[]) {
  const status = gitStatusFor(paths);
  if (status) {
    throw new Error(
      [
        "--push-prod requires wiki-sync output paths to be clean before the run.",
        "Existing changes:",
        status,
      ].join("\n"),
    );
  }
}

function currentGitBranch(): string {
  const branch = gitOutput(["rev-parse", "--abbrev-ref", "HEAD"]);
  if (!branch || branch === "HEAD") {
    throw new Error("--push-prod requires a checked-out branch, not detached HEAD");
  }
  return branch;
}

function prodPushBranch(): string {
  return process.env.COS_WIKI_SYNC_PUSH_BRANCH?.trim() || "main";
}

function pushWikiSyncChangesToProd(paths: string[]) {
  const status = gitStatusFor(paths);
  if (!status) {
    console.log("  No wiki-sync stat changes to push.");
    return;
  }

  const currentBranch = currentGitBranch();
  const branch = prodPushBranch();
  if (currentBranch !== branch) {
    throw new Error(
      `--push-prod commits wiki-sync output to ${branch}. Current branch is ${currentBranch}; switch to ${branch} or set COS_WIKI_SYNC_PUSH_BRANCH.`,
    );
  }
  const message = process.env.COS_WIKI_SYNC_COMMIT_MESSAGE?.trim() || PROD_PUSH_COMMIT_MESSAGE;
  console.log(`\n  Pushing wiki-sync stat changes to prod via origin/${branch}...`);

  gitInherit(["add", "--", ...paths]);
  gitInherit(["commit", "--only", "-m", message, "--", ...paths]);
  gitInherit(["push", "origin", branch]);
  console.log(`  Pushed wiki-sync stat changes to origin/${branch}.`);
}

/* ------------------------------------------------------------------ */
/*  Main sync logic                                                    */
/* ------------------------------------------------------------------ */

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry");
  const syncAll = args.includes("--all");
  const downloadIcons = args.includes("--icons");
  const downloadAllMissingIcons = args.includes("--icons-all");
  const pvpOnly = args.includes("--pvp");
  const forceSendDiscord = args.includes("--send-discord");
  const skipDiscord = args.includes("--no-discord");
  const pushProd = args.includes("--push-prod");
  const forceApply = args.includes("--apply");
  const skipApply = args.includes("--no-apply");
  const specificNames = args.filter((a) => !a.startsWith("--"));
  const webhookUrl = readDiscordWebhook();
  const pathsToPush = prodPushPaths(downloadIcons || downloadAllMissingIcons);

  console.log("\n=== CoS Wiki Sync ===\n");

  // 1. Fetch wiki data
  const luaSource = await fetchWikiModule();
  const wikiCreatures = parseLuaCreatures(luaSource);
  console.log(`  Wiki has ${wikiCreatures.size} creatures\n`);

  // 2. Load main-branch baseline for review/diff. Writes still target the
  // current checkout later, but previews must be stable and prod-facing.
  const diffBranch = wikiSyncDiffBranch();
  const localCreatures = readDiffBaselineCreatures();
  const localByName = new Map(localCreatures.map((c) => [c.name, c]));
  console.log(`  Diff baseline ${diffBranch} has ${localCreatures.length} creatures\n`);

  // 3. Find differences
  const newCreatures: Array<{ wiki: WikiCreature; merged: CreatureRuntime; diff: CreatureDiff }> = [];
  const changedCreatures: Array<{
    name: string;
    wiki: WikiCreature;
    merged: CreatureRuntime;
    diff: CreatureDiff;
    hasLocalWriteChange: boolean;
  }> = [];
  const removedCreatureNames = localCreatures
    .map((creature) => creature.name)
    .filter((name) => !wikiCreatures.has(name) && !SUBSPECIES_CREATURES.has(name));
  const removedCreatures = removedCreatureNames.map(buildRemovedCreatureDiff);
  const unchangedCount = { n: 0 };

  for (const [name, wikiData] of wikiCreatures) {
    if (SUBSPECIES_CREATURES.has(name)) {
      continue;
    }
    const wikiRuntime = wikiToRuntime(wikiData);
    const local = localByName.get(name);

    if (!local) {
      const merged = applyUserSpecificStatOverrides(wikiRuntime);
      const diff = createEmptyCreatureDiff(name, "new", wikiData);
      diff.merged = merged;
      newCreatures.push({ wiki: wikiData, merged, diff });
    } else {
      const { merged, diff } = mergeCreature(local, wikiRuntime);
      const hasLocalWriteChange = JSON.stringify(merged) !== JSON.stringify(local);
      if (creatureDiffHasVisibleChanges(diff, false)) {
        changedCreatures.push({ name, wiki: wikiData, merged, diff, hasLocalWriteChange });
      } else {
        unchangedCount.n++;
      }
    }
  }

  // Report
  console.log(
    `  New: ${newCreatures.length} | Changed: ${changedCreatures.length} | Removed: ${removedCreatureNames.length} | Unchanged: ${unchangedCount.n}\n`
  );

  const allDiffs: CreatureDiff[] = [
    ...newCreatures.map((entry) => entry.diff),
    ...changedCreatures.map((entry) => entry.diff),
    ...removedCreatures,
  ];
  const changedCreaturesToWrite = changedCreatures.filter((entry) => entry.hasLocalWriteChange);
  const plannedWriteCount = newCreatures.length + changedCreaturesToWrite.length;

  // Determine which creatures to sync
  const toSync: CreatureRuntime[] = [];
  const iconRequests: IconSyncRequest[] = [];
  const queuedIconNames = new Set<string>();
  let removeMissingCreatures = false;
  let shouldSendDiscord = false;
  let shouldApply = false;

  if (specificNames.length > 0) {
    // Sync only specific creatures
    for (const name of specificNames) {
      if (SUBSPECIES_CREATURES.has(name)) {
        console.log(`  ${name}: skipped by local wiki-sync exclusion`);
        continue;
      }
      const wikiData = [...wikiCreatures.values()].find(
        (w) => w.common.toLowerCase() === name.toLowerCase()
      );
      if (!wikiData) {
        console.log(`  WARNING: "${name}" not found in wiki data`);
        continue;
      }
      const wikiRuntime = wikiToRuntime(wikiData);
      const local = localByName.get(wikiData.common);
      if (local) {
        const { merged, diff } = mergeCreature(local, wikiRuntime);
        if (creatureDiffHasVisibleChanges(diff, pvpOnly)) {
          console.log(`\n  Changes for ${wikiData.common}:`);
          renderCreatureDiff(diff, pvpOnly).forEach((line) => console.log(`    ${line}`));
        } else {
          console.log(`  ${wikiData.common}: no changes`);
        }
        toSync.push(merged);
      } else {
        const merged = applyUserSpecificStatOverrides(wikiRuntime);
        console.log(`  NEW: ${wikiData.common}`);
        renderCreatureDiff({ ...createEmptyCreatureDiff(wikiData.common, "new", wikiData), merged }, pvpOnly)
          .forEach((line) => console.log(`    ${line}`));
        toSync.push(merged);
      }
      if (downloadIcons || downloadAllMissingIcons) {
        queueIconRequest(iconRequests, queuedIconNames, wikiData.common, wikiData, wikiData.imageLink);
      }
    }
  } else {
    // Show all changes
    const displayDiffs = allDiffs.filter((diff) => creatureDiffHasVisibleChanges(diff, pvpOnly));
    if (displayDiffs.length > 0) {
      if (pvpOnly) {
        console.log(`  --- PvP-relevant changes (${displayDiffs.length} creatures) ---`);
        console.log("  (skipping speed/stamina/turn/diet-only stat changes)\n");
      } else {
        console.log("  --- Wiki differences ---");
      }
      for (const diff of displayDiffs) {
        for (const line of renderCreatureDiff(diff, pvpOnly)) {
          console.log(`  ${line}`);
        }
      }
      console.log();
    }

    const discordSummary = buildDiscordSummary(newCreatures.length, changedCreatures.length, removedCreatureNames.length);
    const discordMessages = buildDiscordBlocks(allDiffs, false, discordSummary);
    if (discordMessages.length > 0) {
      console.log("  --- Discord preview ---");
      discordMessages.forEach((message, index) => {
        console.log(`  [message ${index + 1}/${discordMessages.length}]`);
        message.split("\n").forEach((line) => console.log(`  ${line}`));
        console.log();
      });
    }

    if (syncAll) {
      if (forceSendDiscord && discordMessages.length > 0) {
        if (webhookUrl) {
          shouldSendDiscord = true;
        } else {
          console.log(`  Discord webhook is not configured. Add it to ${WEBHOOK_FILE} or COS_WIKI_SYNC_DISCORD_WEBHOOK.`);
        }
      }

      if (skipApply) {
        console.log("\n  Local files were not changed.\n");
      } else {
        // Sync everything
        removeMissingCreatures = true;
        shouldApply = true;
        for (const { wiki, merged } of newCreatures) {
          toSync.push(merged);
          if (downloadIcons || downloadAllMissingIcons) {
            queueIconRequest(iconRequests, queuedIconNames, wiki.common, wiki, wiki.imageLink);
          }
        }
        for (const { merged, wiki } of changedCreaturesToWrite) {
          toSync.push(merged);
          if (downloadIcons || downloadAllMissingIcons) {
            queueIconRequest(iconRequests, queuedIconNames, wiki.common, wiki, wiki.imageLink);
          }
        }
      }
    } else if (dryRun) {
      if (!downloadIcons && !downloadAllMissingIcons) {
        console.log(
          `  DRY RUN: Would sync ${plannedWriteCount} creatures and remove ${removedCreatureNames.length} stale local creatures. No files changed.\n`
        );
        return;
      }
    } else if (
      newCreatures.length > 0 ||
      changedCreatures.length > 0 ||
      removedCreatureNames.length > 0
    ) {
      if (webhookUrl && discordMessages.length > 0) {
        if (forceSendDiscord) {
          shouldSendDiscord = true;
        } else if (!skipDiscord) {
          const answer = await ask("\nSend this diff to Discord? [y/N]: ");
          shouldSendDiscord = ["y", "yes"].includes(answer.toLowerCase());
        }
      } else if (discordMessages.length > 0) {
        console.log(`  Discord webhook is not configured. Add it to ${WEBHOOK_FILE} or COS_WIKI_SYNC_DISCORD_WEBHOOK.`);
      }

      if (forceApply) {
        shouldApply = true;
      } else if (!skipApply) {
        const applyAnswer = await ask(
          "\nApply local wiki sync now? This updates local creatures data and adds/removes creatures. [y/N]: "
        );
        shouldApply = ["y", "yes"].includes(applyAnswer.toLowerCase());
      }

      if (shouldApply) {
        removeMissingCreatures = true;
        for (const { wiki, merged } of newCreatures) {
          toSync.push(merged);
          if (downloadIcons || downloadAllMissingIcons) {
            queueIconRequest(iconRequests, queuedIconNames, wiki.common, wiki, wiki.imageLink);
          }
        }
        for (const { merged, wiki } of changedCreaturesToWrite) {
          toSync.push(merged);
          if (downloadIcons || downloadAllMissingIcons) {
            queueIconRequest(iconRequests, queuedIconNames, wiki.common, wiki, wiki.imageLink);
          }
        }
      } else {
        console.log("\n  Local files were not changed.\n");
      }
    } else {
      console.log("  Everything is up to date!\n");
      if (!downloadIcons && !downloadAllMissingIcons) {
        return;
      }
    }
  }

  if (shouldSendDiscord && webhookUrl) {
    const discordSummary = buildDiscordSummary(newCreatures.length, changedCreatures.length, removedCreatureNames.length);
    const messages = buildDiscordBlocks(allDiffs, false, discordSummary);
    console.log(`\n  Sending ${messages.length} Discord message(s)...`);
    await sendDiscordMessages(webhookUrl, messages);
    console.log("  Discord notification sent.");
  }

  const icons = downloadIcons || downloadAllMissingIcons ? readIcons() : null;
  if (downloadAllMissingIcons && icons) {
    for (const creature of localCreatures) {
      if (icons[creature.name]) continue;
      queueIconRequest(iconRequests, queuedIconNames, creature.name, wikiCreatures.get(creature.name));
    }
    if (iconRequests.length > 0) {
      console.log(`\n  Icon backfill queued for ${iconRequests.length} creatures missing local icons.`);
    }
  }

  if (dryRun) {
    if ((downloadIcons || downloadAllMissingIcons) && iconRequests.length > 0) {
      console.log(`  DRY RUN: Would also try to download ${iconRequests.length} icon(s).\n`);
    }
    console.log(
      `\n  DRY RUN: Would sync ${toSync.length} creatures and remove ${removeMissingCreatures ? removedCreatureNames.length : 0} stale local creatures. No files changed.\n`
    );
    return;
  }

  if (toSync.length === 0 && !removeMissingCreatures && iconRequests.length === 0) {
    console.log("\n  No local changes selected.\n");
    return;
  }

  if (pushProd) {
    ensureProdPushPathsClean(pathsToPush);
  }

  // 4. Apply changes
  console.log(
    `\n  Applying ${toSync.length} creature updates${removeMissingCreatures ? ` and removing ${removedCreatureNames.length} stale creatures` : ""}...`
  );
  const current = readLocalCreatures();
  const byName = new Map(current.map((c) => [c.name, c]));

  if (removeMissingCreatures) {
    for (const name of removedCreatureNames) {
      byName.delete(name);
    }
  }

  for (const creature of toSync) {
    byName.set(creature.name, creature);
  }

  writeLocalCreatures([...byName.values()]);
  console.log(
    `  Saved ${byName.size} creatures to creatures.runtime.json`
  );

  // Re-derive the effects catalog from the just-written creatures so
  // new/updated entries propagate to engine consumers in the same
  // run. Pre-2026-05-12 this step was manual and drifted (12 missing
  // creatures, 116 mis-mapped Necropoison rows by the time it was
  // caught). See `tools/sync_effects_catalog.ts`.
  const effectsResult = syncEffectsCatalog();
  console.log(
    `  Effects catalog: ${effectsResult.totalCreatures} entries (added ${effectsResult.added}, changed ${effectsResult.changed}, removed ${effectsResult.removed})`,
  );

  // 5. Download icons if requested
  if ((downloadIcons || downloadAllMissingIcons) && iconRequests.length > 0) {
    console.log(`\n  Downloading ${iconRequests.length} icons...`);
    if (!icons) {
      throw new Error("Icon registry was not loaded");
    }
    let downloaded = 0;

    for (const request of iconRequests) {
      const candidates = await resolveIconCandidates(request);
      const localPath = await downloadIcon(request.name, candidates);
      if (localPath) {
        icons[request.name] = localPath;
        downloaded++;
      }
    }

    writeIcons(icons);
    console.log(
      `  Downloaded ${downloaded} icons, total ${Object.keys(icons).length} in registry`
      );
  }

  if (pushProd) {
    pushWikiSyncChangesToProd(pathsToPush);
  }

  console.log("\n  Done!\n");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
