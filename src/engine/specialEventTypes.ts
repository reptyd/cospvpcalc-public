import type { CombatantRuntime, CombatantState, TickContext } from "./runtimeContext";
import type { AbilityTimingMode } from "./types";

export type SpecialEventsDeps = {
  applyStatusToTarget: (ctx: {
    time: number;
    target: { runtime: CombatantRuntime; state: CombatantState; disabled: Set<string> };
    statusId: string;
    stacks: number;
    source?: Pick<CombatantState, "sideLabel" | "combatLog">;
    sourceAbilityName?: string;
  }) => void;
  resolveLanceAilment: (runtime: CombatantRuntime) => string | null;
  markAbilityApplied: (state: CombatantState, abilityName: string, time?: number, description?: string) => void;
};

export type StatusEventContext = {
  time: number;
  attacker: CombatantRuntime;
  defender: CombatantRuntime;
  attackerState: CombatantState;
  defenderState: CombatantState;
  activesOn: boolean;
  attackerDisabled: Set<string>;
  defenderDisabled: Set<string>;
};

export type SpiteContext = {
  time: number;
  runtime: CombatantRuntime;
  opponent: CombatantRuntime;
  state: CombatantState;
  opponentState: CombatantState;
  activesOn: boolean;
  abilityPolicy: AbilityTimingMode;
  disabled: Set<string>;
};

export type { TickContext };
