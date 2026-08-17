import type { AbilityTimingMode, BuildOptions, TwoFacedMode } from "../../engine";
import type { RustComposableAbilityConfig } from "../rustMatchupBridge";
import type {
  BestBuildsExtraBuffs,
  BestBuildsExtraCombatantStats,
  BestBuildsExtraSpecialAbilities,
  BestBuildsExtraTrapsTrails,
} from "../bestBuildsBattleSettingsBridge";
import type { CombatEventPhase } from "../../engine/eventOrdering";
import { listCustomCreatureRecords } from "../../engine/customCreatures";
import {
  createOptimizerWorkers,
  getOptimizerWorkerCount,
  pingOptimizerWorkers,
  syncCustomCreaturesToWorkers,
  terminateWorkers,
} from "../optimizerWorkerClient";
import { runBestBuildsPhase2WorkerExecution } from "../bestBuildsPhase2WorkerExecution";
import {
  evaluateBestBuildsPhase2ChunkFallback,
  mergeBestBuildsPathCounts,
  type BestBuildsPhase2Result,
  type BestBuildsPhase2Skeleton,
} from "../bestBuildsPhase2RuntimeHelpers";
import type {
  BestBuildsPathCounts,
  BestBuildsPhase2Job,
  OptimizerWorkerResponse,
} from "../optimizerWorkerProtocol";
import type { BestBuildAggregateObjective } from "../ranking";

// ---------------------------------------------------------------------------
// Funnel cell runner.
//
// The pipeline's stages score a rectangle of (builds x opponents), and the
// rectangles have very different shapes: the coarse screen is wide and cheap
// (thousands of builds, five anchors, sub-millisecond fights), the honest-top
// stage is narrow and dear (ten builds, eleven Fortify carriers, up to seconds
// per fight). One chunking rule cannot balance both, so each stage plans its own
// CELLS - a build slice paired with an opponent slice - and the runner executes
// them on the existing Best Builds worker pool.
//
// Splitting the opponent axis is what makes the dear stage parallelise: chunked
// by build alone, one worker ends up holding a whole multi-second row while the
// rest sit idle.
// ---------------------------------------------------------------------------

export type FunnelBuildRef = {
  /** Stable identity used to merge a build's outcomes across stages. */
  key: string;
  build: BuildOptions;
  activesOn: boolean;
  breathOn: boolean;
};

export type FunnelCell = {
  builds: FunnelBuildRef[];
  opponents: string[];
};

export type FunnelCellOutcome = {
  buildKey: string;
  result: BestBuildsPhase2Result;
};

export type FunnelCellRunResult = {
  outcomes: FunnelCellOutcome[];
  pathCounts: BestBuildsPathCounts;
  workerCount: number;
  /** Engine work the stage charged, in event-loop iterations. Deterministic and
   * additive across workers, so the pipeline can budget on it. */
  workUnits: number;
};

/** The per-side battle-settings channels a Best Builds run can carry. The
 * rectangle batch cannot express them, so a job that has any falls back to the
 * per-matchup path on its own - correct either way, just dearer per fight. */
export type FunnelBattleSettings = {
  extraAbilityConfig?: Partial<RustComposableAbilityConfig>;
  extraCombatantStats?: BestBuildsExtraCombatantStats;
  extraSpecialAbilities?: BestBuildsExtraSpecialAbilities;
  extraBuffs?: BestBuildsExtraBuffs;
  extraTrapsTrails?: BestBuildsExtraTrapsTrails;
};

export type FunnelRunnerBase = {
  sourceCreatureName: string;
  objective: BestBuildAggregateObjective;
  maxTimeSec: number;
  combatEventOrder?: CombatEventPhase[];
  opponentBaselineBuild?: BuildOptions;
  twoFacedMode?: TwoFacedMode;
  /** Timing policy the stage's fights run. Screening uses the cheap gate-only
   * mode; the completion that produces the displayed numbers uses the caller's. */
  abilityPolicy: AbilityTimingMode;
  /** Puts Fortify on its ReallyFast gate even under a search policy. Screening
   * sets it; it is redundant once `abilityPolicy` is already gate-only. */
  screenFortifyFast?: boolean;
  extras?: FunnelBattleSettings;
};

export type FunnelCellRunner = (args: {
  cells: FunnelCell[];
  wantPerOpponent: boolean;
  onProgress?: (value: number) => void;
  cancelRef: { current: boolean };
}) => Promise<FunnelCellRunResult>;

/**
 * Slice a stage's rectangle into cells. `opponentsPerCell` is the lever: leave it
 * at the full pool for the cheap uniform stages, drop it to 1 for the replay
 * stage where per-opponent cost spans two orders of magnitude. `maxBuildsPerCell`
 * caps the other axis for the same reason - a stage whose whole rectangle is a
 * handful of builds has no slack left on the build axis otherwise, and its
 * dearest cell then sets the stage's wall clock on its own.
 *
 * Cells come out in the caller's opponent order, and the runner dispatches them
 * in that order, so a caller that hands over its dear opponents first gets
 * longest-processing-time-first scheduling out of the shared pull queue.
 */
export function planFunnelCells({
  builds,
  opponents,
  workerCount,
  opponentsPerCell,
  maxBuildsPerCell,
  cellsPerWorker = 4,
}: {
  builds: readonly FunnelBuildRef[];
  opponents: readonly string[];
  workerCount: number;
  opponentsPerCell?: number;
  maxBuildsPerCell?: number;
  cellsPerWorker?: number;
}): FunnelCell[] {
  if (builds.length === 0 || opponents.length === 0) return [];
  const groupSize = Math.max(1, Math.min(opponentsPerCell ?? opponents.length, opponents.length));
  const opponentGroups: string[][] = [];
  for (let i = 0; i < opponents.length; i += groupSize) {
    opponentGroups.push(opponents.slice(i, i + groupSize));
  }
  const targetCells = Math.max(1, workerCount * cellsPerWorker);
  const buildSlices = Math.max(1, Math.ceil(targetCells / opponentGroups.length));
  const buildsPerCell = Math.min(
    maxBuildsPerCell ?? builds.length,
    Math.max(1, Math.ceil(builds.length / buildSlices)),
  );

  const cells: FunnelCell[] = [];
  for (const group of opponentGroups) {
    for (let i = 0; i < builds.length; i += buildsPerCell) {
      cells.push({ builds: builds.slice(i, i + buildsPerCell), opponents: group });
    }
  }
  return cells;
}

function toSkeleton(ref: FunnelBuildRef): BestBuildsPhase2Skeleton {
  return {
    traits: ref.build.traits,
    plushies: ref.build.plushies,
    venerationStage: ref.build.venerationStage,
    elder: ref.build.elder,
    activesOn: ref.activesOn,
    breathOn: ref.breathOn,
    ascensionAssignments: ref.build.ascensionAssignments,
  };
}

function createJobBuilder({
  base,
  cells,
  wantPerOpponent,
}: {
  base: FunnelRunnerBase;
  cells: FunnelCell[];
  wantPerOpponent: boolean;
}) {
  return (_chunk: BestBuildsPhase2Skeleton[], idx: number): BestBuildsPhase2Job => {
    const cell = cells[idx];
    return {
      kind: "bestBuildsPhase2",
      id: idx,
      sourceCreatureName: base.sourceCreatureName,
      opponentNames: cell.opponents,
      objective: base.objective,
      maxTimeSec: base.maxTimeSec,
      abilityPolicy: base.abilityPolicy,
      returnAllDistributions: false,
      returnPerOpponentOutcomes: wantPerOpponent,
      // A cell IS a rectangle - the same builds against the same opponents - so
      // it crosses into WASM once instead of once per fight.
      batchMatchups: true,
      screenFortifyFast: base.screenFortifyFast,
      ...base.extras,
      twoFacedMode: base.twoFacedMode,
      combatEventOrder: base.combatEventOrder,
      opponentBaselineBuild: base.opponentBaselineBuild,
      skeletons: cell.builds.map((ref, localIdx) => ({
        key: `${idx}:${localIdx}`,
        ...toSkeleton(ref),
      })),
    };
  };
}

/** Maps worker rows back to results while recording each row's build key into
 * `sink`; the shared execution loop only carries `BestBuildsPhase2Result`, and
 * the build shape alone is not a reliable identity across stages. */
function createRowMapper(cells: FunnelCell[], sink: FunnelCellOutcome[]) {
  return (rows: NonNullable<OptimizerWorkerResponse["bestBuildsResults"]>): BestBuildsPhase2Result[] =>
    rows.map((row) => {
      const [cellIdText, localIdText] = row.skeletonKey.split(":");
      const cell = cells[Number(cellIdText)];
      const ref = cell?.builds[Number(localIdText)];
      const result: BestBuildsPhase2Result = {
        build: row.build,
        activesOn: ref?.activesOn ?? false,
        breathOn: ref?.breathOn ?? false,
        aggregate: row.aggregate,
        opponentsCount: cell?.opponents.length ?? 0,
        ...(row.perOpponent ? { perOpponent: row.perOpponent } : {}),
      };
      sink.push({ buildKey: ref?.key ?? "", result });
      return result;
    });
}

/** Runs every cell on the calling thread - the node measurement harness and the
 * no-Worker fallback. */
export function runFunnelCellsInline({
  base,
  cells,
  wantPerOpponent,
  onProgress,
  cancelRef,
}: {
  base: FunnelRunnerBase;
  cells: FunnelCell[];
  wantPerOpponent: boolean;
  onProgress?: (value: number) => void;
  cancelRef: { current: boolean };
}): FunnelCellRunResult {
  const outcomes: FunnelCellOutcome[] = [];
  const buildPhaseJob = createJobBuilder({ base, cells, wantPerOpponent });
  const mapRows = createRowMapper(cells, outcomes);
  const pathCounts: BestBuildsPathCounts = {};
  let workUnits = 0;
  for (let idx = 0; idx < cells.length; idx += 1) {
    if (cancelRef.current) return { outcomes: [], pathCounts: {}, workerCount: 0, workUnits };
    const evaluation = evaluateBestBuildsPhase2ChunkFallback({
      chunk: cells[idx].builds.map(toSkeleton),
      chunkIndex: idx,
      buildPhaseJob,
      mapRows,
    });
    mergeBestBuildsPathCounts(pathCounts, evaluation.pathCounts);
    workUnits += evaluation.workUnits;
    onProgress?.((idx + 1) / cells.length);
  }
  return { outcomes, pathCounts, workerCount: 0, workUnits };
}

/**
 * One worker pool for a whole run. Each pool member pays a full WASM
 * instantiation on boot, so a pool per stage would spend that five times over
 * and leave the earlier pools competing for the same cores.
 */
export type FunnelWorkerPool = {
  /** Workers ready for jobs, or null when this environment has none. */
  acquire(taskCount: number): Promise<Worker[] | null>;
  dispose(): void;
};

export function createFunnelWorkerPool(): FunnelWorkerPool {
  let workers: Worker[] | null = null;
  let pending: Promise<Worker[] | null> | null = null;
  let unusable = false;

  const boot = async (taskCount: number): Promise<Worker[] | null> => {
    if (typeof Worker === "undefined") return null;
    const created = createOptimizerWorkers({
      taskCount,
      minWorkers: 1,
      maxWorkers: funnelMaxWorkers(),
    });
    const pingOk = await pingOptimizerWorkers(created);
    if (!pingOk.every(Boolean)) {
      terminateWorkers(created);
      return null;
    }
    const customRecords = listCustomCreatureRecords().map((record) => ({
      creature: record.creature,
      effects: record.effects,
      appetite: record.appetite,
      iconName: record.iconName,
    }));
    if (customRecords.length > 0) {
      const syncOk = await syncCustomCreaturesToWorkers(created, customRecords);
      if (!syncOk.every(Boolean)) {
        terminateWorkers(created);
        return null;
      }
    }
    return created;
  };

  return {
    async acquire(taskCount) {
      if (unusable) return null;
      if (workers) return workers;
      // The first stage sizes the pool; later stages reuse it rather than
      // resizing, so a narrow stage never tears down what a wide one needs.
      pending ??= boot(taskCount).then((booted) => {
        if (booted) workers = booted;
        else unusable = true;
        return booted;
      });
      return pending;
    },
    dispose() {
      if (workers) terminateWorkers(workers);
      workers = null;
      pending = null;
    },
  };
}

export function createFunnelWorkerCellRunner(
  base: FunnelRunnerBase,
  pool?: FunnelWorkerPool,
): FunnelCellRunner {
  return async ({ cells, wantPerOpponent, onProgress, cancelRef }) => {
    if (cells.length === 0) return { outcomes: [], pathCounts: {}, workerCount: 0, workUnits: 0 };
    const workers = await (pool ?? createFunnelWorkerPool()).acquire(cells.length);
    if (!workers) {
      return runFunnelCellsInline({ base, cells, wantPerOpponent, onProgress, cancelRef });
    }

    const outcomes: FunnelCellOutcome[] = [];
    const run = await runBestBuildsPhase2WorkerExecution({
      workers,
      chunks: cells.map((cell) => cell.builds.map(toSkeleton)),
      buildPhaseJob: createJobBuilder({ base, cells, wantPerOpponent }),
      mapRows: createRowMapper(cells, outcomes),
      onProgress: onProgress ?? (() => {}),
      cancelRef,
      ownsWorkers: !pool,
    });
    return {
      outcomes,
      pathCounts: run.pathCounts,
      workerCount: workers.length,
      workUnits: run.workUnits,
    };
  };
}

/** Cores to leave for the page while a run is in flight. The funnel saturates
 * every worker it opens, so the cap is the machine minus this rather than a
 * fixed 8 - a 12-thread box was leaving four cores idle. */
const FUNNEL_RESERVED_THREADS = 2;

export function funnelMaxWorkers(): number {
  const hardwareThreads =
    (typeof navigator !== "undefined" ? navigator.hardwareConcurrency : 0) || 4;
  return Math.max(1, hardwareThreads - FUNNEL_RESERVED_THREADS);
}

export function funnelWorkerCount(cellCount: number): number {
  return getOptimizerWorkerCount({
    taskCount: cellCount,
    minWorkers: 1,
    maxWorkers: funnelMaxWorkers(),
  });
}
