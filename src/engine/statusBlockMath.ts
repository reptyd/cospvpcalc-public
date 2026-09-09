import type { FinalStats } from "./types";

function normalizeComponentFraction(value: number | null | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return value;
}

export function clampStatusBlockFraction(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

export function combineStatusBlockFractions(...fractions: Array<number | null | undefined>): number {
  const total = fractions.reduce<number>((sum, fraction) => sum + normalizeComponentFraction(fraction), 0);
  return clampStatusBlockFraction(total);
}

export function getRawPlushieBlockFraction(
  finalStats: Pick<FinalStats, "plushieStatusBlockPct">,
  statusId: string,
): number {
  return normalizeComponentFraction((finalStats.plushieStatusBlockPct?.[statusId] ?? 0) / 100);
}

export function getRawElderBlockFraction(finalStats: Pick<FinalStats, "elderStatusBlockPct">): number {
  return normalizeComponentFraction((finalStats.elderStatusBlockPct ?? 0) / 100);
}
