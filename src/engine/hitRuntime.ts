import type { TickContext } from "./runtimeContext";
import { addApproximationNote, addApproximationNoteOnce } from "./approximationNotes";
import { createHitStatusRuntime } from "./hitStatusRuntime";
import type { HitRuntimeDeps } from "./hitRuntimeTypes";
import { applyReflectedDamage } from "./reflectRuntime";
import { syncConditionalPassiveTimeline } from "./conditionalPassiveRuntime";

export function createHitRuntime(deps: HitRuntimeDeps) {
  const statusRuntime = createHitStatusRuntime(deps);

  function formatBiteDetail(
    attacker: TickContext["attacker"],
    damageMultiplier: number,
    damageTakenMultiplier: number,
    attackerWeight: number,
    defenderWeight: number,
  ): string {
    const parts: string[] = [];
    const rageMultiplier =
      attacker.runtime.hasWardenRage && attacker.state.wardenRageStacks > 0
        ? 1 + 7.5 * (attacker.state.wardenRageStacks / 100)
        : 1;
    const nonRagePowerMultiplier = damageMultiplier / rageMultiplier;
    const weightRatio = attackerWeight / Math.max(1, defenderWeight);

    if (rageMultiplier > 1.001) parts.push(`Rage x${rageMultiplier.toFixed(2)}`);
    if (nonRagePowerMultiplier > 1.001 || nonRagePowerMultiplier < 0.999) {
      parts.push(`Power x${nonRagePowerMultiplier.toFixed(2)}`);
    }
    parts.push(`Weight ${weightRatio.toFixed(2)}`);
    if (damageTakenMultiplier > 1.001 || damageTakenMultiplier < 0.999) {
      parts.push(`Taken x${damageTakenMultiplier.toFixed(2)}`);
    }

    return parts.join(" / ");
  }

  function handleMeleeHit(ctx: TickContext): boolean {
    const { time, attacker, defender, activesOn } = ctx;
    syncConditionalPassiveTimeline(time, attacker.runtime, attacker.state, attacker.disabled, activesOn);
    syncConditionalPassiveTimeline(time, defender.runtime, defender.state, defender.disabled, activesOn);
    const attackerMods = deps.aggregateStatusModifiers(attacker.state.statuses);
    const defenderMods = deps.aggregateStatusModifiers(defender.state.statuses);
    const powerChargeActive = attacker.state.comparePowerChargeEnabled && !attacker.state.comparePowerChargeConsumed;
    const goreChargeActive = attacker.state.compareGoreChargeEnabled && !attacker.state.compareGoreChargeConsumed;
    const chargePowerMultiplier = powerChargeActive ? 1.5 : 1;
    const divinationActive = attacker.state.divinationChargesLeft > 0;

    const damageMultiplier = deps.computeOutgoingDamageMultiplier(attacker.runtime, attacker.state, attackerMods, activesOn);
    const damageTakenMultiplier = deps.computeIncomingDamageMultiplier(defender.runtime, defender.state, defenderMods, activesOn);

    const attackerWeight = deps.applyWeightModifiers(attacker.runtime.final.weight, attackerMods) * deps.getActiveWeightMultiplier(attacker.state);
    const defenderWeight = deps.applyWeightModifiers(defender.runtime.final.weight, defenderMods) * deps.getActiveWeightMultiplier(defender.state);

    let damage = deps.computeMeleeDamagePerHit(
      attacker.runtime.final,
      defender.runtime.final,
      damageMultiplier * chargePowerMultiplier,
      damageTakenMultiplier,
      attackerWeight,
      defenderWeight,
    );
    let statusMultiplier = 1;
    if (activesOn && attacker.runtime.hasSpite && attacker.state.spiteArmed) {
      const spiteValue = attacker.runtime.abilityValueByName["Spite"];
      if (typeof spiteValue === "number" && Number.isFinite(spiteValue)) {
        const activationTime = attacker.state.spiteChargeReadyAt - 5;
        const chargeRatio = Math.max(0, Math.min(1, (time - activationTime) / 5));
        damage *= 1 + spiteValue * chargeRatio;
        statusMultiplier = 2;
      }
      attacker.state.spiteArmed = false;
      attacker.state.spiteChargeReadyAt = 0;
      deps.markAbilityApplied(attacker.state, "Spite");
    }
    if (divinationActive) {
      damage += 50;
    }
    const defenderHpBefore = defender.state.hp;
    const reflectedBaseDamage =
      damage >= 0 && deps.isReflectActiveAt(defender.state, time) ? Math.max(0, Math.min(defenderHpBefore, damage)) : 0;
    let actualDamage = 0;
    if (damage >= 0) {
      actualDamage = deps.isReflectActiveAt(defender.state, time) ? 0 : Math.max(0, Math.min(defenderHpBefore, damage));
      defender.state.hp = defenderHpBefore - actualDamage;
    } else {
      defender.state.hp = Math.min(defender.runtime.final.health, defender.state.hp - damage);
    }
    if (actualDamage > 0) {
      attacker.state.damageDealt += actualDamage;
    }
    attacker.state.biteCount += 1;
    attacker.state.combatLog.push({
      time,
      type: "bite",
      attacker: attacker.state.sideLabel,
      damage: actualDamage,
      actorHpAfter: Math.max(0, attacker.state.hp),
      hpSide: defender.state.sideLabel,
      hpAfter: Math.max(0, defender.state.hp),
      description: "Bite hit",
      detail: formatBiteDetail(attacker, damageMultiplier, damageTakenMultiplier, attackerWeight, defenderWeight),
    });
    attacker.state.lastMeleeHitAt = time;
    attacker.state.lastMeleeHitDamage = actualDamage;

    statusRuntime.applyLifeLeech({ time, attacker, damageDealt: actualDamage, activesOn });
    if (reflectedBaseDamage > 0) {
      applyReflectedDamage(time, reflectedBaseDamage, "bite", defender, attacker);
    }
    if (actualDamage > 0 && !defender.state.hunkerOn) {
      const reflectAvgPct = defender.runtime.final.plushieReflectAvgPct ?? 0;
      if (reflectAvgPct > 0) {
        const reflectDamage = Math.max(0, Math.min(attacker.state.hp, actualDamage * (reflectAvgPct / 100)));
        if (reflectDamage > 0) {
          attacker.state.hp -= reflectDamage;
          defender.state.combatLog.push({
            time,
            type: "ability",
            attacker: defender.state.sideLabel,
            damage: reflectDamage,
            actorHpAfter: Math.max(0, defender.state.hp),
            hpSide: attacker.state.sideLabel,
            hpAfter: Math.max(0, attacker.state.hp),
            description: "Knight Reflect (avg)",
          });
          addApproximationNoteOnce(defender.state.approxNotes, "KNIGHT_REFLECT_APPROX");
        }
      }
    }

    if (defenderMods.reflectsMeleeDamage) {
      addApproximationNote(attacker.state.approxNotes, "REFLECT_STATUS_UNQUANTIFIED");
    }

    statusRuntime.applyOnHitStatuses(ctx, statusMultiplier, true);
    if (powerChargeActive) {
      deps.applyStatusToTarget({
        time,
        target: defender,
        statusId: "Shredded_Wings",
        stacks: 2,
        source: attacker.state,
        sourceAbilityName: "Power Charge",
      });
      deps.markAbilityApplied(attacker.state, "Power Charge");
      attacker.state.comparePowerChargeConsumed = true;
    }
    if (divinationActive) {
      deps.applyStatusToTarget({
        time,
        target: defender,
        statusId: "Burn_Status",
        stacks: 2,
        source: attacker.state,
        sourceAbilityName: "Divination",
      });
      deps.markAbilityApplied(attacker.state, "Divination");
      attacker.state.divinationChargesLeft -= 1;
    }
    if (goreChargeActive) {
      deps.applyStatusToTarget({
        time,
        target: defender,
        statusId: "Bleed_Status",
        stacks: 2,
        source: attacker.state,
        sourceAbilityName: "Gore Charge",
      });
      deps.applyStatusToTarget({
        time,
        target: defender,
        statusId: "Deep_Wounds_Status",
        stacks: 10,
        source: attacker.state,
        sourceAbilityName: "Gore Charge",
      });
      deps.markAbilityApplied(attacker.state, "Gore Charge");
      attacker.state.compareGoreChargeConsumed = true;
    }
    deps.tryArmSpiteAfterHit(time, attacker.runtime, attacker.state, activesOn, attacker.disabled);
    if (defender.runtime.hasToxicTrap && defender.state.toxicTrapBitesRemaining > 0) {
      defender.state.toxicTrapBitesRemaining -= 1;
      if (defender.state.toxicTrapBitesRemaining <= 0) {
        defender.state.toxicTrapNextTickAt = null;
      }
    }
    return true;
  }

  function handleShadowBarrageHit(ctx: TickContext): void {
    const { time, attacker, defender } = ctx;
    if (attacker.state.shadowBarrageRemainingHits <= 0) return;
    const damage = Math.max(0, attacker.state.shadowBarrageBaseDamage * 0.9);
    const defenderHpBefore = defender.state.hp;
    const actualDamage = Math.max(0, Math.min(defenderHpBefore, damage));
    defender.state.hp = defenderHpBefore - actualDamage;
    attacker.state.damageDealt += actualDamage;
    attacker.state.combatLog.push({
      time,
      type: "ability",
      attacker: attacker.state.sideLabel,
      damage: actualDamage,
      actorHpAfter: Math.max(0, attacker.state.hp),
      hpSide: defender.state.sideLabel,
      hpAfter: Math.max(0, defender.state.hp),
      description: "Shadow Barrage hit",
    });
    statusRuntime.applyAttackerOnHitStatuses(ctx, 1, true);
    attacker.state.shadowBarrageBaseDamage = damage;
    attacker.state.shadowBarrageRemainingHits -= 1;
    attacker.state.shadowBarrageNextHitAt = attacker.state.shadowBarrageRemainingHits > 0 ? time + 1 : null;
    deps.markAbilityApplied(attacker.state, "Shadow Barrage");
  }

  return {
    handleMeleeHit,
    handleShadowBarrageHit,
    applyLifeLeech: statusRuntime.applyLifeLeech,
    applyAttackerOnHitStatuses: statusRuntime.applyAttackerOnHitStatuses,
    applyOnHitStatuses: statusRuntime.applyOnHitStatuses,
    applyLichMarkOnHit: statusRuntime.applyLichMarkOnHit,
    getLifeLeechValue: statusRuntime.getLifeLeechValue,
    getExplicitOnHitStatuses: statusRuntime.getExplicitOnHitStatuses,
  };
}
