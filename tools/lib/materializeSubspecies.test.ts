import { describe, expect, it } from "vitest";
import { CreatureRoster, type CreatureRuntime } from "./creatureRoster";
import { parseEarlyChanges } from "./earlyChangeParser";
import { applyDeltasToExisting, materializeSubspecies } from "./materializeSubspecies";
import { upsertCreature, type CreaturesFile } from "./creaturesFile";

function ability(name: string, value: number | string | null = null, semantics = "neutral") {
  return { abilityId: name.replace(/\s+/g, "_"), name, value, semantics, subtype: null };
}

const base: CreatureRuntime = {
  name: "Meorlark",
  stats: { weight: 5600, damage: 475, healthRegen: 5 },
  passiveAbilities: [ability("Block Frostbite", 0.35, "block"), ability("Old Thing")],
  activatedAbilities: [ability("Charge Throw")],
  breathAbilities: [],
};
const roster = new CreatureRoster([base]);

describe("materializeSubspecies", () => {
  const parsed = parseEarlyChanges(
    `Icebreaker Meorlark\nWeight from 5600 to 6000\nBlockFrostbite from 35 to 50\nRemoval of Old Thing\nAddition of Lance Frostbite`,
  );
  const { creature, warnings } = materializeSubspecies(parsed.creatures[0], base, roster);

  it("renames the clone", () => {
    expect(creature.name).toBe("Icebreaker Meorlark");
  });

  it("applies a stat delta", () => {
    expect(creature.stats.weight).toBe(6000);
    expect(creature.stats.damage).toBe(475);
  });

  it("value-changes an existing ability in place", () => {
    const block = creature.passiveAbilities.find((a) => a.name === "Block Frostbite");
    expect(block?.value).toBe(0.5); // 50% -> runtime fraction
  });

  it("removes an ability", () => {
    const all = [...creature.passiveAbilities, ...creature.activatedAbilities, ...creature.breathAbilities];
    expect(all.some((a) => a.name === "Old Thing")).toBe(false);
  });

  it("adds a new ability and warns about its unknown category", () => {
    expect(creature.passiveAbilities.some((a) => a.name === "Lance Frostbite")).toBe(true);
    expect(warnings.join(" ")).toMatch(/Lance Frostbite/);
  });

  it("does not mutate the base creature", () => {
    expect(base.stats.weight).toBe(5600);
    expect(base.passiveAbilities.some((a) => a.name === "Old Thing")).toBe(true);
  });
});

describe("applyDeltasToExisting", () => {
  it("folds deltas into the existing entry without renaming it", () => {
    const parsed = parseEarlyChanges(`Meorlark\nWeight from 5600 to 6000\nBlockFrostbite from 35 to 50`);
    const result = applyDeltasToExisting(parsed.creatures[0], base, roster);
    expect(result).not.toBeNull();
    expect(result?.creature.name).toBe("Meorlark");
    expect(result?.creature.stats.weight).toBe(6000);
    expect(result?.creature.passiveAbilities.find((a) => a.name === "Block Frostbite")?.value).toBe(0.5);
    expect(base.stats.weight).toBe(5600);
  });

  it("returns null when every delta is already in place", () => {
    const parsed = parseEarlyChanges(`Meorlark\nWeight from 5600 to 5600\nBlockFrostbite from 35 to 35`);
    expect(applyDeltasToExisting(parsed.creatures[0], base, roster)).toBeNull();
  });
});

describe("creatureRoster.subspeciesBaseOf", () => {
  it("resolves a subspecies to its base", () => {
    expect(roster.subspeciesBaseOf("Icebreaker Meorlark")).toBe("Meorlark");
    expect(roster.subspeciesBaseOf("Meorlark")).toBeNull();
  });
});

describe("upsertCreature", () => {
  it("adds a new creature, replaces an existing one", () => {
    const data: CreaturesFile = { creatures: [{ ...base }] };
    expect(upsertCreature(data, { ...base, name: "Icebreaker Meorlark" })).toBe("added");
    expect(data.creatures).toHaveLength(2);
    expect(upsertCreature(data, { ...base, stats: { ...base.stats, weight: 1 } })).toBe("replaced");
    expect(data.creatures.find((c) => c.name === "Meorlark")?.stats.weight).toBe(1);
  });
});
