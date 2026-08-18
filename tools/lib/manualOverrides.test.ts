import { describe, expect, it } from "vitest";
import {
  describeEntry,
  lifecycleStatus,
  makeEntryId,
  parseRetireSelection,
  retireEntry,
  type ManualOverrideEntry,
} from "./manualOverrides";

const NOW = new Date("2026-07-04T00:00:00Z").getTime();

function statEntry(over: Partial<ManualOverrideEntry> = {}): ManualOverrideEntry {
  return {
    id: "x",
    channel: "early",
    creature: "X",
    source: "s",
    note: "n",
    kind: "stat",
    field: "weight",
    value: 100,
    ...over,
  } as ManualOverrideEntry;
}

describe("lifecycleStatus", () => {
  it("is active with no lifecycle fields", () => {
    expect(lifecycleStatus(statEntry(), NOW)).toBe("active");
  });
  it("is retired once retiredAt is set", () => {
    expect(lifecycleStatus(statEntry({ retiredAt: "2026-01-01" }), NOW)).toBe("retired");
  });
  it("is date-expired once expiresAt is reached", () => {
    expect(lifecycleStatus(statEntry({ expiresAt: "2026-06-01" }), NOW)).toBe("date-expired");
    expect(lifecycleStatus(statEntry({ expiresAt: "2026-09-01" }), NOW)).toBe("active");
  });
});

describe("makeEntryId", () => {
  it("kebab-cases and disambiguates collisions", () => {
    const taken = new Set<string>();
    expect(makeEntryId("Icebreaker Meorlark", "Block Frostbite", taken)).toBe("icebreaker-meorlark-block-frostbite");
    expect(makeEntryId("Icebreaker Meorlark", "Block Frostbite", taken)).toBe("icebreaker-meorlark-block-frostbite-2");
  });
});

describe("retireEntry", () => {
  it("stamps retiredAt on a match and refuses a re-retire", () => {
    const entries = [statEntry({ id: "a" }), statEntry({ id: "b" })];
    expect(retireEntry(entries, "a", "2026-07-04")?.retiredAt).toBe("2026-07-04");
    expect(retireEntry(entries, "a", "2026-07-05")).toBeNull();
    expect(retireEntry(entries, "missing", "2026-07-04")).toBeNull();
  });
});

describe("parseRetireSelection", () => {
  const entries = [
    statEntry({ id: "a" }),
    statEntry({ id: "b" }),
    statEntry({ id: "c", channel: "user-specific" }),
    statEntry({ id: "d" }),
    statEntry({ id: "e" }),
  ];
  const ids = (result: ReturnType<typeof parseRetireSelection>) =>
    "picked" in result ? result.picked.map((e) => e.id) : result.error;

  it("picks numbers, ranges, and mixes without duplicates", () => {
    expect(ids(parseRetireSelection("2", entries))).toEqual(["b"]);
    expect(ids(parseRetireSelection("2-4", entries))).toEqual(["b", "c", "d"]);
    expect(ids(parseRetireSelection("1, 3 4-5 3", entries))).toEqual(["a", "c", "d", "e"]);
  });

  it("picks a channel or everything", () => {
    expect(ids(parseRetireSelection("user-specific", entries))).toEqual(["c"]);
    expect(ids(parseRetireSelection("early", entries))).toEqual(["a", "b", "d", "e"]);
    expect(ids(parseRetireSelection("all", entries))).toHaveLength(5);
  });

  it("rejects out-of-range and unreadable input", () => {
    expect(parseRetireSelection("6", entries)).toHaveProperty("error");
    expect(parseRetireSelection("0", entries)).toHaveProperty("error");
    expect(parseRetireSelection("4-2", entries)).toHaveProperty("error");
    expect(parseRetireSelection("banana", entries)).toHaveProperty("error");
    expect(parseRetireSelection("  ", entries)).toHaveProperty("error");
  });
});

describe("describeEntry", () => {
  it("describes a removal", () => {
    expect(describeEntry(statEntry({ kind: "ability", abilities: [], matchAbilityName: "Shadow Barrage" } as Partial<ManualOverrideEntry>)))
      .toBe("X: remove ability Shadow Barrage");
  });
});
