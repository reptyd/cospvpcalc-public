import type { CombatantState } from "./runtimeContext";

type TimelineDeps = {
  nextLifeLeechPlannedAt: (state: CombatantState) => number;
  nextAdrenalinePlannedAt: (state: CombatantState) => number;
  nextHuntersCursePlannedAt: (state: CombatantState) => number;
  nextFrostNovaTickAt: (state: CombatantState) => number;
  nextUnbridledRagePlannedAt: (state: CombatantState) => number;
  nextRegenAt: (state: CombatantState) => number;
  nextTotemTickAt: (state: CombatantState) => number;
  nextTotemReadyAt: (state: CombatantState) => number;
  nextDrowsyAreaReadyAt: (state: CombatantState) => number;
  nextRadiationTickAt: (state: CombatantState) => number;
  nextCauseFearReadyAt: (state: CombatantState) => number;
  nextRefluxChargeReadyAt: (state: CombatantState) => number;
  nextRefluxTickAt: (state: CombatantState) => number;
  nextLanceAuraTickAt: (state: CombatantState) => number;
  nextShadowBarrageHitAt: (state: CombatantState) => number;
  nextToxicTrapTickAt: (state: CombatantState) => number;
  nextDamageTrailTickAt: (state: CombatantState) => number;
  nextHealingStepTickAt: (state: CombatantState) => number;
};

export function createTimelineRuntime(deps: TimelineDeps) {
  function futureEventAt(value: number, cutoff: number): number {
    return Number.isFinite(value) && value >= cutoff - 1e-9 ? value : Number.POSITIVE_INFINITY;
  }

  function nextDotTickAt(state: CombatantState): number {
    let min = Number.POSITIVE_INFINITY;
    for (const instance of Object.values(state.statuses)) {
      if (instance.nextTickAt != null && instance.nextTickAt > state.lastUpdateAt && instance.nextTickAt < min) {
        min = instance.nextTickAt;
      }
    }
    return min;
  }

  function nextStatusDecayAt(state: CombatantState): number {
    let min = Number.POSITIVE_INFINITY;
    for (const instance of Object.values(state.statuses)) {
      if (instance.nextDecayAt != null && instance.nextDecayAt > state.lastUpdateAt && instance.nextDecayAt < min) {
        min = instance.nextDecayAt;
      }
    }
    return min;
  }

  function nextChannelPulseAt(state: CombatantState): number {
    return futureEventAt(state.channelingNextPulseAt ?? Number.POSITIVE_INFINITY, state.lastUpdateAt);
  }

  function nextSelfDestructAt(state: CombatantState): number {
    if (state.selfDestructUsed) return Number.POSITIVE_INFINITY;
    return futureEventAt(state.selfDestructArmedAt ?? Number.POSITIVE_INFINITY, state.lastUpdateAt);
  }

  function nextEventAt(
    stateA: CombatantState,
    stateB: CombatantState,
    nextBreathA: number,
    nextBreathB: number,
  ): number {
    return Math.min(
      futureEventAt(stateA.nextHitAt, stateA.lastUpdateAt),
      futureEventAt(stateB.nextHitAt, stateB.lastUpdateAt),
      nextDotTickAt(stateA),
      nextDotTickAt(stateB),
      nextStatusDecayAt(stateA),
      nextStatusDecayAt(stateB),
      nextChannelPulseAt(stateA),
      nextChannelPulseAt(stateB),
      nextSelfDestructAt(stateA),
      nextSelfDestructAt(stateB),
      futureEventAt(deps.nextLifeLeechPlannedAt(stateA), stateA.lastUpdateAt),
      futureEventAt(deps.nextLifeLeechPlannedAt(stateB), stateB.lastUpdateAt),
      futureEventAt(deps.nextAdrenalinePlannedAt(stateA), stateA.lastUpdateAt),
      futureEventAt(deps.nextAdrenalinePlannedAt(stateB), stateB.lastUpdateAt),
      futureEventAt(deps.nextHuntersCursePlannedAt(stateA), stateA.lastUpdateAt),
      futureEventAt(deps.nextHuntersCursePlannedAt(stateB), stateB.lastUpdateAt),
      futureEventAt(deps.nextFrostNovaTickAt(stateA), stateA.lastUpdateAt),
      futureEventAt(deps.nextFrostNovaTickAt(stateB), stateB.lastUpdateAt),
      futureEventAt(deps.nextUnbridledRagePlannedAt(stateA), stateA.lastUpdateAt),
      futureEventAt(deps.nextUnbridledRagePlannedAt(stateB), stateB.lastUpdateAt),
      futureEventAt(deps.nextRegenAt(stateA), stateA.lastUpdateAt),
      futureEventAt(deps.nextRegenAt(stateB), stateB.lastUpdateAt),
      futureEventAt(deps.nextTotemTickAt(stateA), stateA.lastUpdateAt),
      futureEventAt(deps.nextTotemTickAt(stateB), stateB.lastUpdateAt),
      futureEventAt(deps.nextTotemReadyAt(stateA), stateA.lastUpdateAt),
      futureEventAt(deps.nextTotemReadyAt(stateB), stateB.lastUpdateAt),
      futureEventAt(deps.nextDrowsyAreaReadyAt(stateA), stateA.lastUpdateAt),
      futureEventAt(deps.nextDrowsyAreaReadyAt(stateB), stateB.lastUpdateAt),
      futureEventAt(deps.nextRadiationTickAt(stateA), stateA.lastUpdateAt),
      futureEventAt(deps.nextRadiationTickAt(stateB), stateB.lastUpdateAt),
      futureEventAt(deps.nextCauseFearReadyAt(stateA), stateA.lastUpdateAt),
      futureEventAt(deps.nextCauseFearReadyAt(stateB), stateB.lastUpdateAt),
      futureEventAt(deps.nextRefluxChargeReadyAt(stateA), stateA.lastUpdateAt),
      futureEventAt(deps.nextRefluxChargeReadyAt(stateB), stateB.lastUpdateAt),
      futureEventAt(deps.nextRefluxTickAt(stateA), stateA.lastUpdateAt),
      futureEventAt(deps.nextRefluxTickAt(stateB), stateB.lastUpdateAt),
      futureEventAt(deps.nextLanceAuraTickAt(stateA), stateA.lastUpdateAt),
      futureEventAt(deps.nextLanceAuraTickAt(stateB), stateB.lastUpdateAt),
      futureEventAt(deps.nextShadowBarrageHitAt(stateA), stateA.lastUpdateAt),
      futureEventAt(deps.nextShadowBarrageHitAt(stateB), stateB.lastUpdateAt),
      futureEventAt(deps.nextToxicTrapTickAt(stateA), stateA.lastUpdateAt),
      futureEventAt(deps.nextToxicTrapTickAt(stateB), stateB.lastUpdateAt),
      futureEventAt(deps.nextDamageTrailTickAt(stateA), stateA.lastUpdateAt),
      futureEventAt(deps.nextDamageTrailTickAt(stateB), stateB.lastUpdateAt),
      futureEventAt(deps.nextHealingStepTickAt(stateA), stateA.lastUpdateAt),
      futureEventAt(deps.nextHealingStepTickAt(stateB), stateB.lastUpdateAt),
      futureEventAt(nextBreathA, stateA.lastUpdateAt),
      futureEventAt(nextBreathB, stateB.lastUpdateAt),
    );
  }

  function nextEventAtSingle(
    state: CombatantState,
    nextBreath: number,
  ): number {
    return Math.min(
      futureEventAt(state.nextHitAt, state.lastUpdateAt),
      nextDotTickAt(state),
      nextStatusDecayAt(state),
      nextChannelPulseAt(state),
      nextSelfDestructAt(state),
      futureEventAt(deps.nextLifeLeechPlannedAt(state), state.lastUpdateAt),
      futureEventAt(deps.nextAdrenalinePlannedAt(state), state.lastUpdateAt),
      futureEventAt(deps.nextHuntersCursePlannedAt(state), state.lastUpdateAt),
      futureEventAt(deps.nextFrostNovaTickAt(state), state.lastUpdateAt),
      futureEventAt(deps.nextUnbridledRagePlannedAt(state), state.lastUpdateAt),
      futureEventAt(deps.nextRegenAt(state), state.lastUpdateAt),
      futureEventAt(deps.nextTotemTickAt(state), state.lastUpdateAt),
      futureEventAt(deps.nextTotemReadyAt(state), state.lastUpdateAt),
      futureEventAt(deps.nextDrowsyAreaReadyAt(state), state.lastUpdateAt),
      futureEventAt(deps.nextRadiationTickAt(state), state.lastUpdateAt),
      futureEventAt(deps.nextCauseFearReadyAt(state), state.lastUpdateAt),
      futureEventAt(deps.nextRefluxChargeReadyAt(state), state.lastUpdateAt),
      futureEventAt(deps.nextRefluxTickAt(state), state.lastUpdateAt),
      futureEventAt(deps.nextLanceAuraTickAt(state), state.lastUpdateAt),
      futureEventAt(deps.nextShadowBarrageHitAt(state), state.lastUpdateAt),
      futureEventAt(deps.nextToxicTrapTickAt(state), state.lastUpdateAt),
      futureEventAt(deps.nextDamageTrailTickAt(state), state.lastUpdateAt),
      futureEventAt(deps.nextHealingStepTickAt(state), state.lastUpdateAt),
      futureEventAt(nextBreath, state.lastUpdateAt),
    );
  }

  function describeEventSources(
    stateA: CombatantState,
    stateB: CombatantState,
    nextBreathA: number,
    nextBreathB: number,
  ): Array<{ label: string; value: number }> {
    const pairs: Array<{ label: string; value: number }> = [];
    const push = (label: string, val: number) => pairs.push({ label, value: val });
    push("A.nextHitAt", futureEventAt(stateA.nextHitAt, stateA.lastUpdateAt));
    push("B.nextHitAt", futureEventAt(stateB.nextHitAt, stateB.lastUpdateAt));
    push("A.dotTick", nextDotTickAt(stateA));
    push("B.dotTick", nextDotTickAt(stateB));
    push("A.statusDecay", nextStatusDecayAt(stateA));
    push("B.statusDecay", nextStatusDecayAt(stateB));
    push("A.channelPulse", nextChannelPulseAt(stateA));
    push("B.channelPulse", nextChannelPulseAt(stateB));
    push("A.selfDestruct", nextSelfDestructAt(stateA));
    push("B.selfDestruct", nextSelfDestructAt(stateB));
    push("A.lifeLeech", futureEventAt(deps.nextLifeLeechPlannedAt(stateA), stateA.lastUpdateAt));
    push("B.lifeLeech", futureEventAt(deps.nextLifeLeechPlannedAt(stateB), stateB.lastUpdateAt));
    push("A.adrenaline", futureEventAt(deps.nextAdrenalinePlannedAt(stateA), stateA.lastUpdateAt));
    push("B.adrenaline", futureEventAt(deps.nextAdrenalinePlannedAt(stateB), stateB.lastUpdateAt));
    push("A.huntersCurse", futureEventAt(deps.nextHuntersCursePlannedAt(stateA), stateA.lastUpdateAt));
    push("B.huntersCurse", futureEventAt(deps.nextHuntersCursePlannedAt(stateB), stateB.lastUpdateAt));
    push("A.frostNova", futureEventAt(deps.nextFrostNovaTickAt(stateA), stateA.lastUpdateAt));
    push("B.frostNova", futureEventAt(deps.nextFrostNovaTickAt(stateB), stateB.lastUpdateAt));
    push("A.rage", futureEventAt(deps.nextUnbridledRagePlannedAt(stateA), stateA.lastUpdateAt));
    push("B.rage", futureEventAt(deps.nextUnbridledRagePlannedAt(stateB), stateB.lastUpdateAt));
    push("A.regen", futureEventAt(deps.nextRegenAt(stateA), stateA.lastUpdateAt));
    push("B.regen", futureEventAt(deps.nextRegenAt(stateB), stateB.lastUpdateAt));
    push("A.totemTick", futureEventAt(deps.nextTotemTickAt(stateA), stateA.lastUpdateAt));
    push("B.totemTick", futureEventAt(deps.nextTotemTickAt(stateB), stateB.lastUpdateAt));
    push("A.totemReady", futureEventAt(deps.nextTotemReadyAt(stateA), stateA.lastUpdateAt));
    push("B.totemReady", futureEventAt(deps.nextTotemReadyAt(stateB), stateB.lastUpdateAt));
    push("A.drowsyReady", futureEventAt(deps.nextDrowsyAreaReadyAt(stateA), stateA.lastUpdateAt));
    push("B.drowsyReady", futureEventAt(deps.nextDrowsyAreaReadyAt(stateB), stateB.lastUpdateAt));
    push("A.radTick", futureEventAt(deps.nextRadiationTickAt(stateA), stateA.lastUpdateAt));
    push("B.radTick", futureEventAt(deps.nextRadiationTickAt(stateB), stateB.lastUpdateAt));
    push("A.causeFearReady", futureEventAt(deps.nextCauseFearReadyAt(stateA), stateA.lastUpdateAt));
    push("B.causeFearReady", futureEventAt(deps.nextCauseFearReadyAt(stateB), stateB.lastUpdateAt));
    push("A.refluxCharge", futureEventAt(deps.nextRefluxChargeReadyAt(stateA), stateA.lastUpdateAt));
    push("B.refluxCharge", futureEventAt(deps.nextRefluxChargeReadyAt(stateB), stateB.lastUpdateAt));
    push("A.refluxTick", futureEventAt(deps.nextRefluxTickAt(stateA), stateA.lastUpdateAt));
    push("B.refluxTick", futureEventAt(deps.nextRefluxTickAt(stateB), stateB.lastUpdateAt));
    push("A.lanceAura", futureEventAt(deps.nextLanceAuraTickAt(stateA), stateA.lastUpdateAt));
    push("B.lanceAura", futureEventAt(deps.nextLanceAuraTickAt(stateB), stateB.lastUpdateAt));
    push("A.shadowBarrage", futureEventAt(deps.nextShadowBarrageHitAt(stateA), stateA.lastUpdateAt));
    push("B.shadowBarrage", futureEventAt(deps.nextShadowBarrageHitAt(stateB), stateB.lastUpdateAt));
    push("A.damageTrail", futureEventAt(deps.nextDamageTrailTickAt(stateA), stateA.lastUpdateAt));
    push("B.damageTrail", futureEventAt(deps.nextDamageTrailTickAt(stateB), stateB.lastUpdateAt));
    push("A.healingStep", futureEventAt(deps.nextHealingStepTickAt(stateA), stateA.lastUpdateAt));
    push("B.healingStep", futureEventAt(deps.nextHealingStepTickAt(stateB), stateB.lastUpdateAt));
    push("A.breath", futureEventAt(nextBreathA, stateA.lastUpdateAt));
    push("B.breath", futureEventAt(nextBreathB, stateB.lastUpdateAt));
    return pairs;
  }

  return {
    nextSelfDestructAt,
    nextEventAt,
    nextEventAtSingle,
    describeEventSources,
  };
}
