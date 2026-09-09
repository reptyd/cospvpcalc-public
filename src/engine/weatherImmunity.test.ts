import { describe, expect, it } from "vitest";
import { creaturesData } from "./creatureData";
import { applyRulesAndBuild } from "./buildRules";
import { toRustStatusMeleeStats } from "../optimizer/rustBestBuildsRuntime";
import { creatureHasAbility } from "../components/compare/compareSpecialAbilities";
import type { BuildOptions } from "./types";

// Frosty shrugs off Hypothermia and Volcanic shrugs off Heat Wave. The weather
// battle setting has always honoured that at setup, but the same two statuses
// also arrive mid-fight - Yolk Bomb routes both, Lich Mark routes Heat Wave -
// and those paths went through the ordinary status apply, which knew nothing
// about either ability. A Frosty creature does not start feeling the cold
// because a Frosflit threw it, so the immunity is carried as a status id and
// checked wherever a status lands.

const EMPTY_BUILD: BuildOptions = {
  venerationStage: 0,
  traits: [],
  ascensionAssignments: [],
  plushies: [],
};

function immuneIds(creature: (typeof creaturesData)[number]): string[] {
  const finalStats = applyRulesAndBuild(creature, EMPTY_BUILD);
  const stats = toRustStatusMeleeStats(creature, finalStats) as { immuneStatusIds?: string[] };
  return stats.immuneStatusIds ?? [];
}

describe("weather immunity holds against every source, not only the weather setting", () => {
  it.each([
    ["Frosty", "Hypothermia_Status"],
    ["Volcanic", "Heat_Wave_Status"],
  ])("%s carries %s as an immunity", (ability, statusId) => {
    const owners = creaturesData.filter((creature) => creatureHasAbility(creature, ability));
    expect(owners.length, `no creature carries ${ability}, so this proves nothing`).toBeGreaterThan(0);

    const without = owners.filter((creature) => !immuneIds(creature).includes(statusId));
    expect(without.map((creature) => creature.name), `${ability} must grant immunity to ${statusId}`).toEqual([]);
  });

  it("grants it to nobody else", () => {
    const wrongly = creaturesData
      .filter((creature) => !creatureHasAbility(creature, "Frosty") && !creatureHasAbility(creature, "Volcanic"))
      .filter((creature) => {
        const ids = immuneIds(creature);
        return ids.includes("Hypothermia_Status") || ids.includes("Heat_Wave_Status");
      })
      .map((creature) => creature.name);
    expect(wrongly, "only Frosty and Volcanic hand out weather immunity").toEqual([]);
  });

  it("Frosflit's own Yolk Bomb cannot land Hypothermia on a Frosty creature", () => {
    // The case that exposed the hole: the one creature that applies
    // Hypothermia by ability rather than by weather.
    const frosflit = creaturesData.find((creature) => creature.name === "Frosflit");
    expect(frosflit, "Frosflit is the Yolk Bomb (Hypothermia) carrier this case rests on").toBeDefined();
    const target = creaturesData.find((creature) => creatureHasAbility(creature, "Frosty"));
    expect(immuneIds(target!)).toContain("Hypothermia_Status");
  });
});
