import type { FinalStats } from "./types";
import type { CombatantRuntime, CombatantState } from "./runtimeContext";
import { combatantFactory } from "./engineRuntimeBundle";

export function __test_buildCombatantRuntime(finalStats: FinalStats): CombatantRuntime {
  return combatantFactory.buildCombatantRuntime(finalStats);
}

export function __test_createCombatantState(finalStats: FinalStats): CombatantState {
  return combatantFactory.createCombatantState(finalStats);
}

export function __test_initializeStateForRuntime(runtime: CombatantRuntime, state: CombatantState): void {
  combatantFactory.initializeStateForRuntime(runtime, state);
}
