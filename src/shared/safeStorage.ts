/**
 * Defensive wrappers around `window.localStorage`.
 *
 * Direct `localStorage.getItem` / `setItem` calls can throw on SSR
 * (no `window`), Safari private mode (`SecurityError`), and quota
 * exhaustion. Combined with the React error boundary that ships in
 * `main.tsx`, an unguarded throw during initial render produces a
 * blank page with no recovery UI.
 *
 * These helpers always succeed: read failures fall back to the
 * caller's default; write failures log a warning and move on.
 *
 * Use these for *preference-style* keys (settings, UI state). Code
 * that needs to react to a missing storage layer (e.g. import/export
 * flows) should still call `localStorage` directly so it can react.
 */

export function safeReadLocalStorage(
  key: string,
  fallback: string | null = null,
): string | null {
  if (typeof window === "undefined") return fallback;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return fallback;
  }
}

export function safeWriteLocalStorage(key: string, value: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, value);
  } catch (error) {
    // Quota exhausted / storage disabled / private mode - drop the
    // write. Surface only for debugging so we notice during dev.
     
    console.warn(`[safeStorage] failed to write "${key}":`, error);
  }
}
