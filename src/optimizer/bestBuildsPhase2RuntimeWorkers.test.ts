import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  createOptimizerWorkers,
  getOptimizerWorkerCount,
  pingOptimizerWorkers,
  terminateWorkers,
} = vi.hoisted(() => ({
  createOptimizerWorkers: vi.fn(),
  getOptimizerWorkerCount: vi.fn(),
  pingOptimizerWorkers: vi.fn(),
  terminateWorkers: vi.fn(),
}));

vi.mock("./optimizerWorkerClient", () => ({
  createOptimizerWorkers,
  getOptimizerWorkerCount,
  pingOptimizerWorkers,
  terminateWorkers,
}));

// Sequential fallback uses simulateBestBuildMatchup which requires Rust at
// runtime after the TS fallback was retired. In node test env Rust wasm is
// not loaded, so synthesize summaries to exercise the worker-fail → sequential
// scaffolding without the actual matchup math.
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

import { runBestBuildsPhase2WithWorkers } from "./bestBuildsPhase2Runtime";

function createPhase2Worker(responseRows: Array<{ skeletonKey: string; build: { venerationStage: number; traits: string[]; ascensionAssignments: string[]; plushies: string[] }; aggregate: { avgDps: number; avgEffectiveDamage: number; avgWinRate: number; avgTtkWin: number; avgTtkAny: number; avgExtendedDamage: number } }>) {
  const worker = {
    onmessage: null as ((event: MessageEvent<any>) => void) | null,
    onerror: null as ((event: Event) => void) | null,
    terminate: vi.fn(),
    postMessage: vi.fn((job: { id: number }) => {
      queueMicrotask(() => {
        worker.onmessage?.({
          data: {
            id: job.id,
            bestBuildsResults: responseRows,
          },
        } as MessageEvent<any>);
      });
    }),
  };
  return worker;
}

function createErroringPhase2Worker(kind: "messageError" | "runtimeError") {
  const worker = {
    onmessage: null as ((event: MessageEvent<any>) => void) | null,
    onerror: null as ((event: Event) => void) | null,
    terminate: vi.fn(),
    postMessage: vi.fn(() => {
      queueMicrotask(() => {
        if (kind === "messageError") {
          worker.onmessage?.({
            data: {
              id: 0,
              error: "phase2 failed",
              bestBuildsResults: [],
            },
          } as MessageEvent<any>);
          return;
        }
        worker.onerror?.(new Event("error"));
      });
    }),
  };
  return worker;
}

describe("best builds phase2 runtime worker path", () => {
  const globalShim: any = globalThis;
  const previousWorker = globalThis.Worker;
  const previousWindow = globalShim.window;
  beforeEach(() => {
    createOptimizerWorkers.mockReset();
    getOptimizerWorkerCount.mockReset();
    pingOptimizerWorkers.mockReset();
    terminateWorkers.mockReset();
    getOptimizerWorkerCount.mockReturnValue(1);
    globalShim.window = globalThis;
  });

  afterEach(() => {
    globalThis.Worker = previousWorker;
    if (previousWindow === undefined) {
      delete globalShim.window;
    } else {
      globalShim.window = previousWindow;
    }
  });

  it("maps worker results back to skeleton toggles and opponent count", async () => {
    const worker = createPhase2Worker([
      {
        skeletonKey: "0:0",
        build: {
          venerationStage: 5,
          traits: ["Damage", "Weight"],
          ascensionAssignments: ["Damage", "Damage", "Damage", "Damage", "Damage"],
          plushies: ["Void", "Void"],
        },
        aggregate: {
          avgDps: 123,
          avgEffectiveDamage: 456,
          avgWinRate: 0.75,
          avgTtkWin: 9,
          avgTtkAny: 11,
          avgExtendedDamage: 789,
        },
      },
    ]);
    createOptimizerWorkers.mockReturnValue([worker]);
    pingOptimizerWorkers.mockResolvedValue([true]);
    globalThis.Worker = class {} as unknown as typeof Worker;

    let progress = 0;
    const { results } = await runBestBuildsPhase2WithWorkers({
      sourceCreatureName: "Korathos",
      stage2Skeletons: [
        {
          traits: ["Damage", "Weight"],
          plushies: ["Void", "Void"],
          venerationStage: 5,
          activesOn: false,
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

    expect(createOptimizerWorkers).toHaveBeenCalledOnce();
    expect(pingOptimizerWorkers).toHaveBeenCalledOnce();
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      activesOn: false,
      breathOn: true,
      opponentsCount: 2,
      aggregate: expect.objectContaining({
        avgDps: 123,
        avgEffectiveDamage: 456,
      }),
    });
    expect(progress).toBe(1);
    expect(terminateWorkers).toHaveBeenCalledWith([worker]);
  });

  it("falls back to sequential evaluation when worker self-check fails", async () => {
    const worker = createPhase2Worker([]);
    createOptimizerWorkers.mockReturnValue([worker]);
    pingOptimizerWorkers.mockResolvedValue([false]);
    globalThis.Worker = class {} as unknown as typeof Worker;

    const { results } = await runBestBuildsPhase2WithWorkers({
      sourceCreatureName: "Korathos",
      stage2Skeletons: [
        {
          traits: ["Damage", "Weight"],
          plushies: ["Void", "Void"],
          venerationStage: 5,
          activesOn: true,
          breathOn: true,
        },
      ],
      opponentNames: ["Sigmatox"],
      objective: "avgDps",
      maxTimeSec: 60,
      abilityPolicy: "semiIdeal",
      onProgress: () => {},
      cancelRef: { current: false },
      returnAllDistributions: false,
    });

    expect(createOptimizerWorkers).toHaveBeenCalledOnce();
    expect(pingOptimizerWorkers).toHaveBeenCalledOnce();
    expect(terminateWorkers).toHaveBeenCalledWith([worker]);
    expect(results).toHaveLength(1);
    expect(results[0].aggregate.avgDps).toBeGreaterThan(0);
  });

  it("falls back for a chunk when worker returns payload error", async () => {
    const worker = createErroringPhase2Worker("messageError");
    createOptimizerWorkers.mockReturnValue([worker]);
    pingOptimizerWorkers.mockResolvedValue([true]);
    globalThis.Worker = class {} as unknown as typeof Worker;

    const { results } = await runBestBuildsPhase2WithWorkers({
      sourceCreatureName: "Korathos",
      stage2Skeletons: [
        {
          traits: ["Damage", "Weight"],
          plushies: ["Void", "Void"],
          venerationStage: 5,
          activesOn: true,
          breathOn: false,
        },
      ],
      opponentNames: ["Sigmatox"],
      objective: "avgDps",
      maxTimeSec: 60,
      abilityPolicy: "semiIdeal",
      onProgress: () => {},
      cancelRef: { current: false },
      returnAllDistributions: false,
    });

    expect(results).toHaveLength(1);
    expect(results[0].aggregate.avgDps).toBeGreaterThan(0);
    expect(terminateWorkers).toHaveBeenCalledWith([worker]);
  });

  it("falls back for a chunk when worker runtime errors", async () => {
    const worker = createErroringPhase2Worker("runtimeError");
    createOptimizerWorkers.mockReturnValue([worker]);
    pingOptimizerWorkers.mockResolvedValue([true]);
    globalThis.Worker = class {} as unknown as typeof Worker;

    const { results } = await runBestBuildsPhase2WithWorkers({
      sourceCreatureName: "Korathos",
      stage2Skeletons: [
        {
          traits: ["Damage", "Weight"],
          plushies: ["Void", "Void"],
          venerationStage: 5,
          activesOn: true,
          breathOn: false,
        },
      ],
      opponentNames: ["Sigmatox"],
      objective: "avgDps",
      maxTimeSec: 60,
      abilityPolicy: "semiIdeal",
      onProgress: () => {},
      cancelRef: { current: false },
      returnAllDistributions: false,
    });

    expect(results).toHaveLength(1);
    expect(results[0].aggregate.avgDps).toBeGreaterThan(0);
    expect(terminateWorkers).toHaveBeenCalledWith([worker]);
  });
});
