import { describe, expect, it } from "vitest";
import { creaturesData } from "./creatureData";
import { creatureIsAquatic, getCreatureMeters } from "./compareMeters";
import type { CreatureRuntime, CreatureStats } from "./types";

function creature(stats: Partial<CreatureStats>): CreatureRuntime {
  return { name: "Fixture", stats: stats as CreatureStats };
}

describe("meter ownership", () => {
  it("takes both meters away from nobody", () => {
    expect(getCreatureMeters(creature({ diet: "Carnivore" }))).toEqual({ hunger: true, thirst: true });
    expect(getCreatureMeters(creature({ diet: "Photovore" }))).toEqual({ hunger: false, thirst: true });
    expect(getCreatureMeters(creature({ diet: "Photocarnivore" }))).toEqual({ hunger: true, thirst: false });
    expect(getCreatureMeters(creature({ diet: "Carnivore", beachSpeed: 25 }))).toEqual({ hunger: true, thirst: false });
  });

  it("reads aquatic off beached speed, not the wiki type", () => {
    // A sky-aquatic: the wiki types it as a Flier, and only the beached speed
    // gives it away.
    expect(creatureIsAquatic({ type: "Flier", beachSpeed: 22 } as CreatureStats)).toBe(true);
    expect(creatureIsAquatic({ type: "Flier" } as CreatureStats)).toBe(false);
    expect(creatureIsAquatic({ type: "Terrestrial" } as CreatureStats)).toBe(false);
    expect(creatureIsAquatic(undefined)).toBe(false);
  });

  it("survives a creature with no stats at all", () => {
    expect(getCreatureMeters(undefined)).toEqual({ hunger: true, thirst: true });
    expect(getCreatureMeters({ name: "Bare" } as CreatureRuntime)).toEqual({ hunger: true, thirst: true });
  });
});

describe("meter ownership over the live roster", () => {
  it("classifies every wiki aquatic as aquatic, and then some", () => {
    const typedAquatic = creaturesData.filter((c) => c.stats?.type === "Aquatic");
    expect(typedAquatic.length).toBeGreaterThan(0);
    for (const c of typedAquatic) {
      expect(creatureIsAquatic(c.stats), `${c.name} is typed Aquatic but has no beached speed`).toBe(true);
    }
    // The sky-aquatics are the "and then some": aquatic by beached speed while
    // the wiki types them as fliers. If this class ever empties, the rule has
    // collapsed back onto `type` and the nine of them have thirst again.
    const skyAquatic = creaturesData.filter((c) => creatureIsAquatic(c.stats) && c.stats?.type !== "Aquatic");
    expect(skyAquatic.length).toBeGreaterThan(0);
    for (const c of skyAquatic) {
      expect(getCreatureMeters(c).thirst, `${c.name} is a sky-aquatic and should have no thirst`).toBe(false);
    }
  });

  it("leaves every creature at least one meter", () => {
    for (const c of creaturesData) {
      const meters = getCreatureMeters(c);
      expect(meters.hunger || meters.thirst, `${c.name} has neither meter`).toBe(true);
    }
  });

  it("sizes both meters from the same appetite number", () => {
    for (const c of creaturesData) {
      expect(typeof c.stats?.appetite, `${c.name} has no appetite`).toBe("number");
      expect(c.stats.appetite).toBeGreaterThan(0);
    }
  });
});
