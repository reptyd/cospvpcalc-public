import type { AbilityTimingMode, CreatureRuntime } from "../engine";
import type { CombatEventPhase } from "../engine/eventOrdering";
import { DEFAULT_MAX_TIME_SEC } from "../engine/subsystems/timing";
import { applyWinRateGuard, compareAggregate, evaluateBestBuildAgainstPool } from "./bestBuildsEvaluation";
import type { BestBuildAggregateResult, BestBuildFlowSkeleton as Skeleton } from "./bestBuildsFlow";
import type { BestBuildAggregateObjective } from "./ranking";

export async function runSequentialBestBuildsFallback({
  stage2Skeletons,
  creature,
  activePool,
  objective,
  winRateGuardPct,
  abilityPolicy,
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
}: {
  stage2Skeletons: Skeleton[];
  creature: CreatureRuntime;
  activePool: string[];
  objective: BestBuildAggregateObjective;
  winRateGuardPct: number;
  abilityPolicy: AbilityTimingMode;
  earlyPruning: boolean;
  enumerateAssignmentsCounts: (traitsSelection: string[], stage: number) => string[][];
  onProgress: (value: number) => void;
  onPartialResults: (results: BestBuildAggregateResult[]) => void;
  cancelRef: { current: boolean };
  combatEventOrder?: CombatEventPhase[];
  extraAbilityConfig?: Partial<import("./rustMatchupBridge").RustComposableAbilityConfig>;
  extraCombatantStats?: import("./bestBuildsBattleSettingsBridge").BestBuildsExtraCombatantStats;
  extraSpecialAbilities?: import("./bestBuildsBattleSettingsBridge").BestBuildsExtraSpecialAbilities;
  extraBuffs?: import("./bestBuildsBattleSettingsBridge").BestBuildsExtraBuffs;
  extraTrapsTrails?: import("./bestBuildsBattleSettingsBridge").BestBuildsExtraTrapsTrails;
  opponentBaselineBuild?: import("../engine").BuildOptions;
}): Promise<BestBuildAggregateResult[]> {
  let processed = 0;
  const progressiveResults: BestBuildAggregateResult[] = [];

  for (const skeleton of stage2Skeletons) {
    if (cancelRef.current) break;

    const best = evaluateBestBuildAgainstPool({
      skeleton,
      sourceCreature: creature,
      opponentNames: activePool,
      objective,
      maxTimeSec: DEFAULT_MAX_TIME_SEC,
      abilityPolicy,
      earlyPruning,
      enumerateAssignmentsCounts,
      combatEventOrder,
      extraAbilityConfig,
      extraCombatantStats,
      extraSpecialAbilities,
      extraBuffs,
      extraTrapsTrails,
      opponentBaselineBuild,
    });

    progressiveResults.push(best);
    processed += 1;

    if (processed % 3 === 0) {
      onProgress(0.5 + (processed / Math.max(1, stage2Skeletons.length)) * 0.5);
      const ranked = applyWinRateGuard([...progressiveResults], objective, winRateGuardPct / 100)
        .sort((a, b) => compareAggregate(a.aggregate, b.aggregate, objective))
        .slice(0, 10);
      onPartialResults(ranked);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  return progressiveResults;
}
