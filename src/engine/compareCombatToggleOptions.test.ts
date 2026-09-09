import { describe, expect, it } from "vitest";
import { baseStats } from "./engine.test.helpers";
import { creatureByName } from "./creatureData";
import { effectsCatalog } from "./data";
import {
  getCombatToggleOptions,
  normalizeCompareDisabledAbilities,
} from "./compareCombatToggleOptions";

describe("compare combat toggle options", () => {
  it("dedupes generic Breath and creature-specific breath abilities", () => {
    const finalStats = baseStats({
      hasBreath: true,
      breath: "Energy Breath",
      breathType: "Energy Breath",
    });

    const options = getCombatToggleOptions(finalStats, {
      specialAbilitiesDetailed: [{ name: "Energy Breath" }],
      specialAbilities: [{ name: "Breath" }],
    });

    expect(options.filter((option) => option.id === "Breath")).toHaveLength(1);
    expect(options.some((option) => option.id === "Energy Breath")).toBe(false);
  });

  it("normalizes a concrete breath disable to the generic Breath toggle", () => {
    const finalStats = baseStats({
      hasBreath: true,
      breath: "Energy Breath",
      breathType: "Energy Breath",
    });

    expect(normalizeCompareDisabledAbilities(["Energy Breath"], finalStats)).toEqual(["Breath"]);
  });

  it("includes modeled abilities from creature runtime when effects catalog is sparse", () => {
    const finalStats = baseStats({
      name: "Venuella",
    });

    const options = getCombatToggleOptions(finalStats, effectsCatalog.Venuella, creatureByName.Venuella);

    expect(options.some((option) => option.id === "Reflux")).toBe(true);
    expect(options.some((option) => option.id === "Toxic Trap")).toBe(true);
  });
});
