import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  formatBytes,
  getLocalStorageUsage,
  isQuotaExceededError,
  LOCAL_STORAGE_BUDGET_BYTES,
  localStorageUsedBytes,
} from "./localStorageQuota";

// The vitest env is "node", so stand up an in-memory localStorage that supports
// the length / key(i) scan localStorageUsedBytes relies on.
function stubLocalStorage() {
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    get length() {
      return store.size;
    },
    key: (index: number) => [...store.keys()][index] ?? null,
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear(),
  });
}

beforeEach(stubLocalStorage);
afterEach(() => vi.unstubAllGlobals());

describe("isQuotaExceededError", () => {
  it("recognizes the standard quota DOMException", () => {
    expect(isQuotaExceededError(new DOMException("full", "QuotaExceededError"))).toBe(true);
    expect(isQuotaExceededError(new DOMException("full", "NS_ERROR_DOM_QUOTA_REACHED"))).toBe(true);
  });

  it("rejects unrelated errors", () => {
    expect(isQuotaExceededError(new Error("nope"))).toBe(false);
    expect(isQuotaExceededError(new DOMException("other", "SyntaxError"))).toBe(false);
    expect(isQuotaExceededError(null)).toBe(false);
  });
});

describe("localStorage usage", () => {
  it("counts key + value length as UTF-16 bytes and grows with stored data", () => {
    const empty = localStorageUsedBytes();
    localStorage.setItem("k", "x".repeat(1000));
    const after = localStorageUsedBytes();
    // 1 (key) + 1000 (value) chars added, 2 bytes each.
    expect(after - empty).toBe((1 + 1000) * 2);
  });

  it("reports ratio against the budget and flags nearLimit past 80%", () => {
    const usage = getLocalStorageUsage();
    expect(usage.budgetBytes).toBe(LOCAL_STORAGE_BUDGET_BYTES);
    expect(usage.ratio).toBeGreaterThanOrEqual(0);
    expect(usage.ratio).toBeLessThanOrEqual(1);
    expect(usage.nearLimit).toBe(usage.ratio >= 0.8);
  });
});

describe("formatBytes", () => {
  it("renders B / KB / MB", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
  });
});
