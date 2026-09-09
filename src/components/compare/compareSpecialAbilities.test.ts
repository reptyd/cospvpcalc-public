import { describe, expect, it } from "vitest";
import {
  DEFAULT_COMPARE_SPECIAL_ABILITIES,
  normalizeBreathRollMode,
  normalizeCompareSpecialAbilities,
} from "./compareSpecialAbilities";

// A saved state outlives the names in it. The three breath roll modes were
// called something else before they were named, and a state saved then reaches
// the engine on the next visit - where an unknown name is not a wrong result
// but no result at all: the whole matchup fails to deserialize.
describe("stored breath roll modes", () => {
  it("brings the names a saved state can carry to the ones the engine knows", () => {
    expect(normalizeBreathRollMode("paced")).toBe("even");
    expect(normalizeBreathRollMode("averaged")).toBe("pseudo");
    expect(normalizeBreathRollMode("rolled")).toBe("random");
  });

  it("keeps a name that is already current", () => {
    expect(normalizeBreathRollMode("even")).toBe("even");
    expect(normalizeBreathRollMode("pseudo")).toBe("pseudo");
    expect(normalizeBreathRollMode("random")).toBe("random");
  });

  it("falls back to the default for anything else", () => {
    expect(normalizeBreathRollMode(undefined)).toBe("even");
    expect(normalizeBreathRollMode("whatever")).toBe("even");
  });

  it("normalizes the mode inside a whole stored side state", () => {
    const stored = { ...DEFAULT_COMPARE_SPECIAL_ABILITIES, breathRollMode: "paced" as never };
    expect(normalizeCompareSpecialAbilities(stored).breathRollMode).toBe("even");
  });

  it("fills a state saved before the setting existed", () => {
    const { breathRollMode: _dropped, ...withoutIt } = DEFAULT_COMPARE_SPECIAL_ABILITIES;
    expect(normalizeCompareSpecialAbilities(withoutIt).breathRollMode).toBe("even");
  });
});
