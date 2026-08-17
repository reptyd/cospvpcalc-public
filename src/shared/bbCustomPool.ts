// Persisted "Best Builds custom opponent pool" - a localStorage-backed list of
// creature names shared between the beta Search page (which adds to it by a
// click on a result card) and the Best Builds controller (which reads it into
// its custom pool and writes edits back). Persisting it is what lets a pick on
// Search still be there after navigating to Best Builds, since the beta shell
// re-mounts each page on navigation.

import { useSyncExternalStore } from "react";
import { safeReadLocalStorage, safeWriteLocalStorage } from "./safeStorage";

const STORAGE_KEY = "cos.bbCustomPool";

type Listener = () => void;
const listeners = new Set<Listener>();
let cache: string[] | null = null;

function read(): string[] {
  if (cache) return cache;
  const raw = safeReadLocalStorage(STORAGE_KEY);
  if (!raw) return (cache = []);
  try {
    const parsed = JSON.parse(raw) as unknown;
    cache = Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    cache = [];
  }
  return cache;
}

function write(next: string[]): void {
  cache = next;
  safeWriteLocalStorage(STORAGE_KEY, JSON.stringify(next));
  listeners.forEach((listener) => listener());
}

export function getBbCustomPool(): string[] {
  return read();
}

export function isInBbCustomPool(name: string): boolean {
  return read().includes(name);
}

export function toggleBbCustomPool(name: string): void {
  const current = read();
  write(current.includes(name) ? current.filter((entry) => entry !== name) : [...current, name]);
}

export function clearBbCustomPool(): void {
  if (read().length > 0) write([]);
}

/** Replace the whole pool (used by Best Builds to sync its edited custom list
 * back). No-op + no notify when the contents are unchanged, so the controller's
 * write-back effect can't loop. */
export function setBbCustomPool(names: string[]): void {
  const current = read();
  if (current.length === names.length && current.every((value, i) => value === names[i])) return;
  write(names);
}

export function subscribeBbCustomPool(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** React binding - re-renders subscribers when the pool changes. */
export function useBbCustomPool(): string[] {
  return useSyncExternalStore(subscribeBbCustomPool, getBbCustomPool, getBbCustomPool);
}
