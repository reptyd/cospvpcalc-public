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
import { compressToBase64, decompressFromBase64 } from "lz-string";
import { deflateRaw, inflateRaw, type InflateFunctionOptions } from "pako";
import { SHARE_VOCABULARY } from "./shareVocabulary";
import { defaultPageStateFor } from "./snapshotDefaults";
import { SHARE_DICTIONARIES, SHARE_DICTIONARY_VERSION } from "./shareDictionary";

export const MATCH_SNAPSHOT_PREFIX = "COSM1:";
// `COSM2:` carries an lz-string-compressed payload. `COSM1:` (plain
// base64url JSON) is still decoded for back-compat with old links.
export const MATCH_SNAPSHOT_PREFIX_V2 = "COSM2:";
// `COSM3:` additionally replaces known names with SHARE_VOCABULARY indices
// before compressing. All three prefixes decode, so old links keep working.
export const MATCH_SNAPSHOT_PREFIX_V3 = "COSM3:";
// `COSM4:<dictVersion-base36>.<base64url>` is raw-DEFLATE (pako) with a frozen
// preset dictionary of game names / keys / enums. The dictionary version rides
// in the link so old links always decode with the dictionary they were built
// with. All earlier prefixes still decode.
export const MATCH_SNAPSHOT_PREFIX_V4 = "COSM4:";
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
  // Optional: the page's default page-state. Any field whose current value
  // deep-equals its default here is dropped from the share link (applySnapshot
  // restores the default for a missing field). Lets a page shrink links by not
  // transmitting untouched settings. Merged over the static `snapshotDefaults`.
  getDefaultPageState?: () => Record<string, unknown>;
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
  // Static defaults (canonical default objects) plus any the page declares
  // (e.g. scalar/enum defaults from its controller). Provider wins on overlap.
  const defaults = {
    ...defaultPageStateFor(input.page),
    ...(provider?.getDefaultPageState?.() ?? {}),
  };
  const participantNames = new Set(participantCreatureNames);
  const participantCustomCreatures = input.customRecords.filter((record) =>
    participantNames.has(record.creature.name),
  );
  return {
    version: 1,
    page: input.page,
    globalSettings: input.globalSettings,
    pageState: prunePageState(pageState, defaults),
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
// lost -> the viewer sees default creatures. sessionStorage survives the
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
  from(input: string, encoding: string): Uint8Array & { toString(encoding: string): string };
  from(input: Uint8Array): Uint8Array & { toString(encoding: string): string };
};

function base64ToUrlSafe(base64: string): string {
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function urlSafeToBase64(encoded: string): string {
  const normalized = encoded.replace(/-/g, "+").replace(/_/g, "/");
  const padding = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
  return `${normalized}${padding}`;
}

function toBase64Url(json: string): string {
  const base64 =
    typeof btoa === "function"
      ? btoa(unescape(encodeURIComponent(json)))
      : Buffer.from(json, "utf-8").toString("base64");
  return base64ToUrlSafe(base64);
}

function fromBase64Url(encoded: string): string {
  const padded = urlSafeToBase64(encoded);
  if (typeof atob === "function") {
    return decodeURIComponent(escape(atob(padded)));
  }
  return Buffer.from(padded, "base64").toString("utf-8");
}

function bytesToBase64Url(bytes: Uint8Array): string {
  if (typeof btoa === "function") {
    let binary = "";
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return base64ToUrlSafe(btoa(binary));
  }
  return base64ToUrlSafe(Buffer.from(bytes).toString("base64"));
}

function base64UrlToBytes(encoded: string): Uint8Array {
  const padded = urlSafeToBase64(encoded);
  if (typeof atob === "function") {
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }
  return new Uint8Array(Buffer.from(padded, "base64"));
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((value, index) => deepEqual(value, b[index]));
  }
  if (typeof a === "object") {
    const keysA = Object.keys(a as Record<string, unknown>);
    const keysB = Object.keys(b as Record<string, unknown>);
    if (keysA.length !== keysB.length) return false;
    return keysA.every((key) =>
      deepEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]),
    );
  }
  return false;
}

// Drop page-state fields that carry no information, so they don't bloat the
// share link. Every page's applySnapshot guards each field with
// `if (x !== undefined)`, so a missing field keeps the page default -
// dropping a field that equals its default is therefore equivalent, just
// shorter on the wire. Three reasons to drop a top-level field:
//   - nullish,
//   - an empty array/object,
//   - deep-equals the page's default for that field (e.g. an untouched
//     special-abilities / buffs / build object - the bulk of a typical link).
// Only the top level is pruned; nested shapes are left intact.
function prunePageState(
  pageState: Record<string, unknown>,
  defaults: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(pageState)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value) && value.length === 0) continue;
    if (typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 0) {
      continue;
    }
    if (key in defaults && deepEqual(value, defaults[key])) continue;
    out[key] = value;
  }
  return out;
}

// COSM3 name compaction. Known names (creatures / plushies / traits /
// abilities) become a compact `~<base36 index>` token from the append-only
// SHARE_VOCABULARY. This runs on string *values* anywhere in the snapshot
// tree, so it is blind to page-state shape (robust to UI changes). Unknown
// strings pass through; a literal string already starting with `~` is escaped
// by doubling the prefix so it can't be misread as a token. A base36 index
// never starts with `~`, so tokens and escaped literals never collide.
const NAME_TO_ID = new Map<string, number>(SHARE_VOCABULARY.map((name, index) => [name, index]));

function encodeNameToken(value: string): string {
  const id = NAME_TO_ID.get(value);
  if (id !== undefined) return `~${id.toString(36)}`;
  if (value.startsWith("~")) return `~${value}`;
  return value;
}

function decodeNameToken(value: string): string {
  if (value.startsWith("~~")) return value.slice(1);
  if (value.startsWith("~")) {
    const id = parseInt(value.slice(1), 36);
    const name = Number.isNaN(id) ? undefined : SHARE_VOCABULARY[id];
    return name ?? value;
  }
  return value;
}

function mapStrings(node: unknown, fn: (value: string) => string): unknown {
  if (typeof node === "string") return fn(node);
  if (Array.isArray(node)) return node.map((item) => mapStrings(item, fn));
  if (node !== null && typeof node === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node)) out[key] = mapStrings(value, fn);
    return out;
  }
  return node;
}

export function encodeMatchSnapshot(snapshot: MatchSnapshotV1): string {
  const json = JSON.stringify(snapshot);
  // Three lossless encodings; emit the shortest. All decode, so this never
  // lengthens or breaks a link. base64 is URL-safed the same way as the
  // legacy path so a literal `+` can't be turned into a space by
  // `URLSearchParams`.
  //   COSM1 - plain base64url JSON (legacy).
  //   COSM2 - lz-string-compressed JSON.
  //   COSM3 - names replaced by SHARE_VOCABULARY indices, then compressed.
  //   COSM4 - raw-DEFLATE with a frozen preset dictionary (game names / keys /
  //           enums); the dictionary version rides in the prefix.
  const compactJson = JSON.stringify(mapStrings(snapshot, encodeNameToken));
  const deflated = deflateRaw(json, {
    level: 9,
    dictionary: SHARE_DICTIONARIES[SHARE_DICTIONARY_VERSION],
  });
  const candidates = [
    `${MATCH_SNAPSHOT_PREFIX}${toBase64Url(json)}`,
    `${MATCH_SNAPSHOT_PREFIX_V2}${base64ToUrlSafe(compressToBase64(json))}`,
    `${MATCH_SNAPSHOT_PREFIX_V3}${base64ToUrlSafe(compressToBase64(compactJson))}`,
    `${MATCH_SNAPSHOT_PREFIX_V4}${SHARE_DICTIONARY_VERSION.toString(36)}.${bytesToBase64Url(deflated)}`,
  ];
  return candidates.reduce((shortest, candidate) =>
    candidate.length < shortest.length ? candidate : shortest,
  );
}

export function decodeMatchSnapshot(code: string): MatchSnapshotV1 | null {
  const trimmed = code.trim();
  try {
    let parsed: MatchSnapshotV1;
    if (trimmed.startsWith(MATCH_SNAPSHOT_PREFIX_V4)) {
      const rest = trimmed.slice(MATCH_SNAPSHOT_PREFIX_V4.length);
      const dot = rest.indexOf(".");
      if (dot === -1) return null;
      const dictionary = SHARE_DICTIONARIES[parseInt(rest.slice(0, dot), 36)];
      if (!dictionary) return null;
      // @types/pako omits `dictionary` from InflateFunctionOptions (it is
      // typed on the Inflate class options); pako supports it at runtime.
      const restored = inflateRaw(base64UrlToBytes(rest.slice(dot + 1)), {
        dictionary,
        to: "string",
      } as InflateFunctionOptions & { to: "string"; dictionary: string });
      if (!restored) return null;
      parsed = JSON.parse(restored) as MatchSnapshotV1;
    } else if (trimmed.startsWith(MATCH_SNAPSHOT_PREFIX_V3)) {
      const restored = decompressFromBase64(
        urlSafeToBase64(trimmed.slice(MATCH_SNAPSHOT_PREFIX_V3.length)),
      );
      if (!restored) return null;
      parsed = mapStrings(JSON.parse(restored), decodeNameToken) as MatchSnapshotV1;
    } else if (trimmed.startsWith(MATCH_SNAPSHOT_PREFIX_V2)) {
      const restored = decompressFromBase64(
        urlSafeToBase64(trimmed.slice(MATCH_SNAPSHOT_PREFIX_V2.length)),
      );
      if (!restored) return null;
      parsed = JSON.parse(restored) as MatchSnapshotV1;
    } else if (trimmed.startsWith(MATCH_SNAPSHOT_PREFIX)) {
      parsed = JSON.parse(fromBase64Url(trimmed.slice(MATCH_SNAPSHOT_PREFIX.length))) as MatchSnapshotV1;
    } else {
      return null;
    }
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
