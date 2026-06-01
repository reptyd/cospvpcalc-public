import { useEffect, useMemo, useState } from "react";
import type {
  AbilityTimingMode,
  BuildOptions,
  CreatureRuntime,
  FinalStats,
  SimulationSummary,
} from "../engine";
import { BREATH_TICK_SEC, DEFAULT_MAX_TIME_SEC } from "../engine/subsystems/timing";
import { trySimulateRustCompareMatchup } from "../optimizer/rustCompareDispatch";
import type { CompareSidePerks } from "../optimizer/rustCompareMatchupRuntime";
import { creatureHasAbility } from "../components/compare/compareSpecialAbilities";

type EngineRuntime = {
  applyRulesAndBuild: (creature: CreatureRuntime, build: BuildOptions) => FinalStats;
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

function buildFriendlySidePerks(creature: CreatureRuntime | undefined): CompareSidePerks {
  return {
    traps:
      creatureHasAbility(creature, "Thorn Trap") || creatureHasAbility(creature, "Toxic Trap"),
    trails:
      creatureHasAbility(creature, "Toxic Trail")
      || creatureHasAbility(creature, "Plague Trail")
      || creatureHasAbility(creature, "Flame Trail")
      || creatureHasAbility(creature, "Frost Trail")
      || creatureHasAbility(creature, "Healing Step"),
    powerCharge: false,
    goreCharge: false,
    startingSpiteCharged: false,
    muddyBuff: false,
    hungerRule: false,
    gourmandizer: false,
    startingHungerUnits: 0,
    appetiteBaseUnits: 100,
    defiledGroundLevel: 0,
    defiledGroundWeakness: false,
    appetiteDrainMultiplier: 1,
    healingPulseEnabled: creatureHasAbility(creature, "Healing Pulse"),
    healingPulseOnce: false,
    expungeEnabled: creatureHasAbility(creature, "Expunge"),
    wardenRageStartHpPct: 0,
  };
}

export function useFriendlyBattleController({
  creatureA,
  creatureB,
  buildA,
  buildB,
}: {
  creatureA?: CreatureRuntime;
  creatureB?: CreatureRuntime;
  buildA: BuildOptions;
  buildB: BuildOptions;
}) {
  const [activesOn, setActivesOn] = useState(true);
  const [breathOn, setBreathOn] = useState(true);
  const [abilityPolicy, setAbilityPolicy] = useState<AbilityTimingMode>("semiIdeal");
  const [summary, setSummary] = useState<SimulationSummary | null>(null);
  const [finalA, setFinalA] = useState<FinalStats | null>(null);
  const [finalB, setFinalB] = useState<FinalStats | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [displayHpA, setDisplayHpA] = useState(100);
  const [displayHpB, setDisplayHpB] = useState(100);
  const [animationKey, setAnimationKey] = useState(0);

  useEffect(() => {
    let cancelled = false;

    if (!creatureA) {
      setFinalA(null);
    } else {
      void loadEngineRuntime().then((runtime) => {
        if (cancelled) return;
        setFinalA(runtime.applyRulesAndBuild(creatureA, buildA));
      });
    }

    if (!creatureB) {
      setFinalB(null);
    } else {
      void loadEngineRuntime().then((runtime) => {
        if (cancelled) return;
        setFinalB(runtime.applyRulesAndBuild(creatureB, buildB));
      });
    }

    return () => {
      cancelled = true;
    };
  }, [buildA, buildB, creatureA, creatureB]);

  useEffect(() => {
    if (!summary) {
      setDisplayHpA(100);
      setDisplayHpB(100);
      return;
    }

    const nextA = (summary.finalHpA / Math.max(1, summary.maxHpA)) * 100;
    const nextB = (summary.finalHpB / Math.max(1, summary.maxHpB)) * 100;
    setDisplayHpA(100);
    setDisplayHpB(100);
    const timeoutId = window.setTimeout(() => {
      setDisplayHpA(nextA);
      setDisplayHpB(nextB);
    }, 320);
    return () => window.clearTimeout(timeoutId);
  }, [summary, animationKey]);

  const counters = useMemo(() => {
    return {
      bitesA: summary?.debug?.A?.biteCount ?? 0,
      bitesB: summary?.debug?.B?.biteCount ?? 0,
      abilitiesA: summary?.debug?.A?.abilitiesApplied?.reduce((total, entry) => total + entry.count, 0) ?? 0,
      abilitiesB: summary?.debug?.B?.abilitiesApplied?.reduce((total, entry) => total + entry.count, 0) ?? 0,
      breathA: (summary?.debug?.A?.breathTickCount ?? 0) * BREATH_TICK_SEC,
      breathB: (summary?.debug?.B?.breathTickCount ?? 0) * BREATH_TICK_SEC,
    };
  }, [summary]);

  const runBattle = async () => {
    if (!finalA || !finalB || !creatureA || !creatureB) return;
    setIsRunning(true);
    setDisplayHpA(100);
    setDisplayHpB(100);
    setAnimationKey((value) => value + 1);
    const nextSummary = await trySimulateRustCompareMatchup({
      sourceCreature: creatureA,
      opponentCreature: creatureB,
      finalA,
      finalB,
      activesOn,
      breathOn,
      abilityPolicy,
      initialStatusesA: [],
      initialStatusesB: [],
      activeCooldownMultiplierA: 1,
      activeCooldownMultiplierB: 1,
      disabledAbilitiesA: [],
      disabledAbilitiesB: [],
      perksA: buildFriendlySidePerks(creatureA),
      perksB: buildFriendlySidePerks(creatureB),
      firstTick: { mode: "off", delaySec: 0 },
      noMoveFacetank: false,
      compareAirRuleEnabled: false,
      compareAirRuleCooldownSec: 0,
      compareBiteVariantModeA: "primaryOnly",
      compareBiteVariantModeB: "primaryOnly",
      badOmenOutcome: null,
      maxTimeSec: DEFAULT_MAX_TIME_SEC,
    });
    setSummary(nextSummary);
    setIsRunning(false);
  };

  return {
    activesOn,
    setActivesOn,
    breathOn,
    setBreathOn,
    abilityPolicy,
    setAbilityPolicy,
    summary,
    finalA,
    finalB,
    isRunning,
    displayHpA,
    displayHpB,
    animationKey,
    counters,
    runBattle,
  };
}
