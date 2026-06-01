import { statusById } from "../engine/data";
import { combineStatusBlockFractions, getRawElderBlockFraction, getRawPlushieBlockFraction } from "../engine/statusBlockMath";
import { BAD_OMEN_OUTCOMES } from "../engine/subsystems/statuses";
import type { FinalStats } from "../engine/types";

const EXTRA_STATUS_IDS = [
  "Aggressive_Bear_Status",
  "Aggressive_Status",
  "Bad_Omen",
  "Drowsy_Status",
  "Scared_Bear_Status",
  "Scared_Status",
];

const ALL_KNOWN_STATUS_IDS = Array.from(
  new Set<string>([
    ...Object.keys(statusById),
    ...BAD_OMEN_OUTCOMES.map((outcome) => outcome.statusId),
    ...EXTRA_STATUS_IDS,
  ]),
).sort((a, b) => a.localeCompare(b));

export function buildCombinedRustStatusBlockFractions(
  finalStats: Pick<FinalStats, "elderStatusBlockPct" | "plushieStatusBlockPct">,
): Record<string, number> {
  const elderBlockFraction = getRawElderBlockFraction(finalStats);
  const plushieBlockFractions: Record<string, number> = Object.fromEntries(
    Object.keys(finalStats.plushieStatusBlockPct ?? {}).map((statusId) => [statusId, getRawPlushieBlockFraction(finalStats, statusId)]),
  );
  if (elderBlockFraction === 0) {
    return Object.fromEntries(
      (Object.entries(plushieBlockFractions) as Array<[string, number]>)
        .map(([statusId, fraction]): [string, number] => [statusId, combineStatusBlockFractions(fraction)])
        .filter(([, fraction]) => fraction > 0)
        .sort(([a], [b]) => a.localeCompare(b)),
    );
  }

  const combinedEntries = new Map<string, number>();
  for (const statusId of ALL_KNOWN_STATUS_IDS) {
    const plushieBlockFraction = plushieBlockFractions[statusId] ?? 0;
    const combinedFraction = combineStatusBlockFractions(plushieBlockFraction, elderBlockFraction);
    if (combinedFraction > 0) {
      combinedEntries.set(statusId, combinedFraction);
    }
  }
  for (const [statusId, plushieBlockFraction] of Object.entries(plushieBlockFractions) as Array<[string, number]>) {
    const combinedFraction = combineStatusBlockFractions(plushieBlockFraction, elderBlockFraction);
    if (combinedFraction > 0) {
      combinedEntries.set(statusId, combinedFraction);
    }
  }

  return Object.fromEntries([...combinedEntries.entries()].sort(([a], [b]) => a.localeCompare(b)));
}
