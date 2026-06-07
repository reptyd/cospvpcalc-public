import type { AbilityTimingMode, EffectsCatalogByCreature } from "./types";
import type { CombatantRuntime, CombatantState } from "./runtimeContext";
import type { TimedAbilityActivationDecision } from "./timedAbilityPolicyRuntime";

export type ActivesDeps = {
  disableReflect: string;
  reflectDurationSec: number;
  reflectCooldownSec: number;
  drowsyAreaCooldownSec: number;
  totemDurationSec: number;
  totemCooldownSec: number;
  totemTickSec: number;
  adrenalineDurationSec: number;
  adrenalineCooldownSec: number;
  lichMarkCooldownSec: number;
  lichMarkArmedWindowSec: number;
  hardenStacks: number;
  hardenCooldownSec: number;
  huntersCurseDurationSec: number;
  huntersCurseCooldownSec: number;
  unbridledRageDurationSec: number;
  unbridledRageCooldownSec: number;
  fortifyCooldownSec: number;
  fortifyStacks: number;
  statusStackDurationSec: number;
  frostNovaCooldownSec: number;
  frostNovaDurationSec: number;
  frostNovaTickSec: number;
  isAbilityDisabled: (disabled: Set<string>, abilityName: string) => boolean;
  hasAbilityName: (effects: EffectsCatalogByCreature, abilityName: string) => boolean;
  isPrecisionPolicy: (mode: AbilityTimingMode) => boolean;
  isFortifyRemovableStatus: (statusId: string) => boolean;
  shouldActivateFortifyHeuristic: (removable: string[]) => boolean;
  isReflectActiveAt: (state: CombatantState, time: number) => boolean;
  markAbilityApplied: (state: CombatantState, abilityName: string, time?: number, description?: string) => void;
  applyStatusToTarget: (
    time: number,
    targetRuntime: CombatantRuntime,
    targetState: CombatantState,
    statusId: string,
    stacks: number,
    targetDisabled: Set<string>,
    sourceState?: CombatantState,
    sourceAbilityName?: string,
  ) => void;
  policyRuntime: {
    estimateIncomingDps: (
      runtime: CombatantRuntime,
      opponent: CombatantRuntime,
      state: CombatantState,
      opponentState: CombatantState,
    ) => number;
    shouldActivateReflectBySearch: (
      runtime: CombatantRuntime,
      opponent: CombatantRuntime,
      state: CombatantState,
      opponentState: CombatantState,
      abilityPolicy: AbilityTimingMode,
    ) => boolean;
    shouldActivateAdrenalineBySearch: (
      runtime: CombatantRuntime,
      opponent: CombatantRuntime,
      state: CombatantState,
      opponentState: CombatantState,
      abilityPolicy: AbilityTimingMode,
    ) => boolean;
    decideAdrenalineActivationBySearch: (
      runtime: CombatantRuntime,
      opponent: CombatantRuntime,
      state: CombatantState,
      opponentState: CombatantState,
      abilityPolicy: AbilityTimingMode,
      decisionTimeSec?: number,
    ) => TimedAbilityActivationDecision;
    shouldActivateHuntersCurseBySearch: (
      runtime: CombatantRuntime,
      opponent: CombatantRuntime,
      state: CombatantState,
      opponentState: CombatantState,
      abilityPolicy: AbilityTimingMode,
    ) => boolean;
    decideHuntersCurseActivationBySearch: (
      runtime: CombatantRuntime,
      opponent: CombatantRuntime,
      state: CombatantState,
      opponentState: CombatantState,
      abilityPolicy: AbilityTimingMode,
    ) => TimedAbilityActivationDecision;
    shouldActivateHuntersCurse: (
      runtime: CombatantRuntime,
      opponent: CombatantRuntime,
      opponentState: CombatantState,
      state: CombatantState,
    ) => boolean;
    shouldActivateUnbridledRageBySearch: (
      runtime: CombatantRuntime,
      opponent: CombatantRuntime,
      state: CombatantState,
      opponentState: CombatantState,
      abilityPolicy: AbilityTimingMode,
    ) => boolean;
    decideUnbridledRageActivationBySearch: (
      runtime: CombatantRuntime,
      opponent: CombatantRuntime,
      state: CombatantState,
      opponentState: CombatantState,
      abilityPolicy: AbilityTimingMode,
    ) => TimedAbilityActivationDecision;
    shouldActivateUnbridledRage: (runtime: CombatantRuntime, state: CombatantState) => boolean;
    shouldActivateFortifyBySearch: (
      runtime: CombatantRuntime,
      opponent: CombatantRuntime,
      state: CombatantState,
      opponentState: CombatantState,
      removable: string[],
      abilityPolicy: AbilityTimingMode,
    ) => boolean;
    shouldActivateFrostNovaBySearch: (
      attacker: CombatantRuntime,
      defender: CombatantRuntime,
      attackerState: CombatantState,
      defenderState: CombatantState,
      damage: number,
      abilityPolicy: AbilityTimingMode,
    ) => boolean;
    shouldActivateRewindBySearch: (
      runtime: CombatantRuntime,
      opponent: CombatantRuntime,
      state: CombatantState,
      opponentState: CombatantState,
      restoredHp: number,
      restoredStatuses: CombatantState["statuses"],
      abilityPolicy: AbilityTimingMode,
    ) => boolean;
  };
};
