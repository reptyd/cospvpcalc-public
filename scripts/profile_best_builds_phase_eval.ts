import { performance } from "node:perf_hooks";
import type { BuildOptions } from "../src/engine";
import { creatureByName } from "../src/engine/creatureData";
import { enumerateAssignmentsCounts } from "../src/shared/buildDomain";
import { aggregateSummaryForA, compareAggregate, type BestBuildAggregateObjective } from "../src/optimizer/ranking";
import { memoizedApplyRulesAndBuild } from "../src/optimizer/bestBuildsOptimizations";
import { simulateBestBuildMatchup } from "../src/optimizer/bestBuildsRuntime";
import { buildAdaptiveQuickOpponents, buildDefaultMetaPool } from "../src/optimizer/poolUtils";
import { buildOptimizerContext } from "../src/optimizer/contextAndCompare";
import { generateBuildCandidates } from "../src/optimizer/candidateGeneration";
import { buildSkeletonsFromCandidates, buildStageShortlists, type BestBuildFlowSkeleton } from "../src/optimizer/bestBuildsFlow";
import { loadRustMatchupBridge, setRustMatchupBridgeForceDisabled } from "../src/optimizer/rustMatchupLoader";

type Aggregate = {
  winRate: number;
  drawRate: number;
  avgSurvival: number;
  avgDps: number;
  avgTtkWin: number;
  avgImmortalDamage: number;
};

type PhaseBreakdown = {
  phase: "stage1" | "stage2";
  skeletons: number;
  opponents: number;
  simulations: number;
  buildCalls: number;
  totalMs: number;
  buildMs: number;
  simulateMs: number;
  aggregateMs: number;
  compareMs: number;
};

function requireCreature(name: string) {
  const creature = creatureByName[name];
  if (!creature) throw new Error(`Missing creature: ${name}`);
  return creature;
}

function readEnvInt(name: string, fallback: number): number {
  const value = process.env[name];
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readProfileTargetCreature(fallback: string): string {
  return process.env.PROFILE_TARGET_CREATURE?.trim() || process.env.PROFILE_CREATURE?.trim() || fallback;
}

function readProfileTargetPoolSize(fallback: number): number {
  const targetPool = process.env.PROFILE_TARGET_POOL?.trim();
  if (targetPool) {
    const match = /^meta(\d+)$/i.exec(targetPool);
    if (match) return Number(match[1]);
  }
  return readEnvInt("PROFILE_POOL_SIZE", fallback);
}

function readProfileTargetFilter(fallback: string): string {
  return process.env.PROFILE_TARGET_FILTER?.trim() || process.env.PROFILE_POOL_SCOPE?.trim() || fallback;
}

function formatMs(value: number): string {
  return `${value.toFixed(2)} ms`;
}

function formatPct(part: number, total: number): string {
  if (total <= 0) return "0.0%";
  return `${((part / total) * 100).toFixed(1)}%`;
}

function evaluatePhase({
  phase,
  sourceName,
  skeletons,
  opponentNames,
  objective,
  maxTimeSec,
  abilityPolicy,
}: {
  phase: "stage1" | "stage2";
  sourceName: string;
  skeletons: BestBuildFlowSkeleton[];
  opponentNames: string[];
  objective: BestBuildAggregateObjective;
  maxTimeSec: number;
  abilityPolicy: "fast" | "semiIdeal";
}) {
  const sourceCreature = requireCreature(sourceName);
  const phaseStartedAt = performance.now();
  let buildMs = 0;
  let simulateMs = 0;
  let aggregateMs = 0;
  let compareMs = 0;
  let simulations = 0;
  let buildCalls = 0;
  const results: Array<{ skeleton: BestBuildFlowSkeleton; aggregate: Aggregate; build: BuildOptions }> = [];

  for (const skeleton of skeletons) {
    const splits = skeleton.ascensionAssignments
      ? [skeleton.ascensionAssignments]
      : enumerateAssignmentsCounts(skeleton.traits, skeleton.venerationStage);

    let bestAggregate: Aggregate | null = null;
    let bestBuild: BuildOptions | null = null;

    for (const ascensionAssignments of splits) {
      const build: BuildOptions = {
        venerationStage: skeleton.venerationStage,
        traits: skeleton.traits,
        ascensionAssignments,
        plushies: skeleton.plushies,
      };

      const buildStartedAt = performance.now();
      const finalA = memoizedApplyRulesAndBuild(sourceCreature, build);
      buildMs += performance.now() - buildStartedAt;
      buildCalls += 1;

      let wins = 0;
      let draws = 0;
      let sumSurvival = 0;
      let sumDps = 0;
      let sumTtkWins = 0;
      let winsCount = 0;
      let sumImmortal = 0;

      for (const opponentName of opponentNames) {
        const opponentCreature = creatureByName[opponentName];
        if (!opponentCreature) continue;

        const simulateStartedAt = performance.now();
        const summary = simulateBestBuildMatchup({
          sourceCreature,
          finalA,
          opponentCreature,
          activesOn: skeleton.activesOn,
          breathOn: skeleton.breathOn,
          maxTimeSec,
          abilityPolicy,
        });
        simulateMs += performance.now() - simulateStartedAt;
        simulations += 1;

        const aggregateStartedAt = performance.now();
        const agg = aggregateSummaryForA(summary);
        aggregateMs += performance.now() - aggregateStartedAt;
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

      const count = Math.max(1, opponentNames.length);
      const aggregate: Aggregate = {
        winRate: wins / count,
        drawRate: draws / count,
        avgSurvival: sumSurvival / count,
        avgDps: sumDps / count,
        avgTtkWin: winsCount > 0 ? sumTtkWins / winsCount : maxTimeSec,
        avgImmortalDamage: sumImmortal / count,
      };

      if (!bestAggregate) {
        bestAggregate = aggregate;
        bestBuild = build;
        continue;
      }

      const compareStartedAt = performance.now();
      const nextIsBetter = compareAggregate(aggregate, bestAggregate, objective) < 0;
      compareMs += performance.now() - compareStartedAt;
      if (nextIsBetter) {
        bestAggregate = aggregate;
        bestBuild = build;
      }
    }

    if (bestAggregate && bestBuild) {
      results.push({
        skeleton,
        aggregate: bestAggregate,
        build: bestBuild,
      });
    }
  }

  return {
    breakdown: {
      phase,
      skeletons: skeletons.length,
      opponents: opponentNames.length,
      simulations,
      buildCalls,
      totalMs: performance.now() - phaseStartedAt,
      buildMs,
      simulateMs,
      aggregateMs,
      compareMs,
    } satisfies PhaseBreakdown,
    results,
  };
}

async function main(): Promise<void> {
  const sourceName = readProfileTargetCreature("Kendyll");
  const poolSize = readProfileTargetPoolSize(80);
  const poolScope = readProfileTargetFilter("withinOneTier");
  const searchDepth = (process.env.PROFILE_SEARCH_DEPTH?.trim() as "soft" | "detailed" | undefined) ?? "detailed";
  const objective = (process.env.PROFILE_OBJECTIVE?.trim() as BestBuildAggregateObjective | undefined) ?? "avgTtk";
  const useRust = process.env.PROFILE_DISABLE_RUST !== "1";
  const skeletonLimit = readEnvInt("PROFILE_SKELETON_LIMIT", 0);
  const stage1TopK = readEnvInt("PROFILE_STAGE1_TOPK", searchDepth === "soft" ? 140 : 260);
  const stage2Cap = readEnvInt("PROFILE_STAGE2_CAP", searchDepth === "soft" ? 45 : 80);

  const sourceCreature = requireCreature(sourceName);
  const activePool = buildDefaultMetaPool(sourceName, poolSize, poolScope);
  const quickPool = buildAdaptiveQuickOpponents(activePool, Math.min(searchDepth === "soft" ? 12 : 20, activePool.length));
  const context = buildOptimizerContext(sourceCreature, sourceCreature, "solo");
  context.soloMode = "dummy";

  setRustMatchupBridgeForceDisabled(!useRust);
  if (useRust) {
    await loadRustMatchupBridge().catch(() => null);
  }

  const candidates = generateBuildCandidates({
    quality: searchDepth === "soft" ? "balanced" : "quality",
    optimizePlushies: true,
    searchAllVeneration: false,
    fixedVenerationStage: 5,
    searchToggles: false,
    goal: "lexicographic",
    context,
    constraints: {
      venerationStage: 5,
      traits: [],
      ascensionAssignments: ["", "", "", "", ""],
      plushies: [],
    },
  });

  const skeletons = buildSkeletonsFromCandidates(candidates);
  const selectedSkeletons = skeletonLimit > 0 ? skeletons.slice(0, skeletonLimit) : skeletons;
  const stage1 = evaluatePhase({
    phase: "stage1",
    sourceName,
    skeletons: selectedSkeletons,
    opponentNames: quickPool,
    objective,
    maxTimeSec: 90,
    abilityPolicy: "fast",
  });

  const shortlists = buildStageShortlists({
    quickScored: stage1.results.map((result) => ({
      skeleton: {
        ...result.skeleton,
        preScore: 0,
      },
      aggregate: result.aggregate,
    })),
    objective,
    winRateGuardPct: 6,
    stage1TopK,
    stage2Cap,
  });

  const stage2 = evaluatePhase({
    phase: "stage2",
    sourceName,
    skeletons: shortlists.stage2Skeletons,
    opponentNames: activePool,
    objective,
    maxTimeSec: 180,
    abilityPolicy: "semiIdeal",
  });

  console.log("Best Builds phase evaluation profile");
  console.log(`Creature: ${sourceName}`);
  console.log(`Defaults: searchDepth=${searchDepth}, pool=meta${poolSize}, scope=${poolScope}, objective=${objective}`);
  console.log(`Caps: skeletonLimit=${skeletonLimit || "off"}, stage1TopK=${stage1TopK}, stage2Cap=${stage2Cap}`);
  console.log("");

  for (const breakdown of [stage1.breakdown, stage2.breakdown]) {
    console.log(`${breakdown.phase.toUpperCase()}`);
    console.log(`  total       : ${formatMs(breakdown.totalMs)}`);
    console.log(`  build stats : ${formatMs(breakdown.buildMs)} (${formatPct(breakdown.buildMs, breakdown.totalMs)}) | calls=${breakdown.buildCalls}`);
    console.log(`  simulate    : ${formatMs(breakdown.simulateMs)} (${formatPct(breakdown.simulateMs, breakdown.totalMs)}) | runs=${breakdown.simulations}`);
    console.log(`  aggregate   : ${formatMs(breakdown.aggregateMs)} (${formatPct(breakdown.aggregateMs, breakdown.totalMs)})`);
    console.log(`  compare     : ${formatMs(breakdown.compareMs)} (${formatPct(breakdown.compareMs, breakdown.totalMs)})`);
    console.log(`  overhead    : ${formatMs(breakdown.totalMs - breakdown.buildMs - breakdown.simulateMs - breakdown.aggregateMs - breakdown.compareMs)}`);
    console.log(`  skeletons   : ${breakdown.skeletons} | opponents=${breakdown.opponents}`);
    console.log("");
  }
}

main().catch((error: unknown) => {
  setRustMatchupBridgeForceDisabled(false);
  console.error(error);
  process.exitCode = 1;
});
