import type { BuildOptions, CreatureRuntime, FinalStats } from "../engine";
import { elderOptions } from "../engine/buildData";
import { creatureByName } from "../engine/creatureData";
import { enumerateAssignmentsCounts } from "../shared/buildDomain";
import { memoizedApplyRulesAndBuild, setActiveTwoFacedMode } from "./bestBuildsOptimizations";
import {
  simulateBestBuildMatchupRectangle,
  simulateBestBuildMatchupWithPath,
  type BestBuildsRectangleCell,
} from "./bestBuildsRuntime";
import { aggregateBestBuildsMatchupSummary, compareAggregate } from "./ranking";
import type {
  BestBuildsPathCounts,
  BestBuildsPerOpponentOutcome,
  BestBuildsPhase2Job,
  BestBuildsWorkerResult,
} from "./optimizerWorkerProtocol";

type Phase2Build = {
  skeletonIndex: number;
  build: BuildOptions;
  finalA: FinalStats;
  activesOn: boolean;
  breathOn: boolean;
};

function expandPhase2Builds(phaseJob: BestBuildsPhase2Job, sourceCreature: CreatureRuntime): Phase2Build[] {
  const rows: Phase2Build[] = [];
  phaseJob.skeletons.forEach((skeleton, skeletonIndex) => {
    const elders = skeleton.elder ? [skeleton.elder] : elderOptions;
    const splits = skeleton.ascensionAssignments
      ? [skeleton.ascensionAssignments]
      : enumerateAssignmentsCounts(skeleton.traits, skeleton.venerationStage);
    for (const elder of elders) {
      for (const ascensionAssignments of splits) {
        const build: BuildOptions = {
          venerationStage: skeleton.venerationStage,
          traits: skeleton.traits,
          ascensionAssignments,
          plushies: skeleton.plushies,
          elder,
        };
        rows.push({
          skeletonIndex,
          build,
          finalA: memoizedApplyRulesAndBuild(sourceCreature, build),
          activesOn: skeleton.activesOn,
          breathOn: skeleton.breathOn,
        });
      }
    }
  });
  return rows;
}

/** Score the job in one WASM crossing when it asked for it and carries none of
 * the battle-settings channels the rectangle cannot express. Returns null to
 * mean "run the per-matchup path", including on a bundle without the batch
 * export or a disabled bridge. */
function tryRectangle(
  phaseJob: BestBuildsPhase2Job,
  sourceCreature: CreatureRuntime,
  rows: readonly Phase2Build[],
  opponentCreatures: readonly CreatureRuntime[],
): BestBuildsRectangleCell[][] | null {
  if (!phaseJob.batchMatchups) return null;
  if (
    phaseJob.extraAbilityConfig ||
    phaseJob.extraCombatantStats ||
    phaseJob.extraSpecialAbilities ||
    phaseJob.extraBuffs ||
    phaseJob.extraTrapsTrails
  ) {
    return null;
  }
  try {
    return simulateBestBuildMatchupRectangle({
      sourceCreature,
      builds: rows,
      opponentCreatures,
      opponentBaselineBuild: phaseJob.opponentBaselineBuild,
      maxTimeSec: phaseJob.maxTimeSec,
      abilityPolicy: phaseJob.abilityPolicy ?? "semiIdeal",
      combatEventOrder: phaseJob.combatEventOrder,
      screenFortifyFast: phaseJob.screenFortifyFast,
    });
  } catch {
    return null;
  }
}

export function evaluateBestBuildsPhase2Job(phaseJob: BestBuildsPhase2Job): {
  bestBuildsResults: BestBuildsWorkerResult[];
  pathCounts: BestBuildsPathCounts;
  workUnits: number;
} {
  const sourceCreature = creatureByName[phaseJob.sourceCreatureName];
  if (!sourceCreature) return { bestBuildsResults: [], pathCounts: {}, workUnits: 0 };

  if (phaseJob.twoFacedMode) setActiveTwoFacedMode(phaseJob.twoFacedMode);

  const bestBuildsResults: BestBuildsWorkerResult[] = [];
  const pathCounts: BestBuildsPathCounts = {};
  // Engine work the job charged, summed over every fight including the ones
  // whose build loses its skeleton's play-off. The funnel budgets on the total,
  // so it has to count everything that ran.
  let workUnits = 0;

  const rows = expandPhase2Builds(phaseJob, sourceCreature);
  const opponents: { name: string; creature: CreatureRuntime }[] = [];
  for (const opponentName of phaseJob.opponentNames) {
    const creature = creatureByName[opponentName];
    if (creature) opponents.push({ name: opponentName, creature });
  }
  const rectangle = tryRectangle(
    phaseJob,
    sourceCreature,
    rows,
    opponents.map((opponent) => opponent.creature),
  );

  const testedBySkeleton = phaseJob.skeletons.map(
    (): Array<{
      build: BuildOptions;
      aggregate: BestBuildsWorkerResult["aggregate"];
      perOpponent?: BestBuildsPerOpponentOutcome[];
    }> => [],
  );

  rows.forEach((row, rowIndex) => {
    let wins = 0;
    let draws = 0;
    let sumSurvival = 0;
    let sumDps = 0;
    let sumTtk = 0;
    let sumImmortal = 0;
    const perOpponent: BestBuildsPerOpponentOutcome[] | undefined = phaseJob.returnPerOpponentOutcomes
      ? []
      : undefined;

    opponents.forEach((opponent, opponentIndex) => {
      let summary;
      let path;
      if (rectangle) {
        const cell = rectangle[rowIndex][opponentIndex];
        summary = cell.summary;
        path = cell.path;
      } else {
        try {
          const result = simulateBestBuildMatchupWithPath({
            sourceCreature,
            sourceBuild: row.build,
            finalA: row.finalA,
            opponentCreature: opponent.creature,
            opponentBaselineBuild: phaseJob.opponentBaselineBuild,
            activesOn: row.activesOn,
            breathOn: row.breathOn,
            maxTimeSec: phaseJob.maxTimeSec,
            abilityPolicy: phaseJob.abilityPolicy ?? "semiIdeal",
            combatEventOrder: phaseJob.combatEventOrder,
            screenFortifyFast: phaseJob.screenFortifyFast,
            extraAbilityConfig: phaseJob.extraAbilityConfig,
            extraCombatantStats: phaseJob.extraCombatantStats,
            extraSpecialAbilities: phaseJob.extraSpecialAbilities,
            extraBuffs: phaseJob.extraBuffs,
            extraTrapsTrails: phaseJob.extraTrapsTrails,
          });
          summary = result.summary;
          path = result.path;
        } catch {
          return;
        }
      }
      pathCounts[path] = (pathCounts[path] ?? 0) + 1;
      workUnits += summary.workUnits ?? 0;

      const agg = aggregateBestBuildsMatchupSummary(summary);
      wins += agg.win;
      draws += agg.draw;
      sumSurvival += agg.survival;
      sumDps += agg.avgDps;
      sumTtk += agg.ttkWin;
      sumImmortal += agg.immortalDamage;
      perOpponent?.push({
        opponentName: opponent.name,
        winner: summary.winner,
        ttk: summary.ttkAtoB,
        dps: summary.dpsAtoB,
        effective: agg.immortalDamage,
        survival: agg.survival,
      });
    });

    const count = Math.max(1, phaseJob.opponentNames.length);
    testedBySkeleton[row.skeletonIndex].push({
      build: row.build,
      aggregate: {
        winRate: (wins + draws) / count,
        drawRate: draws / count,
        avgSurvival: sumSurvival / count,
        avgDps: sumDps / count,
        avgTtkWin: sumTtk / count,
        avgImmortalDamage: sumImmortal / count,
      },
      perOpponent,
    });
  });

  phaseJob.skeletons.forEach((skeleton, skeletonIndex) => {
    const allTestedBuilds = testedBySkeleton[skeletonIndex];
    if (phaseJob.returnAllDistributions) {
      for (const tested of allTestedBuilds) {
        bestBuildsResults.push({
          skeletonKey: skeleton.key,
          build: tested.build,
          aggregate: tested.aggregate,
          perOpponent: tested.perOpponent,
        });
      }
      return;
    }

    if (allTestedBuilds.length > 0) {
      const best = allTestedBuilds.reduce((a, b) =>
        compareAggregate(a.aggregate, b.aggregate, phaseJob.objective) < 0 ? a : b,
      );
      bestBuildsResults.push({
        skeletonKey: skeleton.key,
        build: best.build,
        aggregate: best.aggregate,
        perOpponent: best.perOpponent,
      });
    }
  });

  return { bestBuildsResults, pathCounts, workUnits };
}
