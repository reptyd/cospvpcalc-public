/// <reference types="node" />
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { applyRulesAndBuild, type CreatureRuntime } from "../engine";
import { getHunkerReductionPct, toRustComposableAbilityConfig } from "./rustBestBuildsRuntime";
import { toRustComposableArgsFromCompare, type CompareSidePerks } from "./rustCompareMatchupRuntime";
import { buildAbilityConfig } from "./buildAbilityConfig";
import { makeAbility, makeSyntheticCreature } from "./__fixtures__/syntheticCreature";

// Step 7 characterization: the unified `buildAbilityConfig` must reproduce, for
// each path, exactly what that path produces today. Best Builds is the flat
// `toRustComposableAbilityConfig` literal; Compare is the
// base + addAbilityPresenceFields + addTrailValues chain, read off the
// `abilityConfig` it ships to the engine. Both are pinned here so a future
// registry/builder edit that shifts either path's bytes fails on the exact field.
//
// The inputs are SYNTHETIC fixtures with test-owned ability values - never live
// creatures - so a wiki sync that changes a real creature's stats / ability
// values / ability presence cannot false-fail these snapshots; only a code
// change to the gate->field mapping can. The fixtures collectively exercise the
// tricky gates: Hunker (activated + passive reduction), Poison Area, Totem
// (subtype), Yolk Bomb (canonical string value), Aura (subtype), Cocoon, Lich
// Mark, the value-bearing actives (Shadow Barrage / Life Leech / Cursed Sigil /
// Spite / Cause Fear), and the trail carriers (Flame/Frost/Plague/Toxic flavors
// + the generic Radiation channel).
const FIXTURES: Record<string, CreatureRuntime> = {
  FxHunkerPoison: makeSyntheticCreature({
    name: "FxHunkerPoison",
    passiveAbilities: [makeAbility("Hunker")],
    activatedAbilities: [makeAbility("Poison Area"), makeAbility("Totem", "Poison")],
  }),
  FxYolkRadTrail: makeSyntheticCreature({
    name: "FxYolkRadTrail",
    passiveAbilities: [makeAbility("Radiation Trail", 25)],
    activatedAbilities: [
      makeAbility("Yolk Bomb", "BlurredVision"),
      makeAbility("Totem", "Radiation"),
      makeAbility("Harden"),
    ],
  }),
  FxAuraFlame: makeSyntheticCreature({
    name: "FxAuraFlame",
    passiveAbilities: [makeAbility("Flame Trail", 30)],
    activatedAbilities: [makeAbility("Aura", "Disease")],
  }),
  FxFrostPlagueCocoon: makeSyntheticCreature({
    name: "FxFrostPlagueCocoon",
    passiveAbilities: [makeAbility("Frost Trail", 30), makeAbility("Plague Trail", 30), makeAbility("Hunker")],
    activatedAbilities: [makeAbility("Cocoon"), makeAbility("Shadow Barrage", 8)],
  }),
  FxToxicLich: makeSyntheticCreature({
    name: "FxToxicLich",
    passiveAbilities: [makeAbility("Toxic Trail", 30)],
    activatedAbilities: [makeAbility("Lich Mark")],
  }),
  FxShadowLeechFear: makeSyntheticCreature({
    name: "FxShadowLeechFear",
    activatedAbilities: [makeAbility("Shadow Barrage", 6), makeAbility("Life Leech", 12), makeAbility("Cause Fear")],
  }),
  FxSigilSpite: makeSyntheticCreature({
    name: "FxSigilSpite",
    activatedAbilities: [makeAbility("Cursed Sigil", 3), makeAbility("Spite", 2)],
  }),
  FxPlain: makeSyntheticCreature({ name: "FxPlain" }),
};

function creature(name: string): CreatureRuntime {
  const r = FIXTURES[name];
  if (!r) throw new Error(`Missing synthetic fixture: ${name}`);
  // Shallow-copy the ability arrays so per-test mutation can't leak between cases.
  return {
    ...r,
    passiveAbilities: [...(r.passiveAbilities ?? [])],
    activatedAbilities: [...(r.activatedAbilities ?? [])],
    breathAbilities: [...(r.breathAbilities ?? [])],
  };
}

function finalStats(name: string) {
  return applyRulesAndBuild(creature(name), {
    venerationStage: 5,
    traits: [],
    ascensionAssignments: [],
    plushies: [],
  });
}

const PERKS: CompareSidePerks = {
  traps: true,
  trails: true,
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

const PAIRS: Array<[string, string]> = [
  ["FxHunkerPoison", "FxYolkRadTrail"], // Hunker (passive) + Poison Area + Totem (Poison) vs Yolk Bomb + Totem (Radiation) + Radiation Trail + Harden
  ["FxAuraFlame", "FxFrostPlagueCocoon"], // Aura + Flame Trail vs Frost/Plague Trail + Hunker + Cocoon + Shadow Barrage
  ["FxToxicLich", "FxShadowLeechFear"], // Toxic Trail + Lich Mark vs Shadow Barrage + Life Leech + Cause Fear
  ["FxSigilSpite", "FxPlain"], // Cursed Sigil + Spite vs no abilities
];

function compareAbilityConfig(a: string, b: string, trails: boolean) {
  const perks = { ...PERKS, trails };
  return toRustComposableArgsFromCompare({
    sourceCreature: creature(a),
    opponentCreature: creature(b),
    finalA: finalStats(a),
    finalB: finalStats(b),
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
  }).abilityConfig;
}

// Keys the Compare path layers on AFTER the shared ability-config surface
// (runtime flags, environment, bite-variant). The unified builder is not
// responsible for these; the BB<->unified comparison is over the BB key set, and
// the Compare<->unified comparison is over the shared-builder key set.
const COMPARE_RUNTIME_ONLY_KEYS = new Set<string>([
  "attackerPowerCharge",
  "defenderPowerCharge",
  "attackerGoreCharge",
  "defenderGoreCharge",
  "attackerSpiteReadyAtStart",
  "defenderSpiteReadyAtStart",
  "attackerCompareMuddyBuff",
  "defenderCompareMuddyBuff",
  "attackerCompareFirstTickRegen",
  "defenderCompareFirstTickRegen",
  "attackerCompareFirstTickAilments",
  "defenderCompareFirstTickAilments",
  "attackerCompareFirstTickDelaySec",
  "defenderCompareFirstTickDelaySec",
  "attackerCompareBlockPersistentDecay",
  "defenderCompareBlockPersistentDecay",
  "attackerCompareHungerRule",
  "defenderCompareHungerRule",
  "attackerCompareGourmandizer",
  "defenderCompareGourmandizer",
  "attackerCompareStartingHunger",
  "defenderCompareStartingHunger",
  "attackerReflectResponseHold",
  "defenderReflectResponseHold",
  "attackerCompareStartingThirst",
  "defenderCompareStartingThirst",
  "attackerCompareHasNoHunger",
  "defenderCompareHasNoHunger",
  "attackerCompareHasNoThirst",
  "defenderCompareHasNoThirst",
  "compareSeasonHungerInterval",
  "compareSeasonThirstInterval",
  "attackerComparePlushieThirstDrainMultiplier",
  "defenderComparePlushieThirstDrainMultiplier",
  "attackerCompareAppetiteBase",
  "defenderCompareAppetiteBase",
  "attackerCompareDefiledGroundLevel",
  "defenderCompareDefiledGroundLevel",
  "attackerCompareDefiledGroundWeakness",
  "defenderCompareDefiledGroundWeakness",
  "attackerCompareDarkStar",
  "defenderCompareDarkStar",
  "attackerCompareGourmandizerFillPct",
  "defenderCompareGourmandizerFillPct",
  "attackerCompareRegenBonusPct",
  "defenderCompareRegenBonusPct",
  "attackerComparePlushieDrainMultiplier",
  "defenderComparePlushieDrainMultiplier",
  "attackerPosturePolicyEnabled",
  "attackerPosturePolicyRegenAware",
  "defenderPosturePolicyEnabled",
  "defenderPosturePolicyRegenAware",
  "attackerHealingPulse",
  "defenderHealingPulse",
  "attackerHealingPulseOnce",
  "defenderHealingPulseOnce",
  "attackerCompareStartHpPct",
  "defenderCompareStartHpPct",
  "attackerHeadStartSec",
  "defenderHeadStartSec",
  "combatEventOrder",
  "attackerBiteVariantMode",
  "defenderBiteVariantMode",
  "attackerBreathPolicy",
  "defenderBreathPolicy",
]);

function pick(config: Record<string, unknown>, keys: Iterable<string>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of keys) out[k] = config[k];
  return out;
}

// Direct builder calls for each input shape. Both production wrappers now call
// `buildAbilityConfig`, so a `toEqual(wrapper)` comparison would be tautological;
// the snapshots below pin the builder's OWN output, and the wrapper comparisons
// only guard that each path threads its inputs through correctly.
function bbShape(a: string, b: string): Record<string, unknown> {
  return buildAbilityConfig({
    sourceCreature: creature(a),
    opponentCreature: creature(b),
    hunkerReductionPctA: getHunkerReductionPct(creature(a)),
    hunkerReductionPctB: getHunkerReductionPct(creature(b)),
  }) as Record<string, unknown>;
}

function compareShape(a: string, b: string, trails: boolean): Record<string, unknown> {
  return buildAbilityConfig({
    sourceCreature: creature(a),
    opponentCreature: creature(b),
    hunkerReductionPctA: getHunkerReductionPct(creature(a)),
    hunkerReductionPctB: getHunkerReductionPct(creature(b)),
    includeTrails: true,
    trailsA: trails,
    trailsB: trails,
  }) as Record<string, unknown>;
}

describe("buildAbilityConfig characterization", () => {
  describe.each(PAIRS)("%s vs %s", (a, b) => {
    // Pin the exact config the builder emits for each input shape. A future
    // accidental change to the gate->field mapping fails the snapshot.
    it("pins the Best Builds (no-trails) config", () => {
      expect(bbShape(a, b)).toMatchSnapshot();
    });

    it.each([true, false])("pins the Compare (trails=%s) config", (trails) => {
      expect(compareShape(a, b, trails)).toMatchSnapshot();
    });

    it("the Best Builds wrapper threads inputs into the unified builder", () => {
      const bb = toRustComposableAbilityConfig(creature(a), creature(b)) as Record<string, unknown>;
      // BB never emits the trail surface; the unified builder must omit it too.
      expect(bb).toEqual(bbShape(a, b));
    });

    it.each([true, false])(
      "the Compare wrapper threads inputs into the unified builder (trails=%s)",
      (trails) => {
        const cmp = compareAbilityConfig(a, b, trails) as Record<string, unknown>;
        const unified = compareShape(a, b, trails);
        // `badOmenOutcomes` is intentionally divergent: the builder emits the
        // deterministic default, but Compare overrides it with a freshly-rolled
        // random batch (Bad Omen is random). Both produce the key; the values
        // differ by design, so exclude it from the value cross-check.
        const sharedKeys = Object.keys(unified).filter(
          (k) => !COMPARE_RUNTIME_ONLY_KEYS.has(k) && k !== "badOmenOutcomes",
        );
        expect(pick(cmp, sharedKeys)).toEqual(pick(unified, sharedKeys));
        // Every shared field the unified builder produces is present in the
        // Compare config (no field silently dropped on the Compare side).
        for (const k of sharedKeys) expect(k in cmp).toBe(true);
      },
    );
  });
});

// Class-1b threading-drop guard. schemaSeamParity.test.ts proves the TS mirror
// TYPE lists every Rust config field; this proves some PRODUCER actually SETS
// each one. A field present in the mirror type but set by no producer is stripped
// by stripNullsForWasm and silently inert in the Rust-only Compare. The oracle is
// wasm-engine/contract_manifest.json (generated by contract_manifest.rs).
describe("ComposableAbilityConfig producer coverage", () => {
  // Keys the Compare producer emits only inside an input-gated branch
  // (toRustComposableArgsFromCompare, rustCompareMatchupRuntime.ts:481-528) -
  // legitimately absent when their input is the default, so not required present.
  // A new conditionally-emitted field must be classified here (the equality below
  // fails until it is); an unconditional field needs no edit - it lands in the
  // builder or runtime-flags set automatically.
  const CONDITIONALLY_EMITTED = new Set<string>([
    "attackerAbilityPolicyOverrides",
    "defenderAbilityPolicyOverrides",
    "compareDayNight",
    "compareMoon",
    "weather",
    "attackerWeatherImmune",
    "defenderWeatherImmune",
    "oxygenMoistureMode",
    "attackerStorming",
    "defenderStorming",
    "radiationNearbyCount",
    "aerialDodgeActive",
    "aerialDodgeRealRandom",
    "aerialDodgeSeed",
  ]);

  // Keys no Compare producer sets at all, because Compare is not their caller.
  // Each one names the producer that does set it; a field with no producer
  // anywhere still fails the equality below.
  const PRODUCED_ELSEWHERE = new Set<string>([]);

  it("every Rust config field is set by some producer (no threading-drop)", () => {
    const manifestPath = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../wasm-engine/contract_manifest.json",
    );
    const manifestConfig: string[] = JSON.parse(readFileSync(manifestPath, "utf8")).composableAbilityConfig;

    // The unified builder emits the full registry-gated surface regardless of the
    // input creatures (flat literal); union it with the always-on Compare runtime
    // layer and the input-gated set. Together these are every key a producer can
    // emit. Union builder keys across all pairs as a belt-and-suspenders against a
    // gate that only fires for specific abilities.
    const builderKeys = new Set<string>();
    for (const [a, b] of PAIRS) {
      for (const k of Object.keys(compareShape(a, b, true))) builderKeys.add(k);
    }
    const produced = new Set<string>([
      ...builderKeys,
      ...COMPARE_RUNTIME_ONLY_KEYS,
      ...CONDITIONALLY_EMITTED,
      ...PRODUCED_ELSEWHERE,
    ]);

    const missing = manifestConfig.filter((k) => !produced.has(k));
    expect(
      missing,
      "Rust ComposableAbilityConfig fields no TS producer sets - thread them in " +
        "buildAbilityConfig / addCompareRuntimeFlags, or classify them in " +
        "CONDITIONALLY_EMITTED (input-gated) / PRODUCED_ELSEWHERE (non-Compare caller)",
    ).toEqual([]);

    const extra = [...produced].filter((k) => !manifestConfig.includes(k));
    expect(extra, "producer keys with no matching Rust config field (stale mirror entry)").toEqual([]);
  });
});
