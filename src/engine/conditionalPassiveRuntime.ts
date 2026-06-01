import type { CombatantRuntime, CombatantState } from "./runtimeContext";
import type { SpecialAbilityDef } from "./types";

export const WARDEN_RESISTANCE_HP_RATIO_THRESHOLD = 0.5;

function hasActiveFirstStrike(runtime: CombatantRuntime, state: CombatantState, disabled: Set<string>): boolean {
  if (disabled.has("First Strike")) return false;
  const firstStrike = runtime.specialDefs.find((def) => def.type === "conditionalDamageBoost") as
    | Extract<SpecialAbilityDef, { type: "conditionalDamageBoost" }>
    | undefined;
  if (!firstStrike) return false;
  const value = runtime.abilityValueByName["First Strike"];
  if (typeof value !== "number" || !Number.isFinite(value)) return false;
  const hpRatio = state.hp / Math.max(1, runtime.final.health);
  const trigger = firstStrike.trigger;
  return (trigger.hpRatioGte != null && hpRatio >= trigger.hpRatioGte) || (trigger.hpRatioGt != null && hpRatio > trigger.hpRatioGt);
}

function hasActiveBerserk(
  runtime: CombatantRuntime,
  state: CombatantState,
  disabled: Set<string>,
  activesOn: boolean,
): boolean {
  if (!activesOn || disabled.has("Berserk")) return false;
  const berserk = runtime.specialDefs.find((def) => def.type === "conditionalMultiStat") as
    | Extract<SpecialAbilityDef, { type: "conditionalMultiStat" }>
    | undefined;
  if (!berserk?.mods.biteCooldownMultiplier || Math.abs(berserk.mods.biteCooldownMultiplier - 1) <= 1e-9) return false;
  const hpRatio = state.hp / Math.max(1, runtime.final.health);
  const trigger = berserk.trigger;
  return (trigger.hpRatioLt != null && hpRatio < trigger.hpRatioLt) || (trigger.hpRatioLte != null && hpRatio <= trigger.hpRatioLte);
}

function hasActiveWardenResistance(runtime: CombatantRuntime, state: CombatantState, disabled: Set<string>): boolean {
  if (!runtime.hasWardenResistance || disabled.has("Warden's Resistance")) return false;
  const hpRatio = state.hp / Math.max(1, runtime.final.health);
  return hpRatio <= WARDEN_RESISTANCE_HP_RATIO_THRESHOLD;
}

function appendConditionalPassiveTransition(
  state: CombatantState,
  time: number,
  abilityName: string,
  active: boolean,
): void {
  state.abilityAppliedCounts[abilityName] = (state.abilityAppliedCounts[abilityName] ?? 0) + 1;
  state.combatLog.push({
    time,
    type: "ability",
    attacker: state.sideLabel,
    damage: 0,
    actorHpAfter: Math.max(0, state.hp),
    hpSide: state.sideLabel,
    hpAfter: Math.max(0, state.hp),
    description: `${abilityName} ${active ? "activated" : "deactivated"}`,
  });
}

export function syncConditionalPassiveTimeline(
  time: number,
  runtime: CombatantRuntime,
  state: CombatantState,
  disabled: Set<string>,
  activesOn: boolean,
): void {
  const statuses = state.conditionalPassiveActive ?? {};
  state.conditionalPassiveActive = statuses;

  const nextStates: Array<[string, boolean]> = [
    ["Berserk", hasActiveBerserk(runtime, state, disabled, activesOn)],
    ["First Strike", hasActiveFirstStrike(runtime, state, disabled)],
    ["Warden's Resistance", hasActiveWardenResistance(runtime, state, disabled)],
  ];

  for (const [abilityName, active] of nextStates) {
    const previous = statuses[abilityName];
    if (previous === active) continue;
    statuses[abilityName] = active;
    if (previous == null && !active) continue;
    appendConditionalPassiveTransition(state, time, abilityName, active);
  }
}
