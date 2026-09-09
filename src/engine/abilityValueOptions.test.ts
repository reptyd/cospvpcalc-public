import { describe, expect, it } from "vitest";
import { canonicalizeAbilityValue, getAbilityValueOptions } from "./abilityValueOptions";

describe("ability value options", () => {
  it("offers explicit Yolk Bomb choices with runtime-safe values", () => {
    const values = getAbilityValueOptions("Yolk Bomb").map((option) => option.value);

    expect(values).toContain("BlurredVision");
    expect(values).toContain("BadOmen");
    expect(values).toContain("Healing Pulse");
    expect(values).toContain("Fortify");
  });

  it("canonicalizes readable Yolk Bomb labels for imported custom creatures", () => {
    expect(canonicalizeAbilityValue("Yolk Bomb", "Blurred Vision")).toBe("BlurredVision");
    expect(canonicalizeAbilityValue("Yolk Bomb", "Bad Omen")).toBe("BadOmen");
    expect(canonicalizeAbilityValue("Yolk Bomb", "Deep-Wounds")).toBe("Deep Wounds");
  });

  it("keeps non-enum ability values unchanged", () => {
    expect(canonicalizeAbilityValue("Lich Mark", "Bad Omen")).toBe("Bad Omen");
    expect(canonicalizeAbilityValue("Shadow Barrage", 3)).toBe(3);
  });
});
