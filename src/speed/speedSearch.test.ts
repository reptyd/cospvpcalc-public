import { describe, expect, it } from "vitest";
import type { BuildOptions, CreatureRuntime, ElderVariant } from "../engine/types";
import { plushies } from "../engine/buildData";
import { SPEED_EFFECTS } from "./speedEffects";
import { evaluateSpeed } from "./speedMath";
import {
  optimizableChannels,
  plushiePairs,
  searchSpeedBuilds,
  SPEED_RELEVANT_PLUSHIES,
  SPEED_RELEVANT_TRAITS,
} from "./speedSearch";

const flier: CreatureRuntime = {
  name: "Test Flier",
  stats: {
    tier: 3,
    health: 1000,
    weight: 1000,
    damage: 100,
    biteCooldown: 1,
    stamina: 100,
    walkAndSwimSpeed: 30,
    sprintSpeed: 100,
    turn: 2,
    diet: "Carnivore",
    type: "Flier",
    breath: "N/A",
    flySpeed: 60,
    flySprintMultiplier: 1.5,
    takeoffMultiplier: 4,
  } as CreatureRuntime["stats"],
  passiveAbilities: [],
  activatedAbilities: [],
  breathAbilities: [],
};

const ambusher: CreatureRuntime = { ...flier, stats: { ...flier.stats, ambush: 1.3 } };

describe("speed search", () => {
  it("enumerates every unordered slot pair including empties and doubles", () => {
    const pairs = plushiePairs(["A", "B", "C"]);
    expect(pairs).toHaveLength(10);
    expect(pairs).toContainEqual([]);
    expect(pairs).toContainEqual(["A"]);
    expect(pairs).toContainEqual(["A", "A"]);
    expect(pairs).toContainEqual(["A", "B"]);
    expect(pairs.filter((p) => p.join("|") === "B|A")).toHaveLength(0);
  });

  it("puts the Speed trait and the speed elder on the winning sprint build", () => {
    const { candidates } = searchSpeedBuilds({ creature: flier, target: "sprint", limit: 1 });
    const best = candidates[0];
    expect(best.build.traits).toEqual(["Speed"]);
    expect(best.build.elder).toBe("Devious");
    expect(best.value).toBeGreaterThan(100);
  });

  it("finds the doubled plushie rather than two different ones", () => {
    const { candidates } = searchSpeedBuilds({ creature: flier, target: "sprint", limit: 1 });
    const [first, second] = candidates[0].build.plushies;
    expect(first).toBe(second);
  });

  it("respects an excluded plushie", () => {
    const open = searchSpeedBuilds({ creature: flier, target: "sprint", limit: 1 });
    const banned = open.candidates[0].build.plushies[0];
    const closed = searchSpeedBuilds({ creature: flier, target: "sprint", excludedPlushies: [banned], limit: 1 });
    expect(closed.candidates[0].build.plushies).not.toContain(banned);
    expect(closed.candidates[0].value).toBeLessThan(open.candidates[0].value);
  });

  it("carries a required plushie in every ranked build", () => {
    // Knox is walk-only, so a sprint ranking would never pick it on its own -
    // which makes it the honest test that the requirement is what put it there.
    const open = searchSpeedBuilds({ creature: flier, target: "sprint", limit: 10 });
    expect(open.candidates.some((candidate) => !candidate.build.plushies.includes("Knox"))).toBe(true);

    const forced = searchSpeedBuilds({ creature: flier, target: "sprint", requiredPlushies: ["Knox"], limit: 10 });
    expect(forced.candidates.length).toBeGreaterThan(0);
    for (const candidate of forced.candidates) expect(candidate.build.plushies).toContain("Knox");
    expect(forced.evaluated).toBeLessThan(open.evaluated);
    expect(forced.candidates[0].value).toBeLessThanOrEqual(open.candidates[0].value);
  });

  it("pins both slots when both are named", () => {
    const both = searchSpeedBuilds({
      creature: flier,
      target: "sprint",
      requiredPlushies: ["Knox", "Chick"],
      limit: 10,
    });
    expect(both.candidates.length).toBeGreaterThan(0);
    for (const candidate of both.candidates) {
      expect(candidate.build.plushies).toContain("Knox");
      expect(candidate.build.plushies).toContain("Chick");
    }

    // The same name twice leaves exactly the pair holding two of it.
    const twice = searchSpeedBuilds({
      creature: flier,
      target: "sprint",
      requiredPlushies: ["Chick", "Chick"],
      limit: 10,
    });
    for (const candidate of twice.candidates) {
      expect(candidate.build.plushies.filter((name) => name === "Chick")).toHaveLength(2);
    }
  });

  it("honours a pinned elder", () => {
    const { candidates } = searchSpeedBuilds({ creature: flier, target: "sprint", lockedElder: "Powerful", limit: 3 });
    for (const candidate of candidates) expect(candidate.build.elder).toBe("Powerful");
  });

  it("returns nothing for a channel the creature does not have", () => {
    const grounded: CreatureRuntime = { ...flier, stats: { ...flier.stats, flySpeed: undefined } };
    const { candidates, evaluated } = searchSpeedBuilds({ creature: grounded, target: "fly" });
    expect(candidates).toHaveLength(0);
    expect(evaluated).toBeGreaterThan(0);
  });

  it("sweeps every plushie pair that can move a channel, and nothing else", () => {
    const { evaluated } = searchSpeedBuilds({ creature: flier, target: "sprint" });
    // Elder and trait are chosen up front rather than enumerated, so the sweep is
    // exactly the plushie pairs. Derived from the live list: a speed plushie
    // added tomorrow must widen it, and a frozen count would read that as a
    // regression.
    expect(evaluated).toBe(plushiePairs(SPEED_RELEVANT_PLUSHIES).length);
  });

  it("leaves the inert plushies out of the sweep entirely", () => {
    // The roster is 83; only a handful move a movement channel. Sweeping the rest
    // produced rankings whose rows differed only in a slot the result could not
    // see.
    expect(SPEED_RELEVANT_PLUSHIES.length).toBeLessThan(plushies.length / 4);
    expect(SPEED_RELEVANT_PLUSHIES).toContain("Bear");
  });

  it("does not offer a channel no effect can move", () => {
    expect(optimizableChannels().has("turn")).toBe(false);
    expect(optimizableChannels().has("sprint")).toBe(true);
  });

  it("ranks ambush but never the multiplier behind it", () => {
    expect(optimizableChannels().has("ambush")).toBe(true);
    expect(optimizableChannels().has("ambushFactor")).toBe(false);
  });

  it("sweeps Bunny, and lets it win an ambush ranking [REF:plushie_bunny]", () => {
    expect(SPEED_RELEVANT_PLUSHIES).toContain("Bunny");
    const { candidates } = searchSpeedBuilds({ creature: ambusher, target: "ambush", limit: 1 });
    // Bunny pays 7.5% against Chick's 5%, and both slots take a copy.
    expect(candidates[0].build.plushies).toEqual(["Bunny", "Bunny"]);
  });

  it("drops Bunny into the slot a sprint ranking left empty", () => {
    const { candidates } = searchSpeedBuilds({ creature: ambusher, target: "sprint", limit: 10 });
    const spare = candidates.filter((candidate) => candidate.build.plushies.includes("Bunny"));
    expect(spare.length).toBeGreaterThan(0);
    // It rides along, never in front: every row still carries two slots, and the
    // sprint figure is whatever the row scored without it.
    for (const candidate of candidates) expect(candidate.build.plushies).toHaveLength(2);
    const withoutBunny = searchSpeedBuilds({
      creature: ambusher,
      target: "sprint",
      excludedPlushies: ["Bunny"],
      limit: 10,
    });
    for (const [index, candidate] of candidates.entries()) {
      expect(candidate.value).toBeCloseTo(withoutBunny.candidates[index].value, 10);
    }
  });

  it("leaves the spare slot alone on the ranking Bunny would re-price", () => {
    // Ambush is the one channel Bunny moves, so filling a row there would
    // change the figure it was sorted on: a row holding one Bunny became a
    // second copy of the two-Bunny winner, out of order and duplicated.
    const { candidates } = searchSpeedBuilds({ creature: ambusher, target: "ambush", limit: 12 });
    const builds = candidates.map((candidate) => [...candidate.build.plushies].sort().join("+"));
    expect(new Set(builds).size).toBe(builds.length);
    for (let i = 1; i < candidates.length; i += 1) {
      expect(candidates[i - 1].value).toBeGreaterThanOrEqual(candidates[i].value - 1e-9);
    }
  });

  it("keeps Bunny out of the spare slot when it would do nothing or is not wanted", () => {
    // No ambush multiplier to lift.
    const grounded = searchSpeedBuilds({ creature: flier, target: "sprint", limit: 10 });
    for (const candidate of grounded.candidates) expect(candidate.build.plushies).not.toContain("Bunny");

    // Excluded by the reader.
    const refused = searchSpeedBuilds({
      creature: ambusher,
      target: "sprint",
      excludedPlushies: ["Bunny"],
      limit: 10,
    });
    for (const candidate of refused.candidates) expect(candidate.build.plushies).not.toContain("Bunny");
  });

  it("returns nothing when the creature carries no ambush multiplier", () => {
    const { candidates, evaluated } = searchSpeedBuilds({ creature: flier, target: "ambush" });
    expect(candidates).toHaveLength(0);
    expect(evaluated).toBeGreaterThan(0);
  });

  // Elder and Trait Choice. [REF:speed_sweep_elder_and_trait]
  it("fixes one elder and one trait loadout for the whole sweep", () => {
    const { candidates } = searchSpeedBuilds({ creature: flier, target: "sprint", limit: 25 });
    expect(candidates.length).toBeGreaterThan(1);
    for (const candidate of candidates) {
      expect(candidate.build.elder).toBe(candidates[0].build.elder);
      expect(candidate.build.traits).toEqual(candidates[0].build.traits);
    }
  });

  it("puts the elder's speed bonus on walk, sprint and fly, and only Devious raises it [REF:speed_sweep_elder_and_trait]", () => {
    const bare: BuildOptions = {
      venerationStage: 0,
      traits: [],
      ascensionAssignments: ["", "", "", "", ""],
      plushies: [],
      elder: "None",
    };
    const none = evaluateSpeed({ creature: flier, build: bare }).final;
    const factorOf = (elder: ElderVariant) => {
      const final = evaluateSpeed({ creature: flier, build: { ...bare, elder } }).final;
      return { speed: final.speed! / none.speed!, sprint: final.sprint! / none.sprint!, fly: final.fly! / none.fly!, turn: final.turn! / none.turn! };
    };
    const devious = factorOf("Devious");
    expect(devious.speed).toBeCloseTo(1.075, 10);
    expect(devious.sprint).toBeCloseTo(1.075, 10);
    expect(devious.fly).toBeCloseTo(1.075, 10);
    // Three channels, not four: the bonus never reaches turning.
    expect(devious.turn).toBe(1);

    expect(factorOf("Powerful").sprint).toBeCloseTo(0.95, 10);
    expect(factorOf("Gentle").sprint).toBe(1);

    // Measured, not named: the sweep lands on the one elder that raises speed.
    expect(searchSpeedBuilds({ creature: flier, target: "sprint", limit: 1 }).candidates[0].build.elder).toBe("Devious");
  });

  it("skips the measurement for a pinned elder or a pinned trait loadout [REF:speed_sweep_elder_and_trait]", () => {
    const pinned = searchSpeedBuilds({
      creature: flier,
      target: "sprint",
      lockedElder: "Powerful",
      lockedTraits: ["Health"],
      limit: 3,
    });
    expect(pinned.candidates.length).toBeGreaterThan(0);
    for (const candidate of pinned.candidates) {
      expect(candidate.build.elder).toBe("Powerful");
      expect(candidate.build.traits).toEqual(["Health"]);
    }
    // Pinning the worse choice costs speed, which is what proves the unpinned
    // run measured rather than defaulted.
    const open = searchSpeedBuilds({ creature: flier, target: "sprint", limit: 1 });
    expect(pinned.candidates[0].value).toBeLessThan(open.candidates[0].value);
  });

  it("finds exactly one trait that moves a movement channel [REF:speed_sweep_elder_and_trait]", () => {
    expect(SPEED_RELEVANT_TRAITS).toEqual(["Speed"]);
    expect(SPEED_EFFECTS.filter((effect) => effect.trait)).toHaveLength(1);
  });

  // Plushie Shortlist. [REF:speed_sweep_plushie_shortlist]
  it("sweeps exactly the plushies an effect names, plus Bear", () => {
    const named = new Set(SPEED_EFFECTS.map((effect) => effect.plushie).filter(Boolean));
    expect([...SPEED_RELEVANT_PLUSHIES].sort()).toEqual([...named, "Bear"].sort());
  });

  it("drops a build a smaller one already matches, and keeps a tie that is not a subset [REF:speed_sweep_plushie_shortlist]", () => {
    const { candidates, evaluated } = searchSpeedBuilds({ creature: flier, target: "speed", limit: 200 });
    expect(candidates.length).toBeLessThan(evaluated);
    const key = (build: BuildOptions) => [...build.plushies].sort().join("|");
    for (const candidate of candidates) {
      const inner = candidates.filter(
        (other) =>
          other !== candidate &&
          Math.abs(other.value - candidate.value) < 1e-9 &&
          other.build.plushies.length < candidate.build.plushies.length,
      );
      for (const earlier of inner) {
        const remaining = [...candidate.build.plushies];
        const covered = earlier.build.plushies.every((name) => {
          const at = remaining.indexOf(name);
          if (at < 0) return false;
          remaining.splice(at, 1);
          return true;
        });
        expect(covered, `${key(candidate.build)} repeats ${key(earlier.build)} at the same value`).toBe(false);
      }
    }
    // Mylo and Succulant are both a flat 2.5% on every channel, so neither is a
    // subset of the other and the ranking is right to carry both.
    const values = new Map(candidates.map((c) => [key(c.build), c.value]));
    expect(values.has("Mylo")).toBe(true);
    expect(values.has("Succulant")).toBe(true);
    expect(values.get("Mylo")).toBeCloseTo(values.get("Succulant")!, 10);
  });

  it("splits the veneration budget between two locked traits", () => {
    const locked = { creature: flier, target: "sprint" as const, lockedTraits: ["Speed", "Health"], limit: 1 };
    const unsplit = searchSpeedBuilds(locked);
    const split = searchSpeedBuilds({ ...locked, lockedAscension: ["Speed", "Speed", "Health", "Health", "Health"] });
    const soleTrait = searchSpeedBuilds({ creature: flier, target: "sprint", lockedTraits: ["Speed"], limit: 1 });

    expect(split.candidates[0].value).toBeGreaterThan(unsplit.candidates[0].value);
    expect(split.candidates[0].value).toBeLessThan(soleTrait.candidates[0].value);
  });
});
