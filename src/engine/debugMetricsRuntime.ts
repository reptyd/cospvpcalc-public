import type { FinalStats, SimulationDebug } from "./types";
import type { CombatantRuntime, CombatantState } from "./runtimeContext";
import type { DebugDeps } from "./debugRuntimeTypes";
import { sanitizeAbilityTimingOverrides } from "./abilityTimingOverrides";
import { WARDEN_RESISTANCE_HP_RATIO_THRESHOLD } from "./conditionalPassiveRuntime";

type DebugMetricsDeps = DebugDeps & {
  getPresentAbilityNames: (effects: CombatantRuntime["effects"]) => string[];
  getModeledAbilityNames: (runtime: CombatantRuntime) => string[];
};

export function createDebugMetricsRuntime(deps: DebugMetricsDeps) {
  function estimateEhp(runtime: CombatantRuntime, state: CombatantState): number {
    const mods = deps.aggregateStatusModifiers(state.statuses);
    const incomingMultiplier = deps.computeIncomingDamageMultiplier(runtime, state, mods, true);
    if (incomingMultiplier <= 0) return Number.POSITIVE_INFINITY;
    return runtime.final.health / incomingMultiplier;
  }

  function computeDotDps(runtime: CombatantRuntime, state: CombatantState): number {
    let total = 0;
    for (const [statusId, instance] of Object.entries(state.statuses)) {
      const status = deps.getStatusDefinition(statusId);
      const dot = status?.parsed?.dot;
      if (!dot) continue;
      const tickSec = dot.tickSec ?? 3;
      const perTick = deps.computeDotDamage(runtime.final.health, status, instance.stacks, tickSec);
      total += perTick / tickSec;
    }
    return total;
  }

  function buildDebug(
    runtime: CombatantRuntime,
    state: CombatantState,
    opponentFinal: FinalStats,
    disabled: Set<string>,
  ): SimulationDebug {
    const statuses: Record<string, number> = {};
    for (const [id, inst] of Object.entries(state.statuses)) {
      statuses[id] = inst.stacks;
    }
    const ratioCap = deps.rulesWeightRatioCap;
    const rawRatio = runtime.final.weight / Math.max(1, opponentFinal.weight);
    const cappedRatio = Math.min(rawRatio, ratioCap);
    const abilitiesPresent = deps.getPresentAbilityNames(runtime.effects);
    const abilitiesModeled = deps.getModeledAbilityNames(runtime);
    const abilitiesAppliedCounts = { ...state.abilityAppliedCounts };
    if (
      runtime.hasWardenResistance &&
      !deps.isAbilityDisabled(disabled, deps.disableWardenResistance) &&
      state.hp / Math.max(1, runtime.final.health) <= WARDEN_RESISTANCE_HP_RATIO_THRESHOLD
    ) {
      abilitiesAppliedCounts["Warden's Resistance"] = (abilitiesAppliedCounts["Warden's Resistance"] ?? 0) + 1;
    }
    const abilitiesApplied = Object.entries(abilitiesAppliedCounts)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([name, count]) => ({ name, count }));
    const modeledSet = new Set(abilitiesModeled.map(deps.normalizeAbilityName));
    const abilitiesNotModeled = abilitiesPresent.filter((name) => !modeledSet.has(deps.normalizeAbilityName(name)));
    return {
      totalDamageDealt: state.damageDealt,
      totalLifeLeechHealed: state.lifeLeechHealed,
      dotDps: computeDotDps(runtime, state),
      dotDamageByStatus: { ...state.dotDamageByStatus },
      dotDamageTakenByStatus: { ...state.dotDamageTakenByStatus },
      statuses,
      statusStacksApplied: state.statusStacksApplied,
      statusStacksBlocked: state.statusStacksBlocked,
      statusBlockFractions: state.statusBlockFractions,
      regenTicks: state.regenTicks,
      regenHealed: state.regenHealed,
      attackerWeight: runtime.final.weight,
      opponentWeight: opponentFinal.weight,
      weightRatio: cappedRatio,
      weightRatioCapHit: rawRatio >= ratioCap,
      wardenRageOn: state.wardenRageOn,
      wardenRageStacks: state.wardenRageStacks,
      wardenRageCooldownUntil: state.wardenRageCooldownUntil,
      wardenRageTapUntil: state.wardenRageTapUntil || undefined,
      lifeLeechActiveUntil: state.lifeLeechActiveUntil || undefined,
      lifeLeechCooldownUntil: state.lifeLeechCooldownUntil || undefined,
      lifeLeechActive: state.lifeLeechActiveUntil > state.lastUpdateAt,
      spiteArmed: state.spiteArmed,
      spiteChargeReadyAt: state.spiteChargeReadyAt || undefined,
      spiteCooldownUntil: state.spiteCooldownUntil || undefined,
      nextRegenAt: state.nextRegenAt,
      wardenResistanceActive:
        runtime.hasWardenResistance && !deps.isAbilityDisabled(disabled, deps.disableWardenResistance)
          ? state.hp / Math.max(1, runtime.final.health) <= WARDEN_RESISTANCE_HP_RATIO_THRESHOLD
          : false,
      reflectActiveUntil: state.reflectActiveUntil,
      totemNextTickAt: state.totemNextTickAt,
      drowsyActive: Boolean(state.statuses["Drowsy_Status"]),
      wardenRageEvents: state.wardenRageEvents,
      abilityTimingEvents: state.abilityTimingEvents,
      abilityPolicyOverrides: sanitizeAbilityTimingOverrides(state.abilityPolicyOverrides),
      plushieOffensiveStacksApplied: state.plushieOffensiveStacksApplied,
      plushieDefensiveStacksApplied: state.plushieDefensiveStacksApplied,
      biteCount: state.biteCount,
      breathTickCount: state.breathTickCount,
      abilitiesPresent,
      abilitiesModeled,
      abilitiesApplied,
      abilitiesNotModeled,
      compareHunger: state.compareHunger,
      compareStartingHunger: state.compareStartingHunger,
      compareAppetiteBase: state.compareAppetiteBase,
      compareHungerRuleEnabled: state.compareHungerRuleEnabled,
    };
  }

  return {
    buildDebug,
    computeDotDps,
    estimateEhp,
  };
}
