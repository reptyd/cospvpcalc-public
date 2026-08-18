import { describe, expect, it } from "vitest";
import {
  clampBlockFraction,
  clampEffectsBlockFractions,
  resolveAttackStatusId,
  resolveBlockStatusId,
  resolveDefensiveStatusId,
} from "./effectDerivation";

describe("clampBlockFraction", () => {
  it("caps the top at 1.0 (the engine's block ceiling)", () => {
    expect(clampBlockFraction(100)).toBe(1);
    expect(clampBlockFraction(1.0001)).toBe(1);
    expect(clampBlockFraction(1)).toBe(1);
  });

  it("leaves in-range fractions untouched", () => {
    expect(clampBlockFraction(0.45)).toBe(0.45);
    expect(clampBlockFraction(0)).toBe(0);
  });

  it("preserves negative fractions — a negative resist is a weakness the engine amplifies", () => {
    expect(clampBlockFraction(-0.5)).toBe(-0.5);
    expect(clampBlockFraction(-2)).toBe(-2);
  });

  it("passes non-finite through unchanged", () => {
    expect(clampBlockFraction(Number.NaN)).toBeNaN();
  });
});

describe("status mapping resolvers", () => {
  it("splits Necropoison from Poison", () => {
    expect(resolveBlockStatusId("Block Necropoison")).toBe("Necropoison_Status");
    expect(resolveBlockStatusId("Block Poison")).toBe("Poison_Status");
    expect(resolveAttackStatusId("Necropoison Attack")).toBe("Necropoison_Status");
    expect(resolveDefensiveStatusId("Defensive Necropoison")).toBe("Necropoison_Status");
  });

  it("maps Ligament Tear to Torn Ligaments", () => {
    expect(resolveAttackStatusId("Ligament Tear")).toBe("Torn_Ligaments_Status");
  });

  it("returns null for unmapped names", () => {
    expect(resolveBlockStatusId("Block Nonsense")).toBeNull();
    expect(resolveAttackStatusId("Wing Shredder")).toBeNull();
  });
});

describe("clampEffectsBlockFractions (load migration)", () => {
  it("caps stored over-1 block fractions and preserves the rest", () => {
    const migrated = clampEffectsBlockFractions({
      resistStatus: [
        { statusId: "Poison_Status", fraction: 100, sourceAbility: "Block Poison" },
        { statusId: "Burn_Status", fraction: 0.45, sourceAbility: "Block Burn" },
      ],
    });
    expect(migrated.resistStatus).toEqual([
      { statusId: "Poison_Status", fraction: 1, sourceAbility: "Block Poison" },
      { statusId: "Burn_Status", fraction: 0.45, sourceAbility: "Block Burn" },
    ]);
  });

  it("returns the same object when nothing needs capping (no churn)", () => {
    const effects = { resistStatus: [{ statusId: "Burn_Status", fraction: 0.4, sourceAbility: "Block Burn" }] };
    expect(clampEffectsBlockFractions(effects)).toBe(effects);
    expect(clampEffectsBlockFractions({})).toEqual({});
  });
});
