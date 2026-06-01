import { describe, expect, it } from "vitest";
import type { SimulationSummary } from "../../engine";
import { getViewDetails } from "./compareResultView";

function baseSummary(combatLog: NonNullable<SimulationSummary["combatLog"]>): SimulationSummary {
  return {
    deathTimeA: null,
    deathTimeB: null,
    finalHpA: 1,
    finalHpB: 1,
    maxHpA: 1,
    maxHpB: 1,
    hpAAtBDeath: 1,
    hpBAtADeath: 1,
    ehpA: 1,
    ehpB: 1,
    winner: "Draw",
    approxNotes: [],
    dpsAtoB: 0,
    dpsBtoA: 0,
    ttkAtoB: 0,
    ttkBtoA: 0,
    maxTimeSec: 0,
    damageDealtA: 0,
    damageDealtB: 0,
    damageDealtA_untilBDeath: 0,
    damageDealtB_untilADeath: 0,
    damageDealtAAtBDeath: 0,
    damageDealtBAtADeath: 0,
    regenHealedA: 0,
    regenHealedB: 0,
    regenTicksA: 0,
    regenTicksB: 0,
    extendedDamagePotentialA: 0,
    extendedDamagePotentialB: 0,
    combatLog,
  };
}

describe("compareResultView", () => {
  it("does not leave removed status stacks in Effects At End", () => {
    const summary = baseSummary([
      {
        time: 0,
        type: "ability",
        attacker: "B",
        damage: 0,
        actorHpAfter: 100,
        hpSide: "A",
        hpAfter: 100,
        description: "Defensive Burn applied Burn (1)",
        detail: "0 -> 1 stacks",
        statusId: "Burn_Status",
      },
      {
        time: 0,
        type: "ability",
        attacker: "B",
        damage: 0,
        actorHpAfter: 100,
        hpSide: "A",
        hpAfter: 100,
        description: "Burn Attack removed Burn (1)",
        detail: "1 -> 0 stacks",
        statusId: "Burn_Status",
      },
    ]);

    expect(getViewDetails(summary, "fullFight", "A").finalEffects).toEqual([]);
  });

  it("shows conditional passive transitions in Details without counting status applications as abilities", () => {
    const summary = baseSummary([
      {
        time: 0,
        type: "ability",
        attacker: "A",
        damage: 0,
        actorHpAfter: 100,
        hpSide: "A",
        hpAfter: 100,
        description: "Berserk activated",
      },
      {
        time: 3,
        type: "ability",
        attacker: "A",
        damage: 0,
        actorHpAfter: 100,
        hpSide: "A",
        hpAfter: 100,
        description: "Berserk deactivated",
      },
      {
        time: 0,
        type: "ability",
        attacker: "A",
        damage: 0,
        actorHpAfter: 100,
        hpSide: "B",
        hpAfter: 100,
        description: "Defensive Burn applied Burn (1)",
        detail: "0 -> 1 stacks",
        statusId: "Burn_Status",
      },
    ]);

    expect(getViewDetails(summary, "fullFight", "A").abilities).toEqual([{ name: "Berserk", count: 2 }]);
  });

  it("shows modeled breath heal ticks in Details", () => {
    const summary = baseSummary([
      {
        time: 0.5,
        type: "ability",
        attacker: "A",
        damage: 0,
        healing: 30,
        actorHpAfter: 900,
        hpSide: "A",
        hpAfter: 900,
        description: "Heal Breath heal",
      },
      {
        time: 1,
        type: "ability",
        attacker: "A",
        damage: 0,
        healing: 10,
        actorHpAfter: 910,
        hpSide: "A",
        hpAfter: 910,
        description: "Cloud Breath heal",
      },
    ]);

    expect(getViewDetails(summary, "fullFight", "A").abilities).toEqual([
      { name: "Cloud Breath", count: 1 },
      { name: "Heal Breath", count: 1 },
    ]);
  });
});
