import type { AbilityTimingMode, BuildOptions, CreatureRuntime } from "../engine";
import type { CombatEventPhase } from "../engine/eventOrdering";
import { creatureByName } from "../engine/creatureData";
import { memoizedApplyRulesAndBuild } from "./bestBuildsOptimizations";
import { simulateBestBuildMatchup } from "./bestBuildsRuntime";
import {
  aggregateBestBuildsMatchupSummary,
  compareAggregate,
  type BestBuildAggregate,
  type BestBuildAggregateObjective,
} from "./ranking";

export type BestBuildAggregateResult = {
  build: BuildOptions;
  activesOn: boolean;
  breathOn: boolean;
  aggregate: BestBuildAggregate;
  opponentsCount: number;
};

export type BestBuildSkeleton = {
  traits: string[];
  plushies: string[];
  venerationStage: number;
  elder?: BuildOptions["elder"];
  activesOn: boolean;
  breathOn: boolean;
};

export function applyWinRateGuard<T extends { aggregate: BestBuildAggregate }>(
  items: T[],
  objective: BestBuildAggregateObjective,
  guardFraction: number,
): T[] {
  // DISABLED (user request, kept as a no-op for now). This guard pruned every
  // build whose win-rate fell more than `guardFraction` below the best, for any
  // non-winRate objective. That silently hid legitimate builds - e.g. a tanky
  // survival build that loses most matchups but outlives everything. Left as a
  // pass-through (signature + call sites unchanged) so it can be re-enabled in
  // one spot later.
  void objective;
  void guardFraction;
  return items;
}

export { aggregateBestBuildsMatchupSummary, compareAggregate };

export function evaluateBestBuildAgainstPool({
  skeleton,
  sourceCreature,
  opponentNames,
  objective,
  maxTimeSec,
  abilityPolicy,
  earlyPruning = true,
  enumerateAssignmentsCounts,
  combatEventOrder,
  extraAbilityConfig,
  extraCombatantStats,
  extraSpecialAbilities,
  extraBuffs,
  extraTrapsTrails,
  opponentBaselineBuild,
}: {
  skeleton: BestBuildSkeleton;
  sourceCreature: CreatureRuntime;
  opponentNames: string[];
  objective: BestBuildAggregateObjective;
  maxTimeSec: number;
  abilityPolicy: AbilityTimingMode;
  earlyPruning?: boolean;
  enumerateAssignmentsCounts: (traitsSelection: string[], stage: number) => string[][];
  combatEventOrder?: CombatEventPhase[];
  extraAbilityConfig?: Partial<import("./rustMatchupBridge").RustComposableAbilityConfig>;
  extraCombatantStats?: import("./bestBuildsBattleSettingsBridge").BestBuildsExtraCombatantStats;
  extraSpecialAbilities?: import("./bestBuildsBattleSettingsBridge").BestBuildsExtraSpecialAbilities;
  extraBuffs?: import("./bestBuildsBattleSettingsBridge").BestBuildsExtraBuffs;
  extraTrapsTrails?: import("./bestBuildsBattleSettingsBridge").BestBuildsExtraTrapsTrails;
  opponentBaselineBuild?: BuildOptions;
}): BestBuildAggregateResult {
  const assignments = enumerateAssignmentsCounts(skeleton.traits, skeleton.venerationStage);
  let bestBuild: BuildOptions | null = null;
  let bestAggregate: BestBuildAggregate | null = null;

  for (const ascensionAssignments of assignments) {
    const build: BuildOptions = {
      venerationStage: skeleton.venerationStage,
      traits: skeleton.traits,
      ascensionAssignments,
      plushies: skeleton.plushies,
      elder: skeleton.elder ?? "None",
    };
    const finalA = memoizedApplyRulesAndBuild(sourceCreature, build);
    let wins = 0;
    let draws = 0;
    let sumSurvival = 0;
    let sumDps = 0;
    let sumTtk = 0;
    let sumImmortal = 0;

    for (let oppIndex = 0; oppIndex < opponentNames.length; oppIndex += 1) {
      const opponentName = opponentNames[oppIndex];
      const opponentCreature = creatureByName[opponentName];
      if (!opponentCreature) continue;
      const summary = simulateBestBuildMatchup({
        sourceCreature,
        sourceBuild: build,
        finalA,
        opponentCreature,
        opponentBaselineBuild,
        activesOn: skeleton.activesOn,
        breathOn: skeleton.breathOn,
        maxTimeSec,
        abilityPolicy,
        combatEventOrder,
        extraAbilityConfig,
        extraCombatantStats,
        extraSpecialAbilities,
        extraBuffs,
        extraTrapsTrails,
      });
      const agg = aggregateBestBuildsMatchupSummary(summary);
      wins += agg.win;
      draws += agg.draw;
      sumSurvival += agg.survival;
      sumDps += agg.avgDps;
      // TTK = damage-race kill time for every opponent (like Compare), not just
      // the ones you beat - so a build that loses but crushes fast still gets a
      // meaningful TTK instead of the max-time placeholder.
      sumTtk += agg.ttkWin;
      sumImmortal += agg.immortalDamage;

      if (earlyPruning && bestAggregate) {
        const seen = oppIndex + 1;
        const remaining = Math.max(0, opponentNames.length - seen);

        if (objective === "winRate") {
          const optimisticWinRate = (wins + draws + remaining) / Math.max(1, opponentNames.length);
          if (optimisticWinRate < bestAggregate.winRate - 0.0001) {
            break;
          }
        } else if (objective === "avgDps") {
          const pessimisticAvgDps = sumDps / Math.max(1, opponentNames.length);
          if (pessimisticAvgDps < bestAggregate.avgDps - 0.01) {
            break;
          }
        } else if (objective === "survival") {
          const pessimisticAvgSurvival = sumSurvival / Math.max(1, opponentNames.length);
          if (pessimisticAvgSurvival < bestAggregate.avgSurvival - 0.5) {
            break;
          }
        } else if (objective === "immortalDamage") {
          const pessimisticAvgImmortal = sumImmortal / Math.max(1, opponentNames.length);
          if (pessimisticAvgImmortal < bestAggregate.avgImmortalDamage - 1.0) {
            break;
          }
        }
      }
    }

    const count = Math.max(1, opponentNames.length);
    const aggregate: BestBuildAggregate = {
      winRate: (wins + draws) / count,
      drawRate: draws / count,
      avgSurvival: sumSurvival / count,
      avgDps: sumDps / count,
      avgTtkWin: sumTtk / count,
      avgImmortalDamage: sumImmortal / count,
    };

    if (!bestAggregate || compareAggregate(aggregate, bestAggregate, objective) < 0) {
      bestBuild = build;
      bestAggregate = aggregate;
    }
  }

  return {
    build:
      bestBuild ?? {
        venerationStage: skeleton.venerationStage,
        traits: skeleton.traits,
        ascensionAssignments: ["", "", "", "", ""],
        plushies: skeleton.plushies,
        elder: skeleton.elder ?? "None",
      },
    activesOn: skeleton.activesOn,
    breathOn: skeleton.breathOn,
    aggregate: bestAggregate ?? {
      winRate: 0,
      drawRate: 0,
      avgSurvival: 0,
      avgDps: 0,
      avgTtkWin: maxTimeSec,
      avgImmortalDamage: 0,
    },
    opponentsCount: opponentNames.length,
  };
}
