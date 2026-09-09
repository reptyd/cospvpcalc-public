import { describe, expect, it } from "vitest";
import { effectsCatalog, plushieByName } from "./data";
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

  it("Cow gives 10% weight and 5% less damage per plushie, not a doubled single-plushie effect [REF:plushie_cow]", () => {
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

  it("Momo changes no combat stat [REF:plushie_momo]", () => {
    const creature = baseStats({ weight: 1000, damage: 100, name: "MomoTest" });
    const bare = buildFinalFromStats("MomoTest", creature, EMPTY_BUILD_0);
    const worn = buildFinalFromStats("MomoTest", creature, { ...EMPTY_BUILD_0, plushies: ["Momo"] });

    // Its Sugar Rush grant is flight speed and glide regen, neither of which a
    // fight reads.
    expect(worn.weight).toBe(bare.weight);
    expect(worn.damage).toBe(bare.damage);
    expect(worn.health).toBe(bare.health);
  });

  it("Agile Swimmer deepens the oxygen pool [REF:ability_agile_swimmer]", () => {
    effectsCatalog.AgileTest = { specialAbilities: [{ name: "Agile Swimmer" }] } as never;
    const creature = baseStats({ oxygenTime: 60, name: "AgileTest" });
    const plain = baseStats({ oxygenTime: 60, name: "PlainTest" });

    expect(buildFinalFromStats("AgileTest", creature).oxygenTime).toBe(105);
    expect(buildFinalFromStats("PlainTest", plain).oxygenTime).toBe(60);
  });

  it("Aerodon slows thirst and Euvatops hunger, each on its own meter [REF:plushie_aerodon] [REF:plushie_euvatops]", () => {
    const creature = baseStats({ name: "AppetiteTest" });
    const thirst = buildFinalFromStats("AppetiteTest", creature, { ...EMPTY_BUILD_0, plushies: ["Aerodon"] });
    const hunger = buildFinalFromStats("AppetiteTest", creature, { ...EMPTY_BUILD_0, plushies: ["Euvatops"] });
    const both = buildFinalFromStats("AppetiteTest", creature, { ...EMPTY_BUILD_0, plushies: ["Aerodon", "Euvatops"] });

    // The wiki files both under one appetite channel; the game splits them, so
    // wearing both slows each meter once rather than either one twice.
    expect(thirst.thirstDrainPct).toBe(-15);
    expect(thirst.hungerDrainPct).toBeUndefined();
    expect(hunger.hungerDrainPct).toBe(-15);
    expect(hunger.thirstDrainPct).toBeUndefined();
    expect(both.hungerDrainPct).toBe(-15);
    expect(both.thirstDrainPct).toBe(-15);
  });

  it("Frost Dragon slows appetite drain alongside its Frostbite block [REF:plushie_frost_dragon]", () => {
    const creature = baseStats({ name: "FrostDragonTest" });
    const worn = buildFinalFromStats("FrostDragonTest", creature, { ...EMPTY_BUILD_0, plushies: ["Frost Dragon"] });

    expect(worn.hungerDrainPct).toBe(-5);
    expect(worn.thirstDrainPct).toBe(-5);
    expect(worn.plushieStatusBlockPct?.Frostbite_Status).toBe(25);
  });

  it("Palmtree widens the appetite pool without touching drain [REF:plushie_palmtree]", () => {
    const creature = baseStats({ name: "PalmtreeTest" });
    const worn = buildFinalFromStats("PalmtreeTest", creature, { ...EMPTY_BUILD_0, plushies: ["Palmtree"] });

    expect(worn.appetiteCapacityPct).toBe(10);
    expect(worn.hungerDrainPct).toBeUndefined();
    expect(worn.thirstDrainPct).toBeUndefined();
  });

  it("Seal widens the moisture pool, and only where there is one [REF:plushie_seal]", () => {
    const wet = baseStats({ moistureTime: 200, name: "SealWetTest" });
    const dry = baseStats({ name: "SealDryTest" });

    expect(buildFinalFromStats("SealWetTest", wet, { ...EMPTY_BUILD_0, plushies: ["Seal"] }).moistureTime)
      .toBeCloseTo(230, 3);
    expect(buildFinalFromStats("SealDryTest", dry, { ...EMPTY_BUILD_0, plushies: ["Seal"] }).moistureTime)
      .toBeUndefined();
  });

  it("Oceanwing carries a Muddy lift that adds up per copy [REF:plushie_oceanwing]", () => {
    // The plushie grants nothing on its own - the number it carries is a
    // percentage of Muddy's own regen bonus, read by the Rust regen tick.
    const creature = baseStats({ name: "OceanwingTest" });
    const none = buildFinalFromStats("OceanwingTest", creature, { ...EMPTY_BUILD_0 });
    const one = buildFinalFromStats("OceanwingTest", creature, {
      ...EMPTY_BUILD_0,
      plushies: ["Oceanwing"],
    });
    const two = buildFinalFromStats("OceanwingTest", creature, {
      ...EMPTY_BUILD_0,
      plushies: ["Oceanwing", "Oceanwing"],
    });

    expect(none.muddyStrengthBoostPct).toBeUndefined();
    expect(one.muddyStrengthBoostPct).toBe(50);
    expect(two.muddyStrengthBoostPct).toBe(100);
  });

  it("Sky lightens the wearer by 10% [REF:plushie_sky]", () => {
    const creature = baseStats({ weight: 1000, name: "SkyTest" });
    const one = buildFinalFromStats("SkyTest", creature, { ...EMPTY_BUILD_0, plushies: ["Sky"] });
    const two = buildFinalFromStats("SkyTest", creature, { ...EMPTY_BUILD_0, plushies: ["Sky", "Sky"] });

    expect(one.weight).toBeCloseTo(900, 3);
    expect(two.weight).toBeCloseTo(1000 * 0.9 * 0.9, 3);
  });
});
