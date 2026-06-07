import { describe, expect, it } from "vitest";
import type { BestBuildAggregateResult } from "./bestBuildsFlow";
import { rerankBestBuildsByCommonWinsData } from "./bestBuildsCommonWinsRanking";

function result(
  label: string,
  winRate: number,
  avgTtkWin: number,
  avgDps = 1000 - avgTtkWin,
  avgImmortalDamage = 5000,
  avgSurvival = 180,
): BestBuildAggregateResult {
  return {
    build: {
      venerationStage: 5,
      traits: [label],
      ascensionAssignments: ["", "", "", "", ""],
      plushies: [],
    },
    activesOn: true,
    breathOn: true,
    opponentsCount: 10,
    aggregate: {
      winRate,
      drawRate: 0,
      avgSurvival,
      avgDps,
      avgTtkWin,
      avgImmortalDamage,
    },
  };
}

describe("best builds common wins ranking", () => {
  it("can elevate a narrower build when the selected common metric is clearly better", () => {
    const ranked = rerankBestBuildsByCommonWinsData([
      {
        result: result("broad", 0.88, 14),
        rows: [
          { opponentName: "A", winner: "A", ttk: 14, dps: 400, effective: 5000, survival: 180 },
          { opponentName: "B", winner: "A", ttk: 14, dps: 400, effective: 5000, survival: 180 },
          { opponentName: "C", winner: "A", ttk: 20, dps: 300, effective: 4500, survival: 180 },
        ],
      },
      {
        result: result("narrow", 0.53, 5),
        rows: [
          { opponentName: "A", winner: "A", ttk: 5, dps: 1000, effective: 7000, survival: 180 },
          { opponentName: "B", winner: "A", ttk: 5, dps: 1000, effective: 7000, survival: 180 },
          { opponentName: "C", winner: "B", ttk: 180, dps: 30, effective: 1000, survival: 40 },
        ],
      },
    ], "avgTtk");

    expect(ranked[0].build.traits[0]).toBe("narrow");
    expect(ranked[1].build.traits[0]).toBe("broad");
  });

  it("uses common-win ttk as a tie-breaker when win rate matches", () => {
    const ranked = rerankBestBuildsByCommonWinsData([
      {
        result: result("slower", 0.8, 12),
        rows: [
          { opponentName: "A", winner: "A", ttk: 12, dps: 350, effective: 5000, survival: 180 },
          { opponentName: "B", winner: "A", ttk: 12, dps: 350, effective: 5000, survival: 180 },
          { opponentName: "C", winner: "A", ttk: 30, dps: 180, effective: 4500, survival: 180 },
        ],
      },
      {
        result: result("faster", 0.8, 10),
        rows: [
          { opponentName: "A", winner: "A", ttk: 8, dps: 450, effective: 5200, survival: 180 },
          { opponentName: "B", winner: "A", ttk: 8, dps: 450, effective: 5200, survival: 180 },
          { opponentName: "C", winner: "A", ttk: 16, dps: 300, effective: 4700, survival: 180 },
        ],
      },
    ], "avgTtk");

    expect(ranked[0].build.traits[0]).toBe("faster");
    expect(ranked[1].build.traits[0]).toBe("slower");
    expect(ranked[0].aggregate.commonWinsMetricKind).toBe("avgTtk");
    expect(ranked[0].aggregate.commonWinsAvgTtkWin).toBeCloseTo(10.6666666667);
  });

  it("uses common-win dps when dps is the selected objective", () => {
    const ranked = rerankBestBuildsByCommonWinsData([
      {
        result: result("lower-dps", 0.8, 10, 500),
        rows: [
          { opponentName: "A", winner: "A", ttk: 10, dps: 500, effective: 5000, survival: 180 },
          { opponentName: "B", winner: "A", ttk: 10, dps: 500, effective: 5000, survival: 180 },
        ],
      },
      {
        result: result("higher-dps", 0.8, 10, 450),
        rows: [
          { opponentName: "A", winner: "A", ttk: 12, dps: 700, effective: 5000, survival: 180 },
          { opponentName: "B", winner: "A", ttk: 12, dps: 700, effective: 5000, survival: 180 },
        ],
      },
    ], "avgDps");

    expect(ranked[0].build.traits[0]).toBe("higher-dps");
    expect(ranked[0].aggregate.commonWinsMetricKind).toBe("avgDps");
    expect(ranked[0].aggregate.commonWinsAvgDps).toBe(700);
  });

  it("uses common-win effective damage when effective damage is the selected objective", () => {
    const ranked = rerankBestBuildsByCommonWinsData([
      {
        result: result("lower-effective", 0.8, 10, 500, 6000),
        rows: [
          { opponentName: "A", winner: "A", ttk: 10, dps: 500, effective: 6000, survival: 180 },
          { opponentName: "B", winner: "A", ttk: 10, dps: 500, effective: 6000, survival: 180 },
        ],
      },
      {
        result: result("higher-effective", 0.8, 10, 500, 5500),
        rows: [
          { opponentName: "A", winner: "A", ttk: 10, dps: 500, effective: 8000, survival: 180 },
          { opponentName: "B", winner: "A", ttk: 10, dps: 500, effective: 8000, survival: 180 },
        ],
      },
    ], "immortalDamage");

    expect(ranked[0].build.traits[0]).toBe("higher-effective");
    expect(ranked[0].aggregate.commonWinsMetricKind).toBe("immortalDamage");
    expect(ranked[0].aggregate.commonWinsAvgImmortalDamage).toBe(8000);
  });

  it("uses common-win survival when survival is the selected objective", () => {
    const ranked = rerankBestBuildsByCommonWinsData([
      {
        result: result("lower-survival", 0.8, 10, 500, 5000, 150),
        rows: [
          { opponentName: "A", winner: "A", ttk: 10, dps: 500, effective: 5000, survival: 150 },
          { opponentName: "B", winner: "A", ttk: 10, dps: 500, effective: 5000, survival: 150 },
        ],
      },
      {
        result: result("higher-survival", 0.8, 10, 500, 5000, 120),
        rows: [
          { opponentName: "A", winner: "A", ttk: 12, dps: 450, effective: 5000, survival: 170 },
          { opponentName: "B", winner: "A", ttk: 12, dps: 450, effective: 5000, survival: 170 },
        ],
      },
    ], "survival");

    expect(ranked[0].build.traits[0]).toBe("higher-survival");
    expect(ranked[0].aggregate.commonWinsMetricKind).toBe("survival");
    expect(ranked[0].aggregate.commonWinsAvgSurvival).toBe(170);
  });

  it("uses common-win secondary tie-breakers before raw aggregate metrics", () => {
    const ranked = rerankBestBuildsByCommonWinsData([
      {
        result: result("lower-common-dps", 0.8, 10, 900, 9000, 200),
        rows: [
          { opponentName: "A", winner: "A", ttk: 10, dps: 400, effective: 3000, survival: 150 },
          { opponentName: "B", winner: "A", ttk: 10, dps: 400, effective: 3000, survival: 150 },
        ],
      },
      {
        result: result("higher-common-dps", 0.8, 10, 700, 7000, 180),
        rows: [
          { opponentName: "A", winner: "A", ttk: 10, dps: 600, effective: 2500, survival: 140 },
          { opponentName: "B", winner: "A", ttk: 10, dps: 600, effective: 2500, survival: 140 },
        ],
      },
    ], "avgTtk");

    expect(ranked[0].build.traits[0]).toBe("higher-common-dps");
    expect(ranked[0].aggregate.commonWinsAvgDps).toBe(600);
    expect(ranked[1].aggregate.commonWinsAvgDps).toBe(400);
  });

  it("breaks winRate ties by common-win ttk, not global avgTtk", () => {
    const ranked = rerankBestBuildsByCommonWinsData([
      {
        result: result("slower-common", 0.8, 8),
        rows: [
          { opponentName: "A", winner: "A", ttk: 14, dps: 400, effective: 5000, survival: 180 },
          { opponentName: "B", winner: "A", ttk: 14, dps: 400, effective: 5000, survival: 180 },
          { opponentName: "C", winner: "B", ttk: 180, dps: 10, effective: 500, survival: 40 },
        ],
      },
      {
        result: result("faster-common", 0.8, 12),
        rows: [
          { opponentName: "A", winner: "A", ttk: 6, dps: 700, effective: 5500, survival: 180 },
          { opponentName: "B", winner: "A", ttk: 6, dps: 700, effective: 5500, survival: 180 },
          { opponentName: "C", winner: "B", ttk: 180, dps: 10, effective: 500, survival: 40 },
        ],
      },
    ], "winRate");

    expect(ranked[0].build.traits[0]).toBe("faster-common");
    expect(ranked[1].build.traits[0]).toBe("slower-common");
    expect(ranked[0].aggregate.commonWinsAvgTtkWin).toBe(6);
  });

  it("does not keep win rate as an absolute first priority once common ranking is active", () => {
    const ranked = rerankBestBuildsByCommonWinsData([
      {
        result: result("higher-wins", 0.85, 10),
        rows: [
          { opponentName: "A", winner: "A", ttk: 10, dps: 500, effective: 5000, survival: 180 },
          { opponentName: "B", winner: "A", ttk: 10, dps: 500, effective: 5000, survival: 180 },
        ],
      },
      {
        result: result("better-common-ttk", 0.75, 14),
        rows: [
          { opponentName: "A", winner: "A", ttk: 6, dps: 500, effective: 5000, survival: 180 },
          { opponentName: "B", winner: "A", ttk: 6, dps: 500, effective: 5000, survival: 180 },
        ],
      },
    ], "avgTtk");

    expect(ranked[0].build.traits[0]).toBe("better-common-ttk");
    expect(ranked[1].build.traits[0]).toBe("higher-wins");
  });
});
