import type { CombatantRuntime, CombatantState } from "./runtimeContext";
import { specialEventsRuntime } from "./engineRuntimeBundle";
import { createDisabledSet, createTestTickContext } from "./engineTestHelpers";

export function __test_handleSelfDestruct(
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
  specialEventsRuntime.handleSelfDestruct(
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

export function __test_handleTotemTick(
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
  specialEventsRuntime.handleTotemTick(
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

export function __test_handleCursedSigil(
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
  specialEventsRuntime.handleCursedSigil(
    time,
    attacker,
    defender,
    attackerState,
    defenderState,
    options.activesOn ?? true,
    createDisabledSet(options.attackerDisabledAbilities),
    createDisabledSet(options.defenderDisabledAbilities),
  );
}

export function __test_handleThornTrap(
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
  specialEventsRuntime.handleThornTrap(
    time,
    attacker,
    defender,
    attackerState,
    defenderState,
    options.activesOn ?? true,
    createDisabledSet(options.attackerDisabledAbilities),
    createDisabledSet(options.defenderDisabledAbilities),
  );
}

export function __test_updateSpite(
  time: number,
  attacker: CombatantRuntime,
  defender: CombatantRuntime,
  attackerState: CombatantState,
  defenderState: CombatantState,
  options: {
    activesOn?: boolean;
    attackerDisabledAbilities?: string[];
  } = {},
): void {
  specialEventsRuntime.updateSpite(
    time,
    attacker,
    defender,
    attackerState,
    defenderState,
    options.activesOn ?? true,
    "fast",
    createDisabledSet(options.attackerDisabledAbilities),
  );
}

export function __test_updateRadiation(
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
  specialEventsRuntime.updateRadiation(
    time,
    attacker,
    defender,
    attackerState,
    defenderState,
    options.activesOn ?? true,
    createDisabledSet(options.attackerDisabledAbilities),
    createDisabledSet(options.defenderDisabledAbilities),
  );
}

export function __test_updateReflux(
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
  specialEventsRuntime.updateReflux(
    time,
    attacker,
    defender,
    attackerState,
    defenderState,
    options.activesOn ?? true,
    createDisabledSet(options.attackerDisabledAbilities),
    createDisabledSet(options.defenderDisabledAbilities),
  );
}

export function __test_updateLanceAura(
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
  specialEventsRuntime.updateLanceAura(
    time,
    attacker,
    defender,
    attackerState,
    defenderState,
    options.activesOn ?? true,
    createDisabledSet(options.attackerDisabledAbilities),
    createDisabledSet(options.defenderDisabledAbilities),
  );
}

export function __test_updateCauseFear(
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
  specialEventsRuntime.updateCauseFear(
    time,
    attacker,
    defender,
    attackerState,
    defenderState,
    options.activesOn ?? true,
    createDisabledSet(options.attackerDisabledAbilities),
    createDisabledSet(options.defenderDisabledAbilities),
  );
}
