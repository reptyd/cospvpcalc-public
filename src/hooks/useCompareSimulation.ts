import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  AbilityTimingMode,
  AbilityTimingOverrides,
  BadOmenOutcome,
  BreathPolicySetting,
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
import { getBreathPolicyKind, resolveBreathPolicy } from "../engine/breathPolicy";
import { hasCompareGoreCharge, hasComparePowerCharge } from "../engine/compareChargeData";
import { applyTrueRoundingMode } from "../engine/finalStatsRounding";
import { applyCompareBuffRuntime, shareCompareAuraBuffs, type CompareBuffSelection, type CompareDayNightMode, type CompareMoonMode } from "../engine/compareBuffRuntime";
import { applyCompareSpecialAbilities } from "../engine/compareSpecialAbilityRuntime";
import { isAquaticType, isTerrestrialType, isWeatherImmune, type WeatherCondition } from "../engine/weather";
import type { OxygenMoistureMode } from "../engine/oxygenMoistureMode";
import { creatureHasAbility, defiledGroundActive, type CompareSpecialAbilityState } from "../components/compare/compareSpecialAbilities";
import { convertFillPctToAppetiteUnits, normalizeCompareFillPct } from "../engine/compareHungerMath";
import { getCompareAppetiteEntry } from "../engine/compareAppetiteData";
import { getCreatureMeters } from "../engine/compareMeters";
import type { CompareSeason } from "../engine/compareSeason";
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

function hasDarkstarPlushie(build: BuildOptions): boolean {
  return build.plushies.some((name) => name.trim().toLowerCase() === "darkstar");
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

// Head Start is available to every creature, so there is no
// creatureHasAbility gate here - just "enabled ? value : 0".
function resolveCompareHeadStartSec(abilities: CompareSpecialAbilityState): number {
  if (!abilities.headStart) return 0;
  const sec = abilities.headStartSec;
  if (!Number.isFinite(sec) || sec <= 0) return 0;
  return sec;
}

/** Test-only handles on the per-fight gates above. They decide whether a
 *  Compare toggle reaches the engine at all - the Broodwatcher seed, the
 *  Darkstar plushie match, and the two numeric knobs' clamps - and none of
 *  them was reachable from a test, which is how three commits moved real
 *  Compare numbers with none. */
export const __test_compareGates = {
  buildCompareInitialStatuses,
  hasDarkstarPlushie,
  resolveCompareWardenRageStartHpPct,
  resolveCompareHeadStartSec,
};

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
  compareSeason,
  compareWeather,
  compareOxygenMoistureMode,
  compareBiteVariantModeA,
  compareBiteVariantModeB,
  compareAirRuleEnabled,
  compareAirRuleCooldownSec,
  compareAirRuleCooldownSecB,
  compareAirRuleCooldownLinked,
  compareAerialDodgeEnabled,
  compareAerialDodgeHitChancePctA,
  compareAerialDodgeHitChancePctB,
  compareAerialDodgeRollStyle,
  compareNoMoveFacetank,
  compareFirstTickMode,
  compareFirstTickDelaySec,
  comparePosturePolicyA,
  comparePosturePolicyB,
  compareBreathPolicyA,
  compareBreathPolicyB,
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
  /** Per-fight active-level overrides for user
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
  compareSeason?: CompareSeason;
  compareWeather: WeatherCondition;
  compareOxygenMoistureMode: OxygenMoistureMode;
  compareBiteVariantModeA: CompareBiteVariantMode;
  compareBiteVariantModeB: CompareBiteVariantMode;
  compareAirRuleEnabled: boolean;
  compareAirRuleCooldownSec: number;
  compareAirRuleCooldownSecB: number;
  compareAirRuleCooldownLinked: boolean;
  compareAerialDodgeEnabled: boolean;
  compareAerialDodgeHitChancePctA: number;
  compareAerialDodgeHitChancePctB: number;
  compareAerialDodgeRollStyle: "even" | "random";
  compareNoMoveFacetank: boolean;
  compareFirstTickMode: "off" | "ailments" | "regen" | "both";
  compareFirstTickDelaySec: number;
  comparePosturePolicyA: PosturePolicyMode;
  comparePosturePolicyB: PosturePolicyMode;
  /** Per-side breath firing discipline. `"auto"` is resolved against the
   *  side's breath spec below, since the engine only honors an explicit mode. */
  compareBreathPolicyA: BreathPolicySetting;
  compareBreathPolicyB: BreathPolicySetting;
  combatEventOrder: CombatEventPhase[];
}) {
  const [summary, setSummary] = useState<SimulationSummary | null>(null);
  const [needsCalc, setNeedsCalc] = useState(true);
  const [isCalculating, setIsCalculating] = useState(false);
  const [calcElapsedMs, setCalcElapsedMs] = useState(0);
  const calcStartRef = useRef(0);
  const [finalA, setFinalA] = useState<FinalStats | null>(null);
  const [finalB, setFinalB] = useState<FinalStats | null>(null);
  const [initialStatusesA, setInitialStatusesA] = useState<SimulationOptions["initialStatusesA"]>([]);
  const [initialStatusesB, setInitialStatusesB] = useState<SimulationOptions["initialStatusesB"]>([]);
  const [activeCooldownMultiplierA, setActiveCooldownMultiplierA] = useState(1);
  const [activeCooldownMultiplierB, setActiveCooldownMultiplierB] = useState(1);
  const [effectiveCompareBuffsA, effectiveCompareBuffsB] = useMemo(
    () => shareCompareAuraBuffs(compareBuffsA, compareBuffsB),
    [compareBuffsA, compareBuffsB],
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
    compareAirRuleCooldownSecB,
    compareAirRuleCooldownLinked,
    compareAerialDodgeEnabled,
    compareAerialDodgeHitChancePctA,
    compareAerialDodgeHitChancePctB,
    compareAerialDodgeRollStyle,
    compareNoMoveFacetank,
    compareFirstTickMode,
    compareFirstTickDelaySec,
    comparePosturePolicyA,
    comparePosturePolicyB,
    compareBreathPolicyA,
    compareBreathPolicyB,
    combatEventOrder,
    specialAbilitiesA,
    specialAbilitiesB,
  ]);

  const calculate = useCallback(async () => {
    if (!finalA || !finalB) return;
    calcStartRef.current = performance.now();
    setCalcElapsedMs(0);
    setIsCalculating(true);
    try {
    const appetiteBaseA = (getCompareAppetiteEntry(creatureA?.name)?.appetite ?? finalA.appetite ?? 100) * (1 + (finalA.appetiteCapacityPct ?? 0) / 100);
    const appetiteBaseB = (getCompareAppetiteEntry(creatureB?.name)?.appetite ?? finalB.appetite ?? 100) * (1 + (finalB.appetiteCapacityPct ?? 0) / 100);
    const normalizedDisabledAbilitiesA = normalizeCompareDisabledAbilities(disabledAbilitiesA, finalA);
    const normalizedDisabledAbilitiesB = normalizeCompareDisabledAbilities(disabledAbilitiesB, finalB);
    const wardenRageStartHpPctA = resolveCompareWardenRageStartHpPct(creatureA, specialAbilitiesA);
    const wardenRageStartHpPctB = resolveCompareWardenRageStartHpPct(creatureB, specialAbilitiesB);
    const headStartSecA = resolveCompareHeadStartSec(specialAbilitiesA);
    const headStartSecB = resolveCompareHeadStartSec(specialAbilitiesB);
    const metersA = getCreatureMeters(creatureA);
    const metersB = getCreatureMeters(creatureB);
    const meterSlowA = weatherAbilityMeterDrainMultiplier(creatureA, finalA, specialAbilitiesA);
    const meterSlowB = weatherAbilityMeterDrainMultiplier(creatureB, finalB, specialAbilitiesB);

    const perksA: CompareSidePerks = {
      traps: specialAbilitiesA.traps && (creatureHasAbility(creatureA, "Thorn Trap") || creatureHasAbility(creatureA, "Toxic Trap")),
      trails: specialAbilitiesA.trails && (
        creatureHasAbility(creatureA, "Toxic Trail")
        || creatureHasAbility(creatureA, "Plague Trail")
        || creatureHasAbility(creatureA, "Flame Trail")
        || creatureHasAbility(creatureA, "Frost Trail")
        || creatureHasAbility(creatureA, "Healing Step")
      ),
      powerCharge: specialAbilitiesA.powerCharge && hasComparePowerCharge(creatureA),
      goreCharge: specialAbilitiesA.goreCharge && hasCompareGoreCharge(creatureA),
      startingSpiteCharged: specialAbilitiesA.startingSpiteCharged && creatureHasAbility(creatureA, "Spite"),
      muddyBuff: false,
      // Hunger and thirst always run, so the rule is not a toggle any more
      // and Gourmandizer works for whoever owns it. The one input left is
      // how full each bar starts.
      reflectResponseHold: specialAbilitiesA.reflectResponse === "hold",
      hungerRule: true,
      gourmandizer: creatureHasAbility(creatureA, "Gourmandizer"),
      startingHungerUnits: convertFillPctToAppetiteUnits(normalizeCompareFillPct(specialAbilitiesA.startingHungerPct), appetiteBaseA),
      startingThirstUnits: convertFillPctToAppetiteUnits(normalizeCompareFillPct(specialAbilitiesA.startingThirstPct), appetiteBaseA),
      hasHunger: metersA.hunger,
      hasThirst: metersA.thirst,
      appetiteBaseUnits: appetiteBaseA,
      defiledGroundLevel: defiledGroundActive(specialAbilitiesA, creatureA) ? specialAbilitiesA.defiledGroundLevel : 0,
      // The ground the opponent lays down afflicts whoever fights on it, so the
      // weakness is the other side's ability rather than a setting of its own.
      defiledGroundWeakness: defiledGroundActive(specialAbilitiesB, creatureB),
      hasDarkstar: hasDarkstarPlushie(buildA),
      appetiteDrainMultiplier: (1 + (finalA.hungerDrainPct ?? 0) / 100) * meterSlowA,
      thirstDrainMultiplier: (1 + (finalA.thirstDrainPct ?? 0) / 100) * meterSlowA,
      healingPulseEnabled:
        specialAbilitiesA.healingPulseEnabled && creatureHasAbility(creatureA, "Healing Pulse"),
      healingPulseOnce: specialAbilitiesA.healingPulseMode === "onceAtStart",
      expungeEnabled: creatureHasAbility(creatureA, "Expunge"),
      wardenRageStartHpPct: wardenRageStartHpPctA,
      headStartSec: headStartSecA,
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
      powerCharge: specialAbilitiesB.powerCharge && hasComparePowerCharge(creatureB),
      goreCharge: specialAbilitiesB.goreCharge && hasCompareGoreCharge(creatureB),
      startingSpiteCharged: specialAbilitiesB.startingSpiteCharged && creatureHasAbility(creatureB, "Spite"),
      muddyBuff: false,
      reflectResponseHold: specialAbilitiesB.reflectResponse === "hold",
      hungerRule: true,
      gourmandizer: creatureHasAbility(creatureB, "Gourmandizer"),
      startingHungerUnits: convertFillPctToAppetiteUnits(normalizeCompareFillPct(specialAbilitiesB.startingHungerPct), appetiteBaseB),
      startingThirstUnits: convertFillPctToAppetiteUnits(normalizeCompareFillPct(specialAbilitiesB.startingThirstPct), appetiteBaseB),
      hasHunger: metersB.hunger,
      hasThirst: metersB.thirst,
      appetiteBaseUnits: appetiteBaseB,
      defiledGroundLevel: defiledGroundActive(specialAbilitiesB, creatureB) ? specialAbilitiesB.defiledGroundLevel : 0,
      defiledGroundWeakness: defiledGroundActive(specialAbilitiesA, creatureA),
      hasDarkstar: hasDarkstarPlushie(buildB),
      appetiteDrainMultiplier: (1 + (finalB.hungerDrainPct ?? 0) / 100) * meterSlowB,
      thirstDrainMultiplier: (1 + (finalB.thirstDrainPct ?? 0) / 100) * meterSlowB,
      healingPulseEnabled:
        specialAbilitiesB.healingPulseEnabled && creatureHasAbility(creatureB, "Healing Pulse"),
      healingPulseOnce: specialAbilitiesB.healingPulseMode === "onceAtStart",
      expungeEnabled: creatureHasAbility(creatureB, "Expunge"),
      wardenRageStartHpPct: wardenRageStartHpPctB,
      headStartSec: headStartSecB,
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
        // "auto" is resolved here, against the side's actual breath, because
        // the engine cannot tell an unset mode from an explicit onAvailability.
        breathPolicyA: resolveBreathPolicy(compareBreathPolicyA, getBreathPolicyKind(finalA)),
        breathPolicyB: resolveBreathPolicy(compareBreathPolicyB, getBreathPolicyKind(finalB)),
        compareAirRuleEnabled,
        compareAirRuleCooldownSec,
        compareAirRuleCooldownSecB,
        compareAirRuleCooldownLinked,
        compareAerialDodgeEnabled,
        compareAerialDodgeHitChancePctA,
        compareAerialDodgeHitChancePctB,
        compareAerialDodgeRollStyle,
        compareAerialDodgeSeed: compareAerialDodgeRollStyle === "random" ? Math.floor(Math.random() * 0xffffffff) : 0,
        compareBiteVariantModeA,
        compareBiteVariantModeB,
        combatEventOrder,
        badOmenOutcome,
        // Forward day/night + moon enum to the Rust path
        // so user abilities can read them via `env.is_day` / `env.is_night`
        // / `env.is_blue_moon` / `env.is_blood_moon`. Stat buffs from these
        // were already applied at `applyCompareBuffRuntime` earlier in
        // this hook; the engine sees post-buff stats but also the raw
        // enum strings for ability gating.
        compareDayNight,
        compareMoon,
        compareSeason,
        weather: compareWeather,
        attackerWeatherImmune,
        defenderWeatherImmune,
        // Global Oxygen / Moisture drain mode. The per-side oxygenTime /
        // moistureTime pools ride through the shared stat producer
        // (toRustStatusMeleeStats -> FinalStats); the engine is inert when the
        // mode is off.
        oxygenMoistureMode: compareOxygenMoistureMode,
        attackerStorming,
        defenderStorming,
        // Nearby-radiated rule. The count is linked across both sides, so either
        // side's value is the shared figure; off => 0 (single source, 0.5%/tick).
        radiationNearbyCount: specialAbilitiesA.radiationNearby ? specialAbilitiesA.radiationNearbyCount : 0,
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
    } finally {
      setIsCalculating(false);
    }
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
    compareAirRuleCooldownSecB,
    compareAirRuleCooldownLinked,
    compareAerialDodgeEnabled,
    compareAerialDodgeHitChancePctA,
    compareAerialDodgeHitChancePctB,
    compareAerialDodgeRollStyle,
    compareNoMoveFacetank,
    compareFirstTickMode,
    compareFirstTickDelaySec,
    comparePosturePolicyA,
    comparePosturePolicyB,
    compareBreathPolicyA,
    compareBreathPolicyB,
    creatureA,
    creatureB,
    specialAbilitiesA,
    specialAbilitiesB,
    compareWeather,
    compareOxygenMoistureMode,
    compareDayNight,
    compareMoon,
    compareBuffsA,
    compareBuffsB,
    combatEventOrder,
  ]);

  // While a calculation is in flight, tick an honest elapsed-time readout.
  // The matchup runs off the main thread (compare worker), so the UI is free
  // to animate; this is the only progress signal the single WASM call exposes.
  useEffect(() => {
    if (!isCalculating) return;
    const id = window.setInterval(() => {
      setCalcElapsedMs(performance.now() - calcStartRef.current);
    }, 100);
    return () => window.clearInterval(id);
  }, [isCalculating]);

  return {
    finalA,
    finalB,
    summary,
    needsCalc,
    calculate,
    isCalculating,
    calcElapsedMs,
  };
}


/**
 * Volcanic and Frosty each stretch both drain intervals by 1.25x, so a creature
 * running one uses about 20% less hunger and thirst. In game each is gated on
 * its own pair of seasons; here they stay on their own battle settings, so the
 * meter half follows the setting rather than the season, exactly as their regen
 * half already does.
 */
function weatherAbilityMeterDrainMultiplier(
  creature: CreatureRuntime | undefined,
  finalStats: FinalStats,
  abilities: CompareSpecialAbilityState,
): number {
  const WEATHER_ABILITY_INTERVAL = 1.25;
  let multiplier = 1;
  if (abilities.volcanic && creatureHasAbility(creature, "Volcanic")) {
    multiplier /= WEATHER_ABILITY_INTERVAL;
  }
  const hasFrosty =
    creatureHasAbility(creature, "Frosty")
    || !!finalStats.plushieGrantedOtherAbilities?.some((a) => a.name === "Frosty");
  if (abilities.frosty && hasFrosty) {
    multiplier /= WEATHER_ABILITY_INTERVAL;
  }
  return multiplier;
}
