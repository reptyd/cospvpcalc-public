import { describe, expect, it } from "vitest";
import { abilityMatches, dropValueToRuntime, runtimeValueToDrop } from "./abilityMatch";

describe("abilityMatches", () => {
  it("matches by plain name", () => {
    expect(abilityMatches("Block Frostbite", { name: "Block Frostbite", value: 0.5 })).toBe(true);
  });
  it("matches a subtype carried as the value (Charge Launch -> Charge/Launch)", () => {
    expect(abilityMatches("Charge Launch", { name: "Charge", value: "Launch" })).toBe(true);
    expect(abilityMatches("Charge Throw", { name: "Charge", value: "Launch" })).toBe(false);
  });
  it("matches a parens subtype in the name (Lance Frostbite -> Lance (Frostbite))", () => {
    expect(abilityMatches("Lance Frostbite", { name: "Lance (Frostbite)", value: null })).toBe(true);
  });
  it("does not match unrelated abilities", () => {
    expect(abilityMatches("Frosty", { name: "Serrated Teeth", value: null })).toBe(false);
  });
});

describe("Block value units", () => {
  it("converts a drop percent to a runtime fraction", () => {
    expect(dropValueToRuntime("Block Frostbite", 50)).toBe(0.5);
    expect(dropValueToRuntime("Block Bleed", -75)).toBe(-0.75);
  });
  it("leaves an already-fractional value and non-block values alone", () => {
    expect(dropValueToRuntime("Block Frostbite", 0.5)).toBe(0.5);
    expect(dropValueToRuntime("Injury Attack", 3)).toBe(3);
    expect(dropValueToRuntime("Bleed Attack", 0.5)).toBe(0.5);
  });
  it("converts a runtime fraction back to a display percent", () => {
    expect(runtimeValueToDrop("Block Frostbite", 0.5)).toBe(50);
    expect(runtimeValueToDrop("Injury Attack", 3)).toBe(3);
  });
});
