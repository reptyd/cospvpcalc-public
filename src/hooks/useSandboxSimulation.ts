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
import { rollBadOmenBatch } from "../engine/subsystems/statuses";
import { getCreatureMeters } from "../engine/compareMeters";
import { applyCompareBuffRuntime } from "../engine/compareBuffRuntime";
import { toStartingStatuses } from "../optimizer/rustCompareMatchupRuntime";
import { isAquaticType, isTerrestrialType, isWeatherImmune, type WeatherCondition } from "../engine/weather";
import { creatureHasAbility } from "../components/compare/compareSpecialAbilities";
import {
  buildBestBuildsExtraAbilityConfig,
  buildBestBuildsExtraCombatantStats,
  buildBreathPolicyDefaults,
} from "../optimizer/bestBuildsBattleSettingsBridge";
import type { BestBuildsBattleSettings } from "../components/bestBuilds/bestBuildsBattleSettingsTypes";
import {
  createSandbox,
  destroySandbox,
  isSandboxBridgeAvailable,
  sandboxApplyHp,
  sandboxApplyMeter,
  type SandboxMeter,
  sandboxApplyStatus,
  sandboxClearOverrides,
  sandboxForceAbility,
  sandboxForceBite,
  sandboxForceBreath,
  sandboxForcePosture,
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
  sandboxReconfigure,
  sandboxSetAutomationMode,
  sandboxSetBadOmenOutcomes,
  sandboxStep,
  sandboxStepToTime,
  sandboxStepUntilEvent,
  sandboxStepUntilReady,
  type SandboxAutomationMode,
  type SandboxBiteVariant,
  type SandboxEventFilter,
  type SandboxOverrideField,
  type SandboxPosture,
  type SandboxReadyKind,
  type SandboxSide,
  type SandboxView,
} from "../engine/sandboxBridge";
import {
  toRustBreathProfile,
  toRustComposableAbilityConfig,
  toRustStatusMeleeStats,
} from "../optimizer/rustBestBuildsRuntime";

// The Sandbox is a place to step through a fight, not a place to score one, so
// the only thing that should stop it is the user's patience. A hair over 24
// days of sim time is a ceiling nobody reaches by accident and no clock loses
// precision at.
const SANDBOX_MAX_TIME_SEC = 2_097_152;

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
   *  buffs + weather). source->side A, opponent->side B. Defaults are inert,
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
  applyMeter: (side: SandboxSide, meter: SandboxMeter, value: number) => Promise<void>;
  applyStatus: (side: SandboxSide, statusId: string, stacks: number) => Promise<void>;
  forceBite: (side: SandboxSide, variant?: SandboxBiteVariant) => Promise<void>;
  forceBreath: (side: SandboxSide) => Promise<void>;
  forcePosture: (side: SandboxSide, target: SandboxPosture) => Promise<void>;
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
  // Latest view + actives flag, read inside stepToTime without making it a
  // dependency, so a backward seek can re-roll Bad Omen (see stepToTime).
  const viewRef = useRef<SandboxView | null>(null);
  viewRef.current = view;
  const activesOnRef = useRef(input.activesOn);
  activesOnRef.current = input.activesOn;
  // Manual / SemiAuto is a property of the running sandbox, not of the payload
  // it was built from: switching it must not rebuild anything, or the clock and
  // the whole fight would go back to zero. It is read at create time and pushed
  // to the live runtime on every later change.
  const automationModeRef = useRef(input.automationMode);
  automationModeRef.current = input.automationMode;

  const payload = useMemo(() => {
    const { creatureA, creatureB, buildA, buildB, abilityPolicy, activesOn, breathOn, battleSettings } = input;
    if (!creatureA || !creatureB) return null;
    let finalA = applyRulesAndBuild(creatureA, buildA);
    let finalB = applyRulesAndBuild(creatureB, buildB);

    // Battle-settings FinalStats layer (day/night, moon, per-side buffs),
    // reusing Compare's runtime so Sandbox matches Compare/BB for those
    // settings. source->side A, opponent->side B. At defaults (no buffs,
    // day/night/moon "none") this is a no-op.
    type StartStatus = ReturnType<typeof toStartingStatuses>;
    let startA: StartStatus = [];
    let startB: StartStatus = [];
    let acmA = 1;
    let acmB = 1;
    if (battleSettings) {
      const rA = applyCompareBuffRuntime(finalA, buildA, battleSettings.source.buffs, battleSettings.global.dayNight, battleSettings.global.moon);
      finalA = rA.finalStats;
      startA = toStartingStatuses(rA.initialStatuses);
      acmA = rA.activeCooldownMultiplier;
      const rB = applyCompareBuffRuntime(finalB, buildB, battleSettings.opponent.buffs, battleSettings.global.dayNight, battleSettings.global.moon);
      finalB = rB.finalStats;
      startB = toStartingStatuses(rB.initialStatuses);
      acmB = rB.activeCooldownMultiplier;
    }

    const attackerBase = toRustStatusMeleeStats(creatureA, finalA, EMPTY_DISABLED, activesOn);
    const defenderBase = toRustStatusMeleeStats(creatureB, finalB, EMPTY_DISABLED, activesOn);
    let attacker = startA.length > 0 || acmA !== 1
      ? {
          ...attackerBase,
          startingStatuses: [...(attackerBase.startingStatuses ?? []), ...startA],
          activeCooldownMultiplier: (attackerBase.activeCooldownMultiplier ?? 1) * acmA,
        }
      : attackerBase;
    let defender = startB.length > 0 || acmB !== 1
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
    if (activesOn) {
      // Bad Omen is random: mark the config as wanting a fresh batch (empty
      // placeholder). The actual roll happens per pass - in `provisionSandbox`
      // (initial create / Reset) and on every rewind (backward `stepToTime`) -
      // so each replayed pass shows a different follow-up. Spread to a NEW
      // object: the builder result is cached per creature pair, so mutating it
      // in place would leak into Best Builds for the same creatures.
      config = { ...config, badOmenOutcomes: [] };
    }
    // Creature-derived breath firing policy (chain breaths burst off a full
    // bar). Applied before the settings overlay so an explicit per-side pick
    // from Battle Settings wins.
    config = { ...config, ...buildBreathPolicyDefaults(creatureA, creatureB) };
    if (battleSettings) {
      // Overlay the config-level battle settings (weather, day/night + moon
      // env flags, no-move-facetank, first-tick, posture, specific-ability
      // config, ability-timing overrides). source->attacker, opponent->defender.
      // Per-side combatant-stat rules (Fixed Bite Cadence seconds + Dodge
      // Chance hit chance). Without this, the dodge active flag would land
      // on the config while the per-side hit chance stayed at its 0 default -
      // and a flier would dodge every attack. Only the two air-rule fields are
      // pulled through here; disabled-abilities threading stays on the existing
      // Sandbox path. source->attacker, opponent->defender.
      const extraStats = buildBestBuildsExtraCombatantStats(battleSettings);
      const sourceStats = extraStats?.source;
      const opponentStats = extraStats?.opponent;
      if (sourceStats?.compareAirRuleCooldownSec !== undefined) {
        attacker = { ...attacker, compareAirRuleCooldownSec: sourceStats.compareAirRuleCooldownSec };
      }
      if (sourceStats?.aerialDodgeHitChancePct !== undefined) {
        attacker = { ...attacker, aerialDodgeHitChancePct: sourceStats.aerialDodgeHitChancePct };
      }
      if (opponentStats?.compareAirRuleCooldownSec !== undefined) {
        defender = { ...defender, compareAirRuleCooldownSec: opponentStats.compareAirRuleCooldownSec };
      }
      if (opponentStats?.aerialDodgeHitChancePct !== undefined) {
        defender = { ...defender, aerialDodgeHitChancePct: opponentStats.aerialDodgeHitChancePct };
      }
      const extra = buildBestBuildsExtraAbilityConfig(battleSettings, true);
      config = { ...config, ...(extra ?? {}) };
      // Weather immunity (resolved on TS - engine has no Volcanic/Frosty path):
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
    // The survival meters run in the Sandbox the way they run in a fight, so
    // the bars move and starving actually bites. Each side carries only the
    // meters its diet gives it, and both are sized off its own appetite stat.
    //
    // This lands after the battle-settings overlay on purpose: those settings
    // are Best Builds', and Best Builds runs its meters on a flat 100-unit bar.
    // Layered the other way round it would replace the creature's appetite with
    // that flat 100.
    const metersA = getCreatureMeters(creatureA);
    const metersB = getCreatureMeters(creatureB);
    config = {
      ...config,
      attackerCompareHungerRule: true,
      defenderCompareHungerRule: true,
      attackerCompareAppetiteBase: finalA.appetite ?? 100,
      defenderCompareAppetiteBase: finalB.appetite ?? 100,
      attackerCompareStartingHunger: 0,
      defenderCompareStartingHunger: 0,
      attackerCompareStartingThirst: 0,
      defenderCompareStartingThirst: 0,
      attackerCompareHasNoHunger: !metersA.hunger,
      defenderCompareHasNoHunger: !metersB.hunger,
      attackerCompareHasNoThirst: !metersA.thirst,
      defenderCompareHasNoThirst: !metersB.thirst,
    };
    return {
      attacker,
      defender,
      attackerBreath,
      defenderBreath,
      abilityPolicy: abilityPolicyToRust(abilityPolicy),
      config,
      maxTimeSec: SANDBOX_MAX_TIME_SEC,
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
    input.battleSettings,
  ]);

  // Which two fighters the live sandbox was built for. Nobody swaps a creature
  // or re-spends a build in the middle of a fight, so either one starts the
  // fight over; everything else in the payload is handed to the running fight.
  const fightersKey = JSON.stringify([
    input.creatureA?.name ?? "",
    input.buildA,
    input.creatureB?.name ?? "",
    input.buildB,
  ]);
  const payloadRef = useRef(payload);
  payloadRef.current = payload;
  const fightersKeyRef = useRef(fightersKey);
  fightersKeyRef.current = fightersKey;
  const liveFightersKeyRef = useRef<string | null>(null);

  const provisionSandbox = useCallback(async () => {
    const payload = payloadRef.current;
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
      // Roll a fresh Bad Omen batch for this pass (initial create / Reset).
      // The memo leaves an empty placeholder; clone the config so the cached
      // builder result is never mutated. Each create thus gets new randomness.
      const withOmens = Array.isArray(payload.config.badOmenOutcomes)
        ? { ...payload, config: { ...payload.config, badOmenOutcomes: rollBadOmenBatch() } }
        : payload;
      const bornInMode = automationModeRef.current;
      const { id, view: initialView } = await createSandbox({ ...withOmens, automationMode: bornInMode });
      if (generation !== generationRef.current) {
        await destroySandbox(id).catch(() => undefined);
        return;
      }
      if (previousId !== null) {
        await destroySandbox(previousId).catch(() => undefined);
      }
      simIdRef.current = id;
      liveFightersKeyRef.current = fightersKeyRef.current;
      // The mode can change while the create is in flight; the effect below
      // sees no id yet in that case, so catch up here.
      setView(
        automationModeRef.current === bornInMode
          ? initialView
          : await sandboxSetAutomationMode(id, automationModeRef.current),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setView(null);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the payload and the
    // fighters key are read through refs so that changing a setting reconfigures
    // the running sandbox instead of re-creating this callback and rebuilding it.
  }, []);

  // Only the fighters decide between rebuilding and reconfiguring: a different
  // creature or build is a different fight, while every other setting describes
  // the fight that is already running. Rebuilding on one of those put the clock
  // back to zero and threw away everything set up by hand.
  useEffect(() => {
    if (!payload) return;
    const id = simIdRef.current;
    if (id === null || liveFightersKeyRef.current !== fightersKey) {
      void provisionSandbox();
      return;
    }
    const { maxTimeSec: _maxTimeSec, recordTrace: _recordTrace, ...setup } = payload;
    void sandboxReconfigure(id, setup)
      .then(setView)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, [payload, fightersKey, provisionSandbox]);

  useEffect(
    () => () => {
      const id = simIdRef.current;
      simIdRef.current = null;
      liveFightersKeyRef.current = null;
      if (id !== null) {
        void destroySandbox(id).catch(() => undefined);
      }
    },
    [],
  );

  useEffect(() => {
    const id = simIdRef.current;
    if (id === null) return;
    void sandboxSetAutomationMode(id, input.automationMode)
      .then(setView)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, [input.automationMode]);

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
      await runAction(async (id) => {
        // Rewinding starts a fresh pass. Bad Omen re-rolls its on-expiry
        // follow-up every simulation, so push a new random batch before the
        // engine rebuilds-and-replays (its `step_to_time` rewinds when
        // target < now by the same 1e-9 margin). Each backward seek + re-
        // advance thus shows a different debuff - matching the in-game
        // randomness. Best Builds pins a deterministic outcome and never
        // hits this path; the debug Roulette pins via the config.
        const now = viewRef.current?.time ?? 0;
        if (activesOnRef.current && target + 1e-9 < now) {
          await sandboxSetBadOmenOutcomes(id, rollBadOmenBatch());
        }
        return sandboxStepToTime(id, target);
      });
    },
    [runAction],
  );

  const applyHp = useCallback(
    async (side: SandboxSide, hp: number) => {
      await runAction((id) => sandboxApplyHp(id, side, hp));
    },
    [runAction],
  );

  const applyMeter = useCallback(
    async (side: SandboxSide, meter: SandboxMeter, value: number) => {
      await runAction((id) => sandboxApplyMeter(id, side, meter, value));
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
    async (side: SandboxSide, variant: SandboxBiteVariant = "primary") => {
      // The Rust side steps the bite phase internally with the opponent's
      // schedule suppressed - only this side's bite fires + appears in the
      // log. The variant (primary / secondary) is resolved by the engine;
      // a single forced bite is exactly one variant.
      await runAction((id) => sandboxForceBite(id, side, variant));
    },
    [runAction],
  );

  const forceBreath = useCallback(
    async (side: SandboxSide) => {
      await runAction((id) => sandboxForceBreath(id, side));
    },
    [runAction],
  );

  const forcePosture = useCallback(
    async (side: SandboxSide, target: SandboxPosture) => {
      // Begins a posture transition; the engine settles it over sim time as
      // the user steps forward (no immediate step here).
      await runAction((id) => sandboxForcePosture(id, side, target));
    },
    [runAction],
  );

  const forceAbility = useCallback(
    async (side: SandboxSide, abilityName: string) => {
      // Direct-mutation activation only - Rust `arm_ability_for_side` sets
      // active_until / cooldown_until / HP cost / etc. inline; the returned
      // view already reflects the activated state at the unchanged sim
      // time. No engine step is run - per the Sandbox/Optimizer
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
    applyMeter,
    applyStatus,
    forceBite,
    forceBreath,
    forcePosture,
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
