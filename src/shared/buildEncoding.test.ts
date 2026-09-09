import { describe, expect, it } from "vitest";
import type { BuildOptions } from "../engine";
import { buildResultKey, computeAscensionCounts, plushiePairKey } from "./buildEncoding";

describe("buildEncoding", () => {
  it("computes ascension counts for selected traits only", () => {
    const counts = computeAscensionCounts(
      ["Damage", "Bite"],
      ["Damage", "Weight", "Bite", "Damage", ""],
      4,
    );
    expect(counts).toEqual([2, 1]);
  });

  it("normalizes plushie pair keys", () => {
    expect(plushiePairKey([])).toBe("none");
    expect(plushiePairKey(["Void"])).toBe("Void");
    expect(plushiePairKey(["Ice Wolf", "Void"])).toBe("Ice Wolf+Void");
    expect(plushiePairKey(["Void", "Void"])).toBe("Void+Void");
  });

  it("builds stable result key for equivalent trait counts and plushie order changes", () => {
    const buildA: BuildOptions = {
      venerationStage: 5,
      traits: ["Damage", "Bite"],
      ascensionAssignments: ["Damage", "Bite", "Damage", "Bite", "Damage"],
      plushies: ["Void", "Ice Wolf"],
    };
    const buildB: BuildOptions = {
      venerationStage: 5,
      traits: ["Bite", "Damage"],
      ascensionAssignments: ["Bite", "Damage", "Bite", "Damage", "Bite"],
      plushies: ["Ice Wolf", "Void"],
    };
    expect(buildResultKey(buildA, true, false)).toBe(buildResultKey(buildB, true, false));
  });
});
