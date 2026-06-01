import { describe, expect, it } from "vitest";
import { applyRulesAndBuild, type CreatureRuntime } from "../engine";
import { creatureByName } from "../engine/creatureData";
import { toRustComposableArgsFromCompare, type CompareSidePerks } from "./rustCompareMatchupRuntime";

function creature(name: string): CreatureRuntime {
  const runtime = creatureByName[name];
  if (!runtime) throw new Error(`Missing creature fixture: ${name}`);
  return {
    ...runtime,
    passiveAbilities: [...(runtime.passiveAbilities ?? [])],
    activatedAbilities: [...(runtime.activatedAbilities ?? [])],
    breathAbilities: [...(runtime.breathAbilities ?? [])],
  };
}

function finalStats(name: string) {
  return applyRulesAndBuild(creature(name), {
    venerationStage: 5,
    traits: ["Damage", "Bite"],
    ascensionAssignments: ["Damage", "Damage", "Damage", "Damage", "Damage"],
    plushies: ["Void", "Void"],
  });
}

const perks: CompareSidePerks = {
  traps: false,
  trails: false,
  powerCharge: false,
  goreCharge: false,
  startingSpiteCharged: false,
  muddyBuff: false,
  hungerRule: false,
  gourmandizer: false,
  startingHungerUnits: 100,
  appetiteBaseUnits: 100,
  defiledGroundLevel: 0,
  defiledGroundWeakness: false,
  appetiteDrainMultiplier: 1,
  healingPulseEnabled: false,
  healingPulseOnce: false,
  expungeEnabled: false,
  wardenRageStartHpPct: 0,
};

describe("toRustComposableArgsFromCompare", () => {
  it("treats concrete breath disables as side-specific Breath suppression", () => {
    const sourceCreature = creature("Phantejer");
    const opponentCreature = creature("Kragnyx");
    const finalA = finalStats("Phantejer");
    const finalB = finalStats("Kragnyx");

    const args = toRustComposableArgsFromCompare({
      sourceCreature,
      opponentCreature,
      finalA,
      finalB,
      activesOn: true,
      breathOn: true,
      abilityPolicy: "fast",
      initialStatusesA: [],
      initialStatusesB: [],
      activeCooldownMultiplierA: 1,
      activeCooldownMultiplierB: 1,
      disabledAbilitiesA: [finalA.breathType ?? "Breath"],
      disabledAbilitiesB: [],
      perksA: perks,
      perksB: perks,
      firstTick: { mode: "off", delaySec: 1 },
      noMoveFacetank: true,
      badOmenOutcome: null,
      compareAirRuleEnabled: false,
      compareAirRuleCooldownSec: 0,
      compareBiteVariantModeA: "primaryOnly",
      compareBiteVariantModeB: "primaryOnly",
    });

    expect(args.attackerBreath).toBeNull();
    expect(args.defenderBreath).not.toBeNull();
  });

  it("keeps compare hunger runtime flags when actives are globally off", () => {
    const sourceCreature = creature("Kendyll");
    const opponentCreature = creature("Empiterium");
    const finalA = finalStats("Kendyll");
    const finalB = finalStats("Empiterium");
    const hungerPerks = { ...perks, hungerRule: true, gourmandizer: true, startingHungerUnits: 125 };

    const args = toRustComposableArgsFromCompare({
      sourceCreature,
      opponentCreature,
      finalA,
      finalB,
      activesOn: false,
      breathOn: false,
      abilityPolicy: "fast",
      initialStatusesA: [],
      initialStatusesB: [],
      activeCooldownMultiplierA: 1,
      activeCooldownMultiplierB: 1,
      disabledAbilitiesA: [],
      disabledAbilitiesB: [],
      perksA: hungerPerks,
      perksB: perks,
      firstTick: { mode: "both", delaySec: 1 },
      noMoveFacetank: false,
      badOmenOutcome: null,
      compareAirRuleEnabled: false,
      compareAirRuleCooldownSec: 0,
      compareBiteVariantModeA: "primaryOnly",
      compareBiteVariantModeB: "primaryOnly",
    });

    expect(args.abilityConfig.attackerCompareHungerRule).toBe(true);
    expect(args.abilityConfig.attackerCompareStartingHunger).toBe(125);
    expect(args.abilityConfig.attackerCompareFirstTickRegen).toBe(true);
    expect(args.abilityConfig.attackerWardenRage).toBeUndefined();
  });

  it("wires compare Warden's Rage starting HP into Rust config", () => {
    const sourceCreature = creature("Kendyll");
    sourceCreature.activatedAbilities = [
      ...(sourceCreature.activatedAbilities ?? []),
      { abilityId: "wardens-rage", name: "Warden's Rage", value: null, semantics: "neutral", subtype: null },
    ];
    const opponentCreature = creature("Empiterium");
    const finalA = finalStats("Kendyll");
    const finalB = finalStats("Empiterium");

    const args = toRustComposableArgsFromCompare({
      sourceCreature,
      opponentCreature,
      finalA,
      finalB,
      activesOn: true,
      breathOn: false,
      abilityPolicy: "reallyFast",
      initialStatusesA: [],
      initialStatusesB: [],
      activeCooldownMultiplierA: 1,
      activeCooldownMultiplierB: 1,
      disabledAbilitiesA: [],
      disabledAbilitiesB: [],
      perksA: { ...perks, wardenRageStartHpPct: 40 },
      perksB: perks,
      firstTick: { mode: "off", delaySec: 1 },
      noMoveFacetank: true,
      badOmenOutcome: null,
      compareAirRuleEnabled: false,
      compareAirRuleCooldownSec: 0,
      compareBiteVariantModeA: "primaryOnly",
      compareBiteVariantModeB: "primaryOnly",
    });

    expect(args.abilityConfig.attackerWardenRage).toBe(true);
    expect(args.abilityConfig.attackerCompareStartHpPct).toBe(40);
    expect(args.abilityConfig.defenderCompareStartHpPct).toBe(0);
  });

  it("wires Reflux from creature data and honors side-specific disable", () => {
    const sourceCreature = creature("Venuella");
    const opponentCreature = creature("Gholbini");
    const finalA = finalStats("Venuella");
    const finalB = finalStats("Gholbini");

    const enabled = toRustComposableArgsFromCompare({
      sourceCreature,
      opponentCreature,
      finalA,
      finalB,
      activesOn: true,
      breathOn: false,
      abilityPolicy: "ideal",
      initialStatusesA: [],
      initialStatusesB: [],
      activeCooldownMultiplierA: 1,
      activeCooldownMultiplierB: 1,
      disabledAbilitiesA: [],
      disabledAbilitiesB: [],
      perksA: perks,
      perksB: perks,
      firstTick: { mode: "off", delaySec: 1 },
      noMoveFacetank: true,
      badOmenOutcome: null,
      compareAirRuleEnabled: false,
      compareAirRuleCooldownSec: 0,
      compareBiteVariantModeA: "primaryOnly",
      compareBiteVariantModeB: "primaryOnly",
    });

    expect(enabled.abilityConfig.attackerReflux).toBe(true);
    expect(enabled.abilityConfig.defenderReflux).toBe(true);

    const disabled = toRustComposableArgsFromCompare({
      sourceCreature,
      opponentCreature,
      finalA,
      finalB,
      activesOn: true,
      breathOn: false,
      abilityPolicy: "ideal",
      initialStatusesA: [],
      initialStatusesB: [],
      activeCooldownMultiplierA: 1,
      activeCooldownMultiplierB: 1,
      disabledAbilitiesA: ["Reflux"],
      disabledAbilitiesB: [],
      perksA: perks,
      perksB: perks,
      firstTick: { mode: "off", delaySec: 1 },
      noMoveFacetank: true,
      badOmenOutcome: null,
      compareAirRuleEnabled: false,
      compareAirRuleCooldownSec: 0,
      compareBiteVariantModeA: "primaryOnly",
      compareBiteVariantModeB: "primaryOnly",
    });

    expect(disabled.abilityConfig.attackerReflux).toBe(false);
    expect(disabled.abilityConfig.defenderReflux).toBe(true);
  });

  it("wires custom-style Cocoon and canonical Yolk Bomb values into compare Rust config", () => {
    const sourceCreature = creature("Kendyll");
    sourceCreature.name = "Custom Compare Source";
    sourceCreature.activatedAbilities = [
      { abilityId: "cocoon", name: "Cocoon", value: null, semantics: "neutral", subtype: null },
      { abilityId: "yolk-bomb", name: "Yolk Bomb", value: "Blurred Vision", semantics: "neutral", subtype: null },
    ];
    const opponentCreature = creature("Empiterium");
    const finalA = {
      ...finalStats("Kendyll"),
      name: sourceCreature.name,
    };
    const finalB = finalStats("Empiterium");

    const args = toRustComposableArgsFromCompare({
      sourceCreature,
      opponentCreature,
      finalA,
      finalB,
      activesOn: true,
      breathOn: false,
      abilityPolicy: "fast",
      initialStatusesA: [],
      initialStatusesB: [],
      activeCooldownMultiplierA: 1,
      activeCooldownMultiplierB: 1,
      disabledAbilitiesA: [],
      disabledAbilitiesB: [],
      perksA: perks,
      perksB: perks,
      firstTick: { mode: "off", delaySec: 1 },
      noMoveFacetank: true,
      badOmenOutcome: null,
      compareAirRuleEnabled: false,
      compareAirRuleCooldownSec: 0,
      compareBiteVariantModeA: "primaryOnly",
      compareBiteVariantModeB: "primaryOnly",
    });

    expect(args.abilityConfig.attackerCocoon).toBe(true);
    expect(args.abilityConfig.attackerYolkBomb).toBe(true);
    expect(args.abilityConfig.attackerYolkBombValue).toBe("BlurredVision");
  });

  it("falls back to effects catalog values when stale creature ability values are empty", () => {
    const sourceCreature = creature("Pentagloss");
    sourceCreature.activatedAbilities = (sourceCreature.activatedAbilities ?? []).map((ability) =>
      ability.name === "Shadow Barrage" ? { ...ability, value: null } : ability,
    );
    const opponentCreature = creature("Empiterium");
    const finalA = finalStats("Pentagloss");
    const finalB = finalStats("Empiterium");

    const args = toRustComposableArgsFromCompare({
      sourceCreature,
      opponentCreature,
      finalA,
      finalB,
      activesOn: true,
      breathOn: false,
      abilityPolicy: "fast",
      initialStatusesA: [],
      initialStatusesB: [],
      activeCooldownMultiplierA: 1,
      activeCooldownMultiplierB: 1,
      disabledAbilitiesA: [],
      disabledAbilitiesB: [],
      perksA: perks,
      perksB: perks,
      firstTick: { mode: "off", delaySec: 1 },
      noMoveFacetank: true,
      badOmenOutcome: null,
      compareAirRuleEnabled: false,
      compareAirRuleCooldownSec: 0,
      compareBiteVariantModeA: "primaryOnly",
      compareBiteVariantModeB: "primaryOnly",
    });

    expect(args.abilityConfig.attackerShadowBarrageValue).toBe(5);
  });
});
