import type { AbilityTimingMode, TwoFacedMode } from "../engine";
import { creatureByName } from "../engine/creatureData";
import { listCustomCreatureRecords } from "../engine/customCreatures";
import type { BestBuildAggregateObjective } from "./ranking";
import { createOptimizerWorkers, getOptimizerWorkerCount, pingOptimizerWorkers, syncCustomCreaturesToWorkers, terminateWorkers } from "./optimizerWorkerClient";
import type { OptimizerWorkerResponse } from "./optimizerWorkerProtocol";
import { runBestBuildsPhase2WorkerExecution } from "./bestBuildsPhase2WorkerExecution";
import type { CombatEventPhase } from "../engine/eventOrdering";
import {
  buildPhase2Chunks,
  createBestBuildsPhase2JobBuilder,
  mapBestBuildPhase2Rows,
  mergeBestBuildsPathCounts,
  runSequentialBestBuildsPhase2Fallback,
  type BestBuildsPhase2Result,
  type BestBuildsPhase2Skeleton,
} from "./bestBuildsPhase2RuntimeHelpers";
import type { BestBuildsPathCounts } from "./optimizerWorkerProtocol";

export type { BestBuildsPhase2Result, BestBuildsPhase2Skeleton } from "./bestBuildsPhase2RuntimeHelpers";

const PHASE2_TARGET_CHUNKS_PER_WORKER = 4;

function getAdaptivePhase2MaxChunkSize(
  sourceCreatureName: string,
  skeletonCount: number,
  workerCount: number,
): number {
  const sourceCreature = creatureByName[sourceCreatureName];
  const hasHunker = (sourceCreature?.passiveAbilities ?? []).some((ability) => ability.name === "Hunker");
  if (hasHunker) return 16;
  // Target ~4 chunks per worker so the work-stealing loop in
  // runBestBuildsPhase2WorkerExecution can balance out straggler chunks
  // instead of each worker getting one giant chunk that can't be rebalanced.
  // No floor: stage2 typically has ~50 skeletons; a floor of 8 would collapse
  // back to ~1 chunk/worker and defeat work-stealing. Per-chunk marshalling
  // overhead at ~0.5ms is negligible vs per-skeleton sim cost.
  return Math.max(1, Math.ceil(skeletonCount / Math.max(1, workerCount * PHASE2_TARGET_CHUNKS_PER_WORKER)));
}

export async function runBestBuildsPhase2WithWorkers({
  sourceCreatureName,
  stage2Skeletons,
  opponentNames,
  objective,
  maxTimeSec,
  abilityPolicy,
  onProgress,
  cancelRef,
  returnAllDistributions,
  twoFacedMode,
  combatEventOrder,
  extraAbilityConfig,
  extraCombatantStats,
  extraSpecialAbilities,
  extraBuffs,
  extraTrapsTrails,
  opponentBaselineBuild,
}: {
  sourceCreatureName: string;
  stage2Skeletons: BestBuildsPhase2Skeleton[];
  opponentNames: string[];
  objective: BestBuildAggregateObjective;
  maxTimeSec: number;
  abilityPolicy: AbilityTimingMode;
  onProgress: (value: number) => void;
  cancelRef: { current: boolean };
  returnAllDistributions: boolean;
  twoFacedMode?: TwoFacedMode;
  combatEventOrder?: CombatEventPhase[];
  extraAbilityConfig?: Partial<import("./rustMatchupBridge").RustComposableAbilityConfig>;
  extraCombatantStats?: import("./bestBuildsBattleSettingsBridge").BestBuildsExtraCombatantStats;
  extraSpecialAbilities?: import("./bestBuildsBattleSettingsBridge").BestBuildsExtraSpecialAbilities;
  extraBuffs?: import("./bestBuildsBattleSettingsBridge").BestBuildsExtraBuffs;
  extraTrapsTrails?: import("./bestBuildsBattleSettingsBridge").BestBuildsExtraTrapsTrails;
  opponentBaselineBuild?: import("../engine").BuildOptions;
}): Promise<{ results: BestBuildsPhase2Result[]; pathCounts: BestBuildsPathCounts }> {
  if (stage2Skeletons.length === 0) return { results: [], pathCounts: {} };

  const workerCount = getOptimizerWorkerCount({
    taskCount: stage2Skeletons.length,
    minWorkers: 1,
    maxWorkers: 8,
  });
  const chunks = buildPhase2Chunks(
    stage2Skeletons,
    workerCount,
    getAdaptivePhase2MaxChunkSize(sourceCreatureName, stage2Skeletons.length, workerCount),
  );
  const buildPhaseJob = createBestBuildsPhase2JobBuilder({
    sourceCreatureName,
    opponentNames,
    objective,
    maxTimeSec,
    abilityPolicy,
    returnAllDistributions,
    twoFacedMode,
    combatEventOrder,
    extraAbilityConfig,
    extraCombatantStats,
    extraSpecialAbilities,
    extraBuffs,
    extraTrapsTrails,
    opponentBaselineBuild,
  });
  const mapRows = (rows: NonNullable<OptimizerWorkerResponse["bestBuildsResults"]>) =>
    mapBestBuildPhase2Rows({ rows, chunks, opponentsCount: opponentNames.length });

  if (typeof Worker === "undefined") {
    return runSequentialBestBuildsPhase2Fallback({ chunks, buildPhaseJob, mapRows, onProgress, cancelRef });
  }

  const workers = createOptimizerWorkers({
    taskCount: chunks.length,
    minWorkers: 1,
    maxWorkers: 8,
  });
  const pingOk = await pingOptimizerWorkers(workers);
  if (!pingOk.every(Boolean)) {
    terminateWorkers(workers);
    return runSequentialBestBuildsPhase2Fallback({ chunks, buildPhaseJob, mapRows, onProgress, cancelRef });
  }

  const customRecords = listCustomCreatureRecords().map((record) => ({
    creature: record.creature,
    effects: record.effects,
    appetite: record.appetite,
    iconName: record.iconName,
  }));
  if (customRecords.length > 0) {
    const syncOk = await syncCustomCreaturesToWorkers(workers, customRecords);
    if (!syncOk.every(Boolean)) {
      terminateWorkers(workers);
      return runSequentialBestBuildsPhase2Fallback({ chunks, buildPhaseJob, mapRows, onProgress, cancelRef });
    }
  }

  const results: BestBuildsPhase2Result[] = [];
  const pathCounts: BestBuildsPathCounts = {};
  const workerResult = await runBestBuildsPhase2WorkerExecution({
      workers,
      chunks,
      buildPhaseJob,
      mapRows,
      onProgress,
      cancelRef,
    });
  results.push(...workerResult.results);
  mergeBestBuildsPathCounts(pathCounts, workerResult.pathCounts);

  terminateWorkers(workers);
  return cancelRef.current ? { results: [], pathCounts: {} } : { results, pathCounts };
}
