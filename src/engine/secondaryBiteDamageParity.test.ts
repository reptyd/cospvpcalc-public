// The secondary bite differs from the primary in exactly one way: it applies no
// on-hit ailments. Every damage bonus reaches both. The build path carries them
// as two separate stats, so a new damage source that only writes `damage` is
// silently primary-only - which is how plushies, elders, the Damage trait and
// Two-Faced all came to skip it.
//
// The gate: a creature whose two bites start equal must still have them equal
// after any build. That holds for a flat bonus and a percentage alike, so a
// source added later without touching `damage2` reds here rather than shipping.
import { describe, expect, it } from "vitest";
import { plushieByName } from "./data";
import { baseStats } from "./engine.test.helpers";
import { buildFinalFromStats, EMPTY_BUILD_0 } from "./engineTestFixtures";

const EQUAL_BITES = { damage: 200, damage2: 200 };

function bitesAfter(name: string, build: Partial<typeof EMPTY_BUILD_0>) {
  const creature = baseStats({ ...EQUAL_BITES, name });
  const final = buildFinalFromStats(name, creature, { ...EMPTY_BUILD_0, ...build });
  return { damage: final.damage, damage2: final.damage2 };
}

describe("a damage bonus reaches the secondary bite", () => {
  it("through a percentage plushie", () => {
    plushieByName.SecondaryParityPct = {
      name: "SecondaryParityPct",
      stackRule: "stackable",
      modifiersParsed: [{ stat: "damagePct", op: "addPct", value: 25 }],
    };
    const { damage, damage2 } = bitesAfter("SecondaryPct", {
      plushies: ["SecondaryParityPct", "SecondaryParityPct"],
    });
    expect(damage).toBeCloseTo(200 * 1.25 * 1.25, 5);
    expect(damage2).toBeCloseTo(damage, 5);
  });

  it("through a flat plushie", () => {
    plushieByName.SecondaryParityFlat = {
      name: "SecondaryParityFlat",
      stackRule: "stackable",
      modifiersParsed: [{ stat: "damagePct", op: "addFlat", value: 40 }],
    };
    const { damage, damage2 } = bitesAfter("SecondaryFlat", {
      plushies: ["SecondaryParityFlat"],
    });
    expect(damage).toBeCloseTo(240, 5);
    expect(damage2).toBeCloseTo(damage, 5);
  });

  it("through ascension and the Damage trait", () => {
    const { damage, damage2 } = bitesAfter("SecondaryTrait", {
      venerationStage: 5,
      traits: ["Damage"],
      ascensionAssignments: ["Damage", "Damage", "Damage", "Damage", "Damage"],
    });
    expect(damage).toBeGreaterThan(200);
    expect(damage2).toBeCloseTo(damage, 5);
  });

  it("and a creature with no secondary bite keeps none", () => {
    const creature = baseStats({ damage: 200, name: "SecondaryNone" });
    const final = buildFinalFromStats("SecondaryNone", creature, {
      ...EMPTY_BUILD_0,
      venerationStage: 5,
      traits: ["Damage"],
      ascensionAssignments: ["Damage", "Damage", "Damage", "Damage", "Damage"],
    });
    expect(final.damage).toBeGreaterThan(200);
    expect(final.damage2 ?? 0).toBe(0);
  });
});
