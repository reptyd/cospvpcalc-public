import type { AbilityTimingMode } from "./types";
import type { CombatantRuntime, CombatantState } from "./runtimeContext";
import { comparePolicyStateScore, cloneStateForProjection } from "./combatPrimitives";
import { createPolicyProjectionMath } from "./policyProjectionMath";
import type { PolicyDeps } from "./policyRuntimeTypes";
import {
  decideTimedAbilityActivation,
  decideTimedAbilityStateTransform,
  type TimedAbilityActivationDecision,
} from "./timedAbilityPolicyRuntime";

export function createPolicyProjectionRuntime(deps: PolicyDeps) {
  const projectionMath = createPolicyProjectionMath(deps);
  const {
    estimateIncomingDps,
    estimateNetDps,
    estimateSelfOutgoingDps,
    projectPolicyCheckpoint,
    projectPolicyWindow,
    projectFixedHunkerWindow,
    projectLifeLeechWindow,
  } = projectionMath;

  function appendAbilityTimingEvent(state: CombatantState, entry: string): void {
    if (state.abilityTimingEvents.length >= 200) return;
    state.abilityTimingEvents.push(entry);
  }

  function getDueNowSelfHitFollowUpDelaySec(
    runtime: CombatantRuntime,
    state: CombatantState,
    decisionTimeSec: number,
  ): number[] {
    if (!Number.isFinite(decisionTimeSec)) return [];
    if (state.nextHitAt > decisionTimeSec + 1e-9) return [];
    const followUpDelaySec = deps.currentBiteCooldown(runtime, state, true);
    if (!Number.isFinite(followUpDelaySec) || followUpDelaySec <= 1e-9) return [];
    return [Number(followUpDelaySec.toFixed(2))];
  }

  function shouldSnapImmediateLosingBurst(
    keepScore: { winRank: number; ttk: number; effectiveDamage: number },
    immediateScore: { winRank: number; ttk: number; effectiveDamage: number } | undefined,
  ): boolean {
    if (!immediateScore) return false;
    return (
      keepScore.winRank === 0 &&
      immediateScore.winRank === 0 &&
      immediateScore.effectiveDamage >= keepScore.effectiveDamage * 1.1
    );
  }

  function findBestReachableDelayedCandidate(
    runtime: CombatantRuntime,
    opponent: CombatantRuntime,
    state: CombatantState,
    opponentState: CombatantState,
    decision: TimedAbilityActivationDecision,
    abilityPolicy: AbilityTimingMode,
  ): { activationDelaySec: number; score: { winRank: number; ttk: number; effectiveDamage: number } } | null {
    let bestCandidate: { activationDelaySec: number; score: { winRank: number; ttk: number; effectiveDamage: number } } | null = null;

    for (const candidate of decision.candidates) {
      if (!(candidate.activationDelaySec > 1e-9) || !Number.isFinite(candidate.activationDelaySec)) continue;
      if (comparePolicyStateScore(candidate.score, decision.keepScore) >= 0) continue;
      const checkpoint = projectPolicyCheckpoint(
        runtime,
        opponent,
        state,
        opponentState,
        candidate.activationDelaySec,
        abilityPolicy,
      );
      if (checkpoint.selfState.hp <= 0) continue;
      if (!bestCandidate || comparePolicyStateScore(candidate.score, bestCandidate.score) < 0) {
        bestCandidate = candidate;
      }
    }

    if (!bestCandidate) return null;
    for (const candidate of decision.candidates) {
      if (!(candidate.activationDelaySec > 1e-9) || candidate.activationDelaySec >= bestCandidate.activationDelaySec) continue;
      if (comparePolicyStateScore(candidate.score, bestCandidate.score) === 0) {
        const checkpoint = projectPolicyCheckpoint(
          runtime,
          opponent,
          state,
          opponentState,
          candidate.activationDelaySec,
          abilityPolicy,
        );
        if (checkpoint.selfState.hp > 0) {
          bestCandidate = candidate;
        }
      }
    }

    return bestCandidate;
  }

  function scorePolicyState(
    runtime: CombatantRuntime,
    opponent: CombatantRuntime,
    state: CombatantState,
    opponentState: CombatantState,
    rageOn: boolean,
    extraHeal: number,
    abilityPolicy: AbilityTimingMode,
  ) {
    return projectPolicyWindow(
      runtime,
      opponent,
      state,
      opponentState,
      { forcedRageOn: rageOn, immediateSelfHeal: Math.max(0, extraHeal) },
      abilityPolicy,
    );
  }

  function shouldActivateFrostNovaBySearch(
    runtime: CombatantRuntime,
    opponent: CombatantRuntime,
    state: CombatantState,
    opponentState: CombatantState,
    damage: number,
    abilityPolicy: AbilityTimingMode,
  ): boolean {
    const decision = decideTimedAbilityActivation(
      { projectPolicyWindow },
      runtime,
      opponent,
      state,
      opponentState,
      abilityPolicy,
      (activationDelaySec) => ({
        activationDelaySec,
        immediateOpponentDamage: Math.max(0, damage),
      }),
      { abilityName: "Frost Nova", time: state.lastUpdateAt, onDecision: (entry) => appendAbilityTimingEvent(state, entry) },
    );
    return decision.shouldActivate && (decision.chosenDelaySec ?? Number.POSITIVE_INFINITY) <= 0;
  }

  function decideHuntersCurseActivationBySearch(
    runtime: CombatantRuntime,
    opponent: CombatantRuntime,
    state: CombatantState,
    opponentState: CombatantState,
    abilityPolicy: AbilityTimingMode,
  ): TimedAbilityActivationDecision {
    const decision = decideTimedAbilityActivation(
      { projectPolicyWindow },
      runtime,
      opponent,
      state,
      opponentState,
      abilityPolicy,
      (activationDelaySec) => ({
        activationDelaySec,
        immediateSelfHpCost: runtime.final.health * 0.5,
        effectDurationSec: deps.huntersCurseDurationSec,
        outgoingMultiplier: 2,
      }),
      { abilityName: "Hunters Curse", time: state.lastUpdateAt, onDecision: (entry) => appendAbilityTimingEvent(state, entry) },
    );
    const chosenDelaySec = decision.chosenDelaySec ?? Number.POSITIVE_INFINITY;
    if (chosenDelaySec > 1e-9 && Number.isFinite(chosenDelaySec)) {
      const checkpoint = projectPolicyCheckpoint(runtime, opponent, state, opponentState, chosenDelaySec, abilityPolicy);
      if (checkpoint.selfState.hp <= 0) {
        const reachableDelayed = abilityPolicy === "ideal" || abilityPolicy === "extreme"
          ? findBestReachableDelayedCandidate(
              runtime,
              opponent,
              state,
              opponentState,
              decision,
              abilityPolicy,
            )
          : null;
        if (reachableDelayed) {
          appendAbilityTimingEvent(
            state,
            `[Hunters Curse] t=${state.lastUpdateAt.toFixed(2)} mode=${abilityPolicy} dead-before-delay reroute=${reachableDelayed.activationDelaySec.toFixed(2)} from=${chosenDelaySec.toFixed(2)}`,
          );
          return {
            ...decision,
            chosenDelaySec: reachableDelayed.activationDelaySec,
            bestScore: reachableDelayed.score,
          };
        }
        const immediate = decision.candidates.find((candidate) => candidate.activationDelaySec === 0);
        if (
          immediate &&
          (
            comparePolicyStateScore(immediate.score, decision.keepScore) < 0 ||
            shouldSnapImmediateLosingBurst(decision.keepScore, immediate.score)
          )
        ) {
          appendAbilityTimingEvent(
            state,
            `[Hunters Curse] t=${state.lastUpdateAt.toFixed(2)} mode=${abilityPolicy} dead-before-delay snap-now delay=${chosenDelaySec.toFixed(2)}`,
          );
          return {
            ...decision,
            chosenDelaySec: 0,
            bestScore: immediate.score,
          };
        }
        appendAbilityTimingEvent(
          state,
          `[Hunters Curse] t=${state.lastUpdateAt.toFixed(2)} mode=${abilityPolicy} dead-before-delay skip delay=${chosenDelaySec.toFixed(2)}`,
        );
        return {
          ...decision,
          shouldActivate: false,
          chosenDelaySec: null,
          bestScore: decision.keepScore,
        };
      }
    }
    return decision;
  }

  function shouldActivateHuntersCurseBySearch(
    runtime: CombatantRuntime,
    opponent: CombatantRuntime,
    state: CombatantState,
    opponentState: CombatantState,
    abilityPolicy: AbilityTimingMode,
  ): boolean {
    const decision = decideHuntersCurseActivationBySearch(runtime, opponent, state, opponentState, abilityPolicy);
    return decision.shouldActivate && (decision.chosenDelaySec ?? Number.POSITIVE_INFINITY) <= 0;
  }

  function decideUnbridledRageActivationBySearch(
    runtime: CombatantRuntime,
    opponent: CombatantRuntime,
    state: CombatantState,
    opponentState: CombatantState,
    abilityPolicy: AbilityTimingMode,
  ): TimedAbilityActivationDecision {
    const decision = decideTimedAbilityActivation(
      { projectPolicyWindow },
      runtime,
      opponent,
      state,
      opponentState,
      abilityPolicy,
      (activationDelaySec) => ({
        activationDelaySec,
        effectDurationSec: deps.unbridledRageDurationSec,
        outgoingMultiplier: 1.3,
      }),
      {
        abilityName: "Unbridled Rage",
        time: state.lastUpdateAt,
        onDecision: (entry) => appendAbilityTimingEvent(state, entry),
      },
    );
    const chosenDelaySec = decision.chosenDelaySec ?? Number.POSITIVE_INFINITY;
    if (chosenDelaySec > 1e-9 && Number.isFinite(chosenDelaySec)) {
      const checkpoint = projectPolicyCheckpoint(runtime, opponent, state, opponentState, chosenDelaySec, abilityPolicy);
      if (checkpoint.selfState.hp <= 0) {
        const reachableDelayed = abilityPolicy === "ideal" || abilityPolicy === "extreme"
          ? findBestReachableDelayedCandidate(
              runtime,
              opponent,
              state,
              opponentState,
              decision,
              abilityPolicy,
            )
          : null;
        if (reachableDelayed) {
          appendAbilityTimingEvent(
            state,
            `[Unbridled Rage] t=${state.lastUpdateAt.toFixed(2)} mode=${abilityPolicy} dead-before-delay reroute=${reachableDelayed.activationDelaySec.toFixed(2)} from=${chosenDelaySec.toFixed(2)}`,
          );
          return {
            ...decision,
            chosenDelaySec: reachableDelayed.activationDelaySec,
            bestScore: reachableDelayed.score,
          };
        }
        const immediate = decision.candidates.find((candidate) => candidate.activationDelaySec === 0);
        if (immediate && comparePolicyStateScore(immediate.score, decision.keepScore) < 0) {
          appendAbilityTimingEvent(
            state,
            `[Unbridled Rage] t=${state.lastUpdateAt.toFixed(2)} mode=${abilityPolicy} dead-before-delay snap-now delay=${chosenDelaySec.toFixed(2)}`,
          );
          return {
            ...decision,
            chosenDelaySec: 0,
            bestScore: immediate.score,
          };
        }
        appendAbilityTimingEvent(
          state,
          `[Unbridled Rage] t=${state.lastUpdateAt.toFixed(2)} mode=${abilityPolicy} dead-before-delay skip delay=${chosenDelaySec.toFixed(2)}`,
        );
        return {
          ...decision,
          shouldActivate: false,
          chosenDelaySec: null,
          bestScore: decision.keepScore,
        };
      }
    }
    return decision;
  }

  function shouldActivateUnbridledRageBySearch(
    runtime: CombatantRuntime,
    opponent: CombatantRuntime,
    state: CombatantState,
    opponentState: CombatantState,
    abilityPolicy: AbilityTimingMode,
  ): boolean {
    const decision = decideUnbridledRageActivationBySearch(runtime, opponent, state, opponentState, abilityPolicy);
    return decision.shouldActivate && (decision.chosenDelaySec ?? Number.POSITIVE_INFINITY) <= 0;
  }

  function shouldActivateFortifyBySearch(
    runtime: CombatantRuntime,
    opponent: CombatantRuntime,
    state: CombatantState,
    opponentState: CombatantState,
    removable: string[],
    abilityPolicy: AbilityTimingMode,
  ): boolean {
    if (removable.length === 0) return false;
    const projectedKeep = projectPolicyWindow(runtime, opponent, state, opponentState, undefined, abilityPolicy);
    const cleanedState = cloneStateForProjection(state);
    for (const statusId of removable) delete cleanedState.statuses[statusId];
    const projectedClean = projectPolicyWindow(runtime, opponent, cleanedState, opponentState, undefined, abilityPolicy);
    return decideTimedAbilityStateTransform(projectedKeep, projectedClean, {
      abilityName: "Fortify",
      time: state.lastUpdateAt,
      onDecision: (entry) => appendAbilityTimingEvent(state, entry),
    }).shouldTransform;
  }

  function shouldActivateReflectBySearch(
    runtime: CombatantRuntime,
    opponent: CombatantRuntime,
    state: CombatantState,
    opponentState: CombatantState,
    abilityPolicy: AbilityTimingMode,
  ): boolean {
    const decision = decideTimedAbilityActivation(
      { projectPolicyWindow },
      runtime,
      opponent,
      state,
      opponentState,
      abilityPolicy,
      (activationDelaySec) => ({
        activationDelaySec,
        effectDurationSec: deps.reflectDurationSec,
        incomingMultiplier: 0,
      }),
      { abilityName: "Reflect", time: state.lastUpdateAt, onDecision: (entry) => appendAbilityTimingEvent(state, entry) },
    );
    return decision.shouldActivate && (decision.chosenDelaySec ?? Number.POSITIVE_INFINITY) <= 0;
  }

  function decideAdrenalineActivationBySearch(
    runtime: CombatantRuntime,
    opponent: CombatantRuntime,
    state: CombatantState,
    opponentState: CombatantState,
    abilityPolicy: AbilityTimingMode,
    decisionTimeSec = state.lastUpdateAt,
  ): TimedAbilityActivationDecision {
    const decision = decideTimedAbilityActivation(
      { projectPolicyWindow },
      runtime,
      opponent,
      state,
      opponentState,
      abilityPolicy,
      (activationDelaySec) => ({
        activationDelaySec,
        effectDurationSec: deps.adrenalineDurationSec,
        outgoingMultiplier: 1.2,
      }),
      { abilityName: "Adrenaline", time: decisionTimeSec, onDecision: (entry) => appendAbilityTimingEvent(state, entry) },
      {
        currentTimeSec: decisionTimeSec,
        extraActivationDelayCandidates: getDueNowSelfHitFollowUpDelaySec(runtime, state, decisionTimeSec),
      },
    );
    const chosenDelaySec = decision.chosenDelaySec ?? Number.POSITIVE_INFINITY;
    if (chosenDelaySec > 1e-9 && Number.isFinite(chosenDelaySec)) {
      const checkpoint = projectPolicyCheckpoint(runtime, opponent, state, opponentState, chosenDelaySec, abilityPolicy);
      if (checkpoint.selfState.hp <= 0) {
        const reachableDelayed = abilityPolicy === "ideal" || abilityPolicy === "extreme"
          ? findBestReachableDelayedCandidate(
              runtime,
              opponent,
              state,
              opponentState,
              decision,
              abilityPolicy,
            )
          : null;
        if (reachableDelayed) {
          appendAbilityTimingEvent(
            state,
            `[Adrenaline] t=${decisionTimeSec.toFixed(2)} mode=${abilityPolicy} dead-before-delay reroute=${reachableDelayed.activationDelaySec.toFixed(2)} from=${chosenDelaySec.toFixed(2)}`,
          );
          return {
            ...decision,
            chosenDelaySec: reachableDelayed.activationDelaySec,
            bestScore: reachableDelayed.score,
          };
        }
        const immediate = decision.candidates.find((candidate) => candidate.activationDelaySec === 0);
        if (immediate && comparePolicyStateScore(immediate.score, decision.keepScore) < 0) {
          appendAbilityTimingEvent(
            state,
            `[Adrenaline] t=${decisionTimeSec.toFixed(2)} mode=${abilityPolicy} dead-before-delay snap-now delay=${chosenDelaySec.toFixed(2)}`,
          );
          return {
            ...decision,
            chosenDelaySec: 0,
            bestScore: immediate.score,
          };
        }
        appendAbilityTimingEvent(
          state,
          `[Adrenaline] t=${decisionTimeSec.toFixed(2)} mode=${abilityPolicy} dead-before-delay skip delay=${chosenDelaySec.toFixed(2)}`,
        );
        return {
          ...decision,
          shouldActivate: false,
          chosenDelaySec: null,
          bestScore: decision.keepScore,
        };
      }
    }
    return decision;
  }

  function shouldActivateAdrenalineBySearch(
    runtime: CombatantRuntime,
    opponent: CombatantRuntime,
    state: CombatantState,
    opponentState: CombatantState,
    abilityPolicy: AbilityTimingMode,
  ): boolean {
    const decision = decideAdrenalineActivationBySearch(runtime, opponent, state, opponentState, abilityPolicy);
    return decision.shouldActivate && (decision.chosenDelaySec ?? Number.POSITIVE_INFINITY) <= 0;
  }

  function shouldActivateRewindBySearch(
    runtime: CombatantRuntime,
    opponent: CombatantRuntime,
    state: CombatantState,
    opponentState: CombatantState,
    restoredHp: number,
    restoredStatuses: CombatantState["statuses"],
    abilityPolicy: AbilityTimingMode,
  ): boolean {
    const projectedKeep = projectPolicyWindow(runtime, opponent, state, opponentState, undefined, abilityPolicy);
    const restoredState = cloneStateForProjection(state);
    restoredState.hp = restoredHp;
    restoredState.statuses = cloneStateForProjection(restoredStatuses);
    const projectedRewind = projectPolicyWindow(runtime, opponent, restoredState, opponentState, undefined, abilityPolicy);
    return decideTimedAbilityStateTransform(projectedKeep, projectedRewind, {
      abilityName: "Rewind",
      time: state.lastUpdateAt,
      onDecision: (entry) => appendAbilityTimingEvent(state, entry),
    }).shouldTransform;
  }

  return {
    estimateIncomingDps,
    estimateNetDps,
    projectPolicyCheckpoint,
    projectPolicyWindow,
    projectFixedHunkerWindow,
    projectLifeLeechWindow,
    scorePolicyState,
    shouldActivateFrostNovaBySearch,
    estimateSelfOutgoingDps,
    decideHuntersCurseActivationBySearch,
    shouldActivateHuntersCurseBySearch,
    decideUnbridledRageActivationBySearch,
    shouldActivateUnbridledRageBySearch,
    shouldActivateFortifyBySearch,
    shouldActivateReflectBySearch,
    decideAdrenalineActivationBySearch,
    shouldActivateAdrenalineBySearch,
    shouldActivateRewindBySearch,
  };
}
