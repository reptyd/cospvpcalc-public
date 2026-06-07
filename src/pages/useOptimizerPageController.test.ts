// Mapping unit tests for the Optimizer page controller.
//
// The controller hook itself is harder to exercise headlessly (it touches
// the WASM bridge + React state), but the OLD-knob → BB-param translation
// is pure and easy to lock down. Regression guard for the goal/quality
// mapping if the BB objective enum ever shifts under us.

import { describe, expect, it } from "vitest";
import { mapGoalToObjective, mapQualityToSearchDepth } from "./useOptimizerPageController";

describe("mapGoalToObjective", () => {
  it("maps lexicographic to winRate", () => {
    expect(mapGoalToObjective("lexicographic")).toBe("winRate");
  });
  it("maps effectiveDamage to immortalDamage", () => {
    expect(mapGoalToObjective("effectiveDamage")).toBe("immortalDamage");
  });
  it("maps dps to avgDps", () => {
    expect(mapGoalToObjective("dps")).toBe("avgDps");
  });
});

describe("mapQualityToSearchDepth", () => {
  it("forces detailed when optimizationMode is guaranteed regardless of quality", () => {
    expect(mapQualityToSearchDepth("fast", "guaranteed")).toBe("detailed");
    expect(mapQualityToSearchDepth("balanced", "guaranteed")).toBe("detailed");
    expect(mapQualityToSearchDepth("quality", "guaranteed")).toBe("detailed");
  });
  it("uses detailed when quality is quality and mode is fast", () => {
    expect(mapQualityToSearchDepth("quality", "fast")).toBe("detailed");
  });
  it("uses soft for fast/balanced when mode is fast", () => {
    expect(mapQualityToSearchDepth("fast", "fast")).toBe("soft");
    expect(mapQualityToSearchDepth("balanced", "fast")).toBe("soft");
  });
});
