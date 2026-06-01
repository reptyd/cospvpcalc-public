import type { AbilityTimingMode, EffectsCatalogByCreature, SpecialAbilityDef } from "./types";
import type { CombatantRuntime, CombatantState } from "./runtimeContext";
import type { LifeLeechProjectionResult } from "./policyRuntimeTypes";
import { isActivesDisabledByNecro } from "./runtimeHelpers";
import { resolveAbilityTimingModeForAbility } from "./abilityTimingOverrides";
import {
  decideTimedAbilityActivation,
  type TimedAbilityActivationDecision,
} from "./timedAbilityPolicyRuntime";

type PolicyProjectionScore = { winRank: number; ttk: number; effectiveDamage: number };

export type StateLifeLeechDeps = {
  lifeLeechDurationSec: number;
  lifeLeechCooldownSec: number;
  isAbilityDisabled: (disabled: Set<string>, abilityName: string) => boolean;
  hasAbilityName: (effects: EffectsCatalogByCreature, abilityName: string) => boolean;
  isPrecisionPolicy: (mode: AbilityTimingMode) => boolean;
  comparePolicyStateScore: (
    a: PolicyProjectionScore,
    b: PolicyProjectionScore,
  ) => number;
  markAbilityApplied: (state: CombatantState, abilityName: string, time?: number, description?: string) => void;
  policyRuntime: {
    estimateSelfOutgoingDps: (runtime: CombatantRuntime, state: CombatantState) => number;
    estimateIncomingDps: (
      runtime: CombatantRuntime,
      opponent: CombatantRuntime,
      state: CombatantState,
      opponentState: CombatantState,
    ) => number;
    scorePolicyState: (
      runtime: CombatantRuntime,
      opponent: CombatantRuntime,
      state: CombatantState,
      opponentState: CombatantState,
      rageOn: boolean,
      extraHeal: number,
      abilityPolicy: AbilityTimingMode,
    ) => PolicyProjectionScore;
    projectPolicyCheckpoint: (
      runtime: CombatantRuntime,
      opponent: CombatantRuntime,
      state: CombatantState,
      opponentState: CombatantState,
      checkpointSec: number,
      abilityPolicy: AbilityTimingMode,
    ) => { selfState: CombatantState; opponentState: CombatantState };
    projectPolicyWindow: (
      runtime: CombatantRuntime,
      opponent: CombatantRuntime,
      state: CombatantState,
      opponentState: CombatantState,
      options:
        | {
            forcedRageOn?: boolean;
            immediateSelfHeal?: number;
            immediateSelfHpCost?: number;
            immediateOpponentDamage?: number;
            effectDurationSec?: number;
            outgoingMultiplier?: number;
            incomingMultiplier?: number;
            lifeLeechPct?: number;
          }
        | undefined,
      abilityPolicy: AbilityTimingMode,
    ) => PolicyProjectionScore;
    projectLifeLeechWindow: (
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
      abilityPolicy: AbilityTimingMode,
    ) => LifeLeechProjectionResult;
  };
};

export function createStateLifeLeechRuntime(deps: StateLifeLeechDeps) {
  function isReallyFastPolicy(abilityPolicy: AbilityTimingMode): boolean {
    return abilityPolicy === "reallyFast";
  }

  function appendAbilityTimingEvent(state: CombatantState, entry: string): void {
    if (state.abilityTimingEvents.length >= 200) return;
    state.abilityTimingEvents.push(entry);
  }

  function scaleCooldown(state: CombatantState, baseSec: number): number {
    return baseSec * (state.activeCooldownMultiplier ?? 1);
  }

  function compareLifeLeechProjectionResult(
    a: LifeLeechProjectionResult,
    b: LifeLeechProjectionResult,
  ): number {
    if (a.score.winRank !== b.score.winRank) return b.score.winRank - a.score.winRank;
    const aNetHeal = a.realizedHeal - a.wastedHeal * 1.75;
    const bNetHeal = b.realizedHeal - b.wastedHeal * 1.75;
    if (Math.abs(aNetHeal - bNetHeal) > 1e-9) return bNetHeal - aNetHeal;
    const aHealEfficiency = a.rawHeal > 0 ? a.realizedHeal / a.rawHeal : 0;
    const bHealEfficiency = b.rawHeal > 0 ? b.realizedHeal / b.rawHeal : 0;
    if (Math.abs(aHealEfficiency - bHealEfficiency) > 1e-9) return bHealEfficiency - aHealEfficiency;
    if (Math.abs(a.activationMissingHp - b.activationMissingHp) > 1e-9) {
      return b.activationMissingHp - a.activationMissingHp;
    }
    if (Math.abs(a.opponentHpEnd - b.opponentHpEnd) > 1e-9) return a.opponentHpEnd - b.opponentHpEnd;
    if (a.score.ttk !== b.score.ttk) return a.score.winRank === 2 ? a.score.ttk - b.score.ttk : b.score.ttk - a.score.ttk;
    if (Math.abs(a.totalDamage - b.totalDamage) > 1e-9) return b.totalDamage - a.totalDamage;
    if (Math.abs(a.realizedHeal - b.realizedHeal) > 1e-9) return b.realizedHeal - a.realizedHeal;
    if (Math.abs(a.selfHpEnd - b.selfHpEnd) > 1e-9) return b.selfHpEnd - a.selfHpEnd;
    if (Math.abs(a.wastedHeal - b.wastedHeal) > 1e-9) return a.wastedHeal - b.wastedHeal;
    return deps.comparePolicyStateScore(a.score, b.score);
  }

  function compareLifeLeechValueAgainstKeep(
    candidate: LifeLeechProjectionResult,
    best: LifeLeechProjectionResult,
    keep: LifeLeechProjectionResult,
  ): number {
    const candidateWinDelta = candidate.score.winRank - keep.score.winRank;
    const bestWinDelta = best.score.winRank - keep.score.winRank;
    if (candidateWinDelta !== bestWinDelta) return bestWinDelta - candidateWinDelta;

    const candidateCastCount =
      candidate.projectedFightSec > candidate.activationDelaySec + 1e-9
        ? 1 + Math.floor(Math.max(0, candidate.projectedFightSec - candidate.activationDelaySec - 1e-9) / deps.lifeLeechCooldownSec)
        : 0;
    const bestCastCount =
      best.projectedFightSec > best.activationDelaySec + 1e-9
        ? 1 + Math.floor(Math.max(0, best.projectedFightSec - best.activationDelaySec - 1e-9) / deps.lifeLeechCooldownSec)
        : 0;
    if (candidateCastCount !== bestCastCount) {
      return bestCastCount - candidateCastCount;
    }

    const candidateNetHealGain =
      (candidate.realizedHeal - candidate.wastedHeal * 1.75) - (keep.realizedHeal - keep.wastedHeal * 1.75);
    const bestNetHealGain =
      (best.realizedHeal - best.wastedHeal * 1.75) - (keep.realizedHeal - keep.wastedHeal * 1.75);
    if (Math.abs(candidateNetHealGain - bestNetHealGain) > 1e-9) {
      return bestNetHealGain - candidateNetHealGain;
    }

    const candidateSelfHpGain = candidate.selfHpEnd - keep.selfHpEnd;
    const bestSelfHpGain = best.selfHpEnd - keep.selfHpEnd;
    if (Math.abs(candidateSelfHpGain - bestSelfHpGain) > 1e-9) {
      return bestSelfHpGain - candidateSelfHpGain;
    }

    const candidateHealGain = candidate.realizedHeal - keep.realizedHeal;
    const bestHealGain = best.realizedHeal - keep.realizedHeal;
    if (Math.abs(candidateHealGain - bestHealGain) > 1e-9) {
      return bestHealGain - candidateHealGain;
    }

    const candidateWastedHeal = candidate.wastedHeal - keep.wastedHeal;
    const bestWastedHeal = best.wastedHeal - keep.wastedHeal;
    if (Math.abs(candidateWastedHeal - bestWastedHeal) > 1e-9) {
      return candidateWastedHeal - bestWastedHeal;
    }

    if (Math.abs(candidate.activationMissingHp - best.activationMissingHp) > 1e-9) {
      return best.activationMissingHp - candidate.activationMissingHp;
    }

    const candidateOpponentHpGain = keep.opponentHpEnd - candidate.opponentHpEnd;
    const bestOpponentHpGain = keep.opponentHpEnd - best.opponentHpEnd;
    if (Math.abs(candidateOpponentHpGain - bestOpponentHpGain) > 1e-9) {
      return bestOpponentHpGain - candidateOpponentHpGain;
    }

    const candidateDamageGain = candidate.totalDamage - keep.totalDamage;
    const bestDamageGain = best.totalDamage - keep.totalDamage;
    if (Math.abs(candidateDamageGain - bestDamageGain) > 1e-9) {
      return bestDamageGain - candidateDamageGain;
    }

    return compareLifeLeechProjectionResult(candidate, best);
  }

  function shouldKeepExistingLifeLeechPlan(
    currentPlan: LifeLeechProjectionResult,
    candidatePlan: LifeLeechProjectionResult,
  ): boolean {
    if (candidatePlan.score.winRank > currentPlan.score.winRank) return false;
    if (candidatePlan.score.winRank < currentPlan.score.winRank) return true;

    const currentCastCount =
      currentPlan.projectedFightSec > currentPlan.activationDelaySec + 1e-9
        ? 1 + Math.floor(Math.max(0, currentPlan.projectedFightSec - currentPlan.activationDelaySec - 1e-9) / deps.lifeLeechCooldownSec)
        : 0;
    const candidateCastCount =
      candidatePlan.projectedFightSec > candidatePlan.activationDelaySec + 1e-9
        ? 1 + Math.floor(Math.max(0, candidatePlan.projectedFightSec - candidatePlan.activationDelaySec - 1e-9) / deps.lifeLeechCooldownSec)
        : 0;
    if (candidateCastCount > currentCastCount) return false;
    if (candidateCastCount < currentCastCount) return true;

    const currentNetHeal = currentPlan.realizedHeal - currentPlan.wastedHeal * 1.75;
    const candidateNetHeal = candidatePlan.realizedHeal - candidatePlan.wastedHeal * 1.75;
    if (candidateNetHeal > currentNetHeal + 90) return false;
    if (candidatePlan.opponentHpEnd + 90 < currentPlan.opponentHpEnd) return false;
    if (candidatePlan.selfHpEnd > currentPlan.selfHpEnd + 90) return false;

    if (compareLifeLeechProjectionResult(candidatePlan, currentPlan) < 0) return false;

    return true;
  }

  function isLifeLeechMeaningfullyBetterThanKeep(
    candidate: LifeLeechProjectionResult,
    keep: LifeLeechProjectionResult,
  ): boolean {
    if (candidate.score.winRank !== keep.score.winRank) {
      return candidate.score.winRank > keep.score.winRank;
    }
    const candidateNetHeal = candidate.realizedHeal - candidate.wastedHeal * 1.75;
    const keepNetHeal = keep.realizedHeal - keep.wastedHeal * 1.75;
    if (candidateNetHeal > keepNetHeal + 60) return true;
    if (candidate.selfHpEnd > keep.selfHpEnd + 25) return true;
    if (candidate.realizedHeal > keep.realizedHeal + 25) return true;
    if (candidate.wastedHeal + 25 < keep.wastedHeal) return true;
    if (candidate.opponentHpEnd + 50 < keep.opponentHpEnd) return true;
    if (candidate.totalDamage > keep.totalDamage + 50) return true;
    return compareLifeLeechProjectionResult(candidate, keep) < 0;
  }

  function areLifeLeechOutcomesPracticallyEquivalent(
    left: LifeLeechProjectionResult,
    right: LifeLeechProjectionResult,
  ): boolean {
    if (left.score.winRank !== right.score.winRank) return false;
    const hpTolerance = Math.max(60, Math.max(left.selfHpEnd, right.selfHpEnd, left.opponentHpEnd, right.opponentHpEnd) * 0.01);
    const healTolerance = Math.max(75, Math.max(left.realizedHeal, right.realizedHeal) * 0.1);
    const ttkToleranceSec = left.score.winRank === 2 ? 0.5 : 0.75;
    return (
      Math.abs(left.selfHpEnd - right.selfHpEnd) <= hpTolerance &&
      Math.abs(left.realizedHeal - right.realizedHeal) <= healTolerance &&
      Math.abs(left.wastedHeal - right.wastedHeal) <= healTolerance &&
      Math.abs(left.activationMissingHp - right.activationMissingHp) <= Math.max(120, healTolerance) &&
      Math.abs(left.opponentHpEnd - right.opponentHpEnd) <= hpTolerance &&
      Math.abs(left.totalDamage - right.totalDamage) <= hpTolerance &&
      Math.abs(left.score.ttk - right.score.ttk) <= ttkToleranceSec
    );
  }

  function areLifeLeechValuesPracticallyEquivalent(
    left: LifeLeechProjectionResult,
    right: LifeLeechProjectionResult,
    keep: LifeLeechProjectionResult,
  ): boolean {
    const leftWinDelta = left.score.winRank - keep.score.winRank;
    const rightWinDelta = right.score.winRank - keep.score.winRank;
    if (leftWinDelta !== rightWinDelta) return false;

    const leftSelfHpGain = left.selfHpEnd - keep.selfHpEnd;
    const rightSelfHpGain = right.selfHpEnd - keep.selfHpEnd;
    const leftHealGain = left.realizedHeal - keep.realizedHeal;
    const rightHealGain = right.realizedHeal - keep.realizedHeal;
    const leftWasted = left.wastedHeal - keep.wastedHeal;
    const rightWasted = right.wastedHeal - keep.wastedHeal;
    const leftOpponentGain = keep.opponentHpEnd - left.opponentHpEnd;
    const rightOpponentGain = keep.opponentHpEnd - right.opponentHpEnd;

    return (
      Math.abs(leftSelfHpGain - rightSelfHpGain) <= 180 &&
      Math.abs(leftHealGain - rightHealGain) <= 180 &&
      Math.abs(leftWasted - rightWasted) <= 120 &&
      Math.abs(left.activationMissingHp - right.activationMissingHp) <= 120 &&
      Math.abs(leftOpponentGain - rightOpponentGain) <= 180
    );
  }

  function getLifeLeechValue(runtime: CombatantRuntime): number {
    const value = runtime.abilityValueByName["Life Leech"];
    return typeof value === "number" ? value : 0;
  }

  function shouldActivateLifeLeech(
    runtime: CombatantRuntime,
    opponent: CombatantRuntime,
    state: CombatantState,
    opponentState: CombatantState,
    leechValue: number,
  ): boolean {
    const maxHp = Math.max(1, runtime.final.health);
    const hpRatio = state.hp / maxHp;
    const missingHp = Math.max(0, maxHp - state.hp);
    if (missingHp <= 0) return false;

    const outDps = deps.policyRuntime.estimateSelfOutgoingDps(runtime, state);
    const burstHeal = outDps * deps.lifeLeechDurationSec * leechValue;
    const inDps = deps.policyRuntime.estimateIncomingDps(runtime, opponent, state, opponentState);

    const berserk = runtime.specialDefs.find(
      (def): def is Extract<SpecialAbilityDef, { type: "conditionalMultiStat" }> => def.type === "conditionalMultiStat",
    );
    const berserkActive =
      !!berserk &&
      ((berserk.trigger.hpRatioLt != null && hpRatio < berserk.trigger.hpRatioLt) ||
        (berserk.trigger.hpRatioLte != null && hpRatio <= berserk.trigger.hpRatioLte));

    if (hpRatio <= 0.35) return burstHeal > 0;
    if (berserkActive && burstHeal > missingHp * 0.2) return true;
    if (inDps > 0 && state.hp / inDps <= deps.lifeLeechDurationSec * 1.5) return burstHeal > missingHp * 0.25;
    return burstHeal >= missingHp * 0.5;
  }

  function decideLifeLeechBySearch(
    runtime: CombatantRuntime,
    opponent: CombatantRuntime,
    state: CombatantState,
    opponentState: CombatantState,
    leechValue: number,
    abilityPolicy: AbilityTimingMode,
  ): TimedAbilityActivationDecision | null {
    const maxHp = Math.max(1, runtime.final.health);
    const missingHp = Math.max(0, maxHp - state.hp);
    if (missingHp <= 0) return null;
    const extraActivationDelayCandidates: number[] = [];
    const decision = decideTimedAbilityActivation(
      { projectPolicyWindow: deps.policyRuntime.projectPolicyWindow },
      runtime,
      opponent,
      state,
      opponentState,
      abilityPolicy,
      (activationDelaySec) => ({
        activationDelaySec,
        forcedRageOn: state.wardenRageOn,
        effectDurationSec: deps.lifeLeechDurationSec,
        lifeLeechPct: Math.max(0, leechValue),
      }),
      { abilityName: "Life Leech", time: state.lastUpdateAt, onDecision: (entry) => appendAbilityTimingEvent(state, entry) },
      { extraActivationDelayCandidates },
    );
    if (abilityPolicy !== "ideal") return decision;
    const keepProjection = deps.policyRuntime.projectLifeLeechWindow(
      runtime,
      opponent,
      state,
      opponentState,
      undefined,
      abilityPolicy,
    );
    let bestCandidate: {
      activationDelaySec: number;
      score: PolicyProjectionScore;
      projection: LifeLeechProjectionResult;
    } | null = null;
    for (const candidate of decision.candidates) {
      const projection = deps.policyRuntime.projectLifeLeechWindow(
        runtime,
        opponent,
        state,
        opponentState,
        {
          activationDelaySec: candidate.activationDelaySec,
          effectDurationSec: deps.lifeLeechDurationSec,
          lifeLeechPct: Math.max(0, leechValue),
        },
        abilityPolicy,
      );
      if (!isLifeLeechMeaningfullyBetterThanKeep(projection, keepProjection)) continue;
      if (!bestCandidate || compareLifeLeechValueAgainstKeep(projection, bestCandidate.projection, keepProjection) < 0) {
        bestCandidate = { activationDelaySec: candidate.activationDelaySec, score: candidate.score, projection };
      }
    }
    if (!bestCandidate) return { ...decision, shouldActivate: false, chosenDelaySec: null, bestScore: decision.keepScore };
    const earliestCompetitive = decision.candidates.find((candidate) => {
      const projection = deps.policyRuntime.projectLifeLeechWindow(
        runtime,
        opponent,
        state,
        opponentState,
        {
          activationDelaySec: candidate.activationDelaySec,
          effectDurationSec: deps.lifeLeechDurationSec,
          lifeLeechPct: Math.max(0, leechValue),
        },
        abilityPolicy,
      );
      return (
        isLifeLeechMeaningfullyBetterThanKeep(projection, keepProjection) &&
        areLifeLeechOutcomesPracticallyEquivalent(projection, bestCandidate.projection)
      );
    });
    const immediateCandidate = decision.candidates.find((candidate) => candidate.activationDelaySec === 0);
    const immediateProjection =
      immediateCandidate == null
        ? null
        : deps.policyRuntime.projectLifeLeechWindow(
            runtime,
            opponent,
            state,
            opponentState,
            {
              activationDelaySec: 0,
              effectDurationSec: deps.lifeLeechDurationSec,
              lifeLeechPct: Math.max(0, leechValue),
            },
            abilityPolicy,
          );

    let preferredDelaySec = earliestCompetitive?.activationDelaySec ?? bestCandidate.activationDelaySec;
    if (
      immediateCandidate != null &&
      immediateProjection != null &&
      isLifeLeechMeaningfullyBetterThanKeep(immediateProjection, keepProjection) &&
      areLifeLeechValuesPracticallyEquivalent(immediateProjection, bestCandidate.projection, keepProjection)
    ) {
      preferredDelaySec = 0;
    }
    if (state.lifeLeechPlannedAt > state.lastUpdateAt + 1e-9) {
      const existingDelaySec = state.lifeLeechPlannedAt - state.lastUpdateAt;
      if (existingDelaySec > preferredDelaySec + 1e-9) {
        const existingProjection = deps.policyRuntime.projectLifeLeechWindow(
          runtime,
          opponent,
          state,
          opponentState,
          {
            activationDelaySec: existingDelaySec,
            effectDurationSec: deps.lifeLeechDurationSec,
            lifeLeechPct: Math.max(0, leechValue),
          },
          abilityPolicy,
        );
        if (
          isLifeLeechMeaningfullyBetterThanKeep(existingProjection, keepProjection) &&
          shouldKeepExistingLifeLeechPlan(existingProjection, bestCandidate.projection)
        ) {
          preferredDelaySec = existingDelaySec;
        }
      }
    }
    if (decision.chosenDelaySec == null || Math.abs(preferredDelaySec - decision.chosenDelaySec) > 1e-9) {
      appendAbilityTimingEvent(
        state,
        `[Life Leech] t=${state.lastUpdateAt.toFixed(2)} mode=ideal value-first preferred=${preferredDelaySec.toFixed(2)} over=${decision.chosenDelaySec == null ? "skip" : decision.chosenDelaySec.toFixed(2)} keepHpA=${keepProjection.opponentHpEnd.toFixed(2)} keepHpB=${keepProjection.selfHpEnd.toFixed(2)} heal=${bestCandidate.projection.realizedHeal.toFixed(2)}`,
      );
    }
    return {
      ...decision,
      shouldActivate: true,
      chosenDelaySec: preferredDelaySec,
      bestScore:
        preferredDelaySec === bestCandidate.activationDelaySec
          ? bestCandidate.score
          : (decision.candidates.find((candidate) => candidate.activationDelaySec === preferredDelaySec)?.score ?? bestCandidate.score),
    };
  }

  function shouldSnapLifeLeechNow(
    decision: TimedAbilityActivationDecision,
    heuristicActivateNow: boolean,
    abilityPolicy: AbilityTimingMode,
  ): boolean {
    if (!heuristicActivateNow) return false;
    const chosenDelaySec = decision.chosenDelaySec ?? Number.POSITIVE_INFINITY;
    if (!(chosenDelaySec > 1e-9)) return false;
    if (abilityPolicy === "ideal" && chosenDelaySec > 0.5) return false;
    const immediate = decision.candidates.find((candidate) => candidate.activationDelaySec === 0);
    if (!immediate) return false;
    const bestScore = decision.bestScore;
    if (deps.comparePolicyStateScore(immediate.score, decision.keepScore) >= 0) return false;
    if (immediate.score.winRank !== bestScore.winRank) return false;
    const ttkToleranceSec = bestScore.winRank === 2 ? 0.5 : 1;
    if (Math.abs(immediate.score.ttk - bestScore.ttk) > ttkToleranceSec) return false;
    return immediate.score.effectiveDamage >= bestScore.effectiveDamage * 0.985;
  }

  function updateLifeLeech(
    time: number,
    runtime: CombatantRuntime,
    opponent: CombatantRuntime,
    state: CombatantState,
    opponentState: CombatantState,
    activesOn: boolean,
    abilityPolicy: AbilityTimingMode,
    disabled: Set<string>,
  ): void {
    const effectiveAbilityPolicy = resolveAbilityTimingModeForAbility("Life Leech", abilityPolicy, state.abilityPolicyOverrides);
    if (!activesOn || deps.isAbilityDisabled(disabled, "Life Leech") || isActivesDisabledByNecro(state)) {
      state.lifeLeechPlannedAt = 0;
      return;
    }
    const leechValue = getLifeLeechValue(runtime);
    if (leechValue <= 0) {
      state.lifeLeechPlannedAt = 0;
      return;
    }
    if (time < state.lifeLeechCooldownUntil || time < state.lifeLeechActiveUntil) {
      state.lifeLeechPlannedAt = 0;
      return;
    }
    if (effectiveAbilityPolicy !== "ideal" && state.lifeLeechPlannedAt > time + 1e-9) {
      return;
    }
    if (state.lifeLeechPlannedAt > 0 && time + 1e-9 >= state.lifeLeechPlannedAt) {
      state.lifeLeechPlannedAt = 0;
      state.lifeLeechActiveUntil = time + deps.lifeLeechDurationSec;
      state.lifeLeechCooldownUntil = time + scaleCooldown(state, deps.lifeLeechCooldownSec);
      deps.markAbilityApplied(state, "Life Leech", time);
      return;
    }

    if (isReallyFastPolicy(effectiveAbilityPolicy)) {
      state.lifeLeechPlannedAt = 0;
      const hpRatio = state.hp / Math.max(1, runtime.final.health);
      if (hpRatio >= 0.85) return;
      state.lifeLeechActiveUntil = time + deps.lifeLeechDurationSec;
      state.lifeLeechCooldownUntil = time + scaleCooldown(state, deps.lifeLeechCooldownSec);
      deps.markAbilityApplied(state, "Life Leech", time);
      return;
    }

    if (!deps.isPrecisionPolicy(effectiveAbilityPolicy)) {
      state.lifeLeechPlannedAt = 0;
      if (!shouldActivateLifeLeech(runtime, opponent, state, opponentState, leechValue)) return;
      state.lifeLeechActiveUntil = time + deps.lifeLeechDurationSec;
      state.lifeLeechCooldownUntil = time + scaleCooldown(state, deps.lifeLeechCooldownSec);
      deps.markAbilityApplied(state, "Life Leech", time);
      return;
    }

    const decision = decideLifeLeechBySearch(runtime, opponent, state, opponentState, leechValue, effectiveAbilityPolicy);
    if (!decision?.shouldActivate) {
      state.lifeLeechPlannedAt = 0;
      return;
    }
    const chosenDelaySec = decision.chosenDelaySec ?? Number.POSITIVE_INFINITY;
    const heuristicActivateNow = shouldActivateLifeLeech(runtime, opponent, state, opponentState, leechValue);
    if (shouldSnapLifeLeechNow(decision, heuristicActivateNow, effectiveAbilityPolicy)) {
      appendAbilityTimingEvent(
        state,
        `[Life Leech] t=${time.toFixed(2)} mode=${effectiveAbilityPolicy} practical-snap-now delay=${chosenDelaySec.toFixed(2)}`,
      );
      state.lifeLeechPlannedAt = 0;
      state.lifeLeechActiveUntil = time + deps.lifeLeechDurationSec;
      state.lifeLeechCooldownUntil = time + scaleCooldown(state, deps.lifeLeechCooldownSec);
      deps.markAbilityApplied(state, "Life Leech", time);
      return;
    }
    if (chosenDelaySec > 1e-9) {
      const plannedAt = time + chosenDelaySec;
      if (Math.abs(state.lifeLeechPlannedAt - plannedAt) > 1e-9) {
        appendAbilityTimingEvent(
          state,
          `[Life Leech] t=${time.toFixed(2)} mode=${effectiveAbilityPolicy} schedule=${plannedAt.toFixed(2)} delay=${chosenDelaySec.toFixed(2)}`,
        );
      }
      state.lifeLeechPlannedAt = plannedAt;
      return;
    }
    state.lifeLeechPlannedAt = 0;
    state.lifeLeechActiveUntil = time + deps.lifeLeechDurationSec;
    state.lifeLeechCooldownUntil = time + scaleCooldown(state, deps.lifeLeechCooldownSec);
    deps.markAbilityApplied(state, "Life Leech", time);
  }

  return {
    updateLifeLeech,
  };
}
