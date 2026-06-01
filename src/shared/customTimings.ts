/**
 * Custom Timings library — same shape as `customAbilities.ts`.
 * See that file's header for the storage / sync model.
 */

import {
  registerUserTiming,
  unregisterUserTiming,
} from "./customAbilityBridge";
import { safeReadLocalStorage, safeWriteLocalStorage } from "./safeStorage";
import { validateUserTiming, type ValidationResult } from "./customAbilityValidate";
import type { UserTimingSpec } from "./customAbilityTypes";
import {
  subscribeRustMatchupBridgeStatus,
  getRustMatchupBridgeStatus,
} from "../optimizer/rustMatchupLoader";

export type CustomTimingRecord = {
  spec: UserTimingSpec;
  createdAt: number;
  updatedAt: number;
};

type StoragePayloadV1 = {
  version: 1;
  records: CustomTimingRecord[];
};

const STORAGE_KEY = "cos_calc.customTimings.v1";
const records = new Map<string, CustomTimingRecord>();
const listeners = new Set<() => void>();
let isRestoring = false;

function persist(): void {
  if (isRestoring) return;
  if (records.size === 0) {
    safeWriteLocalStorage(STORAGE_KEY, "");
    if (typeof window !== "undefined") {
      try {
        window.localStorage.removeItem(STORAGE_KEY);
      } catch {
        // ignored — safeWriteLocalStorage already handled the typical
        // private-mode SecurityError; another cleanup pass would
        // duplicate that handling.
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

export function subscribeCustomTimingRegistry(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function listCustomTimingRecords(): CustomTimingRecord[] {
  return [...records.values()].sort((a, b) =>
    a.spec.display_name.localeCompare(b.spec.display_name),
  );
}

export function getCustomTimingRecord(id: string): CustomTimingRecord | null {
  return records.get(id) ?? null;
}

export function isCustomTimingRegistryEmpty(): boolean {
  return records.size === 0;
}

export type RegisterOutcome =
  | { status: "ok"; record: CustomTimingRecord }
  | { status: "validation-error"; errors: string[] };

export async function registerCustomTimingRecord(
  spec: UserTimingSpec,
): Promise<RegisterOutcome> {
  const validation: ValidationResult = validateUserTiming(spec);
  if (!validation.ok) {
    return { status: "validation-error", errors: validation.errors };
  }
  const now = Date.now();
  const previous = records.get(spec.id);
  const record: CustomTimingRecord = {
    spec,
    createdAt: previous?.createdAt ?? now,
    updatedAt: now,
  };
  records.set(spec.id, record);
  await registerUserTiming(spec);
  emitChange();
  return { status: "ok", record };
}

export async function unregisterCustomTimingRecord(id: string): Promise<void> {
  if (!records.delete(id)) return;
  await unregisterUserTiming(id);
  emitChange();
}

export async function clearCustomTimingRecords(): Promise<void> {
  if (records.size === 0) return;
  const ids = [...records.keys()];
  records.clear();
  await Promise.all(ids.map((id) => unregisterUserTiming(id)));
  emitChange();
}

export async function restoreCustomTimingRecords(): Promise<void> {
  isRestoring = true;
  try {
    records.clear();
    const raw = safeReadLocalStorage(STORAGE_KEY);
    if (!raw) return;
    let parsed: StoragePayloadV1 | null = null;
    try {
      parsed = JSON.parse(raw) as StoragePayloadV1;
    } catch {
       
      console.warn("[customTimings] failed to parse stored payload, resetting");
      return;
    }
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.records)) {
      return;
    }
    for (const record of parsed.records) {
      const validation = validateUserTiming(record.spec);
      if (!validation.ok) {
         
        console.warn(
          `[customTimings] stored timing ${record.spec.id} fails validation:`,
          validation.errors,
        );
      }
      records.set(record.spec.id, record);
    }
  } finally {
    isRestoring = false;
  }
  // Mode-C audit F6 (twin of customAbilities.ts): if bridge not
  // ready, individual register calls return `{ status: "skipped" }`.
  // Install a one-shot bridge-ready listener that replays the local
  // map once the bridge transitions to ready.
  let anySkipped = false;
  for (const record of records.values()) {
    void registerUserTiming(record.spec).then((outcome) => {
      if (outcome.status === "skipped") anySkipped = true;
    });
  }
  if (anySkipped || getRustMatchupBridgeStatus() !== "ready") {
    installBridgeReadyResyncOnce();
  }
  for (const listener of listeners) listener();
}

/** Mode-C audit F6: one-shot bridge-ready re-sync. See twin in
 *  customAbilities.ts for full notes. */
let bridgeReadyResyncInstalled = false;
function installBridgeReadyResyncOnce(): void {
  if (bridgeReadyResyncInstalled) return;
  bridgeReadyResyncInstalled = true;
  const unsubscribe = subscribeRustMatchupBridgeStatus((status) => {
    if (status !== "ready") return;
    unsubscribe();
    for (const record of records.values()) {
      void registerUserTiming(record.spec);
    }
  });
}

export function installCustomTimingCrossTabSync(): void {
  if (typeof window === "undefined") return;
  window.addEventListener("storage", (event) => {
    if (event.key !== STORAGE_KEY) return;
    void restoreCustomTimingRecords();
  });
}

export function snapshotCustomTimingRecords(): CustomTimingRecord[] {
  return [...records.values()];
}

function normalizeCustomTimingDisplayName(name: string): string {
  return name.trim().toLocaleLowerCase();
}

function findCustomTimingConflictId(record: CustomTimingRecord): string | null {
  if (records.has(record.spec.id)) return record.spec.id;
  const normalized = normalizeCustomTimingDisplayName(record.spec.display_name);
  for (const existing of records.values()) {
    if (normalizeCustomTimingDisplayName(existing.spec.display_name) === normalized) {
      return existing.spec.id;
    }
  }
  return null;
}

export async function importCustomTimingRecords(
  incoming: CustomTimingRecord[],
  options?: {
    replaceConflicts?: boolean;
  },
): Promise<{ imported: number; skipped: number }> {
  // Additive import: existing records with the same id are updated,
  // but unrelated local timings stay in both localStorage and engine.
  const validatedIncoming: Array<{
    record: CustomTimingRecord;
    conflictId: string | null;
  }> = [];
  let skipped = 0;
  for (const record of incoming) {
    const validation = validateUserTiming(record.spec);
    if (!validation.ok) {
      skipped += 1;
       
      console.warn(
        `[customTimings] import skipped ${record.spec.id}:`,
        validation.errors,
      );
      continue;
    }
    const conflictId = findCustomTimingConflictId(record);
    if (conflictId && options?.replaceConflicts !== true) {
      skipped += 1;
      continue;
    }
    validatedIncoming.push({ record, conflictId });
  }
  await Promise.all(
    validatedIncoming.map(async ({ record, conflictId }) => {
      if (conflictId && conflictId !== record.spec.id) {
        records.delete(conflictId);
        await unregisterUserTiming(conflictId);
      }
      await registerUserTiming(record.spec);
    }),
  );
  for (const { record } of validatedIncoming) {
    records.set(record.spec.id, record);
  }
  emitChange();
  return { imported: validatedIncoming.length, skipped };
}

export function listCustomTimingImportConflicts(
  incoming: CustomTimingRecord[],
): string[] {
  const conflicts = new Set<string>();
  for (const record of incoming) {
    const conflictId = findCustomTimingConflictId(record);
    if (!conflictId) continue;
    const existing = records.get(conflictId);
    conflicts.add(existing?.spec.display_name ?? record.spec.display_name);
  }
  return [...conflicts].sort((left, right) => left.localeCompare(right));
}
