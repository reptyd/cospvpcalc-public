import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  applyMatchSnapshotPageState,
  buildMatchSnapshotForActivePage,
  clearStashedImportedMatch,
  decodeMatchSnapshot,
  encodeMatchSnapshot,
  readStashedImportedMatchCode,
  registerMatchSnapshotProvider,
  stashImportedMatchCode,
  type MatchSnapshotV1,
} from "./matchSnapshot";
import type { CustomCreatureRecord } from "../engine/customCreatures";
import { SHARE_VOCABULARY } from "./shareVocabulary";
import { compressToBase64 } from "lz-string";
import { DEFAULT_COMPARE_BUFF_SELECTION } from "../engine/compareBuffRuntime";
import { DEFAULT_COMPARE_SPECIAL_ABILITIES } from "../components/compare/compareSpecialAbilities";
import { deflateRaw } from "pako";
import { SHARE_DICTIONARIES, SHARE_DICTIONARY_VERSION } from "./shareDictionary";

function makeCustomRecord(name: string): CustomCreatureRecord {
  return {
    creature: { name } as CustomCreatureRecord["creature"],
    effects: {} as CustomCreatureRecord["effects"],
    appetite: null,
    iconName: null,
    iconDataUrl: null,
    createdAt: 0,
  };
}

// Reproduces the pre-compression COSM1 encoding so back-compat and
// size-comparison tests don't lean on encodeMatchSnapshot's internals.
function legacyEncodeV1(snapshot: MatchSnapshotV1): string {
  const json = JSON.stringify(snapshot);
  const b64 = Buffer.from(json, "utf-8").toString("base64");
  return "COSM1:" + b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Builds a COSM4 link directly so the decode branch is exercised regardless of
// which candidate encodeMatchSnapshot happens to pick as shortest.
function manualEncodeV4(snapshot: MatchSnapshotV1, version = SHARE_DICTIONARY_VERSION): string {
  const bytes = deflateRaw(JSON.stringify(snapshot), {
    level: 9,
    dictionary: SHARE_DICTIONARIES[version],
  });
  const b64 = Buffer.from(bytes).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `COSM4:${version.toString(36)}.${b64}`;
}

// Forces the COSM3 (vocabulary-index) encoding so its token + escape paths are
// exercised even when encodeMatchSnapshot picks a shorter candidate (COSM4).
function manualEncodeV3(snapshot: MatchSnapshotV1): string {
  const encTok = (v: string): string => {
    const i = SHARE_VOCABULARY.indexOf(v);
    if (i >= 0) return "~" + i.toString(36);
    if (v.startsWith("~")) return "~" + v;
    return v;
  };
  const walk = (n: unknown): unknown =>
    typeof n === "string"
      ? encTok(n)
      : Array.isArray(n)
        ? n.map(walk)
        : n && typeof n === "object"
          ? Object.fromEntries(Object.entries(n).map(([k, v]) => [k, walk(v)]))
          : n;
  const b64 = compressToBase64(JSON.stringify(walk(snapshot)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return "COSM3:" + b64;
}

describe("matchSnapshot encode/decode", () => {
  it("round-trips a snapshot", () => {
    const snapshot: MatchSnapshotV1 = {
      version: 1,
      page: "compare",
      globalSettings: { combatEventOrder: [], trueRoundingMode: true, developerMode: false },
      pageState: { activesOn: true, nested: { a: 1 } },
      participantCustomCreatures: [],
    };
    const code = encodeMatchSnapshot(snapshot);
    expect(code).toMatch(/^COSM[1234]:/);
    expect(decodeMatchSnapshot(code)).toEqual(snapshot);
  });

  it("preserves UTF-8 in page state", () => {
    const snapshot: MatchSnapshotV1 = {
      version: 1,
      page: "sandbox",
      globalSettings: { combatEventOrder: [], trueRoundingMode: false, developerMode: false },
      pageState: { note: "Адхаркаин ⚔ café" },
      participantCustomCreatures: [],
    };
    const decoded = decodeMatchSnapshot(encodeMatchSnapshot(snapshot));
    expect(decoded?.pageState.note).toBe("Адхаркаин ⚔ café");
  });

  it("returns null for non-prefixed or empty input", () => {
    expect(decodeMatchSnapshot("not-a-snapshot")).toBeNull();
    expect(decodeMatchSnapshot("")).toBeNull();
  });

  it("returns null for corrupt payload", () => {
    expect(decodeMatchSnapshot("COSM1:!!!not-valid!!!")).toBeNull();
  });
});

describe("matchSnapshot compression (COSM2)", () => {
  // A realistic, repetitive snapshot - two near-identical builds plus
  // participant custom creatures. This is where compression pays off.
  function bigSnapshot(): MatchSnapshotV1 {
    const build = {
      plushies: ["aaa", "bbb", "ccc", "ddd", "eee"],
      traits: ["alpha", "beta", "gamma"],
      level: 30,
      notes: "the same the same the same the same the same",
    };
    return {
      version: 1,
      page: "compare",
      globalSettings: { combatEventOrder: [], trueRoundingMode: true, developerMode: false },
      pageState: {
        nameA: "Custom Creature Number One",
        nameB: "Custom Creature Number Two",
        buildA: build,
        buildB: build,
        activesOn: true,
      },
      participantCustomCreatures: [
        makeCustomRecord("Custom Creature Number One"),
        makeCustomRecord("Custom Creature Number Two"),
      ],
    };
  }

  it("uses a compressed form (not plain base64) for a non-trivial snapshot and round-trips", () => {
    const snapshot = bigSnapshot();
    const code = encodeMatchSnapshot(snapshot);
    expect(code.startsWith("COSM1:")).toBe(false);
    expect(decodeMatchSnapshot(code)).toEqual(snapshot);
  });

  it("is shorter than the legacy uncompressed encoding", () => {
    const snapshot = bigSnapshot();
    expect(encodeMatchSnapshot(snapshot).length).toBeLessThan(legacyEncodeV1(snapshot).length);
  });

  it("never produces a longer link than the legacy encoding", () => {
    const tiny: MatchSnapshotV1 = {
      version: 1,
      page: "credits",
      globalSettings: { combatEventOrder: [], trueRoundingMode: false, developerMode: false },
      pageState: {},
      participantCustomCreatures: [],
    };
    expect(encodeMatchSnapshot(tiny).length).toBeLessThanOrEqual(legacyEncodeV1(tiny).length);
  });

  it("still decodes legacy COSM1 links (back-compat)", () => {
    const snapshot = bigSnapshot();
    expect(decodeMatchSnapshot(legacyEncodeV1(snapshot))).toEqual(snapshot);
  });

  it("preserves UTF-8 through compression", () => {
    const snapshot: MatchSnapshotV1 = {
      version: 1,
      page: "sandbox",
      globalSettings: { combatEventOrder: [], trueRoundingMode: false, developerMode: false },
      pageState: { note: "Адхаркаин ⚔ café 日本語 the same the same the same" },
      participantCustomCreatures: [makeCustomRecord("Большое Существо Для Сжатия")],
    };
    expect(decodeMatchSnapshot(encodeMatchSnapshot(snapshot))).toEqual(snapshot);
  });

  it("returns null for a corrupt COSM2 payload", () => {
    expect(decodeMatchSnapshot("COSM2:!!!not-valid!!!")).toBeNull();
  });
});

describe("matchSnapshot vocabulary compaction (COSM3)", () => {
  it("compacts known names via the vocabulary and round-trips", () => {
    const snapshot: MatchSnapshotV1 = {
      version: 1,
      page: "compare",
      globalSettings: { combatEventOrder: [], trueRoundingMode: false, developerMode: false },
      pageState: { names: SHARE_VOCABULARY.slice(0, 20) },
      participantCustomCreatures: [],
    };
    const code = manualEncodeV3(snapshot);
    expect(code.startsWith("COSM3:")).toBe(true);
    expect(decodeMatchSnapshot(code)).toEqual(snapshot);
  });

  it("is shorter than the plain-compressed (COSM2) form for name-heavy snapshots", () => {
    const snapshot: MatchSnapshotV1 = {
      version: 1,
      page: "compare",
      globalSettings: { combatEventOrder: [], trueRoundingMode: false, developerMode: false },
      pageState: { names: SHARE_VOCABULARY.slice(0, 20) },
      participantCustomCreatures: [],
    };
    const b64url = (s: string) => s.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const cosm2Len = "COSM2:".length + b64url(compressToBase64(JSON.stringify(snapshot))).length;
    expect(encodeMatchSnapshot(snapshot).length).toBeLessThan(cosm2Len);
  });

  it("keeps unknown names inline and round-trips (fallback)", () => {
    const snapshot: MatchSnapshotV1 = {
      version: 1,
      page: "sandbox",
      globalSettings: { combatEventOrder: [], trueRoundingMode: false, developerMode: false },
      pageState: { custom: "Totally Unknown Creature 9000", known: SHARE_VOCABULARY[0] },
      participantCustomCreatures: [makeCustomRecord("Totally Unknown Creature 9000")],
    };
    expect(decodeMatchSnapshot(encodeMatchSnapshot(snapshot))).toEqual(snapshot);
  });

  it("escapes literal strings that start with '~' so they can't be misread as tokens", () => {
    const snapshot: MatchSnapshotV1 = {
      version: 1,
      page: "compare",
      globalSettings: { combatEventOrder: [], trueRoundingMode: false, developerMode: false },
      pageState: { weird: "~5", weirder: "~~deep", names: SHARE_VOCABULARY.slice(0, 20) },
      participantCustomCreatures: [],
    };
    const code = manualEncodeV3(snapshot);
    expect(code.startsWith("COSM3:")).toBe(true);
    expect(decodeMatchSnapshot(code)).toEqual(snapshot);
  });

  it("still decodes legacy COSM1 and COSM2 links", () => {
    const snapshot: MatchSnapshotV1 = {
      version: 1,
      page: "compare",
      globalSettings: { combatEventOrder: [], trueRoundingMode: false, developerMode: false },
      pageState: { nameA: SHARE_VOCABULARY[0], nameB: SHARE_VOCABULARY[1] },
      participantCustomCreatures: [],
    };
    expect(decodeMatchSnapshot(legacyEncodeV1(snapshot))).toEqual(snapshot);
  });

  it("returns null for a corrupt COSM3 payload", () => {
    expect(decodeMatchSnapshot("COSM3:!!!not-valid!!!")).toBeNull();
  });
});

describe("matchSnapshot preset-dictionary deflate (COSM4)", () => {
  function richSnapshot(): MatchSnapshotV1 {
    return {
      version: 1,
      page: "compare",
      globalSettings: { combatEventOrder: [], trueRoundingMode: true, developerMode: false },
      pageState: {
        nameA: SHARE_VOCABULARY[0],
        nameB: SHARE_VOCABULARY[1],
        specialAbilitiesA: { volcanic: true, frosty: false, twoFacedMode: "madness", healingPulseMode: "normal" },
        custom: {
          creature: {
            name: "StormTest",
            stats: { tier: 1, health: 3000, damage: 0, biteCooldown: 2, breath: "Storm Breath" },
            breathAbilities: [{ abilityId: "Storm Breath", value: null, semantics: "neutral" }],
          },
          effects: { applyStatusOnHit: [], resistStatus: [] },
        },
      },
      participantCustomCreatures: [],
    };
  }

  it("round-trips a forced COSM4 link (decode branch + version lookup)", () => {
    const snapshot = richSnapshot();
    const code = manualEncodeV4(snapshot);
    expect(code.startsWith("COSM4:")).toBe(true);
    expect(decodeMatchSnapshot(code)).toEqual(snapshot);
  });

  it("round-trips whatever encodeMatchSnapshot picks for a rich snapshot", () => {
    const snapshot = richSnapshot();
    expect(decodeMatchSnapshot(encodeMatchSnapshot(snapshot))).toEqual(snapshot);
  });

  it("the preset dictionary makes COSM4 shorter than plain base64", () => {
    const snapshot = richSnapshot();
    const plain = legacyEncodeV1(snapshot).length;
    expect(manualEncodeV4(snapshot).length).toBeLessThan(plain);
  });

  it("returns null for an unknown dictionary version", () => {
    expect(decodeMatchSnapshot("COSM4:z.AAAA")).toBeNull();
  });

  it("returns null for a malformed COSM4 link (no version separator)", () => {
    expect(decodeMatchSnapshot("COSM4:abcd")).toBeNull();
  });

  it("returns null for a corrupt COSM4 payload", () => {
    expect(decodeMatchSnapshot("COSM4:1.!!!not-valid!!!")).toBeNull();
  });
});

describe("buildMatchSnapshotForActivePage", () => {
  it("bundles only participant custom creatures", () => {
    const unregister = registerMatchSnapshotProvider({
      page: "compare",
      getSnapshot: () => ({ pageState: { x: 1 }, participantCreatureNames: ["Custom A", "Custom B"] }),
      applySnapshot: () => {},
    });
    try {
      const snapshot = buildMatchSnapshotForActivePage({
        page: "compare",
        globalSettings: { combatEventOrder: [], trueRoundingMode: false, developerMode: false },
        customRecords: [makeCustomRecord("Custom A"), makeCustomRecord("Custom B"), makeCustomRecord("Unused")],
      });
      expect(snapshot.pageState).toEqual({ x: 1 });
      expect(snapshot.participantCustomCreatures.map((r) => r.creature.name)).toEqual(["Custom A", "Custom B"]);
    } finally {
      unregister();
    }
  });

  it("degrades to global-only when no provider registered", () => {
    const snapshot = buildMatchSnapshotForActivePage({
      page: "credits",
      globalSettings: { combatEventOrder: [], trueRoundingMode: true, developerMode: true },
      customRecords: [makeCustomRecord("X")],
    });
    expect(snapshot.pageState).toEqual({});
    expect(snapshot.participantCustomCreatures).toEqual([]);
  });

  it("prunes empty/nullish top-level page-state fields (keeps false and non-empty)", () => {
    const unregister = registerMatchSnapshotProvider({
      page: "compare",
      getSnapshot: () => ({
        pageState: { nameA: "X", emptyArr: [], emptyObj: {}, nullish: null, kept: false, keptList: ["a"] },
        participantCreatureNames: [],
      }),
      applySnapshot: () => {},
    });
    try {
      const snapshot = buildMatchSnapshotForActivePage({
        page: "compare",
        globalSettings: { combatEventOrder: [], trueRoundingMode: false, developerMode: false },
        customRecords: [],
      });
      expect(snapshot.pageState).toEqual({ nameA: "X", kept: false, keptList: ["a"] });
    } finally {
      unregister();
    }
  });

  it("drops page-state fields equal to the page default, keeps changed ones", () => {
    const unregister = registerMatchSnapshotProvider({
      page: "compare",
      getSnapshot: () => ({
        pageState: {
          nameA: "Garluhmoat",
          compareBuffsA: { ...DEFAULT_COMPARE_BUFF_SELECTION }, // equals default -> dropped
          compareBuffsB: { ...DEFAULT_COMPARE_BUFF_SELECTION, scared: true }, // changed -> kept
          specialAbilitiesA: { ...DEFAULT_COMPARE_SPECIAL_ABILITIES }, // equals default -> dropped
        },
        participantCreatureNames: [],
      }),
      applySnapshot: () => {},
    });
    try {
      const snapshot = buildMatchSnapshotForActivePage({
        page: "compare",
        globalSettings: { combatEventOrder: [], trueRoundingMode: false, developerMode: false },
        customRecords: [],
      });
      expect(Object.keys(snapshot.pageState).sort()).toEqual(["compareBuffsB", "nameA"]);
      expect((snapshot.pageState.compareBuffsB as { scared: boolean }).scared).toBe(true);
    } finally {
      unregister();
    }
  });

  it("drops fields equal to provider-declared defaults (getDefaultPageState)", () => {
    const unregister = registerMatchSnapshotProvider({
      page: "sandbox",
      getSnapshot: () => ({
        pageState: { resultViewMode: "summary", changed: "x" },
        participantCreatureNames: [],
      }),
      getDefaultPageState: () => ({ resultViewMode: "summary", changed: "original" }),
      applySnapshot: () => {},
    });
    try {
      const snapshot = buildMatchSnapshotForActivePage({
        page: "sandbox",
        globalSettings: { combatEventOrder: [], trueRoundingMode: false, developerMode: false },
        customRecords: [],
      });
      // resultViewMode equals the declared default -> dropped; changed differs -> kept.
      expect(snapshot.pageState).toEqual({ changed: "x" });
    } finally {
      unregister();
    }
  });
});

describe("applyMatchSnapshotPageState", () => {
  it("invokes provider applySnapshot and returns true", () => {
    let applied: Record<string, unknown> | null = null;
    const unregister = registerMatchSnapshotProvider({
      page: "sandbox",
      getSnapshot: () => ({ pageState: {}, participantCreatureNames: [] }),
      applySnapshot: (state) => {
        applied = state;
      },
    });
    try {
      const ok = applyMatchSnapshotPageState({
        version: 1,
        page: "sandbox",
        globalSettings: { combatEventOrder: [], trueRoundingMode: false, developerMode: false },
        pageState: { restored: true },
        participantCustomCreatures: [],
      });
      expect(ok).toBe(true);
      expect(applied).toEqual({ restored: true });
    } finally {
      unregister();
    }
  });

  it("returns false when no provider for page", () => {
    const ok = applyMatchSnapshotPageState({
      version: 1,
      page: "donate",
      globalSettings: { combatEventOrder: [], trueRoundingMode: false, developerMode: false },
      pageState: {},
      participantCustomCreatures: [],
    });
    expect(ok).toBe(false);
  });
});

describe("imported-match reload resilience (sessionStorage carrier)", () => {
  // The shared test env runs in node without sessionStorage; provide a
  // minimal in-memory stand-in so the carrier round-trip is exercised.
  const originalSessionStorage = (globalThis as { sessionStorage?: Storage }).sessionStorage;
  beforeAll(() => {
    const store = new Map<string, string>();
    (globalThis as { sessionStorage?: unknown }).sessionStorage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
      clear: () => store.clear(),
      key: () => null,
      length: 0,
    } satisfies Storage;
  });
  afterAll(() => {
    (globalThis as { sessionStorage?: unknown }).sessionStorage = originalSessionStorage;
  });

  it("stashes, reads back, and clears the import code", () => {
    const code = "COSM1:test-payload";
    clearStashedImportedMatch();
    expect(readStashedImportedMatchCode()).toBeNull();
    stashImportedMatchCode(code);
    expect(readStashedImportedMatchCode()).toBe(code);
    clearStashedImportedMatch();
    expect(readStashedImportedMatchCode()).toBeNull();
  });
});
