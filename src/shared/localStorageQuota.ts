// Helpers for reasoning about how full the browser's localStorage is. Browsers
// give an origin roughly 5 MB of localStorage (Chrome / Firefox / Safari), shared
// across every key the site stores - the site does not get to set its own size.
// We measure usage so the custom-creature UI can warn before a save is rejected,
// and detect the QuotaExceededError that is the real, authoritative limit.

// Conservative per-origin budget. We measure usage in UTF-16 bytes (the strict
// interpretation), so the meter fills toward this before any browser would
// actually reject a write - i.e. it warns early rather than late.
export const LOCAL_STORAGE_BUDGET_BYTES = 5 * 1024 * 1024;

export function isQuotaExceededError(error: unknown): boolean {
  if (!(error instanceof DOMException)) return false;
  return (
    error.name === "QuotaExceededError" ||
    error.name === "NS_ERROR_DOM_QUOTA_REACHED" || // Firefox
    error.code === 22 ||
    error.code === 1014
  );
}

export function localStorageUsedBytes(): number {
  if (typeof localStorage === "undefined") return 0;
  let chars = 0;
  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key === null) continue;
      const value = localStorage.getItem(key) ?? "";
      chars += key.length + value.length;
    }
  } catch {
    return 0;
  }
  // localStorage holds UTF-16 code units; 2 bytes each.
  return chars * 2;
}

export type LocalStorageUsage = {
  usedBytes: number;
  budgetBytes: number;
  ratio: number;
  nearLimit: boolean;
};

export function getLocalStorageUsage(): LocalStorageUsage {
  const usedBytes = localStorageUsedBytes();
  const budgetBytes = LOCAL_STORAGE_BUDGET_BYTES;
  const ratio = budgetBytes > 0 ? Math.min(usedBytes / budgetBytes, 1) : 0;
  return { usedBytes, budgetBytes, ratio, nearLimit: ratio >= 0.8 };
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
