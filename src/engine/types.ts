/** Per-side bite-variant policy mode for Compare runs. Mirrors the
 * Rust contract enum `SimpleBiteVariantMode` (see
 * `wasm-engine/src/composable/config.rs`).
 *
 * - `primaryOnly`   - every bite uses base damage + on-hit ailments.
 * - `dynamic`       - engine picks primary vs. secondary per-bite via the
 *                     BiteVariant policy (`wasm-engine/src/policy/decisions/bite_variant.rs`).
 * - `secondaryOnly` - every bite uses `stats.damage2` and applies no
 *                     on-hit ailments. Replaces the earlier binary
 *                     "Use secondary attack only" toggle.
 *
 * Compare-only by design - Best Builds / Optimizer / Sandbox keep
 * primary-only behavior. */
export type CompareBiteVariantMode = "primaryOnly" | "dynamic" | "secondaryOnly";

export const COMPARE_BITE_VARIANT_MODE_DEFAULT: CompareBiteVariantMode = "primaryOnly";

export type CreatureRuntime = {
  name: string;
  stats: CreatureStats;
  passiveAbilities?: AbilityRef[];
  activatedAbilities?: AbilityRef[];
  breathAbilities?: AbilityRef[];
  /**
   * Custom-ability ids (registered via the Custom tab) attached to
   * this creature. Pre-registered (`user.<...>`) ids only - engine
   * resolves them against the global user-ability registry at
   * simulation start; missing ids drop silently. Default-undefined
   * for built-in creatures so the existing JSON shape doesn't gain
   * a field.
   */
  userAbilityIds?: string[];
  /**
   * User-authored breath profile (custom-creature editor).
   * When set, `applyRulesAndBuild` carries it onto `FinalStats` and
   * `toRustBreathProfile` returns it (with build buffs) instead of the
   * breath-type-name lookup. Default-undefined for built-in creatures.
   */
  customBreathProfile?: CustomBreathProfile | null;
};

/**
 * User-authored breath profile (Custom Abilities v2). Mirrors
 * the engine's `SimpleBreathProfile` / `RustSimpleBreathProfile` in camelCase
 * so it serializes directly. When present on a custom creature it bypasses
 * the breath-type-name lookup in `toRustBreathProfile` (build buffs still
 * apply on top). The six core fields are required; special-kind-specific
 * fields are optional and only consulted for the matching `specialKind`.
 */
export type CustomBreathProfile = {
  dpsPct: number;
  capacity: number;
  regenRate: number;
  critChancePct: number;
  chain: number;
  chainMaxStacks: number;
  specialKind?: string | null;
  selfHealPct?: number;
  cleanseStacks?: number;
  lanceDamagePct?: number;
  lanceChargeSec?: number;
  lanceCooldownSec?: number;
  lanceStatusId?: string | null;
  autoFireDelaySec?: number;
  autoFireCooldownSec?: number;
  chargesMax?: number;
  chargeRegenSec?: number;
  specialStatuses?: Array<{ statusId: string; stacks: number }>;
};

/**
 * Constructor-coverage lock for custom breath.
 *
 * Compile-time-exhaustive map of every `CustomBreathProfile` field to where
 * it's authored. Every field is reachable in `BreathProfileEditor` (the six
 * core fields are always shown; special-kind fields are gated on the chosen
 * `specialKind`), so each maps to `"editor"`. `tsc` forces an entry per key -
 * adding a field to `CustomBreathProfile` fails the build until it's
 * classified here. Pairs with `breathConstructorCoverage.test.ts`, which
 * asserts the editor covers every field AND that the field survives the
 * save-path round-trip through `normalizeCustomCreaturePayload` (the
 * field-by-field rebuild that has silently dropped new fields before).
 */
export const BREATH_PROFILE_FIELD_REGISTRY: Record<keyof CustomBreathProfile, "editor"> = {
  dpsPct: "editor",
  capacity: "editor",
  regenRate: "editor",
  critChancePct: "editor",
  chain: "editor",
  chainMaxStacks: "editor",
  specialKind: "editor",
  selfHealPct: "editor",
  cleanseStacks: "editor",
  lanceDamagePct: "editor",
  lanceChargeSec: "editor",
  lanceCooldownSec: "editor",
  lanceStatusId: "editor",
  autoFireDelaySec: "editor",
  autoFireCooldownSec: "editor",
  chargesMax: "editor",
  chargeRegenSec: "editor",
  specialStatuses: "editor",
};

/** Every `CustomBreathProfile` field, derived from the exhaustive registry. */
export const ALL_BREATH_PROFILE_FIELDS = Object.keys(
  BREATH_PROFILE_FIELD_REGISTRY,
) as Array<keyof CustomBreathProfile>;

export type CreatureStats = {
  tier: number;
  health: number;
  weight: number;
  damage: number;
  biteCooldown: number;
  damage2?: number;
  healthRegen?: number;
  stamina?: number;
  stamRegen?: number;
  walkAndSwimSpeed?: number;
  sprintSpeed?: number;
  turn?: number;
  venerationRate?: number;
  diet?: string;
  type?: string;
  mobilityOverride?: string;
  breath?: string;
  breathResistance?: number;
  // Wiki browse/search fields. Combat-neutral (the engine models a
  // stand-and-fight 1v1 and ignores movement/survival) EXCEPT appetite,
  // which feeds the Gourmandizer/Reflux hunger rule.
  appetite?: number;
  beachSpeed?: number;
  flySpeed?: number;
  flySprintMultiplier?: number;
  glideStaminaRegen?: number;
  takeoffMultiplier?: number;
  jumpPower?: number;
  jumpStamina?: number;
  jumpAge?: number;
  dartPower?: number;
  dartStamina?: number;
  nightvision?: number;
  ambush?: number;
  growthTime?: number;
  hungerDrain?: number;
  thirstDrain?: number;
  moistureTime?: number;
  oxygenTime?: number;
};

export type AbilityRef = {
  abilityId: string;
  name: string;
  value: number | string | null;
  semantics: "neutral" | "offensive" | "defensive" | "block" | string;
  subtype: string | null;
};

export type BuildOptions = {
  venerationStage: number;
  traits: string[];
  ascensionAssignments: string[];
  plushies: string[];
  elder?: ElderVariant;
};

export type InitialStatusOption = {
  statusId: string;
  stacks?: number;
  remainingSec?: number;
  sourceAbilityName?: string;
  noDecay?: boolean;
  stackValueMode?: "durationOnly";
};

export type ElderVariant = "None" | "Devious" | "Gentle" | "Powerful";

export type AbilityTimingOverrideName =
  | "Adrenaline"
  | "Cocoon"
  | "Fortify"
  | "Frost Nova"
  | "Hunker"
  | "Hunters Curse"
  | "Life Leech"
  | "Reflect"
  | "Rewind"
  | "Unbridled Rage"
  | "Warden's Rage";

export type AbilityTimingOverrides = Partial<Record<AbilityTimingOverrideName, AbilityTimingMode>>;

/** Per-fight timing choice for a user-defined ability. Pins the
 * ability's timing for one matchup, bypassing the spec's own
 * `timing_user_override` / `timing_mode_override` defaults. */
export type UserAbilityTimingChoice =
  | { kind: "builtIn"; mode: AbilityTimingMode }
  | { kind: "user"; timingId: string };

/** Map keyed by user.<id>; values pin per-fight timings for those
 * abilities. Empty by default; missing keys fall back to spec
 * defaults; stale user-timing values fall back silently. */
export type UserAbilityTimingOverrides = Record<string, UserAbilityTimingChoice>;

/** Per-fight active-level override map for user
 * abilities with `levels > 1`. Keys are user.<id>; values are the
 * 1-indexed level (1..=spec.levels) to use in THIS matchup, overriding
 * the spec's `default_level`. Empty by default. Out-of-range values
 * fall back to spec defaults silently. */
export type UserAbilityLevelOverrides = Record<string, number>;

export type FinalStats = CreatureStats & {
  name: string;
  hasBreath: boolean;
  breathType: string | null;
  activeCooldownMultiplier?: number;
  approxNotes: string[];
  appliedTraits: string[];
  elder?: ElderVariant;
  elderStatusBlockPct?: number;
  plushieStatusOnHit?: Record<string, number>;
  plushieStatusOnHitTaken?: Record<string, number>;
  plushieStatusBlockPct?: Record<string, number>;
  plushieGrantedOtherAbilities?: Array<{ name: string; value: number | string | null; semantics: string }>;
  breathRegenPct?: number;
  breathDamagePct?: number;
  appetiteDrainPct?: number;
  appetiteCapacityPct?: number;
  plushieReflectAvgPct?: number;
  /** Carried from `CreatureRuntime.customBreathProfile` by
   * `applyRulesAndBuild`; consumed by `toRustBreathProfile`. */
  customBreathProfile?: CustomBreathProfile | null;
};

export type StatusEffect = {
  id: string;
  name: string;
  parsed?: {
    type?: "dot" | "flag" | string;
    dot?: {
      mode?: "flat" | "percentMaxHp";
      damagePerStackPerSec?: number;
      base?: number;
      perStack?: number;
      tickSec?: number | null;
      flatPerTickPct?: number;
    };
    modifiers?: Record<string, number | boolean>;
    caps?: {
      stacking?: "none" | "duration" | string;
      maxStacks?: number;
    };
  };
  source?: string;
};

export type EffectsCatalogByCreature = {
  applyStatusOnHit?: Array<{ statusId: string; stacks: number; sourceAbility: string }>;
  applyStatusOnHitTaken?: Array<{ statusId: string; stacks: number; sourceAbility: string }>;
  resistStatus?: Array<{ statusId: string; fraction: number; sourceAbility: string }>;
  specialAbilitiesDetailed?: Array<{ name: string; value: number | null; def: SpecialAbilityDef }>;
  specialAbilities?: Array<{ name: string; value: number | null; source: string }>;
  otherAbilities?: Array<{ name: string; value: number | string | null; semantics: string }>;
};

export type SpecialAbilityDef =
  | {
      type: "conditionalDamageBoost";
      trigger: { hpRatioGte?: number; hpRatioGt?: number; hpRatioLte?: number; hpRatioLt?: number };
      paramFromCreatureValue?: boolean;
      paramUnknown?: boolean;
      notes?: string;
    }
  | {
      type: "conditionalHpRegenBoost";
      trigger: { hpRatioLte?: number; hpRatioLt?: number };
      paramUnknown?: boolean;
      notes?: string;
    }
  | {
      type: "conditionalMultiStat";
      trigger: { hpRatioLt?: number; hpRatioLte?: number };
      mods: { stamRegenMultiplier?: number; biteCooldownMultiplier?: number };
      paramUnknown?: boolean;
      notes?: string;
    }
  | {
      type: "conditionalAuraStatusPulse";
      trigger: { hpRatioLte?: number; hpRatioLt?: number };
      pulseSec: number;
      apply: Array<{ statusId: string; stacks: number }>;
      paramUnknown?: boolean;
      notes?: string;
    }
  | {
      type: "damageTakenMultiplier";
      when: "onBeingBitten";
      multiplier: number;
      paramUnknown?: boolean;
      notes?: string;
    }
  | {
      type: "conditionalDelayedExplosion";
      trigger: { hpRatioLte?: number; hpRatioLt?: number };
      cooldownSec: number;
      onExplode: {
        dealDamage: { mode: "percentTargetMaxHp"; pct: number };
        applyStatus?: Array<{ statusId: string; stacks: number }>;
      };
      selfAfterExplode: { hpFloorPct: number };
      paramUnknown?: boolean;
      notes?: string;
    }
  | {
      type: "statusImmunity";
      immuneTo: string[];
      paramUnknown?: boolean;
      notes?: string;
    }
  | {
      type: "breathDamageReduction";
      paramFromCreatureValue?: boolean;
      paramUnknown?: boolean;
      notes?: string;
    }
  | {
      type: string;
      paramUnknown?: boolean;
      notes?: string;
    };

export type RulesRuntime = {
  version: string;
  model: {
    activesDefault: "on" | "off";
    environment: "off" | "on" | string;
    pack: "off" | "on" | string;
    pvpMode: "1v1" | string;
    stance: "standing" | "sitting" | "laying" | string;
    useDamage2: boolean;
    useInvisibility: boolean;
    useKeenObserver: boolean;
  };
  damage: {
    melee: {
      weightRatioCap: number;
      targetSitOrLayMultiplier: Record<string, number>;
      packMultiplier: Record<string, number>;
    };
    breath: {
      enabled: boolean;
      weightRatioCap: number;
    };
  };
};

export type BreathSpec = {
  id: string;
  name: string;
  raw?: string;
  effect?: {
    dps?: number;
    perHit?: string;
  };
  stats?: {
    capacity?: number;
    regenRate?: number;
    rangeStuds?: number;
    critChancePct?: number;
    chain?: number;
    chainMaxStacks?: number;
  };
};

export type TraitsRuntime = {
  id: string;
  name: string;
  effectText?: string;
};

export type VenerationRuntime = {
  stages: number;
  stageHours: number | number[];
  tierBonusesAtStage5: Record<string, { extraHealthAt5: number; extraWeightAt5: number }>;
  traitAscension: Record<string, { perAscension: string; sequence: string[] }>;
};

export type PlushieRuntime = {
  id?: string;
  name: string;
  stackRule: "stackable" | "unique" | "unknown" | string;
  modifiersParsed?: Array<{ stat: string; op: "addPct" | "addFlat" | string; value: number; note?: string | null }>;
};

export type SimulationOptions = {
  activesOn: boolean;
  breathOn: boolean;
  maxTimeSec?: number;
  combatEventOrder?: import("./eventOrdering").CombatEventPhase[];
  disabledAbilitiesA?: string[];
  disabledAbilitiesB?: string[];
  initialStatusesA?: InitialStatusOption[];
  initialStatusesB?: InitialStatusOption[];
  activeCooldownMultiplierA?: number;
  activeCooldownMultiplierB?: number;
  badOmenOutcome?: BadOmenOutcome | null;
  abilityPolicy?: AbilityTimingMode;
  abilityPolicyOverridesA?: AbilityTimingOverrides;
  abilityPolicyOverridesB?: AbilityTimingOverrides;
  enableCombatLog?: boolean;
  // Compare-only manual override for the compare page secondary/tail attack toggle.
  // Never route this through Best Builds, optimizer, or any Rust v2 contract/runtime path.
  compareSecondaryAttackOnlyA?: boolean;
  compareSecondaryAttackOnlyB?: boolean;
  // Compare-only disputed charge toggles.
  // Never route these through Best Builds, optimizer, or any Rust v2 contract/runtime path.
  comparePowerChargeA?: boolean;
  comparePowerChargeB?: boolean;
  compareGoreChargeA?: boolean;
  compareGoreChargeB?: boolean;
  compareStartingSpiteChargedA?: boolean;
  compareStartingSpiteChargedB?: boolean;
  // Compare-only Warden's Rage disputed setup. 0/undefined = full HP; otherwise starts at this % of max HP.
  compareWardenRageStartHpPctA?: number;
  compareWardenRageStartHpPctB?: number;
  // Compare-only disputed hunger-rule toggles.
  // Never route these through Best Builds, optimizer, or any Rust v2 contract/runtime path.
  compareHungerRuleA?: boolean;
  compareHungerRuleB?: boolean;
  compareGourmandizerA?: boolean;
  compareGourmandizerB?: boolean;
  compareDefiledGroundLevelA?: number;
  compareDefiledGroundLevelB?: number;
  compareStartingHungerA?: number;
  compareStartingHungerB?: number;
  compareAppetiteBaseA?: number;
  compareAppetiteBaseB?: number;
  // Compare-only disputed trap toggle. Gates Thorn Trap and Toxic Trap activation.
  // Never route this through Best Builds, optimizer, or any Rust v2 contract/runtime path.
  compareTrapsA?: boolean;
  compareTrapsB?: boolean;
  // Compare-only disputed trails toggle. Gates Toxic/Plague/Flame/Frost Trail and Healing Step.
  // Never route this through Best Builds, optimizer, or any Rust v2 contract/runtime path.
  compareTrailsA?: boolean;
  compareTrailsB?: boolean;
  // Compare-only air PvP rule. Never route this through Best Builds, optimizer, or any Rust v2 contract/runtime path.
  compareAirRuleEnabled?: boolean;
  compareAirRuleCooldownSec?: number;
  // Compare-only facetank rule. When enabled, persistent stand-and-fight statuses decay naturally.
  // Never route this through Best Builds, optimizer, or any Rust v2 contract/runtime path.
  compareNoMoveFacetank?: boolean;
  // Compare-only first-tick rule. Applies only to compare simulation and never to Best Builds, optimizer, or Rust v2.
  // `ailments` affects only dot-ticking status ailments, while `regen` affects only the first passive regen tick.
  compareFirstTickMode?: "off" | "ailments" | "regen" | "both";
  compareFirstTickDelaySec?: number;
};

export type AbilityTimingMode = "reallyFast" | "fast" | "semiIdeal" | "ideal" | "extreme";

export type BadOmenOutcome = {
  statusId: string;
  stacks: number;
  label: string;
};

export type SimulationSummary = {
  dpsAtoB: number;
  dpsBtoA: number;
  ttkAtoB: number;
  ttkBtoA: number;
  deathTimeA: number | null;
  deathTimeB: number | null;
  maxTimeSec: number;
  finalHpA: number;
  finalHpB: number;
  maxHpA: number;
  maxHpB: number;
  hpAAtBDeath: number;
  hpBAtADeath: number;
  ehpA: number;
  ehpB: number;
  winner: "A" | "B" | "Draw";
  approxNotes: string[];
  damageDealtA: number;
  damageDealtB: number;
  damageDealtA_untilBDeath: number;
  damageDealtB_untilADeath: number;
  damageDealtAAtBDeath: number;
  damageDealtBAtADeath: number;
  regenHealedA: number;
  regenHealedB: number;
  regenTicksA: number;
  regenTicksB: number;
  extendedDamagePotentialA: number;
  extendedDamagePotentialB: number;
  badOmenOutcome?: BadOmenOutcome;
  combatLog?: CombatLogEntry[];
  debug?: {
    A: SimulationDebug;
    B: SimulationDebug;
  };
};

export type CombatLogEntry = {
  time: number;
  type: "bite" | "dot" | "breath" | "ability";
  attacker: "A" | "B";
  damage: number;
  healing?: number;
  actorHpAfter: number;
  hpSide: "A" | "B";
  hpAfter: number;
  description?: string;
  detail?: string;
  statusId?: string;
};

export type SimulationDebug = {
  totalDamageDealt: number;
  totalLifeLeechHealed: number;
  dotDps: number;
  dotDamageByStatus?: Record<string, number>;
  dotDamageTakenByStatus?: Record<string, number>;
  statuses: Record<string, number>;
  statusStacksApplied?: Record<string, number>;
  statusStacksBlocked?: Record<string, number>;
  statusBlockFractions?: Record<string, number>;
  regenTicks: number;
  regenHealed: number;
  attackerWeight?: number;
  opponentWeight?: number;
  weightRatio?: number;
  weightRatioCapHit?: boolean;
  wardenRageOn: boolean;
  wardenRageStacks: number;
  wardenRageCooldownUntil?: number;
  wardenRageTapUntil?: number;
  lifeLeechActive?: boolean;
  lifeLeechActiveUntil?: number;
  lifeLeechCooldownUntil?: number;
  spiteArmed?: boolean;
  spiteChargeReadyAt?: number;
  spiteCooldownUntil?: number;
  nextRegenAt?: number;
  wardenResistanceActive: boolean;
  reflectActiveUntil: number | null;
  totemNextTickAt: number | null;
  drowsyActive: boolean;
  wardenRageEvents?: string[];
  abilityTimingEvents?: string[];
  abilityPolicyOverrides?: AbilityTimingOverrides;
  plushieOffensiveStacksApplied?: number;
  plushieDefensiveStacksApplied?: number;
  biteCount?: number;
  breathTickCount?: number;
  abilitiesPresent?: string[];
  abilitiesModeled?: string[];
  abilitiesApplied?: Array<{ name: string; count: number }>;
  abilitiesNotModeled?: string[];
  compareHunger?: number;
  compareStartingHunger?: number;
  compareAppetiteBase?: number;
  compareHungerRuleEnabled?: boolean;
};
