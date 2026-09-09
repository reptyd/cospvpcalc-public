// This registry is BOOT-reachable (main.tsx restore + App list/subscribe), so
// it must NOT statically import the heavy catalog modules (creatureData / data /
// compareAppetiteData) - that's what was forcing the ~1.2 MB creature+effects
// JSON to parse on the boot main thread. Catalog writes are deferred behind a
// `CustomCreatureCatalogInjector`, installed lazily by `customCreatureCatalogBridge`
// once `creatureData` actually loads (App.loadCreatureData). Only the JSON-free
// name util is imported eagerly; the appetite type is type-only (erased).
import { normalizeCreatureSearchName } from "./creatureNameUtils";
import { deflateCustomCreatureCode, inflateCustomCreatureCode } from "../shared/customCreatureCode";
import { isQuotaExceededError } from "../shared/localStorageQuota";
import type { CreatureRuntime, EffectsCatalogByCreature } from "./types";
import type { CompareAppetiteEntry } from "./compareAppetiteData";

// Bridges the registry to the catalog modules without a static import. The lazy
// bridge constructs this from creatureData/data/compareAppetiteData and installs
// it; everything registered/restored before then is drained on install.
export type CustomCreatureCatalogInjector = {
  applyCreature(
    record: Pick<CustomCreatureRecord, "creature" | "effects" | "appetite" | "iconName"> & {
      iconDataUrl?: string | null;
    },
  ): void;
  removeCreature(name: string): void;
  allKnownNames(): string[];
};
let catalogInjector: CustomCreatureCatalogInjector | null = null;
// Ephemeral (share-link) creatures registered before the injector is ready.
const pendingEphemeralCreatures: Pick<CustomCreatureRecord, "creature" | "effects" | "appetite" | "iconName">[] = [];

/**
 * Installed by the lazy catalog bridge once creatureData/data have loaded.
 * Drains every record registered or restored before the catalogs were ready
 * (persisted records live in the Map; ephemerals in pendingEphemeralCreatures),
 * so the runtime catalog ends up with the same custom creatures regardless of
 * whether registration happened before or after the catalog loaded.
 */
export function installCustomCreatureCatalogInjector(injector: CustomCreatureCatalogInjector): void {
  catalogInjector = injector;
  for (const record of customCreatureRecords.values()) injector.applyCreature(record);
  for (const record of pendingEphemeralCreatures.splice(0)) injector.applyCreature(record);
}

export type CustomCreatureRecord = {
  creature: CreatureRuntime;
  effects: EffectsCatalogByCreature;
  appetite: CompareAppetiteEntry | null;
  // Borrow an existing creature's icon by name.
  iconName: string | null;
  // A user-uploaded icon as a small image data URL. Takes precedence over
  // iconName when present.
  iconDataUrl: string | null;
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

// Set true when the most recent persist was rejected for being over quota, so
// the save UI can warn that the creature is live but won't survive a reload.
let lastPersistQuotaExceeded = false;

export function didLastPersistExceedQuota(): boolean {
  return lastPersistQuotaExceeded;
}

function persistCustomCreatureRecords(): void {
  if (isRestoringCustomCreatures) return;
  if (typeof localStorage === "undefined") return;
  try {
    if (customCreatureRecords.size === 0) {
      localStorage.removeItem(CUSTOM_CREATURE_STORAGE_KEY);
      lastPersistQuotaExceeded = false;
      return;
    }
    const payload: CustomCreatureStoragePayloadV1 = {
      version: 1,
      records: [...customCreatureRecords.values()],
    };
    localStorage.setItem(CUSTOM_CREATURE_STORAGE_KEY, JSON.stringify(payload));
    lastPersistQuotaExceeded = false;
  } catch (error) {
    // Quota exceeded, storage disabled (private mode), or serialization failure:
    // keep the in-memory registry working, surface for debugging only.
    lastPersistQuotaExceeded = isQuotaExceededError(error);
    console.warn("[customCreatures] failed to persist to localStorage:", error);
  }
}

function emitChange(): void {
  for (const listener of listeners) listener();
  persistCustomCreatureRecords();
}

function getAllKnownCreatureNames(): string[] {
  // Full roster (base + custom) via the injector once the catalog has loaded.
  // Before then, only custom names are knowable - fine, because name-conflict
  // validation only runs on register/import, which happen on the Custom page
  // (catalog already loaded) or are trusted share-link/restore payloads.
  return catalogInjector ? catalogInjector.allKnownNames() : [...customCreatureRecords.keys()];
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

export async function registerCustomCreatureRecord(
  input: {
    creature: CreatureRuntime;
    effects: EffectsCatalogByCreature;
    appetite?: CompareAppetiteEntry | null;
    iconName?: string | null;
    iconDataUrl?: string | null;
  },
  options?: {
    replace?: boolean;
  },
): Promise<{
  ok: boolean;
  error?: string;
  warnings: string[];
  // True when the save succeeded in memory but could not be written to
  // localStorage because the origin's quota is full.
  storageQuotaExceeded?: boolean;
}> {
  // Saving a creature needs the catalog: validation checks effects against the
  // live status/breath tables, and the name-conflict check needs the full
  // roster. Both live behind heavy data modules, so we load them on demand and
  // install the catalog bridge (idempotent) here - that's what keeps the boot
  // path catalog-free while guaranteeing the injector is ready before we write.
  const { ensureCustomCreatureCatalogBridge } = await import("./customCreatureCatalogBridge");
  ensureCustomCreatureCatalogBridge();
  const { normalizeCustomCreaturePayload } = await import("./customCreatureValidation");
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
    iconDataUrl: normalized.payload.iconDataUrl,
    createdAt: Date.now(),
  };

  catalogInjector?.applyCreature(record);
  customCreatureRecords.set(creatureName, record);

  if ((hasAbilityNamed(creature, "Gourmandizer") || hasAbilityNamed(creature, "Reflux")) && !record.appetite) {
    warnings.push("Gourmandizer/Reflux need a compare appetite profile. Hunger-rule behavior will otherwise use the fallback default.");
  }

  emitChange();
  return { ok: true, warnings, storageQuotaExceeded: lastPersistQuotaExceeded };
}

/**
 * Register a creature into the runtime *only* - no persistence, no
 * entry in the custom-creature registry. Used by imported-match
 * (share-link) viewing so a shared creature is simulatable without
 * polluting the viewer's saved custom creatures. Lasts for the page
 * session; a real registry restore silently overwrites it.
 */
export function registerEphemeralCustomCreature(
  record: Pick<CustomCreatureRecord, "creature" | "effects" | "appetite" | "iconName">,
): void {
  // Inject now if the catalog is ready; otherwise buffer until the bridge
  // installs (share-link decode runs at boot, before creatureData loads).
  if (catalogInjector) catalogInjector.applyCreature(record);
  else pendingEphemeralCreatures.push(record);
}

export function unregisterCustomCreatureRecord(name: string): void {
  if (!customCreatureRecords.has(name)) return;
  customCreatureRecords.delete(name);
  catalogInjector?.removeCreature(name);
  emitChange();
}

export function clearCustomCreatureRecords(): void {
  for (const name of [...customCreatureRecords.keys()]) {
    unregisterCustomCreatureRecord(name);
  }
}

export async function importCustomCreatureRecords(
  incoming: CustomCreatureRecord[],
  options?: {
    replaceConflicts?: boolean;
  },
): Promise<{ imported: number; skipped: number }> {
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
    const result = await registerCustomCreatureRecord(
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
  const json = JSON.stringify(payload);
  const legacy = `${CUSTOM_CREATURE_CODE_PREFIX}${encodeBase64Url(json)}`;
  const compact = deflateCustomCreatureCode(json);
  // Both decode; emit the shorter (deflate wins on any non-trivial creature).
  return compact.length < legacy.length ? compact : legacy;
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
    // Drop the current set from both the Map and (if loaded) the catalog.
    for (const existingName of [...customCreatureRecords.keys()]) {
      customCreatureRecords.delete(existingName);
      catalogInjector?.removeCreature(existingName);
    }
    // Stored records are the user's own (validated at save), so they're loaded
    // directly into the registry without re-validating against the live roster
    // - that's what lets restore run at boot WITHOUT the catalog loaded. The
    // bridge injects them into the catalog now (if loaded) or on install.
    for (const record of parsed.records) {
      if (!record?.creature?.name || !record.effects) continue;
      const stored: CustomCreatureRecord = {
        creature: record.creature,
        effects: record.effects,
        appetite: record.appetite ?? null,
        iconName: record.iconName ?? null,
        iconDataUrl: typeof record.iconDataUrl === "string" ? record.iconDataUrl : null,
        createdAt: typeof record.createdAt === "number" ? record.createdAt : Date.now(),
      };
      customCreatureRecords.set(stored.creature.name, stored);
      catalogInjector?.applyCreature(stored);
    }
  } finally {
    isRestoringCustomCreatures = false;
  }
  // Refresh listeners WITHOUT re-persisting (we just read this from storage; a
  // cross-tab restore must not echo the write back).
  for (const listener of listeners) listener();
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
  const inflated = inflateCustomCreatureCode(trimmed);
  if (inflated === null && !trimmed.startsWith(CUSTOM_CREATURE_CODE_PREFIX)) {
    return { ok: false, error: "Custom creature code must start with COSC1: or COSC2:." };
  }
  try {
    const raw = inflated ?? decodeBase64Url(trimmed.slice(CUSTOM_CREATURE_CODE_PREFIX.length));
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
