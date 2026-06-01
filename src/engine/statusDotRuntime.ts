import type {
  CombatantRuntime,
  CombatantState,
  DotTickContext,
  HealStatusesContext,
  StatusDefGetter,
} from "./runtimeContext";
import type { StatusEffect } from "./types";

type StatusDotDeps = {
  getStatusDefinition: StatusDefGetter;
  applyDueDecayForStatus: (
    time: number,
    runtime: CombatantRuntime,
    state: CombatantState,
    disabled: Set<string>,
    statusId: string,
  ) => void;
  applyStatusToTarget: (ctx: {
    time: number;
    target: { runtime: CombatantRuntime; state: CombatantState; disabled: Set<string> };
    statusId: string;
    stacks: number;
    source?: Pick<CombatantState, "sideLabel" | "combatLog">;
    sourceAbilityName?: string;
  }) => void;
};

export function createStatusDotRuntime(deps: StatusDotDeps) {
  function bleedHealingBlocked(state: CombatantState): boolean {
    return (state.statuses["Deep_Wounds_Status"]?.stacks ?? 0) > 0;
  }

  function formatStatusLabel(status: StatusEffect): string {
    return status.name
      .replace(/_Status$/i, "")
      .replace(/\s+Status$/i, "")
      .trim();
  }

  function formatStacks(stacks: number): string {
    return Number.isInteger(stacks) ? String(stacks) : stacks.toFixed(2).replace(/\.?0+$/, "");
  }

  function computeDotDamage(maxHp: number, status: StatusEffect, stacks: number, tickSec: number): number {
    const dot = status.parsed?.dot;
    if (!dot) return 0;

    if (status.id === "Poison_Status") {
      return (maxHp * (0.2 + 0.05 * stacks)) / 100;
    }
    if (status.id === "Burn_Status") {
      return (maxHp * (0.25 + 0.1 * stacks)) / 100;
    }
    if (status.id === "Corrosion_Status") {
      return (maxHp * 0.5) / 100;
    }
    if (status.id === "Bleed_Status") {
      return 2 * stacks * tickSec;
    }

    if (dot.mode === "flat") {
      const perSec = dot.damagePerStackPerSec ?? 0;
      return perSec * stacks * tickSec;
    }

    if (dot.mode === "percentMaxHp") {
      if (dot.flatPerTickPct != null) {
        return (maxHp * dot.flatPerTickPct) / 100;
      }
      const base = dot.base ?? 0;
      const perStack = dot.perStack ?? 0;
      return (maxHp * (base + perStack * stacks)) / 100;
    }

    return 0;
  }

  function handleDotTicks(ctx: DotTickContext): void {
    const { time, target, sourceState } = ctx;
    const runtime = target.runtime;
    const state = target.state;
    for (const [statusId, instance] of Object.entries(state.statuses)) {
      if (instance.nextTickAt == null || instance.nextTickAt > time) continue;
      const status = deps.getStatusDefinition(statusId);
      if (!status?.parsed?.dot) continue;

      const tickSec = status.parsed.dot.tickSec ?? 3;
      if (statusId === "Blessings_Boon") {
        const heartbroken = (state.statuses["Heartbroken_Status"]?.stacks ?? 0) > 0;
        const heal = heartbroken ? 0 : (runtime.final.health * 3) / 100;
        if (heal > 0) {
          state.hp = Math.min(runtime.final.health, state.hp + heal);
          state.combatLog.push({
            time,
            type: "ability",
            attacker: state.sideLabel,
            damage: 0,
            healing: heal,
            actorHpAfter: state.hp,
            hpSide: state.sideLabel,
            hpAfter: state.hp,
            description: "Blessing's Boon heal",
            detail: `${formatStacks(instance.stacks)} stacks`,
            statusId,
          });
        }
        instance.nextTickAt = time + tickSec;
        deps.applyDueDecayForStatus(time, runtime, state, target.disabled, statusId);
        continue;
      }
      const damage = computeDotDamage(runtime.final.health, status, instance.stacks, tickSec);
      if (damage > 0) {
        state.hp -= damage;
        state.dotDamageTakenByStatus[statusId] = (state.dotDamageTakenByStatus[statusId] ?? 0) + damage;
        if (sourceState) {
          sourceState.damageDealt += damage;
          sourceState.dotDamageDealt += damage;
          sourceState.dotDamageByStatus[statusId] = (sourceState.dotDamageByStatus[statusId] ?? 0) + damage;
          sourceState.combatLog.push({
            time,
            type: "dot",
            attacker: sourceState.sideLabel,
            damage,
            actorHpAfter: Math.max(0, sourceState.hp),
            hpSide: state.sideLabel,
            hpAfter: Math.max(0, state.hp),
            description: `${formatStatusLabel(status)} tick`,
            detail: `${formatStacks(instance.stacks)} stacks`,
            statusId,
          });
        }
      }

      // Heat Wave applies +2 Burn stacks per tick on top of its own damage.
      if (statusId === "Heat_Wave_Status") {
        deps.applyStatusToTarget({
          time,
          target,
          statusId: "Burn_Status",
          stacks: 2,
          source: sourceState,
          sourceAbilityName: "Heat Wave",
        });
      }

      instance.nextTickAt = time + tickSec;
      deps.applyDueDecayForStatus(time, runtime, state, target.disabled, statusId);
    }
  }

  function healStatusStacks(ctx: HealStatusesContext): void {
    const { time, target, stacksToHeal } = ctx;
    const runtime = target.runtime;
    const state = target.state;
    const disabled = target.disabled;
    if (stacksToHeal <= 0) return;
    const healableStatuses = ["Poison_Status", "Burn_Status", "Bleed_Status", "Corrosion_Status"];
    let remainingHeal = stacksToHeal;
    const muddyBoost = state.statuses["Muddy_Status"] ? 2 : 1;
    for (const statusId of healableStatuses) {
      if (remainingHeal <= 0) break;
      if (statusId === "Bleed_Status" && bleedHealingBlocked(state)) continue;
      const instance = state.statuses[statusId];
      if (!instance) continue;
      const multiplier = statusId === "Poison_Status" || statusId === "Bleed_Status" ? muddyBoost : 1;
      const healCapacity = remainingHeal * multiplier;
      const healAmount = Math.min(healCapacity, instance.stacks);
      deps.applyStatusToTarget({ time, target: { runtime, state, disabled }, statusId, stacks: -healAmount });
      remainingHeal -= healAmount / multiplier;
    }
  }

  return {
    computeDotDamage,
    handleDotTicks,
    healStatusStacks,
  };
}
