import type { CombatantRuntime, CombatantState, StatusAggregate } from "./runtimeContext";
import type { AbilityTimingMode } from "./types";
import {
  computeIncomingDamageMultiplier,
  computeOutgoingDamageMultiplier,
  currentBiteCooldown,
  regenRuntime,
  stateRuntime,
} from "./engineRuntimeBundle";

export function __test_updateWardenRage(
  time: number,
  delta: number,
  runtime: CombatantRuntime,
  opponent: CombatantRuntime,
  state: CombatantState,
  opponentState: CombatantState,
  activesOn: boolean,
  abilityPolicy: AbilityTimingMode = "fast",
): void {
  void delta;
  stateRuntime.updateWardenRage(time, runtime, opponent, state, opponentState, activesOn, abilityPolicy, new Set());
}

export function __test_updateLifeLeech(
  time: number,
  runtime: CombatantRuntime,
  opponent: CombatantRuntime,
  state: CombatantState,
  opponentState: CombatantState,
  activesOn: boolean,
  abilityPolicy: AbilityTimingMode = "fast",
): void {
  stateRuntime.updateLifeLeech(time, runtime, opponent, state, opponentState, activesOn, abilityPolicy, new Set());
}

export function __test_updateHunker(
  time: number,
  runtime: CombatantRuntime,
  opponent: CombatantRuntime,
  state: CombatantState,
  opponentState: CombatantState,
  activesOn: boolean,
  abilityPolicy: AbilityTimingMode = "semiIdeal",
): void {
  stateRuntime.updateHunker(time, runtime, opponent, state, opponentState, activesOn, abilityPolicy, new Set());
}

export function __test_computeOutgoingDamageMultiplier(
  runtime: CombatantRuntime,
  state: CombatantState,
  mods: StatusAggregate,
  activesOn: boolean,
): number {
  return computeOutgoingDamageMultiplier(runtime, state, mods, activesOn);
}

export function __test_computeIncomingDamageMultiplier(
  runtime: CombatantRuntime,
  state: CombatantState,
  mods: StatusAggregate,
  activesOn: boolean,
): number {
  return computeIncomingDamageMultiplier(runtime, state, mods, activesOn);
}

export function __test_currentBiteCooldown(runtime: CombatantRuntime, state: CombatantState, activesOn: boolean): number {
  return currentBiteCooldown(runtime, state, activesOn);
}

export function __test_handlePassiveRegen(time: number, runtime: CombatantRuntime, state: CombatantState): void {
  regenRuntime.handlePassiveRegen(time, runtime, state);
}
