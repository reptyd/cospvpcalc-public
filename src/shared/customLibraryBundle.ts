/**
 * Combined export / import bundle for the three custom-library
 * resources (creatures, abilities, timings).
 *
 * The bundle is a single JSON file users can share with friends or
 * back up before clearing localStorage. Versioned schema; future
 * schema changes bump `version` and add a migration path.
 *
 * On import the bundle is merged into the current library. Incoming
 * records add new entries and update matching ids/names; unrelated
 * local entries are left intact.
 */

// Minimal Node `Buffer` shape used as base64 fallback when running
// outside the browser (vitest, CLI scripts). No `@types/node` dep —
// keeps tsconfig.app.json clean of node types we don't want app code
// pulling in.
declare const Buffer: {
  from(input: string, encoding: string): { toString(encoding: string): string };
};

import {
  importCustomAbilityRecords,
  listCustomAbilityImportConflicts,
  snapshotCustomAbilityRecords,
  type CustomAbilityRecord,
} from "./customAbilities";
import {
  importCustomTimingRecords,
  listCustomTimingImportConflicts,
  snapshotCustomTimingRecords,
  type CustomTimingRecord,
} from "./customTimings";
import {
  importCustomCreatureRecords,
  listCustomCreatureImportConflicts,
  listCustomCreatureRecords,
  type CustomCreatureRecord,
} from "../engine/customCreatures";

export type CustomLibraryBundleV1 = {
  version: 1;
  exportedAt: number;
  abilities: CustomAbilityRecord[];
  timings: CustomTimingRecord[];
  creatures: CustomCreatureRecord[];
};

export type ImportResult = {
  abilities: { imported: number; skipped: number };
  timings: { imported: number; skipped: number };
  creatures: { imported: number; skipped: number };
};

export type ImportOptions = {
  replaceAbilityConflicts?: boolean;
  replaceTimingConflicts?: boolean;
  replaceCreatureConflicts?: boolean;
};

export type ImportConflictSummary = {
  abilities: string[];
  timings: string[];
  creatures: string[];
};

const SUPPORTED_VERSION = 1;

/** Build the bundle from the current in-memory libraries. */
export function exportCustomLibraryBundle(): CustomLibraryBundleV1 {
  return {
    version: SUPPORTED_VERSION,
    exportedAt: Date.now(),
    abilities: snapshotCustomAbilityRecords(),
    timings: snapshotCustomTimingRecords(),
    creatures: listCustomCreatureRecords(),
  };
}

/** Stringify the bundle for download. */
export function exportCustomLibraryBundleJson(): string {
  return JSON.stringify(exportCustomLibraryBundle(), null, 2);
}

/**
 * Parse + import a previously-exported bundle. Merges into the
 * current libraries. Returns per-resource counts so the UI can
 * show "imported N, skipped M" feedback.
 */
export async function importCustomLibraryBundle(
  payload: unknown,
  options?: ImportOptions,
): Promise<ImportResult> {
  const bundle = parseBundle(payload);
  const abilities = await importCustomAbilityRecords(bundle.abilities, {
    replaceConflicts: options?.replaceAbilityConflicts,
  });
  const timings = await importCustomTimingRecords(bundle.timings, {
    replaceConflicts: options?.replaceTimingConflicts,
  });
  const creatures = importCustomCreatureRecords(bundle.creatures, {
    replaceConflicts: options?.replaceCreatureConflicts,
  });
  return {
    abilities,
    timings,
    creatures,
  };
}

function parseBundle(value: unknown): CustomLibraryBundleV1 {
  if (typeof value !== "object" || value === null) {
    throw new Error("bundle must be a JSON object");
  }
  const v = value as Record<string, unknown>;
  if (v.version !== SUPPORTED_VERSION) {
    throw new Error(
      `unsupported bundle version: expected ${SUPPORTED_VERSION}, got ${String(v.version)}`,
    );
  }
  if (!Array.isArray(v.abilities)) throw new Error("bundle.abilities must be an array");
  if (!Array.isArray(v.timings)) throw new Error("bundle.timings must be an array");
  if (!Array.isArray(v.creatures)) throw new Error("bundle.creatures must be an array");
  return {
    version: SUPPORTED_VERSION,
    exportedAt: typeof v.exportedAt === "number" ? v.exportedAt : Date.now(),
    abilities: v.abilities as CustomAbilityRecord[],
    timings: v.timings as CustomTimingRecord[],
    creatures: v.creatures as CustomCreatureRecord[],
  };
}

/** Convenience wrapper — accepts a raw JSON string instead of a parsed object. */
export async function importCustomLibraryBundleJson(
  json: string,
  options?: ImportOptions,
): Promise<ImportResult> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (err) {
    throw new Error(
      `bundle JSON parse failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  return importCustomLibraryBundle(parsed, options);
}

export function listCustomLibraryBundleCreatureConflicts(
  payload: unknown,
): string[] {
  return listCustomCreatureImportConflicts(parseBundle(payload).creatures);
}

export function listCustomLibraryBundleImportConflicts(
  payload: unknown,
): ImportConflictSummary {
  const bundle = parseBundle(payload);
  return {
    abilities: listCustomAbilityImportConflicts(bundle.abilities),
    timings: listCustomTimingImportConflicts(bundle.timings),
    creatures: listCustomCreatureImportConflicts(bundle.creatures),
  };
}

export function listCustomLibraryBundleImportConflictsJson(
  json: string,
): ImportConflictSummary {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (err) {
    throw new Error(
      `bundle JSON parse failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  return listCustomLibraryBundleImportConflicts(parsed);
}

/**
 * Encode the current bundle as a URL-hash payload — share-link
 * shape. Uses base64-encoded JSON with a stable `cosab1:` prefix
 * so the page can detect-and-import on load.
 */
export function encodeBundleAsUrlHash(): string {
  const json = exportCustomLibraryBundleJson();
  // btoa requires latin-1; encodeURIComponent first to handle UTF-8.
  const encoded =
    typeof btoa === "function"
      ? btoa(unescape(encodeURIComponent(json)))
      : Buffer.from(json, "utf-8").toString("base64");
  return `cosab1:${encoded}`;
}

/**
 * Decode a URL-hash payload produced by [`encodeBundleAsUrlHash`]
 * and import its contents through [`importCustomLibraryBundleJson`].
 * Returns `null` if the payload doesn't carry the expected prefix.
 */
export async function tryImportFromUrlHash(
  hash: string,
  options?: ImportOptions,
): Promise<ImportResult | null> {
  const trimmed = hash.replace(/^#/, "");
  if (!trimmed.startsWith("cosab1:")) return null;
  const payload = trimmed.slice("cosab1:".length);
  let json: string;
  try {
    if (typeof atob === "function") {
      json = decodeURIComponent(escape(atob(payload)));
    } else {
      json = Buffer.from(payload, "base64").toString("utf-8");
    }
  } catch {
    return null;
  }
  return importCustomLibraryBundleJson(json, options);
}
