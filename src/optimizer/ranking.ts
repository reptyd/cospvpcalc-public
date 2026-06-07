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
  const ttkWin = summary.winner === "A" ? summary.ttkAtoB : summary.maxTimeSec;
  const immortalDamage =
    summary.winner === "A"
      ? summary.damageDealtAAtBDeath + summary.extendedDamagePotentialA
      : summary.damageDealtA;
  return { win, draw, survival, avgDps, ttkWin, immortalDamage };
}

export function aggregateBestBuildsMatchupSummary(summary: BestBuildsMatchupSummary) {
  const win = summary.winner === "A" ? 1 : 0;
  const draw = summary.winner === "Draw" ? 1 : 0;
  const survival = summary.deathTimeA ?? summary.maxTimeSec;
  const avgDps = summary.dpsAtoB;
  const ttkWin = summary.winner === "A" ? summary.ttkAtoB : summary.maxTimeSec;
  const immortalDamage =
    summary.winner === "A"
      ? summary.damageDealtAAtBDeath + summary.extendedDamagePotentialA
      : summary.damageDealtA;
  return { win, draw, survival, avgDps, ttkWin, immortalDamage };
}

export function compareAggregate(
  a: BestBuildAggregate,
  b: BestBuildAggregate,
  objective: BestBuildAggregateObjective,
): number {
  const baseOrder: BestBuildAggregateObjective[] = ["avgDps", "avgTtk", "immortalDamage", "survival", "winRate"];
  const order: BestBuildAggregateObjective[] = [objective, ...baseOrder.filter((key) => key !== objective)];

  for (const key of order) {
    let delta = 0;
    if (key === "winRate") delta = b.winRate - a.winRate;
    else if (key === "avgTtk") delta = a.avgTtkWin - b.avgTtkWin;
    else if (key === "avgDps") delta = b.avgDps - a.avgDps;
    else if (key === "immortalDamage") delta = b.avgImmortalDamage - a.avgImmortalDamage;
    else if (key === "survival") delta = b.avgSurvival - a.avgSurvival;
    if (Math.abs(delta) > 1e-9) return delta;
  }
  return 0;
}
