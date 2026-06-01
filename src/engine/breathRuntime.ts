import { createBreathHelpersRuntime } from "./breathHelpersRuntime";
import { createBreathResourceRuntime } from "./breathResourceRuntime";
import { createBreathSpecialRuntime } from "./breathSpecialRuntime";
import type { BreathRuntimeDeps, BreathTickContext } from "./breathRuntimeTypes";

export function createBreathRuntime(deps: BreathRuntimeDeps) {
  const helpers = createBreathHelpersRuntime(deps);
  const { estimateBreathMultiplier } = helpers;
  const resourceRuntime = createBreathResourceRuntime(deps);
  const specialRuntime = createBreathSpecialRuntime(deps);

  function applyBreathTick(ctx: BreathTickContext): void {
    const { time, attacker, defender, breathOn, activesOn } = ctx;
    const attackerRuntime = attacker.runtime;
    const attackerState = attacker.state;
    if (!breathOn || !attackerRuntime.final.hasBreath) return;
    deps.markAbilityApplied(attackerState, "Breath");
    const spec = deps.getBreathSpec(attackerRuntime);
    const specialName = spec?.name ?? deps.resolveBreathType(attackerRuntime) ?? "";
    if (
      specialRuntime.handleLance({
        time,
        attacker,
        defender,
        spec,
        specialName,
        activesOn,
        estimateBreathMultiplier,
        applyBreathImpact: helpers.applyBreathImpact,
      })
    ) {
      return;
    }
    if (
      !resourceRuntime.prepareBreathTick({
        time,
        attacker,
        breathOn,
        specialName,
        spec,
        estimateBreathMultiplier,
      })
    ) {
      return;
    }
    const damageBefore = attackerState.damageDealt;
    attackerState.breathTickCount += 1;
    if (
      specialRuntime.handleSupportBreath({
        time,
        attacker,
        defender,
        spec,
        specialName,
        activesOn,
        estimateBreathMultiplier,
        applyBreathImpact: helpers.applyBreathImpact,
      })
    ) {
      attackerState.combatLog.push({
        time,
        type: "breath",
        attacker: attackerState.sideLabel,
        damage: 0,
        actorHpAfter: attackerState.hp,
        hpSide: defender.state.sideLabel,
        hpAfter: Math.max(0, defender.state.hp),
        description: specialName || "Support breath",
      });
      return;
    }
    specialRuntime.handleOffensiveBreath({
      time,
      attacker,
      defender,
      spec,
      specialName,
      activesOn,
      estimateBreathMultiplier,
      applyBreathImpact: helpers.applyBreathImpact,
    });
    attackerState.combatLog.push({
      time,
      type: "breath",
      attacker: attackerState.sideLabel,
      damage: Math.max(0, attackerState.damageDealt - damageBefore),
      actorHpAfter: attackerState.hp,
      hpSide: defender.state.sideLabel,
      hpAfter: Math.max(0, defender.state.hp),
      description: specialName || "Breath tick",
    });
  }

  return {
    applyBreathTick,
    estimateBreathMultiplier,
  };
}
