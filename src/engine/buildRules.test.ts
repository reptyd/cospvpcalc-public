import { describe, expect, it } from "vitest";
import { creatureByName, effectsCatalog } from "./data";
import { applyRulesAndBuild } from "./buildRules";
import { SPEC_CONSTANTS } from "./specConstants.generated";

describe("build rules", () => {
  it("applies Two-Faced Madness mode by default (×0.625 damage and cooldown) [REF:ability_two_faced]", () => {
    const creature = creatureByName["Noxulumen"];
    expect(creature).toBeTruthy();
    if (!creature) return;

    expect(effectsCatalog["Noxulumen"]?.otherAbilities?.some((ability) => ability.name === "Two-Faced")).toBe(true);

    const built = applyRulesAndBuild(creature);
    expect(built.damage).toBeCloseTo(creature.stats.damage * SPEC_CONSTANTS.two_faced_madness_multiplier, 5);
    expect(built.biteCooldown).toBeCloseTo(creature.stats.biteCooldown * SPEC_CONSTANTS.two_faced_madness_multiplier, 5);
  });

  it("applies Two-Faced Tranquility mode when requested (×1.6 damage and cooldown) [REF:ability_two_faced]", () => {
    const creature = creatureByName["Noxulumen"];
    expect(creature).toBeTruthy();
    if (!creature) return;

    const built = applyRulesAndBuild(creature, undefined, "tranquility");
    expect(built.damage).toBeCloseTo(creature.stats.damage * SPEC_CONSTANTS.two_faced_tranquility_multiplier, 5);
    expect(built.biteCooldown).toBeCloseTo(creature.stats.biteCooldown * SPEC_CONSTANTS.two_faced_tranquility_multiplier, 5);
  });

  it("a build commits to one Two-Faced mode, and the two are not the same build [REF:ability_two_faced]", () => {
    // The mode is a build-time argument, so it is fixed before the fight starts
    // and there is no path that changes it mid-combat. The two modes have to
    // land on different stats, or the rows above would pass on a coincidence.
    const creature = creatureByName["Noxulumen"];
    expect(creature).toBeTruthy();
    if (!creature) return;

    const madness = applyRulesAndBuild(creature, undefined, "madness");
    const tranquility = applyRulesAndBuild(creature, undefined, "tranquility");
    expect(madness.damage).not.toBeCloseTo(tranquility.damage, 5);
    expect(madness.biteCooldown).not.toBeCloseTo(tranquility.biteCooldown, 5);
    expect(applyRulesAndBuild(creature).damage).toBeCloseTo(madness.damage, 5);
  });
});
