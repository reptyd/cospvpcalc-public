import { describe, expect, it } from "vitest";
import { canonicalAbilityNameKey, normalizeAbilityDisplayName } from "./abilityNameAliases";

describe("abilityNameAliases", () => {
  it("normalizes known typoed ability display names to canonical forms", () => {
    expect(normalizeAbilityDisplayName("Strengh In Numbers")).toBe("Strength In Numbers");
    expect(normalizeAbilityDisplayName("Wingshredder")).toBe("Wing Shredder");
    // The wiki spells it without the hyphen; the engine matches the hyphenated form.
    expect(normalizeAbilityDisplayName("Two Faced")).toBe("Two-Faced");
    expect(normalizeAbilityDisplayName("Two-Faced")).toBe("Two-Faced");
    expect(normalizeAbilityDisplayName("Self Destruct")).toBe("Self-Destruct");
    expect(normalizeAbilityDisplayName("Self-Destruct")).toBe("Self-Destruct");
  });

  it("gives the same canonical key to typoed and canonical forms", () => {
    expect(canonicalAbilityNameKey("Strengh In Numbers")).toBe(canonicalAbilityNameKey("Strength In Numbers"));
    expect(canonicalAbilityNameKey("Wingshredder")).toBe(canonicalAbilityNameKey("Wing Shredder"));
  });
});
