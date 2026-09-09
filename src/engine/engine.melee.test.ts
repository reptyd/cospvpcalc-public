import { describe, expect, it } from "vitest";
import { computeMeleeDamagePerHit } from "./engine";
import { baseStats } from "./engine.test.helpers";

describe("computeMeleeDamagePerHit", () => {
  it("uses weight ratio and formula", () => {
    const attacker = baseStats({ damage: 100, weight: 200 });
    const defender = baseStats({ weight: 100 });
    const dmg = computeMeleeDamagePerHit(attacker, defender, 1, 1);
    expect(dmg).toBeCloseTo(150, 5);
  });
});
