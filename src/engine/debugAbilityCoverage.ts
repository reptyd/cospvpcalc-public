import type { EffectsCatalogByCreature } from "./types";
import type { CombatantRuntime } from "./runtimeContext";
import type { DebugDeps } from "./debugRuntimeTypes";
import { MODELED_OTHER_ABILITIES } from "../shared/modeledOtherAbilities";

export function createDebugAbilityCoverage(deps: DebugDeps) {
  function getPresentAbilityNames(effects: EffectsCatalogByCreature): string[] {
    const names = new Set<string>();
    for (const entry of effects.specialAbilitiesDetailed ?? []) names.add(entry.name);
    for (const entry of effects.specialAbilities ?? []) names.add(entry.name);
    for (const entry of effects.otherAbilities ?? []) names.add(entry.name);
    for (const entry of effects.applyStatusOnHit ?? []) names.add(entry.sourceAbility);
    for (const entry of effects.applyStatusOnHitTaken ?? []) names.add(entry.sourceAbility);
    for (const entry of effects.resistStatus ?? []) names.add(entry.sourceAbility);
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }

  function getModeledAbilityNames(runtime: CombatantRuntime): string[] {
    const names = new Set<string>();
    for (const entry of runtime.effects.applyStatusOnHit ?? []) names.add(entry.sourceAbility);
    for (const entry of runtime.effects.applyStatusOnHitTaken ?? []) names.add(entry.sourceAbility);
    for (const entry of runtime.effects.resistStatus ?? []) names.add(entry.sourceAbility);
    for (const entry of runtime.effects.specialAbilitiesDetailed ?? []) names.add(entry.name);
    for (const entry of runtime.effects.specialAbilities ?? []) {
      if (deps.specialAbilities[entry.name]) names.add(entry.name);
    }
    for (const entry of runtime.effects.otherAbilities ?? []) {
      if (deps.specialAbilities[entry.name]) names.add(entry.name);
    }
    for (const name of MODELED_OTHER_ABILITIES) {
      if (deps.hasAbilityName(runtime.effects, name)) names.add(name);
    }
    if (runtime.final.hasBreath) names.add("Breath");
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }

  return {
    getPresentAbilityNames,
    getModeledAbilityNames,
  };
}
