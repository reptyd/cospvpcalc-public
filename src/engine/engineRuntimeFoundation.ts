import {
  creatureByName,
  effectsCatalog,
  specialAbilities,
} from "./data";
import {
  ADRENALINE_COOLDOWN_SEC,
  ADRENALINE_DURATION_SEC,
  DROWSY_AREA_COOLDOWN_SEC,
  FORTIFY_COOLDOWN_SEC,
  FORTIFY_STACKS,
  FROST_NOVA_COOLDOWN_SEC,
  FROST_NOVA_DURATION_SEC,
  FROST_NOVA_TICK_SEC,
  HARDEN_COOLDOWN_SEC,
  HARDEN_STACKS,
  HEALING_STEP_TICK_SEC,
  HUNTERS_CURSE_COOLDOWN_SEC,
  HUNTERS_CURSE_DURATION_SEC,
  LIFE_LEECH_COOLDOWN_SEC,
  LIFE_LEECH_DURATION_SEC,
  LICH_MARK_ARMED_WINDOW_SEC,
  LICH_MARK_COOLDOWN_SEC,
  PASSIVE_REGEN_TICK_SEC,
  REFLECT_COOLDOWN_SEC,
  REFLECT_DURATION_SEC,
  STATUS_STACK_DURATION_SEC,
  TOTEM_COOLDOWN_SEC,
  TOTEM_TICK_SEC,
  UNBRIDLED_RAGE_COOLDOWN_SEC,
  UNBRIDLED_RAGE_DURATION_SEC,
  TOTEM_DURATION_SEC,
} from "./subsystems/timing";
import {
  DISABLE_REFLECT,
  DISABLE_STATUS_BLOCKS,
  DISABLE_WARDEN_RAGE,
  DISABLE_WARDEN_RESISTANCE,
  isAbilityDisabled,
} from "./subsystems/actives";
import { BAD_OMEN_STATUS_ID, PERSISTENT_STATUS_IDS } from "./subsystems/statuses";
import { computeMeleeDamagePerHit } from "./subsystems/damage";
import { isPrecisionPolicy } from "./subsystems/policySearch";
import { getPlushieBlockFraction } from "./buildRules";
import { createPolicyRuntime } from "./policyRuntime";
import { createActivesRuntime } from "./activesRuntime";
import { createStateRuntime } from "./stateRuntime";
import { createRegenRuntime } from "./regenRuntime";
import { createTimelineRuntime } from "./timelineRuntime";
import { createCombatantFactory } from "./combatantFactory";
import { createStateTickRuntime } from "./stateTickRuntime";
import { createStatusRuntime } from "./statusRuntime";
import {
  aggregateStatusModifiers,
  applyWeightModifiers,
  computeIncomingDamageMultiplier,
  computeOutgoingDamageMultiplier,
  currentBiteCooldown,
} from "./combatMath";
import {
  createSpecialEventsRuntime,
  markAbilityApplied,
} from "./specialEventsRuntime";
import {
  comparePolicyStateScore,
  getStatusDefinition,
  isFortifyRemovableStatus,
  isReflectActiveAt,
  nextAdrenalinePlannedAt,
  nextDrowsyAreaReadyAt,
  nextFrostNovaTickAt,
  nextHuntersCursePlannedAt,
  nextLifeLeechPlannedAt,
  nextRegenAt,
  nextCauseFearReadyAt,
  nextLanceAuraTickAt,
  nextRefluxChargeReadyAt,
  nextRefluxTickAt,
  nextRadiationTickAt,
  nextShadowBarrageHitAt,
  nextTotemReadyAt,
  nextTotemTickAt,
  nextUnbridledRagePlannedAt,
  shouldActivateFortify,
  cloneStateForProjection,
  wardenRageStacksFromHpRatio,
} from "./combatPrimitives";
import {
  getBreathSpec,
  hasAbilityName,
  normalizeAbilityName,
  resolveLanceAilment,
} from "./runtimeHelpers";

export function createEngineRuntimeFoundation() {
  const regenRuntime = createRegenRuntime({
    passiveRegenTickSec: PASSIVE_REGEN_TICK_SEC,
    getStatusDefinition,
  });

  const policyRuntime = createPolicyRuntime({
    wardenRageStacksFromHpRatio,
    aggregateStatusModifiers,
    computeOutgoingDamageMultiplier,
    computeIncomingDamageMultiplier,
    applyWeightModifiers,
    computeMeleeDamagePerHit,
    currentBiteCooldown,
    computeRegenMultiplier: regenRuntime.computeRegenMultiplier,
    passiveRegenTickSec: PASSIVE_REGEN_TICK_SEC,
    huntersCurseDurationSec: HUNTERS_CURSE_DURATION_SEC,
    unbridledRageDurationSec: UNBRIDLED_RAGE_DURATION_SEC,
    reflectDurationSec: REFLECT_DURATION_SEC,
    adrenalineDurationSec: ADRENALINE_DURATION_SEC,
  });

  const statusRuntime = createStatusRuntime({
    badOmenStatusId: BAD_OMEN_STATUS_ID,
    disableStatusBlocks: DISABLE_STATUS_BLOCKS,
    disableWardenResistance: DISABLE_WARDEN_RESISTANCE,
    statusStackDurationSec: STATUS_STACK_DURATION_SEC,
    persistentStatusIds: PERSISTENT_STATUS_IDS,
    isAbilityDisabled,
    normalizeAbilityName,
    getPlushieBlockFraction,
    getStatusDefinition,
  });

  const applyStatusToTargetLegacy = (
    time: number,
    targetRuntime: Parameters<typeof statusRuntime.applyStatusToTarget>[0]["target"]["runtime"],
    targetState: Parameters<typeof statusRuntime.applyStatusToTarget>[0]["target"]["state"],
    statusId: string,
    stacks: number,
    targetDisabled?: Set<string>,
    source?: Parameters<typeof statusRuntime.applyStatusToTarget>[0]["source"],
    sourceAbilityName?: string,
  ): void => {
    statusRuntime.applyStatusToTarget({
      time,
      target: { runtime: targetRuntime, state: targetState, disabled: targetDisabled ?? new Set() },
      statusId,
      stacks,
      source,
      sourceAbilityName,
    });
  };

  const activesRuntime = createActivesRuntime({
    disableReflect: DISABLE_REFLECT,
    reflectDurationSec: REFLECT_DURATION_SEC,
    reflectCooldownSec: REFLECT_COOLDOWN_SEC,
    drowsyAreaCooldownSec: DROWSY_AREA_COOLDOWN_SEC,
    totemDurationSec: TOTEM_DURATION_SEC,
    totemCooldownSec: TOTEM_COOLDOWN_SEC,
    totemTickSec: TOTEM_TICK_SEC,
    adrenalineDurationSec: ADRENALINE_DURATION_SEC,
    adrenalineCooldownSec: ADRENALINE_COOLDOWN_SEC,
    lichMarkCooldownSec: LICH_MARK_COOLDOWN_SEC,
    lichMarkArmedWindowSec: LICH_MARK_ARMED_WINDOW_SEC,
    hardenStacks: HARDEN_STACKS,
    hardenCooldownSec: HARDEN_COOLDOWN_SEC,
    huntersCurseDurationSec: HUNTERS_CURSE_DURATION_SEC,
    huntersCurseCooldownSec: HUNTERS_CURSE_COOLDOWN_SEC,
    unbridledRageDurationSec: UNBRIDLED_RAGE_DURATION_SEC,
    unbridledRageCooldownSec: UNBRIDLED_RAGE_COOLDOWN_SEC,
    fortifyCooldownSec: FORTIFY_COOLDOWN_SEC,
    fortifyStacks: FORTIFY_STACKS,
    statusStackDurationSec: STATUS_STACK_DURATION_SEC,
    frostNovaCooldownSec: FROST_NOVA_COOLDOWN_SEC,
    frostNovaDurationSec: FROST_NOVA_DURATION_SEC,
    frostNovaTickSec: FROST_NOVA_TICK_SEC,
    isAbilityDisabled,
    hasAbilityName,
    isPrecisionPolicy,
    isFortifyRemovableStatus,
    shouldActivateFortifyHeuristic: shouldActivateFortify,
    isReflectActiveAt,
    markAbilityApplied,
    applyStatusToTarget: applyStatusToTargetLegacy,
    policyRuntime,
  });

  const stateRuntime = createStateRuntime({
    lifeLeechDurationSec: LIFE_LEECH_DURATION_SEC,
    lifeLeechCooldownSec: LIFE_LEECH_COOLDOWN_SEC,
    disableWardenRage: DISABLE_WARDEN_RAGE,
    isAbilityDisabled,
    isPrecisionPolicy,
    hasAbilityName,
    wardenRageStacksFromHpRatio,
    comparePolicyStateScore,
    cloneStateForProjection,
    markAbilityApplied,
    policyRuntime,
  });

  const timelineRuntime = createTimelineRuntime({
    nextLifeLeechPlannedAt,
    nextAdrenalinePlannedAt,
    nextFrostNovaTickAt,
    nextHuntersCursePlannedAt,
    nextUnbridledRagePlannedAt,
    nextRegenAt,
    nextTotemTickAt,
    nextTotemReadyAt,
    nextDrowsyAreaReadyAt,
    nextRadiationTickAt,
    nextCauseFearReadyAt,
    nextRefluxChargeReadyAt,
    nextRefluxTickAt,
    nextLanceAuraTickAt,
    nextShadowBarrageHitAt,
    nextToxicTrapTickAt: (state) => state.toxicTrapNextTickAt ?? Number.POSITIVE_INFINITY,
    nextDamageTrailTickAt: (state) => state.damageTrailNextTickAt ?? Number.POSITIVE_INFINITY,
    nextHealingStepTickAt: (state) => state.healingStepNextTickAt,
  });

  const combatantFactory = createCombatantFactory({
    creatureByName,
    effectsCatalog,
    specialAbilities,
    passiveRegenTickSec: PASSIVE_REGEN_TICK_SEC,
    healingStepTickSec: HEALING_STEP_TICK_SEC,
    statusStackDurationSec: STATUS_STACK_DURATION_SEC,
    isAbilityDisabled,
    normalizeAbilityName,
    hasAbilityName,
    getBreathSpec,
  });

  const specialEventsRuntime = createSpecialEventsRuntime({
    applyStatusToTarget: statusRuntime.applyStatusToTarget,
    resolveLanceAilment,
    markAbilityApplied,
  });

  const stateTickRuntime = createStateTickRuntime({
    updateStatusDurations: statusRuntime.updateStatusDurations,
    updateSpite: specialEventsRuntime.updateSpite,
    updateRadiation: specialEventsRuntime.updateRadiation,
    updateCauseFear: specialEventsRuntime.updateCauseFear,
    updateReflux: specialEventsRuntime.updateReflux,
    updateLanceAura: specialEventsRuntime.updateLanceAura,
    updateTrails: specialEventsRuntime.updateTrails,
    handleThornTrap: specialEventsRuntime.handleThornTrap,
    handleCursedSigil: specialEventsRuntime.handleCursedSigil,
    stateRuntime,
    activesRuntime,
    regenRuntime,
  });

  return {
    activesRuntime,
    combatantFactory,
    policyRuntime,
    regenRuntime,
    specialEventsRuntime,
    stateRuntime,
    stateTickRuntime,
    statusRuntime,
    timelineRuntime,
  };
}
