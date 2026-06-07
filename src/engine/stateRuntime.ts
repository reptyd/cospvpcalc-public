import type { AbilityTimingMode } from "./types";
import type { CombatantRuntime, CombatantState } from "./runtimeContext";
import type { EffectsCatalogByCreature } from "./types";
import type { LifeLeechProjectionResult } from "./policyRuntimeTypes";
import { createStateLifeLeechRuntime } from "./stateLifeLeechRuntime";
import { createStateWardenRageRuntime } from "./stateWardenRageRuntime";
import { decideTimedAbilityToggleState } from "./timedAbilityPolicyRuntime";
import { HUNKER_EFFECT_DELAY_SEC } from "./combatMath";
import { resolveAbilityTimingModeForAbility } from "./abilityTimingOverrides";

type PolicyProjectionScore = { winRank: number; ttk: number; effectiveDamage: number };

type StateDeps = {
  lifeLeechDurationSec: number;
  lifeLeechCooldownSec: number;
  disableWardenRage: string;
  isAbilityDisabled: (disabled: Set<string>, abilityName: string) => boolean;
  isPrecisionPolicy: (mode: AbilityTimingMode) => boolean;
  hasAbilityName: (effects: EffectsCatalogByCreature, abilityName: string) => boolean;
  wardenRageStacksFromHpRatio: (hpRatio: number) => number;
  comparePolicyStateScore: (
    a: PolicyProjectionScore,
    b: PolicyProjectionScore,
  ) => number;
  cloneStateForProjection: <T>(state: T) => T;
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
    projectFixedHunkerWindow: (
      time: number,
      runtime: CombatantRuntime,
      opponent: CombatantRuntime,
      state: CombatantState,
      opponentState: CombatantState,
      selfHunkerOn: boolean,
      opponentHunkerOn: boolean,
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
    decideWardenRageBySearch: (
      time: number,
      runtime: CombatantRuntime,
      opponent: CombatantRuntime,
      state: CombatantState,
      opponentState: CombatantState,
      abilityPolicy: AbilityTimingMode,
    ) => boolean;
    decideWardenRage: (
      time: number,
      runtime: CombatantRuntime,
      opponent: CombatantRuntime,
      state: CombatantState,
      opponentState: CombatantState,
    ) => boolean;
  };
};

export function createStateRuntime(deps: StateDeps) {
  const lifeLeechRuntime = createStateLifeLeechRuntime(deps);
  const wardenRageRuntime = createStateWardenRageRuntime(deps);

  function logAbilityStateChange(
    state: CombatantState,
    abilityName: string,
    time: number,
    description: string,
  ): void {
    state.combatLog.push({
      time,
      type: "ability",
      attacker: state.sideLabel,
      damage: 0,
      actorHpAfter: state.hp,
      hpSide: state.sideLabel,
      hpAfter: state.hp,
      description: `${abilityName} ${description}`,
    });
  }

  function buildStatusDecisionKey(statuses: CombatantState["statuses"]): string {
    const entries = Object.entries(statuses);
    if (entries.length === 0) return "-";
    return entries
      .sort(([left], [right]) => left.localeCompare(right))
      .map(
        ([statusId, instance]) =>
          `${statusId}:${instance.stacks}:${instance.nextTickAt ?? "n"}:${instance.nextDecayAt ?? "n"}:${instance.remainingSec}:${instance.stackValueMode ?? "normal"}`,
      )
      .join("|");
  }

  function getHunkerDecisionCadenceSec(abilityPolicy: AbilityTimingMode): number {
    if (abilityPolicy === "extreme") return 0.1;
    if (abilityPolicy === "ideal") return 0.25;
    if (abilityPolicy === "semiIdeal") return 0.5;
    return 1;
  }

  function buildEventWindowKey(eventAt: number | null | undefined, currentTime: number, resolutionSec: number): string {
    if (eventAt == null || !Number.isFinite(eventAt)) return "inf";
    const remainingSec = Math.max(0, eventAt - currentTime);
    return (Math.round(remainingSec / resolutionSec) * resolutionSec).toFixed(2);
  }

  function getNearestStatusTickAt(statuses: CombatantState["statuses"]): number | null {
    let nearest = Number.POSITIVE_INFINITY;
    for (const instance of Object.values(statuses)) {
      if (instance.nextTickAt == null) continue;
      if (instance.nextTickAt < nearest) nearest = instance.nextTickAt;
    }
    return Number.isFinite(nearest) ? nearest : null;
  }

  function buildHunkerDecisionKey(
    state: CombatantState,
    opponentState: CombatantState,
    abilityPolicy: AbilityTimingMode,
  ): string {
    const keyResolutionSec = abilityPolicy === "extreme" ? 0.1 : abilityPolicy === "ideal" ? 0.25 : 0.5;
    return [
      state.hp,
      state.hunkerOn ? 1 : 0,
      buildEventWindowKey(state.nextHitAt, state.lastUpdateAt, keyResolutionSec),
      buildEventWindowKey(state.nextRegenAt, state.lastUpdateAt, keyResolutionSec),
      buildEventWindowKey(getNearestStatusTickAt(state.statuses), state.lastUpdateAt, keyResolutionSec),
      state.wardenRageOn ? 1 : 0,
      state.wardenRageStacks,
      state.huntersCurseActiveUntil > state.lastUpdateAt ? 1 : 0,
      state.unbridledRageActiveUntil > state.lastUpdateAt ? 1 : 0,
      state.adrenalineActiveUntil > state.lastUpdateAt ? 1 : 0,
      buildStatusDecisionKey(state.statuses),
      opponentState.hp,
      opponentState.hunkerOn ? 1 : 0,
      buildEventWindowKey(opponentState.nextHitAt, opponentState.lastUpdateAt, keyResolutionSec),
      buildEventWindowKey(opponentState.nextRegenAt, opponentState.lastUpdateAt, keyResolutionSec),
      buildEventWindowKey(getNearestStatusTickAt(opponentState.statuses), opponentState.lastUpdateAt, keyResolutionSec),
      opponentState.wardenRageOn ? 1 : 0,
      opponentState.wardenRageStacks,
      opponentState.huntersCurseActiveUntil > opponentState.lastUpdateAt ? 1 : 0,
      opponentState.unbridledRageActiveUntil > opponentState.lastUpdateAt ? 1 : 0,
      opponentState.adrenalineActiveUntil > opponentState.lastUpdateAt ? 1 : 0,
      buildStatusDecisionKey(opponentState.statuses),
    ].join(";");
  }

  function appendAbilityTimingEvent(state: CombatantState, entry: string): void {
    if (state.abilityTimingEvents.length >= 200) return;
    state.abilityTimingEvents.push(entry);
  }

  function resolveNextHunkerEffectStartsAt(state: CombatantState, time: number): number {
    return (state.abilityAppliedCounts["Hunker"] ?? 0) <= 0 ? time : time + HUNKER_EFFECT_DELAY_SEC;
  }

  function updateHunker(
    time: number,
    runtime: CombatantRuntime,
    opponent: CombatantRuntime,
    state: CombatantState,
    opponentState: CombatantState,
    activesOn: boolean,
    abilityPolicy: AbilityTimingMode,
    disabled: Set<string>,
  ): void {
    const effectiveAbilityPolicy = resolveAbilityTimingModeForAbility("Hunker", abilityPolicy, state.abilityPolicyOverrides);
    if (!deps.hasAbilityName(runtime.effects, "Hunker")) return;
    if (!activesOn || deps.isAbilityDisabled(disabled, "Hunker")) {
      if (state.hunkerOn) {
        logAbilityStateChange(state, "Hunker", time, "deactivated");
      }
      state.hunkerOn = false;
      state.hunkerEffectStartsAt = Number.POSITIVE_INFINITY;
      state.hunkerDecisionKey = null;
      state.hunkerDecisionOn = null;
      state.hunkerLastDecisionAt = Number.NEGATIVE_INFINITY;
      return;
    }
    if (effectiveAbilityPolicy === "reallyFast") {
      if (!state.hunkerOn) {
        state.hunkerOn = true;
        state.hunkerEffectStartsAt = resolveNextHunkerEffectStartsAt(state, time);
        deps.markAbilityApplied(state, "Hunker", time, "reallyFast always-on");
      }
      state.hunkerDecisionKey = null;
      state.hunkerDecisionOn = true;
      state.hunkerLastDecisionAt = time;
      return;
    }
    if (!deps.isPrecisionPolicy(effectiveAbilityPolicy)) {
      // Keep fast-policy Hunker cheap for broad optimizer scans.
      // Tactical projection remains reserved for precision policies.
      if (!state.hunkerOn) {
        state.hunkerOn = true;
        state.hunkerEffectStartsAt = resolveNextHunkerEffectStartsAt(state, time);
        deps.markAbilityApplied(state, "Hunker", time);
      }
      state.hunkerDecisionKey = null;
      state.hunkerDecisionOn = state.hunkerOn;
      state.hunkerLastDecisionAt = time;
      return;
    }
    const hunkerDecisionCadenceSec = getHunkerDecisionCadenceSec(effectiveAbilityPolicy);
    if (time < state.hunkerLastDecisionAt + hunkerDecisionCadenceSec) {
      return;
    }

    if (!state.hunkerOn) {
      const hpRatio = state.hp / Math.max(1, runtime.final.health);
      const incomingDps = deps.policyRuntime.estimateIncomingDps(runtime, opponent, state, opponentState);
      const selfOutgoingDps = deps.policyRuntime.estimateSelfOutgoingDps(runtime, state);
      const selfTtl = incomingDps > 0 ? state.hp / incomingDps : Number.POSITIVE_INFINITY;
      if ((hpRatio <= 0.85 || selfTtl <= 12) && incomingDps >= selfOutgoingDps * 1.1) {
        state.hunkerOn = true;
        state.hunkerEffectStartsAt = resolveNextHunkerEffectStartsAt(state, time);
        state.hunkerDecisionKey = null;
        state.hunkerDecisionOn = true;
        state.hunkerLastDecisionAt = time;
        deps.markAbilityApplied(state, "Hunker", time);
        return;
      }
    }

    const decisionKey = buildHunkerDecisionKey(state, opponentState, effectiveAbilityPolicy);
    if (state.hunkerDecisionKey === decisionKey && state.hunkerDecisionOn != null) {
      state.hunkerOn = state.hunkerDecisionOn;
      state.hunkerLastDecisionAt = time;
      return;
    }

    const toggledState = deps.cloneStateForProjection(state);
    toggledState.hunkerOn = !state.hunkerOn;
    toggledState.hunkerEffectStartsAt = toggledState.hunkerOn
      ? resolveNextHunkerEffectStartsAt(state, time)
      : Number.POSITIVE_INFINITY;

    const keepScore = deps.policyRuntime.projectFixedHunkerWindow(
      time,
      runtime,
      opponent,
      state,
      opponentState,
      state.hunkerOn,
      opponentState.hunkerOn,
      effectiveAbilityPolicy,
    );
    const toggledScore = deps.policyRuntime.projectFixedHunkerWindow(
      time,
      runtime,
      opponent,
      toggledState,
      opponentState,
      toggledState.hunkerOn,
      opponentState.hunkerOn,
      effectiveAbilityPolicy,
    );

    const toggleDecision = decideTimedAbilityToggleState(state.hunkerOn, keepScore, toggledScore, {
      abilityName: "Hunker",
      time,
      onDecision: (entry) => appendAbilityTimingEvent(state, entry),
    });
    let nextHunkerOn = toggleDecision.nextValue;
    if (!state.hunkerOn && deps.comparePolicyStateScore(toggledScore, keepScore) === 0) {
      const incomingDps = deps.policyRuntime.estimateIncomingDps(runtime, opponent, state, opponentState);
      const selfOutgoingDps = deps.policyRuntime.estimateSelfOutgoingDps(runtime, state);
      const selfTtl = incomingDps > 0 ? state.hp / incomingDps : Number.POSITIVE_INFINITY;
      const fragileUnderdogBiasApplies =
        runtime.final.health <= opponent.final.health * 0.2 &&
        selfTtl <= 15;
      const defensiveBiasApplies =
        (
          incomingDps >= selfOutgoingDps * 1.15 &&
          (selfTtl <= 30 || runtime.final.health <= opponent.final.health * 0.95)
        ) ||
        fragileUnderdogBiasApplies;
      if (defensiveBiasApplies) {
        appendAbilityTimingEvent(
          state,
          `[Hunker] t=${time.toFixed(2)} mode=${effectiveAbilityPolicy} tie-break defensive-on incoming=${incomingDps.toFixed(2)} outgoing=${selfOutgoingDps.toFixed(2)} ttl=${selfTtl.toFixed(2)}`,
        );
        nextHunkerOn = true;
      }
    }
    const turnedOn = !state.hunkerOn && nextHunkerOn;
    const turnedOff = state.hunkerOn && !nextHunkerOn;
    state.hunkerOn = nextHunkerOn;
    state.hunkerDecisionKey = decisionKey;
    state.hunkerDecisionOn = nextHunkerOn;
    state.hunkerLastDecisionAt = time;

    if (turnedOn) {
      state.hunkerEffectStartsAt = resolveNextHunkerEffectStartsAt(state, time);
      deps.markAbilityApplied(state, "Hunker", time);
    } else if (turnedOff) {
      state.hunkerEffectStartsAt = Number.POSITIVE_INFINITY;
      logAbilityStateChange(state, "Hunker", time, "deactivated");
    } else if (!state.hunkerOn) {
      state.hunkerEffectStartsAt = Number.POSITIVE_INFINITY;
    }
  }

  return {
    updateLifeLeech: lifeLeechRuntime.updateLifeLeech,
    updateWardenRage: wardenRageRuntime.updateWardenRage,
    updateHunker,
  };
}
