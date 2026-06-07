import { describe, expect, it } from "vitest";
import { creatureByName, effectsCatalog } from "./data";
import { applyRulesAndBuild } from "./buildRules";

describe("build rules", () => {
  it("applies Two-Faced Madness mode by default (×0.625 damage and cooldown)", () => {
    const creature = creatureByName["Noxulumen"];
    expect(creature).toBeTruthy();
    if (!creature) return;

    expect(effectsCatalog["Noxulumen"]?.otherAbilities?.some((ability) => ability.name === "Two-Faced")).toBe(true);

    const built = applyRulesAndBuild(creature);
    expect(built.damage).toBeCloseTo(creature.stats.damage * 0.625, 5);
    expect(built.biteCooldown).toBeCloseTo(creature.stats.biteCooldown * 0.625, 5);
  });

  it("applies Two-Faced Tranquility mode when requested (×1.6 damage and cooldown)", () => {
    const creature = creatureByName["Noxulumen"];
    expect(creature).toBeTruthy();
    if (!creature) return;

    const built = applyRulesAndBuild(creature, undefined, "tranquility");
    expect(built.damage).toBeCloseTo(creature.stats.damage * 1.6, 5);
    expect(built.biteCooldown).toBeCloseTo(creature.stats.biteCooldown * 1.6, 5);
  });
});
