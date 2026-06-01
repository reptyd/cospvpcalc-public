import { rules } from "./data";
import { aggregateStatusModifiers, applyWeightModifiers, getActiveWeightMultiplier } from "./combatMath";
import type { CombatantRuntime, CombatantState } from "./runtimeContext";

type ReflectSide = {
  runtime: CombatantRuntime;
  state: CombatantState;
};

function getEffectiveWeight(side: ReflectSide): number {
  const mods = aggregateStatusModifiers(side.state.statuses);
  return Math.max(1, applyWeightModifiers(side.runtime.final.weight, mods) * getActiveWeightMultiplier(side.state));
}

export function computeReflectedMeleeDamage(receivedDamage: number, reflector: ReflectSide, originalAttacker: ReflectSide): number {
  if (receivedDamage <= 0) return 0;
  const reflectorWeight = getEffectiveWeight(reflector);
  const attackerWeight = getEffectiveWeight(originalAttacker);
  const cap = rules.damage.melee.weightRatioCap;
  const incomingFactor = 1 + Math.min(attackerWeight / Math.max(1, reflectorWeight), cap);
  const reflectedFactor = 1 + Math.min(reflectorWeight / Math.max(1, attackerWeight), cap);
  return Math.max(0, receivedDamage * (reflectedFactor / incomingFactor));
}

export function computeReflectedBreathDamage(receivedDamage: number, reflector: ReflectSide, originalAttacker: ReflectSide): number {
  if (receivedDamage <= 0) return 0;
  const reflectorWeight = getEffectiveWeight(reflector);
  const attackerWeight = getEffectiveWeight(originalAttacker);
  const incomingFactor = 1 + attackerWeight / Math.max(1, reflectorWeight);
  const reflectedFactor = 1 + reflectorWeight / Math.max(1, attackerWeight);
  return Math.max(0, receivedDamage * (reflectedFactor / incomingFactor));
}

export function applyReflectedDamage(
  time: number,
  receivedDamage: number,
  kind: "bite" | "breath",
  reflector: ReflectSide,
  originalAttacker: ReflectSide,
): number {
  const reflectedDamage =
    kind === "bite"
      ? computeReflectedMeleeDamage(receivedDamage, reflector, originalAttacker)
      : computeReflectedBreathDamage(receivedDamage, reflector, originalAttacker);
  if (reflectedDamage <= 0) return 0;

  const attackerHpBefore = originalAttacker.state.hp;
  const actualDamage = Math.max(0, Math.min(attackerHpBefore, reflectedDamage));
  if (actualDamage <= 0) return 0;

  originalAttacker.state.hp = attackerHpBefore - actualDamage;
  reflector.state.damageDealt += actualDamage;
  reflector.state.combatLog.push({
    time,
    type: "ability",
    attacker: reflector.state.sideLabel,
    damage: actualDamage,
    actorHpAfter: Math.max(0, reflector.state.hp),
    hpSide: originalAttacker.state.sideLabel,
    hpAfter: Math.max(0, originalAttacker.state.hp),
    description: kind === "bite" ? "Reflect (bite)" : "Reflect (breath)",
  });
  return actualDamage;
}
