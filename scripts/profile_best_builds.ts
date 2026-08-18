import { performance } from "node:perf_hooks";
import { creatureByName } from "../src/engine/creatureData";
import { clearBuildCache } from "../src/optimizer/bestBuildsOptimizations";
import { buildSkeletonsFromCandidates, buildStageShortlists, dedupeAndRankBestBuildResults } from "../src/optimizer/bestBuildsFlow";
import {
  buildPhase2Chunks,
  createBestBuildsPhase2JobBuilder,
  mapBestBuildPhase2Rows,
  runSequentialBestBuildsPhase2Fallback,
} from "../src/optimizer/bestBuildsPhase2RuntimeHelpers";
import { buildAdaptiveQuickOpponents, buildDefaultMetaPool } from "../src/optimizer/poolUtils";
import { buildOptimizerContext } from "../src/optimizer/contextAndCompare";
import { generateBuildCandidates } from "../src/optimizer/candidateGeneration";
import type { BestBuildAggregateObjective } from "../src/optimizer/ranking";
import { loadRustMatchupBridge } from "../src/optimizer/rustMatchupLoader";

function requireCreature(name: string) {
  const creature = creatureByName[name];
  if (!creature) {
    throw new Error(`Missing creature: ${name}`);
  }
  return creature;
}

function formatMs(value: number): string {
  return `${value.toFixed(2)} ms`;
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

function readProfileShowTop(fallback: number): number {
  return readEnvInt("PROFILE_SHOW_TOP", fallback);
}

async function main(): Promise<void> {
  const sourceName = readProfileTargetCreature("Korathos");
  const objective = (process.env.PROFILE_OBJECTIVE?.trim() as BestBuildAggregateObjective | undefined) ?? "avgTtk";
  const searchDepth = (process.env.PROFILE_SEARCH_DEPTH?.trim() as "soft" | "detailed" | undefined) ?? "detailed";
  const poolSize = readProfileTargetPoolSize(60);
  const poolScope = readProfileTargetFilter("withinOneTier");
  const showTop = readProfileShowTop(0);
  const runStage2 = process.env.PROFILE_SKIP_STAGE2 !== "1";
  // Rust is the only supported engine path after the 2026-04 TS-engine
  // cleanup; PROFILE_DISABLE_RUST is a no-op now (kept in env reads so old
  // command lines don't fail loudly). The bench always loads the Rust
  // bridge.
  const creature = requireCreature(sourceName);
  const activePool = buildDefaultMetaPool(sourceName, poolSize, poolScope);
  const quickPool = buildAdaptiveQuickOpponents(activePool, Math.min(searchDepth === "soft" ? 12 : 20, activePool.length));
  // `buildOptimizerContext` returns a Promise - `optimizerContext.ts`
  // turned async to populate `relevantPlushies` from `computeRelevantPlushies`.
  // Pre-async script code called it as sync, which produced a Promise that
  // crashed inside `generateBuildCandidates` at `context.opponentStatusIds.has(...)`.
  const context = await buildOptimizerContext(creature, creature, "solo");
  context.soloMode = "dummy";
  const constraints = {
    venerationStage: 5,
    traits: [],
    ascensionAssignments: ["", "", "", "", ""],
    plushies: [],
  };

  clearBuildCache();
  await loadRustMatchupBridge().catch(() => null);

  const candidatePrepStart = performance.now();
  const candidates = generateBuildCandidates({
    quality: searchDepth === "soft" ? "balanced" : "quality",
    optimizePlushies: true,
    searchAllVeneration: false,
    fixedVenerationStage: 5,
    searchToggles: false,
    goal: "lexicographic",
    context,
    constraints,
  });
  const skeletons = buildSkeletonsFromCandidates(candidates);
  const candidatePrepMs = performance.now() - candidatePrepStart;
  console.log(`[profile] candidate prep done in ${formatMs(candidatePrepMs)} | candidates=${candidates.length} | skeletons=${skeletons.length}`);

  const stage1Chunks = buildPhase2Chunks(skeletons, 4);
  const stage1JobBuilder = createBestBuildsPhase2JobBuilder({
    sourceCreatureName: creature.name,
    opponentNames: quickPool,
    objective,
    maxTimeSec: 90,
    abilityPolicy: "fast",
    returnAllDistributions: false,
  });
  const mapStage1Rows = (rows: Parameters<typeof mapBestBuildPhase2Rows>[0]["rows"]) =>
    mapBestBuildPhase2Rows({
      rows,
      chunks: stage1Chunks,
      opponentsCount: quickPool.length,
    });

  const stage1Start = performance.now();
  const stage1Run = await runSequentialBestBuildsPhase2Fallback({
    chunks: stage1Chunks,
    buildPhaseJob: stage1JobBuilder,
    mapRows: mapStage1Rows,
    onProgress: () => {},
    cancelRef: { current: false },
  });
  const stage1Results = stage1Run.results;
  const stage1Ms = performance.now() - stage1Start;
  console.log(`[profile] stage1 quick pass done in ${formatMs(stage1Ms)} | results=${stage1Results.length}`);
  console.log(`[profile] stage1 paths ${JSON.stringify(stage1Run.pathCounts)}`);

  const shortlistStart = performance.now();
  const shortlists = buildStageShortlists({
    quickScored: stage1Results.map((result) => ({
      skeleton: {
        venerationStage: result.build.venerationStage,
        traits: result.build.traits,
        plushies: result.build.plushies,
        elder: result.build.elder ?? "None",
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
  const shortlistMs = performance.now() - shortlistStart;
  console.log(
    `[profile] shortlist build done in ${formatMs(shortlistMs)} | stage2Skeletons=${shortlists.stage2Skeletons.length}`,
  );

  let stage2Results: ReturnType<typeof runSequentialBestBuildsPhase2Fallback> extends Promise<infer T>
    ? T["results"]
    : never = [];
  let stage2Ms = 0;
  if (runStage2) {
    const stage2Chunks = buildPhase2Chunks(shortlists.stage2Skeletons, 4);
    const stage2JobBuilder = createBestBuildsPhase2JobBuilder({
      sourceCreatureName: creature.name,
      opponentNames: activePool,
      objective,
      maxTimeSec: 180,
      abilityPolicy: "ideal",
      returnAllDistributions: false,
    });
    const mapStage2Rows = (rows: Parameters<typeof mapBestBuildPhase2Rows>[0]["rows"]) =>
      mapBestBuildPhase2Rows({
        rows,
        chunks: stage2Chunks,
        opponentsCount: activePool.length,
      });

    const stage2Start = performance.now();
    const stage2Run = await runSequentialBestBuildsPhase2Fallback({
      chunks: stage2Chunks,
      buildPhaseJob: stage2JobBuilder,
      mapRows: mapStage2Rows,
      onProgress: () => {},
      cancelRef: { current: false },
    });
    stage2Results = stage2Run.results;
    stage2Ms = performance.now() - stage2Start;
    console.log(`[profile] stage2 full pass done in ${formatMs(stage2Ms)} | results=${stage2Results.length}`);
    console.log(`[profile] stage2 paths ${JSON.stringify(stage2Run.pathCounts)}`);
  }

  const finalizeStart = performance.now();
  const finalResults = dedupeAndRankBestBuildResults({
    results: stage2Results,
    objective,
    winRateGuardPct: 6,
    showAllAscensionDistributions: false,
  });
  const finalizeMs = performance.now() - finalizeStart;
  console.log(`[profile] finalize done in ${formatMs(finalizeMs)} | finalResults=${finalResults.length}`);

  const totalMs = candidatePrepMs + stage1Ms + shortlistMs + stage2Ms + finalizeMs;

  console.log("Best Builds stage profile");
  console.log(`Source creature: ${sourceName}`);
  console.log(`Runtime mode   : rust-enabled (only path post-2026-04 TS-engine cleanup)`);
  console.log(`Defaults: searchDepth=${searchDepth}, pool=meta${poolSize}, scope=${poolScope}, objective=${objective}`);
  console.log(`Pool size: ${activePool.length}, quick pool: ${quickPool.length}`);
  console.log(`Candidates: ${candidates.length}, unique skeletons: ${skeletons.length}, stage2 skeletons: ${shortlists.stage2Skeletons.length}`);
  console.log(`candidate prep : ${formatMs(candidatePrepMs)}`);
  console.log(`stage1 quick   : ${formatMs(stage1Ms)}`);
  console.log(`shortlist      : ${formatMs(shortlistMs)}`);
  console.log(`stage2 full    : ${runStage2 ? formatMs(stage2Ms) : "skipped"}`);
  console.log(`finalize       : ${formatMs(finalizeMs)}`);
  console.log(`total          : ${formatMs(totalMs)}`);
  console.log(`final results  : ${finalResults.length}`);
  if (showTop > 0) {
    console.log(`Top ${Math.min(showTop, finalResults.length)} builds:`);
    for (const [index, result] of finalResults.slice(0, showTop).entries()) {
      console.log(
        `#${index + 1} traits=${result.build.traits.join("+")} asc=${result.build.ascensionAssignments.join(",")} plushies=${result.build.plushies.join("+")} elder=${result.build.elder ?? "None"} actives=${result.activesOn ? "on" : "off"} breath=${result.breathOn ? "on" : "off"} avgTtk=${result.aggregate.avgTtkWin.toFixed(2)} avgDps=${result.aggregate.avgDps.toFixed(2)} winRate=${(result.aggregate.winRate * 100).toFixed(2)} immortal=${result.aggregate.avgImmortalDamage.toFixed(2)}`,
      );
    }
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
