import { describe, expect, it } from "vitest";
import type { BuildOptions } from "../engine";
import {
  buildSkeletonsFromCandidates,
  containsSkeleton,
  scoreResult,
  selectSkeletonsForStage1,
  selectStage2Skeletons,
} from "./optimizerTestApi";

function build(
  traits: string[],
  plushies: string[],
  preScore: number,
  ascensionAssignments: string[] = ["", "", "", "", ""],
): { build: BuildOptions; activesOn: boolean; breathOn: boolean; preScore: number } {
  return {
    build: {
      venerationStage: 5,
      traits,
      ascensionAssignments,
      plushies,
    },
    activesOn: true,
    breathOn: true,
    preScore,
  };
}

function makeSummary(
  winner: "A" | "B" | "Draw",
  ttkAtoB: number,
  ttkBtoA: number,
  damageA: number,
): any {
  return {
    winner,
    ttkAtoB,
    ttkBtoA,
    damageDealtAAtBDeath: damageA,
    damageDealtA: damageA,
    damageDealtBAtADeath: 10,
    damageDealtB: 10,
    extendedDamagePotentialA: 0,
    extendedDamagePotentialB: 0,
  };
}

function skeletonToBuild(skeleton: {
  traits: string[];
  plushies: string[];
  venerationStage: number;
  ascensionAssignments?: string[];
}): BuildOptions {
  return {
    venerationStage: skeleton.venerationStage,
    traits: skeleton.traits,
    plushies: skeleton.plushies,
    ascensionAssignments: skeleton.ascensionAssignments ?? ["", "", "", "", ""],
  };
}

describe("stage selection e2e", () => {
  it("keeps the strongest stage1 candidate in stage2", () => {
    const skeletons = buildSkeletonsFromCandidates([
      build(["Damage", "Weight"], ["Void", "Void"], 8),
      build(["Health", "Weight"], ["Ice Wolf", "Void"], 7),
      build(["Bite", "Damage"], ["Pig-Lantern", "Void"], 6),
    ]);
    const stage1 = selectSkeletonsForStage1(skeletons, 3, true);
    const quickEvaluated = stage1.map((skeleton) => {
      const summary =
        skeleton.traits.includes("Damage") && skeleton.plushies.includes("Void") && skeleton.plushies[1] === "Void"
          ? makeSummary("A", 5, 30, 200)
          : makeSummary("A", 8, 20, 120);
      return { skeleton, bestBuild: skeletonToBuild(skeleton), score: scoreResult(summary, "A") };
    });
    const stage2 = selectStage2Skeletons(quickEvaluated, 1);

    expect(stage2.length).toBeGreaterThanOrEqual(1);
    expect(
      containsSkeleton(stage2, {
        traits: ["Damage", "Weight"],
        plushies: ["Void", "Void"],
        activesOn: true,
        breathOn: true,
        stage: 5,
      }),
    ).toBe(true);
  });

  it("does not drop the top preScore candidate during stage1 diversification", () => {
    const skeletons = buildSkeletonsFromCandidates([
      build(["Damage", "Weight"], ["Void", "Void"], 100),
      build(["Health", "Weight"], ["Ice Wolf", "Void"], 80),
      build(["Bite", "Damage"], ["Pig-Lantern", "Void"], 70),
      build(["Health", "Bite"], ["Bunny", "Void"], 60),
    ]);
    const stage1 = selectSkeletonsForStage1(skeletons, 2, true);

    expect(
      containsSkeleton(stage1.map((skeleton) => ({ skeleton })), {
        traits: ["Damage", "Weight"],
        plushies: ["Void", "Void"],
        activesOn: true,
        breathOn: true,
        stage: 5,
      }),
    ).toBe(true);
  });

  it("preserves locked-ascension skeleton identity through stage1->stage2", () => {
    const fullDamage = ["Damage", "Damage", "Damage", "Damage", "Damage"];
    const fullWeight = ["Weight", "Weight", "Weight", "Weight", "Weight"];
    const skeletons = buildSkeletonsFromCandidates([
      build(["Damage", "Weight"], ["Void", "Void"], 10, fullDamage),
      build(["Damage", "Weight"], ["Void", "Void"], 9, fullWeight),
    ]);

    expect(skeletons.length).toBe(2);

    const stage1 = selectSkeletonsForStage1(skeletons, 2, false);
    const quickEvaluated = stage1.map((skeleton) => {
      const isDamageSplit = skeleton.ascensionAssignments?.join(",") === fullDamage.join(",");
      const summary = isDamageSplit ? makeSummary("A", 6, 30, 170) : makeSummary("A", 9, 18, 120);
      return { skeleton, bestBuild: skeletonToBuild(skeleton), score: scoreResult(summary, "A") };
    });
    const stage2 = selectStage2Skeletons(quickEvaluated, 1);

    expect(stage2[0].skeleton.ascensionAssignments).toEqual(fullDamage);
  });
});
