import { describe, expect, it } from "vitest";
import type { CreatureRuntime, FinalStats } from "../../engine";
import type { CombatSignatureGroup, FunnelCandidate } from "./combatSignature";
import { skylinePrune, verifySkylinePareto } from "./skylinePrune";

const source = {
  activatedAbilities: [],
  passiveAbilities: [],
  breathAbilities: [],
  userAbilityIds: [],
} as unknown as CreatureRuntime;

// Minimal FinalStats with only the fields the skyline reads; every partition
// field is held constant so the groups land in one class and differ only on the
// order axes.
function stats(over: Partial<FinalStats>): FinalStats {
  return {
    damage: 100,
    biteCooldown: 1,
    health: 1000,
    healthRegen: 10,
    weight: 500,
    breathDamagePct: 0,
    plushieReflectAvgPct: 0,
    ...over,
  } as unknown as FinalStats;
}

function group(signature: string, over: Partial<FinalStats>, preScore = 0): CombatSignatureGroup {
  const rep: FunnelCandidate = { build: {} as never, activesOn: true, breathOn: true, preScore };
  return { signature, representative: rep, finalStats: stats(over), members: [rep] };
}

describe("skylinePrune", () => {
  it("drops a build dominated on every order axis and keeps the dominator", () => {
    const dominator = group("dom", { damage: 200, health: 2000, weight: 900 });
    const dominated = group("bad", { damage: 100, health: 1000, weight: 500 });
    const incomparable = group("inc", { damage: 50, health: 3000, weight: 500 });

    const result = skylinePrune([dominator, dominated, incomparable], {
      source,
      pool: [],
      challengerQuotaPerRegion: 0, // no challenger band, so the dominated build is truly dropped
    });

    const kept = new Set(result.kept.map((g) => g.signature));
    expect(kept.has("dom")).toBe(true);
    expect(kept.has("inc")).toBe(true); // wins on health, so non-dominated
    expect(kept.has("bad")).toBe(false); // strictly worse everywhere -> pruned
    expect(verifySkylinePareto(result).valid).toBe(true);
  });

  it("keeps near-frontier challengers when a quota is set", () => {
    const dominator = group("dom", { damage: 200, health: 2000, weight: 900 });
    const dominated = group("bad", { damage: 100, health: 1000, weight: 500 }, 5);

    const result = skylinePrune([dominator, dominated], { source, pool: [], challengerQuotaPerRegion: 1 });

    expect(result.frontier.map((g) => g.signature)).toEqual(["dom"]);
    expect(result.kept.map((g) => g.signature).sort()).toEqual(["bad", "dom"]);
  });

  it("lower biteCooldown dominates higher, all else equal", () => {
    const fast = group("fast", { biteCooldown: 0.8 });
    const slow = group("slow", { biteCooldown: 1.2 });
    const result = skylinePrune([fast, slow], { source, pool: [], challengerQuotaPerRegion: 0 });
    expect(result.frontier.map((g) => g.signature)).toEqual(["fast"]);
  });
});
