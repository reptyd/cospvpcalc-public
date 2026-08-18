import { describe, expect, it } from "vitest";
import type { FinalStats } from "../types";
import { computeBreathDamage } from "./damage";

// Minimal FinalStats stand-in: computeBreathDamage only reads `health` (and
// `weight`, which we supply via the override args).
const defender = { health: 2_000, weight: 100 } as unknown as FinalStats;
const attacker = { health: 1_000, weight: 100 } as unknown as FinalStats;

describe("computeBreathDamage weight scaling", () => {
  it("caps the attacker/defender weight ratio at 3:1", () => {
    // 5:1 weights must produce the same damage as 3:1 (the cap bites).
    const atCap = computeBreathDamage(attacker, defender, 1, 0, 300, 100);
    const overCap = computeBreathDamage(attacker, defender, 1, 0, 500, 100);
    expect(overCap).toBeCloseTo(atCap, 9);

    // And strictly less than the uncapped 5:1 magnitude.
    const uncapped5to1 = (2_000 * (1 + 5)) / 2 / 100;
    expect(overCap).toBeLessThan(uncapped5to1);

    // Below the cap the ratio still scales normally (2:1 < 3:1).
    const belowCap = computeBreathDamage(attacker, defender, 1, 0, 200, 100);
    expect(belowCap).toBeLessThan(atCap);
  });
});
