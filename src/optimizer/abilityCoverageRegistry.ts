import {
  DEFERRED_LOW_INFO_ABILITIES,
  EXPLICIT_OUT_OF_MODEL_ABILITIES,
  NOT_MODELED_ABILITIES,
  PARTIAL_MODELED_ABILITIES,
} from "./abilityModelScope";
import { MODELED_OTHER_ABILITIES } from "../shared/modeledOtherAbilities";
import { normalizeAbilityDisplayName } from "../shared/abilityNameAliases";

export function normalizeAbilityName(name: string): string {
  return normalizeAbilityDisplayName(
    name
      .trim()
      .replace(/[\u2019]/g, "'")
      .replace(/\s+/g, " "),
  );
}

export const MODELED_OTHER_ABILITY_NAMES = new Set(MODELED_OTHER_ABILITIES.map(normalizeAbilityName));
export const OUT_OF_MODEL_ABILITIES = new Set(EXPLICIT_OUT_OF_MODEL_ABILITIES.map(normalizeAbilityName));
export const DEFERRED_ABILITIES = new Set(DEFERRED_LOW_INFO_ABILITIES.map(normalizeAbilityName));
export const NOT_MODELED_ABILITY_NAMES = new Set(NOT_MODELED_ABILITIES.map(normalizeAbilityName));
export const PARTIAL_MODELED_ABILITY_NAMES = new Set(PARTIAL_MODELED_ABILITIES.map(normalizeAbilityName));

export function isModeledOtherAbility(abilityName: string, creatureName?: string): boolean {
  const normalized = normalizeAbilityName(abilityName);
  void creatureName;
  return MODELED_OTHER_ABILITY_NAMES.has(normalized);
}

export function isOutOfModelAbility(abilityName: string): boolean {
  return OUT_OF_MODEL_ABILITIES.has(normalizeAbilityName(abilityName));
}

export function isDeferredAbility(abilityName: string): boolean {
  return DEFERRED_ABILITIES.has(normalizeAbilityName(abilityName));
}

export function isNotModeledAbility(abilityName: string): boolean {
  return NOT_MODELED_ABILITY_NAMES.has(normalizeAbilityName(abilityName));
}

export function isPartialModeledAbility(abilityName: string): boolean {
  return PARTIAL_MODELED_ABILITY_NAMES.has(normalizeAbilityName(abilityName));
}

export function shouldSkipAbilityCoverage(abilityName: string, creatureName: string): boolean {
  void abilityName;
  void creatureName;
  return false;
}
