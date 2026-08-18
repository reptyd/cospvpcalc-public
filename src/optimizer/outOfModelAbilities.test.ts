/// <reference types="node" />
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { applyRulesAndBuild, type CreatureRuntime } from "../engine";
import { BAD_OMEN_DEFAULT_OUTCOME } from "../engine/subsystems/statuses";
import {
  REFERENCE_OUT_OF_MODEL_ABILITY_NAMES,
  REFERENCE_SPEED_BUILDS_ONLY_ABILITY_NAMES,
} from "../pages/referenceContent";
import { makeAbility, makeSyntheticCreature } from "./__fixtures__/syntheticCreature";
import type { RustMatchupSummary } from "./rustMatchupBridge";
import { stripNullsForWasm } from "./rustMatchupLoader";
import { loadRustForNode } from "./rustNodeMatchup";
import { toRustComposableArgsFromCompare, type CompareSidePerks } from "./rustCompareMatchupRuntime";

// "Nothing about this ability reaches a number this calculator produces."
// Every Out of model entry says exactly that, and the Speed-Builds-only ones
// say the same thing about a fight - their modeled side is a movement channel
// no fight reads. Either way it is a claim about the engine, not an excuse: a
// fight that carries the ability must come out where the same fight without it
// came out. The check runs the whole Compare path - build rules, the bridge,
// the shipped WASM - so an ability that reaches any field along the way moves a
// number and reds here.
//
// Synthetic creatures throughout: the two sides own their stats, so a wiki sync
// cannot move the baseline, and the ability under test is the only difference
// between the two runs.
//
// The entries this covers. Written out because coverage counts markers, and
// kept honest by the first case below, which diffs this block against the
// entries themselves.
//
// [REF:ability_agile_swimmer] [REF:ability_area_food_restore]
// [REF:ability_area_water_restore] [REF:ability_area_wind_blast]
// [REF:ability_burrower] [REF:ability_change_weather]
// [REF:ability_channeling] [REF:ability_climber]
// [REF:ability_dart] [REF:ability_dazzling_flash] [REF:ability_diver]
// [REF:ability_earthquake] [REF:ability_egg_stealer]
// [REF:ability_escape_area] [REF:ability_gale] [REF:ability_genesis_tether]
// [REF:ability_glittering_trail] [REF:ability_grab] [REF:ability_heal_beam]
// [REF:ability_healing_hunter] [REF:ability_ink_cloud]
// [REF:ability_invisibility] [REF:ability_iron_stomach]
// [REF:ability_keen_observer] [REF:ability_latch] [REF:ability_lure]
// [REF:ability_moon_beam]
// [REF:ability_overcharged] [REF:ability_raider] [REF:ability_shock_area]
// [REF:ability_silent_hunter] [REF:ability_soft_landing]
// [REF:ability_sonic_wings] [REF:ability_speed_blitz]
// [REF:ability_speed_steal] [REF:ability_stamina_puddle]
// [REF:ability_sticky_trap] [REF:ability_tail_drop] [REF:ability_vanish]
// [REF:ability_will_to_live]

const ATTACKER = makeSyntheticCreature({
  name: "OutOfModelAttacker",
  stats: { health: 8_000, weight: 120, damage: 220, biteCooldown: 1.4, healthRegen: 1.5 },
});

const DEFENDER = makeSyntheticCreature({
  name: "OutOfModelDefender",
  stats: { health: 9_500, weight: 140, damage: 180, biteCooldown: 1.6, healthRegen: 2 },
  passiveAbilities: [makeAbility("Bleed Attack", 3)],
});

const PERKS: CompareSidePerks = {
  traps: false, trails: true, powerCharge: false, goreCharge: false, startingSpiteCharged: false,
  muddyBuff: false, hungerRule: false, gourmandizer: false, startingHungerUnits: 100, appetiteBaseUnits: 100,
  defiledGroundLevel: 0, defiledGroundWeakness: false, hasDarkstar: false, appetiteDrainMultiplier: 1,
  healingPulseEnabled: false, healingPulseOnce: false, expungeEnabled: false, wardenRageStartHpPct: 0,
  headStartSec: 0,
};

const BUILD = { venerationStage: 5, traits: [], ascensionAssignments: [], plushies: [] };

function simulate(
  rustMod: Awaited<ReturnType<typeof loadRustForNode>>,
  attacker: CreatureRuntime,
  defender: CreatureRuntime,
): RustMatchupSummary {
  const args = toRustComposableArgsFromCompare({
    sourceCreature: attacker, opponentCreature: defender,
    finalA: applyRulesAndBuild(attacker, BUILD), finalB: applyRulesAndBuild(defender, BUILD),
    activesOn: true, breathOn: true, abilityPolicy: "ideal",
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
  const sim = rustMod.simulate_composable_matchup_js as (...a: unknown[]) => RustMatchupSummary;
  return sim(
    stripNullsForWasm(args.attacker), stripNullsForWasm(args.defender),
    stripNullsForWasm(args.attackerBreath ?? undefined), stripNullsForWasm(args.defenderBreath ?? undefined),
    args.abilityPolicy, stripNullsForWasm(args.abilityConfig), 900, false,
  );
}

function carrying(creature: CreatureRuntime, ability: string, slot: "passive" | "activated"): CreatureRuntime {
  return {
    ...creature,
    passiveAbilities: [...(creature.passiveAbilities ?? []), ...(slot === "passive" ? [makeAbility(ability)] : [])],
    activatedAbilities: [...(creature.activatedAbilities ?? []), ...(slot === "activated" ? [makeAbility(ability)] : [])],
  };
}

const INERT_IN_A_FIGHT = [
  ...REFERENCE_OUT_OF_MODEL_ABILITY_NAMES,
  ...REFERENCE_SPEED_BUILDS_ONLY_ABILITY_NAMES,
];

describe("abilities the Reference leaves out of the combat model", () => {
  it("covers every entry that claims a fight reads nothing from it, and claims no more", () => {
    // The cases below read the entries, so they follow a reclassification on
    // their own; the marker block above cannot, so it is diffed here rather
    // than left to rot into a claim nothing backs.
    const slug = (name: string) =>
      `ability_${name.toLowerCase().replace(/['‘’ʼ]/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "")}`;
    const marked = [...readFileSync(fileURLToPath(import.meta.url), "utf8").matchAll(/\[REF:([a-z0-9_]+)\]/g)]
      .map((match) => match[1])
      .sort();
    expect(marked).toEqual(INERT_IN_A_FIGHT.map(slug).sort());
  });

  it("resolves a decisive fight to compare against", async () => {
    const rustMod = await loadRustForNode();
    const baseline = simulate(rustMod, ATTACKER, DEFENDER);
    // A fight that timed out or ended instantly would be identical whatever the
    // ability did, so the comparison below would prove nothing.
    expect(baseline.winner === "A" || baseline.winner === "B").toBe(true);
    expect(baseline.ttkAtoB).toBeGreaterThan(5);
    expect(baseline.ttkAtoB).toBeLessThan(880);
    expect(baseline.damageDealtA).toBeGreaterThan(0);
    expect(baseline.damageDealtB).toBeGreaterThan(0);
  }, 30_000);

  it.each(["passive" as const, "activated" as const])(
    "changes no combat outcome when carried as a %s ability",
    async (slot) => {
      const rustMod = await loadRustForNode();
      const baseline = JSON.stringify(simulate(rustMod, ATTACKER, DEFENDER));
      const moved: string[] = [];
      for (const ability of INERT_IN_A_FIGHT) {
        // Both sides, because a modelled effect can land on the carrier or on
        // the creature facing it.
        const onAttacker = JSON.stringify(simulate(rustMod, carrying(ATTACKER, ability, slot), DEFENDER));
        const onDefender = JSON.stringify(simulate(rustMod, ATTACKER, carrying(DEFENDER, ability, slot)));
        if (onAttacker !== baseline) moved.push(`${ability} (on the attacker)`);
        if (onDefender !== baseline) moved.push(`${ability} (on the defender)`);
      }
      expect(
        moved,
        "these abilities are marked Out of model, but the engine reacted to them:\n" + moved.join("\n"),
      ).toEqual([]);
    },
    180_000,
  );
});
