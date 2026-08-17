import { describe, expect, it } from "vitest";
import {
  COMPARE_DEFAULT_APPETITE_BASE,
  COMPARE_GOURMANDIZER_FULL_BONUS_FILL_PCT,
  COMPARE_GOURMANDIZER_MAX_WEIGHT_BONUS_PCT,
  convertFillPctToAppetiteUnits,
  getGourmandizerFillPct,
  getGourmandizerWeightBonusPct,
  normalizeCompareFillPct,
  normalizeCompareHunger,
} from "./compareHungerMath";
import {
  getDefiledGroundAilmentRecoveryPct,
  getDefiledGroundOwnerDrainMultiplier,
  getDefiledGroundConsumptionReductionPct,
  getDefiledGroundStatBonusPct,
  normalizeCompareDefiledGroundLevel,
  type CompareDefiledGroundLevel,
} from "./compareDefiledGroundData";

// Two tables and a ramp that nothing tested. Zeroing either table leaves both
// abilities doing nothing at all, and the level caption reading "+0%", with the
// suite green.

const LEVELS: CompareDefiledGroundLevel[] = [1, 2, 3];

describe("Gourmandizer's overfill window", () => {
  const base = COMPARE_DEFAULT_APPETITE_BASE;

  it("pays nothing at or below full [REF:compare_gourmandizer]", () => {
    expect(getGourmandizerWeightBonusPct(base, base)).toBeCloseTo(0, 9);
    expect(getGourmandizerWeightBonusPct(base * 0.5, base)).toBeCloseTo(0, 9);
    expect(getGourmandizerWeightBonusPct(0, base)).toBeCloseTo(0, 9);
  });

  it("ramps straight from full to the top of the window [REF:compare_gourmandizer]", () => {
    const top = (COMPARE_GOURMANDIZER_FULL_BONUS_FILL_PCT / 100) * base;
    expect(getGourmandizerWeightBonusPct(top, base)).toBeCloseTo(
      COMPARE_GOURMANDIZER_MAX_WEIGHT_BONUS_PCT,
      9,
    );

    // Linear means the midpoint is half, and equal steps buy equal bonus.
    const mid = ((100 + COMPARE_GOURMANDIZER_FULL_BONUS_FILL_PCT) / 2 / 100) * base;
    expect(getGourmandizerWeightBonusPct(mid, base)).toBeCloseTo(
      COMPARE_GOURMANDIZER_MAX_WEIGHT_BONUS_PCT / 2,
      9,
    );
    const quarter = ((100 + (COMPARE_GOURMANDIZER_FULL_BONUS_FILL_PCT - 100) / 4) / 100) * base;
    expect(getGourmandizerWeightBonusPct(quarter, base)).toBeCloseTo(
      COMPARE_GOURMANDIZER_MAX_WEIGHT_BONUS_PCT / 4,
      9,
    );
  });

  it("stops paying past the top of the window [REF:compare_gourmandizer]", () => {
    const past = (COMPARE_GOURMANDIZER_FULL_BONUS_FILL_PCT * 2 / 100) * base;
    expect(getGourmandizerWeightBonusPct(past, base)).toBeCloseTo(
      COMPARE_GOURMANDIZER_MAX_WEIGHT_BONUS_PCT,
      9,
    );
  });

  it("reads fill against the creature's own appetite, not a fixed number", () => {
    // A big-appetite creature at the same absolute hunger is less full.
    expect(getGourmandizerFillPct(100, 100)).toBeCloseTo(100, 9);
    expect(getGourmandizerFillPct(100, 200)).toBeCloseTo(50, 9);
    expect(convertFillPctToAppetiteUnits(125, 200)).toBeCloseTo(250, 9);
  });

  it("keeps a nonsense input from poisoning the fill", () => {
    for (const junk of [undefined, null, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(normalizeCompareHunger(junk as number)).toBe(100);
      expect(normalizeCompareFillPct(junk as number)).toBe(100);
    }
    expect(normalizeCompareHunger(-5)).toBe(0);
    expect(normalizeCompareFillPct(1000)).toBe(150);
  });
});

describe("Defiled Ground's three levels", () => {
  it("gives more the higher the level, on every channel [REF:compare_defiled_ground]", () => {
    const stat = LEVELS.map(getDefiledGroundStatBonusPct);
    const recovery = LEVELS.map(getDefiledGroundAilmentRecoveryPct);
    const consumption = LEVELS.map(getDefiledGroundConsumptionReductionPct);

    for (const channel of [stat, recovery, consumption]) {
      expect(channel[0]).toBeGreaterThan(0);
      expect(channel[1]).toBeGreaterThan(channel[0]);
      expect(channel[2]).toBeGreaterThan(channel[1]);
    }
  });

  it("turns its reduction into a multiplier below one [REF:compare_defiled_ground]", () => {
    for (const level of LEVELS) {
      const owner = getDefiledGroundOwnerDrainMultiplier(level);
      expect(owner).toBeGreaterThan(0);
      expect(owner).toBeLessThan(1);
      expect(owner).toBeCloseTo(1 - getDefiledGroundConsumptionReductionPct(level) / 100, 9);
    }
  });

  it("reads the reduction off the interval, not as the interval [REF:compare_defiled_ground]", () => {
    // The game's level 2 stretches the interval to 1.5x, which is a third less
    // consumed - not the half a plain reading of "1.5" would suggest.
    expect(getDefiledGroundConsumptionReductionPct(2)).toBeCloseTo((1 - 1 / 1.5) * 100, 9);
    expect(getDefiledGroundConsumptionReductionPct(2)).toBeLessThan(50);
  });

  it("falls back to the lowest level rather than off the table", () => {
    for (const junk of [undefined, null, 0, 4, -1, 2.5, Number.NaN]) {
      expect(normalizeCompareDefiledGroundLevel(junk as number)).toBe(1);
    }
    expect(normalizeCompareDefiledGroundLevel(2)).toBe(2);
    expect(normalizeCompareDefiledGroundLevel(3)).toBe(3);
  });
});
