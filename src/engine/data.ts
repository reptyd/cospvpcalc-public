import statusEffectsRuntime from "../../data/status_effects.runtime.json";
import effectsCatalogRuntime from "../../data/effects_catalog.runtime.v2.json";
import specialAbilitiesRuntime from "../../data/special_abilities.runtime.json";
import breathSpecsRuntime from "../../data/breath_specs.runtime.json";
import type { BreathSpec, CreatureRuntime, EffectsCatalogByCreature, SpecialAbilityDef, StatusEffect } from "./types";
import { creatureByName, creaturesData, getCreatureIcon } from "./creatureData";
import { getPlushieIcon, getTraitIcon, plushieByName, plushies, rules, traits, veneration } from "./buildData";
import { MODELED_OTHER_ABILITIES } from "../shared/modeledOtherAbilities";
import { normalizeAbilityName as normalizeAbilityKey } from "../shared/abilityNameAliases";

type EffectsCatalogRoot = {
  byCreature: Record<string, EffectsCatalogByCreature>;
};
type SpecialAbilitiesRoot = Record<string, SpecialAbilityDef>;
type BreathSpecsRoot = { breathTypes: BreathSpec[] };

function normalizeBreathSpecKey(value: string): string {
  return value.trim().toLowerCase().replace(/_/g, " ").replace(/\s+/g, " ");
}

const effectsCatalogRaw = (effectsCatalogRuntime as EffectsCatalogRoot).byCreature;
const modeledOtherAbilityKeys = new Set(MODELED_OTHER_ABILITIES.map(normalizeAbilityKey));

function backfillModeledOtherAbilities(
  creature: CreatureRuntime,
  base: EffectsCatalogByCreature,
): EffectsCatalogByCreature {
  const creatureAbilityKeys = new Set<string>();
  for (const ability of [
    ...(creature.passiveAbilities ?? []),
    ...(creature.activatedAbilities ?? []),
    ...(creature.breathAbilities ?? []),
  ]) {
    creatureAbilityKeys.add(normalizeAbilityKey(ability.name));
  }

  const present = new Set<string>();
  for (const entry of base.specialAbilitiesDetailed ?? []) present.add(normalizeAbilityKey(entry.name));
  for (const entry of base.specialAbilities ?? []) present.add(normalizeAbilityKey(entry.name));
  for (const entry of base.otherAbilities ?? []) present.add(normalizeAbilityKey(entry.name));
  for (const entry of base.applyStatusOnHit ?? []) present.add(normalizeAbilityKey(entry.sourceAbility));
  for (const entry of base.applyStatusOnHitTaken ?? []) present.add(normalizeAbilityKey(entry.sourceAbility));
  for (const entry of base.resistStatus ?? []) present.add(normalizeAbilityKey(entry.sourceAbility));

  // Build a lookup of creature ability values for modeled abilities
  const creatureValueByKey = new Map<string, number | string | null>();
  for (const ability of [...(creature.passiveAbilities ?? []), ...(creature.activatedAbilities ?? [])]) {
    if (modeledOtherAbilityKeys.has(normalizeAbilityKey(ability.name))) {
      creatureValueByKey.set(
        normalizeAbilityKey(ability.name),
        typeof ability.value === "number" || typeof ability.value === "string" ? ability.value : null,
      );
    }
  }

  // Update existing otherAbilities entries whose value has changed in creatures.runtime.json
  const filteredOtherAbilities = (base.otherAbilities ?? []).filter((entry) => {
    const key = normalizeAbilityKey(entry.name);
    return !modeledOtherAbilityKeys.has(key) || creatureAbilityKeys.has(key);
  });

  const updatedOtherAbilities = filteredOtherAbilities.map((entry) => {
    const freshValue = creatureValueByKey.get(normalizeAbilityKey(entry.name));
    if (freshValue === undefined) return entry; // not a modeled ability we track
    if (freshValue === null) return entry; // don't wipe a known catalog value with null
    if (freshValue === entry.value) return entry; // no change
    return { ...entry, value: freshValue };
  });

  const additions = [...(creature.passiveAbilities ?? []), ...(creature.activatedAbilities ?? [])]
    .filter((ability) => modeledOtherAbilityKeys.has(normalizeAbilityKey(ability.name)))
    .filter((ability) => !present.has(normalizeAbilityKey(ability.name)))
    .map((ability) => ({
      name: ability.name,
      value: typeof ability.value === "number" || typeof ability.value === "string" ? ability.value : null,
      semantics: ability.semantics,
    }));

  const hasFilteredEntries = filteredOtherAbilities.length !== (base.otherAbilities ?? []).length;
  const hasUpdates = updatedOtherAbilities.some((updated, i) => updated !== filteredOtherAbilities[i]);
  if (additions.length === 0 && !hasUpdates && !hasFilteredEntries) return base;
  return {
    ...base,
    otherAbilities: [...updatedOtherAbilities, ...additions],
  };
}

/**
 * Derive a status ID from a Block ability name.
 * "Block Bleed" -> "Bleed_Status", "Block Necropoison" -> "Necropoison_Status", etc.
 */
function blockAbilityToStatusId(abilityName: string): string | null {
  const m = abilityName.match(/^Block\s+(\S+)$/);
  if (!m) return null;
  return m[1] + "_Status";
}

function statusAttackAbilityToStatusId(abilityName: string): string | null {
  const m = abilityName.match(/^(.+?)\s+Attack$/i);
  if (!m) return null;
  return m[1].trim().replace(/\s+/g, "_") + "_Status";
}

function defensiveStatusAbilityToStatusId(abilityName: string): string | null {
  const m = abilityName.match(/^Defensive\s+(.+)$/i);
  if (!m) return null;
  return m[1].trim().replace(/\s+/g, "_") + "_Status";
}

/**
 * Ensure resistStatus is fully in sync with Block* abilities in creatures.runtime.json.
 * - Updates stale fraction values for existing entries
 * - Adds entries for Block abilities not yet in the catalog
 */
function backfillResistStatus(
  creature: CreatureRuntime,
  existing: Array<{ statusId: string; fraction: number; sourceAbility: string }>,
): Array<{ statusId: string; fraction: number; sourceAbility: string }> {
  const result = [...existing];
  const indexBySource = new Map<string, number>(
    existing.map((e, i) => [normalizeAbilityKey(e.sourceAbility), i]),
  );

  for (const ability of creature.passiveAbilities ?? []) {
    if (typeof ability.value !== "number") continue;
    const statusId = blockAbilityToStatusId(ability.name);
    if (!statusId) continue;

    const key = normalizeAbilityKey(ability.name);
    const idx = indexBySource.get(key);
    if (idx !== undefined) {
      if (result[idx].fraction !== ability.value) {
        result[idx] = { ...result[idx], fraction: ability.value };
      }
    } else {
      result.push({ statusId, fraction: ability.value, sourceAbility: ability.name });
      indexBySource.set(key, result.length - 1);
    }
  }

  return result;
}

function backfillApplyStatusFromAbilities(
  creature: CreatureRuntime,
  existing: Array<{ statusId: string; stacks: number; sourceAbility: string }>,
  resolveStatusIdFromAbility: (abilityName: string) => string | null,
): Array<{ statusId: string; stacks: number; sourceAbility: string }> {
  const result = [...existing];
  const indexBySource = new Map<string, number>(
    existing.map((entry, index) => [normalizeAbilityKey(entry.sourceAbility), index]),
  );

  for (const ability of creature.passiveAbilities ?? []) {
    if (typeof ability.value !== "number") continue;
    const statusId = resolveStatusIdFromAbility(ability.name);
    if (!statusId) continue;

    const key = normalizeAbilityKey(ability.name);
    const index = indexBySource.get(key);
    if (index !== undefined) {
      if (result[index].stacks !== ability.value || result[index].statusId !== statusId) {
        result[index] = { statusId, stacks: ability.value, sourceAbility: ability.name };
      }
    } else {
      result.push({ statusId, stacks: ability.value, sourceAbility: ability.name });
      indexBySource.set(key, result.length - 1);
    }
  }

  return result;
}

/** Normalized names of every ability the creature currently carries
 *  (passive + activated + breath). */
function creatureAbilityNameKeys(creature: CreatureRuntime): Set<string> {
  const keys = new Set<string>();
  for (const ability of [
    ...(creature.passiveAbilities ?? []),
    ...(creature.activatedAbilities ?? []),
    ...(creature.breathAbilities ?? []),
  ]) {
    keys.add(normalizeAbilityKey(ability.name));
  }
  return keys;
}

/**
 * Drop status entries whose `sourceAbility` is no longer one of the creature's
 * abilities. The s1/s2/a1 override snapshots and the v2 catalog are NOT
 * regenerated by the wiki sync (only `creatures.runtime.json` is), so when a
 * creature's kit changes - e.g. Zeoarex losing "Poison Attack" when it became a
 * Radiation carrier - the stale entry survives and the engine keeps applying a
 * phantom ailment (Zeoarex was still poisoning opponents off a removed ability).
 * The live ability list is the source of truth: an on-hit / on-hit-taken /
 * resist entry is real only if the ability that produces it is still present.
 * `backfill*` adds and updates entries from live abilities but never prunes; this
 * is the prune half, making the catalog self-heal across kit changes. Entries
 * with no `sourceAbility` (not ability-derived) are kept untouched.
 */
function dropOrphanedStatusEntries<T extends { sourceAbility?: string | null }>(
  list: T[],
  abilityKeys: Set<string>,
): T[] {
  return list.filter((entry) => {
    if (!entry.sourceAbility) return true;
    return abilityKeys.has(normalizeAbilityKey(entry.sourceAbility));
  });
}

export const effectsCatalog = Object.fromEntries(
  creaturesData.map((creature) => {
    // Source of truth = the wiki-sync-regenerated effects_catalog.runtime.v2.json
    // (`base`), then backfilled/value-synced from the live creature ability list
    // and orphan-pruned. The old s1/s2/a1 override snapshots that used to preempt
    // this were NOT regenerated by the sync, so a kit change left them stale and
    // they shadowed the fresh catalog (Zeoarex kept a removed "Poison Attack").
    // Removing that preemption is the root fix - the only inputs now are the
    // sync-fresh catalog + the sync-fresh ability list, both current every sync.
    const base = effectsCatalogRaw[creature.name] ?? {};
    const mergedBase = backfillModeledOtherAbilities(creature, base);
    const rawResistStatus = mergedBase.resistStatus ?? [];
    const rawApplyStatusOnHit = mergedBase.applyStatusOnHit ?? [];
    const rawApplyStatusOnHitTaken = mergedBase.applyStatusOnHitTaken ?? [];
    const abilityKeys = creatureAbilityNameKeys(creature);
    return [
      creature.name,
      {
        ...mergedBase,
        resistStatus: dropOrphanedStatusEntries(backfillResistStatus(creature, rawResistStatus), abilityKeys),
        applyStatusOnHit: dropOrphanedStatusEntries(
          backfillApplyStatusFromAbilities(creature, rawApplyStatusOnHit, statusAttackAbilityToStatusId),
          abilityKeys,
        ),
        applyStatusOnHitTaken: dropOrphanedStatusEntries(
          backfillApplyStatusFromAbilities(creature, rawApplyStatusOnHitTaken, defensiveStatusAbilityToStatusId),
          abilityKeys,
        ),
      } satisfies EffectsCatalogByCreature,
    ];
  }),
);
const customEffectsCatalogNames = new Set<string>();

export const statusEffects = statusEffectsRuntime as unknown as StatusEffect[];
export const specialAbilities = specialAbilitiesRuntime as SpecialAbilitiesRoot;
export const breathSpecs = (breathSpecsRuntime as BreathSpecsRoot).breathTypes;

export const statusById: Record<string, StatusEffect> = Object.fromEntries(
  statusEffects.map((status) => [status.id, status]),
);

export const breathSpecByName: Record<string, BreathSpec> = Object.fromEntries(
  breathSpecs.map((spec) => [spec.name, spec]),
);

export const breathSpecByNormalizedName: Record<string, BreathSpec> = Object.fromEntries(
  breathSpecs.map((spec) => [normalizeBreathSpecKey(spec.name), spec]),
);

export function registerTemporaryCreatureEffects(creatureName: string, effects: EffectsCatalogByCreature): void {
  (effectsCatalog as Record<string, EffectsCatalogByCreature>)[creatureName] = effects;
  customEffectsCatalogNames.add(creatureName);
}

export function unregisterTemporaryCreatureEffects(creatureName: string): void {
  if (!customEffectsCatalogNames.has(creatureName)) return;
  customEffectsCatalogNames.delete(creatureName);
  delete (effectsCatalog as Record<string, EffectsCatalogByCreature>)[creatureName];
}

export const traitById = Object.fromEntries(traits.map((trait) => [trait.id, trait]));

export {
  creatureByName,
  creaturesData,
  getCreatureIcon,
  getPlushieIcon,
  getTraitIcon,
  plushieByName,
  plushies,
  rules,
  traits,
  veneration,
};
