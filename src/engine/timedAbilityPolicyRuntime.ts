import { comparePolicyStateScore } from "./combatPrimitives";
import type { CombatantRuntime, CombatantState } from "./runtimeContext";
import type { AbilityTimingMode } from "./types";
import type { PolicyProjectionOptions, PolicyProjectionScore } from "./policyRuntimeTypes";

export type TimedAbilityProjectionDeps = {
  projectPolicyWindow: (
    runtime: CombatantRuntime,
    opponent: CombatantRuntime,
    state: CombatantState,
    opponentState: CombatantState,
    options: PolicyProjectionOptions | undefined,
    abilityPolicy: AbilityTimingMode,
  ) => PolicyProjectionScore;
};

type TimedStateTimingSnapshot = Pick<
  CombatantState,
  "lastUpdateAt" | "nextHitAt" | "nextRegenAt" | "statuses"
>;

export type TimedAbilityDecisionTrace = {
  abilityName: string;
  time: number;
  onDecision?: (entry: string) => void;
};

export type TimedAbilityActivationCandidate = {
  activationDelaySec: number;
  score: PolicyProjectionScore;
};

export type TimedAbilityActivationDecision = {
  shouldActivate: boolean;
  chosenDelaySec: number | null;
  keepScore: PolicyProjectionScore;
  bestScore: PolicyProjectionScore;
  candidates: TimedAbilityActivationCandidate[];
};

export type TimedAbilityActivationDecisionOptions = {
  extraActivationDelayCandidates?: number[];
  currentTimeSec?: number;
};

export type TimedAbilityToggleDecision = {
  shouldToggle: boolean;
  nextValue: boolean;
  keepScore: PolicyProjectionScore;
  toggledScore: PolicyProjectionScore;
};

export type TimedAbilityStateTransformDecision = {
  shouldTransform: boolean;
  keepScore: PolicyProjectionScore;
  transformedScore: PolicyProjectionScore;
};

export type TimedAbilityModeChoice = {
  id: string;
  score: PolicyProjectionScore;
};

export type TimedAbilityModeChoiceDecision = {
  bestChoiceId: string;
  bestScore: PolicyProjectionScore;
  choices: TimedAbilityModeChoice[];
};

export function getTimedAbilityActivationDelayCandidates(abilityPolicy: AbilityTimingMode): number[] {
  if (abilityPolicy === "extreme") {
    const candidates: number[] = [];
    for (let delay = 0; delay <= 12 + 1e-9; delay += 0.05) {
      candidates.push(Number(delay.toFixed(2)));
    }
    for (let delay = 12.25; delay <= 30 + 1e-9; delay += 0.25) {
      candidates.push(Number(delay.toFixed(2)));
    }
    for (let delay = 31; delay <= 120; delay += 1) {
      candidates.push(delay);
    }
    return candidates;
  }
  if (abilityPolicy === "ideal") {
    return [0, 0.25, 0.5, 1, 1.5, 2, 3, 4];
  }
  if (abilityPolicy === "semiIdeal") {
    return [0, 0.5, 1, 2];
  }
  return [0];
}

function collectGenericEventAwareActivationDelays(
  state: TimedStateTimingSnapshot | null | undefined,
  opponentState: TimedStateTimingSnapshot | null | undefined,
  abilityPolicy: AbilityTimingMode,
  currentTimeSec?: number,
): number[] {
  if (!state || !opponentState) return [];
  const currentTime = currentTimeSec ?? state.lastUpdateAt;
  const delays = new Set<number>();
  const maxDelay =
    abilityPolicy === "extreme"
      ? 30
      : abilityPolicy === "ideal"
        ? 12
        : abilityPolicy === "semiIdeal"
          ? 6
          : 0;

  function addAbsoluteTime(candidateTime: number): void {
    if (!Number.isFinite(candidateTime)) return;
    const delay = Number((candidateTime - currentTime).toFixed(2));
    if (delay <= 0 || delay > maxDelay) return;
    delays.add(delay);
  }

  function addEventAnchors(candidateTime: number): void {
    addAbsoluteTime(candidateTime);
    const preEventLead =
      abilityPolicy === "extreme"
        ? 0.1
        : abilityPolicy === "ideal"
          ? 0.25
          : 0.5;
    addAbsoluteTime(candidateTime - preEventLead);
  }

  addEventAnchors(state.nextHitAt);
  addEventAnchors(opponentState.nextHitAt);
  addEventAnchors(state.nextRegenAt);
  addEventAnchors(opponentState.nextRegenAt);

  for (const instance of Object.values(state.statuses)) {
    if (instance.nextTickAt != null) addEventAnchors(instance.nextTickAt);
  }
  for (const instance of Object.values(opponentState.statuses)) {
    if (instance.nextTickAt != null) addEventAnchors(instance.nextTickAt);
  }

  return [...delays].sort((left, right) => left - right);
}

function formatScore(score: PolicyProjectionScore): string {
  return `win=${score.winRank} ttk=${score.ttk.toFixed(2)} eff=${score.effectiveDamage.toFixed(2)}`;
}

function arePracticallyEquivalentScores(left: PolicyProjectionScore, right: PolicyProjectionScore): boolean {
  if (left.winRank !== right.winRank) return false;
  const ttkToleranceSec = left.winRank === 2 ? 0.35 : 0.5;
  const effectiveDamageTolerance = Math.max(25, Math.max(Math.abs(left.effectiveDamage), Math.abs(right.effectiveDamage)) * 0.005);
  return (
    Math.abs(left.ttk - right.ttk) <= ttkToleranceSec &&
    Math.abs(left.effectiveDamage - right.effectiveDamage) <= effectiveDamageTolerance
  );
}

function emitTrace(trace: TimedAbilityDecisionTrace | undefined, message: string): void {
  trace?.onDecision?.(`[${trace.abilityName}] t=${trace.time.toFixed(2)} ${message}`);
}

export function decideTimedAbilityActivation(
  deps: TimedAbilityProjectionDeps,
  runtime: CombatantRuntime,
  opponent: CombatantRuntime,
  state: CombatantState,
  opponentState: CombatantState,
  abilityPolicy: AbilityTimingMode,
  buildOptions: (activationDelaySec: number) => PolicyProjectionOptions,
  trace?: TimedAbilityDecisionTrace,
  options?: TimedAbilityActivationDecisionOptions,
): TimedAbilityActivationDecision {
  const keepScore = deps.projectPolicyWindow(runtime, opponent, state, opponentState, undefined, abilityPolicy);
  const activationDelayCandidates = [
    ...new Set([
      ...getTimedAbilityActivationDelayCandidates(abilityPolicy),
      ...collectGenericEventAwareActivationDelays(state, opponentState, abilityPolicy, options?.currentTimeSec),
      ...(options?.extraActivationDelayCandidates ?? []),
    ]),
  ].sort((left, right) => left - right);
  const candidates = activationDelayCandidates.map((activationDelaySec) => ({
    activationDelaySec,
    score: deps.projectPolicyWindow(runtime, opponent, state, opponentState, buildOptions(activationDelaySec), abilityPolicy),
  }));

  let bestDelaySec: number | null = null;
  let bestScore = keepScore;
  for (const candidate of candidates) {
    if (comparePolicyStateScore(candidate.score, bestScore) < 0) {
      bestScore = candidate.score;
      bestDelaySec = candidate.activationDelaySec;
    }
  }

  if (bestDelaySec != null) {
    const earliestCompetitive = candidates.find((candidate) => arePracticallyEquivalentScores(candidate.score, bestScore));
    if (earliestCompetitive && earliestCompetitive.activationDelaySec < bestDelaySec) {
      emitTrace(
        trace,
        `competitive-earliest preferred=${earliestCompetitive.activationDelaySec} over=${bestDelaySec} best{${formatScore(bestScore)}}`,
      );
      bestDelaySec = earliestCompetitive.activationDelaySec;
      bestScore = earliestCompetitive.score;
    }
  }

  emitTrace(
    trace,
    `mode=${abilityPolicy} candidateCount=${candidates.length} keep{${formatScore(keepScore)}} candidates=${candidates
      .map((candidate) => `d=${candidate.activationDelaySec}:{${formatScore(candidate.score)}}`)
      .join(" | ")} choice=${bestDelaySec == null ? "skip" : `activate@${bestDelaySec}`}`,
  );

  return {
    shouldActivate: bestDelaySec != null,
    chosenDelaySec: bestDelaySec,
    keepScore,
    bestScore,
    candidates,
  };
}

export function decideTimedAbilityToggleState(
  currentValue: boolean,
  keepScore: PolicyProjectionScore,
  toggledScore: PolicyProjectionScore,
  trace?: TimedAbilityDecisionTrace,
): TimedAbilityToggleDecision {
  const shouldToggle = comparePolicyStateScore(toggledScore, keepScore) < 0;
  emitTrace(
    trace,
    `keep{${formatScore(keepScore)}} toggled{${formatScore(toggledScore)}} choice=${
      shouldToggle ? `toggle->${!currentValue}` : `keep->${currentValue}`
    }`,
  );
  return {
    shouldToggle,
    nextValue: shouldToggle ? !currentValue : currentValue,
    keepScore,
    toggledScore,
  };
}

export function decideTimedAbilityStateTransform(
  keepScore: PolicyProjectionScore,
  transformedScore: PolicyProjectionScore,
  trace?: TimedAbilityDecisionTrace,
): TimedAbilityStateTransformDecision {
  const shouldTransform = comparePolicyStateScore(transformedScore, keepScore) < 0;
  emitTrace(
    trace,
    `keep{${formatScore(keepScore)}} transformed{${formatScore(transformedScore)}} choice=${
      shouldTransform ? "transform" : "keep"
    }`,
  );
  return {
    shouldTransform,
    keepScore,
    transformedScore,
  };
}

export function decideTimedAbilityModeChoice(
  choices: TimedAbilityModeChoice[],
  trace?: TimedAbilityDecisionTrace,
): TimedAbilityModeChoiceDecision {
  if (choices.length === 0) {
    throw new Error("Expected at least one timed ability mode choice");
  }

  let bestChoice = choices[0];
  for (const choice of choices.slice(1)) {
    if (comparePolicyStateScore(choice.score, bestChoice.score) < 0) {
      bestChoice = choice;
    }
  }

  emitTrace(
    trace,
    `choices=${choices.map((choice) => `${choice.id}{${formatScore(choice.score)}}`).join(" | ")} best=${bestChoice.id}`,
  );

  return {
    bestChoiceId: bestChoice.id,
    bestScore: bestChoice.score,
    choices,
  };
}
