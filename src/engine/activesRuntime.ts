import { createActiveOffenseRuntime } from "./activeOffenseRuntime";
import { createActiveUtilityRuntime } from "./activeUtilityRuntime";
import type { ActivesDeps } from "./activesRuntimeTypes";

export function createActivesRuntime(deps: ActivesDeps) {
  const utilityRuntime = createActiveUtilityRuntime(deps);
  const offenseRuntime = createActiveOffenseRuntime(deps);

  return {
    ...utilityRuntime,
    ...offenseRuntime,
  };
}
