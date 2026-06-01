import { performance } from "node:perf_hooks";
import { creatureByName } from "../src/engine/creatureData";
import { clearBuildCache } from "../src/optimizer/bestBuildsOptimizations";
import { buildSkeletonsFromCandidates, buildStageShortlists, dedupeAndRankBestBuildResults } from "../src/optimizer/bestBuildsFlow";
import {
  buildPhase2Chunks,
  createBestBuildsPhase2JobBuilder,
  mapBestBuildPhase2Rows,
  runSequentialBestBuildsPhase2Fallback,
  type BestBuildsPhase2Result,
} from "../src/optimizer/bestBuildsPhase2RuntimeHelpers";
import { buildAdaptiveQuickOpponents, buildDefaultMetaPool } from "../src/optimizer/poolUtils";
import { buildOptimizerContext } from "../src/optimizer/contextAndCompare";
import { generateBuildCandidates } from "../src/optimizer/candidateGeneration";
import type { BestBuildAggregateObjective } from "../src/optimizer/ranking";
import { buildResultKeyWithoutAscension } from "../src/optimizer/runtimeHelpers";
import { loadRustMatchupBridge, setRustMatchupBridgeForceDisabled } from "../src/optimizer/rustMatchupLoader";

type FlowSnapshot = {
  label: "ts" | "rust";
  candidateCount: number;
  skeletonCount: number;
  quickPoolCount: number;
  activePoolCount: number;
  stage2SkeletonCount: number;
  stage1Ms: number;
  stage2Ms: number;
  totalMs: number;
  finalResults: BestBuildsPhase2Result[];
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

function buildSnapshotKey(result: BestBuildsPhase2Result): string {
  return buildResultKeyWithoutAscension(result.build, result.activesOn, result.breathOn);
}

function formatMs(ms: number): string {
  return `${ms.toFixed(2)} ms`;
}

function formatPct(numerator: number, denominator: number): string {
  if (denominator === 0) return "0.00%";
  return `${((numerator / denominator) * 100).toFixed(2)}%`;
}

async function runFlow(label: "ts" | "rust"): Promise<FlowSnapshot> {
  const sourceName = readProfileTargetCreature("Kendyll");
  const objective = (process.env.PROFILE_OBJECTIVE?.trim() as BestBuildAggregateObjective | undefined) ?? "avgTtk";
  const searchDepth = (process.env.PROFILE_SEARCH_DEPTH?.trim() as "soft" | "detailed" | undefined) ?? "detailed";
  const poolSize = readProfileTargetPoolSize(80);
  const poolScope = readProfileTargetFilter("withinOneTier");
  const creature = requireCreature(sourceName);
  const activePool = buildDefaultMetaPool(sourceName, poolSize, poolScope);
  const quickPool = buildAdaptiveQuickOpponents(activePool, Math.min(searchDepth === "soft" ? 12 : 20, activePool.length));
  const context = buildOptimizerContext(creature, creature, "solo");
  context.soloMode = "dummy";

  setRustMatchupBridgeForceDisabled(label === "ts");
  if (label === "rust") {
    await loadRustMatchupBridge().catch(() => null);
  }

  clearBuildCache();
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

  const stage1Chunks = buildPhase2Chunks(skeletons, 4);
  const buildStage1Job = createBestBuildsPhase2JobBuilder({
    sourceCreatureName: creature.name,
    opponentNames: quickPool,
    objective,
    maxTimeSec: 90,
    abilityPolicy: "fast",
    returnAllDistributions: false,
  });
  const mapStage1Rows = (rows: Parameters<typeof mapBestBuildPhase2Rows>[0]["rows"]) =>
    mapBestBuildPhase2Rows({ rows, chunks: stage1Chunks, opponentsCount: quickPool.length });

  const stage1Start = performance.now();
  const stage1Run = await runSequentialBestBuildsPhase2Fallback({
    chunks: stage1Chunks,
    buildPhaseJob: buildStage1Job,
    mapRows: mapStage1Rows,
    onProgress: () => {},
    cancelRef: { current: false },
  });
  const stage1Results = stage1Run.results;
  const stage1Ms = performance.now() - stage1Start;

  const shortlists = buildStageShortlists({
    quickScored: stage1Results.map((result) => ({
      skeleton: {
        venerationStage: result.build.venerationStage,
        traits: result.build.traits,
        plushies: result.build.plushies,
        activesOn: result.activesOn,
        breathOn: result.breathOn,
        preScore: 0,
      },
      aggregate: result.aggregate,
    })),
    objective,
    winRateGuardPct: 6,
    stage1TopK: searchDepth === "soft" ? 140 : 260,
    stage2Cap: searchDepth === "soft" ? 45 : 80,
  });

  const stage2Chunks = buildPhase2Chunks(shortlists.stage2Skeletons, 4);
  const buildStage2Job = createBestBuildsPhase2JobBuilder({
    sourceCreatureName: creature.name,
    opponentNames: activePool,
    objective,
    maxTimeSec: 180,
    abilityPolicy: "semiIdeal",
    returnAllDistributions: false,
  });
  const mapStage2Rows = (rows: Parameters<typeof mapBestBuildPhase2Rows>[0]["rows"]) =>
    mapBestBuildPhase2Rows({ rows, chunks: stage2Chunks, opponentsCount: activePool.length });

  const stage2Start = performance.now();
  const stage2Run = await runSequentialBestBuildsPhase2Fallback({
    chunks: stage2Chunks,
    buildPhaseJob: buildStage2Job,
    mapRows: mapStage2Rows,
    onProgress: () => {},
    cancelRef: { current: false },
  });
  const stage2Results = stage2Run.results;
  const stage2Ms = performance.now() - stage2Start;

  const finalResults = dedupeAndRankBestBuildResults({
    results: stage2Results,
    objective,
    winRateGuardPct: 6,
    showAllAscensionDistributions: false,
  });

  return {
    label,
    candidateCount: candidates.length,
    skeletonCount: skeletons.length,
    quickPoolCount: quickPool.length,
    activePoolCount: activePool.length,
    stage2SkeletonCount: shortlists.stage2Skeletons.length,
    stage1Ms,
    stage2Ms,
    totalMs: stage1Ms + stage2Ms,
    finalResults,
  };
}

function compareSnapshots(tsSnapshot: FlowSnapshot, rustSnapshot: FlowSnapshot): string[] {
  const lines: string[] = [];
  if (tsSnapshot.candidateCount !== rustSnapshot.candidateCount) {
    lines.push(`candidate count mismatch: ts=${tsSnapshot.candidateCount}, rust=${rustSnapshot.candidateCount}`);
  }
  if (tsSnapshot.skeletonCount !== rustSnapshot.skeletonCount) {
    lines.push(`skeleton count mismatch: ts=${tsSnapshot.skeletonCount}, rust=${rustSnapshot.skeletonCount}`);
  }
  if (tsSnapshot.stage2SkeletonCount !== rustSnapshot.stage2SkeletonCount) {
    lines.push(`stage2 shortlist mismatch: ts=${tsSnapshot.stage2SkeletonCount}, rust=${rustSnapshot.stage2SkeletonCount}`);
  }
  if (tsSnapshot.finalResults.length !== rustSnapshot.finalResults.length) {
    lines.push(`final result count mismatch: ts=${tsSnapshot.finalResults.length}, rust=${rustSnapshot.finalResults.length}`);
  }

  const rustByKey = new Map(rustSnapshot.finalResults.map((result) => [buildSnapshotKey(result), result]));
  for (const tsResult of tsSnapshot.finalResults) {
    const key = buildSnapshotKey(tsResult);
    const rustResult = rustByKey.get(key);
    if (!rustResult) {
      lines.push(`missing rust final result for ${key}`);
      continue;
    }
    const fields: Array<keyof BestBuildsPhase2Result["aggregate"]> = [
      "winRate",
      "drawRate",
      "avgSurvival",
      "avgDps",
      "avgTtkWin",
      "avgImmortalDamage",
    ];
    for (const field of fields) {
      const delta = Math.abs(tsResult.aggregate[field] - rustResult.aggregate[field]);
      if (delta > 1e-9) {
        lines.push(`${key} aggregate mismatch on ${field}: ts=${tsResult.aggregate[field]}, rust=${rustResult.aggregate[field]}`);
      }
    }
  }

  const tsKeys = tsSnapshot.finalResults.map(buildSnapshotKey);
  const rustKeys = rustSnapshot.finalResults.map(buildSnapshotKey);
  if (tsKeys.join("|") !== rustKeys.join("|")) {
    lines.push("final ranking order mismatch");
  }
  return lines;
}

async function main(): Promise<void> {
  const tsSnapshot = await runFlow("ts");
  const rustSnapshot = await runFlow("rust");
  setRustMatchupBridgeForceDisabled(false);

  const mismatches = compareSnapshots(tsSnapshot, rustSnapshot);
  console.log(`Best Builds TS vs Rust compare`);
  console.log(`Creature: ${readProfileTargetCreature("Kendyll")}`);
  console.log(
    `Pool: meta${readProfileTargetPoolSize(80)} / ${readProfileTargetFilter("withinOneTier")} | objective=${(process.env.PROFILE_OBJECTIVE?.trim() as BestBuildAggregateObjective | undefined) ?? "avgTtk"}`,
  );
  console.log(`Candidates: ${tsSnapshot.candidateCount}, skeletons: ${tsSnapshot.skeletonCount}, stage2 skeletons: ${tsSnapshot.stage2SkeletonCount}`);
  console.log(`TS total: ${formatMs(tsSnapshot.totalMs)} | stage1=${formatMs(tsSnapshot.stage1Ms)} | stage2=${formatMs(tsSnapshot.stage2Ms)}`);
  console.log(`Rust total: ${formatMs(rustSnapshot.totalMs)} | stage1=${formatMs(rustSnapshot.stage1Ms)} | stage2=${formatMs(rustSnapshot.stage2Ms)}`);
  console.log(`Rust speedup vs TS: ${formatPct(tsSnapshot.totalMs - rustSnapshot.totalMs, tsSnapshot.totalMs)} faster`);
  if (mismatches.length === 0) {
    console.log("Diff: clean");
    return;
  }
  console.log("Diff: mismatches found");
  for (const line of mismatches) {
    console.log(`- ${line}`);
  }
  process.exitCode = 1;
}

main().catch((error: unknown) => {
  setRustMatchupBridgeForceDisabled(false);
  console.error(error);
  process.exitCode = 1;
});
