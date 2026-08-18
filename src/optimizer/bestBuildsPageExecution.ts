import type { AbilityTimingMode, BuildOptions, CreatureRuntime, TwoFacedMode } from "../engine";
import { DEFAULT_MAX_TIME_SEC } from "../engine/subsystems/timing";
import { compareAggregate } from "./bestBuildsEvaluation";
import { objectiveBuildFit } from "./candidateGenerationScoring";
import type { BestBuildAggregateResult, BestBuildFlowSkeleton as Skeleton } from "./bestBuildsFlow";
import { buildStageShortlists } from "./bestBuildsFlow";
import { runSequentialBestBuildsFallback } from "./bestBuildsPageFallback";
import { finalizeBestBuildsResults, mergeRefinedBestBuildResults, runBestBuildsRefinement } from "./bestBuildsPageRefinement";
import { runBestBuildsPhase2WithWorkers } from "./bestBuildsPhase2Runtime";
import { BB_FUNNEL_ENABLED } from "./bbFunnel/bbFunnelFlag";
import { runBestBuildsFunnelPipeline } from "./bbFunnel/funnelPipeline";
import { optimizerDebugLog } from "./debug";
import type { BestBuildAggregateObjective } from "./ranking";
import type { BestBuildsPathCounts } from "./optimizerWorkerProtocol";
import { selectSkeletonsForStage1 } from "./stageSelection";
import type { CombatEventPhase } from "../engine/eventOrdering";

export type BestBuildsStageTimings = {
  stage1Ms: number;
  shortlistMs: number;
  stage2Ms: number;
  refinementMs: number;
  finalizeMs: number;
};

export type BestBuildsRuntimePathTelemetry = {
  stage1: BestBuildsPathCounts;
  stage2: BestBuildsPathCounts;
};

const BEST_BUILDS_STAGE1_MAX_TIME_SEC = 180;
const BEST_BUILDS_STAGE1_INPUT_CAP = 1000;

export async function executeBestBuildsSearch({
  creature,
  activePool,
  quickPool,
  uniqueSkeletons,
  objective,
  winRateGuardPct,
  targetAscensionLock,
  targetElderLock,
  targetConstraints,
  showAllAscensionDistributions,
  earlyPruning,
  stage1TopK,
  stage2Cap,
  quickAbilityPolicy,
  stage2AbilityPolicy,
  refinementAbilityPolicy,
  enumerateAssignmentsCounts,
  onProgress,
  onPartialResults,
  cancelRef,
  twoFacedMode,
  stage1InputCap,
  combatEventOrder,
  extraAbilityConfig,
  extraCombatantStats,
  extraSpecialAbilities,
  extraBuffs,
  extraTrapsTrails,
  opponentBaselineBuild,
  maxTimeSec,
}: {
  creature: CreatureRuntime;
  activePool: string[];
  quickPool: string[];
  uniqueSkeletons: Skeleton[];
  objective: BestBuildAggregateObjective;
  winRateGuardPct: number;
  targetAscensionLock: boolean;
  targetElderLock?: boolean;
  targetConstraints: BuildOptions;
  showAllAscensionDistributions: boolean;
  earlyPruning: boolean;
  stage1TopK: number;
  stage2Cap: number;
  quickAbilityPolicy: AbilityTimingMode;
  stage2AbilityPolicy: AbilityTimingMode;
  refinementAbilityPolicy: AbilityTimingMode;
  enumerateAssignmentsCounts: (traitsSelection: string[], stage: number) => string[][];
  onProgress: (value: number) => void;
  onPartialResults: (results: BestBuildAggregateResult[]) => void;
  cancelRef: { current: boolean };
  twoFacedMode?: TwoFacedMode;
  stage1InputCap?: number;
  combatEventOrder?: CombatEventPhase[];
  extraAbilityConfig?: Partial<import("./rustMatchupBridge").RustComposableAbilityConfig>;
  extraCombatantStats?: import("./bestBuildsBattleSettingsBridge").BestBuildsExtraCombatantStats;
  extraSpecialAbilities?: import("./bestBuildsBattleSettingsBridge").BestBuildsExtraSpecialAbilities;
  extraBuffs?: import("./bestBuildsBattleSettingsBridge").BestBuildsExtraBuffs;
  extraTrapsTrails?: import("./bestBuildsBattleSettingsBridge").BestBuildsExtraTrapsTrails;
  opponentBaselineBuild?: BuildOptions;
  /** Per-matchup fight ceiling. When set (the single-opponent Optimizer passes
   * Compare's 900s), every scoring stage uses it so a fight that resolves past
   * 480s isn't truncated into a time-cap draw and mis-scored as a win. Best
   * Builds leaves it unset and keeps the cheaper pool caps (180s / 480s). */
  maxTimeSec?: number;
}): Promise<{ results: BestBuildAggregateResult[]; timings: BestBuildsStageTimings; runtimePathTelemetry: BestBuildsRuntimePathTelemetry }> {
  const stage1MaxTimeSec = maxTimeSec ?? BEST_BUILDS_STAGE1_MAX_TIME_SEC;
  const evalMaxTimeSec = maxTimeSec ?? DEFAULT_MAX_TIME_SEC;
  const effectiveStage1InputCap = stage1InputCap ?? BEST_BUILDS_STAGE1_INPUT_CAP;

  // The funnel replaces the whole staged search. The old shape screened a
  // 1000-skeleton cap on a substituted policy and carried a fixed shortlist
  // into `ideal`; measurement put true top-10 builds outside both cuts. The
  // funnel instead dedups by combat signature, prunes a skyline, screens what
  // survives on Fortify's fast gate, and re-fights the leading band against the
  // whole pool at the caller's policy - which is where every displayed number
  // comes from.
  if (BB_FUNNEL_ENABLED) {
    const funnelStartedAt = performance.now();
    const funnelRun = await runBestBuildsFunnelPipeline({
      creature,
      activePool,
      uniqueSkeletons,
      objective,
      maxTimeSec: evalMaxTimeSec,
      combatEventOrder,
      opponentBaselineBuild,
      twoFacedMode,
      unlockAscension: !targetAscensionLock,
      unlockElder: !targetElderLock,
      completionPolicy: refinementAbilityPolicy,
      onProgress,
      cancelRef,
      extras: {
        extraAbilityConfig,
        extraCombatantStats,
        extraSpecialAbilities,
        extraBuffs,
        extraTrapsTrails,
      },
    });
    const funnelMs = performance.now() - funnelStartedAt;
    optimizerDebugLog(
      `[DEBUG] Funnel ${(funnelMs / 1000).toFixed(1)}s: ${funnelRun.telemetry.candidates} candidates -> ` +
        `${funnelRun.telemetry.survivors} survivors -> ${funnelRun.telemetry.coarseFirstCut} first cut -> ` +
        `${funnelRun.telemetry.shortlist} shortlist -> ${funnelRun.telemetry.completedBuilds} completed`,
      { timings: funnelRun.timings, fights: {
        probe: funnelRun.telemetry.probeFights,
        coarse: funnelRun.telemetry.coarseFights,
        mid: funnelRun.telemetry.midFights,
        refine: funnelRun.telemetry.refineFights,
        top: funnelRun.telemetry.topFights,
      }, workers: funnelRun.telemetry.workerCount, paths: funnelRun.pathCounts },
    );
    if (cancelRef.current) {
      return {
        results: [],
        timings: { stage1Ms: 0, shortlistMs: 0, stage2Ms: funnelMs, refinementMs: 0, finalizeMs: 0 },
        runtimePathTelemetry: { stage1: {}, stage2: funnelRun.pathCounts },
      };
    }
    // No finalize pass: the funnel already ranked on common wins from the
    // per-opponent rows its own fights produced, so the legacy re-simulation
    // would re-run the whole pool to reach the same order.
    onProgress(1);
    return {
      results: funnelRun.results,
      timings: {
        stage1Ms: funnelRun.timings.prepareMs + funnelRun.timings.anchorMs + funnelRun.timings.coarseMs,
        shortlistMs: 0,
        stage2Ms: funnelRun.timings.midMs + funnelRun.timings.refineMs + funnelRun.timings.topMs,
        refinementMs: 0,
        finalizeMs: funnelRun.timings.rankMs,
      },
      runtimePathTelemetry: { stage1: {}, stage2: funnelRun.pathCounts },
    };
  }

  const stage1Input = selectSkeletonsForStage1(uniqueSkeletons, effectiveStage1InputCap, true);
  optimizerDebugLog(`[DEBUG] Stage 1: Parallel evaluation of ${stage1Input.length}/${uniqueSkeletons.length} skeletons against ${quickPool.length} opponents`);
  optimizerDebugLog(`[DEBUG] Source creature name: "${creature.name}"`);

  const stage1StartedAt = performance.now();
  const stage1Run = await runBestBuildsPhase2WithWorkers({
    sourceCreatureName: creature.name,
    stage2Skeletons: stage1Input,
    opponentNames: quickPool,
    objective,
    maxTimeSec: stage1MaxTimeSec,
    abilityPolicy: quickAbilityPolicy,
    onProgress: (value) => onProgress(value * 0.5),
    cancelRef,
    returnAllDistributions: false,
    twoFacedMode,
    combatEventOrder,
    extraAbilityConfig,
    extraCombatantStats,
    extraSpecialAbilities,
    extraBuffs,
    extraTrapsTrails,
    opponentBaselineBuild,
  });
  const stage1Results = stage1Run.results;
  const stage1Ms = performance.now() - stage1StartedAt;

  const quickScored: Array<{ skeleton: Skeleton; aggregate: BestBuildAggregateResult["aggregate"] }> = stage1Results.map((result) => ({
    skeleton: {
      venerationStage: result.build.venerationStage,
      traits: result.build.traits,
      plushies: result.build.plushies,
      elder: result.build.elder ?? "None",
      activesOn: result.activesOn,
      breathOn: result.breathOn,
      preScore: 0,
      ascensionAssignments: targetAscensionLock ? targetConstraints.ascensionAssignments : undefined,
    },
    aggregate: result.aggregate,
  }));

  const shortlistStartedAt = performance.now();
  const { quickRanked, stage2Skeletons } = buildStageShortlists({
    quickScored,
    objective,
    winRateGuardPct,
    stage1TopK,
    stage2Cap,
  });
  const shortlistMs = performance.now() - shortlistStartedAt;

  logVoidPigDiagnostics(quickRanked, quickScored.length);

  const stage2StartedAt = performance.now();
  const stage2Run = await runBestBuildsPhase2WithWorkers({
        sourceCreatureName: creature.name,
        stage2Skeletons,
        opponentNames: activePool,
        objective,
        maxTimeSec: evalMaxTimeSec,
        abilityPolicy: stage2AbilityPolicy,
        onProgress: (value) => onProgress(0.5 + value * 0.5),
        cancelRef,
        returnAllDistributions: false,
        twoFacedMode,
        combatEventOrder,
        extraAbilityConfig,
        extraCombatantStats,
        extraSpecialAbilities,
        extraBuffs,
        extraTrapsTrails,
        opponentBaselineBuild,
      });
  let finalResults = stage2Run.results;

  if (finalResults.length === 0 && !cancelRef.current) {
    optimizerDebugLog("[DEBUG] Falling back to sequential processing (workers returned empty)");
    finalResults = await runSequentialBestBuildsFallback({
      stage2Skeletons,
      creature,
      activePool,
      objective,
      winRateGuardPct,
      abilityPolicy: stage2AbilityPolicy,
      earlyPruning,
      enumerateAssignmentsCounts,
      onProgress,
      onPartialResults,
      cancelRef,
      combatEventOrder,
      extraAbilityConfig,
      extraCombatantStats,
      extraSpecialAbilities,
      extraBuffs,
      extraTrapsTrails,
      opponentBaselineBuild,
      maxTimeSec: evalMaxTimeSec,
    });
  }
  const stage2Ms = performance.now() - stage2StartedAt;

  if (cancelRef.current) {
    return {
      results: [],
      timings: {
        stage1Ms,
        shortlistMs,
        stage2Ms,
        refinementMs: 0,
        finalizeMs: 0,
      },
      runtimePathTelemetry: {
        stage1: stage1Run.pathCounts,
        stage2: stage2Run.pathCounts,
      },
    };
  }

  // Pick the top builds to ascension-refine. Tie-break by objective fit so the
  // refinement pool isn't skewed toward off-objective traits (e.g. the
  // Health=regen trait winning DPS ties), and offence builds get refined for
  // DPS/TTK just like regen builds get refined for survival.
  const ranked = [...finalResults]
    .sort((a, b) => {
      const m = compareAggregate(a.aggregate, b.aggregate, objective);
      if (m !== 0) return m;
      return objectiveBuildFit(b.build, objective) - objectiveBuildFit(a.build, objective);
    })
    .slice(0, 10);

  let allResults = finalResults;
  let refinementMs = 0;
  if (showAllAscensionDistributions && (!targetAscensionLock || !targetElderLock) && ranked.length > 0) {
    const refinementStartedAt = performance.now();
    const refinementRun = await runBestBuildsRefinement({
      creature,
      activePool,
      ranked,
      objective,
      abilityPolicy: refinementAbilityPolicy,
      onProgress,
      cancelRef,
      unlockAscension: !targetAscensionLock,
      unlockElder: !targetElderLock,
      twoFacedMode,
      combatEventOrder,
      extraAbilityConfig,
      extraCombatantStats,
      extraSpecialAbilities,
      extraBuffs,
      extraTrapsTrails,
      opponentBaselineBuild,
      maxTimeSec: evalMaxTimeSec,
    });
    refinementMs = performance.now() - refinementStartedAt;
    allResults = mergeRefinedBestBuildResults({
      baseResults: finalResults,
      refinedResults: refinementRun.results,
      objective,
      unlockElder: !targetElderLock,
    });
  }

  const finalizeStartedAt = performance.now();
  const results = await finalizeBestBuildsResults({
    finalResults: allResults,
    creature,
    activePool,
    objective,
    abilityPolicy: refinementAbilityPolicy,
    combatEventOrder,
    extraAbilityConfig,
    extraCombatantStats,
    extraSpecialAbilities,
    extraBuffs,
    extraTrapsTrails,
    opponentBaselineBuild,
    maxTimeSec: evalMaxTimeSec,
  });
  const finalizeMs = performance.now() - finalizeStartedAt;
  optimizerDebugLog(`[DEBUG] After dedup (showAll=${showAllAscensionDistributions}), showing top ${results.length}`);
  return {
    results,
    timings: {
      stage1Ms,
      shortlistMs,
      stage2Ms,
      refinementMs,
      finalizeMs,
    },
    runtimePathTelemetry: {
      stage1: stage1Run.pathCounts,
      stage2: stage2Run.pathCounts,
    },
  };
}

function logVoidPigDiagnostics(
  quickRanked: Array<{ skeleton: Skeleton; aggregate: BestBuildAggregateResult["aggregate"] }>,
  quickScoredCount: number,
): void {
  const voidPigSkeleton = quickRanked.find((item) =>
    item.skeleton.plushies.includes("Void") &&
    item.skeleton.plushies.includes("Pig-Lantern") &&
    item.skeleton.traits.includes("Bite") &&
    item.skeleton.traits.includes("Damage"),
  );
  optimizerDebugLog(`[DEBUG] Stage 1 shortlist: ${quickRanked.length}/${quickScoredCount}`);
  optimizerDebugLog(`[DEBUG] Stage 1: Void+Pig-Lantern skeleton ${voidPigSkeleton ? "FOUND" : "NOT FOUND"} in shortlist`);
  if (voidPigSkeleton) {
    const rank = quickRanked.indexOf(voidPigSkeleton) + 1;
    optimizerDebugLog(`[DEBUG] Stage 1: Void+Pig-Lantern rank: ${rank}/${quickRanked.length}, avgTtk: ${voidPigSkeleton.aggregate.avgTtkWin.toFixed(2)}s`);
  }
}
