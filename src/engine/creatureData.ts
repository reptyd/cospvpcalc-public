import creaturesRuntime from "../../data/creatures.runtime.json";
import creaturesIconsRuntime from "../../data/creatures.icons.json";
import type { CreatureRuntime } from "./types";
// Name-normalization helpers live in a zero-import leaf module so boot-light
// code can use them without pulling this catalog. Imported here for internal
// use AND re-exported so existing `creatureData` consumers are unaffected.
import {
  creatureNameMatchesQuery,
  normalizeCreatureSearchName,
  stripCreatureDiacritics,
} from "./creatureNameUtils";
export { creatureNameMatchesQuery, normalizeCreatureSearchName, stripCreatureDiacritics };

type CreaturesRoot = {
  creatures: CreatureRuntime[];
};
type IconsRoot = { icons: Record<string, string> };

// The runtime JSON stores absent stats as explicit `null`, while CreatureStats
// types the optional numeric fields as `number?`. That has always been bridged
// by this cast; go through `unknown` so a data refresh that fills every field
// with null (e.g. a wiki sync completing a stub creature) can't trip TS2352.
export const creaturesData = (creaturesRuntime as unknown as CreaturesRoot).creatures;
const baseCreatureCount = creaturesData.length;

export const creatureByName: Record<string, CreatureRuntime> = Object.fromEntries(
  creaturesData.map((creature) => [creature.name, creature]),
);
const customCreatureNames = new Set<string>();

const creatureCanonicalNameByNormalized = Object.fromEntries(
  creaturesData.map((creature) => [normalizeCreatureSearchName(creature.name), creature.name]),
) as Record<string, string>;

export function resolveCreatureName(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (creatureByName[trimmed]) return trimmed;
  return creatureCanonicalNameByNormalized[normalizeCreatureSearchName(trimmed)] ?? null;
}

export function getCreatureByName(name: string): CreatureRuntime | undefined {
  const resolvedName = resolveCreatureName(name);
  return resolvedName ? creatureByName[resolvedName] : undefined;
}

export const creatureSuggestionNames = Array.from(
  new Set(
    creaturesData.flatMap((creature) => {
      const alias = stripCreatureDiacritics(creature.name).trim();
      return alias && alias !== creature.name ? [creature.name, alias] : [creature.name];
    }),
  ),
).sort((a, b) => a.localeCompare(b));

export const creatureIcons = ((creaturesIconsRuntime as IconsRoot).icons ?? {}) as Record<string, string>;
export const getCreatureIcon = (name: string): string | null => {
  const resolvedName = resolveCreatureName(name);
  return (resolvedName ? creatureIcons[resolvedName] : creatureIcons[name]) ?? null;
};

function refreshCreatureSuggestionName(name: string): void {
  const alias = stripCreatureDiacritics(name).trim();
  for (const candidate of alias && alias !== name ? [name, alias] : [name]) {
    if (!creatureSuggestionNames.includes(candidate)) {
      creatureSuggestionNames.push(candidate);
    }
  }
  creatureSuggestionNames.sort((a, b) => a.localeCompare(b));
}

function pruneCreatureSuggestionName(name: string): void {
  const aliases = new Set<string>([name]);
  const alias = stripCreatureDiacritics(name).trim();
  if (alias && alias !== name) aliases.add(alias);
  for (const candidate of aliases) {
    const nextIndex = creatureSuggestionNames.indexOf(candidate);
    if (nextIndex >= 0) creatureSuggestionNames.splice(nextIndex, 1);
  }
}

export function isCustomCreatureName(name: string | null | undefined): boolean {
  return typeof name === "string" && customCreatureNames.has(name);
}

export function listCustomCreatureNames(): string[] {
  return [...customCreatureNames].sort((a, b) => a.localeCompare(b));
}

export function registerTemporaryCreature(
  creature: CreatureRuntime,
  options?: {
    iconName?: string | null;
    iconDataUrl?: string | null;
  },
): void {
  const existingCustom = customCreatureNames.has(creature.name);
  const existingIndex = creaturesData.findIndex((entry) => entry.name === creature.name);
  if (existingIndex >= 0) {
    creaturesData.splice(existingIndex, 1, creature);
  } else {
    creaturesData.push(creature);
  }
  creatureByName[creature.name] = creature;
  creatureCanonicalNameByNormalized[normalizeCreatureSearchName(creature.name)] = creature.name;
  // A user-uploaded icon wins; otherwise borrow the named creature's icon. Both
  // land in `creatureIcons[name]`, so every getCreatureIcon call site shows it.
  if (options?.iconDataUrl) {
    creatureIcons[creature.name] = options.iconDataUrl;
  } else if (options?.iconName) {
    const resolvedIconName = resolveCreatureName(options.iconName) ?? options.iconName;
    const resolvedIcon = creatureIcons[resolvedIconName];
    if (resolvedIcon) creatureIcons[creature.name] = resolvedIcon;
  } else {
    // No icon source on this (re)registration: clear any icon a previous edit
    // assigned so removing a custom icon actually drops it.
    delete creatureIcons[creature.name];
  }
  if (!existingCustom) {
    customCreatureNames.add(creature.name);
    refreshCreatureSuggestionName(creature.name);
  }
}

export function unregisterTemporaryCreature(name: string): void {
  if (!customCreatureNames.has(name)) return;
  customCreatureNames.delete(name);
  delete creatureByName[name];
  delete creatureCanonicalNameByNormalized[normalizeCreatureSearchName(name)];
  delete creatureIcons[name];
  const index = creaturesData.findIndex((entry) => entry.name === name);
  if (index >= 0 && index >= baseCreatureCount) {
    creaturesData.splice(index, 1);
  } else if (index >= 0) {
    creaturesData.splice(index, 1);
  }
  pruneCreatureSuggestionName(name);
}
