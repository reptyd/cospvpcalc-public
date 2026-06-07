import type { StatusEffect, SpecialAbilityDef } from "./types";
import type { CombatantRuntime, CombatantState } from "./runtimeContext";

type RegenDeps = {
  passiveRegenTickSec: number;
  getStatusDefinition: (statusId: string) => StatusEffect | undefined;
};

export function createRegenRuntime(deps: RegenDeps) {
  function isConditionalHpRegenBoostDef(
    def: SpecialAbilityDef,
  ): def is Extract<SpecialAbilityDef, { type: "conditionalHpRegenBoost" }> {
    return def.type === "conditionalHpRegenBoost" && "trigger" in def;
  }

  function computeQuickRecoveryMultiplier(state: CombatantState, runtime: CombatantRuntime): number {
    const hpRatio = state.hp / Math.max(1, runtime.final.health);
    let multiplier = 1;
    for (const def of runtime.specialDefs) {
      if (!isConditionalHpRegenBoostDef(def)) continue;
      const threshold = def.trigger.hpRatioLte ?? def.trigger.hpRatioLt ?? 0;
      if (!(threshold > 0)) continue;
      const cappedRatio = Math.max(threshold, Math.min(1, hpRatio));
      const progress = (1 - cappedRatio) / (1 - threshold);
      const bonusPct = Math.max(0, Math.min(1, progress));
      multiplier *= 1 + bonusPct;
    }
    return multiplier;
  }

  function computeRegenMultiplier(state: CombatantState, runtime: CombatantRuntime): number {
    if (runtime.hasWardenRage && state.wardenRageOn) return 0;
    let multiplier = 1;
    for (const [statusId, instance] of Object.entries(state.statuses)) {
      const status = deps.getStatusDefinition(statusId);
      const mods = status?.parsed?.modifiers ?? {};
      if (mods.disablesHpRegen === true) return 0;
      if (statusId === "Burn_Status") {
        multiplier *= Math.max(0, 1 - 0.1 * instance.stacks);
        continue;
      }
      if (statusId === "Disease_Status") {
        multiplier *= Math.max(0, 1 - 0.15 * instance.stacks);
        continue;
      }
      if (typeof mods.hpRegenDebuffPerStackPct === "number") {
        multiplier *= Math.max(0, 1 - (mods.hpRegenDebuffPerStackPct * instance.stacks) / 100);
      } else if (typeof mods.hpRegenDebuffPct === "number") {
        multiplier *= Math.max(0, 1 - mods.hpRegenDebuffPct / 100);
      }
      if (typeof mods.hpRegenBoostPct === "number") {
        multiplier *= 1 + mods.hpRegenBoostPct / 100;
      }
    }
    multiplier *= computeQuickRecoveryMultiplier(state, runtime);
    return Math.max(0, multiplier);
  }

  function maybeCancelSelfDestructOnHeal(runtime: CombatantRuntime, state: CombatantState): void {
    if (state.selfDestructArmedAt === null) return;
    const selfDestruct = runtime.specialDefs.find(
      (def): def is Extract<SpecialAbilityDef, { type: "conditionalDelayedExplosion" }> =>
        def.type === "conditionalDelayedExplosion",
    );
    if (!selfDestruct) return;
    const hpRatio = state.hp / Math.max(1, runtime.final.health);
    const trigger = selfDestruct.trigger;
    const active = (trigger.hpRatioLte != null && hpRatio <= trigger.hpRatioLte) || (trigger.hpRatioLt != null && hpRatio < trigger.hpRatioLt);
    if (!active) {
      state.selfDestructArmedAt = null;
    }
  }

  function handlePassiveRegen(time: number, runtime: CombatantRuntime, state: CombatantState): void {
    const regenPct = runtime.final.healthRegen ?? 0;
    const hardenMultiplier = state.hardenActiveUntil > state.lastUpdateAt ? 1.25 : 1;
    const multiplierNow = computeRegenMultiplier(state, runtime) * hardenMultiplier;
    const blockedNow = regenPct <= 0 || multiplierNow <= 0;

    while (state.nextRegenAt <= time) {
      if (blockedNow) {
        if (regenPct > 0) state.regenBufferedTick = true;
      } else if (state.hp < runtime.final.health) {
        const heal = (runtime.final.health * regenPct * multiplierNow) / 100;
        if (heal > 0) {
          state.hp = Math.min(runtime.final.health, state.hp + heal);
          state.regenHealed += heal;
          state.combatLog.push({
            time: state.nextRegenAt,
            type: "ability",
            attacker: state.sideLabel,
            damage: 0,
            healing: heal,
            actorHpAfter: state.hp,
            hpSide: state.sideLabel,
            hpAfter: state.hp,
            description: "Natural regen",
          });
          maybeCancelSelfDestructOnHeal(runtime, state);
        }
      }
      if (regenPct > 0) state.regenTicks += 1;
      state.nextRegenAt += deps.passiveRegenTickSec;
    }

    if (regenPct > 0 && !blockedNow && state.regenBufferedTick) {
      if (state.hp < runtime.final.health) {
        const heal = (runtime.final.health * regenPct * multiplierNow) / 100;
        if (heal > 0) {
          state.hp = Math.min(runtime.final.health, state.hp + heal);
          state.regenHealed += heal;
          state.combatLog.push({
            time,
            type: "ability",
            attacker: state.sideLabel,
            damage: 0,
            healing: heal,
            actorHpAfter: state.hp,
            hpSide: state.sideLabel,
            hpAfter: state.hp,
            description: "Natural regen",
          });
          maybeCancelSelfDestructOnHeal(runtime, state);
        }
      }
      state.regenTicks += 1;
      state.regenBufferedTick = false;
    }
  }

  return {
    computeRegenMultiplier,
    handlePassiveRegen,
  };
}
