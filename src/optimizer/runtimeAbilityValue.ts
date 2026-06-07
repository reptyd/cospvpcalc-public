import type { CreatureRuntime } from "../engine";
import { canonicalizeAbilityValue } from "../engine/abilityValueOptions";
import { effectsCatalog } from "../engine/data";
import { normalizeAbilityName } from "../engine/runtimeHelpers";

type RuntimeAbilityValue = number | string | null;

type AbilityEntry = {
  name: string;
  value?: number | string | null;
};

function canonicalNonNullValue(abilityName: string, entry: AbilityEntry | undefined): RuntimeAbilityValue {
  if (!entry) return null;
  const canonical = canonicalizeAbilityValue(abilityName, entry.value ?? null);
  return canonical == null ? null : canonical;
}

export function resolveRuntimeAbilityValue(creature: CreatureRuntime, abilityName: string): RuntimeAbilityValue {
  const normalized = normalizeAbilityName(abilityName);
  const creatureAbility = [
    ...(creature.passiveAbilities ?? []),
    ...(creature.activatedAbilities ?? []),
    ...(creature.breathAbilities ?? []),
  ].find((ability) => normalizeAbilityName(ability.name) === normalized);

  const creatureValue = canonicalNonNullValue(abilityName, creatureAbility);
  if (creatureValue != null) return creatureValue;

  const effects = effectsCatalog[creature.name] ?? {};
  const effectAbility = [
    ...(effects.otherAbilities ?? []),
    ...(effects.specialAbilities ?? []),
    ...(effects.specialAbilitiesDetailed ?? []),
  ].find((ability) => normalizeAbilityName(ability.name) === normalized);
  return canonicalNonNullValue(abilityName, effectAbility);
}
