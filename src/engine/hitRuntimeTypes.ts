import type { CombatantRuntime, CombatantState, StatusAggregate } from "./runtimeContext";

export type HitRuntimeDeps = {
  disableStatusAttacks: string;
  disablePlushieOff: string;
  disablePlushieDef: string;
  disableLichMark: string;
  aggregateStatusModifiers: (statuses: Record<string, CombatantState["statuses"][string]>) => StatusAggregate;
  computeOutgoingDamageMultiplier: (
    runtime: CombatantRuntime,
    state: CombatantState,
    mods: StatusAggregate,
    activesOn: boolean,
  ) => number;
  computeIncomingDamageMultiplier: (
    runtime: CombatantRuntime,
    state: CombatantState,
    mods: StatusAggregate,
    activesOn: boolean,
  ) => number;
  applyWeightModifiers: (baseWeight: number, mods: StatusAggregate) => number;
  getActiveWeightMultiplier: (state: CombatantState) => number;
  computeMeleeDamagePerHit: (
    attacker: CombatantRuntime["final"],
    defender: CombatantRuntime["final"],
    damageMultiplier: number,
    damageTakenMultiplier: number,
    attackerWeight?: number,
    defenderWeight?: number,
  ) => number;
  isReflectActiveAt: (state: CombatantState, time: number) => boolean;
  isAbilityDisabled: (disabled: Set<string>, abilityName: string) => boolean;
  hasAbilityName: (effects: CombatantRuntime["effects"], abilityName: string) => boolean;
  normalizeAbilityName: (name: string) => string;
  applyStatusToTarget: (
    ctx: {
      time: number;
      target: { runtime: CombatantRuntime; state: CombatantState; disabled: Set<string> };
      statusId: string;
      stacks: number;
      lichMarkOwnedStacks?: number;
      source?: Pick<CombatantState, "sideLabel" | "combatLog">;
      sourceAbilityName?: string;
    },
  ) => void;
  markAbilityApplied: (state: CombatantState, abilityName: string, time?: number, description?: string) => void;
  tryArmSpiteAfterHit: (
    time: number,
    runtime: CombatantRuntime,
    state: CombatantState,
    activesOn: boolean,
    disabled: Set<string>,
  ) => void;
};
