// Lightweight check for "a newer build has been deployed since this tab loaded".
//
// Strategy: every few minutes (and whenever the tab becomes visible) fetch
// `/version.json` with cache:"no-store". If its `buildHash` differs from the
// hash baked into this bundle at build time, mark the session as stale so the
// UI can prompt the user to reload. We never auto-reload — users may be in the
// middle of editing a build or compare matchup.

const VERSION_ENDPOINT = "/version.json";
const POLL_INTERVAL_MS = 5 * 60 * 1000;

const buildHash = (import.meta.env.VITE_BUILD_HASH ?? "local").toString();

const listeners = new Set<(stale: boolean) => void>();
let isStale = false;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let inFlight = false;
let started = false;

function notify(): void {
  for (const listener of listeners) listener(isStale);
}

async function checkOnce(): Promise<void> {
  if (isStale || inFlight) return;
  if (typeof fetch === "undefined") return;
  inFlight = true;
  try {
    const response = await fetch(`${VERSION_ENDPOINT}?_=${Date.now()}`, {
      cache: "no-store",
      credentials: "omit",
    });
    if (!response.ok) return;
    const payload = (await response.json()) as { buildHash?: unknown } | null;
    const remote = typeof payload?.buildHash === "string" ? payload.buildHash : null;
    if (!remote) return;
    if (remote !== buildHash) {
      isStale = true;
      notify();
      stopPolling();
    }
  } catch {
    // Network blip, offline, or version.json not deployed yet — ignore quietly.
  } finally {
    inFlight = false;
  }
}

function stopPolling(): void {
  if (pollTimer !== null) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

export function subscribeVersionStale(listener: (stale: boolean) => void): () => void {
  listeners.add(listener);
  listener(isStale);
  return () => {
    listeners.delete(listener);
  };
}

export function getCurrentBuildHash(): string {
  return buildHash;
}

export function startVersionPoll(): void {
  if (started) return;
  if (typeof window === "undefined") return;
  started = true;

  // Skip in dev — the build hash will match the running bundle's git HEAD,
  // and polling would just spam the dev server.
  if (import.meta.env.DEV) return;

  void checkOnce();
  pollTimer = setInterval(() => {
    void checkOnce();
  }, POLL_INTERVAL_MS);

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      void checkOnce();
    }
  });
}
