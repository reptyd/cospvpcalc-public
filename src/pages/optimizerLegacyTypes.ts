// Legacy UI-only type re-defs for the restored Optimizer page.
//
// The OLD `optimizerPageFlow` + `guaranteedRuntime` modules were deleted
// in the 2026-04 TS-engine cleanup. The Optimizer settings panel still
// drives a few knobs whose underlying types lived in those modules; this
// file re-defines just the pure-UI shapes the panel needs.
//
// Solo mode + dummy stats were dropped as part of the 2026-05 cleanup —
// they were the dummy-target optimizer from the pre-BB / pre-Rust era,
// superseded by Best Builds + Compare against canonical opponents.
// `OptimizerMode` / `SoloMode` / `DummyInputValues` / `DummyValues` are
// gone with them.

export type OptimizationMode = "fast" | "guaranteed";
export type OptimizationGoal = "lexicographic" | "effectiveDamage" | "dps";

export type GuaranteedOptimizerStats = {
  filteredPlushies: number;
  plushiePairs: number;
  traitPairs: number;
  splitsPerSkeleton: number;
  expectedTotalSims: number;
  actualEvaluated: number;
  skeletonsEvaluated: number;
  workerEnabled: boolean;
  workerUsed: boolean;
  workerCount?: number;
  chunkSize?: number;
  workerFallback?: boolean;
  workerError?: string | null;
};
