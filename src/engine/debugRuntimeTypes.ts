import type { EffectsCatalogByCreature, SpecialAbilityDef, StatusEffect } from "./types";
import type { CombatantRuntime, CombatantState, StatusAggregate } from "./runtimeContext";

export type DebugDeps = {
  rulesWeightRatioCap: number;
  disableWardenResistance: string;
  aggregateStatusModifiers: (statuses: CombatantState["statuses"]) => StatusAggregate;
  computeIncomingDamageMultiplier: (
    runtime: CombatantRuntime,
    state: CombatantState,
    mods: StatusAggregate,
    activesOn: boolean,
  ) => number;
  isAbilityDisabled: (disabled: Set<string>, abilityName: string) => boolean;
  normalizeAbilityName: (name: string) => string;
  hasAbilityName: (effects: EffectsCatalogByCreature, abilityName: string) => boolean;
  specialAbilities: Record<string, SpecialAbilityDef>;
  getStatusDefinition: (statusId: string) => StatusEffect | undefined;
  computeDotDamage: (maxHp: number, status: StatusEffect, stacks: number, tickSec: number) => number;
};
