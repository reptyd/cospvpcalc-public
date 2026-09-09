import { describe, expect, it } from "vitest";
import { combineStatusBlockFractions } from "./statusBlockMath";

describe("status block math", () => {
  it("adds natural, plushie, and elder blocks as percentage points", () => {
    expect(combineStatusBlockFractions(0.5, 0.5, 0.1)).toBe(1);
    expect(combineStatusBlockFractions(0.1, 0.1)).toBeCloseTo(0.2);
  });

  it("lets negative block modifiers reduce the existing block pool", () => {
    expect(combineStatusBlockFractions(0.5, -0.05)).toBeCloseTo(0.45);
    expect(combineStatusBlockFractions(0.1, -0.25)).toBe(0);
  });
});
