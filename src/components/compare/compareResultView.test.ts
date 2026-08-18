import { describe, expect, it } from "vitest";
import type { SimulationSummary } from "../../engine";
import { getViewDetails, buildStatusIntervals } from "./compareResultView";

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

type SummaryDebug = NonNullable<SimulationSummary["debug"]>;

function debugWithBreathFires(a: number[], b: number[] = []): SummaryDebug {
  const side = (breathFireTimes: number[]) => ({ breathFireTimes }) as SummaryDebug["A"];
  return { A: side(a), B: side(b) };
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

  it("counts an ability activation as one use (a later deactivation closes the window, it is not a second use) and ignores status applications", () => {
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

    expect(getViewDetails(summary, "fullFight", "A").abilities).toEqual([{ name: "Berserk", count: 1 }]);
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

  it("reports Breath Time from the fired ticks, not from the log entries they wrote", () => {
    // A heal breath fires at 0.5 s and heals at 1 s, so four fired ticks
    // leave two heal entries behind.
    const summary: SimulationSummary = {
      ...baseSummary([
        {
          time: 1,
          type: "breath",
          attacker: "A",
          damage: 0,
          healing: 30,
          actorHpAfter: 900,
          hpSide: "A",
          hpAfter: 900,
          description: "Heal Breath heal",
        },
        {
          time: 2,
          type: "breath",
          attacker: "A",
          damage: 0,
          healing: 30,
          actorHpAfter: 930,
          hpSide: "A",
          hpAfter: 930,
          description: "Heal Breath heal",
        },
      ]),
      debug: debugWithBreathFires([0.5, 1, 1.5, 2]),
    };

    expect(getViewDetails(summary, "fullFight", "A").breathTimeSec).toBe(2);
  });

  it("cuts Breath Time at the first death when the view is windowed", () => {
    const summary: SimulationSummary = {
      ...baseSummary([
        {
          time: 2,
          type: "bite",
          attacker: "A",
          damage: 10,
          actorHpAfter: 100,
          hpSide: "B",
          hpAfter: 90,
          description: "Bite hit",
        },
      ]),
      deathTimeB: 1,
      debug: debugWithBreathFires([0.5, 1, 1.5, 2]),
    };

    expect(getViewDetails(summary, "firstDeath", "A").breathTimeSec).toBe(1);
    expect(getViewDetails(summary, "fullFight", "A").breathTimeSec).toBe(2);
  });

  it("collapses two same-instant 'X activated' events into one use (defensive dedup)", () => {
    const abilityEntry = (time: number) => ({
      time,
      type: "ability" as const,
      attacker: "A" as const,
      damage: 0,
      actorHpAfter: 100,
      hpSide: "A" as const,
      hpAfter: 100,
      description: "Spite activated",
    });
    // Two events at the same timestamp can't be told apart on the timeline, so
    // they count as ONE use; a fresh cycle at t=20 = a second use.
    const summary = baseSummary([abilityEntry(0), abilityEntry(0), abilityEntry(20)]);
    expect(getViewDetails(summary, "fullFight", "A").abilities).toEqual([{ name: "Spite", count: 2 }]);
  });
});

describe("buildStatusIntervals DOT-tick backstop", () => {
  const dotTick = (time: number, statusId: string, side: "A" | "B") => ({
    time,
    type: "dot" as const,
    attacker: side === "A" ? ("B" as const) : ("A" as const),
    damage: 10,
    actorHpAfter: 100,
    hpSide: side,
    hpAfter: 90,
    description: `${statusId} tick`,
    statusId,
  });

  it("opens a lane from a DOT tick when the application was never traced", () => {
    // A carrier that applies via the raw (non-logging) helper leaves no
    // "applied" event - only the DOT ticks. The lane must still appear.
    const summary = baseSummary([
      dotTick(5, "Radiation_Status", "B"),
      dotTick(8, "Radiation_Status", "B"),
    ]);
    const lanes = buildStatusIntervals(summary, "B", 30);
    const rad = lanes.find((l) => l.label === "Radiation");
    expect(rad).toBeDefined();
    // No close event -> the segment runs from the first tick to the cutoff.
    expect(rad!.segments).toEqual([{ from: 5, to: 30 }]);
  });

  it("does not double-open or reset stacks when the apply was already traced", () => {
    const summary = baseSummary([
      {
        time: 2,
        type: "ability",
        attacker: "A",
        damage: 0,
        actorHpAfter: 100,
        hpSide: "B",
        hpAfter: 100,
        description: "Totem applied Radiation (2)",
        detail: "0 -> 2 stacks",
        statusId: "Radiation_Status",
      },
      dotTick(5, "Radiation_Status", "B"),
    ]);
    const lanes = buildStatusIntervals(summary, "B", 30);
    const rad = lanes.find((l) => l.label === "Radiation");
    // Segment starts at the traced apply (t=2), not re-opened by the t=5 tick.
    expect(rad!.segments).toEqual([{ from: 2, to: 30 }]);
  });
});
