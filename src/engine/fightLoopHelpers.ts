import type { AbilityTimingMode } from "./types";
import type { CombatSide, CombatantRuntime, CombatantState, TickContext } from "./runtimeContext";

type LoopDebugSnapshot = {
  time: number;
  iterationCount: number;
  attacker: CombatantRuntime["final"];
  defender: CombatantRuntime["final"];
  stateA: CombatantState;
  stateB: CombatantState;
};

export function createCombatSide(
  runtime: CombatantRuntime,
  state: CombatantState,
  disabled: Set<string>,
): CombatSide {
  return { runtime, state, disabled };
}

export function createTickContext(
  time: number,
  attacker: CombatSide,
  defender: CombatSide,
  activesOn: boolean,
  abilityPolicy: AbilityTimingMode,
): TickContext {
  return { time, attacker, defender, activesOn, abilityPolicy };
}

export function reportInfiniteLoop(snapshot: LoopDebugSnapshot): void {
  console.error(
    `[ENGINE] Infinite loop detected! Breaking at time=${snapshot.time.toFixed(2)}s, iterations=${snapshot.iterationCount}`,
  );
  console.error(
    `[ENGINE] A: ${snapshot.attacker.name}, HP=${snapshot.stateA.hp.toFixed(0)}/${snapshot.attacker.health}`,
  );
  console.error(
    `[ENGINE] B: ${snapshot.defender.name}, HP=${snapshot.stateB.hp.toFixed(0)}/${snapshot.defender.health}`,
  );
}
