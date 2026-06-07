import type { CombatantRuntime, CombatantState } from "./runtimeContext";
import { statusRuntime } from "./engineRuntimeBundle";
import { createTestTarget } from "./engineTestHelpers";

export function __test_applyStatusToTarget(
  time: number,
  target: CombatantRuntime,
  targetState: CombatantState,
  statusId: string,
  stacks: number,
  source?: CombatantState,
  sourceAbilityName?: string,
): void {
  statusRuntime.applyStatusToTarget({
    time,
    target: createTestTarget(target, targetState),
    statusId,
    stacks,
    source,
    sourceAbilityName,
  });
}

export function __test_updateStatusDurations(
  time: number,
  delta: number,
  runtime: CombatantRuntime,
  state: CombatantState,
): void {
  statusRuntime.updateStatusDurations(time, delta, runtime, state, new Set());
}

export function __test_handleDotTicks(
  time: number,
  runtime: CombatantRuntime,
  state: CombatantState,
  sourceState?: CombatantState,
): void {
  statusRuntime.handleDotTicks({ time, target: createTestTarget(runtime, state), sourceState });
}

export function __test_healStatusStacks(
  time: number,
  runtime: CombatantRuntime,
  state: CombatantState,
  stacksToHeal: number,
): void {
  statusRuntime.healStatusStacks({ time, target: createTestTarget(runtime, state), stacksToHeal });
}
