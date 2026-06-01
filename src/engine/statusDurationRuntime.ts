import type { CombatantRuntime, CombatantState } from "./runtimeContext";
import {
  getDefiledGroundAilmentRecoveryPct,
  getDefiledGroundDecaySec,
  isDefiledGroundRecoverableStatus,
  normalizeCompareDefiledGroundLevel,
} from "./compareDefiledGroundData";
import { refreshStatusRemainingSec } from "./statusDecayMath";
import type { StatusRuntimeDeps } from "./statusRuntimeTypes";
import { PERSISTENT_STATUS_IDS } from "./subsystems/statuses";

type StatusDurationDeps = StatusRuntimeDeps & {
  triggerBadOmenOutcome: (time: number, runtime: CombatantRuntime, state: CombatantState, disabled: Set<string>) => void;
};

export function createStatusDurationRuntime(deps: StatusDurationDeps) {
  function clampStacks(instance: { stacks: number; nextDecayAt?: number | null; remainingSec: number }, maxStacks?: number): void {
    if (maxStacks == null || !Number.isFinite(maxStacks)) return;
    instance.stacks = Math.min(instance.stacks, maxStacks);
    if (instance.nextDecayAt != null) {
      instance.remainingSec = Math.min(instance.remainingSec, maxStacks * deps.statusStackDurationSec);
    }
  }

  function clampLichMarkOwnedStacks(instance: { stacks: number; lichMarkOwnedStacks?: number }): void {
    if (typeof instance.lichMarkOwnedStacks !== "number") return;
    instance.lichMarkOwnedStacks = Math.max(0, Math.min(instance.stacks, instance.lichMarkOwnedStacks));
    if (instance.lichMarkOwnedStacks <= 1e-9) {
      delete instance.lichMarkOwnedStacks;
    }
  }

  function isPersistentPvpStatus(statusId: string): boolean {
    return PERSISTENT_STATUS_IDS.has(statusId);
  }

  function formatStatusLabel(statusId: string): string {
    return statusId
      .replace(/_Status$/i, "")
      .replace(/_/g, " ")
      .trim();
  }

  function formatStacks(stacks: number): string {
    return Number.isInteger(stacks) ? String(stacks) : stacks.toFixed(2).replace(/\.?0+$/, "");
  }

  function getStatusDecaySec(state: CombatantState, statusId: string): number {
    if (statusId === "Muddy_Status") {
      return 90;
    }
    if (state.compareDefiledGroundLevel <= 0 || !isDefiledGroundRecoverableStatus(statusId)) {
      return deps.statusStackDurationSec;
    }
    const recoveryPct = getDefiledGroundAilmentRecoveryPct(normalizeCompareDefiledGroundLevel(state.compareDefiledGroundLevel));
    return getDefiledGroundDecaySec(deps.statusStackDurationSec, recoveryPct);
  }

  function markStatusClearedAt(state: CombatantState, statusId: string, time: number): void {
    state.compareStatusLastClearedAt[statusId] = time;
  }

  function shouldDeferDecayUntilAfterDotTick(time: number, instance: CombatantState["statuses"][string]): boolean {
    if (instance.nextDecayAt == null || instance.nextDecayAt > time + 1e-9) return false;
    if (instance.nextTickAt == null || instance.nextTickAt > time + 1e-9) return false;
    return true;
  }

  function applyDueDecayForStatus(
    time: number,
    runtime: CombatantRuntime,
    state: CombatantState,
    disabled: Set<string>,
    statusId: string,
  ): void {
    const instance = state.statuses[statusId];
    if (!instance) return;
    const statusDecaySec = getStatusDecaySec(state, statusId);
    const status = deps.getStatusDefinition(statusId);
    const bleedDecayBlocked = (state.statuses["Deep_Wounds_Status"]?.stacks ?? 0) > 0;
    if (isPersistentPvpStatus(statusId) && !state.compareNoMoveFacetank) {
      refreshStatusRemainingSec(instance, time, statusDecaySec);
      return;
    }
    if (bleedDecayBlocked && statusId === "Bleed_Status") {
      refreshStatusRemainingSec(instance, time, statusDecaySec);
      return;
    }

    const previousStacks = instance.stacks;
    while (instance.nextDecayAt != null && instance.nextDecayAt <= time + 1e-9) {
      instance.stacks -= 1;
      if (typeof instance.lichMarkOwnedStacks === "number" && instance.lichMarkOwnedStacks > 0) {
        instance.lichMarkOwnedStacks = Math.max(0, instance.lichMarkOwnedStacks - 1);
      }
      if (instance.stacks <= 0) break;
      instance.nextDecayAt += statusDecaySec;
    }

    if (instance.stacks <= 0) {
      if (statusId === "Lich_Mark_Status") {
        state.lichMarkPendingPayloadStatusId = null;
      }
      if (statusId === state.lichMarkOwnedPayloadStatusId) {
        state.lichMarkOwnedPayloadStatusId = null;
      }
      if (previousStacks > 0) {
        state.combatLog.push({
          time,
          type: "ability",
          attacker: state.sideLabel,
          damage: 0,
          actorHpAfter: Math.max(0, state.hp),
          hpSide: state.sideLabel,
          hpAfter: Math.max(0, state.hp),
          description: `${formatStatusLabel(statusId)} naturally expired`,
          detail: `${formatStacks(previousStacks)} -> 0 stacks`,
          statusId,
        });
      }
      delete state.statuses[statusId];
      markStatusClearedAt(state, statusId, time);
      if (statusId === deps.badOmenStatusId) {
        deps.triggerBadOmenOutcome(time, runtime, state, disabled);
      }
      return;
    }

    if (status?.parsed?.caps?.stacking === "none") instance.stacks = 1;
    refreshStatusRemainingSec(instance, time, statusDecaySec);
    clampStacks(instance, status?.parsed?.caps?.maxStacks);
    clampLichMarkOwnedStacks(instance);
    if (statusId === "Lich_Mark_Status" && instance.stacks <= 0) {
      state.lichMarkPendingPayloadStatusId = null;
    }
    if (statusId === state.lichMarkOwnedPayloadStatusId && (instance.lichMarkOwnedStacks ?? 0) <= 0) {
      state.lichMarkOwnedPayloadStatusId = null;
    }
    if (instance.stacks < previousStacks - 1e-9) {
      state.combatLog.push({
        time,
        type: "ability",
        attacker: state.sideLabel,
        damage: 0,
        actorHpAfter: Math.max(0, state.hp),
        hpSide: state.sideLabel,
        hpAfter: Math.max(0, state.hp),
        description: `${formatStatusLabel(statusId)} naturally decayed`,
        detail: `${formatStacks(previousStacks)} -> ${formatStacks(instance.stacks)} stacks`,
        statusId,
      });
    }
  }

  function updateStatusDurations(
    time: number,
    _delta: number,
    runtime: CombatantRuntime,
    state: CombatantState,
    disabled: Set<string>,
  ): void {
    const bleedDecayBlocked = (state.statuses["Deep_Wounds_Status"]?.stacks ?? 0) > 0;
    for (const [statusId, instance] of Object.entries(state.statuses)) {
      const statusDecaySec = getStatusDecaySec(state, statusId);
      const status = deps.getStatusDefinition(statusId);
      if (isPersistentPvpStatus(statusId) && !state.compareNoMoveFacetank) {
        refreshStatusRemainingSec(instance, time, statusDecaySec);
        continue;
      }
      if (bleedDecayBlocked && statusId === "Bleed_Status") {
        refreshStatusRemainingSec(instance, time, statusDecaySec);
        continue;
      }
      if (shouldDeferDecayUntilAfterDotTick(time, instance)) {
        refreshStatusRemainingSec(instance, time, statusDecaySec);
        continue;
      }
      const previousStacks = instance.stacks;
      while (instance.nextDecayAt != null && instance.nextDecayAt <= time + 1e-9) {
        instance.stacks -= 1;
        if (typeof instance.lichMarkOwnedStacks === "number" && instance.lichMarkOwnedStacks > 0) {
          instance.lichMarkOwnedStacks = Math.max(0, instance.lichMarkOwnedStacks - 1);
        }
        if (instance.stacks <= 0) break;
        instance.nextDecayAt += statusDecaySec;
      }
      if (instance.stacks <= 0) {
        if (statusId === "Lich_Mark_Status") {
          state.lichMarkPendingPayloadStatusId = null;
        }
        if (statusId === state.lichMarkOwnedPayloadStatusId) {
          state.lichMarkOwnedPayloadStatusId = null;
        }
        if (previousStacks > 0) {
          state.combatLog.push({
            time,
            type: "ability",
            attacker: state.sideLabel,
            damage: 0,
            actorHpAfter: Math.max(0, state.hp),
            hpSide: state.sideLabel,
            hpAfter: Math.max(0, state.hp),
            description: `${formatStatusLabel(statusId)} naturally expired`,
            detail: `${formatStacks(previousStacks)} -> 0 stacks`,
            statusId,
          });
        }
        delete state.statuses[statusId];
        markStatusClearedAt(state, statusId, time);
        if (statusId === deps.badOmenStatusId) {
          deps.triggerBadOmenOutcome(time, runtime, state, disabled);
        }
        continue;
      }
      if (status?.parsed?.caps?.stacking === "none") instance.stacks = 1;
      refreshStatusRemainingSec(instance, time, statusDecaySec);
      clampStacks(instance, status?.parsed?.caps?.maxStacks);
      clampLichMarkOwnedStacks(instance);
      if (statusId === "Lich_Mark_Status" && instance.stacks <= 0) {
        state.lichMarkPendingPayloadStatusId = null;
      }
      if (statusId === state.lichMarkOwnedPayloadStatusId && (instance.lichMarkOwnedStacks ?? 0) <= 0) {
        state.lichMarkOwnedPayloadStatusId = null;
      }
      if (instance.stacks < previousStacks - 1e-9) {
        state.combatLog.push({
          time,
          type: "ability",
          attacker: state.sideLabel,
          damage: 0,
          actorHpAfter: Math.max(0, state.hp),
          hpSide: state.sideLabel,
          hpAfter: Math.max(0, state.hp),
          description: `${formatStatusLabel(statusId)} naturally decayed`,
          detail: `${formatStacks(previousStacks)} -> ${formatStacks(instance.stacks)} stacks`,
          statusId,
        });
      }
    }
  }

  return {
    applyDueDecayForStatus,
    updateStatusDurations,
  };
}
