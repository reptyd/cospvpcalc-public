import type { BreathTickContext, CombatantRuntime, CombatantState, TickContext } from "./runtimeContext";
import type { SimulationOptions } from "./types";

export type FightLoopDeps = {
  disableBreath: string;
  breathTickSec: number;
  timelineRuntime: {
    nextEventAt: (stateA: CombatantState, stateB: CombatantState, nextBreathA: number, nextBreathB: number) => number;
    nextSelfDestructAt: (state: CombatantState) => number;
  };
  isAbilityDisabled: (disabled: Set<string>, abilityName: string) => boolean;
  isActivesDisabledByNecro: (state: CombatantState) => boolean;
  updateStateAt: (ctx: TickContext) => void;
  handleMeleeHit: (ctx: TickContext) => boolean;
  handleShadowBarrageHit: (ctx: TickContext) => void;
  currentBiteCooldown: (runtime: CombatantRuntime, state: CombatantState, activesOn: boolean) => number;
  handleDotTicks: (ctx: {
    time: number;
    target: { runtime: CombatantRuntime; state: CombatantState; disabled: Set<string> };
    sourceState?: CombatantState;
  }) => void;
  handleChannelingPulse: (ctx: TickContext) => void;
  handleSelfDestruct: (ctx: TickContext) => void;
  handleTotemTick: (ctx: TickContext) => void;
  applyBreathTick: (ctx: BreathTickContext) => void;
};

export type FightLoopParams = {
  attacker: CombatantRuntime["final"];
  defender: CombatantRuntime["final"];
  runtimeA: CombatantRuntime;
  runtimeB: CombatantRuntime;
  stateA: CombatantState;
  stateB: CombatantState;
  options: SimulationOptions;
  disabledA: Set<string>;
  disabledB: Set<string>;
  maxTime: number;
};
