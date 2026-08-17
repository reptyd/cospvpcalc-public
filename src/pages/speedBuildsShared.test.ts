import { describe, expect, it } from "vitest";
import type { BuildOptions, CreatureRuntime } from "../engine/types";
import { evaluateSpeed } from "../speed/speedMath";
import { searchSpeedBuilds } from "../speed/speedSearch";
import { channelRows } from "./speedBuildsShared";

// Sustained and Peak. Every figure the page prints is a pair, and the whole
// difference between the two is which effects were counted, so the checks below
// drive one build twice and read the pair off channelRows.
// [REF:speed_sustained_vs_peak]

const grazer: CreatureRuntime = {
  name: "Test Grazer",
  stats: {
    tier: 3,
    health: 1000,
    weight: 100,
    damage: 100,
    biteCooldown: 1,
    walkAndSwimSpeed: 40,
    sprintSpeed: 100,
    flySpeed: 60,
    turn: 2,
    diet: "Herbivore",
    type: "Flier",
    breath: "N/A",
  } as CreatureRuntime["stats"],
  passiveAbilities: [{ abilityId: "Speed_Blitz", name: "Speed Blitz", value: null, semantics: "neutral", subtype: null }],
  activatedAbilities: [],
  breathAbilities: [],
};

const loadout: BuildOptions = {
  venerationStage: 5,
  traits: ["Speed"],
  ascensionAssignments: ["Speed", "Speed", "Speed", "Speed", "Speed"],
  plushies: ["Chick", "Momo"],
  elder: "Devious",
};

const sustainedOf = (build: BuildOptions) => evaluateSpeed({ creature: grazer, build }).final;
const peakOf = (build: BuildOptions, held: string[]) => evaluateSpeed({ creature: grazer, build, active: held }).final;

describe("sustained and peak", () => {
  it("counts the loadout and Momo's Sugar Rush toward sustained with nothing held", () => {
    const sustained = sustainedOf(loadout);
    const bare = sustainedOf({ ...loadout, plushies: [], traits: [], elder: "None" });
    // Plushie, trait, veneration and elder are all in the figure that is true of
    // the creature whatever it is doing.
    expect(sustained.sprint!).toBeGreaterThan(bare.sprint!);
    // Sugar Rush rides on Momo rather than on the held set, so it is in there
    // too - a flat +1 on fly for a herbivore.
    const withoutMomo = sustainedOf({ ...loadout, plushies: ["Chick"] });
    expect(sustained.fly! - withoutMomo.fly!).toBeCloseTo(1, 10);
  });

  it("leaves peak equal to sustained, and every percentage unchanged, while nothing is held", () => {
    const sustained = sustainedOf(loadout);
    const rows = channelRows(sustainedOf({ ...loadout, plushies: [], traits: [], elder: "None" }), sustained, sustained);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.peak).toBe(row.sustained);
      expect(row.deltaPct).toBe(0);
      expect(row.tone).toBe("flat");
    }
  });

  it("measures the percentage against sustained rather than the creature's printed stat", () => {
    const base = sustainedOf({ ...loadout, plushies: [], traits: [], elder: "None" });
    const sustained = sustainedOf(loadout);
    const peak = peakOf(loadout, ["speed_blitz"]);
    const sprint = channelRows(base, sustained, peak).find((row) => row.channel === "sprint")!;

    // The printed stat is carried, and it is not the baseline: the loadout has
    // already moved sustained away from it.
    expect(sprint.raw).toBe(base.sprint);
    expect(sprint.sustained).not.toBe(sprint.raw);
    expect(sprint.deltaPct).toBeCloseTo(((sprint.peak - sprint.sustained) / sprint.sustained) * 100, 10);
    expect(sprint.deltaPct).not.toBeCloseTo(((sprint.peak - sprint.raw) / sprint.raw) * 100, 6);
    // Speed Blitz is +25%, and it only reaches peak.
    expect(sprint.peak / sprint.sustained).toBeCloseTo(1.25, 10);
  });

  it("orders the ranking on peak while something is held, and on sustained otherwise", () => {
    // Bear is the discriminator: it pays nothing of its own and lifts Cower by a
    // further tenth, so it can only win a slot in a ranking that counts a held
    // effect.
    const cowering: CreatureRuntime = { ...grazer, stats: { ...grazer.stats } };
    const held = searchSpeedBuilds({ creature: cowering, target: "sprint", active: ["posture_cower"], limit: 1 });
    const bare = searchSpeedBuilds({ creature: cowering, target: "sprint", limit: 1 });
    expect(held.candidates[0].build.plushies).toContain("Bear");
    expect(bare.candidates[0].build.plushies).not.toContain("Bear");
  });
});
