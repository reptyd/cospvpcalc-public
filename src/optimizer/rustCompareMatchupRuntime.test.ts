import { describe, expect, it } from "vitest";
import { applyRulesAndBuild, type CreatureRuntime } from "../engine";
import { creatureByName } from "../engine/creatureData";
import { toRustComposableArgsFromCompare, type CompareSidePerks } from "./rustCompareMatchupRuntime";
import { makeAbility, makeSyntheticCreature, withRegisteredFixture } from "./__fixtures__/syntheticCreature";

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
  hasDarkstar: false,
  appetiteDrainMultiplier: 1,
  healingPulseEnabled: false,
  healingPulseOnce: false,
  expungeEnabled: false,
  wardenRageStartHpPct: 0,
  headStartSec: 0,
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

  it("falls back to effects catalog values when the creature's stored value is empty", () => {
    // Shadow Barrage present but value-less on the creature, so resolution must
    // fall back to the effects catalog. The empty creature value and the catalog
    // value (7) are both owned by this test - sync-proof, yet still failing if
    // the fallback wiring breaks.
    const sourceCreature = makeSyntheticCreature({
      name: "__fixture_ShadowBarrageCarrier",
      activatedAbilities: [makeAbility("Shadow Barrage", null)],
    });
    const opponentCreature = makeSyntheticCreature({ name: "__fixture_Opponent" });
    const build = { venerationStage: 5, traits: [], ascensionAssignments: [], plushies: [] };
    const finalA = applyRulesAndBuild(sourceCreature, build);
    const finalB = applyRulesAndBuild(opponentCreature, build);

    const args = withRegisteredFixture(
      sourceCreature,
      { otherAbilities: [{ name: "Shadow Barrage", value: 7, semantics: "neutral" }] },
      () =>
        toRustComposableArgsFromCompare({
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
        }),
    );

    expect(args.abilityConfig.attackerShadowBarrageValue).toBe(7);
  });
});

// Every per-side perk has to reach the config field it owns, on the side that
// set it. A review found four of them wired on one side only: blanking
// `attackerCompareDarkStar`, `attackerHeadStartSec`, `attackerExpunge` or
// `attackerHealingPulseOnce` left the opponent's copy working and every test
// green, so the setting did nothing for you and everything for them.
//
// Each row therefore asks three things: on with the perk, off without it, and
// the same again for side B. A field wired to one side passes the first two.

type PerkRow = {
  name: string;
  perk: Partial<CompareSidePerks>;
  attacker: (config: Record<string, unknown>) => unknown;
  defender: (config: Record<string, unknown>) => unknown;
  on: unknown;
  off: unknown;
};

const PERK_ROWS: PerkRow[] = [
  {
    name: "Darkstar",
    perk: { hasDarkstar: true },
    attacker: (c) => c.attackerCompareDarkStar,
    defender: (c) => c.defenderCompareDarkStar,
    on: true,
    off: false,
  },
  {
    name: "Expunge",
    perk: { expungeEnabled: true },
    attacker: (c) => c.attackerExpunge,
    defender: (c) => c.defenderExpunge,
    on: true,
    off: false,
  },
  {
    name: "Healing Pulse once at start",
    perk: { healingPulseEnabled: true, healingPulseOnce: true },
    attacker: (c) => c.attackerHealingPulseOnce,
    defender: (c) => c.defenderHealingPulseOnce,
    on: true,
    off: false,
  },
  {
    name: "Head Start",
    perk: { headStartSec: 7 },
    attacker: (c) => c.attackerHeadStartSec,
    defender: (c) => c.defenderHeadStartSec,
    on: 7,
    off: 0,
  },
  {
    name: "Power Charge",
    perk: { powerCharge: true },
    attacker: (c) => c.attackerPowerCharge,
    defender: (c) => c.defenderPowerCharge,
    on: true,
    off: false,
  },
  {
    name: "Gore Charge",
    perk: { goreCharge: true },
    attacker: (c) => c.attackerGoreCharge,
    defender: (c) => c.defenderGoreCharge,
    on: true,
    off: false,
  },
  {
    name: "Defiled Ground level",
    perk: { defiledGroundLevel: 3 },
    attacker: (c) => c.attackerCompareDefiledGroundLevel,
    defender: (c) => c.defenderCompareDefiledGroundLevel,
    on: 3,
    off: 0,
  },
];

describe("every Compare perk reaches the side that set it", () => {
  function configWith(perksA: CompareSidePerks, perksB: CompareSidePerks): Record<string, unknown> {
    const sourceCreature = creature("Kendyll");
    const opponentCreature = creature("Empiterium");
    return toRustComposableArgsFromCompare({
      sourceCreature,
      opponentCreature,
      finalA: finalStats("Kendyll"),
      finalB: finalStats("Empiterium"),
      activesOn: true,
      breathOn: true,
      abilityPolicy: "fast",
      initialStatusesA: [],
      initialStatusesB: [],
      activeCooldownMultiplierA: 1,
      activeCooldownMultiplierB: 1,
      disabledAbilitiesA: [],
      disabledAbilitiesB: [],
      perksA,
      perksB,
      firstTick: { mode: "off", delaySec: 1 },
      noMoveFacetank: true,
      badOmenOutcome: null,
      compareAirRuleEnabled: false,
      compareAirRuleCooldownSec: 0,
      compareBiteVariantModeA: "primaryOnly",
      compareBiteVariantModeB: "primaryOnly",
    }).abilityConfig as unknown as Record<string, unknown>;
  }

  for (const row of PERK_ROWS) {
    it(`${row.name} reaches side A and only side A`, () => {
      const config = configWith({ ...perks, ...row.perk }, perks);
      expect(row.attacker(config), `${row.name} must reach the attacker`).toEqual(row.on);
      expect(row.defender(config), `${row.name} must not leak to the defender`).toEqual(row.off);
    });

    it(`${row.name} reaches side B and only side B`, () => {
      const config = configWith(perks, { ...perks, ...row.perk });
      expect(row.defender(config), `${row.name} must reach the defender`).toEqual(row.on);
      expect(row.attacker(config), `${row.name} must not leak to the attacker`).toEqual(row.off);
    });
  }
});
