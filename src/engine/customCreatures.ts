import {
  isCustomCreatureName,
  normalizeCreatureSearchName,
  registerTemporaryCreature,
  unregisterTemporaryCreature,
  listCustomCreatureNames,
  creatureByName,
} from "./creatureData";
import {
  registerTemporaryCreatureEffects,
  unregisterTemporaryCreatureEffects,
} from "./data";
import {
  registerTemporaryCompareAppetiteEntry,
  unregisterTemporaryCompareAppetiteEntry,
  type CompareAppetiteEntry,
} from "./compareAppetiteData";
import { normalizeCustomCreaturePayload } from "./customCreatureValidation";
import type { CreatureRuntime, EffectsCatalogByCreature } from "./types";

export type CustomCreatureRecord = {
  creature: CreatureRuntime;
  effects: EffectsCatalogByCreature;
  appetite: CompareAppetiteEntry | null;
  iconName: string | null;
  createdAt: number;
};

type CustomCreatureCodePayloadV1 = {
  version: 1;
  creature: CreatureRuntime;
  effects: EffectsCatalogByCreature;
  appetite?: CompareAppetiteEntry | null;
  iconName?: string | null;
};

const CUSTOM_CREATURE_CODE_PREFIX = "COSC1:";
const CUSTOM_CREATURE_STORAGE_KEY = "cos_calc.customCreatures.v1";
const customCreatureRecords = new Map<string, CustomCreatureRecord>();
const listeners = new Set<() => void>();
let isRestoringCustomCreatures = false;

type CustomCreatureStoragePayloadV1 = {
  version: 1;
  records: CustomCreatureRecord[];
};

function persistCustomCreatureRecords(): void {
  if (isRestoringCustomCreatures) return;
  if (typeof localStorage === "undefined") return;
  try {
    if (customCreatureRecords.size === 0) {
      localStorage.removeItem(CUSTOM_CREATURE_STORAGE_KEY);
      return;
    }
    const payload: CustomCreatureStoragePayloadV1 = {
      version: 1,
      records: [...customCreatureRecords.values()],
    };
    localStorage.setItem(CUSTOM_CREATURE_STORAGE_KEY, JSON.stringify(payload));
  } catch (error) {
    // Quota exceeded, storage disabled (private mode), or serialization failure:
    // keep the in-memory registry working, surface for debugging only.
     
    console.warn("[customCreatures] failed to persist to localStorage:", error);
  }
}

function emitChange(): void {
  for (const listener of listeners) listener();
  persistCustomCreatureRecords();
}

function getAllKnownCreatureNames(): string[] {
  return Object.keys(creatureByName);
}

function validateCreatureName(name: string, replacingName?: string): string | null {
  if (!name.trim()) return "Creature name is required.";
  const normalized = normalizeCreatureSearchName(name);
  for (const existingName of getAllKnownCreatureNames()) {
    if (replacingName && existingName === replacingName) continue;
    if (normalizeCreatureSearchName(existingName) === normalized) {
      return `Creature name "${name}" conflicts with existing creature "${existingName}".`;
    }
  }
  return null;
}

function hasAbilityNamed(creature: CreatureRuntime, abilityName: string): boolean {
  const allAbilities = [...(creature.passiveAbilities ?? []), ...(creature.activatedAbilities ?? []), ...(creature.breathAbilities ?? [])];
  return allAbilities.some((ability) => ability.name === abilityName);
}

function findCustomCreatureNameByNormalizedName(name: string): string | null {
  const normalized = normalizeCreatureSearchName(name);
  for (const existingName of customCreatureRecords.keys()) {
    if (normalizeCreatureSearchName(existingName) === normalized) {
      return existingName;
    }
  }
  return null;
}

function encodeBase64Url(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decodeBase64Url(value: string): string {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padding = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
  const binary = atob(`${normalized}${padding}`);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function subscribeCustomCreatureRegistry(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function listCustomCreatureRecords(): CustomCreatureRecord[] {
  return [...customCreatureRecords.values()].sort((left, right) => left.creature.name.localeCompare(right.creature.name));
}

export function getCustomCreatureRecord(name: string): CustomCreatureRecord | null {
  return customCreatureRecords.get(name) ?? null;
}

export function isCustomCreatureRegistryEmpty(): boolean {
  return customCreatureRecords.size === 0;
}

export function registerCustomCreatureRecord(
  input: {
    creature: CreatureRuntime;
    effects: EffectsCatalogByCreature;
    appetite?: CompareAppetiteEntry | null;
    iconName?: string | null;
  },
  options?: {
    replace?: boolean;
  },
): {
  ok: boolean;
  error?: string;
  warnings: string[];
} {
  const normalized = normalizeCustomCreaturePayload(input);
  if (!normalized.ok || !normalized.payload) {
    return { ok: false, error: normalized.error, warnings: normalized.warnings };
  }
  const warnings = [...normalized.warnings];
  const creature = normalized.payload.creature;
  const creatureName = creature.name;
  const replacingName = options?.replace ? creatureName : undefined;
  const nameError = validateCreatureName(creatureName, replacingName);
  if (nameError) {
    return { ok: false, error: nameError, warnings };
  }

  if (customCreatureRecords.has(creatureName) && !options?.replace) {
    return {
      ok: false,
      error: `Custom creature "${creatureName}" already exists in this session.`,
      warnings,
    };
  }

  if (options?.replace && customCreatureRecords.has(creatureName)) {
    unregisterCustomCreatureRecord(creatureName);
  }

  const record: CustomCreatureRecord = {
    creature,
    effects: normalized.payload.effects,
    appetite: normalized.payload.appetite,
    iconName: normalized.payload.iconName,
    createdAt: Date.now(),
  };

  registerTemporaryCreature(creature, { iconName: record.iconName });
  registerTemporaryCreatureEffects(creatureName, record.effects);
  if (record.appetite) {
    registerTemporaryCompareAppetiteEntry(creatureName, record.appetite);
  } else {
    unregisterTemporaryCompareAppetiteEntry(creatureName);
  }

  customCreatureRecords.set(creatureName, record);

  if ((hasAbilityNamed(creature, "Gourmandizer") || hasAbilityNamed(creature, "Reflux")) && !record.appetite) {
    warnings.push("Gourmandizer/Reflux need a compare appetite profile. Hunger-rule behavior will otherwise use the fallback default.");
  }

  emitChange();
  return { ok: true, warnings };
}

/**
 * Register a creature into the runtime *only* — no persistence, no
 * entry in the custom-creature registry. Used by imported-match
 * (share-link) viewing so a shared creature is simulatable without
 * polluting the viewer's saved custom creatures. Lasts for the page
 * session; a real registry restore silently overwrites it.
 */
export function registerEphemeralCustomCreature(
  record: Pick<CustomCreatureRecord, "creature" | "effects" | "appetite" | "iconName">,
): void {
  registerTemporaryCreature(record.creature, { iconName: record.iconName });
  registerTemporaryCreatureEffects(record.creature.name, record.effects);
  if (record.appetite) {
    registerTemporaryCompareAppetiteEntry(record.creature.name, record.appetite);
  }
}

export function unregisterCustomCreatureRecord(name: string): void {
  if (!customCreatureRecords.has(name) && !isCustomCreatureName(name)) return;
  customCreatureRecords.delete(name);
  unregisterTemporaryCompareAppetiteEntry(name);
  unregisterTemporaryCreatureEffects(name);
  unregisterTemporaryCreature(name);
  emitChange();
}

export function clearCustomCreatureRecords(): void {
  const names = listCustomCreatureNames();
  for (const name of names) {
    unregisterCustomCreatureRecord(name);
  }
}

export function importCustomCreatureRecords(
  incoming: CustomCreatureRecord[],
  options?: {
    replaceConflicts?: boolean;
  },
): { imported: number; skipped: number } {
  let imported = 0;
  let skipped = 0;
  for (const record of incoming) {
    if (!record?.creature?.name || !record.effects) {
      skipped += 1;
      continue;
    }
    const existingConflictName = findCustomCreatureNameByNormalizedName(
      record.creature.name,
    );
    const replace = options?.replaceConflicts === true && existingConflictName !== null;
    if (existingConflictName !== null && replace && existingConflictName !== record.creature.name) {
      unregisterCustomCreatureRecord(existingConflictName);
    }
    const result = registerCustomCreatureRecord(
      {
        creature: record.creature,
        effects: record.effects,
        appetite: record.appetite ?? null,
        iconName: record.iconName ?? null,
      },
      { replace: existingConflictName !== null && replace && existingConflictName === record.creature.name },
    );
    if (result.ok) {
      imported += 1;
    } else {
      skipped += 1;
       
      console.warn(
        `[customCreatures] import skipped "${record.creature.name}": ${result.error}`,
      );
    }
  }
  return { imported, skipped };
}

export function listCustomCreatureImportConflicts(
  incoming: CustomCreatureRecord[],
): string[] {
  const conflicts = new Set<string>();
  const existingByNormalizedName = new Map<string, string>();
  for (const name of customCreatureRecords.keys()) {
    existingByNormalizedName.set(normalizeCreatureSearchName(name), name);
  }
  for (const record of incoming) {
    const name = record?.creature?.name;
    if (!name) continue;
    const existingName = existingByNormalizedName.get(normalizeCreatureSearchName(name));
    if (existingName) {
      conflicts.add(existingName);
    }
  }
  return [...conflicts].sort((left, right) => left.localeCompare(right));
}

export function encodeCustomCreatureCode(record: Pick<CustomCreatureRecord, "creature" | "effects" | "appetite" | "iconName">): string {
  const payload: CustomCreatureCodePayloadV1 = {
    version: 1,
    creature: record.creature,
    effects: record.effects,
    appetite: record.appetite,
    iconName: record.iconName,
  };
  return `${CUSTOM_CREATURE_CODE_PREFIX}${encodeBase64Url(JSON.stringify(payload))}`;
}

export function restoreCustomCreatureRecords(): void {
  if (typeof localStorage === "undefined") return;
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(CUSTOM_CREATURE_STORAGE_KEY);
  } catch {
    return;
  }
  if (!raw) {
    if (customCreatureRecords.size > 0) {
      isRestoringCustomCreatures = true;
      try {
        clearCustomCreatureRecords();
      } finally {
        isRestoringCustomCreatures = false;
      }
    }
    return;
  }

  let parsed: CustomCreatureStoragePayloadV1 | null = null;
  try {
    parsed = JSON.parse(raw) as CustomCreatureStoragePayloadV1;
  } catch {
     
    console.warn("[customCreatures] discarding unparseable stored data");
    try {
      localStorage.removeItem(CUSTOM_CREATURE_STORAGE_KEY);
    } catch {
      // ignore
    }
    return;
  }

  if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.records)) {
     
    console.warn("[customCreatures] discarding stored data with unknown shape");
    try {
      localStorage.removeItem(CUSTOM_CREATURE_STORAGE_KEY);
    } catch {
      // ignore
    }
    return;
  }

  isRestoringCustomCreatures = true;
  try {
    for (const existingName of [...customCreatureRecords.keys()]) {
      unregisterCustomCreatureRecord(existingName);
    }
    for (const record of parsed.records) {
      if (!record?.creature?.name || !record.effects) continue;
      const result = registerCustomCreatureRecord(
        {
          creature: record.creature,
          effects: record.effects,
          appetite: record.appetite ?? null,
          iconName: record.iconName ?? null,
        },
        { replace: true },
      );
      if (!result.ok) {
         
        console.warn(`[customCreatures] skipped stored record "${record.creature.name}": ${result.error}`);
      }
    }
  } finally {
    isRestoringCustomCreatures = false;
  }
}

export function installCustomCreatureCrossTabSync(): void {
  if (typeof window === "undefined") return;
  window.addEventListener("storage", (event) => {
    if (event.key !== CUSTOM_CREATURE_STORAGE_KEY) return;
    restoreCustomCreatureRecords();
  });
}

export function decodeCustomCreatureCode(code: string): {
  ok: boolean;
  error?: string;
  payload?: {
    creature: CreatureRuntime;
    effects: EffectsCatalogByCreature;
    appetite: CompareAppetiteEntry | null;
    iconName: string | null;
  };
} {
  const trimmed = code.trim();
  if (!trimmed.startsWith(CUSTOM_CREATURE_CODE_PREFIX)) {
    return { ok: false, error: "Custom creature code must start with COSC1:." };
  }
  try {
    const raw = decodeBase64Url(trimmed.slice(CUSTOM_CREATURE_CODE_PREFIX.length));
    const parsed = JSON.parse(raw) as CustomCreatureCodePayloadV1;
    if (parsed?.version !== 1 || !parsed?.creature || !parsed?.effects) {
      return { ok: false, error: "Custom creature code is missing required data." };
    }
    return {
      ok: true,
      payload: {
        creature: parsed.creature,
        effects: parsed.effects,
        appetite: parsed.appetite ?? null,
        iconName: parsed.iconName ?? null,
      },
    };
  } catch {
    return { ok: false, error: "Custom creature code could not be decoded." };
  }
}
