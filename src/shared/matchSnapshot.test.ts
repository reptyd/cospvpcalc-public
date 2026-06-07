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

function makeCustomRecord(name: string): CustomCreatureRecord {
  return {
    creature: { name } as CustomCreatureRecord["creature"],
    effects: {} as CustomCreatureRecord["effects"],
    appetite: null,
    iconName: null,
    createdAt: 0,
  };
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
    expect(code.startsWith("COSM1:")).toBe(true);
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
