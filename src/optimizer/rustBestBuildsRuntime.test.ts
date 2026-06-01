import { describe, expect, it, beforeEach } from "vitest";
import { applyRulesAndBuild, type CreatureRuntime } from "../engine";
import { creatureByName } from "../engine/creatureData";
import {
  __test_toRustDefaultAbilityPolicyOverrides,
  __test_toRustStatusMeleeStats,
  getRustBlockingActivatedAbilityNamesForPassiveContours,
  getRustComposableBreathIneligibilityReasons,
  getRustComposableMeleeIneligibilityReasons,
  getRustUnsupportedActivatedAbilityNamesForComposable,
  getRustUnsupportedPassiveAbilityNamesForBreath,
  isRustComposableBreathEligible,
  isRustComposableMeleeEligible,
  toRustComposableAbilityConfig,
  toRustBreathProfile,
} from "./rustBestBuildsRuntime";
import { isIgnoredUnimplementedAbilityName } from "./rustPassiveContourShared";

function creature(name: string): CreatureRuntime {
  const runtime = creatureByName[name];
  if (!runtime) throw new Error(`Missing creature fixture: ${name}`);
  // Shallow-copy the ability arrays so per-test mutation doesn't leak.
  return {
    ...runtime,
    passiveAbilities: [...(runtime.passiveAbilities ?? [])],
    activatedAbilities: [...(runtime.activatedAbilities ?? [])],
    breathAbilities: [...(runtime.breathAbilities ?? [])],
  };
}

function applyBuildWithPlushies(name: string, plushies: string[]) {
  return applyRulesAndBuild(creature(name), {
    venerationStage: 5,
    traits: ["Damage", "Bite"],
    ascensionAssignments: ["Damage", "Damage", "Damage", "Damage", "Damage"],
    plushies,
  });
}

function applyBuild(name: string) {
  return applyBuildWithPlushies(name, ["Void", "Void"]);
}

describe("rustBestBuildsRuntime composable eligibility", () => {
  beforeEach(() => {
    const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
    if (env) delete env.COS_CALC_DISABLE_LEGACY_BEST_BUILDS_TS_FALLBACK;
  });

  it("accepts a vanilla breath matchup for composable breath routing", () => {
    const sourceCreature = creature("Phantejer");
    const opponentCreature = creature("Kragnyx");
    const finalA = applyBuild("Phantejer");
    const finalB = applyBuild("Kragnyx");

    const reasons = getRustComposableBreathIneligibilityReasons({
      sourceCreature,
      opponentCreature,
      finalA,
      finalB,
      activesOn: true,
      abilityPolicy: "semiIdeal",
    });
    expect(reasons).toEqual([]);
    expect(
      isRustComposableBreathEligible({
        sourceCreature,
        opponentCreature,
        finalA,
        finalB,
        activesOn: true,
        abilityPolicy: "semiIdeal",
      }),
    ).toBe(true);
  });

  it("accepts breath routing when actives are off", () => {
    const sourceCreature = creature("Phantejer");
    const opponentCreature = creature("Kragnyx");
    const finalA = applyBuild("Phantejer");
    const finalB = applyBuild("Kragnyx");

    const reasons = getRustComposableBreathIneligibilityReasons({
      sourceCreature,
      opponentCreature,
      finalA,
      finalB,
      activesOn: false,
      abilityPolicy: "semiIdeal",
    });
    expect(reasons).not.toContain("actives-off");
    expect(reasons).toEqual([]);
  });

  it.each(["Plasma Beam", "Heliolyth's Judgement"])(
    "accepts %s for composable breath routing",
    (breathType) => {
      const sourceCreature = creature("Eiroca");
      const opponentCreature = creature("Vulturobo");
      const finalA = applyBuild("Eiroca");
      const finalB = { ...applyBuild("Vulturobo"), breathType };

      const reasons = getRustComposableBreathIneligibilityReasons({
        sourceCreature,
        opponentCreature,
        finalA,
        finalB,
        activesOn: true,
        abilityPolicy: "semiIdeal",
      });
      expect(reasons).toEqual([]);
    },
  );

  it("marshals Heliolyth's Judgement as a true-damage auto-fire breath", () => {
    const profile = toRustBreathProfile({
      ...applyBuild("Turrim"),
      hasBreath: true,
      breath: "Heliolyth's Judgement",
      breathType: "Heliolyth's Judgement",
    });

    expect(profile).toMatchObject({
      // Capacity was halved from 20 → 10 in `data/breath_specs.runtime.json`
      // when the engine started draining capacity per breath *tick*
      // (0.5 s) instead of per damage hit (1 s). With the corrected
      // model, capacity 10 preserves the observed in-game ~10 s
      // firing window. See combat.rs:simple_breath_capacity_step
      // for the engine-side commentary.
      dpsPct: 3.2,
      capacity: 10,
      regenRate: 0,
      critChancePct: 0,
      specialKind: "heliolyth_judgement",
      autoFireDelaySec: 3,
      autoFireCooldownSec: 120,
      specialStatuses: [],
    });
  });

  it("applies Arcane breath damage to Heliolyth's Judgement", () => {
    const baseProfile = toRustBreathProfile({
      ...applyBuildWithPlushies("Turrim", []),
      hasBreath: true,
      breath: "Heliolyth's Judgement",
      breathType: "Heliolyth's Judgement",
    });
    const arcaneFinal = applyBuildWithPlushies("Turrim", ["Arcane"]);
    const arcaneProfile = toRustBreathProfile({
      ...arcaneFinal,
      hasBreath: true,
      breath: "Heliolyth's Judgement",
      breathType: "Heliolyth's Judgement",
    });

    expect(arcaneFinal.breathDamagePct).toBeCloseTo(12.5);
    expect(baseProfile?.dpsPct).toBeCloseTo(3.2);
    expect(arcaneProfile?.dpsPct).toBeCloseTo(3.6);
  });

  it("accepts a no-breath matchup for composable melee routing", () => {
    const sourceCreature = creature("Kendyll");
    const opponentCreature = creature("Empiterium");
    const finalA = applyBuild("Kendyll");
    const finalB = applyBuild("Empiterium");

    expect(finalA.hasBreath).toBe(false);
    const reasons = getRustComposableMeleeIneligibilityReasons({
      sourceCreature,
      opponentCreature,
      finalA,
      finalB,
      abilityPolicy: "semiIdeal",
    });
    expect(reasons).toEqual([]);
    expect(
      isRustComposableMeleeEligible({
        sourceCreature,
        opponentCreature,
        finalA,
        finalB,
        abilityPolicy: "semiIdeal",
      }),
    ).toBe(true);
  });

  it("builds Best Builds default timing overrides for Warden's Rage only", () => {
    // After P4 the Hunker (DEFAULT_ABILITY_TIMING_OVERRIDES) and
    // Fortify (Best-Builds-specific) overrides were dropped — both
    // abilities now have math-ideal policies under Ideal mode. The
    // Warden's Rage ReallyFast pin stays in place pending its own
    // policy rework.
    const sourceCreature = creature("Kendyll");
    sourceCreature.activatedAbilities = [
      ...(sourceCreature.activatedAbilities ?? []),
      { abilityId: "wardens-rage", name: "Warden's Rage", value: null, semantics: "neutral", subtype: null },
      { abilityId: "hunker", name: "Hunker", value: 40, semantics: "neutral", subtype: null },
      { abilityId: "fortify", name: "Fortify", value: null, semantics: "neutral", subtype: null },
    ];

    expect(__test_toRustDefaultAbilityPolicyOverrides(sourceCreature)).toEqual({
      "Warden's Rage": "reallyFast",
    });
  });

  it("passes custom-style active presence and string values into Best Builds Rust config", () => {
    const sourceCreature = creature("Kendyll");
    sourceCreature.name = "Custom Source";
    sourceCreature.activatedAbilities = [
      { abilityId: "poison-area", name: "Poison Area", value: null, semantics: "neutral", subtype: null },
      { abilityId: "yolk-bomb", name: "Yolk Bomb", value: "Bad Omen", semantics: "neutral", subtype: null },
      { abilityId: "harden", name: "Harden", value: null, semantics: "neutral", subtype: null },
      { abilityId: "cocoon", name: "Cocoon", value: null, semantics: "neutral", subtype: null },
    ];
    const opponentCreature = creature("Empiterium");

    const config = toRustComposableAbilityConfig(sourceCreature, opponentCreature);

    expect(config.attackerPoisonArea).toBe(true);
    expect(config.attackerYolkBomb).toBe(true);
    expect(config.attackerYolkBombValue).toBe("BadOmen");
    expect(config.attackerHarden).toBe(true);
    expect(config.attackerCocoon).toBe(true);
  });

  it("falls back to effects catalog values when stale creature ability values are empty", () => {
    const sourceCreature = creature("Pentagloss");
    sourceCreature.activatedAbilities = (sourceCreature.activatedAbilities ?? []).map((ability) =>
      ability.name === "Shadow Barrage" ? { ...ability, value: null } : ability,
    );
    const opponentCreature = creature("Empiterium");

    const config = toRustComposableAbilityConfig(sourceCreature, opponentCreature);

    expect(config.attackerShadowBarrageValue).toBe(5);
  });

  it("treats Tarakotu typoed Strength In Numbers as non-blocking for composable melee routing", () => {
    const sourceCreature = creature("Adharcaiin");
    const opponentCreature = creature("Tarakotu");
    const finalA = applyRulesAndBuild(sourceCreature, {
      venerationStage: 5,
      traits: ["Bite", "Damage"],
      ascensionAssignments: ["Bite", "Damage", "Damage", "Damage", "Damage"],
      plushies: ["Void", "Void"],
      elder: "Powerful",
    });
    const finalB = applyBuild("Tarakotu");

    expect(finalA.hasBreath).toBe(false);
    expect(finalB.hasBreath).toBe(false);
    const reasons = getRustComposableMeleeIneligibilityReasons({
      sourceCreature,
      opponentCreature,
      finalA,
      finalB,
      abilityPolicy: "semiIdeal",
    });
    expect(reasons).toEqual([]);
    expect(
      isRustComposableMeleeEligible({
        sourceCreature,
        opponentCreature,
        finalA,
        finalB,
        abilityPolicy: "semiIdeal",
      }),
    ).toBe(true);
  });

  it("accepts a Lich Mark carrier for composable melee routing", () => {
    const sourceCreature = creature("Okiamano");
    const opponentCreature = creature("Kendyll");
    const finalA = applyBuild("Okiamano");
    const finalB = applyBuild("Kendyll");

    expect(finalA.hasBreath).toBe(false);
    const reasons = getRustComposableMeleeIneligibilityReasons({
      sourceCreature,
      opponentCreature,
      finalA,
      finalB,
      abilityPolicy: "semiIdeal",
    });
    expect(reasons).toEqual([]);
    expect(
      isRustComposableMeleeEligible({
        sourceCreature,
        opponentCreature,
        finalA,
        finalB,
        abilityPolicy: "semiIdeal",
      }),
    ).toBe(true);
  });

  it("rejects composable melee routing when either side has breath", () => {
    const sourceCreature = creature("Phantejer");
    const opponentCreature = creature("Kragnyx");
    const finalA = applyBuild("Phantejer");
    const finalB = applyBuild("Kragnyx");
    const reasons = getRustComposableMeleeIneligibilityReasons({
      sourceCreature,
      opponentCreature,
      finalA,
      finalB,
      abilityPolicy: "semiIdeal",
    });
    expect(reasons).toContain("breath-on-source");
  });
});

describe("shared passive-contour helpers", () => {
  it("lists nothing blocking for a vanilla creature with no activateds", () => {
    const source = creature("Jeff");
    source.activatedAbilities = [];
    expect(getRustBlockingActivatedAbilityNamesForPassiveContours(source)).toEqual([]);
  });

  it("lists nothing unsupported on generic breath passives for a vanilla creature", () => {
    const source = creature("Jeff");
    expect(getRustUnsupportedPassiveAbilityNamesForBreath(source)).toEqual([]);
  });
});

describe("Stubborn Stacker Rust marshalling", () => {
  it("sends Cat and Tannenbaum overrides to Rust for Pentagloss", () => {
    const sourceCreature = creature("Pentagloss");
    const baseFinal = applyRulesAndBuild(sourceCreature, {
      venerationStage: 0,
      traits: [],
      ascensionAssignments: ["", "", "", "", ""],
      plushies: [],
    });
    const catFinal = applyRulesAndBuild(sourceCreature, {
      venerationStage: 0,
      traits: [],
      ascensionAssignments: ["", "", "", "", ""],
      plushies: ["Cat"],
    });
    const treeFinal = applyRulesAndBuild(sourceCreature, {
      venerationStage: 0,
      traits: [],
      ascensionAssignments: ["", "", "", "", ""],
      plushies: ["Tannenbaum"],
    });

    const baseRust = __test_toRustStatusMeleeStats(sourceCreature, baseFinal);
    const catRust = __test_toRustStatusMeleeStats(sourceCreature, catFinal);
    const treeRust = __test_toRustStatusMeleeStats(sourceCreature, treeFinal);

    expect(catRust.healthRegen ?? 0).toBeCloseTo((sourceCreature.stats.healthRegen ?? 0) * 1.1, 6);
    expect(catRust.plushieStatusBlockFractions?.["Bleed_Status"]).toBeCloseTo(0.05, 6);
    expect(catRust.onHitStatuses).toEqual(baseRust.onHitStatuses);

    expect(treeRust.biteCooldown).toBeCloseTo(sourceCreature.stats.biteCooldown * 0.95, 6);
    expect(treeRust.plushieStatusBlockFractions?.["Frostbite_Status"]).toBeCloseTo(0.05, 6);
    expect(treeRust.onHitStatuses).toEqual(baseRust.onHitStatuses);
  });

  it("applies the Gentle elder's +10% all-ailment block to every ailment in the Rust stats", () => {
    // Regression: the elder ailment block (Gentle = +10% to ALL ailments)
    // used to be dropped — toRustStatusMeleeStats only mapped per-plushie
    // blocks and ignored finalStats.elderStatusBlockPct, and the helper that
    // combines them was never called. The combined helper is now wired in.
    const c = creature("Phantejer");
    const noElder = applyRulesAndBuild(c, {
      venerationStage: 0,
      traits: [],
      ascensionAssignments: ["", "", "", "", ""],
      plushies: [],
    });
    const gentle = applyRulesAndBuild(c, {
      venerationStage: 0,
      traits: [],
      ascensionAssignments: ["", "", "", "", ""],
      plushies: [],
      elder: "Gentle",
    });
    const noElderRust = __test_toRustStatusMeleeStats(c, noElder);
    const gentleRust = __test_toRustStatusMeleeStats(c, gentle);

    // Without an elder (and no block plushies) there is no ailment block.
    expect(noElderRust.plushieStatusBlockFractions?.["Bleed_Status"] ?? 0).toBe(0);
    // Gentle spreads +10% block across every ailment, not just one.
    for (const id of ["Bleed_Status", "Poison_Status", "Burn_Status", "Frostbite_Status", "Corrosion_Status"]) {
      expect(gentleRust.plushieStatusBlockFractions?.[id]).toBeCloseTo(0.1, 6);
    }
  });

  it("treats unclassified abilities as not-modeled and never marks them unsupported (fail-open)", () => {
    // Regression: a creature whose kit contains abilities the author hasn't
    // modeled or classified (Militrua: Overcharged, Channeling, Defensive
    // Paralyze are in no modeled/out-of-model list) used to be flagged as
    // having "unsupported" abilities, which made Compare/BB refuse to
    // simulate the matchup entirely. Unclassified abilities are now treated
    // as ignorable "not modeled" — the fight runs without them.
    const militrua = creature("Militrua");
    expect(getRustUnsupportedActivatedAbilityNamesForComposable(militrua)).toEqual([]);
    expect(getRustUnsupportedPassiveAbilityNamesForBreath(militrua)).toEqual([]);
    // The predicate ignores an unclassified ability but still respects a
    // genuinely modeled one (so modeled abilities keep their real handling).
    expect(isIgnoredUnimplementedAbilityName("Overcharged")).toBe(true);
    expect(isIgnoredUnimplementedAbilityName("Reflect")).toBe(false);
  });

  it("sends Pig-Lantern and Haunt Dragon overrides to Rust for Vespritte", () => {
    const sourceCreature = creature("Vespritte");
    const baseFinal = applyRulesAndBuild(sourceCreature, {
      venerationStage: 0,
      traits: [],
      ascensionAssignments: ["", "", "", "", ""],
      plushies: [],
    });
    const pigFinal = applyRulesAndBuild(sourceCreature, {
      venerationStage: 0,
      traits: [],
      ascensionAssignments: ["", "", "", "", ""],
      plushies: ["Pig-Lantern"],
    });
    const hauntFinal = applyRulesAndBuild(sourceCreature, {
      venerationStage: 0,
      traits: [],
      ascensionAssignments: ["", "", "", "", ""],
      plushies: ["Haunt Dragon"],
    });

    const baseRust = __test_toRustStatusMeleeStats(sourceCreature, baseFinal);
    const pigRust = __test_toRustStatusMeleeStats(sourceCreature, pigFinal);
    const hauntRust = __test_toRustStatusMeleeStats(sourceCreature, hauntFinal);

    expect(pigRust.damage).toBeCloseTo(sourceCreature.stats.damage * 1.05, 6);
    expect(pigRust.plushieStatusBlockFractions?.["Burn_Status"]).toBeCloseTo(0.05, 6);
    expect(pigRust.onHitStatuses).toEqual(baseRust.onHitStatuses);

    expect(hauntRust.healthRegen ?? 0).toBeCloseTo(sourceCreature.stats.healthRegen ?? 0, 6);
    expect(hauntRust.activeCooldownMultiplier ?? 1).toBeCloseTo(baseRust.activeCooldownMultiplier ?? 1, 6);
    expect(hauntRust.biteCooldown).toBeCloseTo(baseRust.biteCooldown, 6);
    expect(hauntFinal.stamRegen ?? 0).toBeCloseTo((sourceCreature.stats.stamRegen ?? 0) * 1.25, 6);
    expect(hauntRust.plushieStatusBlockFractions?.["Poison_Status"]).toBeCloseTo(0.05, 6);
    expect(hauntRust.onHitStatuses).toEqual(baseRust.onHitStatuses);
  });
});

describe("Phase 5 / G8 creature-identity marshalling", () => {
  it("threads type / diet / elder / tier from FinalStats to Rust identity", () => {
    const sourceCreature = creature("Pentagloss");
    const baseFinal = applyRulesAndBuild(sourceCreature, {
      venerationStage: 0,
      traits: [],
      ascensionAssignments: ["", "", "", "", ""],
      plushies: [],
    });
    const rust = __test_toRustStatusMeleeStats(sourceCreature, baseFinal);
    // Drift-proof: identity mirrors FinalStats rather than hard-coded
    // wiki values, so a data refresh can't false-fail this.
    expect(rust.identity).toBeDefined();
    expect(rust.identity?.type).toBe(baseFinal.type ?? "");
    expect(rust.identity?.diet).toBe(baseFinal.diet ?? "");
    expect(rust.identity?.elder).toBe(baseFinal.elder ?? "");
    expect(rust.identity?.tier).toBe(baseFinal.tier ?? 0);
  });

  it("reflects the elder build option in identity.elder", () => {
    const sourceCreature = creature("Pentagloss");
    const elderFinal = applyRulesAndBuild(sourceCreature, {
      venerationStage: 0,
      traits: [],
      ascensionAssignments: ["", "", "", "", ""],
      plushies: [],
      elder: "Powerful",
    });
    expect(elderFinal.elder).toBe("Powerful");
    const rust = __test_toRustStatusMeleeStats(sourceCreature, elderFinal);
    expect(rust.identity?.elder).toBe("Powerful");
  });
});

describe("Phase 7 / G7 custom breath profile", () => {
  it("returns the authored profile (bypassing name lookup) with build buffs on top", () => {
    const base = applyRulesAndBuild(creature("Pentagloss"), {
      venerationStage: 0,
      traits: [],
      ascensionAssignments: ["", "", "", "", ""],
      plushies: [],
    });
    const custom = {
      dpsPct: 4,
      capacity: 10,
      regenRate: 8,
      critChancePct: 25,
      chain: 2,
      chainMaxStacks: 5,
      specialKind: "heal" as const,
      selfHealPct: 2,
      specialStatuses: [{ statusId: "user.CustomBurn", stacks: 1 }],
    };

    // No buffs → profile passes through exactly as authored (and bypasses
    // the breath-name lookup even though breathType is a non-spec string).
    const plain = toRustBreathProfile({
      ...base,
      breathType: "Custom",
      customBreathProfile: custom,
    });
    expect(plain?.dpsPct).toBeCloseTo(4, 6);
    expect(plain?.regenRate).toBeCloseTo(8, 6);
    expect(plain?.capacity).toBe(10);
    expect(plain?.specialKind).toBe("heal");
    expect(plain?.selfHealPct).toBe(2);
    expect(plain?.specialStatuses).toEqual([{ statusId: "user.CustomBurn", stacks: 1 }]);

    // Build buffs apply on top, same transforms as the standard spec path:
    // +50% breath damage scales dpsPct; +100% breath regen divides regenRate.
    const buffed = toRustBreathProfile({
      ...base,
      breathType: "Custom",
      customBreathProfile: custom,
      breathDamagePct: 50,
      breathRegenPct: 100,
    });
    expect(buffed?.dpsPct).toBeCloseTo(6, 6); // 4 × 1.5
    expect(buffed?.regenRate).toBeCloseTo(4, 6); // max(0.5, 8 / 2)
  });
});
