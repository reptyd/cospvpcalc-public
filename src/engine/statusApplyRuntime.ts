import type { CombatantRuntime, CombatantState, StatusApplyContext } from "./runtimeContext";
import { addApproximationNoteOnce } from "./approximationNotes";
import {
  getDefiledGroundAilmentRecoveryPct,
  getDefiledGroundDecaySec,
  isDefiledGroundRecoverableStatus,
  normalizeCompareDefiledGroundLevel,
} from "./compareDefiledGroundData";
import { refreshStatusRemainingSec } from "./statusDecayMath";
import { combineStatusBlockFractions, getRawElderBlockFraction } from "./statusBlockMath";
import type { StatusRuntimeDeps } from "./statusRuntimeTypes";
import { PERSISTENT_STATUS_IDS } from "./subsystems/statuses";
import { WARDEN_RESISTANCE_HP_RATIO_THRESHOLD } from "./conditionalPassiveRuntime";

type StatusApplyDeps = StatusRuntimeDeps & {
  triggerBadOmenOutcome: (time: number, runtime: CombatantRuntime, state: CombatantState, disabled: Set<string>) => void;
};

export function createStatusApplyRuntime(deps: StatusApplyDeps) {
  const COMPARE_FIRST_AILMENT_REARM_SEC = 3;

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

  function markStatusClearedAt(state: CombatantState, statusId: string, time: number): void {
    state.compareStatusLastClearedAt[statusId] = time;
  }

  function shouldUseCompareFirstAilmentTick(
    state: CombatantState,
    statusId: string,
    time: number,
    existing: { stacks: number } | undefined,
  ): boolean {
    if (existing) return false;
    if (state.compareFirstTickMode !== "ailments" && state.compareFirstTickMode !== "both") return false;
    const lastClearedAt = state.compareStatusLastClearedAt[statusId];
    if (typeof lastClearedAt !== "number") return true;
    return time - lastClearedAt >= COMPARE_FIRST_AILMENT_REARM_SEC - 1e-9;
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

  function getStatusDecaySec(targetState: CombatantState, statusId: string): number {
    if (statusId === "Muddy_Status") {
      return 90;
    }
    if (targetState.compareDefiledGroundLevel <= 0 || !isDefiledGroundRecoverableStatus(statusId)) {
      return deps.statusStackDurationSec;
    }
    const recoveryPct = getDefiledGroundAilmentRecoveryPct(normalizeCompareDefiledGroundLevel(targetState.compareDefiledGroundLevel));
    return getDefiledGroundDecaySec(deps.statusStackDurationSec, recoveryPct);
  }

  function isImmune(target: CombatantRuntime, statusId: string): boolean {
    return target.specialDefs.some(
      (def) => def.type === "statusImmunity" && "immuneTo" in def && def.immuneTo.includes(statusId),
    );
  }

  function getStatusResistFraction(
    target: CombatantRuntime,
    statusId: string,
    disabled?: Set<string>,
  ): number {
    const resist = target.effects.resistStatus ?? [];
    const entry = resist.find(
      (item) =>
        item.statusId === statusId &&
        !deps.isAbilityDisabled(disabled ?? new Set(), deps.normalizeAbilityName(item.sourceAbility)),
    );
    return entry?.fraction ?? 0;
  }

  function applyStatusToTarget(ctx: StatusApplyContext): void {
    const { time, target, statusId, stacks } = ctx;
    const targetRuntime = target.runtime;
    const targetState = target.state;
    const targetDisabled = target.disabled;
    if (stacks === 0) return;
    const isHealing = stacks < 0;
    if (!isHealing) {
      if (targetState.fortifyImmuneUntil > time) {
        return;
      }
      if (targetRuntime.hasWardenResistance && !targetDisabled?.has(deps.disableWardenResistance)) {
        const hpRatio = targetState.hp / Math.max(1, targetRuntime.final.health);
        if (hpRatio <= WARDEN_RESISTANCE_HP_RATIO_THRESHOLD) return;
      }
      if (isImmune(targetRuntime, statusId)) return;
    }

    const blocksDisabled = targetDisabled?.has(deps.disableStatusBlocks);
    const resistFraction =
      !isHealing && !blocksDisabled ? getStatusResistFraction(targetRuntime, statusId, targetDisabled) : 0;
    const plushieBlock = !isHealing && !blocksDisabled ? deps.getPlushieBlockFraction(targetRuntime.final, statusId) : 0;
    const elderBlock = !isHealing && !blocksDisabled ? getRawElderBlockFraction(targetRuntime.final) : 0;
    const resistVulnerabilityMultiplier = resistFraction < 0 ? 1 - resistFraction : 1;
    const totalBlockFraction = combineStatusBlockFractions(Math.max(0, resistFraction), plushieBlock, elderBlock);
    const appliedStacks = stacks * resistVulnerabilityMultiplier * Math.max(0, 1 - totalBlockFraction);
    if (appliedStacks === 0) return;

    if (!isHealing && stacks > 0) {
      const blocked = stacks - appliedStacks;
      if (blocked > 0) {
        targetState.statusStacksBlocked[statusId] =
          (targetState.statusStacksBlocked[statusId] ?? 0) + blocked;
        const effectiveFraction = Math.min(1, Math.max(0, blocked / stacks));
        const prevFraction = targetState.statusBlockFractions[statusId] ?? 0;
        targetState.statusBlockFractions[statusId] = Math.max(prevFraction, effectiveFraction);
      }
      targetState.statusStacksApplied[statusId] =
        (targetState.statusStacksApplied[statusId] ?? 0) + appliedStacks;
    }

    const status = deps.getStatusDefinition(statusId);
    const existing = targetState.statuses[statusId];
    const statusDecaySec = getStatusDecaySec(targetState, statusId);
    if (!isHealing && status?.parsed?.caps?.stacking === "none" && existing) {
      return;
    }

    const instance = existing ?? { stacks: 0, nextTickAt: null, nextDecayAt: null, remainingSec: 0 };
    if (ctx.stackValueMode) {
      instance.stackValueMode = ctx.stackValueMode;
    }
    const previousStacks = instance.stacks;
    const previousOwnedStacks = instance.lichMarkOwnedStacks ?? 0;
    instance.stacks += appliedStacks;
    if (instance.stacks <= 0) {
      if (ctx.source && ctx.sourceAbilityName && previousStacks > 0) {
        ctx.source.combatLog.push({
          time,
          type: "ability",
          attacker: ctx.source.sideLabel,
          damage: 0,
          actorHpAfter: Math.max(0, ctx.source.hp ?? 0),
          hpSide: targetState.sideLabel,
          hpAfter: Math.max(0, targetState.hp),
          description: `${ctx.sourceAbilityName} removed ${formatStatusLabel(statusId)} (${formatStacks(previousStacks)})`,
          detail: `${formatStacks(previousStacks)} -> 0 stacks`,
          statusId,
        });
      }
      if (statusId === "Lich_Mark_Status") {
        targetState.lichMarkPendingPayloadStatusId = null;
      }
      if (statusId === targetState.lichMarkOwnedPayloadStatusId) {
        targetState.lichMarkOwnedPayloadStatusId = null;
      }
      delete targetState.statuses[statusId];
      markStatusClearedAt(targetState, statusId, time);
      if (statusId === deps.badOmenStatusId) {
        deps.triggerBadOmenOutcome(time, targetRuntime, targetState, targetDisabled ?? new Set());
      }
      return;
    }
    if (appliedStacks < 0) {
      const removedStacks = Math.max(0, previousStacks - instance.stacks);
      if (removedStacks > 0 && previousOwnedStacks > 0) {
        instance.lichMarkOwnedStacks = Math.max(0, previousOwnedStacks - removedStacks);
      }
    } else if ((ctx.lichMarkOwnedStacks ?? 0) > 0) {
      instance.lichMarkOwnedStacks = previousOwnedStacks + Math.min(appliedStacks, ctx.lichMarkOwnedStacks ?? 0);
    }
    instance.stacks = status?.parsed?.caps?.stacking === "none" ? 1 : instance.stacks;
    if (isPersistentPvpStatus(statusId) && !targetState.compareNoMoveFacetank) {
      instance.nextDecayAt = null;
    } else if (existing?.nextDecayAt == null) {
      instance.nextDecayAt = time + statusDecaySec;
    }

    if (status?.parsed?.type === "dot" && instance.nextTickAt === null) {
      const tickSec = status.parsed.dot?.tickSec ?? 3;
      if (status.parsed.dot?.tickSec == null) {
        addApproximationNoteOnce(targetState.approxNotes, `Status ${statusId} missing tickSec; using 3s ticks (approx).`);
      }
      instance.nextTickAt =
        time +
        (shouldUseCompareFirstAilmentTick(targetState, statusId, time, existing)
          ? Math.min(targetState.compareFirstTickDelaySec, tickSec)
          : tickSec);
    }
    refreshStatusRemainingSec(instance, time, statusDecaySec);
    clampStacks(instance, status?.parsed?.caps?.maxStacks);
    clampLichMarkOwnedStacks(instance);

    if (statusId === "Lich_Mark_Status" && instance.stacks <= 0) {
      targetState.lichMarkPendingPayloadStatusId = null;
    }
    if (statusId === targetState.lichMarkOwnedPayloadStatusId && (instance.lichMarkOwnedStacks ?? 0) <= 0) {
      targetState.lichMarkOwnedPayloadStatusId = null;
    }

    targetState.statuses[statusId] = instance;
    if (ctx.source && ctx.sourceAbilityName && Math.abs(instance.stacks - previousStacks) > 1e-9) {
      const delta = instance.stacks - previousStacks;
      const verb = delta > 0 ? "applied" : "removed";
      ctx.source.combatLog.push({
        time,
        type: "ability",
        attacker: ctx.source.sideLabel,
        damage: 0,
        actorHpAfter: Math.max(0, ctx.source.hp ?? 0),
        hpSide: targetState.sideLabel,
        hpAfter: Math.max(0, targetState.hp),
        description: `${ctx.sourceAbilityName} ${verb} ${formatStatusLabel(statusId)} (${formatStacks(Math.abs(delta))})`,
        detail: `${formatStacks(previousStacks)} -> ${formatStacks(instance.stacks)} stacks`,
        statusId,
      });
    }
  }

  return {
    applyStatusToTarget,
  };
}
