import type { AbilityTimingMode } from "./types";
import type { CombatantRuntime, CombatantState } from "./runtimeContext";
import { cloneStateForProjection } from "./combatPrimitives";
import { createPolicyProjectionRuntime } from "./policyProjectionRuntime";
import type { PolicyDeps } from "./policyRuntimeTypes";
import { decideTimedAbilityModeChoice, getTimedAbilityActivationDelayCandidates } from "./timedAbilityPolicyRuntime";

export function createPolicyRuntime(deps: PolicyDeps) {
  const projectionRuntime = createPolicyProjectionRuntime(deps);
  const {
    estimateIncomingDps,
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
  } = projectionRuntime;

  function appendAbilityTimingEvent(state: CombatantState, entry: string): void {
    if (state.abilityTimingEvents.length >= 200) return;
    state.abilityTimingEvents.push(entry);
  }

  function getWardenRageProjectionDurationSec(abilityPolicy: AbilityTimingMode): number {
    if (abilityPolicy === "extreme") return 10;
    if (abilityPolicy === "ideal") return 8;
    return 6;
  }

  function shouldTriggerWardenRageSnapshot(
    time: number,
    runtime: CombatantRuntime,
    opponent: CombatantRuntime,
    state: CombatantState,
    opponentState: CombatantState,
  ): boolean {
    const MIN_TRIGGER_HP_RATIO = 0.65;
    const IDEAL_TRIGGER_HP_RATIO = 0.55;
    const MIN_TRIGGER_STACKS = 70;
    const IDEAL_TRIGGER_STACKS = 90;

    if (state.wardenRageOn) {
      return time < state.wardenRageTapUntil;
    }

    if (time < state.wardenRageCooldownUntil) return false;
    const hpRatio = state.hp / Math.max(1, runtime.final.health);
    if (hpRatio > MIN_TRIGGER_HP_RATIO) return false;

    const currentStacks = deps.wardenRageStacksFromHpRatio(hpRatio);
    const storedStacks = state.wardenRageStacks;
    if (currentStacks < MIN_TRIGGER_STACKS) return false;
    if (currentStacks <= storedStacks + 10) return false;
    if (currentStacks >= 100) return true;
    if (hpRatio <= IDEAL_TRIGGER_HP_RATIO && currentStacks >= IDEAL_TRIGGER_STACKS) return true;

    const incomingDps = estimateIncomingDps(runtime, opponent, state, opponentState);
    const selfOutgoing = estimateSelfOutgoingDps(runtime, state);
    return hpRatio <= MIN_TRIGGER_HP_RATIO && currentStacks >= MIN_TRIGGER_STACKS && incomingDps >= selfOutgoing * 1.1;
  }

  function decideWardenRage(
    time: number,
    runtime: CombatantRuntime,
    opponent: CombatantRuntime,
    state: CombatantState,
    opponentState: CombatantState,
  ): boolean {
    return shouldTriggerWardenRageSnapshot(time, runtime, opponent, state, opponentState);
  }

  function decideWardenRageBySearch(
    time: number,
    runtime: CombatantRuntime,
    opponent: CombatantRuntime,
    state: CombatantState,
    opponentState: CombatantState,
    abilityPolicy: AbilityTimingMode,
  ): boolean {
    if (state.wardenRageOn) {
      if (time < state.wardenRageTapUntil) {
        appendAbilityTimingEvent(
          state,
          `[Warden's Rage] t=${time.toFixed(2)} mode=${abilityPolicy} activeTap=hold tapUntil=${state.wardenRageTapUntil.toFixed(2)}`,
        );
        return true;
      }
      if (state.wardenRageHoldMode && state.wardenRageStacks < 100) {
        appendAbilityTimingEvent(
          state,
          `[Warden's Rage] t=${time.toFixed(2)} mode=${abilityPolicy} activeHold lock-until-100 stacks=${state.wardenRageStacks}`,
        );
        return true;
      }
      const releasedState = cloneStateForProjection(state);
      releasedState.wardenRageOn = false;
      releasedState.wardenRageTapUntil = 0;
      const releaseScore = projectPolicyWindow(runtime, opponent, releasedState, opponentState, undefined, abilityPolicy);
      const holdScore = projectPolicyWindow(
        runtime,
        opponent,
        state,
        opponentState,
        { forcedRageOn: true, holdWardenRageOnActivation: true },
        abilityPolicy,
      );
      const activeChoice = decideTimedAbilityModeChoice(
        [
          { id: "release", score: releaseScore },
          { id: "hold", score: holdScore },
        ],
        {
          abilityName: "Warden's Rage",
          time,
          onDecision: (entry) => appendAbilityTimingEvent(state, entry),
        },
      );
      const keepHolding =
        activeChoice.bestChoiceId === "hold" ||
        compareWardenCandidate(holdScore, state.wardenRageStacks, releaseScore, releasedState.wardenRageStacks);
      appendAbilityTimingEvent(
        state,
        `[Warden's Rage] t=${time.toFixed(2)} mode=${abilityPolicy} activeHold release=win:${releaseScore.winRank}/ttk:${releaseScore.ttk.toFixed(2)}/eff:${releaseScore.effectiveDamage.toFixed(2)} hold=win:${holdScore.winRank}/ttk:${holdScore.ttk.toFixed(2)}/eff:${holdScore.effectiveDamage.toFixed(2)} choice=${keepHolding ? "hold" : "release"}`,
      );
      state.wardenRageHoldMode = keepHolding;
      return keepHolding;
    }
    const hpRatio = state.hp / Math.max(1, runtime.final.health);
    const currentStacks = deps.wardenRageStacksFromHpRatio(hpRatio);
    const lowStackTapGate = currentStacks < 70 || currentStacks <= state.wardenRageStacks + 10;
    if (lowStackTapGate) {
      appendAbilityTimingEvent(
        state,
        `[Warden's Rage] t=${time.toFixed(2)} mode=${abilityPolicy} low-stack-search hp=${hpRatio.toFixed(3)} current=${currentStacks} stored=${state.wardenRageStacks}`,
      );
    }

    const keepScore = projectPolicyWindow(runtime, opponent, state, opponentState, undefined, abilityPolicy);
    const candidateDelays = getWardenDecisionDelayCandidates(time, runtime, opponent, state, opponentState, abilityPolicy);
    let bestDelay: number | null = null;
    let bestPlan: "tap" | "hold" | null = null;
    let bestScore = keepScore;
    let bestStacks = state.wardenRageStacks;
    let nowScore: { winRank: number; ttk: number; effectiveDamage: number } | null = null;
    let nowStacks = currentStacks;
    let nowPlan: "tap" | "hold" = "tap";

    for (const delay of candidateDelays) {
      const checkpoint = delay <= 0
        ? { selfState: state, opponentState }
        : projectPolicyCheckpoint(runtime, opponent, state, opponentState, delay, abilityPolicy);
      if (checkpoint.selfState.hp <= 0) continue;
      const snapshotStacks = deps.wardenRageStacksFromHpRatio(
        checkpoint.selfState.hp / Math.max(1, runtime.final.health),
      );
      const canEvaluateTap = !lowStackTapGate && snapshotStacks > state.wardenRageStacks + 5;
      const canEvaluateHold = snapshotStacks > state.wardenRageStacks + 5 || lowStackTapGate;

      let tapScore: { winRank: number; ttk: number; effectiveDamage: number } | null = null;
      if (canEvaluateTap) {
        tapScore = projectPolicyWindow(
          runtime,
          opponent,
          checkpoint.selfState,
          checkpoint.opponentState,
          {
            forcedRageDurationSec: getWardenRageProjectionDurationSec(abilityPolicy),
            snapshotWardenRageOnActivation: true,
          },
          abilityPolicy,
        );
      }
      const holdScore = projectPolicyWindow(
        runtime,
        opponent,
        checkpoint.selfState,
        checkpoint.opponentState,
        {
          activationDelaySec: 0,
          holdWardenRageOnActivation: true,
        },
        abilityPolicy,
      );

      const tapBetter = tapScore != null && compareWardenCandidate(tapScore, snapshotStacks, bestScore, bestStacks);
      if (tapScore != null) {
        appendAbilityTimingEvent(
          state,
          `[Warden's Rage] t=${time.toFixed(2)} mode=${abilityPolicy} candidate plan=tap delay=${delay.toFixed(2)} snap=${snapshotStacks} score=win:${tapScore.winRank}/ttk:${tapScore.ttk.toFixed(2)}/eff:${tapScore.effectiveDamage.toFixed(2)} better=${tapBetter ? 1 : 0}`,
        );
      }
      const holdBetter = canEvaluateHold && compareWardenCandidate(holdScore, snapshotStacks, bestScore, bestStacks);
      appendAbilityTimingEvent(
        state,
        `[Warden's Rage] t=${time.toFixed(2)} mode=${abilityPolicy} candidate plan=hold delay=${delay.toFixed(2)} snap=${snapshotStacks} score=win:${holdScore.winRank}/ttk:${holdScore.ttk.toFixed(2)}/eff:${holdScore.effectiveDamage.toFixed(2)} better=${holdBetter ? 1 : 0}`,
      );
      if (delay === 0 && tapScore != null) {
        nowScore = tapScore;
        nowStacks = snapshotStacks;
        nowPlan = "tap";
      }
      if (tapBetter && tapScore != null) {
        bestDelay = delay;
        bestPlan = "tap";
        bestScore = tapScore;
        bestStacks = snapshotStacks;
      }
      if (holdBetter) {
        bestDelay = delay;
        bestPlan = "hold";
        bestScore = holdScore;
        bestStacks = snapshotStacks;
      }
      if (delay === 0 && holdBetter) {
        nowScore = holdScore;
        nowStacks = snapshotStacks;
        nowPlan = "hold";
      }
    }

    if (bestDelay == null) {
      state.wardenRageHoldMode = false;
      return shouldTriggerWardenRageSnapshot(time, runtime, opponent, state, opponentState);
    }

    if (
      bestDelay != null &&
      bestDelay > 0 &&
      bestDelay <= 0.35 &&
      currentStacks >= 95 &&
      !(currentStacks < 90 && time >= state.nextHitAt - 1e-9 && opponentState.nextHitAt > time + 1e-9) &&
      nowScore != null &&
      nowScore.winRank === bestScore.winRank &&
      Math.abs(bestStacks - nowStacks) <= 4 &&
      bestScore.effectiveDamage - nowScore.effectiveDamage <= Math.max(40, bestScore.effectiveDamage * 0.01)
    ) {
      appendAbilityTimingEvent(
        state,
        `[Warden's Rage] t=${time.toFixed(2)} mode=${abilityPolicy} snap-now current=${currentStacks} bestDelay=${bestDelay.toFixed(2)} effGap=${(bestScore.effectiveDamage - nowScore.effectiveDamage).toFixed(2)} plan=${bestPlan ?? "tap"}`,
      );
      bestDelay = 0;
      bestPlan = nowPlan;
      bestScore = nowScore;
      bestStacks = nowStacks;
    }

    if (
      bestDelay != null &&
      bestDelay > 0 &&
      bestDelay <= (abilityPolicy === "extreme" ? 0.5 : 1) &&
      currentStacks >= 80 &&
      nowScore != null &&
      nowScore.winRank === bestScore.winRank &&
      bestScore.effectiveDamage - nowScore.effectiveDamage <= Math.max(80, bestScore.effectiveDamage * 0.01) &&
      time >= state.nextHitAt - 1e-9
    ) {
      appendAbilityTimingEvent(
        state,
        `[Warden's Rage] t=${time.toFixed(2)} mode=${abilityPolicy} snap-pre-hit current=${currentStacks} bestDelay=${bestDelay.toFixed(2)} effGap=${(bestScore.effectiveDamage - nowScore.effectiveDamage).toFixed(2)} plan=${bestPlan ?? "tap"}`,
      );
      bestDelay = 0;
      bestPlan = nowPlan;
      bestScore = nowScore;
      bestStacks = nowStacks;
    }

    if (
      abilityPolicy === "semiIdeal" &&
      lowStackTapGate &&
      bestPlan === "hold" &&
      bestDelay != null &&
      bestDelay > 0 &&
      bestDelay <= 1 &&
      nowScore != null &&
      nowPlan === "hold" &&
      nowScore.winRank > keepScore.winRank
    ) {
      appendAbilityTimingEvent(
        state,
        `[Warden's Rage] t=${time.toFixed(2)} mode=${abilityPolicy} snap-low-stack-hold current=${currentStacks} bestDelay=${bestDelay.toFixed(2)} keepWin=${keepScore.winRank} nowWin=${nowScore.winRank}`,
      );
      bestDelay = 0;
      bestPlan = "hold";
      bestScore = nowScore;
      bestStacks = nowStacks;
    }

    appendAbilityTimingEvent(
      state,
      `[Warden's Rage] t=${time.toFixed(2)} mode=${abilityPolicy} final choice=${bestDelay == null ? "skip" : `${bestPlan ?? "tap"}@${bestDelay.toFixed(2)}`} bestSnap=${bestStacks}`,
    );
    state.wardenRageHoldMode = bestDelay === 0 && bestPlan === "hold";
    return bestDelay === 0;
  }

  function compareWardenCandidate(
    candidateScore: { winRank: number; ttk: number; effectiveDamage: number },
    candidateStacks: number,
    bestScore: { winRank: number; ttk: number; effectiveDamage: number },
    bestStacks: number,
  ): boolean {
    if (candidateScore.winRank !== bestScore.winRank) {
      return candidateScore.winRank > bestScore.winRank;
    }
    if (Math.abs(candidateScore.effectiveDamage - bestScore.effectiveDamage) > 1e-9) {
      return candidateScore.effectiveDamage > bestScore.effectiveDamage;
    }
    const ordering = scorePolicyStateOrdering(candidateScore, bestScore);
    if (ordering < 0) return true;
    if (ordering > 0) return false;
    if (candidateStacks !== bestStacks) return candidateStacks > bestStacks;
    return candidateScore.effectiveDamage > bestScore.effectiveDamage + 1e-9;
  }

  function scorePolicyStateOrdering(
    a: { winRank: number; ttk: number; effectiveDamage: number },
    b: { winRank: number; ttk: number; effectiveDamage: number },
  ): number {
    if (a.winRank !== b.winRank) return b.winRank - a.winRank;
    if (a.winRank === 0 && a.effectiveDamage !== b.effectiveDamage) {
      return b.effectiveDamage - a.effectiveDamage;
    }
    if (a.ttk !== b.ttk) return a.winRank === 2 ? a.ttk - b.ttk : b.ttk - a.ttk;
    if (a.effectiveDamage !== b.effectiveDamage) return b.effectiveDamage - a.effectiveDamage;
    return 0;
  }

  function getWardenDecisionDelayCandidates(
    time: number,
    runtime: CombatantRuntime,
    opponent: CombatantRuntime,
    state: CombatantState,
    opponentState: CombatantState,
    abilityPolicy: AbilityTimingMode,
  ): number[] {
    const maxDelay = abilityPolicy === "extreme" ? 12 : abilityPolicy === "ideal" ? 8 : 4;
    const delays = new Set<number>([0]);
    const currentStacks = deps.wardenRageStacksFromHpRatio(state.hp / Math.max(1, runtime.final.health));
    const suppressExtremeMicroSoloHitDelays =
      abilityPolicy === "extreme" &&
      currentStacks < 90 &&
      time >= state.nextHitAt - 1e-9 &&
      opponentState.nextHitAt > time + 1e-9;

    const addDelay = (absoluteTime: number): void => {
      const delay = Number((absoluteTime - time).toFixed(2));
      if (delay > 0 && delay <= maxDelay) delays.add(delay);
    };

    const addRepeatedCadence = (firstAbsoluteTime: number, cadenceSec: number): void => {
      if (!Number.isFinite(firstAbsoluteTime) || !Number.isFinite(cadenceSec) || cadenceSec <= 0) return;
      for (let absolute = firstAbsoluteTime; absolute - time <= maxDelay + 1e-9; absolute += cadenceSec) {
        addDelay(absolute);
      }
    };

    addRepeatedCadence(state.nextHitAt, deps.currentBiteCooldown(runtime, state, true));
    addRepeatedCadence(opponentState.nextHitAt, deps.currentBiteCooldown(opponent, opponentState, true));
    addRepeatedCadence(state.nextRegenAt, deps.passiveRegenTickSec);
    addRepeatedCadence(opponentState.nextRegenAt, deps.passiveRegenTickSec);

    for (const instance of Object.values(state.statuses)) {
      if (instance.nextTickAt != null) addDelay(instance.nextTickAt);
    }
    for (const instance of Object.values(opponentState.statuses)) {
      if (instance.nextTickAt != null) addDelay(instance.nextTickAt);
    }

    if (abilityPolicy === "semiIdeal") {
      return Array.from(delays).sort((a, b) => a - b);
    }

    for (const delay of getTimedAbilityActivationDelayCandidates(abilityPolicy)) {
      if (suppressExtremeMicroSoloHitDelays && delay < 0.5) continue;
      if (delay <= maxDelay) delays.add(delay);
    }
    return Array.from(delays).sort((a, b) => a - b);
  }

  function shouldActivateHuntersCurse(
    runtime: CombatantRuntime,
    opponent: CombatantRuntime,
    opponentState: CombatantState,
    state: CombatantState,
  ): boolean {
    const hpRatio = state.hp / Math.max(1, runtime.final.health);
    if (hpRatio < 0.75) return false;
    const oppHpRatio = opponentState.hp / Math.max(1, opponent.final.health);
    if (oppHpRatio < 0.2) return false;

    const outDps = estimateSelfOutgoingDps(runtime, state);
    const extraDps = outDps;
    const expectedGain = extraDps * deps.huntersCurseDurationSec;
    const hpCost = runtime.final.health * 0.5;
    return expectedGain >= hpCost * 0.6;
  }

  function shouldActivateUnbridledRage(runtime: CombatantRuntime, state: CombatantState): boolean {
    const hpRatio = state.hp / Math.max(1, runtime.final.health);
    if (hpRatio < 0.25) return false;
    const outDps = estimateSelfOutgoingDps(runtime, state);
    const extraDps = outDps * 0.3;
    return extraDps * deps.unbridledRageDurationSec > runtime.final.health * 0.08;
  }

  return {
    decideWardenRage,
    decideWardenRageBySearch,
    scorePolicyState,
    projectPolicyCheckpoint,
    projectPolicyWindow,
    projectFixedHunkerWindow,
    projectLifeLeechWindow,
    estimateIncomingDps,
    estimateSelfOutgoingDps,
    shouldActivateFrostNovaBySearch,
    shouldActivateHuntersCurse,
    decideHuntersCurseActivationBySearch,
    shouldActivateHuntersCurseBySearch,
    shouldActivateUnbridledRage,
    decideUnbridledRageActivationBySearch,
    shouldActivateUnbridledRageBySearch,
    shouldActivateFortifyBySearch,
    shouldActivateReflectBySearch,
    decideAdrenalineActivationBySearch,
    shouldActivateAdrenalineBySearch,
    shouldActivateRewindBySearch,
  };
}
