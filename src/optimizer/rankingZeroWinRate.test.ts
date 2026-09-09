import { describe, expect, it } from "vitest";
import { compareAggregate, opponentFloorFraction, type BestBuildAggregate } from "./ranking";
import type { BestBuildsMatchupSummary } from "./bestBuildsMatchupContract";

function aggregate(over: Partial<BestBuildAggregate>): BestBuildAggregate {
  return {
    winRate: 0,
    drawRate: 0,
    avgSurvival: 100,
    avgDps: 100,
    avgTtkWin: 100,
    avgImmortalDamage: 100,
    avgOpponentFloor: 1,
    ...over,
  };
}

function summary(over: Partial<BestBuildsMatchupSummary>): BestBuildsMatchupSummary {
  return {
    winner: "B",
    deathTimeA: 40,
    maxTimeSec: 900,
    dpsAtoB: 100,
    ttkAtoB: 200,
    damageDealtA: 1000,
    damageDealtAAtBDeath: 0,
    extendedDamagePotentialA: 0,
    maxHpB: 1000,
    minHpBWhileAAlive: 1000,
    ...over,
  };
}

describe("win-rate ranking with no wins to rate", () => {
  it("puts the build that drove the opponent lowest first", () => {
    const deeper = aggregate({ avgOpponentFloor: 0.2, avgDps: 50 });
    const faster = aggregate({ avgOpponentFloor: 0.6, avgDps: 400 });
    expect(compareAggregate(deeper, faster, "winRate")).toBeLessThan(0);
    expect(compareAggregate(faster, deeper, "winRate")).toBeGreaterThan(0);
  });

  it("falls back to DPS and then TTK when the floors are equal", () => {
    const stronger = aggregate({ avgOpponentFloor: 0.4, avgDps: 400 });
    const weaker = aggregate({ avgOpponentFloor: 0.4, avgDps: 50 });
    expect(compareAggregate(stronger, weaker, "winRate")).toBeLessThan(0);

    const quicker = aggregate({ avgOpponentFloor: 0.4, avgDps: 100, avgTtkWin: 30 });
    const slower = aggregate({ avgOpponentFloor: 0.4, avgDps: 100, avgTtkWin: 90 });
    expect(compareAggregate(quicker, slower, "winRate")).toBeLessThan(0);
  });

  it("leaves the order alone as soon as one build wins something", () => {
    const winsSometimes = aggregate({ winRate: 0.1, avgOpponentFloor: 0.9 });
    const neverWins = aggregate({ winRate: 0, avgOpponentFloor: 0.1 });
    expect(compareAggregate(winsSometimes, neverWins, "winRate")).toBeLessThan(0);
  });

  it("does not reach the floor under the other objectives", () => {
    const deeper = aggregate({ avgOpponentFloor: 0.2, avgDps: 50 });
    const faster = aggregate({ avgOpponentFloor: 0.6, avgDps: 400 });
    expect(compareAggregate(faster, deeper, "avgDps")).toBeLessThan(0);
  });

  it("reads a result cached before the floor existed as the worst floor", () => {
    const cached = aggregate({}) as Partial<BestBuildAggregate>;
    delete cached.avgOpponentFloor;
    const measured = aggregate({ avgOpponentFloor: 0.5 });
    expect(compareAggregate(measured, cached as BestBuildAggregate, "winRate")).toBeLessThan(0);
  });

  it("reads a won fight as a floor of zero and a full bar as one", () => {
    expect(opponentFloorFraction(summary({ minHpBWhileAAlive: 0 }))).toBe(0);
    expect(opponentFloorFraction(summary({ minHpBWhileAAlive: 1000 }))).toBe(1);
    expect(opponentFloorFraction(summary({ minHpBWhileAAlive: 250 }))).toBeCloseTo(0.25, 10);
    expect(opponentFloorFraction(summary({ maxHpB: 0 }))).toBe(1);
  });
});
