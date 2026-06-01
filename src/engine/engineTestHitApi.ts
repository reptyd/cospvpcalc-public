import type { CombatantRuntime, CombatantState } from "./runtimeContext";
import { hitRuntime } from "./engineRuntimeBundle";
import { createTestTickContext } from "./engineTestHelpers";

export function __test_handleMeleeHit(
  time: number,
  attacker: CombatantRuntime,
  defender: CombatantRuntime,
  attackerState: CombatantState,
  defenderState: CombatantState,
  options: {
    activesOn?: boolean;
    attackerDisabledAbilities?: string[];
    defenderDisabledAbilities?: string[];
  } = {},
): void {
  hitRuntime.handleMeleeHit(
    createTestTickContext({
      time,
      attacker,
      defender,
      attackerState,
      defenderState,
      activesOn: options.activesOn,
      attackerDisabledAbilities: options.attackerDisabledAbilities,
      defenderDisabledAbilities: options.defenderDisabledAbilities,
    }),
  );
}

export function __test_handleShadowBarrageHit(
  time: number,
  attacker: CombatantRuntime,
  defender: CombatantRuntime,
  attackerState: CombatantState,
  defenderState: CombatantState,
  options: {
    activesOn?: boolean;
    attackerDisabledAbilities?: string[];
    defenderDisabledAbilities?: string[];
  } = {},
): void {
  hitRuntime.handleShadowBarrageHit(
    createTestTickContext({
      time,
      attacker,
      defender,
      attackerState,
      defenderState,
      activesOn: options.activesOn,
      attackerDisabledAbilities: options.attackerDisabledAbilities,
      defenderDisabledAbilities: options.defenderDisabledAbilities,
    }),
  );
}
