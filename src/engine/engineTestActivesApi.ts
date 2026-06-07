import type { CombatantRuntime, CombatantState } from "./runtimeContext";
import type { AbilityTimingMode } from "./types";
import { activesRuntime, markAbilityApplied, statusRuntime } from "./engineRuntimeBundle";
import { createDisabledSet } from "./engineTestHelpers";

export function __test_handleFortify(
  time: number,
  runtime: CombatantRuntime,
  opponent: CombatantRuntime,
  state: CombatantState,
  opponentState: CombatantState,
  disabledAbilities: string[] = [],
  abilityPolicy: AbilityTimingMode = "fast",
): void {
  activesRuntime.handleFortify(time, runtime, opponent, state, opponentState, true, abilityPolicy, createDisabledSet(disabledAbilities));
}

export function __test_handleFrostNova(
  time: number,
  attacker: CombatantRuntime,
  defender: CombatantRuntime,
  attackerState: CombatantState,
  defenderState: CombatantState,
  attackerDisabledAbilities: string[] = [],
  defenderDisabledAbilities: string[] = [],
  abilityPolicy: AbilityTimingMode = "fast",
): void {
  activesRuntime.handleFrostNova(
    time,
    attacker,
    defender,
    attackerState,
    defenderState,
    true,
    abilityPolicy,
    createDisabledSet(attackerDisabledAbilities),
    createDisabledSet(defenderDisabledAbilities),
  );
}

export function __test_handleFrostSnare(
  time: number,
  attacker: CombatantRuntime,
  defender: CombatantRuntime,
  attackerState: CombatantState,
  defenderState: CombatantState,
  attackerDisabledAbilities: string[] = [],
  defenderDisabledAbilities: string[] = [],
): void {
  activesRuntime.handleFrostSnare(
    time,
    attacker,
    defender,
    attackerState,
    defenderState,
    true,
    createDisabledSet(attackerDisabledAbilities),
    createDisabledSet(defenderDisabledAbilities),
  );
}

export function __test_handlePoisonArea(
  time: number,
  attacker: CombatantRuntime,
  defender: CombatantRuntime,
  attackerState: CombatantState,
  defenderState: CombatantState,
  attackerDisabledAbilities: string[] = [],
  defenderDisabledAbilities: string[] = [],
): void {
  activesRuntime.handlePoisonArea(
    time,
    attacker,
    defender,
    attackerState,
    defenderState,
    true,
    createDisabledSet(attackerDisabledAbilities),
    createDisabledSet(defenderDisabledAbilities),
  );
}

export function __test_handleGrimLariat(
  time: number,
  attacker: CombatantRuntime,
  defender: CombatantRuntime,
  attackerState: CombatantState,
  defenderState: CombatantState,
  attackerDisabledAbilities: string[] = [],
  defenderDisabledAbilities: string[] = [],
): void {
  activesRuntime.handleGrimLariat(
    time,
    attacker,
    defender,
    attackerState,
    defenderState,
    true,
    createDisabledSet(attackerDisabledAbilities),
    createDisabledSet(defenderDisabledAbilities),
  );
}

export function __test_updateRewind(
  time: number,
  runtime: CombatantRuntime,
  opponent: CombatantRuntime,
  state: CombatantState,
  opponentState: CombatantState,
  disabledAbilities: string[] = [],
  abilityPolicy: AbilityTimingMode = "fast",
): void {
  activesRuntime.updateRewind(
    time,
    runtime,
    opponent,
    state,
    opponentState,
    true,
    abilityPolicy,
    createDisabledSet(disabledAbilities),
  );
}

export function __test_updateReflect(
  time: number,
  runtime: CombatantRuntime,
  opponent: CombatantRuntime,
  state: CombatantState,
  opponentState: CombatantState,
  disabledAbilities: string[] = [],
  abilityPolicy: AbilityTimingMode = "fast",
): void {
  activesRuntime.updateReflect(
    time,
    runtime,
    opponent,
    state,
    opponentState,
    true,
    abilityPolicy,
    createDisabledSet(disabledAbilities),
  );
}

export function __test_updateAdrenaline(
  time: number,
  runtime: CombatantRuntime,
  opponent: CombatantRuntime,
  state: CombatantState,
  opponentState: CombatantState,
  disabledAbilities: string[] = [],
  abilityPolicy: AbilityTimingMode = "fast",
): void {
  activesRuntime.updateAdrenaline(
    time,
    runtime,
    opponent,
    state,
    opponentState,
    true,
    abilityPolicy,
    createDisabledSet(disabledAbilities),
  );
}

export function __test_updateLichMark(
  time: number,
  runtime: CombatantRuntime,
  opponent: CombatantRuntime,
  state: CombatantState,
  opponentState: CombatantState,
  disabledAbilities: string[] = [],
  abilityPolicy: AbilityTimingMode = "fast",
): void {
  activesRuntime.updateLichMark(
    time,
    runtime,
    opponent,
    state,
    opponentState,
    true,
    abilityPolicy,
    createDisabledSet(disabledAbilities),
  );
}

export function __test_updateHarden(
  time: number,
  runtime: CombatantRuntime,
  opponent: CombatantRuntime,
  state: CombatantState,
  opponentState: CombatantState,
  disabledAbilities: string[] = [],
  abilityPolicy: AbilityTimingMode = "fast",
): void {
  activesRuntime.updateHarden(
    time,
    runtime,
    opponent,
    state,
    opponentState,
    true,
    abilityPolicy,
    createDisabledSet(disabledAbilities),
  );
}

export function __test_updateHuntersCurse(
  time: number,
  runtime: CombatantRuntime,
  opponent: CombatantRuntime,
  state: CombatantState,
  opponentState: CombatantState,
  disabledAbilities: string[] = [],
  abilityPolicy: AbilityTimingMode = "fast",
): void {
  activesRuntime.updateHuntersCurse(
    time,
    runtime,
    opponent,
    state,
    opponentState,
    true,
    abilityPolicy,
    createDisabledSet(disabledAbilities),
  );
}

export function __test_updateUnbridledRage(
  time: number,
  runtime: CombatantRuntime,
  opponent: CombatantRuntime,
  state: CombatantState,
  opponentState: CombatantState,
  disabledAbilities: string[] = [],
  abilityPolicy: AbilityTimingMode = "fast",
): void {
  activesRuntime.updateUnbridledRage(
    time,
    runtime,
    opponent,
    state,
    opponentState,
    true,
    abilityPolicy,
    createDisabledSet(disabledAbilities),
  );
}

export function __test_updateShadowBarrage(
  time: number,
  runtime: CombatantRuntime,
  opponent: CombatantRuntime,
  state: CombatantState,
  opponentState: CombatantState,
  disabledAbilities: string[] = [],
): void {
  activesRuntime.updateShadowBarrage(
    time,
    runtime,
    opponent,
    state,
    opponentState,
    true,
    "fast",
    createDisabledSet(disabledAbilities),
  );
}

export function __test_applyDrowsyArea(
  time: number,
  attacker: CombatantRuntime,
  defender: CombatantRuntime,
  attackerState: CombatantState,
  defenderState: CombatantState,
  activesOn: boolean,
): void {
  if (!attacker.hasDrowsyArea || !activesOn) return;
  statusRuntime.applyStatusToTarget({
    time,
    target: { runtime: defender, state: defenderState, disabled: new Set() },
    statusId: "Drowsy_Status",
    stacks: 5,
  });
  attackerState.drowsyAreaCooldownUntil = time + 60 * (attackerState.activeCooldownMultiplier ?? 1);
  markAbilityApplied(attackerState, "Drowsy Area");
}
