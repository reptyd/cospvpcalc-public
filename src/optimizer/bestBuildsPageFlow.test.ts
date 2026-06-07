import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BuildOptions } from "../engine";
import { creatureByName } from "../engine/creatureData";
import { runBestBuildsFlow } from "./bestBuildsPageFlow";
import { createOptimizerCandidates } from "./optimizerFacade";
import { runBestBuildsPhase2WithWorkers } from "./bestBuildsPhase2Runtime";
import { evaluateBestBuildAgainstPool } from "./bestBuildsEvaluation";

vi.mock("./optimizerFacade", () => ({
  createOptimizerCandidates: vi.fn(),
}));

vi.mock("./bestBuildsPhase2Runtime", () => ({
  runBestBuildsPhase2WithWorkers: vi.fn(),
}));

vi.mock("./bestBuildsEvaluation", async () => {
  const actual = await vi.importActual<typeof import("./bestBuildsEvaluation")>("./bestBuildsEvaluation");
  return {
    ...actual,
    evaluateBestBuildAgainstPool: vi.fn(),
  };
});

vi.mock("./poolUtils", () => ({
  buildAdaptiveQuickOpponents: vi.fn((pool: string[]) => pool),
}));

function build(
  traits: string[],
  plushies: string[],
  ascensionAssignments: string[] = ["", "", "", "", ""],
): BuildOptions {
  return {
    venerationStage: 5,
    traits,
    ascensionAssignments,
    plushies,
  };
}

function aggregate(avgDps: number, winRate = 0.5) {
  return {
    winRate,
    drawRate: 0,
    avgSurvival: 100,
    avgDps,
    avgTtkWin: 10,
    avgImmortalDamage: avgDps,
  };
}

const mockedCreateOptimizerCandidates = vi.mocked(createOptimizerCandidates);
const mockedRunBestBuildsPhase2WithWorkers = vi.mocked(runBestBuildsPhase2WithWorkers);
const mockedEvaluateBestBuildAgainstPool = vi.mocked(evaluateBestBuildAgainstPool);

function phase2Run(results: Array<{
  build: BuildOptions;
  activesOn: boolean;
  breathOn: boolean;
  aggregate: {
    winRate: number;
    drawRate: number;
    avgSurvival: number;
    avgDps: number;
    avgTtkWin: number;
    avgImmortalDamage: number;
  };
  opponentsCount: number;
}>) {
  return { results, pathCounts: {} };
}

describe("best builds page flow", () => {
  const creature = creatureByName["Korathos"];
  const activePool = ["Sigmatox", "Kohikii"];

  beforeEach(() => {
    vi.clearAllMocks();
    mockedCreateOptimizerCandidates.mockResolvedValue([
      {
        build: build(["Damage", "Weight"], ["Void", "Void"]),
        activesOn: true,
        breathOn: true,
        preScore: 100,
      },
      {
        build: build(["Health", "Bite"], ["Pig-Lantern", "Void"]),
        activesOn: true,
        breathOn: true,
        preScore: 80,
      },
    ]);
  });

  it("runs final ascension recheck only when the toggle is enabled and ascension is unlocked", async () => {
    expect(creature).toBeTruthy();
    if (!creature) return;

    const splitOne = ["Damage", "Damage", "Damage", "Weight", "Weight"];
    const splitTwo = ["Damage", "Damage", "Weight", "Weight", "Weight"];

    mockedRunBestBuildsPhase2WithWorkers
      .mockResolvedValueOnce(phase2Run([
        {
          build: build(["Damage", "Weight"], ["Void", "Void"]),
          activesOn: true,
          breathOn: true,
          aggregate: aggregate(160, 0.75),
          opponentsCount: activePool.length,
        },
        {
          build: build(["Health", "Bite"], ["Pig-Lantern", "Void"]),
          activesOn: true,
          breathOn: true,
          aggregate: aggregate(170, 0.78),
          opponentsCount: activePool.length,
        },
      ]))
      .mockResolvedValueOnce(phase2Run([
        {
          build: build(["Damage", "Weight"], ["Void", "Void"], splitOne),
          activesOn: true,
          breathOn: true,
          aggregate: aggregate(160, 0.75),
          opponentsCount: activePool.length,
        },
        {
          build: build(["Health", "Bite"], ["Pig-Lantern", "Void"]),
          activesOn: true,
          breathOn: true,
          aggregate: aggregate(170, 0.78),
          opponentsCount: activePool.length,
        },
      ]))
      .mockResolvedValueOnce(phase2Run([
        {
          build: build(["Damage", "Weight"], ["Void", "Void"], splitOne),
          activesOn: true,
          breathOn: true,
          aggregate: aggregate(180, 0.8),
          opponentsCount: activePool.length,
        },
        {
          build: build(["Health", "Bite"], ["Pig-Lantern", "Void"], splitTwo),
          activesOn: true,
          breathOn: true,
          aggregate: aggregate(165, 0.77),
          opponentsCount: activePool.length,
        },
      ]));

    const result = await runBestBuildsFlow({
      creature,
      activePool,
      searchDepth: "soft",
      objective: "avgDps",
      winRateGuardPct: 0,
      targetConstraints: build([], []),
      targetTraitLock: false,
      targetAscensionLock: false,
      targetPlushieLock: false,
      targetElderLock: false,
      excludedTraits: [],
      excludedPlushies: [],
      showAllAscensionDistributions: true,
      earlyPruning: true,
      onProgress: () => undefined,
      onPartialResults: () => undefined,
      cancelRef: { current: false },
    });

    expect(mockedRunBestBuildsPhase2WithWorkers).toHaveBeenCalledTimes(3);
    expect(mockedRunBestBuildsPhase2WithWorkers.mock.calls[2]?.[0]).toMatchObject({
      returnAllDistributions: false,
      stage2Skeletons: expect.arrayContaining([
        expect.objectContaining({
          venerationStage: 5,
          activesOn: true,
          breathOn: true,
        }),
      ]),
    });
    expect(result.results).toHaveLength(2);
    expect(result.results[0]?.build.ascensionAssignments).toEqual(splitOne);
    expect(result.results[0]?.build.traits).toEqual(["Damage", "Weight"]);
    expect(result.results[1]?.build.traits).toEqual(["Health", "Bite"]);
  });

  it("keeps stage, toggles, and local build axes during refinement", async () => {
    expect(creature).toBeTruthy();
    if (!creature) return;

    mockedCreateOptimizerCandidates.mockResolvedValue([
      {
        build: {
          venerationStage: 3,
          traits: ["Damage", "Weight"],
          ascensionAssignments: ["Damage", "Weight", "Damage", "", ""],
          plushies: ["Void", "Void"],
          elder: "Devious",
        },
        activesOn: false,
        breathOn: true,
        preScore: 100,
      },
    ]);

    mockedRunBestBuildsPhase2WithWorkers
      .mockResolvedValueOnce(phase2Run([
        {
          build: {
            venerationStage: 3,
            traits: ["Damage", "Weight"],
            ascensionAssignments: ["Damage", "Weight", "Damage", "", ""],
            plushies: ["Void", "Void"],
            elder: "Devious",
          },
          activesOn: false,
          breathOn: true,
          aggregate: aggregate(160, 0.75),
          opponentsCount: activePool.length,
        },
      ]))
      .mockResolvedValueOnce(phase2Run([
        {
          build: {
            venerationStage: 3,
            traits: ["Damage", "Weight"],
            ascensionAssignments: ["Damage", "Weight", "Damage", "", ""],
            plushies: ["Void", "Void"],
            elder: "Devious",
          },
          activesOn: false,
          breathOn: true,
          aggregate: aggregate(170, 0.8),
          opponentsCount: activePool.length,
        },
      ]))
      .mockResolvedValueOnce(phase2Run([
        {
          build: {
            venerationStage: 3,
            traits: ["Damage", "Weight"],
            ascensionAssignments: ["Damage", "Damage", "Weight", "", ""],
            plushies: ["Void", "Void"],
            elder: "Powerful",
          },
          activesOn: false,
          breathOn: true,
          aggregate: aggregate(180, 0.82),
          opponentsCount: activePool.length,
        },
      ]));

    const result = await runBestBuildsFlow({
      creature,
      activePool,
      searchDepth: "soft",
      objective: "avgDps",
      winRateGuardPct: 0,
      targetConstraints: build([], []),
      targetTraitLock: false,
      targetAscensionLock: false,
      targetPlushieLock: false,
      targetElderLock: false,
      excludedTraits: [],
      excludedPlushies: [],
      showAllAscensionDistributions: true,
      earlyPruning: true,
      onProgress: () => undefined,
      onPartialResults: () => undefined,
      cancelRef: { current: false },
    });

    expect(mockedRunBestBuildsPhase2WithWorkers.mock.calls[2]?.[0]).toMatchObject({
      stage2Skeletons: [
        expect.objectContaining({
          venerationStage: 3,
          activesOn: false,
          breathOn: true,
          traits: ["Damage", "Weight"],
          plushies: ["Void", "Void"],
          elder: undefined,
          ascensionAssignments: undefined,
        }),
      ],
    });
    expect(result.results[0]?.build.venerationStage).toBe(3);
    expect(result.results[0]?.activesOn).toBe(false);
    expect(result.results[0]?.breathOn).toBe(true);
  });

  it("skips refinement when ascension is locked even if showAllAscensionDistributions is enabled", async () => {
    expect(creature).toBeTruthy();
    if (!creature) return;

    const lockedAssignments = ["Damage", "Weight", "Damage", "Weight", "Damage"];

    mockedRunBestBuildsPhase2WithWorkers
      .mockResolvedValueOnce(phase2Run([
        {
          build: build(["Damage", "Weight"], ["Void", "Void"], lockedAssignments),
          activesOn: true,
          breathOn: true,
          aggregate: aggregate(150, 0.72),
          opponentsCount: activePool.length,
        },
      ]))
      .mockResolvedValueOnce(phase2Run([
        {
          build: build(["Damage", "Weight"], ["Void", "Void"], lockedAssignments),
          activesOn: true,
          breathOn: true,
          aggregate: aggregate(175, 0.8),
          opponentsCount: activePool.length,
        },
      ]));

    const result = await runBestBuildsFlow({
      creature,
      activePool,
      searchDepth: "soft",
      objective: "avgDps",
      winRateGuardPct: 0,
      targetConstraints: build(["Damage", "Weight"], ["Void", "Void"], lockedAssignments),
      targetTraitLock: true,
      targetAscensionLock: true,
      targetPlushieLock: true,
      targetElderLock: true,
      excludedTraits: [],
      excludedPlushies: [],
      showAllAscensionDistributions: true,
      earlyPruning: true,
      onProgress: () => undefined,
      onPartialResults: () => undefined,
      cancelRef: { current: false },
    });

    expect(mockedRunBestBuildsPhase2WithWorkers).toHaveBeenCalledTimes(2);
    expect(result.results).toHaveLength(1);
    expect(result.results[0]?.build.ascensionAssignments).toEqual(lockedAssignments);
  });

  it("falls back to sequential best-build evaluation when stage2 workers return empty results", async () => {
    expect(creature).toBeTruthy();
    if (!creature) return;

    const fallbackBuild = build(["Damage", "Weight"], ["Void", "Void"], ["Damage", "Damage", "Damage", "Weight", "Weight"]);

    mockedRunBestBuildsPhase2WithWorkers
      .mockResolvedValueOnce(phase2Run([
        {
          build: build(["Damage", "Weight"], ["Void", "Void"]),
          activesOn: true,
          breathOn: true,
          aggregate: aggregate(160, 0.76),
          opponentsCount: activePool.length,
        },
      ]))
      .mockResolvedValueOnce(phase2Run([]));

    mockedEvaluateBestBuildAgainstPool.mockReturnValue({
      build: fallbackBuild,
      activesOn: true,
      breathOn: true,
      aggregate: aggregate(190, 0.82),
      opponentsCount: activePool.length,
    });

    const partialSnapshots: number[] = [];
    const result = await runBestBuildsFlow({
      creature,
      activePool,
      searchDepth: "soft",
      objective: "avgDps",
      winRateGuardPct: 0,
      targetConstraints: build([], []),
      targetTraitLock: false,
      targetAscensionLock: false,
      targetPlushieLock: false,
      targetElderLock: false,
      excludedTraits: [],
      excludedPlushies: [],
      showAllAscensionDistributions: false,
      earlyPruning: true,
      onProgress: () => undefined,
      onPartialResults: (rows) => partialSnapshots.push(rows.length),
      cancelRef: { current: false },
    });

    expect(mockedRunBestBuildsPhase2WithWorkers).toHaveBeenCalledTimes(2);
    expect(mockedEvaluateBestBuildAgainstPool).toHaveBeenCalledTimes(1);
    expect(partialSnapshots).toEqual([]);
    expect(result.results).toHaveLength(1);
    expect(result.results[0]?.build).toEqual(fallbackBuild);
  });

  it("sanitizes locked constraints against blacklisted traits and plushies before candidate generation", async () => {
    expect(creature).toBeTruthy();
    if (!creature) return;

    mockedRunBestBuildsPhase2WithWorkers
      .mockResolvedValueOnce(phase2Run([]))
      .mockResolvedValueOnce(phase2Run([]));

    await runBestBuildsFlow({
      creature,
      activePool,
      searchDepth: "soft",
      objective: "avgDps",
      winRateGuardPct: 0,
      targetConstraints: build(["Damage", "Weight"], ["Void", "Pig-Lantern"], ["Damage", "Damage", "", "", ""]),
      targetTraitLock: true,
      targetAscensionLock: true,
      targetPlushieLock: true,
      targetElderLock: false,
      excludedTraits: ["Damage"],
      excludedPlushies: ["Void"],
      showAllAscensionDistributions: false,
      earlyPruning: true,
      onProgress: () => undefined,
      onPartialResults: () => undefined,
      cancelRef: { current: false },
    });

    expect(mockedCreateOptimizerCandidates).toHaveBeenCalledWith(
      expect.objectContaining({
        constraints: expect.objectContaining({
          traits: ["Weight"],
          plushies: ["Pig-Lantern"],
          ascensionAssignments: ["", "", "", "", ""],
        }),
        excludedTraits: ["Damage"],
        excludedPlushies: ["Void"],
      }),
    );
  });
});
