import type { AbilityTimingMode, CreatureRuntime, TwoFacedMode } from "../engine";
import { DEFAULT_MAX_TIME_SEC } from "../engine/subsystems/timing";
import { rerankBestBuildResultsByCommonWins } from "./bestBuildsCommonWinsRanking";
import {
  type BestBuildAggregateResult,
  buildRefinementSkeletons,
} from "./bestBuildsFlow";
import { runBestBuildsPhase2WithWorkers } from "./bestBuildsPhase2Runtime";
import { compareAggregate, type BestBuildAggregateObjective } from "./ranking";
import { plushiePairKey } from "../shared/buildEncoding";
import type { CombatEventPhase } from "../engine/eventOrdering";

export async function finalizeBestBuildsResults({
  finalResults,
  creature,
  activePool,
  objective,
  abilityPolicy,
  combatEventOrder,
  extraAbilityConfig,
  extraCombatantStats,
  extraSpecialAbilities,
  extraBuffs,
  extraTrapsTrails,
  opponentBaselineBuild,
}: {
  finalResults: BestBuildAggregateResult[];
  creature: CreatureRuntime;
  activePool: string[];
  objective: BestBuildAggregateObjective;
  abilityPolicy: AbilityTimingMode;
  combatEventOrder?: CombatEventPhase[];
  extraAbilityConfig?: Partial<import("./rustMatchupBridge").RustComposableAbilityConfig>;
  extraCombatantStats?: import("./bestBuildsBattleSettingsBridge").BestBuildsExtraCombatantStats;
  extraSpecialAbilities?: import("./bestBuildsBattleSettingsBridge").BestBuildsExtraSpecialAbilities;
  extraBuffs?: import("./bestBuildsBattleSettingsBridge").BestBuildsExtraBuffs;
  extraTrapsTrails?: import("./bestBuildsBattleSettingsBridge").BestBuildsExtraTrapsTrails;
  opponentBaselineBuild?: import("../engine").BuildOptions;
}): Promise<BestBuildAggregateResult[]> {
  return rerankBestBuildResultsByCommonWins({
    results: finalResults,
    sourceCreature: creature,
    activePool,
    objective,
    showAllAscensionDistributions: false,
    abilityPolicy,
    combatEventOrder,
    extraAbilityConfig,
    extraCombatantStats,
    extraSpecialAbilities,
    extraBuffs,
    extraTrapsTrails,
    opponentBaselineBuild,
  });
}

export async function runBestBuildsRefinement({
  creature,
  activePool,
  ranked,
  objective,
  abilityPolicy,
  onProgress,
  cancelRef,
  unlockAscension,
  unlockElder,
  twoFacedMode,
  combatEventOrder,
  extraAbilityConfig,
  extraCombatantStats,
  extraSpecialAbilities,
  extraBuffs,
  extraTrapsTrails,
  opponentBaselineBuild,
}: {
  creature: CreatureRuntime;
  activePool: string[];
  ranked: BestBuildAggregateResult[];
  objective: BestBuildAggregateObjective;
  abilityPolicy: AbilityTimingMode;
  onProgress: (value: number) => void;
  cancelRef: { current: boolean };
  unlockAscension: boolean;
  unlockElder: boolean;
  twoFacedMode?: TwoFacedMode;
  combatEventOrder?: CombatEventPhase[];
  extraAbilityConfig?: Partial<import("./rustMatchupBridge").RustComposableAbilityConfig>;
  extraCombatantStats?: import("./bestBuildsBattleSettingsBridge").BestBuildsExtraCombatantStats;
  extraSpecialAbilities?: import("./bestBuildsBattleSettingsBridge").BestBuildsExtraSpecialAbilities;
  extraBuffs?: import("./bestBuildsBattleSettingsBridge").BestBuildsExtraBuffs;
  extraTrapsTrails?: import("./bestBuildsBattleSettingsBridge").BestBuildsExtraTrapsTrails;
  opponentBaselineBuild?: import("../engine").BuildOptions;
}) {
  const refinementSkeletons = buildRefinementSkeletons(ranked.slice(0, 10), {
    unlockAscension,
    unlockElder,
  });
  return runBestBuildsPhase2WithWorkers({
    sourceCreatureName: creature.name,
    stage2Skeletons: refinementSkeletons,
    opponentNames: activePool,
    objective,
    maxTimeSec: DEFAULT_MAX_TIME_SEC,
    abilityPolicy,
    onProgress: (value) => onProgress(0.9 + value * 0.1),
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
}

export function mergeRefinedBestBuildResults({
  baseResults,
  refinedResults,
  objective,
  unlockElder,
}: {
  baseResults: BestBuildAggregateResult[];
  refinedResults: BestBuildAggregateResult[];
  objective: BestBuildAggregateObjective;
  unlockElder: boolean;
}): BestBuildAggregateResult[] {
  if (refinedResults.length === 0) return baseResults;
  const refinedByKey = new Map<string, BestBuildAggregateResult>();
  for (const result of refinedResults) {
    refinedByKey.set(buildRefinementFamilyKey(result, unlockElder), result);
  }

  const merged = baseResults.map((result) => {
    const key = buildRefinementFamilyKey(result, unlockElder);
    const refined = refinedByKey.get(key);
    if (!refined) return result;
    return compareAggregate(refined.aggregate, result.aggregate, objective) <= 0 ? refined : result;
  });

  for (const [key, result] of refinedByKey.entries()) {
    const alreadyPresent = merged.some(
      (row) => buildRefinementFamilyKey(row, unlockElder) === key,
    );
    if (!alreadyPresent) merged.push(result);
  }

  return merged;
}

function buildRefinementFamilyKey(
  result: BestBuildAggregateResult,
  unlockElder: boolean,
): string {
  const traitKey = [...result.build.traits].sort().join("+");
  const elderKey = unlockElder ? "" : result.build.elder ?? "None";
  return `${result.build.venerationStage}::${traitKey}::${plushiePairKey(result.build.plushies)}::${elderKey}::${result.activesOn ? 1 : 0}${result.breathOn ? 1 : 0}`;
}
