import { createCombatantRuntimeFactory } from "./combatantRuntimeFactory";
import { createCombatantStateFactory } from "./combatantStateFactory";
import type { CombatantFactoryDeps } from "./combatantFactoryTypes";

export function createCombatantFactory(deps: CombatantFactoryDeps) {
  const runtimeFactory = createCombatantRuntimeFactory(deps);
  const stateFactory = createCombatantStateFactory(deps);

  return {
    buildCombatantRuntime: runtimeFactory.buildCombatantRuntime,
    createCombatantState: stateFactory.createCombatantState,
    initializeStateForRuntime: stateFactory.initializeStateForRuntime,
  };
}
