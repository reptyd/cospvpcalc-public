import type { CreatureRuntime } from "../engine";
import { effectsCatalog } from "../engine/data";
import { normalizeAbilityName } from "../engine/runtimeHelpers";

const SUPPORTED_GENERIC_STATUS_IDS = new Set([
  "Bleed_Status",
  "Burn_Status",
  "Corrosion_Status",
  "Poison_Status",
  "Frostbite_Status",
  "Injury_Status",
  "Disease_Status",
  "Necropoison_Status",
  "Sticky_Teeth_Status",
  "Drowsy_Status",
  "Slow_Status",
  "Deep_Wounds_Status",
  "Shredded_Wings",
]);

type AbilityFilters = {
  isOutOfModelAbilityName: (name: string) => boolean;
  isIgnoredUnimplementedAbilityName: (name: string) => boolean;
};

type NormalizedAbilityEntry = {
  raw: string;
  normalized: string;
};

const EMPTY_STRING_SET = new Set<string>();
const supportedGenericStatusAbilityNamesCache = new Map<string, Set<string>>();
type CachedNormalizedCreatureAbilities = {
  passiveRef: CreatureRuntime["passiveAbilities"];
  activatedRef: CreatureRuntime["activatedAbilities"];
  profile: {
    passive: NormalizedAbilityEntry[];
    activated: NormalizedAbilityEntry[];
  };
};

const normalizedCreatureAbilitiesCache = new WeakMap<CreatureRuntime, CachedNormalizedCreatureAbilities>();

function getSupportedGenericStatusAbilityNames(creatureName: string): Set<string> {
  const cached = supportedGenericStatusAbilityNamesCache.get(creatureName);
  if (cached) return cached;
  const effects = effectsCatalog[creatureName] ?? {};
  const statusesByAbility = new Map<string, Set<string>>();
  for (const entry of effects.applyStatusOnHit ?? []) {
    const key = normalizeAbilityName(entry.sourceAbility);
    const statuses = statusesByAbility.get(key) ?? EMPTY_STRING_SET;
    const nextStatuses = statuses === EMPTY_STRING_SET ? new Set<string>() : statuses;
    nextStatuses.add(entry.statusId);
    statusesByAbility.set(key, nextStatuses);
  }
  for (const entry of effects.applyStatusOnHitTaken ?? []) {
    const key = normalizeAbilityName(entry.sourceAbility);
    const statuses = statusesByAbility.get(key) ?? EMPTY_STRING_SET;
    const nextStatuses = statuses === EMPTY_STRING_SET ? new Set<string>() : statuses;
    nextStatuses.add(entry.statusId);
    statusesByAbility.set(key, nextStatuses);
  }
  for (const entry of effects.resistStatus ?? []) {
    const key = normalizeAbilityName(entry.sourceAbility);
    const statuses = statusesByAbility.get(key) ?? EMPTY_STRING_SET;
    const nextStatuses = statuses === EMPTY_STRING_SET ? new Set<string>() : statuses;
    nextStatuses.add(entry.statusId);
    statusesByAbility.set(key, nextStatuses);
  }

  const names = new Set<string>();
  for (const [abilityName, statusIds] of statusesByAbility.entries()) {
    if ([...statusIds].every((statusId) => SUPPORTED_GENERIC_STATUS_IDS.has(statusId))) {
      names.add(abilityName);
    }
  }
  supportedGenericStatusAbilityNamesCache.set(creatureName, names);
  return names;
}

function getNormalizedCreatureAbilities(creature: CreatureRuntime): {
  passive: NormalizedAbilityEntry[];
  activated: NormalizedAbilityEntry[];
} {
  const cached = normalizedCreatureAbilitiesCache.get(creature);
  if (cached && cached.passiveRef === creature.passiveAbilities && cached.activatedRef === creature.activatedAbilities) {
    return cached.profile;
  }
  const profile = {
    passive: (creature.passiveAbilities ?? []).map((ability) => ({
      raw: ability.name,
      normalized: normalizeAbilityName(ability.name),
    })),
    activated: (creature.activatedAbilities ?? []).map((ability) => ({
      raw: ability.name,
      normalized: normalizeAbilityName(ability.name),
    })),
  };
  normalizedCreatureAbilitiesCache.set(creature, {
    passiveRef: creature.passiveAbilities,
    activatedRef: creature.activatedAbilities,
    profile,
  });
  return profile;
}

export function getRustUnsupportedPassiveAbilityNames(
  creature: CreatureRuntime,
  supportedNames: Set<string>,
  ignoredNames: Set<string>,
  contourNoOpPassiveNames: Set<string>,
  filters: AbilityFilters,
): string[] {
  const genericStatusSources = getSupportedGenericStatusAbilityNames(creature.name);
  return getNormalizedCreatureAbilities(creature).passive
    .filter(({ raw, normalized }) => {
      return (
        !filters.isOutOfModelAbilityName(raw) &&
        !filters.isIgnoredUnimplementedAbilityName(raw) &&
        !ignoredNames.has(normalized) &&
        !contourNoOpPassiveNames.has(normalized) &&
        !supportedNames.has(normalized) &&
        !genericStatusSources.has(normalized)
      );
    })
    .map(({ raw }) => raw);
}

export function getRustUnsupportedActivatedAbilityNames(
  creature: CreatureRuntime,
  supportedNames: Set<string>,
  contourNoOpActivatedNames: Set<string>,
  contourPrebuiltActivatedNames: Set<string>,
  filters: AbilityFilters,
): string[] {
  return getNormalizedCreatureAbilities(creature).activated
    .filter(({ raw, normalized }) => {
      return (
        !filters.isOutOfModelAbilityName(raw) &&
        !filters.isIgnoredUnimplementedAbilityName(raw) &&
        !contourNoOpActivatedNames.has(normalized) &&
        !contourPrebuiltActivatedNames.has(normalized) &&
        !supportedNames.has(normalized)
      );
    })
    .map(({ raw }) => raw);
}

export function hasRelevantActivatedAbilities(
  creature: CreatureRuntime,
  contourNoOpActivatedNames: Set<string>,
  filters: AbilityFilters,
): boolean {
  return getNormalizedCreatureAbilities(creature).activated.some(({ raw, normalized }) => {
    return (
      !filters.isOutOfModelAbilityName(raw) &&
      !filters.isIgnoredUnimplementedAbilityName(raw) &&
      !contourNoOpActivatedNames.has(normalized)
    );
  });
}

export function getRustBlockingActivatedAbilityNamesForPassiveContours(
  creature: CreatureRuntime,
  contourNoOpActivatedNames: Set<string>,
  contourPrebuiltActivatedNames: Set<string>,
  filters: AbilityFilters,
): string[] {
  return getNormalizedCreatureAbilities(creature).activated
    .filter(({ raw, normalized }) => {
      return (
        !filters.isOutOfModelAbilityName(raw) &&
        !filters.isIgnoredUnimplementedAbilityName(raw) &&
        !contourNoOpActivatedNames.has(normalized) &&
        !contourPrebuiltActivatedNames.has(normalized)
      );
    })
    .map(({ raw }) => raw);
}
