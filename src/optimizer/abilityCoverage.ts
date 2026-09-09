import { creatureByName, creaturesData, effectsCatalog, statusById } from "../engine/data";
import {
  collectModeledAbilityNames,
  collectModeledBreathNames,
  getAbilityTableDetail,
} from "./abilityCoverageHelpers";
import { normalizeAbilityName } from "./abilityCoverageRegistry";
import type { AbilityRef } from "../engine/types";
import type { AbilityScopeStatus } from "../pages/referenceContent";
import { REFERENCE_ABILITY_SCOPE } from "../pages/referenceContent";
import { subscribeCustomCreatureRegistry } from "../engine/customCreatures";

// The Reference entry decides an ability's label, and it decides it before the
// catalog heuristic gets a say: an ability with an unimplemented catalog `def`
// (Channeling's conditionalAuraStatusPulse, which the engine has no handler
// for) reads out-of-model, matching the engine, instead of being shown as
// modeled because a `def` happens to exist.
const REFERENCE_SCOPE_BY_NAME = new Map(
  [...REFERENCE_ABILITY_SCOPE.entries()].map(([name, scope]) => [normalizeAbilityName(name), scope]),
);

// Reference names longest-first, for the two shapes the roster writes a variant
// in: a parenthetical (`Aura (Corrosion)`) and a trailing status word
// (`Lich Mark Drowsy`, `Totem Disease`). Both are one ability with its value in
// the name, so they take their base entry's word.
const REFERENCE_NAMES_LONGEST_FIRST = [...REFERENCE_ABILITY_SCOPE.keys()].sort(
  (left, right) => right.length - left.length,
);

/** The Reference's own word on an ability, or null when it has no entry. */
function referenceScope(abilityName: string): AbilityScopeStatus | null {
  const direct = REFERENCE_SCOPE_BY_NAME.get(normalizeAbilityName(abilityName));
  if (direct) return direct;

  const withoutParenthetical = abilityName.replace(/\s*\([^)]*\)\s*$/, "").trim();
  const stripped = REFERENCE_SCOPE_BY_NAME.get(normalizeAbilityName(withoutParenthetical));
  if (stripped) return stripped;

  const base = REFERENCE_NAMES_LONGEST_FIRST.find((name) => abilityName.startsWith(`${name} `));
  return base ? (REFERENCE_SCOPE_BY_NAME.get(normalizeAbilityName(base)) ?? null) : null;
}

export type AbilityCoverageSummary = {
  total: number;
  applied: number;
  partial: number;
  speedBuildsOnly: number;
  outOfModel: number;
  unresolved: number;
};

export type AbilityCoverageItem = {
  name: string;
  status: AbilityScopeStatus;
  detail?: string;
};

let coverageSummaryCache: AbilityCoverageSummary | null = null;
const abilityCoverageByCreatureCache = new Map<string, AbilityCoverageItem[]>();

// Coverage is cached per creature name. Editing a custom creature replaces its
// catalog entry under the same name, so without invalidation the Compare
// ability list keeps showing the version captured on first render. Clear the
// caches whenever the custom-creature registry changes so an edit shows up
// without a reload.
subscribeCustomCreatureRegistry(() => {
  coverageSummaryCache = null;
  abilityCoverageByCreatureCache.clear();
});

function formatAbilityCoverageName(ability: AbilityRef): string {
  if (normalizeAbilityName(ability.name) !== normalizeAbilityName("Unbreakable")) return ability.name;
  if (ability.value === null || ability.value === undefined || ability.value === "") return ability.name;
  return `${ability.name} (${ability.value})`;
}

export function computeAbilityCoverageSummary(): AbilityCoverageSummary {
  if (coverageSummaryCache) return coverageSummaryCache;
  const counts: Record<AbilityScopeStatus, number> = {
    modeled: 0,
    partial: 0,
    "speed-builds-only": 0,
    "out-of-model": 0,
    "not-modeled": 0,
  };
  let total = 0;

  for (const creature of creaturesData) {
    const effects = (creatureByName[creature.name] ? (effectsCatalog as Record<string, Record<string, unknown>>)[creature.name] : {}) ?? {};
    const modeled = collectModeledAbilityNames(effects, creature.name);
    const breathModeledNames = collectModeledBreathNames(creature);

    for (const ability of [
      ...(creature.passiveAbilities ?? []),
      ...(creature.activatedAbilities ?? []),
      ...(creature.breathAbilities ?? []),
    ]) {
      total += 1;
      counts[classifyAbility(ability.name, modeled, breathModeledNames)] += 1;
    }
  }

  coverageSummaryCache = {
    total,
    applied: counts.modeled,
    partial: counts.partial,
    speedBuildsOnly: counts["speed-builds-only"],
    outOfModel: counts["out-of-model"],
    unresolved: counts["not-modeled"],
  };
  return coverageSummaryCache;
}

/**
 * One ladder, shared by the census and the per-creature list so the number in
 * the debug panel and the colour on the chip can never disagree.
 *
 * The Reference has the last word wherever it has an entry. The two checks in
 * front of it are for abilities it says nothing about: a breath wired as the
 * creature's own breath runs whatever its name, and the catalog auto-detection
 * catches status appliers authored on the creature rather than named.
 */
function classifyAbility(
  abilityName: string,
  modeled: ReadonlySet<string>,
  breathModeledNames: ReadonlySet<string>,
): AbilityScopeStatus {
  const normalized = normalizeAbilityName(abilityName);
  if (normalized === normalizeAbilityName("Lich Mark") && modeled.has(normalized)) return "modeled";
  if (breathModeledNames.has(normalized)) return "modeled";
  const fromReference = referenceScope(abilityName);
  if (fromReference) return fromReference;
  if (modeled.has(normalized)) return "modeled";
  return "not-modeled";
}

export function getAbilityCoverage(creatureName: string): AbilityCoverageItem[] {
  const cached = abilityCoverageByCreatureCache.get(creatureName);
  if (cached) return cached;
  const creature = creatureByName[creatureName];
  if (!creature) return [];
  const effects = ((effectsCatalog as Record<string, Record<string, unknown>>)[creatureName] ?? {}) as Record<string, unknown>;
  // Status-applier / effect-section auto-detection, for the abilities the
  // Reference has nothing to say about.
  const modeled = collectModeledAbilityNames(effects, creatureName);

  const abilities = [...(creature.passiveAbilities ?? []), ...(creature.activatedAbilities ?? []), ...(creature.breathAbilities ?? [])];
  const breathModeledNames = collectModeledBreathNames(creature);

  const resolved: AbilityCoverageItem[] = abilities.map((ability): AbilityCoverageItem => ({
    name: formatAbilityCoverageName(ability),
    status: classifyAbility(ability.name, modeled, breathModeledNames),
    detail: getAbilityTableDetail(effects, ability.name),
  }));

  // Status effects authored directly in the Statuses tab (offensive / defensive
  // / block) live in the effect sections with no backing named ability, so the
  // ability loop above never surfaces them - they were invisible in the Compare
  // ability list. Add them as their own chips, tagged with the kind, deduped
  // against ability-derived rows (a catalog creature's "Block Poison" already
  // shows via its ability chip).
  const abilityNames = new Set(abilities.map((ability) => normalizeAbilityName(ability.name)));
  appendExplicitStatusCoverage(resolved, effects, abilityNames);

  abilityCoverageByCreatureCache.set(creatureName, resolved);
  return resolved;
}

const EXPLICIT_STATUS_COVERAGE_KINDS = [
  { field: "applyStatusOnHit", label: "Offensive", numeric: "stacks" },
  { field: "applyStatusOnHitTaken", label: "Defensive", numeric: "stacks" },
  { field: "resistStatus", label: "Block / Resist", numeric: "fraction" },
] as const;

function formatStatusCoverageName(statusId: string): string {
  return statusId.replace(/_Status$/i, "").replace(/_/g, " ").trim();
}

function appendExplicitStatusCoverage(
  resolved: AbilityCoverageItem[],
  effects: Record<string, unknown>,
  abilityNames: Set<string>,
): void {
  for (const { field, label, numeric } of EXPLICIT_STATUS_COVERAGE_KINDS) {
    const entries =
      (effects[field] as Array<{ statusId: string; sourceAbility?: string; stacks?: number; fraction?: number }> | undefined) ??
      [];
    for (const entry of entries) {
      if (entry.sourceAbility && abilityNames.has(normalizeAbilityName(entry.sourceAbility))) continue;
      const known = entry.statusId in statusById;
      const detail =
        numeric === "fraction"
          ? `${Number(((entry.fraction ?? 0) * 100).toFixed(2))}%`
          : `${(entry.stacks ?? 0) >= 0 ? "+" : ""}${entry.stacks ?? 0}`;
      resolved.push({
        name: `${formatStatusCoverageName(entry.statusId)} (${label})`,
        status: known ? "modeled" : "not-modeled",
        detail,
      });
    }
  }
}
