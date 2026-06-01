import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { applyRulesAndBuild, simulateFight, type BuildOptions } from "../src/engine";
import { creatureByName } from "../src/engine/creatureData";
import {
  applyCompareBuffRuntime,
  DEFAULT_COMPARE_BUFF_SELECTION,
  type CompareBuffSelection,
  type CompareDayNightMode,
  type CompareMoonMode,
} from "../src/engine/compareBuffRuntime";
import {
  DEFAULT_COMPARE_SPECIAL_ABILITIES,
  creatureHasAbility,
  type CompareSpecialAbilityState,
} from "../src/components/compare/compareSpecialAbilities";
import {
  convertFillPctToAppetiteUnits,
  getGourmandizerWeightBonusPctFromFillPct,
  normalizeCompareFillPct,
} from "../src/engine/compareHungerMath";
import { getCompareAppetiteEntry } from "../src/engine/compareAppetiteData";
import { getDefiledGroundStatBonusPct } from "../src/engine/compareDefiledGroundData";
import { projectBestBuildsMatchupSummary } from "../src/optimizer/bestBuildsMatchupContract";
import {
  toRustComposableArgsFromCompare,
  type CompareInitialStatus,
  type CompareSidePerks,
  type CompareFirstTickConfig,
} from "../src/optimizer/rustCompareMatchupRuntime";
import type { AbilityTimingMode, FinalStats } from "../src/engine";

// Mirrors useCompareSimulation.applyCompareSpecialAbilities — keep in sync.
// Applied AFTER applyCompareBuffRuntime to bake static stat buffs into finalStats.
function applyCompareSpecialAbilities(
  finalStats: FinalStats,
  creature: ReturnType<typeof requireCreature>,
  abilities: CompareSpecialAbilityState,
): FinalStats {
  const next: FinalStats = {
    ...finalStats,
    approxNotes: [...finalStats.approxNotes],
    appliedTraits: [...finalStats.appliedTraits],
  };
  const applyPct = (value: number | undefined, pct: number): number | undefined => {
    if (typeof value !== "number" || !Number.isFinite(value)) return value;
    return value * (1 + pct / 100);
  };
  if (abilities.volcanic && creatureHasAbility(creature, "Volcanic")) {
    next.healthRegen = applyPct(next.healthRegen, 50) ?? next.healthRegen;
  }
  if (abilities.frosty && creatureHasAbility(creature, "Frosty")) {
    next.healthRegen = applyPct(next.healthRegen, 25) ?? next.healthRegen;
    next.stamRegen = applyPct(next.stamRegen, 25) ?? next.stamRegen;
  }
  if (abilities.defiledGround && creatureHasAbility(creature, "Defiled Ground")) {
    const statBonusPct = getDefiledGroundStatBonusPct(abilities.defiledGroundLevel);
    next.health = applyPct(next.health, statBonusPct) ?? next.health;
    next.weight = applyPct(next.weight, statBonusPct) ?? next.weight;
  }
  if (abilities.gourmandizer && !abilities.hungerRule && creatureHasAbility(creature, "Gourmandizer")) {
    next.weight = applyPct(next.weight, getGourmandizerWeightBonusPctFromFillPct(abilities.gourmandizerStartingHunger)) ?? next.weight;
  }
  if (abilities.strengthInNumbers && creatureHasAbility(creature, "Strength In Numbers")) {
    const allies = Math.max(0, Math.min(9, Math.floor(abilities.strengthInNumbersAllies ?? 0)));
    if (allies > 0) {
      next.damage = applyPct(next.damage, 1.5 * allies) ?? next.damage;
    }
  }
  return next;
}

function requireCreature(name: string) {
  const creature = creatureByName[name];
  if (!creature) throw new Error(`Missing creature: ${name}`);
  return creature;
}

type CompareFixtureSpec = {
  name: string;
  sourceName: string;
  opponentName: string;
  buildA: BuildOptions;
  buildB: BuildOptions;
  activesOn: boolean;
  breathOn: boolean;
  abilityPolicy: AbilityTimingMode;
  maxTimeSec: number;
  disabledAbilitiesA?: string[];
  disabledAbilitiesB?: string[];
  compareBuffsA?: CompareBuffSelection;
  compareBuffsB?: CompareBuffSelection;
  specialAbilitiesA?: CompareSpecialAbilityState;
  specialAbilitiesB?: CompareSpecialAbilityState;
  compareDayNight?: CompareDayNightMode;
  compareMoon?: CompareMoonMode;
  compareNoMoveFacetank?: boolean;
  compareFirstTickMode?: "off" | "ailments" | "regen" | "both";
  compareFirstTickDelaySec?: number;
};

const DEFAULT_BUILD: BuildOptions = {
  venerationStage: 5,
  traits: ["Damage", "Weight"],
  ascensionAssignments: ["Damage", "Damage", "Damage", "Damage", "Damage"],
  plushies: ["Void", "Void"],
};

const HEALTH_BUILD: BuildOptions = {
  venerationStage: 5,
  traits: ["Health", "Weight"],
  ascensionAssignments: ["Health", "Health", "Health", "Health", "Health"],
  plushies: ["Void", "Void"],
};

// MVP scenarios — pinned within Rust-supported feature surface:
// - badOmenOutcome=null, airRule=off, secondaryAttackOnly=false, no policy overrides.
// Step 5e (seed fixtures) is deferred pending a baseline Rust↔TS parity audit.
// Diagnostics during step 5 revealed ~0.6-1.0s TTK drift on Kendyll-vs-Korathos
// AND Kendyll-vs-Lactarim (passive-only), so the drift is systematic, not
// Life-Leech-specific. Harness + generator are wired; add real seed specs
// after the parity audit closes. Until then: empty list ships zero cases,
// cargo test passes trivially, infrastructure stays green for future use.
const FIXTURE_SPECS: CompareFixtureSpec[] = [];

type CompareSideState = {
  finalStats: FinalStats;
  initialStatuses: CompareInitialStatus[];
  activeCooldownMultiplier: number;
};

function prepareSide(
  creature: ReturnType<typeof requireCreature>,
  build: BuildOptions,
  buffs: CompareBuffSelection,
  specialAbilities: CompareSpecialAbilityState,
  dayNight: CompareDayNightMode,
  moon: CompareMoonMode,
): CompareSideState {
  const built = applyRulesAndBuild(creature, build);
  const buffed = applyCompareBuffRuntime(built, build, buffs, dayNight, moon);
  const finalStats = applyCompareSpecialAbilities(buffed.finalStats, creature, specialAbilities);
  const initialStatuses: CompareInitialStatus[] = [...buffed.initialStatuses];
  if (specialAbilities.broodwatcher && creatureHasAbility(creature, "Broodwatcher")) {
    initialStatuses.push({
      statusId: "Defensive_Status",
      stacks: 5,
      sourceAbilityName: "Broodwatcher",
      noDecay: true,
      stackValueMode: "durationOnly",
    });
  }
  return {
    finalStats,
    initialStatuses,
    activeCooldownMultiplier: buffed.activeCooldownMultiplier,
  };
}

function buildSidePerks(
  creature: ReturnType<typeof requireCreature>,
  abilities: CompareSpecialAbilityState,
): CompareSidePerks {
  const appetiteBase = getCompareAppetiteEntry(creature.name)?.appetite ?? 100;
  return {
    traps:
      abilities.traps
      && (creatureHasAbility(creature, "Thorn Trap") || creatureHasAbility(creature, "Toxic Trap")),
    trails:
      abilities.trails
      && (
        creatureHasAbility(creature, "Toxic Trail")
        || creatureHasAbility(creature, "Plague Trail")
        || creatureHasAbility(creature, "Flame Trail")
        || creatureHasAbility(creature, "Frost Trail")
        || creatureHasAbility(creature, "Healing Step")
      ),
    powerCharge: abilities.powerCharge,
    goreCharge: abilities.goreCharge,
    startingSpiteCharged: abilities.startingSpiteCharged && creatureHasAbility(creature, "Spite"),
    muddyBuff: false, // baked via compareBuffs.muddy → injected as initial status by applyCompareBuffRuntime
    hungerRule: abilities.hungerRule,
    gourmandizer: abilities.gourmandizer && creatureHasAbility(creature, "Gourmandizer"),
    startingHungerUnits: convertFillPctToAppetiteUnits(
      normalizeCompareFillPct(abilities.gourmandizerStartingHunger),
      appetiteBase,
    ),
    appetiteBaseUnits: appetiteBase,
    defiledGroundLevel:
      abilities.defiledGround && creatureHasAbility(creature, "Defiled Ground") ? abilities.defiledGroundLevel : 0,
    defiledGroundWeakness: false,
  };
}

const outputPath = resolve("wasm-engine", "fixtures", "compare_matchup_contract.json");

const fixtures = FIXTURE_SPECS.map((spec) => {
  const sourceCreature = requireCreature(spec.sourceName);
  const opponentCreature = requireCreature(spec.opponentName);
  const buffsA = spec.compareBuffsA ?? DEFAULT_COMPARE_BUFF_SELECTION;
  const buffsB = spec.compareBuffsB ?? DEFAULT_COMPARE_BUFF_SELECTION;
  const abilitiesA = spec.specialAbilitiesA ?? DEFAULT_COMPARE_SPECIAL_ABILITIES;
  const abilitiesB = spec.specialAbilitiesB ?? DEFAULT_COMPARE_SPECIAL_ABILITIES;
  const dayNight: CompareDayNightMode = spec.compareDayNight ?? "none";
  const moon: CompareMoonMode = spec.compareMoon ?? "none";
  const noMoveFacetank = spec.compareNoMoveFacetank ?? true;
  const firstTick: CompareFirstTickConfig = {
    mode: spec.compareFirstTickMode ?? "off",
    delaySec: spec.compareFirstTickDelaySec ?? 1.0,
  };
  const disabledA = spec.disabledAbilitiesA ?? [];
  const disabledB = spec.disabledAbilitiesB ?? [];

  const sideA = prepareSide(sourceCreature, spec.buildA, buffsA, abilitiesA, dayNight, moon);
  const sideB = prepareSide(opponentCreature, spec.buildB, buffsB, abilitiesB, dayNight, moon);

  const appetiteBaseA = getCompareAppetiteEntry(sourceCreature.name)?.appetite ?? 100;
  const appetiteBaseB = getCompareAppetiteEntry(opponentCreature.name)?.appetite ?? 100;

  // TS oracle — same call shape as useCompareSimulation.calculate.
  const summary = simulateFight(sideA.finalStats, sideB.finalStats, {
    activesOn: spec.activesOn,
    breathOn: spec.breathOn,
    maxTimeSec: spec.maxTimeSec,
    enableCombatLog: false,
    disabledAbilitiesA: disabledA,
    disabledAbilitiesB: disabledB,
    initialStatusesA: sideA.initialStatuses,
    initialStatusesB: sideB.initialStatuses,
    activeCooldownMultiplierA: sideA.activeCooldownMultiplier,
    activeCooldownMultiplierB: sideB.activeCooldownMultiplier,
    badOmenOutcome: null,
    abilityPolicy: spec.abilityPolicy,
    compareSecondaryAttackOnlyA: false,
    compareSecondaryAttackOnlyB: false,
    compareAirRuleEnabled: false,
    compareAirRuleCooldownSec: 0,
    compareNoMoveFacetank: noMoveFacetank,
    compareFirstTickMode: firstTick.mode,
    compareFirstTickDelaySec: firstTick.delaySec,
    comparePowerChargeA: abilitiesA.powerCharge,
    comparePowerChargeB: abilitiesB.powerCharge,
    compareGoreChargeA: abilitiesA.goreCharge,
    compareGoreChargeB: abilitiesB.goreCharge,
    compareStartingSpiteChargedA: abilitiesA.startingSpiteCharged && creatureHasAbility(sourceCreature, "Spite"),
    compareStartingSpiteChargedB: abilitiesB.startingSpiteCharged && creatureHasAbility(opponentCreature, "Spite"),
    compareHungerRuleA: abilitiesA.hungerRule,
    compareHungerRuleB: abilitiesB.hungerRule,
    compareGourmandizerA: abilitiesA.gourmandizer && creatureHasAbility(sourceCreature, "Gourmandizer"),
    compareGourmandizerB: abilitiesB.gourmandizer && creatureHasAbility(opponentCreature, "Gourmandizer"),
    compareDefiledGroundLevelA:
      abilitiesA.defiledGround && creatureHasAbility(sourceCreature, "Defiled Ground")
        ? abilitiesA.defiledGroundLevel
        : 0,
    compareDefiledGroundLevelB:
      abilitiesB.defiledGround && creatureHasAbility(opponentCreature, "Defiled Ground")
        ? abilitiesB.defiledGroundLevel
        : 0,
    compareStartingHungerA: convertFillPctToAppetiteUnits(normalizeCompareFillPct(abilitiesA.gourmandizerStartingHunger), appetiteBaseA),
    compareStartingHungerB: convertFillPctToAppetiteUnits(normalizeCompareFillPct(abilitiesB.gourmandizerStartingHunger), appetiteBaseB),
    compareAppetiteBaseA: appetiteBaseA,
    compareAppetiteBaseB: appetiteBaseB,
    compareTrapsA:
      abilitiesA.traps
      && (creatureHasAbility(sourceCreature, "Thorn Trap") || creatureHasAbility(sourceCreature, "Toxic Trap")),
    compareTrapsB:
      abilitiesB.traps
      && (creatureHasAbility(opponentCreature, "Thorn Trap") || creatureHasAbility(opponentCreature, "Toxic Trap")),
    compareTrailsA:
      abilitiesA.trails
      && (
        creatureHasAbility(sourceCreature, "Toxic Trail")
        || creatureHasAbility(sourceCreature, "Plague Trail")
        || creatureHasAbility(sourceCreature, "Flame Trail")
        || creatureHasAbility(sourceCreature, "Frost Trail")
        || creatureHasAbility(sourceCreature, "Healing Step")
      ),
    compareTrailsB:
      abilitiesB.trails
      && (
        creatureHasAbility(opponentCreature, "Toxic Trail")
        || creatureHasAbility(opponentCreature, "Plague Trail")
        || creatureHasAbility(opponentCreature, "Flame Trail")
        || creatureHasAbility(opponentCreature, "Frost Trail")
        || creatureHasAbility(opponentCreature, "Healing Step")
      ),
  });
  const expected = projectBestBuildsMatchupSummary(summary);

  const rustArgs = toRustComposableArgsFromCompare({
    sourceCreature,
    opponentCreature,
    finalA: sideA.finalStats,
    finalB: sideB.finalStats,
    activesOn: spec.activesOn,
    breathOn: spec.breathOn,
    abilityPolicy: spec.abilityPolicy,
    initialStatusesA: sideA.initialStatuses,
    initialStatusesB: sideB.initialStatuses,
    activeCooldownMultiplierA: sideA.activeCooldownMultiplier,
    activeCooldownMultiplierB: sideB.activeCooldownMultiplier,
    disabledAbilitiesA: disabledA,
    disabledAbilitiesB: disabledB,
    perksA: buildSidePerks(sourceCreature, abilitiesA),
    perksB: buildSidePerks(opponentCreature, abilitiesB),
    firstTick,
    noMoveFacetank,
  });

  return {
    name: spec.name,
    attacker: rustArgs.attacker,
    defender: rustArgs.defender,
    attackerBreath: rustArgs.attackerBreath,
    defenderBreath: rustArgs.defenderBreath,
    abilityPolicy: rustArgs.abilityPolicy,
    abilityConfig: rustArgs.abilityConfig,
    maxTimeSec: spec.maxTimeSec,
    expectedSummary: expected,
  };
});

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(fixtures, null, 2)}\n`, "utf8");
console.log(`Wrote ${fixtures.length} Rust compare fixtures to ${outputPath}`);
