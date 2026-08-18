/// <reference types="node" />
// Per-cell cost probe for the Best Builds funnel, gated behind
// COS_CALC_BB_CELL_PROBE. The pipeline's own timings say how long a stage took
// on one thread; they cannot say whether the stage's cells can be spread over
// the pool. This runs the shipped pipeline inline, times every cell a stage
// hands the runner, and reports each stage's serial cost next to the makespan
// those cells imply on a worker pool - so a stage whose wall clock is pinned by
// one cell shows up as a makespan far above the serial cost over the pool.
import { beforeAll, describe, it } from "vitest";
import { creatureByName } from "../../engine/creatureData";
import { generateBuildCandidates } from "../candidateGeneration";
import { buildSkeletonsFromCandidates } from "../stageSelection";
import { buildDefaultMetaPool } from "../poolUtils";
import { loadRustForNode } from "../rustNodeMatchup";
import { __setLoadedRustMatchupBridgeForTests, stripNullsForWasm } from "../rustMatchupLoader";
import type { LoadedRustMatchupBridge } from "../rustMatchupBridge";
import { buildResultKey } from "../../shared/buildEncoding";
import { FUNNEL_TUNING, runBestBuildsFunnelPipeline } from "./funnelPipeline";
import { runFunnelCellsInline, type FunnelCell, type FunnelCellRunResult } from "./funnelCellRunner";

const ENABLED = !!process.env.COS_CALC_BB_CELL_PROBE;
const SRC = process.env.COS_CALC_BB_PIPELINE_SOURCE || "Velkhyra";
const POOL = Number(process.env.COS_CALC_BB_PIPELINE_POOL) || 80;
/** Pool size the makespan is reported for; `funnelMaxWorkers()` on the machine
 * under test is the number to pass. */
const WORKERS = Number(process.env.COS_CALC_BB_PROBE_WORKERS) || 10;
const SHORTLIST = Number(process.env.COS_CALC_BB_PIPELINE_SHORTLIST) || 0;

type CellRecord = { group: string; ms: number; opponents: string[] };

/** Wall clock `costs` take on `workers`, dispatched in order to whichever
 * worker frees up first - the funnel's own dispatch rule. */
function makespan(costs: readonly number[], workers: number): number {
  const busy = new Array<number>(workers).fill(0);
  for (const cost of costs) {
    let min = 0;
    for (let i = 1; i < workers; i += 1) if (busy[i] < busy[min]) min = i;
    busy[min] += cost;
  }
  return Math.max(...busy);
}

describe.skipIf(!ENABLED)("BB funnel per-cell cost probe", () => {
  beforeAll(async () => {
    const mod = await loadRustForNode();
    __setLoadedRustMatchupBridgeForTests({
      contractVersion: "node-harness",
      simulateComposableMatchup: (a, d, ab, db, pol, cfg, mt, rt) =>
        mod.simulate_composable_matchup_js(stripNullsForWasm(a), stripNullsForWasm(d), stripNullsForWasm(ab ?? undefined), stripNullsForWasm(db ?? undefined), pol, stripNullsForWasm(cfg), mt, rt) as never,
      simulateComposableMatchupBatch: (batch: unknown) =>
        mod.simulate_composable_matchup_batch_js(stripNullsForWasm(batch)) as never,
      captureDefensivePinSchedule: (a, d, ab, db, cfg, mt) =>
        mod.capture_defensive_pin_schedule_js(stripNullsForWasm(a), stripNullsForWasm(d), stripNullsForWasm(ab ?? undefined), stripNullsForWasm(db ?? undefined), stripNullsForWasm(cfg), mt) as never,
      simulateComposableMatchupPinned: (a, d, ab, db, cfg, pin, mt, rt) =>
        mod.simulate_composable_matchup_pinned_js(stripNullsForWasm(a), stripNullsForWasm(d), stripNullsForWasm(ab ?? undefined), stripNullsForWasm(db ?? undefined), stripNullsForWasm(cfg), stripNullsForWasm(pin), mt, rt) as never,
    } as LoadedRustMatchupBridge);
  });

  it("reports each stage's serial cost against the makespan its cells allow", async () => {
    const creature = creatureByName[SRC];
    const activePool = buildDefaultMetaPool(SRC, POOL, "withinOneTier");
    const candidates = generateBuildCandidates({
      quality: "quality", optimizePlushies: true, searchAllVeneration: false, fixedVenerationStage: 5,
      searchToggles: false, goal: "lexicographic",
      constraints: { venerationStage: 5, traits: [], ascensionAssignments: ["", "", "", "", ""], plushies: [] },
    }) as never[];
    const uniqueSkeletons = buildSkeletonsFromCandidates(candidates);

    const records: CellRecord[] = [];
    let stage = "screen";
    const started = Date.now();
    const res = await runBestBuildsFunnelPipeline({
      creature, activePool, uniqueSkeletons, objective: "winRate", maxTimeSec: 480,
      unlockAscension: true, unlockElder: true,
      tuning: { ...FUNNEL_TUNING, ...(SHORTLIST > 0 ? { coarseShortlist: SHORTLIST } : null) },
      onProgress: () => {}, cancelRef: { current: false },
      runner: ({ screenFortifyFast }) => {
        const base = {
          sourceCreatureName: creature.name,
          objective: "winRate" as const,
          maxTimeSec: 480,
          abilityPolicy: screenFortifyFast ? ("reallyFast" as const) : ("ideal" as const),
          screenFortifyFast,
        };
        if (!screenFortifyFast) stage = "completion";
        return async ({ cells, wantPerOpponent, onProgress, cancelRef }) => {
          const merged: FunnelCellRunResult = { outcomes: [], pathCounts: {}, workerCount: 0, workUnits: 0 };
          const group = `${stage} ${cells.length} cells of ${cells[0]?.builds.length ?? 0}b x ${cells[0]?.opponents.length ?? 0}o`;
          for (let i = 0; i < cells.length; i += 1) {
            const cell: FunnelCell = cells[i];
            const startedCell = Date.now();
            const run = runFunnelCellsInline({ base, cells: [cell], wantPerOpponent, cancelRef });
            records.push({ group, ms: Date.now() - startedCell, opponents: cell.opponents });
            merged.outcomes.push(...run.outcomes);
            merged.workUnits += run.workUnits;
            for (const [k, v] of Object.entries(run.pathCounts)) merged.pathCounts[k] = (merged.pathCounts[k] ?? 0) + v;
            onProgress?.((i + 1) / cells.length);
          }
          return merged;
        };
      },
    });

    console.log(`=== source=${SRC} pool=${activePool.length} serial=${((Date.now() - started) / 1000).toFixed(1)}s ===`);
    const groups = [...new Set(records.map((record) => record.group))];
    for (const group of groups) {
      const costs = records.filter((record) => record.group === group).map((record) => record.ms);
      const serial = costs.reduce((a, b) => a + b, 0);
      console.log(
        `  ${group}: serial=${(serial / 1000).toFixed(1)}s dearest cell=${(Math.max(...costs) / 1000).toFixed(1)}s ` +
          `makespan@${WORKERS}w=${(makespan(costs, WORKERS) / 1000).toFixed(1)}s ` +
          `(floor ${(Math.max(serial / WORKERS, ...costs) / 1000).toFixed(1)}s)`,
      );
    }
    const dearest = records
      .filter((record) => record.group.startsWith("completion"))
      .sort((a, b) => b.ms - a.ms)
      .slice(0, 10);
    if (dearest.length > 0) {
      console.log("--- dearest completion cells ---");
      for (const record of dearest) console.log(`  ${record.opponents.join("+")} ${(record.ms / 1000).toFixed(2)}s`);
    }
    console.log("--- displayed list ---");
    res.results.slice(0, 10).forEach((row, i) => {
      console.log(`  #${i + 1} ${buildResultKey(row.build, row.activesOn, row.breathOn)} wr=${row.aggregate.winRate.toFixed(5)} ttk=${row.aggregate.avgTtkWin.toFixed(3)}`);
    });
  }, 3_600_000);
});
