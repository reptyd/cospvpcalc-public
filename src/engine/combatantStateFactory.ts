import { hasAbilityName } from "./runtimeHelpers";
import type { CombatantRuntime, CombatantState } from "./runtimeContext";
import type { FinalStats } from "./types";
import type { CombatantFactoryDeps } from "./combatantFactoryTypes";
import { COMPARE_DEFAULT_APPETITE_BASE, COMPARE_DEFAULT_STARTING_HUNGER } from "./compareHungerMath";
import { sanitizeAbilityTimingOverrides } from "./abilityTimingOverrides";
import { DAMAGE_TRAIL_TICK_SEC, HEALING_STEP_TICK_SEC } from "./subsystems/timing";

const RADIATION_TICK_SEC = 3;

const DAMAGE_TRAIL_NAMES = ["Toxic Trail", "Plague Trail", "Flame Trail", "Frost Trail"] as const;

export function createCombatantStateFactory(deps: CombatantFactoryDeps) {
  function createCombatantState(finalStats: FinalStats): CombatantState {
    return {
      sideLabel: "A",
      compareSecondaryAttackOnly: false,
      compareAirRuleEnabled: false,
      compareAirRuleCooldownSec: null,
      compareNoMoveFacetank: true,
      compareFirstTickMode: "off",
      compareFirstTickDelaySec: 1,
      compareStatusLastClearedAt: {},
      comparePowerChargeEnabled: false,
      comparePowerChargeConsumed: false,
      compareGoreChargeEnabled: false,
      compareGoreChargeConsumed: false,
      compareHungerRuleEnabled: false,
      compareGourmandizerEnabled: false,
      compareDefiledGroundLevel: 0,
      compareDefiledGroundWeaknessEnabled: false,
      compareTrapsEnabled: false,
      compareTrailsEnabled: false,
      trailsFacetankOverrideActive: false,
      trailsFacetankOverridePrev: null,
      damageTrailNextTickAt: null,
      compareStartingHunger: COMPARE_DEFAULT_STARTING_HUNGER,
      compareAppetiteBase: COMPARE_DEFAULT_APPETITE_BASE,
      compareHunger: COMPARE_DEFAULT_STARTING_HUNGER,
      comparePlushieDrainMultiplier: 1,
      abilityPolicyOverrides: sanitizeAbilityTimingOverrides(undefined),
      hp: finalStats.health,
      nextHitAt: 0,
      statuses: {},
      channelingNextPulseAt: null,
      selfDestructArmedAt: null,
      selfDestructUsed: false,
      damageDealt: 0,
      dotDamageDealt: 0,
      dotDamageByStatus: {},
      dotDamageTakenByStatus: {},
      lifeLeechHealed: 0,
      lifeLeechActiveUntil: 0,
      lifeLeechCooldownUntil: 0,
      lifeLeechPlannedAt: 0,
      lichMarkArmedUntil: 0,
      lichMarkCooldownUntil: 0,
      lichMarkPendingPayloadStatusId: null,
      lichMarkOwnedPayloadStatusId: null,
      adrenalinePlannedAt: 0,
      huntersCursePlannedAt: 0,
      huntersCurseThresholdUnlocked: false,
      unbridledRagePlannedAt: 0,
      nextRegenAt: deps.passiveRegenTickSec,
      regenBufferedTick: false,
      lastUpdateAt: 0,
      wardenRageOn: false,
      wardenRageStacks: 0,
      wardenRageCooldownUntil: 0,
      wardenRageTapUntil: 0,
      wardenRageHoldMode: false,
      hunkerOn: false,
      hunkerEffectStartsAt: Number.POSITIVE_INFINITY,
      hunkerDecisionKey: null,
      hunkerDecisionOn: null,
      hunkerLastDecisionAt: Number.NEGATIVE_INFINITY,
      reflectActiveUntil: null,
      reflectCooldownUntil: 0,
      drowsyAreaCooldownUntil: 0,
      totemActiveUntil: null,
      totemNextTickAt: null,
      totemCooldownUntil: 0,
      cursedSigilCooldownUntil: 0,
      radiationNextTickAt: null,
      adrenalineActiveUntil: 0,
      adrenalineCooldownUntil: 0,
      hardenActiveUntil: 0,
      hardenCooldownUntil: 0,
      spiteCooldownUntil: 0,
      thornTrapCooldownUntil: 0,
      grimLariatCooldownUntil: 0,
      huntersCurseActiveUntil: 0,
      huntersCurseCooldownUntil: 0,
      unbridledRageActiveUntil: 0,
      unbridledRageCooldownUntil: 0,
      fortifyCooldownUntil: 0,
      fortifyImmuneUntil: 0,
      fortifyWeightBonusUntil: 0,
      lanceCooldownUntil: 0,
      lanceArmedUntil: 0,
      lanceAuraUntil: 0,
      lanceAuraNextTickAt: null,
      frostNovaActiveUntil: 0,
      frostNovaCooldownUntil: 0,
      frostNovaNextTickAt: null,
      spiteChargeReadyAt: 0,
      spiteArmed: false,
      causeFearCooldownUntil: 0,
      refluxCooldownUntil: 0,
      refluxChargeReadyAt: 0,
      refluxArmed: false,
      refluxPuddleUntil: 0,
      refluxNextTickAt: null,
      rewindCooldownUntil: 0,
      rewindHistory: [],
      lastMeleeHitAt: Number.NEGATIVE_INFINITY,
      lastMeleeHitDamage: 0,
      shadowBarrageCooldownUntil: 0,
      shadowBarrageNextHitAt: null,
      shadowBarrageRemainingHits: 0,
      shadowBarrageBaseDamage: 0,
      frostSnareCooldownUntil: 0,
      poisonAreaCooldownUntil: 0,
      yolkBombCooldownUntil: 0,
      divinationCooldownUntil: 0,
      divinationChargesLeft: 0,
      toxicTrapCooldownUntil: 0,
      toxicTrapBitesRemaining: 0,
      toxicTrapNextTickAt: null,
      healingStepNextTickAt: Number.POSITIVE_INFINITY,
      breathCapacityLeft: 0,
      breathRegenCooldown: 0,
      breathLastTickAt: null,
      activeCooldownMultiplier: 1,
      regenTicks: 0,
      regenHealed: 0,
      breathAutoFireDelayUntil: null,
      breathCooldownUntil: 0,
      wardenRageEvents: [],
      abilityTimingEvents: [],
      plushieOffensiveStacksApplied: 0,
      plushieDefensiveStacksApplied: 0,
      biteCount: 0,
      breathTickCount: 0,
      statusStacksApplied: {},
      statusStacksBlocked: {},
      statusBlockFractions: {},
      abilityAppliedCounts: {},
      conditionalPassiveActive: {},
      combatLog: [],
      badOmenOutcome: null,
      approxNotes: [],
    };
  }

  function initializeStateForRuntime(runtime: CombatantRuntime, state: CombatantState): void {
    const spec = deps.getBreathSpec(runtime);
    state.breathCapacityLeft = spec?.stats?.capacity ?? 0;
    state.breathRegenCooldown = 0;
    state.breathLastTickAt = null;
    state.breathChainStacks = 0;
    state.breathAutoFireDelayUntil = null;
    state.breathCooldownUntil = 0;
    state.activeCooldownMultiplier = runtime.final.activeCooldownMultiplier ?? 1;
    state.radiationNextTickAt =
      hasAbilityName(runtime.effects, "Aura (Corrosion)") ||
      hasAbilityName(runtime.effects, "Aura (Disease)") ||
      hasAbilityName(runtime.effects, "Radiation")
        ? RADIATION_TICK_SEC
        : null;
    state.causeFearCooldownUntil = 0;
    state.refluxCooldownUntil = 0;
    state.refluxChargeReadyAt = 0;
    state.refluxArmed = false;
    state.refluxPuddleUntil = 0;
    state.refluxNextTickAt = null;
    state.rewindCooldownUntil = 0;
    state.rewindHistory = [];
    state.lastMeleeHitAt = Number.NEGATIVE_INFINITY;
    state.lastMeleeHitDamage = 0;
    state.shadowBarrageCooldownUntil = 0;
    state.shadowBarrageNextHitAt = null;
    state.shadowBarrageRemainingHits = 0;
    state.shadowBarrageBaseDamage = 0;
    state.frostSnareCooldownUntil = 0;
    state.poisonAreaCooldownUntil = 0;
    state.yolkBombCooldownUntil = 0;
    state.divinationCooldownUntil = 0;
    state.divinationChargesLeft = 0;
    state.toxicTrapCooldownUntil = 0;
    state.toxicTrapBitesRemaining = 0;
    state.toxicTrapNextTickAt = null;
    state.lanceCooldownUntil = 0;
    state.lanceArmedUntil = 0;
    state.lanceAuraUntil = 0;
    state.lanceAuraNextTickAt = null;

    const hasAnyDamageTrail = DAMAGE_TRAIL_NAMES.some((name) => hasAbilityName(runtime.effects, name));
    state.damageTrailNextTickAt = hasAnyDamageTrail ? DAMAGE_TRAIL_TICK_SEC : null;
    state.healingStepNextTickAt = runtime.hasHealingStep ? HEALING_STEP_TICK_SEC : Number.POSITIVE_INFINITY;
    state.trailsFacetankOverrideActive = false;
    state.trailsFacetankOverridePrev = null;
  }

  return {
    createCombatantState,
    initializeStateForRuntime,
  };
}
