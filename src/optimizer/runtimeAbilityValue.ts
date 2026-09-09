import type { CreatureRuntime } from "../engine";
import { canonicalizeAbilityValue } from "../engine/abilityValueOptions";
import { effectsCatalog } from "../engine/data";
import { normalizeAbilityName } from "../engine/runtimeHelpers";
import { lookupStatusEngineId } from "../engine/statusCatalog";
import { deriveGenericTrailStatus } from "./abilityRegistry";

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

/**
 * Damage trails whose ailment is NOT one of the four hardcoded flavors
 * (Flame->Burn, Frost->Frostbite, Plague->Disease, Toxic->Poison). These ride
 * the engine's generic trail channel (`trailStatusId` + `trailValue`) instead
 * of a dedicated flavor field. "Necropoison Trail" exists in creature data
 * today; new ailment trails (e.g. a Radiation trail) add one row here.
 */
export const GENERIC_TRAIL_STATUS: Record<string, string> = deriveGenericTrailStatus();

/**
 * Resolve a creature's generic (non-flavor) damage trail to its status id and
 * HP-threshold value, or null if it has none. Same value semantics as the
 * flavor trails (value > 1 is interpreted as percent by the engine).
 */
export function resolveGenericTrail(
  creature: CreatureRuntime,
): { statusId: string; value: number } | null {
  for (const [abilityName, statusId] of Object.entries(GENERIC_TRAIL_STATUS)) {
    const raw = resolveRuntimeAbilityValue(creature, abilityName);
    if (typeof raw === "number" && raw > 0) {
      return { statusId, value: raw };
    }
  }
  return null;
}

/**
 * Resolve the ailment a creature's Totem applies. The Totem carries its ailment
 * in the ability's `value` (e.g. "Poison", "Radiation"), so this returns the
 * engine status id, or null when there is no Totem / no value (the engine then
 * falls back to Poison, matching the historical default).
 */
export function resolveTotemStatusId(creature: CreatureRuntime): string | null {
  const raw = resolveRuntimeAbilityValue(creature, "Totem");
  if (typeof raw !== "string" || !raw.trim()) return null;
  return lookupStatusEngineId(raw);
}

/**
 * Resolve a creature's Aura subtype - the ailment its generic "Aura" ability
 * applies. The ailment is the ability's `value` (e.g. Aura + value "Radiation"),
 * not a separate "Aura (X)" ability; a legacy "Aura (X)" name is parsed only as
 * a fallback for un-migrated wiki entries. Returns the subtype label (e.g.
 * "Radiation") that the engine maps to a status, or null when there is no aura.
 */
export function resolveAuraSubtype(creature: CreatureRuntime): string | null {
  const subtypeOf = (ability: AbilityEntry & { subtype?: string | null }): string | null => {
    if (!/^aura\b/i.test(ability.name ?? "")) return null;
    if (typeof ability.value === "string" && ability.value.trim()) return ability.value.trim();
    const legacy = ability.name?.trim().match(/^Aura \(([^)]+)\)$/);
    return legacy ? legacy[1].trim() : null;
  };
  for (const ability of creature.activatedAbilities ?? []) {
    const sub = subtypeOf(ability);
    if (sub) return sub;
  }
  const effects = effectsCatalog[creature.name] ?? {};
  for (const ability of [
    ...(effects.otherAbilities ?? []),
    ...(effects.specialAbilities ?? []),
    ...(effects.specialAbilitiesDetailed ?? []),
  ]) {
    const sub = subtypeOf(ability);
    if (sub) return sub;
  }
  return null;
}
