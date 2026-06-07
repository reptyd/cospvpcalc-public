// Self-healing reload for stale JS/CSS chunks.
//
// When the server has been redeployed, a client that still holds an old
// index.html (via some unexpected cache layer - browser profile cache,
// proxy, or intermediate CDN) will try to load asset hashes that no longer
// exist. The SPA fallback returns index.html for those requests, and the
// browser throws one of:
//
//   SyntaxError: Unexpected token '<'          (HTML parsed as JS)
//   Failed to fetch dynamically imported module
//   Loading chunk <id> failed
//   Loading CSS chunk <id> failed
//   ChunkLoadError
//
// Strategy: on the first such error per session, force a hard reload with a
// cache-bust query param. On the second, surface a visible hint so the user
// isn't stuck in a reload loop if their browser genuinely can't reach a
// fresh index.html.

const RELOAD_FLAG = "cos_calc_stale_chunk_reload_attempted";
const RELOAD_PARAM = "_cb";

const STALE_CHUNK_PATTERNS = [
  /Unexpected token '?<'?/i,
  /Failed to fetch dynamically imported module/i,
  /Loading chunk \S+ failed/i,
  /Loading CSS chunk \S+ failed/i,
  /ChunkLoadError/i,
  /error loading dynamically imported module/i,
];

function messageLooksStale(message: string | undefined | null): boolean {
  if (!message) return false;
  return STALE_CHUNK_PATTERNS.some((re) => re.test(message));
}

function hardReloadOnce(reason: string): void {
  try {
    const already = sessionStorage.getItem(RELOAD_FLAG);
    if (already) {
      // Already attempted a cache-bust reload this session; don't loop.
       
      console.warn(
        `[staleChunkReload] already reloaded once this session, not reloading again. Reason: ${reason}`,
      );
      return;
    }
    sessionStorage.setItem(RELOAD_FLAG, String(Date.now()));
  } catch {
    // sessionStorage might be blocked; fall through and still try a reload.
  }

  const url = new URL(window.location.href);
  url.searchParams.set(RELOAD_PARAM, String(Date.now()));
   
  console.warn(`[staleChunkReload] detected stale asset, reloading. Reason: ${reason}`);
  window.location.replace(url.toString());
}

function clearReloadFlagOnSuccessfulBoot(): void {
  // If we made it past the entry bundle, clear the flag so a later unrelated
  // error still gets one reload attempt.
  try {
    sessionStorage.removeItem(RELOAD_FLAG);
  } catch {
    // ignore
  }
}

export function installStaleChunkReload(): void {
  if (typeof window === "undefined") return;

  window.addEventListener("error", (event) => {
    const msg = event?.message ?? (event?.error as Error | undefined)?.message;
    if (messageLooksStale(msg)) {
      hardReloadOnce(`window.onerror: ${msg}`);
    }
  });

  window.addEventListener("unhandledrejection", (event) => {
    const reason = event?.reason;
    const msg =
      typeof reason === "string"
        ? reason
        : reason instanceof Error
          ? reason.message
          : undefined;
    if (messageLooksStale(msg)) {
      hardReloadOnce(`unhandledrejection: ${msg}`);
    }
  });

  // Once React has mounted we're safe - clear the flag after a short delay.
  window.setTimeout(clearReloadFlagOnSuccessfulBoot, 5000);
}
