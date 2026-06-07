import { createEngineRuntimeCombat } from "./engineRuntimeCombat";
import { createEngineRuntimeFoundation } from "./engineRuntimeFoundation";

export function createEngineRuntimeCore() {
  const foundation = createEngineRuntimeFoundation();
  const combat = createEngineRuntimeCombat(foundation);

  return {
    ...foundation,
    ...combat,
  };
}
