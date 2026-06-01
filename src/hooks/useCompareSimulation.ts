import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  AbilityTimingMode,
  AbilityTimingOverrides,
  BadOmenOutcome,
  BuildOptions,
  CompareBiteVariantMode,
  CreatureRuntime,
  FinalStats,
  SimulationOptions,
  SimulationSummary,
  TwoFacedMode,
  UserAbilityLevelOverrides,
  UserAbilityTimingOverrides,
} from "../engine";
import { getDefiledGroundStatBonusPct } from "../engine/compareDefiledGroundData";
import { applyTrueRoundingMode } from "../engine/finalStatsRounding";
import { applyCompareBuffRuntime, type CompareBuffSelection, type CompareDayNightMode, type CompareMoonMode } from "../engine/compareBuffRuntime";
import { isAquaticType, isTerrestrialType, isWeatherImmune, type WeatherCondition } from "../engine/weather";
import { creatureHasAbility, type CompareSpecialAbilityState } from "../components/compare/compareSpecialAbilities";
import {
  convertFillPctToAppetiteUnits,
  getGourmandizerWeightBonusPctFromFillPct,
  normalizeCompareFillPct,
} from "../engine/compareHungerMath";
import { getCompareAppetiteEntry } from "../engine/compareAppetiteData";
import { normalizeCompareDisabledAbilities } from "../engine/compareCombatToggleOptions";
import type { CombatEventPhase } from "../engine/eventOrdering";
import { trySimulateRustCompareMatchup } from "../optimizer/rustCompareDispatch";
import type { CompareSidePerks, PosturePolicyMode } from "../optimizer/rustCompareMatchupRuntime";
const COMPARE_MAX_TIME_SEC = 900;
const COMPARE_WARDEN_RAGE_START_HP_MIN_PCT = 1;
const COMPARE_WARDEN_RAGE_START_HP_MAX_PCT = 100;

type EngineRuntime = {
  applyRulesAndBuild: (creature: CreatureRuntime, build: BuildOptions, twoFacedMode?: TwoFacedMode) => FinalStats;
};

function cloneFinalStats(finalStats: FinalStats): FinalStats {
  return {
    ...finalStats,
    approxNotes: [...finalStats.approxNotes],
    appliedTraits: [...finalStats.appliedTraits],
    plushieStatusOnHit: finalStats.plushieStatusOnHit ? { ...finalStats.plushieStatusOnHit } : undefined,
    plushieStatusOnHitTaken: finalStats.plushieStatusOnHitTaken ? { ...finalStats.plushieStatusOnHitTaken } : undefined,
    plushieStatusBlockPct: finalStats.plushieStatusBlockPct ? { ...finalStats.plushieStatusBlockPct } : undefined,
  };
}

function applyPct(value: number | undefined, pct: number): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return value;
  return value * (1 + pct / 100);
}

function applyCompareSpecialAbilities(
  finalStats: FinalStats,
  creature: CreatureRuntime | undefined,
  abilities: CompareSpecialAbilityState,
): FinalStats {
  const next = cloneFinalStats(finalStats);
  if (abilities.volcanic && creatureHasAbility(creature, "Volcanic")) {
    next.healthRegen = applyPct(next.healthRegen, 50);
  }
  const hasFrosty = creatureHasAbility(creature, "Frosty") || !!finalStats.plushieGrantedOtherAbilities?.some((a) => a.name === "Frosty");
  if (abilities.frosty && hasFrosty) {
    next.healthRegen = applyPct(next.healthRegen, 25);
    next.stamRegen = applyPct(next.stamRegen, 25);
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

function buildCompareInitialStatuses(
  initialStatuses: SimulationOptions["initialStatusesA"],
  creature: CreatureRuntime | undefined,
  abilities: CompareSpecialAbilityState,
): SimulationOptions["initialStatusesA"] {
  const next = [...(initialStatuses ?? [])];
  if (abilities.broodwatcher && creatureHasAbility(creature, "Broodwatcher")) {
    next.push({
      statusId: "Defensive_Status",
      stacks: 5,
      sourceAbilityName: "Broodwatcher",
      noDecay: true,
      stackValueMode: "durationOnly",
    });
  }
  return next;
}

function resolveCompareWardenRageStartHpPct(
  creature: CreatureRuntime | undefined,
  abilities: CompareSpecialAbilityState,
): number {
  if (!abilities.wardenRageStartHp || !creatureHasAbility(creature, "Warden's Rage")) return 0;
  const pct = Math.floor(abilities.wardenRageStartHpPct);
  if (!Number.isFinite(pct) || pct <= 0) return 0;
  return Math.max(
    COMPARE_WARDEN_RAGE_START_HP_MIN_PCT,
    Math.min(COMPARE_WARDEN_RAGE_START_HP_MAX_PCT, pct),
  );
}

let engineRuntimePromise: Promise<EngineRuntime> | null = null;
function loadEngineRuntime(): Promise<EngineRuntime> {
  if (!engineRuntimePromise) {
    engineRuntimePromise = import("../engine").then((module) => ({
      applyRulesAndBuild: module.applyRulesAndBuild,
    }));
  }
  return engineRuntimePromise;
}

export function useCompareSimulation({
  creatureA,
  creatureB,
  buildA,
  buildB,
  activesOn,
  breathOn,
  compareAbilityPolicy,
  compareAbilityPolicyOverridesA,
  compareAbilityPolicyOverridesB,
  compareUserAbilityOverridesA,
  compareUserAbilityOverridesB,
  compareUserAbilityLevelsA,
  compareUserAbilityLevelsB,
  disabledAbilitiesA,
  disabledAbilitiesB,
  badOmenOutcome,
  trueRoundingMode,
  compareBuffsA,
  compareBuffsB,
  specialAbilitiesA,
  specialAbilitiesB,
  compareDayNight,
  compareMoon,
  compareWeather,
  compareBiteVariantModeA,
  compareBiteVariantModeB,
  compareAirRuleEnabled,
  compareAirRuleCooldownSec,
  compareNoMoveFacetank,
  compareFirstTickMode,
  compareFirstTickDelaySec,
  comparePosturePolicyA,
  comparePosturePolicyB,
  combatEventOrder,
}: {
  creatureA?: CreatureRuntime;
  creatureB?: CreatureRuntime;
  buildA: BuildOptions;
  buildB: BuildOptions;
  activesOn: boolean;
  breathOn: boolean;
  compareAbilityPolicy: AbilityTimingMode;
  compareAbilityPolicyOverridesA: AbilityTimingOverrides;
  compareAbilityPolicyOverridesB: AbilityTimingOverrides;
  /** Per-user-ability runtime overrides for side A. Keyed by
   * user.<id>; values pin per-fight timing. */
  compareUserAbilityOverridesA?: UserAbilityTimingOverrides;
  compareUserAbilityOverridesB?: UserAbilityTimingOverrides;
  /** Round 42 / A11: per-fight active-level overrides for user
   * abilities with `levels > 1`. Keyed by user.<id>; 1-indexed. */
  compareUserAbilityLevelsA?: UserAbilityLevelOverrides;
  compareUserAbilityLevelsB?: UserAbilityLevelOverrides;
  disabledAbilitiesA: string[];
  disabledAbilitiesB: string[];
  badOmenOutcome: BadOmenOutcome | null;
  trueRoundingMode: boolean;
  compareBuffsA: CompareBuffSelection;
  compareBuffsB: CompareBuffSelection;
  specialAbilitiesA: CompareSpecialAbilityState;
  specialAbilitiesB: CompareSpecialAbilityState;
  compareDayNight: CompareDayNightMode;
  compareMoon: CompareMoonMode;
  compareWeather: WeatherCondition;
  compareBiteVariantModeA: CompareBiteVariantMode;
  compareBiteVariantModeB: CompareBiteVariantMode;
  compareAirRuleEnabled: boolean;
  compareAirRuleCooldownSec: number;
  compareNoMoveFacetank: boolean;
  compareFirstTickMode: "off" | "ailments" | "regen" | "both";
  compareFirstTickDelaySec: number;
  comparePosturePolicyA: PosturePolicyMode;
  comparePosturePolicyB: PosturePolicyMode;
  combatEventOrder: CombatEventPhase[];
}) {
  const [summary, setSummary] = useState<SimulationSummary | null>(null);
  const [needsCalc, setNeedsCalc] = useState(true);
  const [finalA, setFinalA] = useState<FinalStats | null>(null);
  const [finalB, setFinalB] = useState<FinalStats | null>(null);
  const [initialStatusesA, setInitialStatusesA] = useState<SimulationOptions["initialStatusesA"]>([]);
  const [initialStatusesB, setInitialStatusesB] = useState<SimulationOptions["initialStatusesB"]>([]);
  const [activeCooldownMultiplierA, setActiveCooldownMultiplierA] = useState(1);
  const [activeCooldownMultiplierB, setActiveCooldownMultiplierB] = useState(1);
  const sharedPackHealerNearby = compareBuffsA.packHealerNearby || compareBuffsB.packHealerNearby;
  const effectiveCompareBuffsA = useMemo<CompareBuffSelection>(
    () => ({ ...compareBuffsA, packHealerNearby: sharedPackHealerNearby }),
    [compareBuffsA, sharedPackHealerNearby],
  );
  const effectiveCompareBuffsB = useMemo<CompareBuffSelection>(
    () => ({ ...compareBuffsB, packHealerNearby: sharedPackHealerNearby }),
    [compareBuffsB, sharedPackHealerNearby],
  );

  useEffect(() => {
    let cancelled = false;
    if (!creatureA) {
      setFinalA(null);
      return;
    }
    void loadEngineRuntime()
      .then((runtime) => {
        if (cancelled) return;
        const built = runtime.applyRulesAndBuild(creatureA, buildA, specialAbilitiesA.twoFacedMode);
        const buffed = applyCompareBuffRuntime(trueRoundingMode ? applyTrueRoundingMode(built) : built, buildA, effectiveCompareBuffsA, compareDayNight, compareMoon);
        setFinalA(applyCompareSpecialAbilities(buffed.finalStats, creatureA, specialAbilitiesA));
        setInitialStatusesA(buildCompareInitialStatuses(buffed.initialStatuses, creatureA, specialAbilitiesA));
        setActiveCooldownMultiplierA(buffed.activeCooldownMultiplier);
      })
      .catch(() => {
        if (cancelled) return;
        setFinalA(null);
        setInitialStatusesA([]);
        setActiveCooldownMultiplierA(1);
      });
    return () => {
      cancelled = true;
    };
  }, [creatureA, buildA, trueRoundingMode, effectiveCompareBuffsA, compareDayNight, compareMoon, specialAbilitiesA]);

  useEffect(() => {
    let cancelled = false;
    if (!creatureB) {
      setFinalB(null);
      return;
    }
    void loadEngineRuntime()
      .then((runtime) => {
        if (cancelled) return;
        const built = runtime.applyRulesAndBuild(creatureB, buildB, specialAbilitiesB.twoFacedMode);
        const buffed = applyCompareBuffRuntime(trueRoundingMode ? applyTrueRoundingMode(built) : built, buildB, effectiveCompareBuffsB, compareDayNight, compareMoon);
        setFinalB(applyCompareSpecialAbilities(buffed.finalStats, creatureB, specialAbilitiesB));
        setInitialStatusesB(buildCompareInitialStatuses(buffed.initialStatuses, creatureB, specialAbilitiesB));
        setActiveCooldownMultiplierB(buffed.activeCooldownMultiplier);
      })
      .catch(() => {
        if (cancelled) return;
        setFinalB(null);
        setInitialStatusesB([]);
        setActiveCooldownMultiplierB(1);
      });
    return () => {
      cancelled = true;
    };
  }, [creatureB, buildB, trueRoundingMode, effectiveCompareBuffsB, compareDayNight, compareMoon, specialAbilitiesB]);

  useEffect(() => {
    setNeedsCalc(true);
    setSummary(null);
  }, [
    finalA,
    finalB,
    activesOn,
    breathOn,
    compareAbilityPolicy,
    compareAbilityPolicyOverridesA,
    compareAbilityPolicyOverridesB,
    disabledAbilitiesA,
    disabledAbilitiesB,
    badOmenOutcome,
    compareBiteVariantModeA,
    compareBiteVariantModeB,
    compareAirRuleEnabled,
    compareAirRuleCooldownSec,
    compareNoMoveFacetank,
    compareFirstTickMode,
    compareFirstTickDelaySec,
    comparePosturePolicyA,
    comparePosturePolicyB,
    combatEventOrder,
    specialAbilitiesA,
    specialAbilitiesB,
  ]);

  const calculate = useCallback(async () => {
    if (!finalA || !finalB) return;
    const appetiteBaseA = (getCompareAppetiteEntry(creatureA?.name)?.appetite ?? finalA.appetite ?? 100) * (1 + (finalA.appetiteCapacityPct ?? 0) / 100);
    const appetiteBaseB = (getCompareAppetiteEntry(creatureB?.name)?.appetite ?? finalB.appetite ?? 100) * (1 + (finalB.appetiteCapacityPct ?? 0) / 100);
    const normalizedDisabledAbilitiesA = normalizeCompareDisabledAbilities(disabledAbilitiesA, finalA);
    const normalizedDisabledAbilitiesB = normalizeCompareDisabledAbilities(disabledAbilitiesB, finalB);
    const wardenRageStartHpPctA = resolveCompareWardenRageStartHpPct(creatureA, specialAbilitiesA);
    const wardenRageStartHpPctB = resolveCompareWardenRageStartHpPct(creatureB, specialAbilitiesB);

    const perksA: CompareSidePerks = {
      traps: specialAbilitiesA.traps && (creatureHasAbility(creatureA, "Thorn Trap") || creatureHasAbility(creatureA, "Toxic Trap")),
      trails: specialAbilitiesA.trails && (
        creatureHasAbility(creatureA, "Toxic Trail")
        || creatureHasAbility(creatureA, "Plague Trail")
        || creatureHasAbility(creatureA, "Flame Trail")
        || creatureHasAbility(creatureA, "Frost Trail")
        || creatureHasAbility(creatureA, "Healing Step")
      ),
      powerCharge: specialAbilitiesA.powerCharge,
      goreCharge: specialAbilitiesA.goreCharge,
      startingSpiteCharged: specialAbilitiesA.startingSpiteCharged && creatureHasAbility(creatureA, "Spite"),
      muddyBuff: false,
      hungerRule: specialAbilitiesA.hungerRule,
      gourmandizer: specialAbilitiesA.gourmandizer && creatureHasAbility(creatureA, "Gourmandizer"),
      startingHungerUnits: convertFillPctToAppetiteUnits(normalizeCompareFillPct(specialAbilitiesA.gourmandizerStartingHunger), appetiteBaseA),
      appetiteBaseUnits: appetiteBaseA,
      defiledGroundLevel:
        specialAbilitiesA.defiledGround && creatureHasAbility(creatureA, "Defiled Ground") ? specialAbilitiesA.defiledGroundLevel : 0,
      defiledGroundWeakness: false,
      appetiteDrainMultiplier: 1 + (finalA.appetiteDrainPct ?? 0) / 100,
      healingPulseEnabled:
        specialAbilitiesA.healingPulseEnabled && creatureHasAbility(creatureA, "Healing Pulse"),
      healingPulseOnce: specialAbilitiesA.healingPulseMode === "onceAtStart",
      expungeEnabled: creatureHasAbility(creatureA, "Expunge"),
      wardenRageStartHpPct: wardenRageStartHpPctA,
    };
    const perksB: CompareSidePerks = {
      traps: specialAbilitiesB.traps && (creatureHasAbility(creatureB, "Thorn Trap") || creatureHasAbility(creatureB, "Toxic Trap")),
      trails: specialAbilitiesB.trails && (
        creatureHasAbility(creatureB, "Toxic Trail")
        || creatureHasAbility(creatureB, "Plague Trail")
        || creatureHasAbility(creatureB, "Flame Trail")
        || creatureHasAbility(creatureB, "Frost Trail")
        || creatureHasAbility(creatureB, "Healing Step")
      ),
      powerCharge: specialAbilitiesB.powerCharge,
      goreCharge: specialAbilitiesB.goreCharge,
      startingSpiteCharged: specialAbilitiesB.startingSpiteCharged && creatureHasAbility(creatureB, "Spite"),
      muddyBuff: false,
      hungerRule: specialAbilitiesB.hungerRule,
      gourmandizer: specialAbilitiesB.gourmandizer && creatureHasAbility(creatureB, "Gourmandizer"),
      startingHungerUnits: convertFillPctToAppetiteUnits(normalizeCompareFillPct(specialAbilitiesB.gourmandizerStartingHunger), appetiteBaseB),
      appetiteBaseUnits: appetiteBaseB,
      defiledGroundLevel:
        specialAbilitiesB.defiledGround && creatureHasAbility(creatureB, "Defiled Ground") ? specialAbilitiesB.defiledGroundLevel : 0,
      defiledGroundWeakness: false,
      appetiteDrainMultiplier: 1 + (finalB.appetiteDrainPct ?? 0) / 100,
      healingPulseEnabled:
        specialAbilitiesB.healingPulseEnabled && creatureHasAbility(creatureB, "Healing Pulse"),
      healingPulseOnce: specialAbilitiesB.healingPulseMode === "onceAtStart",
      expungeEnabled: creatureHasAbility(creatureB, "Expunge"),
      wardenRageStartHpPct: wardenRageStartHpPctB,
    };

    if (creatureA && creatureB) {
      // Weather immunity is resolved on the TS side (the Rust engine has
      // no Volcanic/Frosty-by-name path): Volcanic ignores Heat Wave,
      // Frosty ignores Blizzard, Acid Rain has none. Immunity is intrinsic
      // to having the ability (matches the Reference: "creatures with the
      // Volcanic/Frosty ability are immune"), independent of the compare
      // regen toggle.
      const aHasFrosty =
        creatureHasAbility(creatureA, "Frosty")
        || !!finalA.plushieGrantedOtherAbilities?.some((x) => x.name === "Frosty");
      const bHasFrosty =
        creatureHasAbility(creatureB, "Frosty")
        || !!finalB.plushieGrantedOtherAbilities?.some((x) => x.name === "Frosty");
      const attackerWeatherImmune = isWeatherImmune(
        compareWeather,
        creatureHasAbility(creatureA, "Volcanic"),
        aHasFrosty,
      );
      const defenderWeatherImmune = isWeatherImmune(
        compareWeather,
        creatureHasAbility(creatureB, "Volcanic"),
        bHasFrosty,
      );
      // Storming buff: only applies when the afflicted side is Terrestrial
      // and its opponent is Aquatic. Resolved here where both creatures and
      // the toggle are known; the engine just seeds the marker.
      const attackerStorming =
        !!compareBuffsA.storming
        && isTerrestrialType(creatureA.stats.type)
        && isAquaticType(creatureB.stats.type);
      const defenderStorming =
        !!compareBuffsB.storming
        && isTerrestrialType(creatureB.stats.type)
        && isAquaticType(creatureA.stats.type);
      const rustSummary = await trySimulateRustCompareMatchup({
        sourceCreature: creatureA,
        opponentCreature: creatureB,
        finalA,
        finalB,
        activesOn,
        breathOn,
        abilityPolicy: compareAbilityPolicy,
        abilityPolicyOverridesA: compareAbilityPolicyOverridesA,
        abilityPolicyOverridesB: compareAbilityPolicyOverridesB,
        userAbilityOverridesA: compareUserAbilityOverridesA,
        userAbilityOverridesB: compareUserAbilityOverridesB,
        userAbilityLevelsA: compareUserAbilityLevelsA,
        userAbilityLevelsB: compareUserAbilityLevelsB,
        initialStatusesA: initialStatusesA ?? [],
        initialStatusesB: initialStatusesB ?? [],
        activeCooldownMultiplierA,
        activeCooldownMultiplierB,
        disabledAbilitiesA: normalizedDisabledAbilitiesA,
        disabledAbilitiesB: normalizedDisabledAbilitiesB,
        perksA,
        perksB,
        firstTick: { mode: compareFirstTickMode, delaySec: compareFirstTickDelaySec },
        noMoveFacetank: compareNoMoveFacetank,
        posturePolicyA: comparePosturePolicyA,
        posturePolicyB: comparePosturePolicyB,
        compareAirRuleEnabled,
        compareAirRuleCooldownSec,
        compareBiteVariantModeA,
        compareBiteVariantModeB,
        combatEventOrder,
        badOmenOutcome,
        // Round 32 / A5: forward day/night + moon enum to the Rust path
        // so user abilities can read them via `env.is_day` / `env.is_night`
        // / `env.is_blue_moon` / `env.is_blood_moon`. Stat buffs from these
        // were already applied at `applyCompareBuffRuntime` earlier in
        // this hook; the engine sees post-buff stats but also the raw
        // enum strings for ability gating.
        compareDayNight,
        compareMoon,
        weather: compareWeather,
        attackerWeatherImmune,
        defenderWeatherImmune,
        attackerStorming,
        defenderStorming,
        maxTimeSec: COMPARE_MAX_TIME_SEC,
      });
      if (rustSummary) {
        setSummary(rustSummary);
        setNeedsCalc(false);
        return;
      }
    }

    // Rust path failed (WASM bundle missing or threw). The bridge-
    // status banner in App.tsx already shows the user a "WASM
    // unavailable" notice; we no longer fall back to a TS engine
    // (deleted as part of the open-source migration).
    setSummary(null);
    setNeedsCalc(true);
  }, [
    finalA,
    finalB,
    activesOn,
    breathOn,
    disabledAbilitiesA,
    disabledAbilitiesB,
    initialStatusesA,
    initialStatusesB,
    activeCooldownMultiplierA,
    activeCooldownMultiplierB,
    badOmenOutcome,
    compareAbilityPolicy,
    compareAbilityPolicyOverridesA,
    compareAbilityPolicyOverridesB,
    compareUserAbilityOverridesA,
    compareUserAbilityOverridesB,
    compareUserAbilityLevelsA,
    compareUserAbilityLevelsB,
    compareBiteVariantModeA,
    compareBiteVariantModeB,
    compareAirRuleEnabled,
    compareAirRuleCooldownSec,
    compareNoMoveFacetank,
    compareFirstTickMode,
    compareFirstTickDelaySec,
    comparePosturePolicyA,
    comparePosturePolicyB,
    creatureA,
    creatureB,
    specialAbilitiesA,
    specialAbilitiesB,
    compareWeather,
    compareDayNight,
    compareMoon,
    compareBuffsA,
    compareBuffsB,
    combatEventOrder,
  ]);

  return {
    finalA,
    finalB,
    summary,
    needsCalc,
    calculate,
  };
}
