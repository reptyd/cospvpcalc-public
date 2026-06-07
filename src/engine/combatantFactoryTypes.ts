import type { BreathSpec, CreatureRuntime, EffectsCatalogByCreature, SpecialAbilityDef } from "./types";
import type { CombatantRuntime } from "./runtimeContext";

export type CombatantFactoryDeps = {
  creatureByName: Record<string, CreatureRuntime>;
  effectsCatalog: Record<string, EffectsCatalogByCreature>;
  specialAbilities: Record<string, SpecialAbilityDef>;
  passiveRegenTickSec: number;
  healingStepTickSec: number;
  statusStackDurationSec: number;
  isAbilityDisabled: (disabled: Set<string>, abilityName: string) => boolean;
  normalizeAbilityName: (name: string) => string;
  hasAbilityName: (effects: EffectsCatalogByCreature, abilityName: string) => boolean;
  getBreathSpec: (runtime: CombatantRuntime) => BreathSpec | null;
};
