import { describe, expect, it } from "vitest";
import type { BuildOptions } from "../engine";
import { preScoreBuild, objectiveBuildFit } from "./candidateGenerationScoring";
import { selectCandidateTraitIds } from "./candidateGenerationInputs";

// Regression guard for the survival pre-score. The candidate-generation
// pre-score is a coarse heuristic that decides which builds even get simulated
// (top-K by pre-score). A win/damage-shaped score gives a regen-tank near zero
// or below: its HP-regen plushies (Heart = +30% HP regen) count for nothing in
// the offence and lexicographic scorers, and the weight penalty still counts
// against it - so the build is pruned before it is ever simulated and the
// survival objective returns a strictly worse one. The "survival" branch is
// what keeps it.

const tankBuild: BuildOptions = {
  venerationStage: 5,
  traits: ["Health", "Weight"],
  ascensionAssignments: ["Health", "Health", "Health", "Health", "Health"],
  plushies: ["Heart", "Heart"],
  elder: "Gentle",
};

const cannonBuild: BuildOptions = {
  venerationStage: 5,
  traits: ["Damage", "Bite"],
  ascensionAssignments: ["Damage", "Damage", "Damage", "Damage", "Damage"],
  plushies: ["Ice Wolf", "Void"],
  elder: "Powerful",
};

describe("preScoreBuild — survival goal", () => {
  it("ranks a regen-tank above a glass cannon for survival", () => {
    const tank = preScoreBuild(tankBuild, "survival");
    const cannon = preScoreBuild(cannonBuild, "survival");
    expect(tank).toBeGreaterThan(cannon);
  });

  it("gives the regen-tank a clearly positive survival pre-score (regen is counted)", () => {
    // Before the fix the Heart/Heart tank scored ~0 or negative (HP-regen
    // ignored, weight penalty applied) and got pruned. It must now be safely
    // positive so it survives the top-K candidate filter.
    expect(preScoreBuild(tankBuild, "survival")).toBeGreaterThan(0);
  });

  it("still favours the glass cannon for the dps goal (ordering is goal-specific)", () => {
    const tank = preScoreBuild(tankBuild, "dps");
    const cannon = preScoreBuild(cannonBuild, "dps");
    expect(cannon).toBeGreaterThan(tank);
  });
});

describe("selectCandidateTraitIds — Health-trait pruning disabled", () => {
  // All four stat traits are always offered, and the real simulation plus the
  // objective-fit-tiebroken ranking decides between them. Dropping the Health
  // trait in candidate generation, before any build using it is simulated, is
  // what would stop a Health-trait tank from ever being surfaced. Health is not
  // excluded for a damage objective either; it loses its ties there.
  it("always offers all four stat traits including Health", () => {
    expect(selectCandidateTraitIds()).toEqual(expect.arrayContaining(["Damage", "Bite", "Weight", "Health"]));
  });
});

describe("objectiveBuildFit — deterministic tie-break by objective", () => {
  // When builds tie on the objective's combat metric (common, because kill
  // time is quantised by bite count), this fit decides - so the OFFENCE build
  // wins a DPS/TTK tie and the REGEN build wins a survival tie, instead of the
  // Health=regen trait winning every objective's ties via its survival edge.
  it("ranks the offence build above the regen build for avgDps and avgTtk", () => {
    expect(objectiveBuildFit(cannonBuild, "avgDps")).toBeGreaterThan(objectiveBuildFit(tankBuild, "avgDps"));
    expect(objectiveBuildFit(cannonBuild, "avgTtk")).toBeGreaterThan(objectiveBuildFit(tankBuild, "avgTtk"));
    expect(objectiveBuildFit(cannonBuild, "immortalDamage")).toBeGreaterThan(objectiveBuildFit(tankBuild, "immortalDamage"));
  });

  it("ranks the offence build above the regen build for winRate (the forgotten tie-break)", () => {
    // winRate mapped to the flat "lexicographic" pre-score, which weighted the
    // Health trait identically to Damage/Bite - so an (often un-leveled) Health
    // pick rode win-rate ties. Offence must now win the tie like dps/ttk do.
    expect(objectiveBuildFit(cannonBuild, "winRate")).toBeGreaterThan(objectiveBuildFit(tankBuild, "winRate"));
  });

  it("ranks the regen build above the offence build for survival", () => {
    expect(objectiveBuildFit(tankBuild, "survival")).toBeGreaterThan(objectiveBuildFit(cannonBuild, "survival"));
  });
});
