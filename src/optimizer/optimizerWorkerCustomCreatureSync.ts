// Worker-side custom creature registration. Workers have their own module
// scope, so registerTemporaryCreature / registerTemporaryCreatureEffects /
// registerTemporaryCompareAppetiteEntry must be invoked inside each worker
// before any BB job that references a custom creature.

import { registerTemporaryCompareAppetiteEntry } from "../engine/compareAppetiteData";
import { registerTemporaryCreature } from "../engine/creatureData";
import { registerTemporaryCreatureEffects } from "../engine/data";
import type { CustomCreaturePayload } from "./optimizerWorkerProtocol";

export function applyCustomCreatureSync(records: CustomCreaturePayload[]): void {
  for (const record of records) {
    registerTemporaryCreature(record.creature, { iconName: record.iconName });
    registerTemporaryCreatureEffects(record.creature.name, record.effects);
    if (record.appetite) {
      registerTemporaryCompareAppetiteEntry(record.creature.name, record.appetite);
    }
  }
}
