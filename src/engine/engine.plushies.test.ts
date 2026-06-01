import { describe, expect, it } from "vitest";
import { plushieByName } from "./data";
import { baseStats } from "./engine.test.helpers";
import { buildFinalFromStats, EMPTY_BUILD_0 } from "./engineTestFixtures";

describe("plushies", () => {
  it("multiplies percent modifiers (not additive)", () => {
    plushieByName.TestHpBoost = {
      name: "TestHpBoost",
      stackRule: "stackable",
      modifiersParsed: [{ stat: "hpPct", op: "addPct", value: 2.5 }],
    };
    const creature = baseStats({ health: 1000, name: "PlushTest" });
    const finalStats = buildFinalFromStats("PlushTest", creature, {
      ...EMPTY_BUILD_0,
      plushies: ["TestHpBoost", "TestHpBoost"],
    });
    expect(finalStats.health).toBeCloseTo(1000 * 1.025 * 1.025, 5);
  });

  it("unique plushie does not stack with itself", () => {
    plushieByName.TestUnique = {
      name: "TestUnique",
      stackRule: "unique",
      modifiersParsed: [{ stat: "damagePct", op: "addPct", value: 10 }],
    };
    const creature = baseStats({ damage: 100, name: "PlushTest2" });
    const finalStats = buildFinalFromStats("PlushTest2", creature, {
      ...EMPTY_BUILD_0,
      plushies: ["TestUnique", "TestUnique"],
    });
    expect(finalStats.damage).toBeCloseTo(110, 5);
  });

  it("applies plushies after veneration and traits", () => {
    plushieByName.TestDamage = {
      name: "TestDamage",
      stackRule: "stackable",
      modifiersParsed: [{ stat: "damagePct", op: "addPct", value: 10 }],
    };
    const creature = baseStats({ damage: 100, name: "PlushOrder" });
    const build = {
      venerationStage: 5,
      traits: ["Damage"],
      ascensionAssignments: ["Damage", "Damage", "Damage", "Damage", "Damage"],
      plushies: ["TestDamage"],
    };
    const finalStats = buildFinalFromStats("PlushOrder", creature, build);
    expect(finalStats.damage).toBeGreaterThan(110);
  });

  it("Void plushie increases damage by 7.5%", () => {
    const voidPlushie = plushieByName["Void"];
    expect(voidPlushie).toBeTruthy();
    if (!voidPlushie) return;
    const creature = baseStats({ damage: 100, name: "VoidTest" });
    const baseBuild = EMPTY_BUILD_0;
    const voidBuild = { ...baseBuild, plushies: ["Void"] };
    const baseStatsFinal = buildFinalFromStats("VoidTest", creature, baseBuild);
    const voidStatsFinal = buildFinalFromStats("VoidTest", creature, voidBuild);
    expect(voidStatsFinal.damage).toBeCloseTo(baseStatsFinal.damage * 1.075, 3);
  });

  it("Void stacks twice for damage and movement penalty", () => {
    const creature = baseStats({ damage: 100, walkAndSwimSpeed: 10, sprintSpeed: 10, name: "VoidStack" });
    const finalStats = buildFinalFromStats("VoidStack", creature, {
      ...EMPTY_BUILD_0,
      plushies: ["Void", "Void"],
    });
    expect(finalStats.damage).toBeCloseTo(100 * 1.075 * 1.075, 3);
  });

  it("Chick includes weight penalty", () => {
    const creature = baseStats({ weight: 1000, name: "ChickTest" });
    const finalStats = buildFinalFromStats("ChickTest", creature, {
      ...EMPTY_BUILD_0,
      plushies: ["Chick"],
    });
    expect(finalStats.weight).toBeCloseTo(1000 * 0.925, 3);
  });

  it("Cow gives 10% weight and 5% less damage per plushie, not a doubled single-plushie effect", () => {
    const creature = baseStats({ weight: 1000, damage: 100, name: "CowTest" });
    const oneCow = buildFinalFromStats("CowTest", creature, {
      ...EMPTY_BUILD_0,
      plushies: ["Cow"],
    });
    const twoCows = buildFinalFromStats("CowTest", creature, {
      ...EMPTY_BUILD_0,
      plushies: ["Cow", "Cow"],
    });

    expect(oneCow.weight).toBeCloseTo(1100, 3);
    expect(oneCow.damage).toBeCloseTo(95, 3);
    expect(twoCows.weight).toBeCloseTo(1000 * 1.1 * 1.1, 3);
    expect(twoCows.damage).toBeCloseTo(100 * 0.95 * 0.95, 3);
  });
});
