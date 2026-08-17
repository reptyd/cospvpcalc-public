import { describe, expect, it } from "vitest";
import { DEFAULT_COMPARE_SPECIAL_ABILITIES } from "../components/compare/compareSpecialAbilities";
import { makeAbility, makeSyntheticCreature } from "../optimizer/__fixtures__/syntheticCreature";
import { __test_compareGates } from "./useCompareSimulation";

// The gates that decide whether a Compare toggle reaches the engine at all.
// They had no test of any kind - three commits moved real Compare numbers
// through this file without one - and each is a place where "the setting did
// nothing" and "the setting worked" look identical from outside.
//
// Creatures here are synthetic, so a rebalance cannot reach these assertions.

const {
  buildCompareInitialStatuses,
  hasDarkstarPlushie,
  resolveCompareWardenRageStartHpPct,
  resolveCompareHeadStartSec,
} = __test_compareGates;

const abilities = (patch: Partial<typeof DEFAULT_COMPARE_SPECIAL_ABILITIES> = {}) => ({
  ...DEFAULT_COMPARE_SPECIAL_ABILITIES,
  ...patch,
});

const carrier = (...names: string[]) =>
  makeSyntheticCreature({
    name: `CompareGate_${names.join("_") || "bare"}`,
    passiveAbilities: names.map((name) => makeAbility(name)),
  });

const build = (plushies: string[]) =>
  ({ plushies, traits: [], ascensionAssignments: [], venerationStage: 0 }) as never;

describe("Broodwatcher seeds Defensive only for a creature that has it", () => {
  it("seeds it for a carrier, on top of whatever was already there", () => {
    const seeded = buildCompareInitialStatuses(
      [{ statusId: "Bleed_Status", stacks: 3 }],
      carrier("Broodwatcher"),
      abilities({ broodwatcher: true }),
    );
    expect(seeded).toHaveLength(2);
    const defensive = seeded?.find((entry) => entry.statusId === "Defensive_Status");
    // The stacks are a lifetime, not a magnitude - `durationOnly` is what tells
    // the engine to clamp them to one stack's worth of weight.
    expect(defensive).toMatchObject({ noDecay: true, stackValueMode: "durationOnly" });
  });

  it("leaves a creature without the ability alone, toggle or no toggle", () => {
    for (const broodwatcher of [true, false]) {
      expect(buildCompareInitialStatuses([], carrier(), abilities({ broodwatcher }))).toEqual([]);
    }
  });

  it("leaves a carrier alone while the toggle is off", () => {
    expect(
      buildCompareInitialStatuses([], carrier("Broodwatcher"), abilities({ broodwatcher: false })),
    ).toEqual([]);
  });
});

describe("the Darkstar plushie is matched however it is written", () => {
  it.each(["Darkstar", "darkstar", "  DARKSTAR  "])("%s counts", (name) => {
    expect(hasDarkstarPlushie(build([name]))).toBe(true);
  });

  it("another plushie does not", () => {
    expect(hasDarkstarPlushie(build(["Dark Star", "Star", ""]))).toBe(false);
  });
});

describe("Warden's Rage starting HP is gated, floored and clamped", () => {
  const owner = carrier("Warden's Rage");

  it("passes a whole percent through for a carrier", () => {
    expect(resolveCompareWardenRageStartHpPct(owner, abilities({ wardenRageStartHp: true, wardenRageStartHpPct: 40 }))).toBe(40);
  });

  it("floors a fraction rather than rounding it", () => {
    expect(resolveCompareWardenRageStartHpPct(owner, abilities({ wardenRageStartHp: true, wardenRageStartHpPct: 40.9 }))).toBe(40);
  });

  it("caps at 100", () => {
    expect(resolveCompareWardenRageStartHpPct(owner, abilities({ wardenRageStartHp: true, wardenRageStartHpPct: 250 }))).toBe(100);
  });

  it("treats anything under one percent as off, so the 1% floor never binds", () => {
    // The floor runs before the clamp: `Math.floor(0.5)` is 0 and the `pct <= 0`
    // guard returns first, so `COMPARE_WARDEN_RAGE_START_HP_MIN_PCT` can only
    // ever be reached by a value that already exceeds it. Pinned as it behaves,
    // not as the constant reads.
    expect(resolveCompareWardenRageStartHpPct(owner, abilities({ wardenRageStartHp: true, wardenRageStartHpPct: 0.5 }))).toBe(0);
    expect(resolveCompareWardenRageStartHpPct(owner, abilities({ wardenRageStartHp: true, wardenRageStartHpPct: 0.99 }))).toBe(0);
  });

  it("is zero without the ability, without the toggle, or on a number that is not one", () => {
    expect(resolveCompareWardenRageStartHpPct(carrier(), abilities({ wardenRageStartHp: true, wardenRageStartHpPct: 40 }))).toBe(0);
    expect(resolveCompareWardenRageStartHpPct(owner, abilities({ wardenRageStartHp: false, wardenRageStartHpPct: 40 }))).toBe(0);
    expect(resolveCompareWardenRageStartHpPct(owner, abilities({ wardenRageStartHp: true, wardenRageStartHpPct: 0 }))).toBe(0);
    expect(resolveCompareWardenRageStartHpPct(owner, abilities({ wardenRageStartHp: true, wardenRageStartHpPct: Number.NaN }))).toBe(0);
  });
});

describe("Head Start reaches any creature, but only while it is on", () => {
  it("needs no ability - it is a battle setting, not something a creature owns", () => {
    expect(resolveCompareHeadStartSec(abilities({ headStart: true, headStartSec: 6 }))).toBe(6);
  });

  it("is zero while off, and on a value that is not a positive number", () => {
    expect(resolveCompareHeadStartSec(abilities({ headStart: false, headStartSec: 6 }))).toBe(0);
    expect(resolveCompareHeadStartSec(abilities({ headStart: true, headStartSec: 0 }))).toBe(0);
    expect(resolveCompareHeadStartSec(abilities({ headStart: true, headStartSec: -3 }))).toBe(0);
    expect(resolveCompareHeadStartSec(abilities({ headStart: true, headStartSec: Number.NaN }))).toBe(0);
  });
});
