// React hook for driving a single sandbox session.
//
// Owns the simId lifecycle (create on mount / props change, destroy on
// unmount), the current `SandboxView` state, and a callback for every
// mutating action. Each callback returns a Promise resolving to the new
// view after the action lands; the hook also subscribes the React state
// so consumers don't have to thread the result back manually.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { applyRulesAndBuild } from "../engine/buildRules";
import type { AbilityTimingMode, BuildOptions, CreatureRuntime, FinalStats } from "../engine";
import { applyCompareBuffRuntime } from "../engine/compareBuffRuntime";
import { isAquaticType, isTerrestrialType, isWeatherImmune, type WeatherCondition } from "../engine/weather";
import { creatureHasAbility } from "../components/compare/compareSpecialAbilities";
import { buildBestBuildsExtraAbilityConfig } from "../optimizer/bestBuildsBattleSettingsBridge";
import type { BestBuildsBattleSettings } from "../components/bestBuilds/bestBuildsBattleSettingsTypes";
import {
  createSandbox,
  destroySandbox,
  isSandboxBridgeAvailable,
  sandboxApplyHp,
  sandboxApplyStatus,
  sandboxClearOverrides,
  sandboxForceAbility,
  sandboxForceBite,
  sandboxForceBreath,
  sandboxOverrideAbility,
  sandboxOverrideAbilityNumber,
  sandboxOverrideAbilityString,
  sandboxOverrideBreath,
  sandboxOverridePassiveBool,
  sandboxOverridePassiveNumber,
  sandboxOverrideDefensiveStatus,
  sandboxOverrideOffensiveStatus,
  sandboxOverrideResist,
  sandboxOverrideStat,
  sandboxStep,
  sandboxStepToTime,
  sandboxStepUntilEvent,
  sandboxStepUntilReady,
  type SandboxAutomationMode,
  type SandboxEventFilter,
  type SandboxOverrideField,
  type SandboxReadyKind,
  type SandboxSide,
  type SandboxView,
} from "../engine/sandboxBridge";
import {
  toRustBreathProfile,
  toRustComposableAbilityConfig,
  toRustStatusMeleeStats,
} from "../optimizer/rustBestBuildsRuntime";

const SANDBOX_MAX_TIME_SEC = 900;

export type UseSandboxSimulationInput = {
  creatureA?: CreatureRuntime;
  creatureB?: CreatureRuntime;
  buildA: BuildOptions;
  buildB: BuildOptions;
  abilityPolicy: AbilityTimingMode;
  activesOn: boolean;
  breathOn: boolean;
  automationMode: SandboxAutomationMode;
  /** Shared Best Builds / Optimizer battle settings (global rules + per-side
   *  buffs + weather). source→side A, opponent→side B. Defaults are inert,
   *  so omitting it leaves Sandbox at engine defaults. */
  battleSettings?: BestBuildsBattleSettings;
};

export type UseSandboxSimulationResult = {
  view: SandboxView | null;
  ready: boolean;
  loading: boolean;
  error: string | null;
  bridgeUnavailable: boolean;
  reset: () => Promise<void>;
  step: () => Promise<void>;
  stepToTime: (target: number) => Promise<void>;
  applyHp: (side: SandboxSide, hp: number) => Promise<void>;
  applyStatus: (side: SandboxSide, statusId: string, stacks: number) => Promise<void>;
  forceBite: (side: SandboxSide) => Promise<void>;
  forceBreath: (side: SandboxSide) => Promise<void>;
  forceAbility: (side: SandboxSide, abilityName: string) => Promise<boolean>;
  overrideStat: (side: SandboxSide, field: SandboxOverrideField, value: number) => Promise<void>;
  clearOverrides: (side: SandboxSide) => Promise<void>;
  overrideAbility: (side: SandboxSide, abilityName: string, enabled: boolean) => Promise<boolean>;
  overrideAbilityNumber: (side: SandboxSide, abilityName: string, value: number) => Promise<boolean>;
  overrideAbilityString: (
    side: SandboxSide,
    abilityName: string,
    value: string | null,
  ) => Promise<boolean>;
  overridePassiveBool: (
    side: SandboxSide,
    passiveName: string,
    enabled: boolean,
  ) => Promise<boolean>;
  overridePassiveNumber: (
    side: SandboxSide,
    passiveName: string,
    value: number,
  ) => Promise<boolean>;
  overrideBreath: (
    side: SandboxSide,
    profile: import("../optimizer/rustMatchupBridge").RustSimpleBreathProfile | null,
  ) => Promise<void>;
  overrideResist: (side: SandboxSide, statusId: string, fraction: number) => Promise<void>;
  overrideOffensiveStatus: (side: SandboxSide, statusId: string, stacks: number) => Promise<void>;
  overrideDefensiveStatus: (side: SandboxSide, statusId: string, stacks: number) => Promise<void>;
  stepUntilEvent: (filter: SandboxEventFilter) => Promise<void>;
  stepUntilReady: (side: SandboxSide, kind: SandboxReadyKind) => Promise<void>;
};

function abilityPolicyToRust(mode: AbilityTimingMode): "reallyFast" | "fast" | "semiIdeal" | "ideal" {
  switch (mode) {
    case "reallyFast":
      return "reallyFast";
    case "fast":
      return "fast";
    case "semiIdeal":
      return "semiIdeal";
    case "ideal":
    default:
      return "ideal";
  }
}

const EMPTY_DISABLED = new Set<string>();

export function useSandboxSimulation(input: UseSandboxSimulationInput): UseSandboxSimulationResult {
  const [view, setView] = useState<SandboxView | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bridgeUnavailable, setBridgeUnavailable] = useState(false);
  const simIdRef = useRef<bigint | null>(null);
  const generationRef = useRef(0);

  const payload = useMemo(() => {
    const { creatureA, creatureB, buildA, buildB, abilityPolicy, activesOn, breathOn, automationMode, battleSettings } = input;
    if (!creatureA || !creatureB) return null;
    let finalA = applyRulesAndBuild(creatureA, buildA);
    let finalB = applyRulesAndBuild(creatureB, buildB);

    // Battle-settings FinalStats layer (day/night, moon, per-side buffs),
    // reusing Compare's runtime so Sandbox matches Compare/BB for those
    // settings. source→side A, opponent→side B. At defaults (no buffs,
    // day/night/moon "none") this is a no-op.
    type StartStatus = { statusId: string; stacks: number; stackValueMode: "durationOnly"; sourceAbility: string | null };
    let startA: StartStatus[] = [];
    let startB: StartStatus[] = [];
    let acmA = 1;
    let acmB = 1;
    if (battleSettings) {
      const toStarting = (opts: ReturnType<typeof applyCompareBuffRuntime>["initialStatuses"]): StartStatus[] =>
        opts.map((opt) => ({
          statusId: opt.statusId,
          stacks: Math.max(1, Math.floor(opt.remainingSec ?? 1)),
          stackValueMode: "durationOnly" as const,
          sourceAbility: opt.sourceAbilityName ?? null,
        }));
      const rA = applyCompareBuffRuntime(finalA, buildA, battleSettings.source.buffs, battleSettings.global.dayNight, battleSettings.global.moon);
      finalA = rA.finalStats;
      startA = toStarting(rA.initialStatuses);
      acmA = rA.activeCooldownMultiplier;
      const rB = applyCompareBuffRuntime(finalB, buildB, battleSettings.opponent.buffs, battleSettings.global.dayNight, battleSettings.global.moon);
      finalB = rB.finalStats;
      startB = toStarting(rB.initialStatuses);
      acmB = rB.activeCooldownMultiplier;
    }

    const attackerBase = toRustStatusMeleeStats(creatureA, finalA, EMPTY_DISABLED, activesOn);
    const defenderBase = toRustStatusMeleeStats(creatureB, finalB, EMPTY_DISABLED, activesOn);
    const attacker = startA.length > 0 || acmA !== 1
      ? {
          ...attackerBase,
          startingStatuses: [...(attackerBase.startingStatuses ?? []), ...startA],
          activeCooldownMultiplier: (attackerBase.activeCooldownMultiplier ?? 1) * acmA,
        }
      : attackerBase;
    const defender = startB.length > 0 || acmB !== 1
      ? {
          ...defenderBase,
          startingStatuses: [...(defenderBase.startingStatuses ?? []), ...startB],
          activeCooldownMultiplier: (defenderBase.activeCooldownMultiplier ?? 1) * acmB,
        }
      : defenderBase;
    const attackerBreath = breathOn ? toRustBreathProfile(finalA) : null;
    const defenderBreath = breathOn ? toRustBreathProfile(finalB) : null;
    let config = activesOn
      ? toRustComposableAbilityConfig(creatureA, creatureB)
      : ({} as ReturnType<typeof toRustComposableAbilityConfig>);
    if (battleSettings) {
      // Overlay the config-level battle settings (weather, day/night + moon
      // env flags, no-move-facetank, first-tick, posture, specific-ability
      // config, ability-timing overrides). source→attacker, opponent→defender.
      const extra = buildBestBuildsExtraAbilityConfig(battleSettings);
      config = { ...config, ...(extra ?? {}) };
      // Weather immunity (resolved on TS — engine has no Volcanic/Frosty path):
      // intrinsic to having the ability, matching Compare/BB.
      const weather = config.weather as WeatherCondition | undefined;
      if (weather && weather !== "none") {
        const hasFrosty = (creature: CreatureRuntime, final: FinalStats): boolean =>
          creatureHasAbility(creature, "Frosty")
          || !!final.plushieGrantedOtherAbilities?.some((a) => a.name === "Frosty");
        config = {
          ...config,
          attackerWeatherImmune: isWeatherImmune(weather, creatureHasAbility(creatureA, "Volcanic"), hasFrosty(creatureA, finalA)),
          defenderWeatherImmune: isWeatherImmune(weather, creatureHasAbility(creatureB, "Volcanic"), hasFrosty(creatureB, finalB)),
        };
      }
      // Storming gate: the inherited buff toggle only applies when the
      // afflicted side is Terrestrial and its opponent is Aquatic.
      if (config.attackerStorming || config.defenderStorming) {
        const aType = creatureA.stats.type;
        const bType = creatureB.stats.type;
        config = {
          ...config,
          attackerStorming: !!config.attackerStorming && isTerrestrialType(aType) && isAquaticType(bType),
          defenderStorming: !!config.defenderStorming && isTerrestrialType(bType) && isAquaticType(aType),
        };
      }
    }
    return {
      attacker,
      defender,
      attackerBreath,
      defenderBreath,
      abilityPolicy: abilityPolicyToRust(abilityPolicy),
      config,
      maxTimeSec: SANDBOX_MAX_TIME_SEC,
      automationMode,
      recordTrace: true,
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- per-field input.* deps are intentional; input is a fresh literal each render
  }, [
    input.creatureA,
    input.creatureB,
    input.buildA,
    input.buildB,
    input.abilityPolicy,
    input.activesOn,
    input.breathOn,
    input.automationMode,
    input.battleSettings,
  ]);

  const provisionSandbox = useCallback(async () => {
    if (!payload) return;
    const generation = ++generationRef.current;
    setLoading(true);
    setError(null);
    try {
      const available = await isSandboxBridgeAvailable();
      if (!available) {
        setBridgeUnavailable(true);
        setView(null);
        return;
      }
      setBridgeUnavailable(false);
      const previousId = simIdRef.current;
      const { id, view: initialView } = await createSandbox(payload);
      if (generation !== generationRef.current) {
        await destroySandbox(id).catch(() => undefined);
        return;
      }
      if (previousId !== null) {
        await destroySandbox(previousId).catch(() => undefined);
      }
      simIdRef.current = id;
      setView(initialView);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setView(null);
    } finally {
      setLoading(false);
    }
  }, [payload]);

  useEffect(() => {
    void provisionSandbox();
    return () => {
      const id = simIdRef.current;
      simIdRef.current = null;
      if (id !== null) {
        void destroySandbox(id).catch(() => undefined);
      }
    };
  }, [provisionSandbox]);

  const runAction = useCallback(async <R,>(action: (id: bigint) => Promise<R>, updateView?: (result: R) => SandboxView | null): Promise<R | null> => {
    const id = simIdRef.current;
    if (id === null) return null;
    try {
      setError(null);
      const result = await action(id);
      if (updateView) {
        const nextView = updateView(result);
        if (nextView !== null) setView(nextView);
      } else if ((result as unknown) !== undefined) {
        setView(result as unknown as SandboxView);
      }
      return result;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return null;
    }
  }, []);

  const reset = useCallback(async () => {
    await provisionSandbox();
  }, [provisionSandbox]);

  const step = useCallback(async () => {
    await runAction((id) => sandboxStep(id));
  }, [runAction]);

  const stepToTime = useCallback(
    async (target: number) => {
      await runAction((id) => sandboxStepToTime(id, target));
    },
    [runAction],
  );

  const applyHp = useCallback(
    async (side: SandboxSide, hp: number) => {
      await runAction((id) => sandboxApplyHp(id, side, hp));
    },
    [runAction],
  );

  const applyStatus = useCallback(
    async (side: SandboxSide, statusId: string, stacks: number) => {
      await runAction((id) => sandboxApplyStatus(id, side, statusId, stacks));
    },
    [runAction],
  );

  const forceBite = useCallback(
    async (side: SandboxSide) => {
      // The Rust side steps the bite phase internally with the opponent's
      // schedule suppressed — only this side's bite fires + appears in the
      // log. No extra stepUntilEvent needed.
      await runAction((id) => sandboxForceBite(id, side));
    },
    [runAction],
  );

  const forceBreath = useCallback(
    async (side: SandboxSide) => {
      await runAction((id) => sandboxForceBreath(id, side));
    },
    [runAction],
  );

  const forceAbility = useCallback(
    async (side: SandboxSide, abilityName: string) => {
      // Direct-mutation activation only — Rust `arm_ability_for_side` sets
      // active_until / cooldown_until / HP cost / etc. inline; the returned
      // view already reflects the activated state at the unchanged sim
      // time. No engine step is run — per the Sandbox/Optimizer
      // history note, force actions guarantee only the requested action
      // fires. Stepping would advance time to the next "ability" event and
      // sweep up unrelated passives (natural regen, status ticks).
      const armResult = await runAction(
        (id) => sandboxForceAbility(id, side, abilityName),
        (r) => r.view,
      );
      return armResult?.recognised ?? false;
    },
    [runAction],
  );

  const overrideStat = useCallback(
    async (side: SandboxSide, field: SandboxOverrideField, value: number) => {
      await runAction((id) => sandboxOverrideStat(id, side, field, value));
    },
    [runAction],
  );

  const clearOverrides = useCallback(
    async (side: SandboxSide) => {
      await runAction((id) => sandboxClearOverrides(id, side));
    },
    [runAction],
  );

  const overrideAbility = useCallback(
    async (side: SandboxSide, abilityName: string, enabled: boolean) => {
      const result = await runAction(
        (id) => sandboxOverrideAbility(id, side, abilityName, enabled),
        (r) => r.view,
      );
      return result?.recognised ?? false;
    },
    [runAction],
  );

  const overrideAbilityNumber = useCallback(
    async (side: SandboxSide, abilityName: string, value: number) => {
      const result = await runAction(
        (id) => sandboxOverrideAbilityNumber(id, side, abilityName, value),
        (r) => r.view,
      );
      return result?.recognised ?? false;
    },
    [runAction],
  );

  const overrideAbilityString = useCallback(
    async (side: SandboxSide, abilityName: string, value: string | null) => {
      const result = await runAction(
        (id) => sandboxOverrideAbilityString(id, side, abilityName, value),
        (r) => r.view,
      );
      return result?.recognised ?? false;
    },
    [runAction],
  );

  const overridePassiveBool = useCallback(
    async (side: SandboxSide, passiveName: string, enabled: boolean) => {
      const result = await runAction(
        (id) => sandboxOverridePassiveBool(id, side, passiveName, enabled),
        (r) => r.view,
      );
      return result?.recognised ?? false;
    },
    [runAction],
  );

  const overridePassiveNumber = useCallback(
    async (side: SandboxSide, passiveName: string, value: number) => {
      const result = await runAction(
        (id) => sandboxOverridePassiveNumber(id, side, passiveName, value),
        (r) => r.view,
      );
      return result?.recognised ?? false;
    },
    [runAction],
  );

  const overrideBreath = useCallback(
    async (
      side: SandboxSide,
      profile: import("../optimizer/rustMatchupBridge").RustSimpleBreathProfile | null,
    ) => {
      await runAction((id) => sandboxOverrideBreath(id, side, profile));
    },
    [runAction],
  );

  const overrideResist = useCallback(
    async (side: SandboxSide, statusId: string, fraction: number) => {
      await runAction((id) => sandboxOverrideResist(id, side, statusId, fraction));
    },
    [runAction],
  );

  const overrideOffensiveStatus = useCallback(
    async (side: SandboxSide, statusId: string, stacks: number) => {
      await runAction((id) => sandboxOverrideOffensiveStatus(id, side, statusId, stacks));
    },
    [runAction],
  );

  const overrideDefensiveStatus = useCallback(
    async (side: SandboxSide, statusId: string, stacks: number) => {
      await runAction((id) => sandboxOverrideDefensiveStatus(id, side, statusId, stacks));
    },
    [runAction],
  );

  const stepUntilEvent = useCallback(
    async (filter: SandboxEventFilter) => {
      await runAction((id) => sandboxStepUntilEvent(id, filter));
    },
    [runAction],
  );

  const stepUntilReady = useCallback(
    async (side: SandboxSide, kind: SandboxReadyKind) => {
      await runAction((id) => sandboxStepUntilReady(id, side, kind));
    },
    [runAction],
  );

  return {
    view,
    ready: view !== null,
    loading,
    error,
    bridgeUnavailable,
    reset,
    step,
    stepToTime,
    applyHp,
    applyStatus,
    forceBite,
    forceBreath,
    forceAbility,
    overrideStat,
    clearOverrides,
    overrideAbility,
    overrideAbilityNumber,
    overrideAbilityString,
    overridePassiveBool,
    overridePassiveNumber,
    overrideBreath,
    overrideResist,
    overrideOffensiveStatus,
    overrideDefensiveStatus,
    stepUntilEvent,
    stepUntilReady,
  };
}
