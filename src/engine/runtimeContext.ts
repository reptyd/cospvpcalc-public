import type {
  AbilityTimingMode,
  AbilityTimingOverrides,
  BadOmenOutcome,
  CombatLogEntry,
  CreatureRuntime,
  EffectsCatalogByCreature,
  FinalStats,
  SimulationOptions,
  SpecialAbilityDef,
  StatusEffect,
} from "./types";

export type StatusInstance = {
  stacks: number;
  nextTickAt: number | null;
  nextDecayAt?: number | null;
  remainingSec: number;
  lichMarkOwnedStacks?: number;
  stackValueMode?: "durationOnly";
};

export type RewindSnapshot = {
  time: number;
  hp: number;
  statuses: Record<string, StatusInstance>;
};

export type CombatantRuntime = {
  creature: CreatureRuntime;
  effects: EffectsCatalogByCreature;
  final: FinalStats;
  specialDefs: SpecialAbilityDef[];
  abilityValueByName: Record<string, number | string | null>;
  hasWardenRage: boolean;
  hasWardenResistance: boolean;
  hasReflect: boolean;
  hasTotem: boolean;
  hasDrowsyArea: boolean;
  hasLichMark: boolean;
  hasCursedSigil: boolean;
  hasAdrenaline: boolean;
  hasHealingStep: boolean;
  hasToxicTrail: boolean;
  hasPlagueTrail: boolean;
  hasFlameTrail: boolean;
  hasFrostTrail: boolean;
  hasSpite: boolean;
  hasCauseFear: boolean;
  hasReflux: boolean;
  hasRewind: boolean;
  hasShadowBarrage: boolean;
  hasFrostSnare: boolean;
  hasPoisonArea: boolean;
  hasYolkBomb: boolean;
  hasDivination: boolean;
  hasToxicTrap: boolean;
  hasHarden: boolean;
  hasHuntersCurse: boolean;
  hasUnbridledRage: boolean;
  hasFortify: boolean;
  lichMarkValue: string | null;
  yolkBombValue: string | null;
};

export type CombatantState = {
  sideLabel: "A" | "B";
  compareSecondaryAttackOnly: boolean;
  compareAirRuleEnabled: boolean;
  compareAirRuleCooldownSec: number | null;
  compareNoMoveFacetank: boolean;
  compareFirstTickMode: "off" | "ailments" | "regen" | "both";
  compareFirstTickDelaySec: number;
  compareStatusLastClearedAt: Record<string, number>;
  comparePowerChargeEnabled: boolean;
  comparePowerChargeConsumed: boolean;
  compareGoreChargeEnabled: boolean;
  compareGoreChargeConsumed: boolean;
  compareHungerRuleEnabled: boolean;
  compareGourmandizerEnabled: boolean;
  compareDefiledGroundLevel: number;
  compareDefiledGroundWeaknessEnabled: boolean;
  compareTrapsEnabled: boolean;
  compareTrailsEnabled: boolean;
  // Trails auto-override state: when any trail is active on this combatant, we store
  // the pre-override compareNoMoveFacetank so we can restore it on deactivation.
  trailsFacetankOverrideActive: boolean;
  trailsFacetankOverridePrev: boolean | null;
  // Shared tick schedulers for the 4 damaging trails (per-second) and Healing Step (per 3 seconds).
  damageTrailNextTickAt: number | null;
  compareStartingHunger: number;
  compareAppetiteBase: number;
  compareHunger: number;
  comparePlushieDrainMultiplier: number;
  abilityPolicyOverrides: AbilityTimingOverrides;
  hp: number;
  nextHitAt: number;
  statuses: Record<string, StatusInstance>;
  channelingNextPulseAt: number | null;
  selfDestructArmedAt: number | null;
  selfDestructUsed: boolean;
  damageDealt: number;
  dotDamageDealt: number;
  dotDamageByStatus: Record<string, number>;
  dotDamageTakenByStatus: Record<string, number>;
  lifeLeechHealed: number;
  lifeLeechActiveUntil: number;
  lifeLeechCooldownUntil: number;
  lifeLeechPlannedAt: number;
  lichMarkArmedUntil: number;
  lichMarkCooldownUntil: number;
  lichMarkPendingPayloadStatusId: string | null;
  lichMarkOwnedPayloadStatusId: string | null;
  adrenalinePlannedAt: number;
  huntersCursePlannedAt: number;
  huntersCurseThresholdUnlocked: boolean;
  unbridledRagePlannedAt: number;
  nextRegenAt: number;
  regenBufferedTick: boolean;
  lastUpdateAt: number;
  wardenRageOn: boolean;
  wardenRageStacks: number;
  wardenRageCooldownUntil: number;
  wardenRageTapUntil: number;
  wardenRageHoldMode: boolean;
  hunkerOn: boolean;
  hunkerEffectStartsAt: number;
  hunkerDecisionKey: string | null;
  hunkerDecisionOn: boolean | null;
  hunkerLastDecisionAt: number;
  reflectActiveUntil: number | null;
  reflectCooldownUntil: number;
  drowsyAreaCooldownUntil?: number;
  totemActiveUntil: number | null;
  totemNextTickAt: number | null;
  totemCooldownUntil?: number;
  cursedSigilCooldownUntil: number;
  radiationNextTickAt: number | null;
  adrenalineActiveUntil: number;
  adrenalineCooldownUntil: number;
  hardenActiveUntil: number;
  hardenCooldownUntil: number;
  spiteCooldownUntil: number;
  thornTrapCooldownUntil: number;
  grimLariatCooldownUntil: number;
  huntersCurseActiveUntil: number;
  huntersCurseCooldownUntil: number;
  unbridledRageActiveUntil: number;
  unbridledRageCooldownUntil: number;
  fortifyCooldownUntil: number;
  fortifyImmuneUntil: number;
  fortifyWeightBonusUntil: number;
  lanceCooldownUntil: number;
  lanceArmedUntil: number;
  lanceAuraUntil: number;
  lanceAuraNextTickAt: number | null;
  frostNovaActiveUntil: number;
  frostNovaCooldownUntil: number;
  frostNovaNextTickAt: number | null;
  spiteChargeReadyAt: number;
  spiteArmed: boolean;
  causeFearCooldownUntil: number;
  refluxCooldownUntil: number;
  refluxChargeReadyAt: number;
  refluxArmed: boolean;
  refluxPuddleUntil: number;
  refluxNextTickAt: number | null;
  rewindCooldownUntil: number;
  rewindHistory: RewindSnapshot[];
  lastMeleeHitAt: number;
  lastMeleeHitDamage: number;
  shadowBarrageCooldownUntil: number;
  shadowBarrageNextHitAt: number | null;
  shadowBarrageRemainingHits: number;
  shadowBarrageBaseDamage: number;
  frostSnareCooldownUntil: number;
  poisonAreaCooldownUntil: number;
  yolkBombCooldownUntil: number;
  divinationCooldownUntil: number;
  divinationChargesLeft: number;
  toxicTrapCooldownUntil: number;
  toxicTrapBitesRemaining: number;
  toxicTrapNextTickAt: number | null;
  healingStepNextTickAt: number;
  breathCapacityLeft: number;
  breathRegenCooldown: number;
  breathLastTickAt: number | null;
  breathChainStacks?: number;
  breathAutoFireDelayUntil?: number | null;
  breathCooldownUntil?: number;
  activeCooldownMultiplier?: number;
  regenTicks: number;
  regenHealed: number;
  wardenRageEvents: string[];
  abilityTimingEvents: string[];
  plushieOffensiveStacksApplied: number;
  plushieDefensiveStacksApplied: number;
  biteCount: number;
  breathTickCount: number;
  statusStacksApplied: Record<string, number>;
  statusStacksBlocked: Record<string, number>;
  statusBlockFractions: Record<string, number>;
  abilityAppliedCounts: Record<string, number>;
  conditionalPassiveActive?: Record<string, boolean>;
  combatLog: CombatLogEntry[];
  badOmenOutcome?: BadOmenOutcome | null;
  approxNotes: string[];
};

export type StatusAggregate = {
  damagePct: number;
  damageBoostPct: number;
  damageReductionPct: number;
  biteCooldownIncreasePct: number;
  biteCooldownIncreasePerStackPct: number;
  weightReductionBasePct: number;
  weightReductionPerStackPct: number;
  weightReductionCapPct: number;
  weightBoostPct: number;
  weightBoostPerStackPct: number;
  reflectsMeleeDamage: boolean;
  hpRegenDebuffPct: number;
  hpRegenDebuffPerStackPct: number;
  hpRegenBoostPct: number;
  stamRegenPct: number;
  disablesHpRegen: boolean;
};

export type DisabledSet = Set<string>;

export type CombatSide = {
  runtime: CombatantRuntime;
  state: CombatantState;
  disabled: DisabledSet;
};

export type TickContext = {
  time: number;
  attacker: CombatSide;
  defender: CombatSide;
  activesOn: boolean;
  abilityPolicy: AbilityTimingMode;
};

export type StatusApplyContext = {
  time: number;
  target: CombatSide;
  statusId: string;
  stacks: number;
  lichMarkOwnedStacks?: number;
  source?: { sideLabel: CombatantState["sideLabel"]; combatLog: CombatantState["combatLog"]; hp?: number };
  sourceAbilityName?: string;
  stackValueMode?: "durationOnly";
};

export type DotTickContext = {
  time: number;
  target: CombatSide;
  sourceState?: CombatantState;
};

export type HealStatusesContext = {
  time: number;
  target: CombatSide;
  stacksToHeal: number;
};

export type BreathTickContext = TickContext & {
  breathOn: boolean;
};

export type EngineContext = {
  attacker: FinalStats;
  defender: FinalStats;
  options: SimulationOptions;
  maxTime: number;
};

export type StatusDefGetter = (statusId: string) => StatusEffect | undefined;
