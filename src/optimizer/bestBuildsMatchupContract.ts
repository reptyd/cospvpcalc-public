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
  /** The opponent's max HP, and the lowest HP it was driven to while the
   * source was still alive. On a fight the source loses, the pair says how far
   * down it took the opponent - which its HP at the source's death understates
   * whenever the opponent heals back up afterwards. */
  maxHpB: number;
  minHpBWhileAAlive: number;
  /** Engine work the fight cost, in event-loop iterations. Deterministic - the
   * funnel sizes its search against it. Absent on a summary the engine did not
   * produce (the skipped-matchup placeholder). */
  workUnits?: number;
};
