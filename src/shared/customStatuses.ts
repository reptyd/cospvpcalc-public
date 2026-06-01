/**
 * Custom Statuses library (Custom Abilities v2 Phase 6 / G6) — same shape
 * as `customTimings.ts` / `customAbilities.ts`. See `customAbilities.ts`
 * for the storage / sync model. Share-link bundle import/export is not
 * wired for statuses yet (separate step), so the conflict/import helpers
 * those carry are intentionally omitted here.
 */

import {
  registerUserStatus,
  unregisterUserStatus,
} from "./customAbilityBridge";
import { safeReadLocalStorage, safeWriteLocalStorage } from "./safeStorage";
import { validateUserStatus, type ValidationResult } from "./customAbilityValidate";
import type { UserStatusSpec } from "./customAbilityTypes";
import {
  subscribeRustMatchupBridgeStatus,
  getRustMatchupBridgeStatus,
} from "../optimizer/rustMatchupLoader";

export type CustomStatusRecord = {
  spec: UserStatusSpec;
  createdAt: number;
  updatedAt: number;
};

type StoragePayloadV1 = {
  version: 1;
  records: CustomStatusRecord[];
};

const STORAGE_KEY = "cos_calc.customStatuses.v1";
const records = new Map<string, CustomStatusRecord>();
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
        // private-mode SecurityError.
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

export function subscribeCustomStatusRegistry(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function listCustomStatusRecords(): CustomStatusRecord[] {
  return [...records.values()].sort((a, b) =>
    a.spec.display_name.localeCompare(b.spec.display_name),
  );
}

export function getCustomStatusRecord(id: string): CustomStatusRecord | null {
  return records.get(id) ?? null;
}

export function isCustomStatusRegistryEmpty(): boolean {
  return records.size === 0;
}

export type RegisterOutcome =
  | { status: "ok"; record: CustomStatusRecord }
  | { status: "validation-error"; errors: string[] };

export async function registerCustomStatusRecord(
  spec: UserStatusSpec,
): Promise<RegisterOutcome> {
  const validation: ValidationResult = validateUserStatus(spec);
  if (!validation.ok) {
    return { status: "validation-error", errors: validation.errors };
  }
  const now = Date.now();
  const previous = records.get(spec.id);
  const record: CustomStatusRecord = {
    spec,
    createdAt: previous?.createdAt ?? now,
    updatedAt: now,
  };
  records.set(spec.id, record);
  await registerUserStatus(spec);
  emitChange();
  return { status: "ok", record };
}

export async function unregisterCustomStatusRecord(id: string): Promise<void> {
  if (!records.delete(id)) return;
  await unregisterUserStatus(id);
  emitChange();
}

export async function clearCustomStatusRecords(): Promise<void> {
  if (records.size === 0) return;
  const ids = [...records.keys()];
  records.clear();
  await Promise.all(ids.map((id) => unregisterUserStatus(id)));
  emitChange();
}

export async function restoreCustomStatusRecords(): Promise<void> {
  isRestoring = true;
  try {
    records.clear();
    const raw = safeReadLocalStorage(STORAGE_KEY);
    if (!raw) return;
    let parsed: StoragePayloadV1 | null = null;
    try {
      parsed = JSON.parse(raw) as StoragePayloadV1;
    } catch {
      console.warn("[customStatuses] failed to parse stored payload, resetting");
      return;
    }
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.records)) {
      return;
    }
    for (const record of parsed.records) {
      const validation = validateUserStatus(record.spec);
      if (!validation.ok) {
        console.warn(
          `[customStatuses] stored status ${record.spec.id} fails validation:`,
          validation.errors,
        );
      }
      records.set(record.spec.id, record);
    }
  } finally {
    isRestoring = false;
  }
  // If the bridge isn't ready yet, individual register calls return
  // `{ status: "skipped" }`; install a one-shot listener that replays the
  // local map once the bridge transitions to ready (twin of customTimings).
  let anySkipped = false;
  for (const record of records.values()) {
    void registerUserStatus(record.spec).then((outcome) => {
      if (outcome.status === "skipped") anySkipped = true;
    });
  }
  if (anySkipped || getRustMatchupBridgeStatus() !== "ready") {
    installBridgeReadyResyncOnce();
  }
  for (const listener of listeners) listener();
}

let bridgeReadyResyncInstalled = false;
function installBridgeReadyResyncOnce(): void {
  if (bridgeReadyResyncInstalled) return;
  bridgeReadyResyncInstalled = true;
  const unsubscribe = subscribeRustMatchupBridgeStatus((status) => {
    if (status !== "ready") return;
    unsubscribe();
    for (const record of records.values()) {
      void registerUserStatus(record.spec);
    }
  });
}

export function installCustomStatusCrossTabSync(): void {
  if (typeof window === "undefined") return;
  window.addEventListener("storage", (event) => {
    if (event.key !== STORAGE_KEY) return;
    void restoreCustomStatusRecords();
  });
}

export function snapshotCustomStatusRecords(): CustomStatusRecord[] {
  return [...records.values()];
}
