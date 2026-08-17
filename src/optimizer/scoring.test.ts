import { describe, expect, it } from "vitest";
import { compareResult, scoreResult } from "./scoring";

describe("scoring comparator", () => {
  it("effectiveDamage uses at-death field for winner", () => {
    const summary = {
      winner: "A",
      damageDealtAAtBDeath: 50,
      damageDealtA: 120,
      damageDealtBAtADeath: 0,
      damageDealtB: 0,
      ttkAtoB: 10,
      ttkBtoA: 20,
      extendedDamagePotentialA: 0,
      extendedDamagePotentialB: 0,
    } as any;
    const scored = scoreResult(summary, "A");
    expect(scored.effectiveDamage).toBe(50);
  });

  it("prefers lower TTK over higher effective damage when winRank equal", () => {
    const base = {
      winner: "A",
      damageDealtAAtBDeath: 100,
      damageDealtBAtADeath: 50,
      damageDealtA: 100,
      damageDealtB: 50,
      ttkAtoB: 8,
      ttkBtoA: 20,
      extendedDamagePotentialA: 0,
      extendedDamagePotentialB: 0,
    } as any;
    const slower = {
      ...base,
      ttkAtoB: 12,
      damageDealtAAtBDeath: 120,
      damageDealtA: 120,
    };
    const aScore = scoreResult(base, "A");
    const bScore = scoreResult(slower, "A");
    expect(compareResult(aScore, bScore)).toBeLessThan(0);
  });

  it("ranks a result on winning, then time to kill, then effective damage [REF:policy_what_ability_policies_are]", () => {
    const score = (winRank: number, ttk: number, effectiveDamage: number) => ({
      winRank,
      ttk,
      effectiveDamage,
      extendedDamage: 0,
    });
    const better = (left: ReturnType<typeof score>, right: ReturnType<typeof score>) =>
      compareResult(left, right) < 0;

    // Winning first: a win beats a draw beats a loss, whatever the rest says.
    // Read through scoreResult, so the winner-to-rank mapping is in the claim
    // rather than assumed by it.
    const outcome = (winner: string, ttk: number, damage: number) =>
      scoreResult(
        {
          winner,
          ttkAtoB: ttk,
          ttkBtoA: ttk,
          damageDealtAAtBDeath: damage,
          damageDealtA: damage,
          damageDealtBAtADeath: 0,
          damageDealtB: 0,
          extendedDamagePotentialA: 0,
          extendedDamagePotentialB: 0,
        } as never,
        "A",
      );
    expect(better(outcome("A", 10, 100), outcome("Draw", 10, 100))).toBe(true);
    expect(better(outcome("Draw", 10, 100), outcome("B", 10, 100))).toBe(true);
    // And it dominates: a slow, cheap win still beats a fast, huge loss.
    expect(better(outcome("A", 900, 0), outcome("B", 1, 1e6))).toBe(true);
    // Then time to kill, which the winner wants short and the loser long.
    expect(better(score(2, 8, 100), score(2, 12, 1e6))).toBe(true);
    expect(better(score(0, 40, 100), score(0, 20, 1e6))).toBe(true);
    // Effective damage only settles what the first two left tied.
    expect(better(score(2, 8, 200), score(2, 8, 100))).toBe(true);
    expect(compareResult(score(2, 8, 100), score(2, 8, 100))).toBe(0);
  });
});
