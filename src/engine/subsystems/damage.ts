import { rules } from "../data";
import type { FinalStats } from "../types";

export function computeMeleeDamagePerHit(
  attacker: FinalStats,
  defender: FinalStats,
  damageMultiplier: number,
  damageTakenMultiplier: number,
  weightOverrideAttacker?: number,
  weightOverrideDefender?: number,
): number {
  const weightRatioCap = rules.damage.melee.weightRatioCap;
  const packMultiplier = rules.damage.melee.packMultiplier.nonPackmate;
  const stanceMultiplier = rules.damage.melee.targetSitOrLayMultiplier.standing;

  const attackerWeight = weightOverrideAttacker ?? attacker.weight;
  const defenderWeight = weightOverrideDefender ?? defender.weight;
  const weightRatio = Math.min(attackerWeight / Math.max(1, defenderWeight), weightRatioCap);
  const baseDamage = attacker.damage * damageMultiplier;
  const finalDamage = (baseDamage * stanceMultiplier * packMultiplier * (1 + weightRatio)) / 2;
  return Math.max(0, finalDamage * damageTakenMultiplier);
}

export function computeBreathDamage(
  attacker: FinalStats,
  defender: FinalStats,
  breathMultiplier: number,
  breathResistance: number,
  weightOverrideAttacker?: number,
  weightOverrideDefender?: number,
): number {
  if (!rules.damage.breath.enabled) return 0;
  if (breathMultiplier <= 0) return 0;

  const attackerWeight = Math.max(1, weightOverrideAttacker ?? attacker.weight);
  const defenderWeight = Math.max(1, weightOverrideDefender ?? defender.weight);
  const defenderMaxHp = Math.max(1, defender.health);
  const finalDamage = (defenderMaxHp * ((attackerWeight / defenderWeight) + 1)) / 2;
  const raw = (finalDamage / 100) * breathMultiplier;
  const reduced = raw * Math.max(0, 1 - breathResistance);
  return Math.max(0, reduced);
}
