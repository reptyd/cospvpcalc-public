/**
 * Custom Abilities library - localStorage-backed in-memory store.
 *
 * Mirrors the pattern in `engine/customCreatures.ts`: in-memory
 * Map of records keyed by ability id, listener pub/sub for UI
 * subscribers, persistent JSON-blob in localStorage with a
 * versioned schema, cross-tab sync via the `storage` event.
 *
 * The store also keeps the engine's process-wide registry in sync
 * via the `customAbilityBridge` wrappers - every register / unregister
 * fires both into localStorage AND into the WASM module (when the
 * bundle is fresh enough). At page-load `restoreCustomAbilityRecords`
 * replays everything to the WASM side so the engine matches the
 * persisted view.
 *
 * Twin file: `customTimings.ts` keeps the same shape for user-authored
 * timing policies. Edits to bridge-sync, validation, restore, or
 * import semantics here should usually be mirrored there - both files
 * call into the same `customAbilityBridge` and follow the same
 * additive-import pattern.
 */

import {
  registerUserAbility,
  unregisterUserAbility,
} from "./customAbilityBridge";
import { safeReadLocalStorage, safeWriteLocalStorage } from "./safeStorage";
import { validateUserAbility, type ValidationResult } from "./customAbilityValidate";
import type { UserAbilitySpec } from "./customAbilityTypes";
import {
  subscribeRustMatchupBridgeStatus,
  getRustMatchupBridgeStatus,
} from "../optimizer/rustMatchupLoader";

export type CustomAbilityRecord = {
  spec: UserAbilitySpec;
  /** Wall-clock ms (Date.now()) at first registration. */
  createdAt: number;
  /** Wall-clock ms (Date.now()) at last edit. */
  updatedAt: number;
};

type StoragePayloadV1 = {
  version: 1;
  records: CustomAbilityRecord[];
};

const STORAGE_KEY = "cos_calc.customAbilities.v1";
const records = new Map<string, CustomAbilityRecord>();
const listeners = new Set<() => void>();
let isRestoring = false;

function persist(): void {
  if (isRestoring) return;
  if (records.size === 0) {
    // Treat clear-all as removing the key (matches creature pattern).
    safeWriteLocalStorage(STORAGE_KEY, "");
    if (typeof window !== "undefined") {
      try {
        window.localStorage.removeItem(STORAGE_KEY);
      } catch {
        // already handled by safeWriteLocalStorage's catch path; ignore here.
      }
    }
    return;
  }
  const payload: StoragePayloadV1 = {
    version: 1,
    records: [...records.values()],
  };
  safeWriteLocalStorage(STORAGE_KEY, JSON.stringify(payload));
}

function emitChange(): void {
  for (const listener of listeners) listener();
  persist();
}

export function subscribeCustomAbilityRegistry(
  listener: () => void,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function listCustomAbilityRecords(): CustomAbilityRecord[] {
  return [...records.values()].sort((a, b) =>
    a.spec.display_name.localeCompare(b.spec.display_name),
  );
}

export function getCustomAbilityRecord(id: string): CustomAbilityRecord | null {
  return records.get(id) ?? null;
}

export function isCustomAbilityRegistryEmpty(): boolean {
  return records.size === 0;
}

export type RegisterOutcome =
  | { status: "ok"; record: CustomAbilityRecord }
  | { status: "validation-error"; errors: string[] };

/**
 * Validate, persist, and forward to the engine. Replaces any prior
 * record under the same id (matching the WASM-side last-write-wins
 * semantics). Returns the stored record on success, or a list of
 * validation errors when the spec doesn't pass `validateUserAbility`.
 */
export async function registerCustomAbilityRecord(
  spec: UserAbilitySpec,
): Promise<RegisterOutcome> {
  const validation: ValidationResult = validateUserAbility(spec);
  if (!validation.ok) {
    return { status: "validation-error", errors: validation.errors };
  }
  const now = Date.now();
  const previous = records.get(spec.id);
  const record: CustomAbilityRecord = {
    spec,
    createdAt: previous?.createdAt ?? now,
    updatedAt: now,
  };
  records.set(spec.id, record);
  // Engine registration is best-effort; UI persists even if the
  // Older WASM bundles predate custom-ability support. The bridge feature-detects.
  await registerUserAbility(spec);
  emitChange();
  return { status: "ok", record };
}

export async function unregisterCustomAbilityRecord(id: string): Promise<void> {
  if (!records.delete(id)) return;
  await unregisterUserAbility(id);
  emitChange();
}

export async function clearCustomAbilityRecords(): Promise<void> {
  if (records.size === 0) return;
  const ids = [...records.keys()];
  records.clear();
  await Promise.all(ids.map((id) => unregisterUserAbility(id)));
  emitChange();
}

/**
 * Replay the persisted library into the engine on page load. Calls
 * the bridge for each record so the WASM-side registry mirrors the
 * localStorage view. Bridge calls are best-effort: stale-bundle
 * "skipped" outcomes don't fail restoration.
 */
export async function restoreCustomAbilityRecords(): Promise<void> {
  isRestoring = true;
  try {
    records.clear();
    const raw = safeReadLocalStorage(STORAGE_KEY);
    if (!raw) return;
    let parsed: StoragePayloadV1 | null = null;
    try {
      parsed = JSON.parse(raw) as StoragePayloadV1;
    } catch {
      // Corrupt payload - drop silently, log for debugging.
       
      console.warn("[customAbilities] failed to parse stored payload, resetting");
      return;
    }
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.records)) {
      return;
    }
    for (const record of parsed.records) {
      const validation = validateUserAbility(record.spec);
      if (!validation.ok) {
        // Don't drop; surface it for review. UI will show "needs review"
        // when validation reports errors.
         
        console.warn(
          `[customAbilities] stored ability ${record.spec.id} fails validation:`,
          validation.errors,
        );
      }
      records.set(record.spec.id, record);
    }
  } finally {
    isRestoring = false;
  }
  // Engine re-registration runs after the in-memory store is built.
  // If the bridge isn't ready yet, each individual
  // call returns `{ status: "skipped" }` and the ability silently
  // never registers until the next page load. We track whether any
  // call skipped and, if so, install a one-shot bridge-ready listener
  // that re-syncs once the bridge transitions to "ready".
  let anySkipped = false;
  for (const record of records.values()) {
    void registerUserAbility(record.spec).then((outcome) => {
      if (outcome.status === "skipped") anySkipped = true;
    });
  }
  if (anySkipped || getRustMatchupBridgeStatus() !== "ready") {
    installBridgeReadyResyncOnce();
  }
  for (const listener of listeners) listener();
}

/** Module-level one-shot guard for the bridge-ready re-sync hook.
 *  We only want to install the subscriber once; multiple `restore`
 *  calls (e.g. cross-tab events) all share the same listener. */
let bridgeReadyResyncInstalled = false;
function installBridgeReadyResyncOnce(): void {
  if (bridgeReadyResyncInstalled) return;
  bridgeReadyResyncInstalled = true;
  const unsubscribe = subscribeRustMatchupBridgeStatus((status) => {
    if (status !== "ready") return;
    unsubscribe();
    // Bridge is now ready - replay registration for every record
    // in the local map. Idempotent: re-registering an already-
    // registered ability is a no-op on the engine side.
    for (const record of records.values()) {
      void registerUserAbility(record.spec);
    }
  });
}

/**
 * Cross-tab sync - when another tab writes the storage key, mirror
 * its records into this tab's in-memory map without firing the
 * `persist` cycle. Intentionally minimal - full sync happens at the
 * next page navigation; this only covers the "two tabs open, one
 * adds a record" flow.
 */
export function installCustomAbilityCrossTabSync(): void {
  if (typeof window === "undefined") return;
  window.addEventListener("storage", (event) => {
    if (event.key !== STORAGE_KEY) return;
    void restoreCustomAbilityRecords();
  });
}

/** Snapshot for bundle export (combined with creatures + timings). */
export function snapshotCustomAbilityRecords(): CustomAbilityRecord[] {
  return [...records.values()];
}

function normalizeCustomAbilityDisplayName(name: string): string {
  return name.trim().toLocaleLowerCase();
}

function findCustomAbilityConflictId(record: CustomAbilityRecord): string | null {
  if (records.has(record.spec.id)) return record.spec.id;
  const normalized = normalizeCustomAbilityDisplayName(record.spec.display_name);
  for (const existing of records.values()) {
    if (normalizeCustomAbilityDisplayName(existing.spec.display_name) === normalized) {
      return existing.spec.id;
    }
  }
  return null;
}

/** Bulk-import: add `incoming` records to the current library. Each
 *  record is validated; invalid ones are dropped with a console.warn.
 *  Existing records with the same id are updated, but unrelated local
 *  records are kept.
 */
export async function importCustomAbilityRecords(
  incoming: CustomAbilityRecord[],
  options?: {
    replaceConflicts?: boolean;
  },
): Promise<{ imported: number; skipped: number }> {
  const validatedIncoming: Array<{
    record: CustomAbilityRecord;
    conflictId: string | null;
  }> = [];
  let skipped = 0;
  for (const record of incoming) {
    const validation = validateUserAbility(record.spec);
    if (!validation.ok) {
      skipped += 1;
       
      console.warn(
        `[customAbilities] import skipped ${record.spec.id}:`,
        validation.errors,
      );
      continue;
    }
    const conflictId = findCustomAbilityConflictId(record);
    if (conflictId && options?.replaceConflicts !== true) {
      skipped += 1;
      continue;
    }
    validatedIncoming.push({ record, conflictId });
  }
  // Engine sync is additive: registering an existing id updates that
  // one engine entry while every unrelated local ability remains live.
  await Promise.all(
    validatedIncoming.map(async ({ record, conflictId }) => {
      if (conflictId && conflictId !== record.spec.id) {
        records.delete(conflictId);
        await unregisterUserAbility(conflictId);
      }
      await registerUserAbility(record.spec);
    }),
  );
  for (const { record } of validatedIncoming) {
    records.set(record.spec.id, record);
  }
  emitChange();
  return { imported: validatedIncoming.length, skipped };
}

export function listCustomAbilityImportConflicts(
  incoming: CustomAbilityRecord[],
): string[] {
  const conflicts = new Set<string>();
  for (const record of incoming) {
    const conflictId = findCustomAbilityConflictId(record);
    if (!conflictId) continue;
    const existing = records.get(conflictId);
    conflicts.add(existing?.spec.display_name ?? record.spec.display_name);
  }
  return [...conflicts].sort((left, right) => left.localeCompare(right));
}
