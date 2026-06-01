import type { BuildOptions } from "../engine";
import { elderOptions } from "../engine/buildData";
import { creatureByName } from "../engine/creatureData";
import { enumerateAssignmentsCounts } from "../shared/buildDomain";
import { memoizedApplyRulesAndBuild, setActiveTwoFacedMode } from "./bestBuildsOptimizations";
import { simulateBestBuildMatchupWithPath } from "./bestBuildsRuntime";
import { aggregateBestBuildsMatchupSummary, compareAggregate } from "./ranking";
import type { BestBuildsPathCounts, BestBuildsPhase2Job, BestBuildsWorkerResult } from "./optimizerWorkerProtocol";

export function evaluateBestBuildsPhase2Job(phaseJob: BestBuildsPhase2Job): {
  bestBuildsResults: BestBuildsWorkerResult[];
  pathCounts: BestBuildsPathCounts;
} {
  const sourceCreature = creatureByName[phaseJob.sourceCreatureName];
  if (!sourceCreature) return { bestBuildsResults: [], pathCounts: {} };

  if (phaseJob.twoFacedMode) setActiveTwoFacedMode(phaseJob.twoFacedMode);

  const bestBuildsResults: BestBuildsWorkerResult[] = [];
  const pathCounts: BestBuildsPathCounts = {};

  for (const skeleton of phaseJob.skeletons) {
    const elders = skeleton.elder ? [skeleton.elder] : elderOptions;
    const splits = skeleton.ascensionAssignments
      ? [skeleton.ascensionAssignments]
      : enumerateAssignmentsCounts(skeleton.traits, skeleton.venerationStage);

    const allTestedBuilds: Array<{
      build: BuildOptions;
      aggregate: BestBuildsWorkerResult["aggregate"];
    }> = [];

    for (const elder of elders) {
      for (const ascensionAssignments of splits) {
        const build: BuildOptions = {
          venerationStage: skeleton.venerationStage,
          traits: skeleton.traits,
          ascensionAssignments,
          plushies: skeleton.plushies,
          elder,
        };

        const finalA = memoizedApplyRulesAndBuild(sourceCreature, build);

        let wins = 0;
        let draws = 0;
        let sumSurvival = 0;
        let sumDps = 0;
        let sumTtkWins = 0;
        let winsCount = 0;
        let sumImmortal = 0;

        for (const opponentName of phaseJob.opponentNames) {
          const opponentCreature = creatureByName[opponentName];
          if (!opponentCreature) continue;

          let summary;
          try {
            const result = simulateBestBuildMatchupWithPath({
              sourceCreature,
              sourceBuild: build,
              finalA,
              opponentCreature,
              opponentBaselineBuild: phaseJob.opponentBaselineBuild,
              activesOn: skeleton.activesOn,
              breathOn: skeleton.breathOn,
              maxTimeSec: phaseJob.maxTimeSec,
              abilityPolicy: phaseJob.abilityPolicy ?? "semiIdeal",
              combatEventOrder: phaseJob.combatEventOrder,
              extraAbilityConfig: phaseJob.extraAbilityConfig,
              extraCombatantStats: phaseJob.extraCombatantStats,
              extraSpecialAbilities: phaseJob.extraSpecialAbilities,
              extraBuffs: phaseJob.extraBuffs,
              extraTrapsTrails: phaseJob.extraTrapsTrails,
            });
            summary = result.summary;
            pathCounts[result.path] = (pathCounts[result.path] ?? 0) + 1;
          } catch {
            continue;
          }

          const agg = aggregateBestBuildsMatchupSummary(summary);
          wins += agg.win;
          draws += agg.draw;
          sumSurvival += agg.survival;
          sumDps += agg.avgDps;
          if (agg.win > 0) {
            sumTtkWins += agg.ttkWin;
            winsCount += 1;
          }
          sumImmortal += agg.immortalDamage;
        }

        const count = Math.max(1, phaseJob.opponentNames.length);
        const aggregate = {
          winRate: (wins + draws) / count,
          drawRate: draws / count,
          avgSurvival: sumSurvival / count,
          avgDps: sumDps / count,
          avgTtkWin: winsCount > 0 ? sumTtkWins / winsCount : phaseJob.maxTimeSec,
          avgImmortalDamage: sumImmortal / count,
        };

        allTestedBuilds.push({ build, aggregate });
      }
    }

    if (phaseJob.returnAllDistributions) {
      for (const tested of allTestedBuilds) {
        bestBuildsResults.push({
          skeletonKey: skeleton.key,
          build: tested.build,
          aggregate: tested.aggregate,
        });
      }
      continue;
    }

    if (allTestedBuilds.length > 0) {
      const best = allTestedBuilds.reduce((a, b) =>
        compareAggregate(a.aggregate, b.aggregate, phaseJob.objective) < 0 ? a : b,
      );
      bestBuildsResults.push({
        skeletonKey: skeleton.key,
        build: best.build,
        aggregate: best.aggregate,
      });
    }
  }

  return { bestBuildsResults, pathCounts };
}
