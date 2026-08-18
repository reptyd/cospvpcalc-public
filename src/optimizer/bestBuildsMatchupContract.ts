// Shared result shape for a single Best Builds matchup. Populated by the
// Rust composable dispatchers in `rustBestBuildsRuntime`; consumed by
// ranking, runtime, and tests. Kept as its own file because the type sits
// on the Rust<->TS boundary and is imported from both sides.
export type BestBuildsMatchupSummary = {
  winner: "A" | "B" | "Draw";
  deathTimeA: number | null;
  maxTimeSec: number;
  dpsAtoB: number;
  ttkAtoB: number;
  damageDealtA: number;
  damageDealtAAtBDeath: number;
  extendedDamagePotentialA: number;
  /** Engine work the fight cost, in event-loop iterations. Deterministic - the
   * funnel sizes its search against it. Absent on a summary the engine did not
   * produce (the skipped-matchup placeholder). */
  workUnits?: number;
};
