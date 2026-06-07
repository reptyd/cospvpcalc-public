import type { BreathRuntimeDeps, BreathSpecLike } from "./breathRuntimeTypes";
import type { CombatSide } from "./runtimeContext";

type PrepareBreathContext = {
  time: number;
  attacker: CombatSide;
  breathOn: boolean;
  specialName: string;
  spec: BreathSpecLike;
  estimateBreathMultiplier: (runtime: CombatSide["runtime"]) => number;
};

export function createBreathResourceRuntime(deps: BreathRuntimeDeps) {
  const BREATH_CAPACITY_STEP = 1;

  function restoreBreathCapacityOverTime(
    time: number,
    attackerState: CombatSide["state"],
    spec: BreathSpecLike,
    breathRegenPct = 0,
  ): void {
    const maxCapacity = Math.max(0, spec?.stats?.capacity ?? 0);
    const baseRate = Math.max(deps.breathTickSec, spec?.stats?.regenRate ?? 5);
    const regenRate = breathRegenPct > 0 ? Math.max(deps.breathTickSec, baseRate / (1 + breathRegenPct / 100)) : baseRate;
    if (maxCapacity <= 0 || attackerState.breathCapacityLeft >= maxCapacity || attackerState.breathRegenCooldown <= 0) return;

    while (attackerState.breathCapacityLeft < maxCapacity && time >= attackerState.breathRegenCooldown) {
      attackerState.breathCapacityLeft = Math.min(maxCapacity, attackerState.breathCapacityLeft + BREATH_CAPACITY_STEP);
      attackerState.breathRegenCooldown += regenRate;
    }

    if (attackerState.breathCapacityLeft >= maxCapacity) {
      attackerState.breathRegenCooldown = 0;
    }
  }

  function prepareBreathTick(ctx: PrepareBreathContext): boolean {
    const { time, attacker, breathOn, specialName, spec } = ctx;
    const attackerRuntime = attacker.runtime;
    const attackerState = attacker.state;
    const attackerDisabled = attacker.disabled;
    if (!breathOn || !attackerRuntime.final.hasBreath) return false;

    const normalizedSpecialName = specialName || "";
    if (normalizedSpecialName && deps.isAbilityDisabled(attackerDisabled, deps.normalizeAbilityName(normalizedSpecialName))) {
      return false;
    }

    const isAutoFire = normalizedSpecialName === "Solar Beam" || normalizedSpecialName === "Spirit Glare";
    const breathRegenBoost = isAutoFire ? 0 : (attackerRuntime.final.breathRegenPct ?? 0);
    const timeBeforeFire = normalizedSpecialName === "Solar Beam" ? 3 : normalizedSpecialName === "Spirit Glare" ? 0 : 0;
    const autoCooldown = isAutoFire ? 120 : 0;
    if (isAutoFire && time < (attackerState.breathCooldownUntil ?? 0)) {
      return false;
    }
    if (isAutoFire && attackerState.breathCapacityLeft <= 0) {
      attackerState.breathCapacityLeft = spec?.stats?.capacity ?? 10;
      attackerState.breathAutoFireDelayUntil = time + timeBeforeFire;
      attackerState.breathCooldownUntil = time + autoCooldown;
    }
    let resolvedManualRestartDelay = false;
    if (attackerState.breathAutoFireDelayUntil && time < attackerState.breathAutoFireDelayUntil) {
      return false;
    }
    if (attackerState.breathAutoFireDelayUntil && time >= attackerState.breathAutoFireDelayUntil) {
      resolvedManualRestartDelay = !isAutoFire;
      attackerState.breathAutoFireDelayUntil = null;
    }
    restoreBreathCapacityOverTime(time, attackerState, spec, breathRegenBoost);
    const channelBroken =
      attackerState.breathLastTickAt != null && time - attackerState.breathLastTickAt > deps.breathTickSec;
    if (!isAutoFire && channelBroken && !resolvedManualRestartDelay) {
      if (attackerState.breathAutoFireDelayUntil == null) {
        attackerState.breathAutoFireDelayUntil = time + deps.breathTickSec;
        return false;
      }
      if (time < attackerState.breathAutoFireDelayUntil) {
        return false;
      }
      attackerState.breathAutoFireDelayUntil = null;
    }
    if (attackerState.breathCapacityLeft <= 0) {
      return false;
    }

    attackerState.breathCapacityLeft = Math.max(0, attackerState.breathCapacityLeft - BREATH_CAPACITY_STEP);
    attackerState.breathLastTickAt = time;
    if (attackerState.breathCapacityLeft === 0) {
      const baseRate = spec?.stats?.regenRate ?? 5;
      const effectiveRate = breathRegenBoost > 0 ? Math.max(deps.breathTickSec, baseRate / (1 + breathRegenBoost / 100)) : baseRate;
      attackerState.breathRegenCooldown = isAutoFire ? time + autoCooldown : time + effectiveRate;
    }

    return true;
  }

  return {
    prepareBreathTick,
  };
}
