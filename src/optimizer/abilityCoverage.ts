import { creatureByName, creaturesData, effectsCatalog } from "../engine/data";
import {
  collectModeledAbilityNames,
  collectModeledBreathNames,
  getAbilityTableDetail,
  hasAbilityInEffects,
} from "./abilityCoverageHelpers";
import type { AbilityScopeStatus } from "./abilityModelScope";
import {
  isDeferredAbility,
  isNotModeledAbility,
  isOutOfModelAbility,
  isPartialModeledAbility,
  normalizeAbilityName,
  shouldSkipAbilityCoverage,
} from "./abilityCoverageRegistry";
import type { AbilityRef } from "../engine/types";
import { REFERENCE_OUT_OF_MODEL_ABILITY_NAMES } from "../pages/referenceContent";

// Authoritative out-of-model set, authored in the Reference
// (createOutOfModelAbilityEntry). Checked BEFORE the catalog-derived
// "modeled" heuristic so an ability with an unimplemented catalog `def`
// (e.g. Channeling's conditionalAuraStatusPulse, which the Rust engine has
// no handler for) is surfaced as out-of-model - matching the engine truth -
// instead of being falsely shown as modeled. Compare-only abilities are NOT
// in this set (they live in COMPARE_ONLY_REFERENCE_DRAFTS) and stay modeled.
const REFERENCE_OUT_OF_MODEL_NAME_SET = new Set(
  REFERENCE_OUT_OF_MODEL_ABILITY_NAMES.map(normalizeAbilityName),
);

export type AbilityCoverageSummary = {
  total: number;
  applied: number;
  partial: number;
  deferred: number;
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

function formatAbilityCoverageName(ability: AbilityRef): string {
  if (normalizeAbilityName(ability.name) !== normalizeAbilityName("Unbreakable")) return ability.name;
  if (ability.value === null || ability.value === undefined || ability.value === "") return ability.name;
  return `${ability.name} (${ability.value})`;
}

export function computeAbilityCoverageSummary(): AbilityCoverageSummary {
  if (coverageSummaryCache) return coverageSummaryCache;
  let total = 0;
  let applied = 0;
  let partial = 0;
  let deferred = 0;
  let outOfModel = 0;

  for (const creature of creaturesData) {
    const effects = (creatureByName[creature.name] ? (effectsCatalog as Record<string, Record<string, unknown>>)[creature.name] : {}) ?? {};
    const appliedSet = collectModeledAbilityNames(effects, creature.name);

    const abilities = [...(creature.passiveAbilities ?? []), ...(creature.activatedAbilities ?? []), ...(creature.breathAbilities ?? [])];
    const breathModeledNames = collectModeledBreathNames(creature);
    for (const ability of abilities) {
      total += 1;
      const normalized = normalizeAbilityName(ability.name);
      if (shouldSkipAbilityCoverage(ability.name, creature.name)) {
        partial += 1;
        continue;
      }
      if (normalized === normalizeAbilityName("Lich Mark") && appliedSet.has(normalized)) {
        applied += 1;
        continue;
      }
      if (isPartialModeledAbility(ability.name)) {
        partial += 1;
        continue;
      }
      if (isNotModeledAbility(ability.name)) {
        continue;
      }
      if (REFERENCE_OUT_OF_MODEL_NAME_SET.has(normalized)) {
        outOfModel += 1;
        continue;
      }
      if (breathModeledNames.has(normalized) || appliedSet.has(normalized)) {
        applied += 1;
        continue;
      }
      if (isDeferredAbility(ability.name)) {
        deferred += 1;
        continue;
      }
      if (isOutOfModelAbility(ability.name)) {
        outOfModel += 1;
      }
    }
  }

  coverageSummaryCache = {
    total,
    applied,
    partial,
    deferred,
    outOfModel,
    unresolved: total - applied - partial - deferred - outOfModel,
  };
  return coverageSummaryCache;
}

export function getAbilityCoverage(creatureName: string): AbilityCoverageItem[] {
  const cached = abilityCoverageByCreatureCache.get(creatureName);
  if (cached) return cached;
  const creature = creatureByName[creatureName];
  if (!creature) return [];
  const effects = ((effectsCatalog as Record<string, Record<string, unknown>>)[creatureName] ?? {}) as Record<string, unknown>;
  const modeled = collectModeledAbilityNames(effects, creatureName);

  for (const abilityName of [
    "Warden's Rage",
    "Warden's Resistance",
    "Reflect",
    "Totem",
    "Drowsy Area",
    "Lich Mark",
    "Two-Faced",
    "Hunker",
    "Harden",
    "Adrenaline",
    "Cursed Sigil",
    "Hunters Curse",
    "Unbridled Rage",
    "Thorn Trap",
    "Fortify",
    "Sticky Fur",
    "Aura (Disease)",
    "Aura (Corrosion)",
    "Aura (Burn)",
    "Cause Fear",
    "Lance",
    "Frost Nova",
    "Heal Breath",
    "Heal Beam",
    "Solar Beam",
    "Spirit Glare",
    "Heliolyth's Judgement",
    "Cloud Breath",
  ]) {
    if (hasAbilityInEffects(effects, abilityName)) {
      modeled.add(normalizeAbilityName(abilityName));
    }
  }

  const abilities = [...(creature.passiveAbilities ?? []), ...(creature.activatedAbilities ?? []), ...(creature.breathAbilities ?? [])];
  const breathModeledNames = collectModeledBreathNames(creature);

  const resolved: AbilityCoverageItem[] = abilities.map((ability): AbilityCoverageItem => {
    const normalized = normalizeAbilityName(ability.name);
    const displayName = formatAbilityCoverageName(ability);
    const detail = getAbilityTableDetail(effects, ability.name);
    if (shouldSkipAbilityCoverage(ability.name, creatureName)) {
      return { name: displayName, status: "partial", detail };
    }
    if (normalized === normalizeAbilityName("Lich Mark") && modeled.has(normalized)) {
      return { name: displayName, status: "modeled", detail };
    }
    if (isPartialModeledAbility(ability.name)) {
      return { name: displayName, status: "partial", detail };
    }
    if (isNotModeledAbility(ability.name)) return { name: displayName, status: "not-modeled", detail };
    if (REFERENCE_OUT_OF_MODEL_NAME_SET.has(normalized)) return { name: displayName, status: "out-of-model", detail };
    if (breathModeledNames.has(normalized)) return { name: displayName, status: "modeled", detail };
    if (modeled.has(normalized)) return { name: displayName, status: "modeled", detail };
    if (isDeferredAbility(ability.name)) return { name: displayName, status: "deferred", detail };
    if (isOutOfModelAbility(ability.name)) return { name: displayName, status: "out-of-model", detail };
    return { name: displayName, status: "not-modeled", detail };
  });
  abilityCoverageByCreatureCache.set(creatureName, resolved);
  return resolved;
}
