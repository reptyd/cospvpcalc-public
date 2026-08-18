import type { CombatEventPhase } from "../engine/eventOrdering";

// Rust-side output shape mirrors wasm-engine/src/contracts.rs.
// Must stay structurally compatible with BestBuildsMatchupSummary (BB consumers
// narrow to the 8-field subset; Compare consumers read the full surface).
export type RustCombatLogEntry = {
  time: number;
  type: "bite" | "dot" | "breath" | "ability" | "dodge";
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

export type RustAbilityAppliedCount = {
  name: string;
  count: number;
};

export type RustSimulationDebug = {
  totalDamageDealt: number;
  totalLifeLeechHealed: number;
  dotDps: number;
  regenTicks: number;
  regenHealed: number;
  weightRatio: number;
  weightRatioCapHit: boolean;
  attackerWeight: number;
  opponentWeight: number;
  wardenRageOn: boolean;
  wardenRageStacks: number;
  wardenRageCooldownUntil: number;
  wardenRageTapUntil: number;
  nextRegenAt: number | null;
  wardenRageEvents: string[];
  abilityTimingEvents: string[];
  abilityPolicyOverrides: Record<string, string>;
  wardenResistanceActive: boolean;
  reflectActiveUntil: number;
  totemNextTickAt: number | null;
  drowsyActive: boolean;
  plushieOffensiveStacksApplied: number;
  plushieDefensiveStacksApplied: number;
  abilitiesPresent: string[];
  abilitiesModeled: string[];
  abilitiesApplied: RustAbilityAppliedCount[];
  abilitiesNotModeled: string[];
  statusStacksApplied: Record<string, number>;
  statusStacksBlocked: Record<string, number>;
  statusStackBlockFractions: Record<string, number>;
  biteCount: number;
  breathFireTimes: number[];
  compareHunger: number;
  compareStartingHunger: number;
  compareAppetiteBase: number;
  compareHungerRuleEnabled: boolean;
};

export type RustSimulationDebugBySide = {
  A: RustSimulationDebug;
  B: RustSimulationDebug;
};

export type RustBadOmenOutcome = {
  statusId: string;
  stacks: number;
  label: string;
};

export type RustMatchupSummary = {
  winner: "A" | "B" | "Draw";
  deathTimeA: number | null;
  deathTimeB: number | null;
  maxTimeSec: number;
  dpsAtoB: number;
  dpsBtoA: number;
  ttkAtoB: number;
  ttkBtoA: number;
  damageDealtA: number;
  damageDealtB: number;
  damageDealtAAtBDeath: number;
  damageDealtBAtADeath: number;
  extendedDamagePotentialA: number;
  extendedDamagePotentialB: number;
  finalHpA: number;
  finalHpB: number;
  maxHpA: number;
  maxHpB: number;
  hpAAtBDeath: number;
  hpBAtADeath: number;
  damageDealtA_untilBDeath: number;
  damageDealtB_untilADeath: number;
  ehpA: number;
  ehpB: number;
  ehpMitigationMultA?: number;
  ehpMitigationMultB?: number;
  regenHealedA: number;
  regenHealedB: number;
  regenTicksA: number;
  regenTicksB: number;
  /** Event-loop iterations the fight consumed, inner replays included - the
   * engine's deterministic cost meter. Best Builds budgets against it. */
  workUnits?: number;
  combatLog?: RustCombatLogEntry[];
  debug?: RustSimulationDebugBySide;
  badOmenOutcome?: RustBadOmenOutcome;
};

/**
 * One side's captured rollout-timed defensive schedule. Mirrors the Rust
 * `PinnedDefensiveScheduleDto` in `wasm-engine/src/composable/mod.rs`:
 * Fortify's fire timeline plus each toggle's committed held-state timeline.
 * Both members are omitted by the serializer when empty (`fortify` absent when
 * the side carries no Fortify; `toggles` absent when nothing was recorded).
 */
export type RustPinnedDefensiveSide = {
  fortify?: {
    fires: number[];
    cursor: number;
    resumeGateAfterLast: boolean;
  };
  toggles?: Array<{ id: string; answers: Array<[number, boolean]> }>;
};

/**
 * Both sides' captured defensive schedule, produced by
 * `captureDefensivePinSchedule` from a full `ideal` run and replayed verbatim by
 * `simulateComposableMatchupPinned`. Treated as opaque by callers - captured
 * once and fed straight back. Mirrors Rust `DefensivePinControlDto`.
 */
export type RustPinnedDefensiveSchedule = {
  attacker: RustPinnedDefensiveSide;
  defender: RustPinnedDefensiveSide;
};

export type RustSimpleCombatantStats = {
  health: number;
  weight: number;
  damage: number;
  biteCooldown: number;
  /**
   * Wiki-sourced secondary-attack damage (`stats.damage2` in
   * `data/creatures.runtime.json`). Optional in the bridge because most
   * creatures don't have a secondary attack (the field stays `null` in
   * the JSON and serializes to `0` on the Rust side via `#[serde(default)]`).
   * Read by the BiteVariant policy when dynamic mode is on; the existing
   * binary "Use secondary attack only" toggle still routes through `damage`
   * (TS bridge overrides at serialization time, see rustCompareMatchupRuntime).
   */
  damage2?: number;
  healthRegen: number;
  activeCooldownMultiplier?: number;
  quickRecoveryHpRatioThreshold?: number;
  unbreakableDamageCapPct?: number;
  damageTakenMultiplierOnBeingBitten?: number;
  damageTakenMultiplierOnBreath?: number;
  breathResistance?: number;
  berserkBiteCooldownMultiplier?: number;
  berserkHpRatioThreshold?: number;
  firstStrikePct?: number;
  firstStrikeHpRatioThreshold?: number;
  hasWardenResistance?: boolean;
  hasReflect?: boolean;
  immuneStatusIds?: string[];
  hunkerReductionPct?: number;
  selfDestructProfile?: {
    triggerHpRatioLte: number;
    damagePct: number;
    selfHpFloorPct: number;
    cooldownSec: number;
    armingStacks: number;
    applyStatuses: Array<{ statusId: string; stacks: number }>;
  } | null;
  onHitStatuses?: Array<{ statusId: string; stacks: number; sourceAbility?: string | null }>;
  onHitTakenStatuses?: Array<{ statusId: string; stacks: number; sourceAbility?: string | null }>;
  startingStatuses?: Array<{
    statusId: string;
    stacks: number;
    stackValueMode?: "durationOnly";
    sourceAbility?: string | null;
    /** Lifetime of the seeded instance; omitted = the status registry's own
     *  per-stack decay pacing. */
    remainingSec?: number;
    /** Seeded instance never decays (Broodwatcher's Defensive stacks). */
    noDecay?: boolean;
  }>;
  statusResistFractions?: Record<string, number>;
  plushieStatusBlockFractions?: Record<string, number>;
  /** Umbrella / all-ailment block (elder BlockAilment); Radiation-immune. */
  elderBlockFraction?: number;
  plushieReflectAvgPct?: number;
  muddyStrengthBoostPct?: number;
  /**
   * Normalized (via `normalizeAbilityName`) ability names to skip during
   * combat. The wasm engine filters on-hit/on-hit-taken/starting statuses by
   * `sourceAbility` and zeroes passive-flag fields whose controlling ability
   * is disabled (Berserk, First Strike, Reflect, Warden's Resistance,
   * Breath Resistance, Hunker, Quick Recovery, Unbreakable, Self-Destruct).
   */
  disabledAbilities?: string[];
  /**
   * Compare-only Fixed Bite Cadence in seconds. 0 =
   * disabled (normal calc). When > 0, Rust bypasses status and berserk
   * modifiers and returns `max(0.1, this)` from the bite-cooldown helper.
   */
  compareAirRuleCooldownSec?: number;
  /**
   * Custom-ability ids attached to this side. The
   * engine resolves each id against the user-ability registry at
   * simulation start; unknown ids drop silently. Default-empty so
   * creatures without custom abilities don't add a field to the JSON.
   */
  userAbilityIds?: string[];
  /**
   * Read-only creature identity surfaced to the
   * custom-ability decision DSL (`is_type` / `is_diet` / `is_elder` /
   * `tier` read-vars). Mirrors Rust `CreatureIdentity`. Optional /
   * empty-defaulted so pre-Phase-5 payloads round-trip byte-identical;
   * when absent, every identity read resolves to 0/false.
   */
  identity?: {
    type?: string;
    diet?: string;
    elder?: string;
    tier?: number;
    isAerial?: boolean;
  };
  /**
   * Seconds-to-depletion of this creature's oxygen / moisture pools, sourced
   * from `FinalStats.oxygenTime` / `.moistureTime`. Consumed only by the
   * Compare-only Oxygen / Moisture drain mode (`oxygenMoistureMode`). 0 (the
   * default) = immune in the corresponding mode; inert in every other mode.
   */
  oxygenTime?: number;
  moistureTime?: number;
  /**
   * Compare-only Dodge Chance rule: chance (0..100) an incoming bite / breath
   * tick lands on this creature. Read only when `aerialDodgeActive` is set on
   * the config. The bridge writes the flier's configured hit chance here and
   * 100 for a non-flier (always hit); Shredded Wings forces 100 in-engine. 0
   * (default) is never read while the rule is off -> byte-identical.
   */
  aerialDodgeHitChancePct?: number;
};

export type RustSimpleBreathProfile = {
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
  /** Plasma Beam-style discrete charges; only consulted when
   * `specialKind === "plasma_beam"`. Number of charges at fight
   * start (also the cap). */
  chargesMax?: number;
  /** Seconds between background charge regens for plasma_beam.
   * Capped at `chargesMax`. */
  chargeRegenSec?: number;
  specialStatuses?: Array<{ statusId: string; stacks: number }>;
};

export type RustAbilityTimingMode = "reallyFast" | "fast" | "semiIdeal" | "ideal" | "extreme";

/** Per-fight timing choice for a user-defined ability. Tagged
 * union shape matches `AbilityTimingChoice` in
 * wasm-engine/src/contracts.rs. */
export type RustAbilityTimingChoice =
  | { kind: "builtIn"; mode: RustAbilityTimingMode }
  | { kind: "user"; timingId: string };

// Per-ability timing overrides. Keys are display-name strings matching Rust's
// serde rename on `AbilityPolicyOverrides` in wasm-engine/src/contracts.rs.
// Missing keys fall back to the session-default `abilityPolicy`.
//
// `userAbilityOverrides` is keyed by the user.<id> registered via the
// custom-ability bridge. Values pin the timing for that ability for THIS
// matchup, overriding the spec's own defaults. Stale ids and stale
// user-timing values fall back to spec defaults silently.
export type RustAbilityPolicyOverrides = Partial<{
  "Warden's Rage": RustAbilityTimingMode;
  "Hunker": RustAbilityTimingMode;
  "Life Leech": RustAbilityTimingMode;
  "Adrenaline": RustAbilityTimingMode;
  "Hunters Curse": RustAbilityTimingMode;
  "Unbridled Rage": RustAbilityTimingMode;
  "Fortify": RustAbilityTimingMode;
  "Rewind": RustAbilityTimingMode;
  "Reflect": RustAbilityTimingMode;
  "Frost Nova": RustAbilityTimingMode;
  "Cocoon": RustAbilityTimingMode;
  userAbilityOverrides: Record<string, RustAbilityTimingChoice>;
  // Per-fight active-level override for user
  // abilities. Keys are user.<id>; values are 1-indexed levels.
  // Missing / out-of-range entries fall back to the spec's
  // `default_level` silently.
  userAbilityLevels: Record<string, number>;
}>;

export type RustSimpleAppliedStatus = {
  statusId: string;
  stacks: number;
  sourceAbility?: string | null;
};

/**
 * Per-side bite-variant policy mode. Mirrors Rust
 * `SimpleBiteVariantMode` in `wasm-engine/src/composable/config.rs`.
 *
 * - `primaryOnly`   - every bite uses primary damage + on-hit ailments.
 * - `dynamic`       - engine picks per-bite via the BiteVariant policy.
 * - `secondaryOnly` - every bite uses `damage2` and skips on-hit ailments.
 *
 * Default on the Rust side is `primaryOnly`; missing fields here
 * deserialize to that.
 */
export type RustBiteVariantMode = "primaryOnly" | "dynamic" | "secondaryOnly";

/**
 * Per-side breath firing policy. Mirrors Rust `SimpleBreathPolicyMode` in
 * `wasm-engine/src/composable/config.rs`.
 *
 * - `onAvailability` - fire whenever the fuel meter is positive (the
 *   regen-limited cadence). For a chain breath every isolated tap resets the
 *   chain, so the ramp never builds.
 * - `onFullBar`      - hold fire until the meter is full, then burst
 *   continuously (chain ramps) until it drains, then reset + refill.
 * - `ideal`          - pick the burst-start timing that maximizes the actor's
 *   own end HP.
 *
 * Only consulted by the engine under its `BREATH_BURST_MODEL` flag; with the
 * flag off the field is inert. Default on the Rust side is `onAvailability`;
 * missing fields here deserialize to that.
 */
export type RustBreathPolicyMode = "onAvailability" | "onFullBar" | "ideal";

export type RustComposableAbilityConfig = {
  attackerThornTrap?: boolean;
  defenderThornTrap?: boolean;
  attackerToxicTrap?: boolean;
  defenderToxicTrap?: boolean;
  attackerFrostSnare?: boolean;
  defenderFrostSnare?: boolean;
  /** Aura subtype for the attacker, e.g. "Disease", "Corrosion". */
  attackerAuraSubtype?: string | null;
  /** Aura subtype for the defender, e.g. "Disease", "Corrosion". */
  defenderAuraSubtype?: string | null;
  attackerCursedSigilStacks?: number;
  defenderCursedSigilStacks?: number;
  attackerFortify?: boolean;
  defenderFortify?: boolean;
  attackerDrowsyArea?: boolean;
  defenderDrowsyArea?: boolean;
  attackerUnbridledRage?: boolean;
  defenderUnbridledRage?: boolean;
  attackerHuntersCurse?: boolean;
  defenderHuntersCurse?: boolean;
  attackerLifeLeechValue?: number;
  defenderLifeLeechValue?: number;
  attackerRewind?: boolean;
  defenderRewind?: boolean;
  attackerWardenRage?: boolean;
  defenderWardenRage?: boolean;
  attackerAdrenaline?: boolean;
  defenderAdrenaline?: boolean;
  attackerLichMark?: boolean;
  defenderLichMark?: boolean;
  attackerLichMarkPayloadStatusId?: string | null;
  defenderLichMarkPayloadStatusId?: string | null;
  attackerSpiteValue?: number;
  defenderSpiteValue?: number;
  attackerFrostNova?: boolean;
  defenderFrostNova?: boolean;
  attackerReflux?: boolean;
  defenderReflux?: boolean;
  attackerTotem?: boolean;
  defenderTotem?: boolean;
  /** Ailment a Totem applies. Omitted/null => Poison_Status (the historical
   *  default). Set to e.g. "Radiation_Status" for a Totem Radiation. */
  attackerTotemStatusId?: string | null;
  defenderTotemStatusId?: string | null;
  attackerGuardiansPassage?: boolean;
  defenderGuardiansPassage?: boolean;
  attackerReflect?: boolean;
  defenderReflect?: boolean;
  attackerCauseFear?: boolean;
  defenderCauseFear?: boolean;
  attackerGrimLariat?: boolean;
  defenderGrimLariat?: boolean;
  attackerShadowBarrageValue?: number;
  defenderShadowBarrageValue?: number;
  attackerHunker?: boolean;
  defenderHunker?: boolean;
  attackerDivination?: boolean;
  defenderDivination?: boolean;

  // --- Additional abilities (Poison Area / Yolk Bomb / Harden) -------------
  attackerPoisonArea?: boolean;
  defenderPoisonArea?: boolean;
  attackerYolkBomb?: boolean;
  defenderYolkBomb?: boolean;
  attackerYolkBombValue?: string | null;
  defenderYolkBombValue?: string | null;
  attackerHarden?: boolean;
  defenderHarden?: boolean;
  attackerCocoon?: boolean;
  defenderCocoon?: boolean;

  // --- Healing Pulse (Compare-only disputed active) -----------------------
  attackerHealingPulse?: boolean;
  defenderHealingPulse?: boolean;
  attackerHealingPulseOnce?: boolean;
  defenderHealingPulseOnce?: boolean;

  // --- Expunge (default-modeled active; kill-secure OR heal-save policy) ---
  attackerExpunge?: boolean;
  defenderExpunge?: boolean;

  // --- Damage trails (Compare "Trails" toggle) -----------------------------
  attackerHealingStepValue?: number;
  defenderHealingStepValue?: number;
  attackerFlameTrailValue?: number;
  defenderFlameTrailValue?: number;
  attackerFrostTrailValue?: number;
  defenderFrostTrailValue?: number;
  attackerPlagueTrailValue?: number;
  defenderPlagueTrailValue?: number;
  attackerToxicTrailValue?: number;
  defenderToxicTrailValue?: number;
  /** Generic damage-trail channel: any ailment can ride the trail mechanic
   *  (same HP-threshold gate + 2% maxHP + 2 stacks/tick semantics as the named
   *  flavors above). Status id + its HP-threshold value. Lets "Trail
   *  Radiation"/"Necropoison Trail" flow through without a dedicated flavor. */
  attackerTrailStatusId?: string | null;
  defenderTrailStatusId?: string | null;
  attackerTrailValue?: number;
  defenderTrailValue?: number;

  // --- Compare buff aggregate (Frosty/Volcanic/Pack Healer/...) -----------
  attackerCompareRegenBonusPct?: number;
  defenderCompareRegenBonusPct?: number;

  // --- Compare pre-armed charges ------------------------------------------
  attackerSpiteReadyAtStart?: boolean;
  defenderSpiteReadyAtStart?: boolean;
  attackerPowerCharge?: boolean;
  defenderPowerCharge?: boolean;
  attackerGoreCharge?: boolean;
  defenderGoreCharge?: boolean;

  // --- Compare no-move facetank (inverse: blocks persistent-DoT decay) ----
  attackerCompareBlockPersistentDecay?: boolean;
  defenderCompareBlockPersistentDecay?: boolean;

  // --- Compare first-tick rule --------------------------------------------
  attackerCompareFirstTickRegen?: boolean;
  defenderCompareFirstTickRegen?: boolean;
  attackerCompareFirstTickAilments?: boolean;
  defenderCompareFirstTickAilments?: boolean;
  attackerCompareFirstTickDelaySec?: number;
  defenderCompareFirstTickDelaySec?: number;

  // --- Compare-only posture policy (lay/sit/stay) -------------------------
  // When enabled the engine evaluates per-side whether to sit/lay/stand
  // via a forward-simulation fitness comparison vs the "stay" baseline.
  // `regenAware` (only consulted when policy is enabled) lets the policy
  // time decisions around regen ticks; false = "ignore regen, only lay
  // for ailment clearing".
  attackerPosturePolicyEnabled?: boolean;
  defenderPosturePolicyEnabled?: boolean;
  attackerPosturePolicyRegenAware?: boolean;
  defenderPosturePolicyRegenAware?: boolean;

  // --- Compare hunger / Gourmandizer / Defiled Ground ---------------------
  attackerCompareMuddyBuff?: boolean;
  defenderCompareMuddyBuff?: boolean;
  attackerCompareStartHpPct?: number;
  defenderCompareStartHpPct?: number;
  attackerHeadStartSec?: number;
  defenderHeadStartSec?: number;
  attackerCompareGourmandizerFillPct?: number;
  defenderCompareGourmandizerFillPct?: number;
  attackerCompareGourmandizer?: boolean;
  defenderCompareGourmandizer?: boolean;
  attackerCompareHungerRule?: boolean;
  defenderCompareHungerRule?: boolean;
  attackerCompareStartingHunger?: number;
  defenderCompareStartingHunger?: number;
  attackerReflectResponseHold?: boolean;
  defenderReflectResponseHold?: boolean;
  attackerCompareStartingThirst?: number;
  defenderCompareStartingThirst?: number;
  // Meter ownership, named the way the game names it so an omitted flag
  // leaves the side carrying both. Photovore has no hunger; Aquatic and
  // Photocarnivore have no thirst.
  attackerCompareHasNoHunger?: boolean;
  defenderCompareHasNoHunger?: boolean;
  attackerCompareHasNoThirst?: boolean;
  defenderCompareHasNoThirst?: boolean;
  attackerCompareAppetiteBase?: number;
  defenderCompareAppetiteBase?: number;
  attackerCompareDefiledGroundLevel?: number;
  defenderCompareDefiledGroundLevel?: number;
  attackerCompareDefiledGroundWeakness?: boolean;
  defenderCompareDefiledGroundWeakness?: boolean;
  // Darkstar plushie: while settled sit/lay, x1.25 ailment-recovery on the
  // Defiled-Ground-recoverable set (composes with the DG level bonus). Maps
  // to `*_compare_dark_star`; engine-native via CombatSide::recoverable_recovery_mult.
  attackerCompareDarkStar?: boolean;
  defenderCompareDarkStar?: boolean;

  // --- Plushie hunger drain multiplier ------------------------------------
  attackerComparePlushieDrainMultiplier?: number;
  defenderComparePlushieDrainMultiplier?: number;
  attackerComparePlushieThirstDrainMultiplier?: number;
  defenderComparePlushieThirstDrainMultiplier?: number;

  // --- Bad Omen follow-ups, consumed one per expiry (cycling) -------------
  // Compare/Sandbox fill this with a freshly-rolled random batch (Bad Omen is
  // random); Best Builds/Optimizer pass a single deterministic outcome (Burn 8).
  badOmenOutcomes?: RustBadOmenOutcome[];

  // --- Per-ability timing overrides (Compare-only; BB uses session-default) -
  attackerAbilityPolicyOverrides?: RustAbilityPolicyOverrides;
  defenderAbilityPolicyOverrides?: RustAbilityPolicyOverrides;

  // --- Same-time event ordering -------------------------------------------
  combatEventOrder?: CombatEventPhase[];

  // --- Compare-page environment flags for user abilities ---
  // Mirror of `ComposableAbilityConfig::compare_day_night` and
  // `compare_moon` (Rust `Option<String>` -> optional string here). Forwarded
  // verbatim from the session UI knobs; the engine maps them to
  // `env.is_day` / `env.is_night` / `env.is_blue_moon` / `env.is_blood_moon`
  // expression vars at simulation start. Day/night and moon also separately
  // drive FinalStats buffs via `applyCompareBuffRuntime` (TS-side) - the
  // Rust path sees the already-buffed stats and reads these strings only
  // for the `env.*` exposure.
  //
  // Day/night values: "none" | "day" | "night".
  // Moon values: "none" | "blueMoon" | "bloodMoon".
  compareDayNight?: string;
  compareMoon?: string;
  compareSeasonHungerInterval?: number;
  compareSeasonThirstInterval?: number;
  // Global weather cataclysm applied to BOTH sides at setup.
  // Values: "none" | "heatWave" | "blizzard" | "acidRain".
  // Immunity (Volcanic vs Heat Wave, Frosty vs Blizzard) is resolved on
  // the TS side and delivered per-side here; Acid Rain has no immunity.
  weather?: string;
  attackerWeatherImmune?: boolean;
  defenderWeatherImmune?: boolean;
  // Global Oxygen / Moisture drain mode applied to BOTH sides.
  // Values: "off" | "ground" | "underwater". The per-side oxygenTime /
  // moistureTime pools live on RustSimpleCombatantStats; this selects which
  // pool drains. None / "off" is inert (no drain).
  oxygenMoistureMode?: string;
  // Compare-only Dodge Chance rule. When active, each incoming bite / breath
  // tick rolls against the target side's aerialDodgeHitChancePct. realRandom =
  // seeded independent rolls (Compare/Sandbox only, varies per run); default
  // false = deterministic even pattern. seed feeds the real-random stream.
  aerialDodgeActive?: boolean;
  aerialDodgeRealRandom?: boolean;
  aerialDodgeSeed?: number;
  // Compare-only "Nearby radiated creatures": extra radiated creatures (besides
  // the two fighters) sharing the area. Radiation's 0.5%/tick is additive across
  // nearby radiated creatures, so it scales each fighter's Radiation DOT.
  // Global / matchup-level; default 0 = a single source (plain 0.5%).
  radiationNearbyCount?: number;
  // Storming debuff (+10% incoming on the afflicted side). The raw buff
  // toggle is carried here; the terrestrial-self / aquatic-opponent gate is
  // applied per-matchup where both creatures are known.
  attackerStorming?: boolean;
  defenderStorming?: boolean;
  /**
   * Per-side bite-variant policy mode. Default `primaryOnly` mirrors
   * today's behavior. `secondaryOnly` replaces the earlier TS-side
   * damage substitution path (rustCompareMatchupRuntime no longer
   * mutates `damage`/`onHitStatuses` itself - the engine reads this
   * flag at each bite event).
   */
  attackerBiteVariantMode?: RustBiteVariantMode;
  defenderBiteVariantMode?: RustBiteVariantMode;

  /**
   * Per-side breath firing policy. Default `onAvailability` matches today's
   * behavior. Inert unless the engine's `BREATH_BURST_MODEL` flag is on.
   */
  attackerBreathPolicy?: RustBreathPolicyMode;
  defenderBreathPolicy?: RustBreathPolicyMode;
};

export type RustComposableMatchupFn = (
  attacker: RustSimpleCombatantStats,
  defender: RustSimpleCombatantStats,
  attackerBreath: RustSimpleBreathProfile | null,
  defenderBreath: RustSimpleBreathProfile | null,
  abilityPolicy: RustAbilityTimingMode,
  abilityConfig: RustComposableAbilityConfig,
  maxTimeSec: number,
  recordTrace?: boolean,
) => Promise<RustMatchupSummary> | RustMatchupSummary;

export type LoadedRustComposableMatchupFn = (
  attacker: RustSimpleCombatantStats,
  defender: RustSimpleCombatantStats,
  attackerBreath: RustSimpleBreathProfile | null,
  defenderBreath: RustSimpleBreathProfile | null,
  abilityPolicy: RustAbilityTimingMode,
  abilityConfig: RustComposableAbilityConfig,
  maxTimeSec: number,
  recordTrace?: boolean,
) => RustMatchupSummary;

/** Capture both sides' defensive schedule from a full `ideal` run. Always
 * `ideal` on the Rust side - the funnel captures the reference fight. */
export type LoadedRustCaptureDefensivePinScheduleFn = (
  attacker: RustSimpleCombatantStats,
  defender: RustSimpleCombatantStats,
  attackerBreath: RustSimpleBreathProfile | null,
  defenderBreath: RustSimpleBreathProfile | null,
  abilityConfig: RustComposableAbilityConfig,
  maxTimeSec: number,
) => RustPinnedDefensiveSchedule;

/** Replay a matchup under `GateOnly` with a captured schedule pinned on both
 * sides - reproduces the full `ideal` fight without the per-decision rollout. */
export type LoadedRustSimulateComposableMatchupPinnedFn = (
  attacker: RustSimpleCombatantStats,
  defender: RustSimpleCombatantStats,
  attackerBreath: RustSimpleBreathProfile | null,
  defenderBreath: RustSimpleBreathProfile | null,
  abilityConfig: RustComposableAbilityConfig,
  pinnedSchedule: RustPinnedDefensiveSchedule,
  maxTimeSec: number,
  recordTrace?: boolean,
) => RustMatchupSummary;

/**
 * Deduplicated inputs for a whole rectangle of fights. The Best Builds funnel
 * screens many builds against the same opponents, so each attacker, defender,
 * breath profile and ability config appears once in its pool and `fights` picks
 * them per fight - five indices each, in the order attacker, defender, attacker
 * breath, defender breath, config. A negative breath index means "no breath
 * profile on that side".
 */
export type RustComposableMatchupBatch = {
  attackers: RustSimpleCombatantStats[];
  defenders: RustSimpleCombatantStats[];
  attackerBreaths: RustSimpleBreathProfile[];
  defenderBreaths: RustSimpleBreathProfile[];
  configs: RustComposableAbilityConfig[];
  abilityPolicy: RustAbilityTimingMode;
  maxTimeSec: number;
  fights: number[];
};

/** Runs a `RustComposableMatchupBatch` in one crossing; summaries come back in
 * fight order. */
export type LoadedRustSimulateComposableMatchupBatchFn = (
  batch: RustComposableMatchupBatch,
) => RustMatchupSummary[];

// Composable engine is the only Rust combat dispatcher. Bespoke contour
// bridge entries were deleted 2026-04-09 after fixture-parity verification.
export type RustMatchupBridge = {
  contractVersion: string;
  simulateComposableMatchup: RustComposableMatchupFn;
};

export type LoadedRustMatchupBridge = {
  contractVersion: string;
  simulateComposableMatchup: LoadedRustComposableMatchupFn;
  captureDefensivePinSchedule: LoadedRustCaptureDefensivePinScheduleFn;
  simulateComposableMatchupPinned: LoadedRustSimulateComposableMatchupPinnedFn;
  /** Absent on a WASM bundle built before the batch export landed; callers fall
   * back to per-fight `simulateComposableMatchup`. */
  simulateComposableMatchupBatch?: LoadedRustSimulateComposableMatchupBatchFn;
};
