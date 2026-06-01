import { rules, specialAbilities } from "./data";
import {
  BREATH_TICK_SEC,
  LANCE_CHARGE_SEC,
  LANCE_COOLDOWN_SEC,
} from "./subsystems/timing";
import {
  DISABLE_LICH_MARK,
  DISABLE_PLUSHIE_DEF,
  DISABLE_PLUSHIE_OFF,
  DISABLE_STATUS_ATTACKS,
  DISABLE_WARDEN_RESISTANCE,
  isAbilityDisabled,
} from "./subsystems/actives";
import { computeBreathDamage, computeMeleeDamagePerHit } from "./subsystems/damage";
import { createDebugRuntime } from "./debugRuntime";
import { createHitRuntime } from "./hitRuntime";
import { createBreathRuntime } from "./breathRuntime";
import {
  aggregateStatusModifiers,
  applyWeightModifiers,
  computeIncomingDamageMultiplier,
  computeOutgoingDamageMultiplier,
  getActiveWeightMultiplier,
  getBreathResistance,
} from "./combatMath";
import { markAbilityApplied } from "./specialEventsRuntime";
import {
  getStatusDefinition,
  isReflectActiveAt,
} from "./combatPrimitives";
import {
  addApproxNoteOnce,
  getBreathSpec,
  getBreathSpecByType,
  hasAbilityName,
  normalizeAbilityName,
  parseBreathAilments,
  resolveBreathType,
  resolveLanceAilment,
  resolveStatusId,
} from "./runtimeHelpers";

type EngineRuntimeFoundation = ReturnType<typeof import("./engineRuntimeFoundation").createEngineRuntimeFoundation>;

export function createEngineRuntimeCombat(foundation: EngineRuntimeFoundation) {
  const { statusRuntime } = foundation;

  const hitRuntime = createHitRuntime({
    disableStatusAttacks: DISABLE_STATUS_ATTACKS,
    disablePlushieOff: DISABLE_PLUSHIE_OFF,
    disablePlushieDef: DISABLE_PLUSHIE_DEF,
    disableLichMark: DISABLE_LICH_MARK,
    aggregateStatusModifiers,
    computeOutgoingDamageMultiplier,
    computeIncomingDamageMultiplier,
    applyWeightModifiers,
    getActiveWeightMultiplier,
    computeMeleeDamagePerHit,
    isReflectActiveAt,
    isAbilityDisabled,
    hasAbilityName,
    normalizeAbilityName,
    applyStatusToTarget: statusRuntime.applyStatusToTarget,
    markAbilityApplied,
    tryArmSpiteAfterHit: foundation.specialEventsRuntime.tryArmSpiteAfterHit,
  });

  const breathRuntime = createBreathRuntime({
    breathTickSec: BREATH_TICK_SEC,
    lanceChargeSec: LANCE_CHARGE_SEC,
    lanceCooldownSec: LANCE_COOLDOWN_SEC,
    disableStatusAttacks: DISABLE_STATUS_ATTACKS,
    disablePlushieOff: DISABLE_PLUSHIE_OFF,
    disablePlushieDef: DISABLE_PLUSHIE_DEF,
    computeBreathDamage,
    resolveBreathType,
    getBreathSpec,
    getBreathSpecByType,
    resolveLanceAilment,
    parseBreathAilments,
    resolveStatusId,
    addApproxNoteOnce,
    isAbilityDisabled,
    normalizeAbilityName,
    hasAbilityName,
    isReflectActiveAt,
    aggregateStatusModifiers,
    applyWeightModifiers,
    getActiveWeightMultiplier,
    getBreathResistance,
    applyLifeLeech: hitRuntime.applyLifeLeech,
    applyStatusToTarget: statusRuntime.applyStatusToTarget,
    healStatusStacks: statusRuntime.healStatusStacks,
    markAbilityApplied,
  });

  const debugRuntime = createDebugRuntime({
    rulesWeightRatioCap: rules.damage.melee.weightRatioCap,
    disableWardenResistance: DISABLE_WARDEN_RESISTANCE,
    aggregateStatusModifiers,
    computeIncomingDamageMultiplier,
    isAbilityDisabled,
    normalizeAbilityName,
    hasAbilityName,
    specialAbilities,
    getStatusDefinition,
    computeDotDamage: statusRuntime.computeDotDamage,
  });

  return {
    breathRuntime,
    debugRuntime,
    hitRuntime,
  };
}
