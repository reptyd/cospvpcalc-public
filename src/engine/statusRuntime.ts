import { createStatusDotRuntime } from "./statusDotRuntime";
import { createStatusApplyRuntime } from "./statusApplyRuntime";
import { createStatusDurationRuntime } from "./statusDurationRuntime";
import type { CombatantRuntime, CombatantState } from "./runtimeContext";
import type { StatusRuntimeDeps } from "./statusRuntimeTypes";

export function createStatusRuntime(deps: StatusRuntimeDeps) {
  function triggerBadOmenOutcome(time: number, runtime: CombatantRuntime, state: CombatantState, disabled: Set<string>): void {
    const outcome = state.badOmenOutcome;
    if (!outcome) return;
    applyRuntime.applyStatusToTarget({
      time,
      target: { runtime, state, disabled },
      statusId: outcome.statusId,
      stacks: outcome.stacks,
    });
  }

  const applyRuntime = createStatusApplyRuntime({ ...deps, triggerBadOmenOutcome });
  const durationRuntime = createStatusDurationRuntime({ ...deps, triggerBadOmenOutcome });
  const dotRuntime = createStatusDotRuntime({
    getStatusDefinition: deps.getStatusDefinition,
    applyDueDecayForStatus: durationRuntime.applyDueDecayForStatus,
    applyStatusToTarget: (ctx) => applyRuntime.applyStatusToTarget(ctx),
  });

  return {
    applyStatusToTarget: applyRuntime.applyStatusToTarget,
    applyDueDecayForStatus: durationRuntime.applyDueDecayForStatus,
    updateStatusDurations: durationRuntime.updateStatusDurations,
    computeDotDamage: dotRuntime.computeDotDamage,
    handleDotTicks: dotRuntime.handleDotTicks,
    healStatusStacks: dotRuntime.healStatusStacks,
  };
}
