import type { CombatantRuntime, CombatantState, StatusAggregate } from "./runtimeContext";

export type PolicyProjectionScore = {
  winRank: number;
  ttk: number;
  effectiveDamage: number;
};
export type PolicyProjectionCheckpoint = {
  selfState: CombatantState;
  opponentState: CombatantState;
};
export type LifeLeechProjectionResult = {
  score: PolicyProjectionScore;
  activationDelaySec: number;
  projectedFightSec: number;
  activationSelfHp: number;
  activationMissingHp: number;
  realizedHeal: number;
  wastedHeal: number;
  rawHeal: number;
  selfHpEnd: number;
  opponentHpEnd: number;
  totalDamage: number;
};
export type PolicyProjectionOptions = {
  activationDelaySec?: number;
  forcedRageOn?: boolean;
  forcedRageDurationSec?: number;
  snapshotWardenRageOnActivation?: boolean;
  holdWardenRageOnActivation?: boolean;
  immediateSelfHeal?: number;
  immediateSelfHpCost?: number;
  immediateOpponentDamage?: number;
  effectDurationSec?: number;
  outgoingMultiplier?: number;
  incomingMultiplier?: number;
  lifeLeechPct?: number;
};

export type PolicyDeps = {
  wardenRageStacksFromHpRatio: (hpRatio: number) => number;
  aggregateStatusModifiers: (statuses: CombatantState["statuses"]) => StatusAggregate;
  computeOutgoingDamageMultiplier: (runtime: CombatantRuntime, state: CombatantState, mods: StatusAggregate, activesOn: boolean) => number;
  computeIncomingDamageMultiplier: (runtime: CombatantRuntime, state: CombatantState, mods: StatusAggregate, activesOn: boolean) => number;
  applyWeightModifiers: (baseWeight: number, mods: StatusAggregate) => number;
  computeMeleeDamagePerHit: (
    attacker: CombatantRuntime["final"],
    defender: CombatantRuntime["final"],
    damageMultiplier: number,
    damageTakenMultiplier: number,
    attackerWeight?: number,
    defenderWeight?: number,
  ) => number;
  currentBiteCooldown: (runtime: CombatantRuntime, state: CombatantState, activesOn: boolean) => number;
  computeRegenMultiplier: (state: CombatantState, runtime: CombatantRuntime) => number;
  passiveRegenTickSec: number;
  huntersCurseDurationSec: number;
  unbridledRageDurationSec: number;
  reflectDurationSec: number;
  adrenalineDurationSec: number;
};
