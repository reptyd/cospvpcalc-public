// Module-level snapshot cache so Optimizer / Best Builds results survive a tab
// switch. Both pages are lazy + conditionally rendered, so navigating away
// UNMOUNTS them and drops all local state - including a multi-second search
// result the user just paid for. This singleton lives OUTSIDE React: each
// controller restores its last bundle on mount (lazy useState initializer) and
// rewrites it whenever the bundle changes.
//
// Keyed by a creature-identity signature so stale results for a *different*
// matchup / source are not silently shown after the names change elsewhere
// (creature names are shared app state across tabs). A signature mismatch reads
// as "no cache" - the page shows its empty state and the user re-runs. Never
// persisted to disk: a fresh page load starts empty, by design.

const slots = new Map<string, { signature: string; value: unknown }>();

/** Return the cached bundle for `page` iff it was stored under `signature`. */
export function readBetaResultsCache<T>(page: string, signature: string): T | null {
  const slot = slots.get(page);
  return slot && slot.signature === signature ? (slot.value as T) : null;
}

/** Store `value` for `page` under `signature`, replacing any prior bundle. */
export function writeBetaResultsCache<T>(page: string, signature: string, value: T): void {
  slots.set(page, { signature, value });
}
