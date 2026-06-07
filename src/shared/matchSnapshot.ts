/**
 * Shareable match-state snapshot. Powers the "Share / Report Match"
 * button: encodes the full state of the *active* page into a link a
 * user can paste into a bug report. Opening the link replays that
 * state in an ephemeral "imported-match" mode that never overwrites
 * the viewer's own localStorage or custom-creature registry.
 *
 * The snapshot is scoped to whichever page is open when the button is
 * pressed. Only the active page is mounted (AppPageRouter renders one
 * page at a time), so at most one provider is registered - that's how
 * the snapshot stays page-local. Each page provider reports its own
 * state plus the creature names that participated, so we bundle only
 * the custom-creature definitions actually used (not the whole
 * registry).
 */

import type { AppPage } from "../AppPageRouter";
import type { CombatEventPhase } from "../engine/eventOrdering";
import type { CustomCreatureRecord } from "../engine/customCreatures";

export const MATCH_SNAPSHOT_PREFIX = "COSM1:";
export const MATCH_SNAPSHOT_QUERY_PARAM = "match";

// Global settings live in App, not on any page - they affect every
// matchup so they ride along with every snapshot.
export type MatchGlobalSettings = {
  combatEventOrder: CombatEventPhase[];
  trueRoundingMode: boolean;
  developerMode: boolean;
};

export type MatchSnapshotV1 = {
  version: 1;
  page: AppPage;
  globalSettings: MatchGlobalSettings;
  // Opaque per-page payload - each page owns its own shape and casts
  // on apply. Keeps the registry generic and future pages cheap.
  pageState: Record<string, unknown>;
  participantCustomCreatures: CustomCreatureRecord[];
};

export type MatchPageSnapshot = {
  pageState: Record<string, unknown>;
  participantCreatureNames: string[];
};

export type MatchSnapshotProvider = {
  page: AppPage;
  getSnapshot: () => MatchPageSnapshot;
  applySnapshot: (pageState: Record<string, unknown>) => void;
};

const providers = new Map<AppPage, MatchSnapshotProvider>();

// main.tsx decodes ?match= and stashes here; App consumes once on mount.
let initialImportedMatch: MatchSnapshotV1 | null = null;
// App stashes the snapshot here; the active page's provider applies it
// when it registers - handles the page not being mounted yet at the
// moment App processes the import.
let pendingImport: MatchSnapshotV1 | null = null;

export function registerMatchSnapshotProvider(provider: MatchSnapshotProvider): () => void {
  providers.set(provider.page, provider);
  if (pendingImport && pendingImport.page === provider.page) {
    provider.applySnapshot(pendingImport.pageState);
    pendingImport = null;
  }
  return () => {
    if (providers.get(provider.page) === provider) {
      providers.delete(provider.page);
    }
  };
}

export function getMatchSnapshotProvider(page: AppPage): MatchSnapshotProvider | null {
  return providers.get(page) ?? null;
}

/**
 * Build a snapshot for the active page. If the page registered a
 * provider, its state + participant filter are used; otherwise the
 * snapshot degrades to global settings only (button still works on
 * pages without a provider, just with no page-local state).
 */
export function buildMatchSnapshotForActivePage(input: {
  page: AppPage;
  globalSettings: MatchGlobalSettings;
  customRecords: CustomCreatureRecord[];
}): MatchSnapshotV1 {
  const provider = providers.get(input.page);
  const { pageState, participantCreatureNames } = provider
    ? provider.getSnapshot()
    : { pageState: {}, participantCreatureNames: [] };
  const participantNames = new Set(participantCreatureNames);
  const participantCustomCreatures = input.customRecords.filter((record) =>
    participantNames.has(record.creature.name),
  );
  return {
    version: 1,
    page: input.page,
    globalSettings: input.globalSettings,
    pageState,
    participantCustomCreatures,
  };
}

/**
 * Hand the decoded page state to the active page's provider. Returns
 * false if no provider is registered for that page yet (caller can
 * stash via setPendingImportedMatch to apply on the next register).
 */
export function applyMatchSnapshotPageState(snapshot: MatchSnapshotV1): boolean {
  const provider = providers.get(snapshot.page);
  if (!provider) return false;
  provider.applySnapshot(snapshot.pageState);
  return true;
}

export function setInitialImportedMatch(snapshot: MatchSnapshotV1 | null): void {
  initialImportedMatch = snapshot;
}

export function consumeInitialImportedMatch(): MatchSnapshotV1 | null {
  const value = initialImportedMatch;
  initialImportedMatch = null;
  return value;
}

// Reload resilience: the share-link param is stripped from the URL on
// first decode, but the page can reload mid-boot (staleChunkReload on a
// chunk/WASM load error, an error-boundary reload). Without a carrier
// that survives the reload, the stripped param is gone and the import is
// lost → the viewer sees default creatures. sessionStorage survives the
// reload within the tab; main.tsx resumes from it when ?match= is absent.
export const MATCH_SNAPSHOT_SESSION_KEY = "cos.importedMatchCode";

export function stashImportedMatchCode(code: string): void {
  try {
    sessionStorage.setItem(MATCH_SNAPSHOT_SESSION_KEY, code);
  } catch {
    // sessionStorage blocked (private mode / disabled) - best-effort only.
  }
}

export function readStashedImportedMatchCode(): string | null {
  try {
    return sessionStorage.getItem(MATCH_SNAPSHOT_SESSION_KEY);
  } catch {
    return null;
  }
}

export function clearStashedImportedMatch(): void {
  try {
    sessionStorage.removeItem(MATCH_SNAPSHOT_SESSION_KEY);
  } catch {
    // ignore
  }
}

/**
 * Stash a snapshot whose page state should be applied as soon as the
 * matching page provider registers. If the provider is already
 * registered, applies immediately.
 */
export function setPendingImportedMatch(snapshot: MatchSnapshotV1 | null): void {
  pendingImport = snapshot;
  if (snapshot) {
    const provider = providers.get(snapshot.page);
    if (provider) {
      provider.applySnapshot(snapshot.pageState);
      pendingImport = null;
    }
  }
}

// Minimal Node `Buffer` shape - base64 fallback for vitest / CLI where
// btoa/atob are absent. No `@types/node` dependency pulled into app code.
declare const Buffer: {
  from(input: string, encoding: string): { toString(encoding: string): string };
};

function toBase64Url(json: string): string {
  const base64 =
    typeof btoa === "function"
      ? btoa(unescape(encodeURIComponent(json)))
      : Buffer.from(json, "utf-8").toString("base64");
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(encoded: string): string {
  const normalized = encoded.replace(/-/g, "+").replace(/_/g, "/");
  const padding = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
  const padded = `${normalized}${padding}`;
  if (typeof atob === "function") {
    return decodeURIComponent(escape(atob(padded)));
  }
  return Buffer.from(padded, "base64").toString("utf-8");
}

export function encodeMatchSnapshot(snapshot: MatchSnapshotV1): string {
  return `${MATCH_SNAPSHOT_PREFIX}${toBase64Url(JSON.stringify(snapshot))}`;
}

export function decodeMatchSnapshot(code: string): MatchSnapshotV1 | null {
  const trimmed = code.trim();
  if (!trimmed.startsWith(MATCH_SNAPSHOT_PREFIX)) return null;
  try {
    const json = fromBase64Url(trimmed.slice(MATCH_SNAPSHOT_PREFIX.length));
    const parsed = JSON.parse(json) as MatchSnapshotV1;
    if (
      parsed?.version !== 1 ||
      typeof parsed.page !== "string" ||
      typeof parsed.globalSettings !== "object" ||
      parsed.globalSettings === null
    ) {
      return null;
    }
    if (!Array.isArray(parsed.participantCustomCreatures)) {
      parsed.participantCustomCreatures = [];
    }
    if (typeof parsed.pageState !== "object" || parsed.pageState === null) {
      parsed.pageState = {};
    }
    return parsed;
  } catch {
    return null;
  }
}
