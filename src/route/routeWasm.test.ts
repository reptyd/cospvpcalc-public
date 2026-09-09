/// <reference types="node" />
// The whole chain in one run: the build layer resolves what a creature moves
// at, the numbers cross into the shipped engine, and the engine runs them over
// a distance. Unit tests on either side prove their own half; this proves they
// are joined - a field renamed on one side and not the other reads as a
// creature that cannot move.
import { describe, expect, it } from "vitest";
import { applyRulesAndBuild } from "../engine";
import type { BuildOptions } from "../engine/types";
import { creature, loadRustForNode } from "../optimizer/rustNodeMatchup";
import { stripNullsForWasm } from "../optimizer/rustMatchupLoader";
import { toRustComposableArgsFromCompare } from "../optimizer/rustCompareMatchupRuntime";
import { BAD_OMEN_DEFAULT_OUTCOME } from "../engine/subsystems/statuses";
import { routeMovementStats } from "./routeInputs";

const BARE: BuildOptions = {
  venerationStage: 0,
  traits: [],
  ascensionAssignments: ["", "", "", "", ""],
  plushies: [],
  elder: "None",
};

const PERKS = {
  traps: false, trails: false, powerCharge: false, goreCharge: false, startingSpiteCharged: false,
  muddyBuff: false, hungerRule: false, gourmandizer: false, startingHungerUnits: 100,
  appetiteBaseUnits: 100, defiledGroundLevel: 0, defiledGroundWeakness: false, hasDarkstar: false,
  appetiteDrainMultiplier: 1, healAuraEnabled: false, seedlingMistEnabled: false, healingPulseEnabled: false, healingPulseOnce: false,
  lifeOfTheForestPlants: 0, lifeOfTheForestRandom: false, lifeOfTheForestOnce: false, breathRollMode: "even" as const,
  expungeEnabled: false, wardenRageStartHpPct: 0, headStartSec: 0,
} as const;

type SideSnapshot = {
  distanceStuds: number;
  stamina: number;
  movement: string;
  reachedDistanceAt: number | null;
  caughtOpponentAt: number | null;
};

async function runRoute(
  aName: string,
  bName: string,
  route: {
    attackerMovement: string;
    defenderMovement: string;
    routeDistanceStuds?: number;
    routeInitialGapStuds?: number;
    seconds?: number;
  },
): Promise<{ a: SideSnapshot; b: SideSnapshot }> {
  const rustMod = await loadRustForNode();
  const a = creature(aName);
  const b = creature(bName);
  const finalA = applyRulesAndBuild(a, BARE);
  const finalB = applyRulesAndBuild(b, BARE);
  const args = toRustComposableArgsFromCompare({
    sourceCreature: a, opponentCreature: b, finalA, finalB,
    activesOn: false, breathOn: false, abilityPolicy: "ideal",
    initialStatusesA: [], initialStatusesB: [],
    activeCooldownMultiplierA: 1, activeCooldownMultiplierB: 1,
    disabledAbilitiesA: [], disabledAbilitiesB: [],
    perksA: PERKS, perksB: PERKS,
    firstTick: { mode: "off", delaySec: 1 }, noMoveFacetank: true,
    badOmenOutcome: BAD_OMEN_DEFAULT_OUTCOME,
    compareAirRuleEnabled: false, compareAirRuleCooldownSec: 0,
    compareBiteVariantModeA: "primaryOnly", compareBiteVariantModeB: "primaryOnly",
    posturePolicyA: "off", posturePolicyB: "off",
  });
  const attacker = { ...args.attacker, ...routeMovementStats(a, BARE, finalA) };
  const defender = { ...args.defender, ...routeMovementStats(b, BARE, finalB) };
  const config = {
    ...args.abilityConfig,
    staminaEnabled: true,
    attackerMovement: route.attackerMovement,
    defenderMovement: route.defenderMovement,
    routeDistanceStuds: route.routeDistanceStuds ?? 0,
    routeInitialGapStuds: route.routeInitialGapStuds ?? 0,
  };
  const sim = rustMod.simulate_composable_matchup_js as (...a: unknown[]) => {
    debug?: { A: SideSnapshot; B: SideSnapshot };
  };
  const result = sim(
    stripNullsForWasm(attacker), stripNullsForWasm(defender),
    stripNullsForWasm(args.attackerBreath ?? undefined),
    stripNullsForWasm(args.defenderBreath ?? undefined),
    args.abilityPolicy, stripNullsForWasm(config), route.seconds ?? 120, true,
  );
  const debug = result.debug;
  if (!debug) throw new Error("no side snapshots came back");
  return { a: debug.A, b: debug.B };
}

describe("a route through the shipped engine", () => {
  it("carries a build's speeds across and covers ground with them", async () => {
    // Adharcaiin walks 27 and sprints 134 in the game's stat units, which the
    // engine reads as 11.93 and 59.23 studs a second.
    const { a, b } = await runRoute("Adharcaiin", "Adharcaiin", {
      attackerMovement: "sprinting",
      defenderMovement: "walking",
      seconds: 10,
    });
    expect(a.distanceStuds).toBeGreaterThan(b.distanceStuds);
    expect(b.distanceStuds).toBeCloseTo(27 * 0.442 * 10, 2);
    expect(a.stamina).toBeLessThan(b.stamina);
    expect(b.stamina).toBe(135);
  }, 60_000);

  it("names the first over a line", async () => {
    const { a, b } = await runRoute("Adharcaiin", "Adharcaiin", {
      attackerMovement: "sprinting",
      defenderMovement: "walking",
      routeDistanceStuds: 600,
      seconds: 120,
    });
    expect(a.reachedDistanceAt ?? null).not.toBeNull();
    expect(b.reachedDistanceAt ?? null).not.toBeNull();
    expect(a.reachedDistanceAt!).toBeLessThan(b.reachedDistanceAt!);
  }, 60_000);

  it("closes a head start, or does not", async () => {
    const caught = await runRoute("Adharcaiin", "Adharcaiin", {
      attackerMovement: "sprinting",
      defenderMovement: "walking",
      routeInitialGapStuds: 200,
      seconds: 60,
    });
    expect(caught.a.caughtOpponentAt ?? null).not.toBeNull();

    const escaped = await runRoute("Adharcaiin", "Adharcaiin", {
      attackerMovement: "walking",
      defenderMovement: "sprinting",
      routeInitialGapStuds: 200,
      seconds: 60,
    });
    expect(escaped.a.caughtOpponentAt ?? null).toBeNull();
  }, 60_000);
});
