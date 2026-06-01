import { createDebugAbilityCoverage } from "./debugAbilityCoverage";
import { createDebugMetricsRuntime } from "./debugMetricsRuntime";
import type { DebugDeps } from "./debugRuntimeTypes";

export function createDebugRuntime(deps: DebugDeps) {
  const abilityCoverage = createDebugAbilityCoverage(deps);
  const metricsRuntime = createDebugMetricsRuntime({
    ...deps,
    getPresentAbilityNames: abilityCoverage.getPresentAbilityNames,
    getModeledAbilityNames: abilityCoverage.getModeledAbilityNames,
  });

  return {
    estimateEhp: metricsRuntime.estimateEhp,
    buildDebug: metricsRuntime.buildDebug,
  };
}
