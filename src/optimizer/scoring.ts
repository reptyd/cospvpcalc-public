import type { SimulationSummary } from "../engine/types";

export type Perspective = "A" | "B";

export function scoreResult(summary: SimulationSummary, perspective: Perspective) {
  const winner = summary.winner;
  const winRank = winner === perspective ? 2 : winner === "Draw" ? 1 : 0;
  const effectiveDamage =
    perspective === "A"
      ? winner === "A"
        ? summary.damageDealtAAtBDeath
        : summary.damageDealtA
      : winner === "B"
        ? summary.damageDealtBAtADeath
        : summary.damageDealtB;
  const ttk =
    perspective === "A"
      ? winner === "A"
        ? summary.ttkAtoB
        : summary.ttkBtoA
      : winner === "B"
        ? summary.ttkBtoA
        : summary.ttkAtoB;
  const extendedDamage = perspective === "A" ? summary.extendedDamagePotentialA : summary.extendedDamagePotentialB;
  return { winRank, effectiveDamage, ttk, extendedDamage };
}

export function compareResult(a: ReturnType<typeof scoreResult>, b: ReturnType<typeof scoreResult>) {
  if (a.winRank !== b.winRank) return b.winRank - a.winRank;
  if (a.ttk !== b.ttk) return a.winRank === 2 ? a.ttk - b.ttk : b.ttk - a.ttk;
  if (a.effectiveDamage !== b.effectiveDamage) return b.effectiveDamage - a.effectiveDamage;
  if (a.extendedDamage !== b.extendedDamage) return b.extendedDamage - a.extendedDamage;
  return 0;
}
