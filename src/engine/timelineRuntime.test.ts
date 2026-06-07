import { describe, expect, it } from "vitest";

import { createTimelineRuntime } from "./timelineRuntime";
import type { CombatantState } from "./runtimeContext";
import { sanitizeAbilityTimingOverrides } from "./abilityTimingOverrides";

function stateWith(lastUpdateAt: number, overrides: Partial<CombatantState> = {}): CombatantState {
  const state = {
    sideLabel: "A",
    compareSecondaryAttackOnly: false,
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
    compareStartingHunger: 100,
    compareAppetiteBase: 100,
    compareHunger: 100,
    abilityPolicyOverrides: sanitizeAbilityTimingOverrides(undefined),
    hp: 100,
    nextHitAt: Number.POSITIVE_INFINITY,
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
    adrenalinePlannedAt: 0,
    huntersCursePlannedAt: 0,
    unbridledRagePlannedAt: 0,
    nextRegenAt: Number.POSITIVE_INFINITY,
    regenBufferedTick: false,
    lastUpdateAt,
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
    lastMeleeHitAt: 0,
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
    regenTicks: 0,
    regenHealed: 0,
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
    combatLog: [],
    badOmenOutcome: null,
    approxNotes: [],
    ...overrides,
  } as CombatantState;
  return state;
}

describe("timelineRuntime", () => {
  it("treats events exactly at lastUpdateAt as ready-now events", () => {
    const timeline = createTimelineRuntime({
      nextLifeLeechPlannedAt: () => Number.POSITIVE_INFINITY,
      nextAdrenalinePlannedAt: () => Number.POSITIVE_INFINITY,
      nextHuntersCursePlannedAt: () => Number.POSITIVE_INFINITY,
      nextFrostNovaTickAt: () => Number.POSITIVE_INFINITY,
      nextUnbridledRagePlannedAt: () => Number.POSITIVE_INFINITY,
      nextRegenAt: () => Number.POSITIVE_INFINITY,
      nextTotemTickAt: () => Number.POSITIVE_INFINITY,
      nextTotemReadyAt: () => Number.POSITIVE_INFINITY,
      nextDrowsyAreaReadyAt: () => Number.POSITIVE_INFINITY,
      nextRadiationTickAt: () => Number.POSITIVE_INFINITY,
      nextCauseFearReadyAt: () => Number.POSITIVE_INFINITY,
      nextRefluxChargeReadyAt: () => Number.POSITIVE_INFINITY,
      nextRefluxTickAt: () => Number.POSITIVE_INFINITY,
      nextLanceAuraTickAt: () => Number.POSITIVE_INFINITY,
      nextShadowBarrageHitAt: () => Number.POSITIVE_INFINITY,
      nextToxicTrapTickAt: () => Number.POSITIVE_INFINITY,
      nextDamageTrailTickAt: () => Number.POSITIVE_INFINITY,
      nextHealingStepTickAt: () => Number.POSITIVE_INFINITY,
    });

    expect(timeline.nextEventAtSingle(stateWith(0, { nextHitAt: 0 }), Number.POSITIVE_INFINITY)).toBe(0);
  });

  it("ignores stale events strictly before lastUpdateAt", () => {
    const timeline = createTimelineRuntime({
      nextLifeLeechPlannedAt: () => 10,
      nextAdrenalinePlannedAt: () => 10,
      nextHuntersCursePlannedAt: () => 10,
      nextFrostNovaTickAt: () => 10,
      nextUnbridledRagePlannedAt: () => 10,
      nextRegenAt: () => 10,
      nextTotemTickAt: () => 10,
      nextTotemReadyAt: () => 10,
      nextDrowsyAreaReadyAt: () => 10,
      nextRadiationTickAt: () => 10,
      nextCauseFearReadyAt: () => 10,
      nextRefluxChargeReadyAt: () => 10,
      nextRefluxTickAt: () => 10,
      nextLanceAuraTickAt: () => 10,
      nextShadowBarrageHitAt: () => 10,
      nextToxicTrapTickAt: () => Number.POSITIVE_INFINITY,
      nextDamageTrailTickAt: () => 10,
      nextHealingStepTickAt: () => 10,
    });

    const stateA = stateWith(5, {
      nextHitAt: 4,
      channelingNextPulseAt: 4,
      selfDestructArmedAt: 4,
      statuses: {
        Burn_Status: { stacks: 1, remainingSec: 1, nextTickAt: 4 },
      },
    });
    const stateB = stateWith(5, { nextHitAt: 8 });

    expect(timeline.nextEventAt(stateA, stateB, 4, 9)).toBe(8);
    expect(timeline.nextEventAtSingle(stateA, 4)).toBe(10);
  });

  it("includes reflux charge readiness as a scheduled event", () => {
    const timeline = createTimelineRuntime({
      nextLifeLeechPlannedAt: () => Number.POSITIVE_INFINITY,
      nextAdrenalinePlannedAt: () => Number.POSITIVE_INFINITY,
      nextHuntersCursePlannedAt: () => Number.POSITIVE_INFINITY,
      nextFrostNovaTickAt: () => Number.POSITIVE_INFINITY,
      nextUnbridledRagePlannedAt: () => Number.POSITIVE_INFINITY,
      nextRegenAt: () => Number.POSITIVE_INFINITY,
      nextTotemTickAt: () => Number.POSITIVE_INFINITY,
      nextTotemReadyAt: () => Number.POSITIVE_INFINITY,
      nextDrowsyAreaReadyAt: () => Number.POSITIVE_INFINITY,
      nextRadiationTickAt: () => Number.POSITIVE_INFINITY,
      nextCauseFearReadyAt: () => Number.POSITIVE_INFINITY,
      nextRefluxChargeReadyAt: (state) => state.refluxChargeReadyAt,
      nextRefluxTickAt: () => Number.POSITIVE_INFINITY,
      nextLanceAuraTickAt: () => Number.POSITIVE_INFINITY,
      nextShadowBarrageHitAt: () => Number.POSITIVE_INFINITY,
      nextToxicTrapTickAt: () => Number.POSITIVE_INFINITY,
      nextDamageTrailTickAt: () => Number.POSITIVE_INFINITY,
      nextHealingStepTickAt: () => Number.POSITIVE_INFINITY,
    });

    const state = stateWith(0, {
      refluxArmed: true,
      refluxChargeReadyAt: 5,
      nextHitAt: 9,
    });

    expect(timeline.nextEventAtSingle(state, Number.POSITIVE_INFINITY)).toBe(5);
  });

  it("includes Toxic Trap ticks as scheduled events", () => {
    const timeline = createTimelineRuntime({
      nextLifeLeechPlannedAt: () => Number.POSITIVE_INFINITY,
      nextAdrenalinePlannedAt: () => Number.POSITIVE_INFINITY,
      nextHuntersCursePlannedAt: () => Number.POSITIVE_INFINITY,
      nextFrostNovaTickAt: () => Number.POSITIVE_INFINITY,
      nextUnbridledRagePlannedAt: () => Number.POSITIVE_INFINITY,
      nextRegenAt: () => Number.POSITIVE_INFINITY,
      nextTotemTickAt: () => Number.POSITIVE_INFINITY,
      nextTotemReadyAt: () => Number.POSITIVE_INFINITY,
      nextDrowsyAreaReadyAt: () => Number.POSITIVE_INFINITY,
      nextRadiationTickAt: () => Number.POSITIVE_INFINITY,
      nextCauseFearReadyAt: () => Number.POSITIVE_INFINITY,
      nextRefluxChargeReadyAt: () => Number.POSITIVE_INFINITY,
      nextRefluxTickAt: () => Number.POSITIVE_INFINITY,
      nextLanceAuraTickAt: () => Number.POSITIVE_INFINITY,
      nextShadowBarrageHitAt: () => Number.POSITIVE_INFINITY,
      nextToxicTrapTickAt: (state) => state.toxicTrapNextTickAt ?? Number.POSITIVE_INFINITY,
      nextDamageTrailTickAt: () => Number.POSITIVE_INFINITY,
      nextHealingStepTickAt: () => Number.POSITIVE_INFINITY,
    });

    const state = stateWith(0, {
      toxicTrapBitesRemaining: 25,
      toxicTrapNextTickAt: 3,
      nextHitAt: 9,
    });

    expect(timeline.nextEventAtSingle(state, Number.POSITIVE_INFINITY)).toBe(3);
  });

  it("includes planned Life Leech activation as a scheduled event", () => {
    const timeline = createTimelineRuntime({
      nextLifeLeechPlannedAt: (state) => state.lifeLeechPlannedAt,
      nextAdrenalinePlannedAt: () => Number.POSITIVE_INFINITY,
      nextHuntersCursePlannedAt: () => Number.POSITIVE_INFINITY,
      nextFrostNovaTickAt: () => Number.POSITIVE_INFINITY,
      nextUnbridledRagePlannedAt: () => Number.POSITIVE_INFINITY,
      nextRegenAt: () => Number.POSITIVE_INFINITY,
      nextTotemTickAt: () => Number.POSITIVE_INFINITY,
      nextTotemReadyAt: () => Number.POSITIVE_INFINITY,
      nextDrowsyAreaReadyAt: () => Number.POSITIVE_INFINITY,
      nextRadiationTickAt: () => Number.POSITIVE_INFINITY,
      nextCauseFearReadyAt: () => Number.POSITIVE_INFINITY,
      nextRefluxChargeReadyAt: () => Number.POSITIVE_INFINITY,
      nextRefluxTickAt: () => Number.POSITIVE_INFINITY,
      nextLanceAuraTickAt: () => Number.POSITIVE_INFINITY,
      nextShadowBarrageHitAt: () => Number.POSITIVE_INFINITY,
      nextToxicTrapTickAt: () => Number.POSITIVE_INFINITY,
      nextDamageTrailTickAt: () => Number.POSITIVE_INFINITY,
      nextHealingStepTickAt: () => Number.POSITIVE_INFINITY,
    });

    const state = stateWith(0, {
      lifeLeechPlannedAt: 3.5,
      nextHitAt: 9,
    });

    expect(timeline.nextEventAtSingle(state, Number.POSITIVE_INFINITY)).toBe(3.5);
  });

  it("includes planned Hunters Curse and Unbridled Rage activations as scheduled events", () => {
    const timeline = createTimelineRuntime({
      nextLifeLeechPlannedAt: () => Number.POSITIVE_INFINITY,
      nextAdrenalinePlannedAt: (state) => state.adrenalinePlannedAt,
      nextHuntersCursePlannedAt: (state) => state.huntersCursePlannedAt,
      nextFrostNovaTickAt: () => Number.POSITIVE_INFINITY,
      nextUnbridledRagePlannedAt: (state) => state.unbridledRagePlannedAt,
      nextRegenAt: () => Number.POSITIVE_INFINITY,
      nextTotemTickAt: () => Number.POSITIVE_INFINITY,
      nextTotemReadyAt: () => Number.POSITIVE_INFINITY,
      nextDrowsyAreaReadyAt: () => Number.POSITIVE_INFINITY,
      nextRadiationTickAt: () => Number.POSITIVE_INFINITY,
      nextCauseFearReadyAt: () => Number.POSITIVE_INFINITY,
      nextRefluxChargeReadyAt: () => Number.POSITIVE_INFINITY,
      nextRefluxTickAt: () => Number.POSITIVE_INFINITY,
      nextLanceAuraTickAt: () => Number.POSITIVE_INFINITY,
      nextShadowBarrageHitAt: () => Number.POSITIVE_INFINITY,
      nextToxicTrapTickAt: () => Number.POSITIVE_INFINITY,
      nextDamageTrailTickAt: () => Number.POSITIVE_INFINITY,
      nextHealingStepTickAt: () => Number.POSITIVE_INFINITY,
    });

    const state = stateWith(0, {
      adrenalinePlannedAt: 3.5,
      huntersCursePlannedAt: 4.5,
      unbridledRagePlannedAt: 2.25,
      nextHitAt: 9,
    });

    expect(timeline.nextEventAtSingle(state, Number.POSITIVE_INFINITY)).toBe(2.25);
  });

  it("includes planned Adrenaline activation as a scheduled event", () => {
    const timeline = createTimelineRuntime({
      nextLifeLeechPlannedAt: () => Number.POSITIVE_INFINITY,
      nextAdrenalinePlannedAt: (state) => state.adrenalinePlannedAt,
      nextHuntersCursePlannedAt: () => Number.POSITIVE_INFINITY,
      nextFrostNovaTickAt: () => Number.POSITIVE_INFINITY,
      nextUnbridledRagePlannedAt: () => Number.POSITIVE_INFINITY,
      nextRegenAt: () => Number.POSITIVE_INFINITY,
      nextTotemTickAt: () => Number.POSITIVE_INFINITY,
      nextTotemReadyAt: () => Number.POSITIVE_INFINITY,
      nextDrowsyAreaReadyAt: () => Number.POSITIVE_INFINITY,
      nextRadiationTickAt: () => Number.POSITIVE_INFINITY,
      nextCauseFearReadyAt: () => Number.POSITIVE_INFINITY,
      nextRefluxChargeReadyAt: () => Number.POSITIVE_INFINITY,
      nextRefluxTickAt: () => Number.POSITIVE_INFINITY,
      nextLanceAuraTickAt: () => Number.POSITIVE_INFINITY,
      nextShadowBarrageHitAt: () => Number.POSITIVE_INFINITY,
      nextToxicTrapTickAt: () => Number.POSITIVE_INFINITY,
      nextDamageTrailTickAt: () => Number.POSITIVE_INFINITY,
      nextHealingStepTickAt: () => Number.POSITIVE_INFINITY,
    });

    const state = stateWith(0, {
      adrenalinePlannedAt: 2.75,
      nextHitAt: 9,
    });

    expect(timeline.nextEventAtSingle(state, Number.POSITIVE_INFINITY)).toBe(2.75);
  });
});
