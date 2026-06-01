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
});
