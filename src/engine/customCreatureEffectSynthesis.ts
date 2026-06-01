import { resolveStatusId } from "./runtimeHelpers";
import type { AbilityRef, CreatureRuntime, EffectsCatalogByCreature } from "./types";

type EffectAbilityLike = {
  name: string;
  value: number | string | null;
  semantics: string;
};

function normalizeKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function collectCreatureAbilities(creature: CreatureRuntime): AbilityRef[] {
  return [
    ...(creature.passiveAbilities ?? []),
    ...(creature.activatedAbilities ?? []),
    ...(creature.breathAbilities ?? []),
  ];
}

function collectEffectAbilities(effects: EffectsCatalogByCreature): EffectAbilityLike[] {
  return [
    ...(effects.otherAbilities ?? []),
    ...(effects.specialAbilities ?? []).map((entry) => ({
      name: entry.name,
      value: entry.value ?? null,
      semantics: "neutral",
    })),
    ...(effects.specialAbilitiesDetailed ?? []).map((entry) => ({
      name: entry.name,
      value: entry.value ?? null,
      semantics: "neutral",
    })),
  ];
}

function resolveDerivedStatusId(rawStatusName: string): string {
  return resolveStatusId(rawStatusName) ?? `${rawStatusName.trim().replace(/\s+/g, "_")}_Status`;
}

function deriveResistStatusId(abilityName: string): string | null {
  const match = abilityName.match(/^Block\s+(.+)$/i);
  return match ? resolveDerivedStatusId(match[1]) : null;
}

function deriveOffensiveStatusId(abilityName: string): string | null {
  const match = abilityName.match(/^(.+?)\s+Attack$/i);
  return match ? resolveDerivedStatusId(match[1]) : null;
}

function deriveDefensiveStatusId(abilityName: string): string | null {
  const match = abilityName.match(/^Defensive\s+(.+)$/i);
  return match ? resolveDerivedStatusId(match[1]) : null;
}

function mergeOtherAbilities(
  autoEntries: EffectAbilityLike[],
  explicitEntries: NonNullable<EffectsCatalogByCreature["otherAbilities"]>,
): NonNullable<EffectsCatalogByCreature["otherAbilities"]> {
  const byName = new Map<string, EffectAbilityLike>();
  for (const entry of autoEntries) {
    byName.set(normalizeKey(entry.name), {
      name: entry.name,
      value: entry.value ?? null,
      semantics: entry.semantics ?? "neutral",
    });
  }
  for (const entry of explicitEntries) {
    byName.set(normalizeKey(entry.name), {
      name: entry.name,
      value: entry.value ?? null,
      semantics: entry.semantics ?? "neutral",
    });
  }
  return [...byName.values()].sort((left, right) => left.name.localeCompare(right.name));
}

function mergeStacksEntries(
  autoEntries: NonNullable<EffectsCatalogByCreature["applyStatusOnHit"]>,
  explicitEntries: NonNullable<EffectsCatalogByCreature["applyStatusOnHit"]>,
): NonNullable<EffectsCatalogByCreature["applyStatusOnHit"]> {
  const byKey = new Map<string, { statusId: string; stacks: number; sourceAbility: string }>();
  for (const entry of autoEntries) {
    byKey.set(`${entry.statusId}::${normalizeKey(entry.sourceAbility)}`, entry);
  }
  for (const entry of explicitEntries) {
    byKey.set(`${entry.statusId}::${normalizeKey(entry.sourceAbility)}`, entry);
  }
  return [...byKey.values()];
}

function mergeResistEntries(
  autoEntries: NonNullable<EffectsCatalogByCreature["resistStatus"]>,
  explicitEntries: NonNullable<EffectsCatalogByCreature["resistStatus"]>,
): NonNullable<EffectsCatalogByCreature["resistStatus"]> {
  const byKey = new Map<string, { statusId: string; fraction: number; sourceAbility: string }>();
  for (const entry of autoEntries) {
    byKey.set(`${entry.statusId}::${normalizeKey(entry.sourceAbility)}`, entry);
  }
  for (const entry of explicitEntries) {
    byKey.set(`${entry.statusId}::${normalizeKey(entry.sourceAbility)}`, entry);
  }
  return [...byKey.values()];
}

export function synthesizeCustomCreatureEffects(
  creature: CreatureRuntime,
  effects: EffectsCatalogByCreature,
): EffectsCatalogByCreature {
  const creatureAbilities = collectCreatureAbilities(creature);
  const allAbilityLikes: EffectAbilityLike[] = [
    ...creatureAbilities.map((entry) => ({
      name: entry.name,
      value: entry.value ?? null,
      semantics: entry.semantics ?? "neutral",
    })),
    ...collectEffectAbilities(effects),
  ];

  const autoOnHit: NonNullable<EffectsCatalogByCreature["applyStatusOnHit"]> = [];
  const autoOnHitTaken: NonNullable<EffectsCatalogByCreature["applyStatusOnHitTaken"]> = [];
  const autoResist: NonNullable<EffectsCatalogByCreature["resistStatus"]> = [];
  for (const entry of allAbilityLikes) {
    if (typeof entry.value !== "number") continue;

    const offensiveStatusId = deriveOffensiveStatusId(entry.name);
    if (offensiveStatusId) {
      autoOnHit.push({ statusId: offensiveStatusId, stacks: entry.value, sourceAbility: entry.name });
    }

    const defensiveStatusId = deriveDefensiveStatusId(entry.name);
    if (defensiveStatusId) {
      autoOnHitTaken.push({ statusId: defensiveStatusId, stacks: entry.value, sourceAbility: entry.name });
    }

    const resistStatusId = deriveResistStatusId(entry.name);
    if (resistStatusId) {
      autoResist.push({ statusId: resistStatusId, fraction: entry.value, sourceAbility: entry.name });
    }
  }

  return {
    ...effects,
    otherAbilities: mergeOtherAbilities(allAbilityLikes, effects.otherAbilities ?? []),
    applyStatusOnHit: mergeStacksEntries(autoOnHit, effects.applyStatusOnHit ?? []),
    applyStatusOnHitTaken: mergeStacksEntries(autoOnHitTaken, effects.applyStatusOnHitTaken ?? []),
    resistStatus: mergeResistEntries(autoResist, effects.resistStatus ?? []),
  };
}
