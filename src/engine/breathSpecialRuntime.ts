import { addApproximationNote } from "./approximationNotes";
import type { BreathRuntimeDeps, BreathSpecLike } from "./breathRuntimeTypes";
import type { CombatSide } from "./runtimeContext";

type SpecialBreathContext = {
  time: number;
  attacker: CombatSide;
  defender: CombatSide;
  spec: BreathSpecLike;
  specialName: string;
  activesOn: boolean;
  estimateBreathMultiplier: (runtime: CombatSide["runtime"]) => number;
  applyBreathImpact: (
    time: number,
    attacker: CombatSide,
    defender: CombatSide,
    spec: BreathSpecLike,
    breathMultiplier: number,
    activesOn: boolean,
  ) => void;
};

export function createBreathSpecialRuntime(deps: BreathRuntimeDeps) {
  function hasExternalHealingBlock(side: CombatSide): boolean {
    return (side.state.statuses["Heartbroken_Status"]?.stacks ?? 0) > 0;
  }

  function appendSelfHealLog(side: CombatSide, time: number, description: string, heal: number): void {
    if (heal <= 0) return;
    side.state.combatLog.push({
      time,
      type: "ability",
      attacker: side.state.sideLabel,
      damage: 0,
      healing: heal,
      actorHpAfter: side.state.hp,
      hpSide: side.state.sideLabel,
      hpAfter: side.state.hp,
      description,
    });
  }

  function scaleCooldown(state: CombatSide["state"], baseSec: number): number {
    return baseSec * (state.activeCooldownMultiplier ?? 1);
  }

  function handleLance(ctx: SpecialBreathContext): boolean {
    const { time, attacker, defender, specialName } = ctx;
    const attackerRuntime = attacker.runtime;
    const attackerState = attacker.state;
    const defenderRuntime = defender.runtime;
    const defenderState = defender.state;
    const attackerDisabled = attacker.disabled;
    const hasLance =
      deps.hasAbilityName(attackerRuntime.effects, "Lance") ||
      /lance/i.test(specialName) ||
      /lance/i.test(attackerRuntime.final.breath ?? "");
    if (!hasLance) return false;
    if (deps.isAbilityDisabled(attackerDisabled, "Lance")) return true;
    if (attackerState.lanceArmedUntil <= 0) {
      if (time < attackerState.lanceCooldownUntil) return true;
      attackerState.lanceArmedUntil = time + deps.lanceChargeSec;
      attackerState.lanceCooldownUntil = time + scaleCooldown(attackerState, deps.lanceCooldownSec);
      return true;
    }
    if (time < attackerState.lanceArmedUntil) return true;

    const lanceDamage = defenderRuntime.final.health * 0.05;
    const defenderHpBefore = defenderState.hp;
    const actualDamage = Math.max(0, Math.min(defenderHpBefore, lanceDamage));
    defenderState.hp = defenderHpBefore - actualDamage;
    attackerState.damageDealt += actualDamage;
    deps.applyStatusToTarget({
      time,
      target: defender,
      statusId: "Slow_Status",
      stacks: 2,
      source: attackerState,
      sourceAbilityName: "Lance",
    });
    attackerState.lanceArmedUntil = 0;
    attackerState.lanceAuraUntil = time + 5;
    attackerState.lanceAuraNextTickAt = time + 1;
    deps.markAbilityApplied(attackerState, "Lance", time);
    return true;
  }

  function handleSupportBreath(ctx: SpecialBreathContext): boolean {
    const { time, attacker, specialName } = ctx;
    const attackerRuntime = attacker.runtime;
    const attackerState = attacker.state;
    const attackerDisabled = attacker.disabled;

    if (specialName === "Heal Breath" || specialName === "Heal_Breath") {
      if (deps.isAbilityDisabled(attackerDisabled, "Heal Breath")) return true;
      if (!hasExternalHealingBlock(attacker)) {
        const healPct = 3;
        const heal = (attackerRuntime.final.health * healPct) / 100;
        attackerState.hp = Math.min(attackerRuntime.final.health, attackerState.hp + heal);
        appendSelfHealLog(attacker, time, "Heal Breath heal", heal);
      }
      deps.healStatusStacks({ time, target: attacker, stacksToHeal: 0.5 });
      deps.markAbilityApplied(attackerState, "Heal Breath", time);
      return true;
    }
    if (specialName === "Heal Beam" || specialName === "Heal_Beam") {
      if (deps.isAbilityDisabled(attackerDisabled, "Heal Beam")) return true;
      addApproximationNote(attackerState.approxNotes, "HEAL_BEAM_SELF_NO_EFFECT");
      deps.markAbilityApplied(attackerState, "Heal Beam", time);
      return true;
    }
    if (specialName === "Cloud Breath" || specialName === "Cloud_Breath") {
      if (deps.isAbilityDisabled(attackerDisabled, "Cloud Breath")) return true;
      if (!hasExternalHealingBlock(attacker)) {
        const healPct = 0.5;
        const heal = (attackerRuntime.final.health * healPct) / 100;
        attackerState.hp = Math.min(attackerRuntime.final.health, attackerState.hp + heal);
        appendSelfHealLog(attacker, time, "Cloud Breath heal", heal);
      }
      deps.markAbilityApplied(attackerState, "Cloud Breath", time);
      return true;
    }
    return false;
  }

  function handleOffensiveBreath(ctx: SpecialBreathContext): boolean {
    const { time, attacker, defender, spec, specialName, activesOn, estimateBreathMultiplier, applyBreathImpact } = ctx;
    const attackerState = attacker.state;
    const attackerDisabled = attacker.disabled;
    const attackerRuntime = attacker.runtime;

    const breathMultiplier = estimateBreathMultiplier(attackerRuntime);
    if (breathMultiplier <= 0) {
      addApproximationNote(attackerState.approxNotes, "BREATH_MULTIPLIER_MISSING");
      return true;
    }

    applyBreathImpact(time, attacker, defender, spec, breathMultiplier, activesOn);
    if (!deps.isAbilityDisabled(attackerDisabled, deps.disablePlushieOff)) {
      const plushieStatuses = attackerRuntime.final.plushieStatusOnHit ?? {};
      for (const [statusId, stacks] of Object.entries(plushieStatuses) as Array<[string, number]>) {
        deps.applyStatusToTarget({
          time,
          target: defender,
          statusId,
          stacks,
          source: attackerState,
          sourceAbilityName: "Plushie Offensive Procs",
        });
        attackerState.plushieOffensiveStacksApplied += stacks;
      }
    }
    if (specialName === "Spirit Glare" && !deps.isAbilityDisabled(attackerDisabled, "Spirit Glare")) {
      if (!deps.isAbilityDisabled(attackerDisabled, deps.disableStatusAttacks)) {
        deps.applyStatusToTarget({
          time,
          target: defender,
          statusId: "Burn_Status",
          stacks: 1,
          source: attackerState,
          sourceAbilityName: "Spirit Glare",
        });
        deps.applyStatusToTarget({
          time,
          target: defender,
          statusId: "Fear_Status",
          stacks: 1,
          source: attackerState,
          sourceAbilityName: "Spirit Glare",
        });
      }
    }
    if (specialName === "Miasma Breath" && !deps.isAbilityDisabled(attackerDisabled, "Miasma Breath")) {
      if (!hasExternalHealingBlock(attacker)) {
        const heal = (attackerRuntime.final.health * 0.5) / 100;
        attackerState.hp = Math.min(attackerRuntime.final.health, attackerState.hp + heal);
        appendSelfHealLog(attacker, time, "Miasma Breath heal", heal);
      }
      addApproximationNote(attackerState.approxNotes, "MIASMA_STAMINA_DAMAGE_NOT_MODELED");
    }
    return true;
  }

  return {
    handleLance,
    handleSupportBreath,
    handleOffensiveBreath,
  };
}
