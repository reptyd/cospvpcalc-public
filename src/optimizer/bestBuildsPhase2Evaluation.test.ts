import { describe, expect, it, vi } from "vitest";

vi.mock("./bestBuildsRuntime", async () => {
  const actual = await vi.importActual<typeof import("./bestBuildsRuntime")>("./bestBuildsRuntime");
  const stubSummary = {
    winner: "A" as const,
    deathTimeA: null,
    maxTimeSec: 60,
    dpsAtoB: 100,
    ttkAtoB: 5,
    damageDealtA: 1000,
    damageDealtAAtBDeath: 1000,
    extendedDamagePotentialA: 0,
  };
  return {
    ...actual,
    simulateBestBuildMatchup: () => stubSummary,
    simulateBestBuildMatchupWithPath: () => ({ summary: stubSummary, path: "test_stub" }),
  };
});

import { evaluateBestBuildsPhase2Job } from "./bestBuildsPhase2Evaluation";
import { runBestBuildsPhase2WithWorkers } from "./bestBuildsPhase2Runtime";
import type { BestBuildsPhase2Job } from "./optimizerWorkerProtocol";

describe("best builds phase2 evaluation", () => {
  it("returns all ascension distributions when requested", () => {
    const job: BestBuildsPhase2Job = {
      kind: "bestBuildsPhase2",
      id: 1,
      sourceCreatureName: "Korathos",
      opponentNames: ["Sigmatox"],
      objective: "avgDps",
      maxTimeSec: 60,
      abilityPolicy: "semiIdeal",
      returnAllDistributions: true,
      skeletons: [
        {
          key: "phase2:0",
          traits: ["Damage", "Weight"],
          plushies: ["Void", "Void"],
          venerationStage: 5,
          elder: "None",
          activesOn: true,
          breathOn: true,
        },
      ],
    };

    const { bestBuildsResults: results } = evaluateBestBuildsPhase2Job(job);

    expect(results).toHaveLength(6);
    expect(new Set(results.map((row) => row.build.ascensionAssignments.join(","))).size).toBe(6);
  });

  it("preserves locked ascension assignments instead of enumerating splits", () => {
    const lockedAssignments = ["Damage", "Weight", "Damage", "Weight", "Damage"];
    const job: BestBuildsPhase2Job = {
      kind: "bestBuildsPhase2",
      id: 2,
      sourceCreatureName: "Korathos",
      opponentNames: ["Sigmatox"],
      objective: "avgDps",
      maxTimeSec: 60,
      abilityPolicy: "semiIdeal",
      returnAllDistributions: true,
      skeletons: [
        {
          key: "phase2:1",
          traits: ["Damage", "Weight"],
          plushies: ["Void", "Void"],
          venerationStage: 5,
          elder: "None",
          activesOn: true,
          breathOn: true,
          ascensionAssignments: lockedAssignments,
        },
      ],
    };

    const { bestBuildsResults: results } = evaluateBestBuildsPhase2Job(job);

    expect(results).toHaveLength(1);
    expect(results[0].build.ascensionAssignments).toEqual(lockedAssignments);
  });
});

describe("best builds phase2 runtime", () => {
  it("falls back to sequential evaluation when workers are unavailable", async () => {
    let progress = 0;

    const { results } = await runBestBuildsPhase2WithWorkers({
      sourceCreatureName: "Korathos",
      stage2Skeletons: [
        {
          traits: ["Damage", "Weight"],
          plushies: ["Void", "Void"],
          venerationStage: 5,
          elder: "None",
          activesOn: true,
          breathOn: true,
        },
      ],
      opponentNames: ["Sigmatox", "Avothius"],
      objective: "avgDps",
      maxTimeSec: 60,
      abilityPolicy: "semiIdeal",
      onProgress: (value) => {
        progress = value;
      },
      cancelRef: { current: false },
      returnAllDistributions: false,
    });

    expect(results).toHaveLength(1);
    expect(results[0].build.traits).toEqual(["Damage", "Weight"]);
    expect(results[0].opponentsCount).toBe(2);
    expect(results[0].aggregate.avgDps).toBeGreaterThan(0);
    expect(progress).toBe(1);
  });
});
