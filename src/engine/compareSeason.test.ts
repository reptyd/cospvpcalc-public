import { describe, expect, it } from "vitest";
import { getSeasonDrainChangePct, getSeasonMeterIntervals, type CompareSeason } from "./compareSeason";

describe("season meter intervals", () => {
  it("reads the game's numbers as intervals, so above 1 is a slower meter [REF:compare_season]", () => {
    expect(getSeasonMeterIntervals("winter")).toEqual({ hunger: 0.8, thirst: 0.9 });
    expect(getSeasonMeterIntervals("famine").hunger).toBe(1.9);
    expect(getSeasonMeterIntervals("drought").thirst).toBe(0.7);
  });

  it("turns each into the drain change the entry quotes [REF:compare_season]", () => {
    expect(getSeasonDrainChangePct("winter", "hunger")).toBeCloseTo(25, 0);
    expect(getSeasonDrainChangePct("winter", "thirst")).toBeCloseTo(11, 0);
    expect(getSeasonDrainChangePct("famine", "hunger")).toBeCloseTo(-47, 0);
    expect(getSeasonDrainChangePct("drought", "thirst")).toBeCloseTo(43, 0);
  });

  it("leaves the seasons with no combat effect alone [REF:compare_season]", () => {
    for (const season of ["none", "spring", "summer", "fall", "sakura"] as CompareSeason[]) {
      expect(getSeasonMeterIntervals(season)).toEqual({ hunger: 1, thirst: 1 });
    }
    expect(getSeasonMeterIntervals(undefined)).toEqual({ hunger: 1, thirst: 1 });
  });
});
