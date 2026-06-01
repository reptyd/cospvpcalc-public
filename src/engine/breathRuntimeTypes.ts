import type { BreathTickContext, CombatantRuntime, CombatantState, StatusAggregate } from "./runtimeContext";

export type BreathSpecLike = {
  name?: string;
  raw?: string;
  stats?: Record<string, number | null | undefined>;
  effect?: { dps?: number; perHit?: string };
} | null;

export type BreathRuntimeDeps = {
  breathTickSec: number;
  lanceChargeSec: number;
  lanceCooldownSec: number;
  disableStatusAttacks: string;
  disablePlushieOff: string;
  disablePlushieDef: string;
  computeBreathDamage: (
    attacker: CombatantRuntime["final"],
    defender: CombatantRuntime["final"],
    breathMultiplier: number,
    breathResistance: number,
    attackerWeight?: number,
    defenderWeight?: number,
  ) => number;
  resolveBreathType: (attacker: CombatantRuntime) => string | null;
  getBreathSpec: (runtime: CombatantRuntime) => BreathSpecLike;
  getBreathSpecByType: (type: string) => { effect?: { dps?: number; perHit?: string } } | undefined;
  resolveLanceAilment: (attacker: CombatantRuntime) => string | null;
  parseBreathAilments: (raw: string) => Array<{ name: string; probability: number; stacks?: number | null }>;
  resolveStatusId: (name: string) => string | null;
  addApproxNoteOnce: (notes: string[], message: string) => void;
  isAbilityDisabled: (disabled: Set<string>, abilityName: string) => boolean;
  normalizeAbilityName: (name: string) => string;
  hasAbilityName: (effects: CombatantRuntime["effects"], abilityName: string) => boolean;
  isReflectActiveAt: (state: CombatantState, time: number) => boolean;
  aggregateStatusModifiers: (statuses: CombatantState["statuses"]) => StatusAggregate;
  applyWeightModifiers: (baseWeight: number, mods: StatusAggregate) => number;
  getActiveWeightMultiplier: (state: CombatantState) => number;
  getBreathResistance: (target: CombatantRuntime) => number;
  applyLifeLeech: (
    ctx: {
      time: number;
      attacker: { runtime: CombatantRuntime; state: CombatantState };
      damageDealt: number;
      activesOn: boolean;
    },
  ) => void;
  applyStatusToTarget: (
    ctx: {
      time: number;
      target: { runtime: CombatantRuntime; state: CombatantState; disabled: Set<string> };
      statusId: string;
      stacks: number;
      source?: Pick<CombatantState, "sideLabel" | "combatLog">;
      sourceAbilityName?: string;
    },
  ) => void;
  healStatusStacks: (
    ctx: {
      time: number;
      target: { runtime: CombatantRuntime; state: CombatantState; disabled: Set<string> };
      stacksToHeal: number;
    },
  ) => void;
  markAbilityApplied: (state: CombatantState, abilityName: string, time?: number, description?: string) => void;
};

export type { BreathTickContext };
