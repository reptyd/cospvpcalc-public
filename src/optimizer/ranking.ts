import type { SimulationSummary } from "../engine/types";
import type { BestBuildsMatchupSummary } from "./bestBuildsMatchupContract";

export type BestBuildAggregateObjective =
  | "winRate"
  | "survival"
  | "avgDps"
  | "avgTtk"
  | "immortalDamage";

export type BestBuildAggregate = {
  winRate: number;
  drawRate: number;
  avgSurvival: number;
  avgDps: number;
  avgTtkWin: number;
  avgImmortalDamage: number;
  /** Mean over the opponent set of the lowest HP each opponent was driven to
   * while the source was alive, as a fraction of that opponent's max HP.
   * Lower is better, and a fraction rather than a figure so opponents of
   * different sizes count the same. Required, so every aggregate the ranking
   * reads carries it; a result cached before the field existed arrives without
   * it as plain JSON, and `compareAggregate` reads that as 1. */
  avgOpponentFloor: number;
  commonWinsCount?: number;
  commonWinsMetricKind?: "avgTtk" | "avgDps" | "immortalDamage" | "survival";
  commonWinsAvgSurvival?: number;
  commonWinsAvgDps?: number;
  commonWinsAvgTtkWin?: number;
  commonWinsAvgImmortalDamage?: number;
};

export function aggregateSummaryForA(summary: SimulationSummary) {
  const win = summary.winner === "A" ? 1 : 0;
  const draw = summary.winner === "Draw" ? 1 : 0;
  const survival = summary.deathTimeA ?? summary.maxTimeSec;
  const avgDps = summary.dpsAtoB;
  // TTK = the damage-race time-to-kill-B (ttkAtoB), the SAME value Compare
  // shows - available even when A loses the fight (e.g. A's DoTs finish B after
  // A has died). Falling back to maxTimeSec on a non-win would hide the real
  // TTK for every lost matchup, against a tank such as Kragnyx above all, and
  // Best Builds would read "no TTK / capped at max" where Compare reads the
  // number.
  const ttkWin = summary.ttkAtoB;
  const immortalDamage =
    summary.winner === "A"
      ? summary.damageDealtAAtBDeath + summary.extendedDamagePotentialA
      : summary.damageDealtA;
  return { win, draw, survival, avgDps, ttkWin, immortalDamage };
}

/** The lowest HP the opponent was driven to in one fight, as a fraction of its
 * max HP. A won fight reads 0 - the opponent reached zero - so the figure is
 * comparable across a set whether or not every fight in it was lost. */
export function opponentFloorFraction(summary: BestBuildsMatchupSummary): number {
  if (!(summary.maxHpB > 0)) return 1;
  return Math.min(1, Math.max(0, summary.minHpBWhileAAlive / summary.maxHpB));
}

export function aggregateBestBuildsMatchupSummary(summary: BestBuildsMatchupSummary) {
  const win = summary.winner === "A" ? 1 : 0;
  const draw = summary.winner === "Draw" ? 1 : 0;
  const survival = summary.deathTimeA ?? summary.maxTimeSec;
  const avgDps = summary.dpsAtoB;
  // TTK = the damage-race time-to-kill-B (ttkAtoB), the SAME value Compare
  // shows - available even when A loses the fight (e.g. A's DoTs finish B after
  // A has died). Falling back to maxTimeSec on a non-win would hide the real
  // TTK for every lost matchup, against a tank such as Kragnyx above all, and
  // Best Builds would read "no TTK / capped at max" where Compare reads the
  // number.
  const ttkWin = summary.ttkAtoB;
  const immortalDamage =
    summary.winner === "A"
      ? summary.damageDealtAAtBDeath + summary.extendedDamagePotentialA
      : summary.damageDealtA;
  return { win, draw, survival, avgDps, ttkWin, immortalDamage, opponentFloor: opponentFloorFraction(summary) };
}

export function compareAggregate(
  a: BestBuildAggregate,
  b: BestBuildAggregate,
  objective: BestBuildAggregateObjective,
): number {
  const baseOrder: BestBuildAggregateObjective[] = ["avgDps", "avgTtk", "immortalDamage", "survival", "winRate"];
  const order: BestBuildAggregateObjective[] = [objective, ...baseOrder.filter((key) => key !== objective)];

  // A win rate of zero on both sides rates nothing: every fight in the set was
  // lost, and the goal is what the build did with the loss - the opponent's
  // lowest HP, lower better. The keys behind it are unchanged, so two builds
  // that drove their opponents equally low are still separated by DPS and TTK.
  const noWinsToRate = objective === "winRate" && a.winRate <= 0 && b.winRate <= 0;
  const floor = (agg: BestBuildAggregate) => agg.avgOpponentFloor ?? 1;

  for (const key of order) {
    let delta = 0;
    if (key === "winRate") delta = noWinsToRate ? floor(a) - floor(b) : b.winRate - a.winRate;
    else if (key === "avgTtk") delta = a.avgTtkWin - b.avgTtkWin;
    else if (key === "avgDps") delta = b.avgDps - a.avgDps;
    else if (key === "immortalDamage") delta = b.avgImmortalDamage - a.avgImmortalDamage;
    else if (key === "survival") delta = b.avgSurvival - a.avgSurvival;
    if (Math.abs(delta) > 1e-9) return delta;
  }
  return 0;
}
