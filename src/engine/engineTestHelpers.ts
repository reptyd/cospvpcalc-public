import type { CombatantRuntime, CombatantState, TickContext } from "./runtimeContext";
import type { AbilityTimingMode } from "./types";

export function createTestTarget(
  runtime: CombatantRuntime,
  state: CombatantState,
  disabledAbilities: string[] = [],
) {
  return {
    runtime,
    state,
    disabled: new Set(disabledAbilities),
  };
}

export function createTestTickContext(args: {
  time: number;
  attacker: CombatantRuntime;
  defender: CombatantRuntime;
  attackerState: CombatantState;
  defenderState: CombatantState;
  activesOn?: boolean;
  abilityPolicy?: AbilityTimingMode;
  attackerDisabledAbilities?: string[];
  defenderDisabledAbilities?: string[];
}): TickContext {
  return {
    time: args.time,
    attacker: createTestTarget(args.attacker, args.attackerState, args.attackerDisabledAbilities),
    defender: createTestTarget(args.defender, args.defenderState, args.defenderDisabledAbilities),
    activesOn: args.activesOn ?? true,
    abilityPolicy: args.abilityPolicy ?? "fast",
  };
}

export function createDisabledSet(disabledAbilities: string[] = []): Set<string> {
  return new Set(disabledAbilities);
}
