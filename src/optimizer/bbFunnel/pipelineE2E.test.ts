/// <reference types="node" />
// End-to-end funnel-pipeline timing harness. Gated behind COS_CALC_BB_PIPELINE_E2E
// so the default suite stays fast; run it with that env var to reproduce the
// per-stage wall-clock numbers on a real tier-3 source.
import { beforeAll, describe, it } from "vitest";
import { creatureByName } from "../../engine/creatureData";
import { generateBuildCandidates } from "../candidateGeneration";
import { buildSkeletonsFromCandidates } from "../stageSelection";
import { buildDefaultMetaPool } from "../poolUtils";
import { loadRustForNode } from "../rustNodeMatchup";
import { __setLoadedRustMatchupBridgeForTests, stripNullsForWasm } from "../rustMatchupLoader";
import type { LoadedRustMatchupBridge } from "../rustMatchupBridge";
import { memoizedApplyRulesAndBuild } from "../bestBuildsOptimizations";
import { buildResultKey } from "../../shared/buildEncoding";
import { selectAnchorProbeBuilds, selectCoarseAnchors } from "./anchorSelection";
import { deduplicateBySignature, type FunnelCandidate } from "./combatSignature";
import { FUNNEL_TUNING, runBestBuildsFunnelPipeline } from "./funnelPipeline";
import { runFunnelCellsInline } from "./funnelCellRunner";
import { skylinePrune } from "./skylinePrune";

const ENABLED = !!process.env.COS_CALC_BB_PIPELINE_E2E;
// Probe mode stops after the anchor measurement, which is what you want on a
// source whose every fight pays a rollout - the full run would be hours.
const PROBE_ONLY = !!process.env.COS_CALC_BB_PIPELINE_PROBE;
// Withholds the batch export so the run falls back to per-fight crossings -
// the A/B for what batching is worth, measurable back to back on one machine.
const NO_BATCH = !!process.env.COS_CALC_BB_PIPELINE_NO_BATCH;
const SRC = process.env.COS_CALC_BB_PIPELINE_SOURCE || "Velkhyra";
/** Override the shipped tuning; 0 keeps the shipped value. Shrinking the
 * shortlist / band is what makes a full-resolution run on a rollout source
 * finish at all, so a cadence sweep can be compared like for like. */
const BAND = Number(process.env.COS_CALC_BB_PIPELINE_BAND) || 0;
const SHORTLIST = Number(process.env.COS_CALC_BB_PIPELINE_SHORTLIST) || 0;
const ANCHORS = Number(process.env.COS_CALC_BB_PIPELINE_ANCHORS) || 0;
/** `-1` disables the elder / ascension re-check; 0 keeps the shipped value. */
const REFINE = Number(process.env.COS_CALC_BB_PIPELINE_REFINE) || 0;
/** Runs the screening stages at the caller's real policy, so a run can be
 * priced against what the fast screen saves. */
const EXACT_SCREEN = !!process.env.COS_CALC_BB_PIPELINE_EXACT_SCREEN;

describe.skipIf(!ENABLED)("BB funnel pipeline end-to-end timing", () => {
  beforeAll(async () => {
    const mod = await loadRustForNode();
    __setLoadedRustMatchupBridgeForTests({
      contractVersion: "node-harness",
      simulateComposableMatchup: (a, d, ab, db, pol, cfg, mt, rt) =>
        mod.simulate_composable_matchup_js(stripNullsForWasm(a), stripNullsForWasm(d), stripNullsForWasm(ab ?? undefined), stripNullsForWasm(db ?? undefined), pol, stripNullsForWasm(cfg), mt, rt) as never,
      ...(NO_BATCH ? null : {
        simulateComposableMatchupBatch: (batch: unknown) =>
          mod.simulate_composable_matchup_batch_js(stripNullsForWasm(batch)) as never,
      }),
      captureDefensivePinSchedule: (a, d, ab, db, cfg, mt) =>
        mod.capture_defensive_pin_schedule_js(stripNullsForWasm(a), stripNullsForWasm(d), stripNullsForWasm(ab ?? undefined), stripNullsForWasm(db ?? undefined), stripNullsForWasm(cfg), mt) as never,
      simulateComposableMatchupPinned: (a, d, ab, db, cfg, pin, mt, rt) =>
        mod.simulate_composable_matchup_pinned_js(stripNullsForWasm(a), stripNullsForWasm(d), stripNullsForWasm(ab ?? undefined), stripNullsForWasm(db ?? undefined), stripNullsForWasm(cfg), stripNullsForWasm(pin), mt, rt) as never,
    } as LoadedRustMatchupBridge);
  });

  it.skipIf(!PROBE_ONLY)("reports what one fight costs for this source", () => {
    const creature = creatureByName[SRC];
    const activePool = buildDefaultMetaPool(SRC, 80, "withinOneTier");
    const candidates = generateBuildCandidates({
      quality: "quality", optimizePlushies: true, searchAllVeneration: false, fixedVenerationStage: 5,
      searchToggles: false, goal: "lexicographic",
      constraints: { venerationStage: 5, traits: [], ascensionAssignments: ["", "", "", "", ""], plushies: [] },
    }) as never[];
    const expanded: FunnelCandidate[] = buildSkeletonsFromCandidates(candidates).map((skeleton) => ({
      build: {
        venerationStage: skeleton.venerationStage,
        traits: skeleton.traits,
        ascensionAssignments: skeleton.ascensionAssignments ?? ["", "", "", "", ""],
        plushies: skeleton.plushies,
        elder: skeleton.elder ?? "Powerful",
      },
      activesOn: skeleton.activesOn,
      breathOn: skeleton.breathOn,
      preScore: skeleton.preScore,
    }));
    for (const candidate of expanded) memoizedApplyRulesAndBuild(creature, candidate.build);
    const survivors = skylinePrune(deduplicateBySignature(expanded, creature).groups, {
      source: creature,
      pool: activePool,
    }).kept;
    const probes = selectAnchorProbeBuilds(
      survivors.map((group) => ({
        build: group.representative.build,
        finalA: group.finalStats,
        activesOn: group.representative.activesOn,
        breathOn: group.representative.breathOn,
      })),
      FUNNEL_TUNING.probeBuilds,
    );
    const startedAt = Date.now();
    const selection = selectCoarseAnchors({
      sourceCreature: creature,
      pool: activePool,
      probes,
      anchorCount: FUNNEL_TUNING.anchorCount,
      maxTimeSec: 480,
      abilityPolicy: EXACT_SCREEN ? "ideal" : "reallyFast",
      screenFortifyFast: !EXACT_SCREEN,
    });
    const costs = selection.scores.map((score) => score.workPerFight).sort((a, b) => a - b);
    const at = (q: number) => costs[Math.min(costs.length - 1, Math.floor(q * costs.length))];
    console.log(`source=${SRC} survivors=${survivors.length} opponents=${costs.length}`);
    console.log(
      `work/fight  min=${at(0).toFixed(0)} p50=${at(0.5).toFixed(0)} p90=${at(0.9).toFixed(0)} ` +
        `max=${costs[costs.length - 1].toFixed(0)} mean=${(costs.reduce((a, b) => a + b, 0) / costs.length).toFixed(0)}`,
    );
    console.log(
      `probe fights=${selection.probeFights} work=${selection.workUnits} ` +
        `wall=${((Date.now() - startedAt) / 1000).toFixed(1)}s`,
    );
    console.log(`anchors = ${selection.anchors.join(", ")}`);
    console.log(
      `anchor work/fight = ${selection.anchors
        .map((name) => selection.scores.find((s) => s.name === name)!.workPerFight.toFixed(0))
        .join(", ")}`,
    );
  }, 1_800_000);

  it.skipIf(PROBE_ONLY)("reports per-stage wall clock", async () => {
    const creature = creatureByName[SRC];
    const activePool = buildDefaultMetaPool(SRC, 80, "withinOneTier");
    const candidates = generateBuildCandidates({
      quality: "quality", optimizePlushies: true, searchAllVeneration: false, fixedVenerationStage: 5,
      searchToggles: false, goal: "lexicographic",
      constraints: { venerationStage: 5, traits: [], ascensionAssignments: ["", "", "", "", ""], plushies: [] },
    }) as never[];
    const uniqueSkeletons = buildSkeletonsFromCandidates(candidates);
    console.log(`source=${SRC} pool=${activePool.length} candidates=${candidates.length} skeletons=${uniqueSkeletons.length}`);

    const started = Date.now();
    const res = await runBestBuildsFunnelPipeline({
      creature, activePool, uniqueSkeletons, objective: "winRate", maxTimeSec: 480,
      unlockAscension: true, unlockElder: true,
      tuning: {
        ...FUNNEL_TUNING,
        ...(BAND > 0 ? { honestBand: BAND } : null),
        ...(SHORTLIST > 0 ? { coarseShortlist: SHORTLIST } : null),
        ...(ANCHORS > 0 ? { anchorCount: ANCHORS } : null),
        ...(REFINE !== 0 ? { refineBand: Math.max(0, REFINE) } : null),
      },
      exactScreening: EXACT_SCREEN,
      onProgress: () => {}, cancelRef: { current: false },
      runner: ({ screenFortifyFast }) => {
        const base = {
          sourceCreatureName: creature.name,
          objective: "winRate" as const,
          maxTimeSec: 480,
          abilityPolicy: screenFortifyFast && !EXACT_SCREEN ? ("reallyFast" as const) : ("ideal" as const),
          screenFortifyFast,
        };
        return async ({ cells, wantPerOpponent, onProgress, cancelRef }) =>
          runFunnelCellsInline({ base, cells, wantPerOpponent, onProgress, cancelRef });
      },
    });
    const wall = (Date.now() - started) / 1000;

    const t = res.timings as unknown as Record<string, number>;
    const m = res.telemetry as unknown as Record<string, unknown>;
    console.log("=== TELEMETRY ===");
    for (const [k, v] of Object.entries(m)) if (typeof v === "number") console.log(`  ${k} = ${v}`);
    console.log("  anchors =", ((m.anchors as string[]) ?? []).join(", "));
    console.log("=== TIMINGS (single-thread, ms) ===");
    for (const [k, v] of Object.entries(t)) console.log(`  ${k} = ${typeof v === "number" ? v.toFixed(0) : v}`);
    console.log(
      `=== TOP 10 (band=${res.telemetry.honestBand} screenedFast=${res.telemetry.screenedFast} ` +
        `work=${res.telemetry.workUnits}) ===`,
    );
    res.results.slice(0, 10).forEach((row, i) => {
      console.log(
        `  #${i + 1} ${buildResultKey(row.build, row.activesOn, row.breathOn)}` +
          ` wr=${row.aggregate.winRate.toFixed(5)} ttk=${row.aggregate.avgTtkWin.toFixed(3)}`,
      );
    });
    console.log(`TOTAL single-thread ${wall.toFixed(1)}s  =>  @4w ~${(wall / 4).toFixed(1)}s, @2w ~${(wall / 2).toFixed(1)}s`);
  }, 1_800_000);
});
