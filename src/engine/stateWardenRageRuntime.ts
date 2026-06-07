import type { AbilityTimingMode } from "./types";
import type { CombatantRuntime, CombatantState } from "./runtimeContext";
import { resolveAbilityTimingModeForAbility } from "./abilityTimingOverrides";

export type StateWardenRageDeps = {
  disableWardenRage: string;
  isAbilityDisabled: (disabled: Set<string>, abilityName: string) => boolean;
  isPrecisionPolicy: (mode: AbilityTimingMode) => boolean;
  wardenRageStacksFromHpRatio: (hpRatio: number) => number;
  markAbilityApplied: (state: CombatantState, abilityName: string, time?: number, description?: string) => void;
  policyRuntime: {
    decideWardenRageBySearch: (
      time: number,
      runtime: CombatantRuntime,
      opponent: CombatantRuntime,
      state: CombatantState,
      opponentState: CombatantState,
      abilityPolicy: AbilityTimingMode,
    ) => boolean;
    decideWardenRage: (
      time: number,
      runtime: CombatantRuntime,
      opponent: CombatantRuntime,
      state: CombatantState,
      opponentState: CombatantState,
    ) => boolean;
  };
};

export function createStateWardenRageRuntime(deps: StateWardenRageDeps) {
  const WARDEN_RAGE_TAP_SEC = 0.25;
  function scaleCooldown(state: CombatantState, baseSec: number): number {
    return baseSec * (state.activeCooldownMultiplier ?? 1);
  }

  function logAbilityStateChange(
    state: CombatantState,
    abilityName: string,
    time: number,
    description: string,
  ): void {
    state.combatLog.push({
      time,
      type: "ability",
      attacker: state.sideLabel,
      damage: 0,
      actorHpAfter: state.hp,
      hpSide: state.sideLabel,
      hpAfter: state.hp,
      description: `${abilityName} ${description}`,
    });
  }

  function updateWardenRage(
    time: number,
    runtime: CombatantRuntime,
    opponent: CombatantRuntime,
    state: CombatantState,
    opponentState: CombatantState,
    activesOn: boolean,
    abilityPolicy: AbilityTimingMode,
    disabled: Set<string>,
  ): void {
    const effectiveAbilityPolicy = resolveAbilityTimingModeForAbility("Warden's Rage", abilityPolicy, state.abilityPolicyOverrides);
    if (!runtime.hasWardenRage) return;
    if (deps.isAbilityDisabled(disabled, deps.disableWardenRage)) {
      if (state.wardenRageOn) {
        logAbilityStateChange(state, "Warden's Rage", time, "deactivated");
      }
      state.wardenRageOn = false;
      state.wardenRageTapUntil = 0;
      state.wardenRageHoldMode = false;
      return;
    }
    if (!activesOn) {
      if (state.wardenRageOn) {
        logAbilityStateChange(state, "Warden's Rage", time, "deactivated");
      }
      state.wardenRageOn = false;
      state.wardenRageTapUntil = 0;
      state.wardenRageHoldMode = false;
      return;
    }

    const hpRatio = state.hp / Math.max(1, runtime.final.health);
    const hpBasedStacks = deps.wardenRageStacksFromHpRatio(hpRatio);

    const shouldOn =
      effectiveAbilityPolicy === "reallyFast"
        ? true
        : deps.isPrecisionPolicy(effectiveAbilityPolicy)
          ? deps.policyRuntime.decideWardenRageBySearch(time, runtime, opponent, state, opponentState, effectiveAbilityPolicy)
          : deps.policyRuntime.decideWardenRage(time, runtime, opponent, state, opponentState);
    if (!state.wardenRageOn && shouldOn && time >= state.wardenRageCooldownUntil) {
      state.wardenRageOn = true;
      state.wardenRageCooldownUntil = time + scaleCooldown(state, 30);
      state.wardenRageTapUntil = effectiveAbilityPolicy === "reallyFast" ? 0 : time + WARDEN_RAGE_TAP_SEC;
      state.wardenRageHoldMode = effectiveAbilityPolicy === "reallyFast";
      state.wardenRageStacks = hpBasedStacks;
      state.wardenRageEvents.push(
        `WR_ON t=${time.toFixed(1)} hp=${hpRatio.toFixed(2)} stacks=${hpBasedStacks} cd=${state.wardenRageCooldownUntil.toFixed(1)}`,
      );
      deps.markAbilityApplied(state, "Warden's Rage", time);
    } else if (state.wardenRageOn) {
      if (effectiveAbilityPolicy === "reallyFast") {
        state.wardenRageTapUntil = 0;
        state.wardenRageHoldMode = true;
      }
      state.wardenRageStacks = hpBasedStacks;
    }

    if (state.wardenRageOn && !shouldOn) {
      state.wardenRageOn = false;
      state.wardenRageEvents.push(
        `WR_OFF t=${time.toFixed(1)} hp=${hpRatio.toFixed(2)} stacks=${state.wardenRageStacks} cd=${state.wardenRageCooldownUntil.toFixed(1)}`,
      );
      state.wardenRageTapUntil = 0;
      state.wardenRageHoldMode = false;
      logAbilityStateChange(state, "Warden's Rage", time, "deactivated");
    }
  }

  return {
    updateWardenRage,
  };
}
