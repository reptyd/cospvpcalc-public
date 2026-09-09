import type { FinalStats } from "./types";

function roundHalfUp(value: number): number {
  if (!Number.isFinite(value)) return value;
  return Math.round(value);
}

export function applyTrueRoundingMode(finalStats: FinalStats): FinalStats {
  return {
    ...finalStats,
    damage: roundHalfUp(finalStats.damage),
    weight: roundHalfUp(finalStats.weight),
  };
}
