import { describe, expect, it } from "vitest";
import type { BuildOptions } from "../engine";
import type { BestBuildAggregate } from "./ranking";
import type { BestBuildAggregateResult } from "./bestBuildsFlow";
import {
  buildRefinementSkeletons,
  buildStageShortlists,
  dedupeAndRankBestBuildResults,
} from "./bestBuildsFlow";

function aggregate(overrides: Partial<BestBuildAggregate> = {}): BestBuildAggregate {
  return {
    winRate: 0.5,
    drawRate: 0,
    avgSurvival: 100,
    avgDps: 100,
    avgTtkWin: 10,
    avgImmortalDamage: 100,
    ...overrides,
  };
}

function build(
  traits: string[],
  plushies: string[],
  ascensionAssignments: string[] = ["", "", "", "", ""],
  elder: BuildOptions["elder"] = "None",
): BuildOptions {
  return {
    venerationStage: 5,
    traits,
    ascensionAssignments,
    plushies,
    elder,
  };
}

function result(
  buildOptions: BuildOptions,
  aggregateValue: BestBuildAggregate,
  activesOn = true,
  breathOn = true,
): BestBuildAggregateResult {
  return {
    build: buildOptions,
    activesOn,
    breathOn,
    aggregate: aggregateValue,
    opponentsCount: 3,
  };
}

describe("bestBuildsFlow", () => {
  it("keeps a diverse plushie pair in stage1 and stage2 shortlists", () => {
    const samePairEntries = Array.from({ length: 21 }, (_, index) => ({
      skeleton: {
        traits: ["Damage", `Trait${index}`],
        plushies: ["Void", "Void"],
        venerationStage: 5,
        activesOn: true,
        breathOn: true,
        preScore: 200 - index,
      },
      aggregate: aggregate({
        avgDps: 200 - index,
        winRate: 0.9 - index * 0.001,
        avgImmortalDamage: 200 - index,
      }),
    }));
    const diverseEntry = {
      skeleton: {
        traits: ["Health", "Weight"],
        plushies: ["Bunny", "Ice Wolf"],
        venerationStage: 5,
        activesOn: true,
        breathOn: true,
        preScore: 50,
      },
      aggregate: aggregate({
        avgDps: 50,
        winRate: 0.2,
        avgImmortalDamage: 50,
      }),
    };

    const { quickRanked, stage2Skeletons } = buildStageShortlists({
      quickScored: [...samePairEntries, diverseEntry],
      objective: "avgDps",
      winRateGuardPct: 0,
      stage1TopK: 21,
      stage2Cap: 21,
    });

    expect(quickRanked.length).toBeGreaterThanOrEqual(21);
    expect(
      quickRanked.some(
        (entry) =>
          entry.skeleton.plushies[0] === "Bunny" &&
          entry.skeleton.plushies[1] === "Ice Wolf" &&
          entry.skeleton.traits.join(",") === "Health,Weight",
      ),
    ).toBe(true);
    expect(
      stage2Skeletons.some(
        (skeleton) =>
          skeleton.plushies[0] === "Bunny" &&
          skeleton.plushies[1] === "Ice Wolf" &&
          skeleton.traits.join(",") === "Health,Weight",
      ),
    ).toBe(true);
  });

  it("preserves locked ascension variants as distinct skeletons", () => {
    const fullDamage = ["Damage", "Damage", "Damage", "Damage", "Damage"];
    const fullWeight = ["Weight", "Weight", "Weight", "Weight", "Weight"];
    const quickScored = [
      {
        skeleton: {
          traits: ["Damage", "Weight"],
          plushies: ["Void", "Void"],
          venerationStage: 5,
          activesOn: true,
          breathOn: true,
          preScore: 10,
          ascensionAssignments: fullDamage,
        },
        aggregate: aggregate({ avgDps: 180, winRate: 0.8 }),
      },
      {
        skeleton: {
          traits: ["Damage", "Weight"],
          plushies: ["Void", "Void"],
          venerationStage: 5,
          activesOn: true,
          breathOn: true,
          preScore: 9,
          ascensionAssignments: fullWeight,
        },
        aggregate: aggregate({ avgDps: 170, winRate: 0.75 }),
      },
    ];

    const { stage2Skeletons } = buildStageShortlists({
      quickScored,
      objective: "avgDps",
      winRateGuardPct: 0,
      stage1TopK: 2,
      stage2Cap: 2,
    });

    expect(stage2Skeletons).toHaveLength(2);
    expect(stage2Skeletons[0].ascensionAssignments).toEqual(fullDamage);
    expect(stage2Skeletons[1].ascensionAssignments).toEqual(fullWeight);
  });

  it("normalizes trait order and dedupes refinement skeletons by trait/plushie combo", () => {
    const refinement = buildRefinementSkeletons([
      result(build(["Weight", "Damage"], ["Ice Wolf", "Bunny"]), aggregate({ avgDps: 140 })),
      result(build(["Damage", "Weight"], ["Bunny", "Ice Wolf"]), aggregate({ avgDps: 120 })),
      result(build(["Health", "Bite"], ["Pig-Lantern", "Void"]), aggregate({ avgDps: 110 })),
    ], {
      unlockAscension: true,
      unlockElder: true,
    });

    expect(refinement).toHaveLength(2);
    expect(refinement[0]).toMatchObject({
      traits: ["Damage", "Weight"],
      plushies: ["Ice Wolf", "Bunny"],
      venerationStage: 5,
      activesOn: true,
      breathOn: true,
      preScore: 0,
    });
    expect(refinement[1]).toMatchObject({
      traits: ["Bite", "Health"],
      plushies: ["Pig-Lantern", "Void"],
      venerationStage: 5,
      activesOn: true,
      breathOn: true,
      preScore: 0,
    });
  });

  it("keeps stage, toggles, and locked elder during refinement instead of rebuilding a different search space", () => {
    const refinement = buildRefinementSkeletons([
      result(
        {
          venerationStage: 3,
          traits: ["Weight", "Damage"],
          ascensionAssignments: ["Damage", "Damage", "Weight", "", ""],
          plushies: ["Ice Wolf", "Bunny"],
          elder: "Devious",
        },
        aggregate({ avgDps: 140 }),
        false,
        true,
      ),
    ], {
      unlockAscension: true,
      unlockElder: false,
    });

    expect(refinement).toHaveLength(1);
    expect(refinement[0]).toMatchObject({
      venerationStage: 3,
      activesOn: false,
      breathOn: true,
      elder: "Devious",
      ascensionAssignments: undefined,
      traits: ["Damage", "Weight"],
      plushies: ["Ice Wolf", "Bunny"],
    });
  });

  it("dedupes ascension variants only when showAllAscensionDistributions is disabled", () => {
    const fullDamage = ["Damage", "Damage", "Damage", "Damage", "Damage"];
    const splitDamageWeight = ["Damage", "Damage", "Damage", "Weight", "Weight"];
    const results = [
      result(
        build(["Damage", "Weight"], ["Void", "Void"], splitDamageWeight),
        aggregate({ avgDps: 150, winRate: 0.7 }),
      ),
      result(
        build(["Damage", "Weight"], ["Void", "Void"], fullDamage),
        aggregate({ avgDps: 180, winRate: 0.75 }),
      ),
    ];

    const hiddenAscension = dedupeAndRankBestBuildResults({
      results,
      objective: "avgDps",
      winRateGuardPct: 0,
      showAllAscensionDistributions: false,
    });
    const fullAscension = dedupeAndRankBestBuildResults({
      results,
      objective: "avgDps",
      winRateGuardPct: 0,
      showAllAscensionDistributions: true,
    });

    expect(hiddenAscension).toHaveLength(1);
    expect(hiddenAscension[0].build.ascensionAssignments).toEqual(fullDamage);
    expect(fullAscension.length).toBeGreaterThanOrEqual(2);
    expect(fullAscension[0].build.ascensionAssignments).toEqual(fullDamage);
    expect(fullAscension.some((entry) => entry.build.ascensionAssignments.join(",") === splitDamageWeight.join(","))).toBe(true);
  });
});
