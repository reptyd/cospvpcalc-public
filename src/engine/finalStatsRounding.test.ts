import { describe, expect, it } from "vitest";
import { applyTrueRoundingMode } from "./finalStatsRounding";
import { baseStats } from "./engine.test.helpers";

describe("applyTrueRoundingMode", () => {
  it("rounds final damage and weight with .5 going up", () => {
    const rounded = applyTrueRoundingMode({
      ...baseStats({ name: "RoundTest", damage: 100, weight: 100 }),
      damage: 687.5,
      weight: 60400.5,
      hasBreath: false,
      breathType: null,
      approxNotes: [],
      appliedTraits: [],
    });

    expect(rounded.damage).toBe(688);
    expect(rounded.weight).toBe(60401);
  });

  it("leaves other stats unchanged", () => {
    const rounded = applyTrueRoundingMode({
      ...baseStats({ name: "RoundTest", damage: 100, weight: 100, biteCooldown: 0.945 }),
      damage: 687.4,
      weight: 60400.4,
      healthRegen: 3.2,
      hasBreath: true,
      breathType: "Miasma Breath",
      approxNotes: ["test"],
      appliedTraits: ["Damage"],
      elder: "Powerful",
    });

    expect(rounded.damage).toBe(687);
    expect(rounded.weight).toBe(60400);
    expect(rounded.biteCooldown).toBe(0.945);
    expect(rounded.healthRegen).toBe(3.2);
    expect(rounded.elder).toBe("Powerful");
    expect(rounded.breathType).toBe("Miasma Breath");
  });
});
