import type { AbilityTimingMode } from "./types";
import type { CombatantRuntime, CombatantState } from "./runtimeContext";
import { cloneStateForProjection, wardenRageStacksFromHpRatio } from "./combatPrimitives";
import { getPolicySearchConfig } from "./subsystems/policySearch";
import type {
  LifeLeechProjectionResult,
  PolicyDeps,
  PolicyProjectionCheckpoint,
  PolicyProjectionOptions,
  PolicyProjectionScore,
} from "./policyRuntimeTypes";

export function createPolicyProjectionMath(deps: PolicyDeps) {
  function projectFixedHunkerWindow(
    startTime: number,
    runtime: CombatantRuntime,
    opponent: CombatantRuntime,
    state: CombatantState,
    opponentState: CombatantState,
    selfHunkerOn: boolean,
    opponentHunkerOn: boolean,
    abilityPolicy: AbilityTimingMode,
  ): PolicyProjectionScore {
    const { horizonSec } = getPolicySearchConfig(abilityPolicy);
    const endTime = startTime + horizonSec;
    const self = cloneStateForProjection(state);
    const enemy = cloneStateForProjection(opponentState);
    self.hunkerOn = selfHunkerOn;
    enemy.hunkerOn = opponentHunkerOn;
    self.lastUpdateAt = startTime;
    enemy.lastUpdateAt = startTime;

    let time = startTime;
    let dealt = 0;
    let deathTimeOpponent = enemy.hp <= 0 ? 0 : Number.POSITIVE_INFINITY;
    let deathTimeSelf = self.hp <= 0 ? 0 : Number.POSITIVE_INFINITY;

    const regenTickAmount = (actor: CombatantRuntime, actorState: CombatantState): number => {
      const regenPct = actor.final.healthRegen ?? 0;
      if (regenPct <= 0) return 0;
      const multiplier = deps.computeRegenMultiplier(actorState, actor);
      return (actor.final.health * regenPct * multiplier) / 100;
    };

    const hitDamage = (
      actor: CombatantRuntime,
      target: CombatantRuntime,
      actorState: CombatantState,
      targetState: CombatantState,
    ): number => {
      const attackerMods = deps.aggregateStatusModifiers(actorState.statuses);
      const defenderMods = deps.aggregateStatusModifiers(targetState.statuses);
      const damageMultiplier = deps.computeOutgoingDamageMultiplier(actor, actorState, attackerMods, true);
      const damageTakenMultiplier = deps.computeIncomingDamageMultiplier(target, targetState, defenderMods, true);
      const attackerWeight = deps.applyWeightModifiers(actor.final.weight, attackerMods);
      const defenderWeight = deps.applyWeightModifiers(target.final.weight, defenderMods);
      return deps.computeMeleeDamagePerHit(
        actor.final,
        target.final,
        damageMultiplier,
        damageTakenMultiplier,
        attackerWeight,
        defenderWeight,
      );
    };

    while (time < endTime && !Number.isFinite(deathTimeOpponent) && !Number.isFinite(deathTimeSelf)) {
      const nextTime = Math.min(self.nextHitAt, enemy.nextHitAt, self.nextRegenAt, enemy.nextRegenAt, endTime);
      if (!Number.isFinite(nextTime)) break;
      const hasDueNowEvent =
        self.nextHitAt <= time + 1e-9 ||
        enemy.nextHitAt <= time + 1e-9 ||
        self.nextRegenAt <= time + 1e-9 ||
        enemy.nextRegenAt <= time + 1e-9;
      if (!hasDueNowEvent) {
        if (nextTime <= time) {
          time += 0.001;
          continue;
        }
        time = nextTime;
      }
      self.lastUpdateAt = time;
      enemy.lastUpdateAt = time;
      self.hunkerOn = selfHunkerOn;
      enemy.hunkerOn = opponentHunkerOn;

      const selfHits = Math.abs(self.nextHitAt - time) <= 1e-9;
      const enemyHits = Math.abs(enemy.nextHitAt - time) <= 1e-9;
      const selfRegens = Math.abs(self.nextRegenAt - time) <= 1e-9;
      const enemyRegens = Math.abs(enemy.nextRegenAt - time) <= 1e-9;

      if (selfHits) {
        const damage = Math.max(0, hitDamage(runtime, opponent, self, enemy));
        enemy.hp -= damage;
        dealt += damage;
        self.nextHitAt = time + deps.currentBiteCooldown(runtime, self, true);
      }
      if (enemyHits) {
        const damage = Math.max(0, hitDamage(opponent, runtime, enemy, self));
        self.hp -= damage;
        enemy.nextHitAt = time + deps.currentBiteCooldown(opponent, enemy, true);
      }
      if (selfRegens) {
        const heal = regenTickAmount(runtime, self);
        if (heal > 0) self.hp = Math.min(runtime.final.health, self.hp + heal);
        self.nextRegenAt += deps.passiveRegenTickSec;
      }
      if (enemyRegens) {
        const heal = regenTickAmount(opponent, enemy);
        if (heal > 0) enemy.hp = Math.min(opponent.final.health, enemy.hp + heal);
        enemy.nextRegenAt += deps.passiveRegenTickSec;
      }

      if (enemy.hp <= 0 && !Number.isFinite(deathTimeOpponent)) deathTimeOpponent = time - startTime;
      if (self.hp <= 0 && !Number.isFinite(deathTimeSelf)) deathTimeSelf = time - startTime;
    }

    const oppDead = Number.isFinite(deathTimeOpponent);
    const selfDead = Number.isFinite(deathTimeSelf);
    const winRank = oppDead && !selfDead ? 2 : selfDead && !oppDead ? 0 : 1;
    const ttk = winRank === 2 ? deathTimeOpponent : winRank === 0 ? deathTimeSelf : horizonSec;
    const survivalValue = Math.max(0, self.hp) * 0.2;
    return { winRank, ttk, effectiveDamage: dealt + survivalValue };
  }

  function projectStaticPolicyWindow(
    runtime: CombatantRuntime,
    opponent: CombatantRuntime,
    state: CombatantState,
    opponentState: CombatantState,
    horizonSec: number,
    stepSec: number,
  ): PolicyProjectionScore {
    const self = cloneStateForProjection(state);
    const enemy = cloneStateForProjection(opponentState);
    const rates = estimateCombatRates(runtime, opponent, self, enemy, false);
    const stepDamage = Math.max(0, rates.outDps * stepSec);
    const stepHeal = Math.max(0, rates.regenPerSec * stepSec);
    const stepIncoming = Math.max(0, rates.incomingDps * stepSec);

    let time = 0;
    let dealt = 0;
    let deathTimeOpponent = enemy.hp <= 0 ? 0 : Number.POSITIVE_INFINITY;
    let deathTimeSelf = self.hp <= 0 ? 0 : Number.POSITIVE_INFINITY;

    const advance = (step: number) => {
      const damage = step === stepSec ? stepDamage : Math.max(0, rates.outDps * step);
      dealt += damage;
      enemy.hp -= damage;
      self.hp = Math.min(runtime.final.health, self.hp + (step === stepSec ? stepHeal : Math.max(0, rates.regenPerSec * step)));
      self.hp -= step === stepSec ? stepIncoming : Math.max(0, rates.incomingDps * step);
      time += step;

      if (enemy.hp <= 0 && !Number.isFinite(deathTimeOpponent)) deathTimeOpponent = time;
      if (self.hp <= 0 && !Number.isFinite(deathTimeSelf)) deathTimeSelf = time;
    };

    const fullSteps = Math.floor(horizonSec / stepSec);
    for (let idx = 0; idx < fullSteps && !Number.isFinite(deathTimeOpponent) && !Number.isFinite(deathTimeSelf); idx += 1) {
      advance(stepSec);
    }

    const remainder = horizonSec - fullSteps * stepSec;
    if (remainder > 0 && !Number.isFinite(deathTimeOpponent) && !Number.isFinite(deathTimeSelf)) {
      advance(remainder);
    }

    const oppDead = Number.isFinite(deathTimeOpponent);
    const selfDead = Number.isFinite(deathTimeSelf);
    const winRank = oppDead && !selfDead ? 2 : selfDead && !oppDead ? 0 : 1;
    const ttk = winRank === 2 ? deathTimeOpponent : winRank === 0 ? deathTimeSelf : horizonSec;
    const survivalValue = Math.max(0, self.hp) * 0.2;
    return { winRank, ttk, effectiveDamage: dealt + survivalValue };
  }

  function estimateIncomingDps(
    runtime: CombatantRuntime,
    opponent: CombatantRuntime,
    state: CombatantState,
    opponentState: CombatantState,
  ): number {
    const attackerMods = deps.aggregateStatusModifiers(opponentState.statuses);
    const defenderMods = deps.aggregateStatusModifiers(state.statuses);
    const damageMultiplier = deps.computeOutgoingDamageMultiplier(opponent, opponentState, attackerMods, true);
    const damageTakenMultiplier = deps.computeIncomingDamageMultiplier(runtime, state, defenderMods, true);
    const attackerWeight = deps.applyWeightModifiers(opponent.final.weight, attackerMods);
    const defenderWeight = deps.applyWeightModifiers(runtime.final.weight, defenderMods);
    const perHit = deps.computeMeleeDamagePerHit(
      opponent.final,
      runtime.final,
      damageMultiplier,
      damageTakenMultiplier,
      attackerWeight,
      defenderWeight,
    );
    const cooldown = deps.currentBiteCooldown(opponent, opponentState, true);
    return cooldown > 0 ? perHit / cooldown : 0;
  }

  function estimateRegenPerSec(runtime: CombatantRuntime, state: CombatantState): number {
    const regenPct = runtime.final.healthRegen ?? 0;
    const multiplier = deps.computeRegenMultiplier(state, runtime);
    const perTick = (runtime.final.health * regenPct * multiplier) / 100;
    return perTick / deps.passiveRegenTickSec;
  }

  function estimateCombatRates(
    runtime: CombatantRuntime,
    opponent: CombatantRuntime,
    state: CombatantState,
    opponentState: CombatantState,
    rageOn: boolean,
    rageStacksOverride?: number,
  ): { outDps: number; incomingDps: number; regenPerSec: number; netDps: number } {
    const attackerMods = deps.aggregateStatusModifiers(state.statuses);
    const defenderMods = deps.aggregateStatusModifiers(opponentState.statuses);
    const hpRatio = state.hp / Math.max(1, runtime.final.health);
    const rageStacks =
      rageStacksOverride ?? (rageOn ? wardenRageStacksFromHpRatio(hpRatio) : Math.max(0, state.wardenRageStacks));
    const damageMultiplier = deps.computeOutgoingDamageMultiplier(
      runtime,
      { ...state, wardenRageOn: rageOn, wardenRageStacks: rageStacks },
      attackerMods,
      true,
    );
    const damageTakenMultiplier = deps.computeIncomingDamageMultiplier(opponent, opponentState, defenderMods, true);
    const attackerWeight = deps.applyWeightModifiers(runtime.final.weight, attackerMods);
    const defenderWeight = deps.applyWeightModifiers(opponent.final.weight, defenderMods);
    const perHit = deps.computeMeleeDamagePerHit(
      runtime.final,
      opponent.final,
      damageMultiplier,
      damageTakenMultiplier,
      attackerWeight,
      defenderWeight,
    );
    const cooldown = deps.currentBiteCooldown(runtime, state, true);
    const outDps = cooldown > 0 ? perHit / cooldown : 0;
    const incomingDps = estimateIncomingDps(runtime, opponent, state, opponentState);
    const regenPerSec = rageOn ? 0 : estimateRegenPerSec(runtime, state);
    return {
      outDps,
      incomingDps,
      regenPerSec,
      netDps: outDps - incomingDps + regenPerSec,
    };
  }

  function estimateNetDps(
    runtime: CombatantRuntime,
    opponent: CombatantRuntime,
    state: CombatantState,
    opponentState: CombatantState,
    rageOn: boolean,
  ): number {
    return estimateCombatRates(runtime, opponent, state, opponentState, rageOn).netDps;
  }

  function estimateSelfOutgoingDps(runtime: CombatantRuntime, state: CombatantState): number {
    const mods = deps.aggregateStatusModifiers(state.statuses);
    const dmgMult = deps.computeOutgoingDamageMultiplier(runtime, state, mods, true);
    const hit = runtime.final.damage * dmgMult;
    const cd = deps.currentBiteCooldown(runtime, state, true);
    return cd > 0 ? hit / cd : 0;
  }

  function projectPolicyWindow(
    runtime: CombatantRuntime,
    opponent: CombatantRuntime,
    state: CombatantState,
    opponentState: CombatantState,
    options?: PolicyProjectionOptions,
    abilityPolicy: AbilityTimingMode = "semiIdeal",
  ): PolicyProjectionScore {
    const { horizonSec, stepSec } = getPolicySearchConfig(abilityPolicy);
    const self = cloneStateForProjection(state);
    const enemy = cloneStateForProjection(opponentState);
    const forcedRage = options?.forcedRageOn;
    const activationDelaySec = Math.max(0, options?.activationDelaySec ?? 0);
    const forcedRageDurationSec = Math.max(0, options?.forcedRageDurationSec ?? 0);
    const snapshotWardenRageOnActivation = options?.snapshotWardenRageOnActivation === true;
    const holdWardenRageOnActivation = options?.holdWardenRageOnActivation === true;
    const effectDurationSec = Math.max(0, options?.effectDurationSec ?? 0);
    const outgoingMultiplier = Math.max(0, options?.outgoingMultiplier ?? 1);
    const incomingMultiplier = Math.max(0, options?.incomingMultiplier ?? 1);
    const lifeLeechPct = Math.max(0, options?.lifeLeechPct ?? 0);
    let storedWardenRageStacks = Math.max(0, self.wardenRageStacks);

    let activated = false;
    const applyActivation = () => {
      if (activated) return;
      if (options?.immediateSelfHpCost) self.hp = Math.max(1, self.hp - Math.max(0, options.immediateSelfHpCost));
      if (options?.immediateSelfHeal) self.hp = Math.min(runtime.final.health, self.hp + Math.max(0, options.immediateSelfHeal));
      if (options?.immediateOpponentDamage) enemy.hp = Math.max(0, enemy.hp - Math.max(0, options.immediateOpponentDamage));
      if (snapshotWardenRageOnActivation) {
        const hpRatio = self.hp / Math.max(1, runtime.final.health);
        storedWardenRageStacks = wardenRageStacksFromHpRatio(hpRatio);
      }
      activated = true;
    };

    if (activationDelaySec <= 0) applyActivation();

    if (
      !runtime.hasWardenRage &&
      !self.wardenRageOn &&
      forcedRage !== true &&
      !holdWardenRageOnActivation &&
      effectDurationSec === 0 &&
      outgoingMultiplier === 1 &&
      incomingMultiplier === 1 &&
      lifeLeechPct === 0
    ) {
      return projectStaticPolicyWindow(runtime, opponent, self, enemy, horizonSec, stepSec);
    }

    if (
      abilityPolicy === "ideal" &&
      !runtime.hasWardenRage &&
      !self.wardenRageOn &&
      forcedRage !== true &&
      !holdWardenRageOnActivation &&
      !snapshotWardenRageOnActivation &&
      lifeLeechPct > 0
    ) {
      return simulateEventAwareTimedEffectWindow(runtime, opponent, self, enemy, horizonSec, {
        activationDelaySec,
        effectDurationSec,
        outgoingMultiplier,
        incomingMultiplier,
        lifeLeechPct,
        immediateSelfHeal: options?.immediateSelfHeal,
        immediateSelfHpCost: options?.immediateSelfHpCost,
        immediateOpponentDamage: options?.immediateOpponentDamage,
      }).score;
    }

    let time = 0;
    let dealt = 0;
    let deathTimeOpponent = enemy.hp <= 0 ? 0 : Number.POSITIVE_INFINITY;
    let deathTimeSelf = self.hp <= 0 ? 0 : Number.POSITIVE_INFINITY;

    while (time < horizonSec && !Number.isFinite(deathTimeOpponent) && !Number.isFinite(deathTimeSelf)) {
      if (!activated && activationDelaySec <= time) {
        applyActivation();
      }

      const nextActivationBoundary = !activated ? activationDelaySec : Number.POSITIVE_INFINITY;
      const step = Math.min(stepSec, horizonSec - time, nextActivationBoundary - time);

      const forcedRageWindowOn =
        forcedRageDurationSec > 0 && activated && time < activationDelaySec + forcedRageDurationSec;
      const activationHoldOn = holdWardenRageOnActivation && activated && time >= activationDelaySec;
      const rageOn = forcedRage ?? (forcedRageWindowOn || activationHoldOn || self.wardenRageOn);
      const rageStacks = rageOn ? wardenRageStacksFromHpRatio(self.hp / Math.max(1, runtime.final.health)) : storedWardenRageStacks;
      const rates = estimateCombatRates(runtime, opponent, self, enemy, rageOn, rageStacks);
      const effectOn = activated && time < activationDelaySec + effectDurationSec;
      const outDps = rates.outDps * (effectOn ? outgoingMultiplier : 1);
      const incomingDps = rates.incomingDps * (effectOn ? incomingMultiplier : 1);
      const regenDps = rates.regenPerSec;
      if (rageOn) {
        storedWardenRageStacks = rageStacks;
      }
      self.wardenRageStacks = storedWardenRageStacks;

      const dealtNow = Math.max(0, outDps * step);
      dealt += dealtNow;
      enemy.hp -= dealtNow;

      if (effectOn && lifeLeechPct > 0 && dealtNow > 0) {
        const heal = Math.min(runtime.final.health - self.hp, dealtNow * lifeLeechPct);
        if (heal > 0) self.hp += heal;
      }

      self.hp = Math.min(runtime.final.health, self.hp + Math.max(0, regenDps * step));
      self.hp -= Math.max(0, incomingDps * step);
      time += step;

      if (!activated && activationDelaySec <= time) {
        applyActivation();
      }

      if (enemy.hp <= 0 && !Number.isFinite(deathTimeOpponent)) deathTimeOpponent = time;
      if (self.hp <= 0 && !Number.isFinite(deathTimeSelf)) deathTimeSelf = time;
    }

    const oppDead = Number.isFinite(deathTimeOpponent);
    const selfDead = Number.isFinite(deathTimeSelf);
    const winRank = oppDead && !selfDead ? 2 : selfDead && !oppDead ? 0 : 1;
    const ttk = winRank === 2 ? deathTimeOpponent : winRank === 0 ? deathTimeSelf : horizonSec;
    const survivalValue = Math.max(0, self.hp) * 0.2;
    return { winRank, ttk, effectiveDamage: dealt + survivalValue };
  }

  function simulateEventAwareTimedEffectWindow(
    runtime: CombatantRuntime,
    opponent: CombatantRuntime,
    state: CombatantState,
    opponentState: CombatantState,
    horizonSec: number,
    options: {
      activationDelaySec: number;
      effectDurationSec: number;
      outgoingMultiplier: number;
      incomingMultiplier: number;
      lifeLeechPct: number;
      immediateSelfHeal?: number;
      immediateSelfHpCost?: number;
      immediateOpponentDamage?: number;
    },
  ): LifeLeechProjectionResult {
    const self = cloneStateForProjection(state);
    const enemy = cloneStateForProjection(opponentState);
    const startAbsTime = state.lastUpdateAt;
    const endAbsTime = startAbsTime + horizonSec;
    const activationAbsTime = startAbsTime + Math.max(0, options.activationDelaySec);
    let activated = false;
    let time = startAbsTime;
    let dealt = 0;
    let realizedHeal = 0;
    let wastedHeal = 0;
    let rawHeal = 0;
    let activationSelfHp = self.hp;
    let deathTimeOpponent = enemy.hp <= 0 ? 0 : Number.POSITIVE_INFINITY;
    let deathTimeSelf = self.hp <= 0 ? 0 : Number.POSITIVE_INFINITY;

    const regenTickAmount = (actor: CombatantRuntime, actorState: CombatantState): number => {
      const regenPct = actor.final.healthRegen ?? 0;
      if (regenPct <= 0) return 0;
      const multiplier = deps.computeRegenMultiplier(actorState, actor);
      return (actor.final.health * regenPct * multiplier) / 100;
    };

    const hitDamage = (
      actor: CombatantRuntime,
      target: CombatantRuntime,
      actorState: CombatantState,
      targetState: CombatantState,
    ): number => {
      const attackerMods = deps.aggregateStatusModifiers(actorState.statuses);
      const defenderMods = deps.aggregateStatusModifiers(targetState.statuses);
      const damageMultiplier = deps.computeOutgoingDamageMultiplier(actor, actorState, attackerMods, true);
      const damageTakenMultiplier = deps.computeIncomingDamageMultiplier(target, targetState, defenderMods, true);
      const attackerWeight = deps.applyWeightModifiers(actor.final.weight, attackerMods);
      const defenderWeight = deps.applyWeightModifiers(target.final.weight, defenderMods);
      return deps.computeMeleeDamagePerHit(
        actor.final,
        target.final,
        damageMultiplier,
        damageTakenMultiplier,
        attackerWeight,
        defenderWeight,
      );
    };

    const applyActivation = () => {
      if (activated) return;
      activationSelfHp = self.hp;
      if (options.immediateSelfHpCost) {
        self.hp = Math.max(1, self.hp - Math.max(0, options.immediateSelfHpCost));
      }
      if (options.immediateSelfHeal) {
        self.hp = Math.min(runtime.final.health, self.hp + Math.max(0, options.immediateSelfHeal));
      }
      if (options.immediateOpponentDamage) {
        const damage = Math.max(0, options.immediateOpponentDamage);
        enemy.hp = Math.max(0, enemy.hp - damage);
        dealt += damage;
      }
      activated = true;
    };

    if (activationAbsTime <= startAbsTime) {
      applyActivation();
    }

    while (time < endAbsTime && !Number.isFinite(deathTimeOpponent) && !Number.isFinite(deathTimeSelf)) {
      const nextTime = Math.min(
        self.nextHitAt,
        enemy.nextHitAt,
        self.nextRegenAt,
        enemy.nextRegenAt,
        activated ? Number.POSITIVE_INFINITY : activationAbsTime,
        endAbsTime,
      );
      if (!Number.isFinite(nextTime)) break;
      if (nextTime <= time) {
        time += 0.001;
        continue;
      }
      time = nextTime;
      self.lastUpdateAt = time;
      enemy.lastUpdateAt = time;

      if (!activated && activationAbsTime <= time + 1e-9) {
        applyActivation();
      }

      const effectOn = activated && time < activationAbsTime + Math.max(0, options.effectDurationSec);
      const selfHits = Math.abs(self.nextHitAt - time) <= 1e-9;
      const enemyHits = Math.abs(enemy.nextHitAt - time) <= 1e-9;
      const selfRegens = Math.abs(self.nextRegenAt - time) <= 1e-9;
      const enemyRegens = Math.abs(enemy.nextRegenAt - time) <= 1e-9;

      if (selfHits) {
        const baseDamage = Math.max(0, hitDamage(runtime, opponent, self, enemy));
        const damage = effectOn ? baseDamage * options.outgoingMultiplier : baseDamage;
        enemy.hp -= damage;
        dealt += damage;
        if (effectOn && options.lifeLeechPct > 0 && damage > 0) {
          const rawHealNow = damage * options.lifeLeechPct;
          const appliedHeal = Math.min(runtime.final.health - self.hp, rawHealNow);
          if (appliedHeal > 0) {
            self.hp += appliedHeal;
            realizedHeal += appliedHeal;
          }
          rawHeal += rawHealNow;
          wastedHeal += Math.max(0, rawHealNow - Math.max(0, appliedHeal));
        }
        self.nextHitAt = time + deps.currentBiteCooldown(runtime, self, true);
      }

      if (enemyHits) {
        const baseDamage = Math.max(0, hitDamage(opponent, runtime, enemy, self));
        const damage = effectOn ? baseDamage * options.incomingMultiplier : baseDamage;
        self.hp -= damage;
        enemy.nextHitAt = time + deps.currentBiteCooldown(opponent, enemy, true);
      }

      if (selfRegens) {
        const heal = regenTickAmount(runtime, self);
        if (heal > 0) self.hp = Math.min(runtime.final.health, self.hp + heal);
        self.nextRegenAt += deps.passiveRegenTickSec;
      }
      if (enemyRegens) {
        const heal = regenTickAmount(opponent, enemy);
        if (heal > 0) enemy.hp = Math.min(opponent.final.health, enemy.hp + heal);
        enemy.nextRegenAt += deps.passiveRegenTickSec;
      }

      if (enemy.hp <= 0 && !Number.isFinite(deathTimeOpponent)) deathTimeOpponent = time - startAbsTime;
      if (self.hp <= 0 && !Number.isFinite(deathTimeSelf)) deathTimeSelf = time - startAbsTime;
    }

    const oppDead = Number.isFinite(deathTimeOpponent);
    const selfDead = Number.isFinite(deathTimeSelf);
    const winRank = oppDead && !selfDead ? 2 : selfDead && !oppDead ? 0 : 1;
    const ttk = winRank === 2 ? deathTimeOpponent : winRank === 0 ? deathTimeSelf : horizonSec;
    const projectedFightSec = ttk;
    const survivalValue = Math.max(0, self.hp) * 0.2;
    return {
      score: { winRank, ttk, effectiveDamage: dealt + survivalValue },
      activationDelaySec: Math.max(0, options.activationDelaySec),
      projectedFightSec,
      activationSelfHp,
      activationMissingHp: Math.max(0, runtime.final.health - activationSelfHp),
      realizedHeal,
      wastedHeal,
      rawHeal,
      selfHpEnd: Math.max(0, self.hp),
      opponentHpEnd: Math.max(0, enemy.hp),
      totalDamage: dealt,
    };
  }

  function projectLifeLeechWindow(
    runtime: CombatantRuntime,
    opponent: CombatantRuntime,
    state: CombatantState,
    opponentState: CombatantState,
    options:
      | {
          activationDelaySec?: number;
          effectDurationSec?: number;
          outgoingMultiplier?: number;
          incomingMultiplier?: number;
          lifeLeechPct?: number;
          immediateSelfHeal?: number;
          immediateSelfHpCost?: number;
          immediateOpponentDamage?: number;
        }
      | undefined,
    abilityPolicy: AbilityTimingMode = "ideal",
  ): LifeLeechProjectionResult {
    const { horizonSec: policyHorizonSec } = getPolicySearchConfig(abilityPolicy);
    const horizonSec = abilityPolicy === "ideal" ? Math.max(policyHorizonSec, 120) : policyHorizonSec;
    const activationDelaySec = Math.max(0, options?.activationDelaySec ?? 0);
    const effectDurationSec = Math.max(0, options?.effectDurationSec ?? 0);
    const outgoingMultiplier = Math.max(0, options?.outgoingMultiplier ?? 1);
    const incomingMultiplier = Math.max(0, options?.incomingMultiplier ?? 1);
    const lifeLeechPct = Math.max(0, options?.lifeLeechPct ?? 0);
    return simulateEventAwareTimedEffectWindow(runtime, opponent, state, opponentState, horizonSec, {
      activationDelaySec,
      effectDurationSec,
      outgoingMultiplier,
      incomingMultiplier,
      lifeLeechPct,
      immediateSelfHeal: options?.immediateSelfHeal,
      immediateSelfHpCost: options?.immediateSelfHpCost,
      immediateOpponentDamage: options?.immediateOpponentDamage,
    });
  }

  function projectPolicyCheckpoint(
    runtime: CombatantRuntime,
    opponent: CombatantRuntime,
    state: CombatantState,
    opponentState: CombatantState,
    checkpointSec: number,
    abilityPolicy: AbilityTimingMode = "semiIdeal",
  ): PolicyProjectionCheckpoint {
    const { stepSec } = getPolicySearchConfig(abilityPolicy);
    const self = cloneStateForProjection(state);
    const enemy = cloneStateForProjection(opponentState);
    let time = 0;

    while (time < checkpointSec) {
      const step = Math.min(stepSec, checkpointSec - time);
      const rates = estimateCombatRates(runtime, opponent, self, enemy, false, Math.max(0, self.wardenRageStacks));
      self.wardenRageStacks = Math.max(0, self.wardenRageStacks);
      enemy.hp -= Math.max(0, rates.outDps * step);
      self.hp = Math.min(runtime.final.health, self.hp + Math.max(0, rates.regenPerSec * step));
      self.hp -= Math.max(0, rates.incomingDps * step);
      time += step;
      if (self.hp <= 0 || enemy.hp <= 0) break;
    }

    self.lastUpdateAt = state.lastUpdateAt + checkpointSec;
    enemy.lastUpdateAt = opponentState.lastUpdateAt + checkpointSec;
    return { selfState: self, opponentState: enemy };
  }

  return {
    estimateIncomingDps,
    estimateNetDps,
    estimateSelfOutgoingDps,
    projectPolicyCheckpoint,
    projectPolicyWindow,
    projectFixedHunkerWindow,
    projectLifeLeechWindow,
  };
}
