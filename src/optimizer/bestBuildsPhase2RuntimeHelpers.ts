import type { AbilityTimingMode, BuildOptions, TwoFacedMode } from "../engine";
import { evaluateBestBuildsPhase2Job } from "./bestBuildsPhase2Evaluation";
import type { CombatEventPhase } from "../engine/eventOrdering";
import type { BestBuildAggregate, BestBuildAggregateObjective } from "./ranking";
import type { BestBuildsPathCounts, BestBuildsPhase2Job, OptimizerWorkerResponse } from "./optimizerWorkerProtocol";

export type BestBuildsPhase2Skeleton = {
  traits: string[];
  plushies: string[];
  venerationStage: number;
  elder?: BuildOptions["elder"];
  activesOn: boolean;
  breathOn: boolean;
  ascensionAssignments?: string[];
};

export type BestBuildsPhase2Result = {
  build: BuildOptions;
  activesOn: boolean;
  breathOn: boolean;
  aggregate: BestBuildAggregate;
  opponentsCount: number;
};

export function mergeBestBuildsPathCounts(
  target: BestBuildsPathCounts,
  incoming: BestBuildsPathCounts | undefined,
): BestBuildsPathCounts {
  if (!incoming) return target;
  for (const [path, count] of Object.entries(incoming)) {
    target[path] = (target[path] ?? 0) + count;
  }
  return target;
}

export function buildPhase2Chunks(
  stage2Skeletons: BestBuildsPhase2Skeleton[],
  workerCount: number,
  maxChunkSize = Number.POSITIVE_INFINITY,
): BestBuildsPhase2Skeleton[][] {
  const chunkSize = Math.max(1, Math.min(maxChunkSize, Math.ceil(stage2Skeletons.length / workerCount)));
  const chunks: BestBuildsPhase2Skeleton[][] = [];
  for (let i = 0; i < stage2Skeletons.length; i += chunkSize) {
    chunks.push(stage2Skeletons.slice(i, i + chunkSize));
  }
  return chunks;
}

export function createBestBuildsPhase2JobBuilder({
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
}: {
  sourceCreatureName: string;
  opponentNames: string[];
  objective: BestBuildAggregateObjective;
  maxTimeSec: number;
  abilityPolicy: AbilityTimingMode;
  returnAllDistributions: boolean;
  twoFacedMode?: TwoFacedMode;
  combatEventOrder?: CombatEventPhase[];
  extraAbilityConfig?: Partial<import("./rustMatchupBridge").RustComposableAbilityConfig>;
  extraCombatantStats?: import("./bestBuildsBattleSettingsBridge").BestBuildsExtraCombatantStats;
  extraSpecialAbilities?: import("./bestBuildsBattleSettingsBridge").BestBuildsExtraSpecialAbilities;
  extraBuffs?: import("./bestBuildsBattleSettingsBridge").BestBuildsExtraBuffs;
  extraTrapsTrails?: import("./bestBuildsBattleSettingsBridge").BestBuildsExtraTrapsTrails;
  opponentBaselineBuild?: BuildOptions;
}) {
  return (chunk: BestBuildsPhase2Skeleton[], idx: number): BestBuildsPhase2Job => ({
    kind: "bestBuildsPhase2",
    id: idx,
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
    skeletons: chunk.map((skeleton, localIdx) => ({
      key: `${idx}:${localIdx}`,
      traits: skeleton.traits,
      plushies: skeleton.plushies,
      venerationStage: skeleton.venerationStage,
      elder: skeleton.elder,
      activesOn: skeleton.activesOn,
      breathOn: skeleton.breathOn,
      ascensionAssignments: skeleton.ascensionAssignments,
    })),
  });
}

export function mapBestBuildPhase2Rows({
  rows,
  chunks,
  opponentsCount,
}: {
  rows: NonNullable<OptimizerWorkerResponse["bestBuildsResults"]>;
  chunks: BestBuildsPhase2Skeleton[][];
  opponentsCount: number;
}): BestBuildsPhase2Result[] {
  const results: BestBuildsPhase2Result[] = [];
  for (const row of rows) {
    const [chunkIdText, localIdText] = row.skeletonKey.split(":");
    const cIdx = Number(chunkIdText);
    const lIdx = Number(localIdText);
    const skeleton = chunks[cIdx]?.[lIdx];
    if (!skeleton) continue;
    results.push({
      build: row.build,
      activesOn: skeleton.activesOn,
      breathOn: skeleton.breathOn,
      aggregate: row.aggregate,
      opponentsCount,
    });
  }
  return results;
}

export async function runSequentialBestBuildsPhase2Fallback({
  chunks,
  buildPhaseJob,
  mapRows,
  onProgress,
  cancelRef,
}: {
  chunks: BestBuildsPhase2Skeleton[][];
  buildPhaseJob: (chunk: BestBuildsPhase2Skeleton[], idx: number) => BestBuildsPhase2Job;
  mapRows: (rows: NonNullable<OptimizerWorkerResponse["bestBuildsResults"]>) => BestBuildsPhase2Result[];
  onProgress: (value: number) => void;
  cancelRef: { current: boolean };
}): Promise<{ results: BestBuildsPhase2Result[]; pathCounts: BestBuildsPathCounts }> {
  const fallbackResults: BestBuildsPhase2Result[] = [];
  const pathCounts: BestBuildsPathCounts = {};
  for (let idx = 0; idx < chunks.length; idx += 1) {
    if (cancelRef.current) return { results: [], pathCounts: {} };
    const evaluation = evaluateBestBuildsPhase2Job(buildPhaseJob(chunks[idx], idx));
    fallbackResults.push(...mapRows(evaluation.bestBuildsResults));
    mergeBestBuildsPathCounts(pathCounts, evaluation.pathCounts);
    onProgress(Math.min(1, (idx + 1) / Math.max(1, chunks.length)));
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return { results: fallbackResults, pathCounts };
}

export function evaluateBestBuildsPhase2ChunkFallback({
  chunk,
  chunkIndex,
  buildPhaseJob,
  mapRows,
}: {
  chunk: BestBuildsPhase2Skeleton[];
  chunkIndex: number;
  buildPhaseJob: (chunk: BestBuildsPhase2Skeleton[], idx: number) => BestBuildsPhase2Job;
  mapRows: (rows: NonNullable<OptimizerWorkerResponse["bestBuildsResults"]>) => BestBuildsPhase2Result[];
}): { results: BestBuildsPhase2Result[]; pathCounts: BestBuildsPathCounts } {
  const evaluation = evaluateBestBuildsPhase2Job(buildPhaseJob(chunk, chunkIndex));
  return {
    results: mapRows(evaluation.bestBuildsResults),
    pathCounts: evaluation.pathCounts,
  };
}
