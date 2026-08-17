import {
  clampBlockFraction,
  resolveAttackStatusId,
  resolveBlockStatusId,
  resolveDefensiveStatusId,
} from "./effectDerivation";
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

// Resolve a "Block X" / "X Attack" / "Defensive X" ability to its status id.
// The shared table (effectDerivation) wins first so a custom creature resolves
// the curated ailments identically to a catalog creature (incl. the
// Necropoison split and Ligament Tear's Torn Ligaments). Anything outside the
// table falls through to resolveStatusId, which knows every engine status. An
// unknown name resolves to null = no effect, matching the engine (which never
// applies a status nothing produces); there is no `<Name>_Status` phantom.
function deriveResistStatusId(abilityName: string): string | null {
  const tabled = resolveBlockStatusId(abilityName);
  if (tabled) return tabled;
  const match = abilityName.match(/^Block\s+(.+)$/i);
  return match ? resolveStatusId(match[1]) : null;
}

function deriveOffensiveStatusId(abilityName: string): string | null {
  const tabled = resolveAttackStatusId(abilityName);
  if (tabled) return tabled;
  const match = abilityName.match(/^(.+?)\s+Attack$/i);
  return match ? resolveStatusId(match[1]) : null;
}

function deriveDefensiveStatusId(abilityName: string): string | null {
  const tabled = resolveDefensiveStatusId(abilityName);
  if (tabled) return tabled;
  const match = abilityName.match(/^Defensive\s+(.+)$/i);
  return match ? resolveStatusId(match[1]) : null;
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

// One status effect = one entry per kind, keyed by status id. The ability-
// derived value is authoritative: a named ability ("Block Poison" value 100)
// is the single source of truth, so it overrides any stale explicit row carried
// in the effects (e.g. a 0.3 left over from a previous edit). An explicit row
// for a status with no backing ability survives untouched.
function mergeStacksEntries(
  autoEntries: NonNullable<EffectsCatalogByCreature["applyStatusOnHit"]>,
  explicitEntries: NonNullable<EffectsCatalogByCreature["applyStatusOnHit"]>,
): NonNullable<EffectsCatalogByCreature["applyStatusOnHit"]> {
  const byStatus = new Map<string, { statusId: string; stacks: number; sourceAbility: string }>();
  for (const entry of explicitEntries) byStatus.set(entry.statusId, entry);
  for (const entry of autoEntries) byStatus.set(entry.statusId, entry);
  return [...byStatus.values()];
}

function mergeResistEntries(
  autoEntries: NonNullable<EffectsCatalogByCreature["resistStatus"]>,
  explicitEntries: NonNullable<EffectsCatalogByCreature["resistStatus"]>,
): NonNullable<EffectsCatalogByCreature["resistStatus"]> {
  const byStatus = new Map<string, { statusId: string; fraction: number; sourceAbility: string }>();
  for (const entry of explicitEntries) byStatus.set(entry.statusId, entry);
  for (const entry of autoEntries) byStatus.set(entry.statusId, entry);
  return [...byStatus.values()];
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
      autoResist.push({ statusId: resistStatusId, fraction: clampBlockFraction(entry.value), sourceAbility: entry.name });
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
