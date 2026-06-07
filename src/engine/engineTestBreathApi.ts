import type { CombatantRuntime, CombatantState } from "./runtimeContext";
import { breathRuntime } from "./engineRuntimeBundle";
import { createTestTickContext } from "./engineTestHelpers";

export function __test_applyBreathTick(
  time: number,
  attacker: CombatantRuntime,
  defender: CombatantRuntime,
  attackerState: CombatantState,
  defenderState: CombatantState,
  options: {
    breathOn?: boolean;
    activesOn?: boolean;
    attackerDisabledAbilities?: string[];
    defenderDisabledAbilities?: string[];
  } = {},
): void {
  const ctx = createTestTickContext({
    time,
    attacker,
    defender,
    attackerState,
    defenderState,
    activesOn: options.activesOn,
    attackerDisabledAbilities: options.attackerDisabledAbilities,
    defenderDisabledAbilities: options.defenderDisabledAbilities,
  });

  breathRuntime.applyBreathTick({
    ...ctx,
    breathOn: options.breathOn ?? true,
  });
}
