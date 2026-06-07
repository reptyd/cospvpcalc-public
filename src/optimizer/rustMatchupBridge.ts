import type { CombatEventPhase } from "../engine/eventOrdering";

// Rust-side output shape mirrors wasm-engine/src/contracts.rs.
// Must stay structurally compatible with BestBuildsMatchupSummary (BB consumers
// narrow to the 8-field subset; Compare consumers read the full surface).
export type RustCombatLogEntry = {
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
  breathTickCount: number;
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
  regenHealedA: number;
  regenHealedB: number;
  regenTicksA: number;
  regenTicksB: number;
  combatLog?: RustCombatLogEntry[];
  debug?: RustSimulationDebugBySide;
  badOmenOutcome?: RustBadOmenOutcome;
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
  }>;
  statusResistFractions?: Record<string, number>;
  plushieStatusBlockFractions?: Record<string, number>;
  plushieReflectAvgPct?: number;
  /**
   * Normalized (via `normalizeAbilityName`) ability names to skip during
   * combat. The wasm engine filters on-hit/on-hit-taken/starting statuses by
   * `sourceAbility` and zeroes passive-flag fields whose controlling ability
   * is disabled (Berserk, First Strike, Reflect, Warden's Resistance,
   * Breath Resistance, Hunker, Quick Recovery, Unbreakable, Self-Destruct).
   */
  disabledAbilities?: string[];
  /**
   * Compare-only Special Air PvP Rule fixed bite cadence in seconds. 0 =
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
  };
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
  attackerCompareGourmandizerFillPct?: number;
  defenderCompareGourmandizerFillPct?: number;
  attackerCompareGourmandizer?: boolean;
  defenderCompareGourmandizer?: boolean;
  attackerCompareHungerRule?: boolean;
  defenderCompareHungerRule?: boolean;
  attackerCompareStartingHunger?: number;
  defenderCompareStartingHunger?: number;
  attackerCompareAppetiteBase?: number;
  defenderCompareAppetiteBase?: number;
  attackerCompareDefiledGroundLevel?: number;
  defenderCompareDefiledGroundLevel?: number;
  attackerCompareDefiledGroundWeakness?: boolean;
  defenderCompareDefiledGroundWeakness?: boolean;

  // --- Plushie hunger drain multiplier ------------------------------------
  attackerComparePlushieDrainMultiplier?: number;
  defenderComparePlushieDrainMultiplier?: number;

  // --- Bad Omen outcome (shared, pre-resolved by Compare caller) ----------
  badOmenOutcome?: RustBadOmenOutcome | null;

  // --- Per-ability timing overrides (Compare-only; BB uses session-default) -
  attackerAbilityPolicyOverrides?: RustAbilityPolicyOverrides;
  defenderAbilityPolicyOverrides?: RustAbilityPolicyOverrides;

  // --- Same-time event ordering -------------------------------------------
  combatEventOrder?: CombatEventPhase[];

  // --- Compare-page environment flags for user abilities ---
  // Mirror of `ComposableAbilityConfig::compare_day_night` and
  // `compare_moon` (Rust `Option<String>` → optional string here). Forwarded
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
  // Global weather cataclysm applied to BOTH sides at setup.
  // Values: "none" | "heatWave" | "blizzard" | "acidRain".
  // Immunity (Volcanic vs Heat Wave, Frosty vs Blizzard) is resolved on
  // the TS side and delivered per-side here; Acid Rain has no immunity.
  weather?: string;
  attackerWeatherImmune?: boolean;
  defenderWeatherImmune?: boolean;
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

// Composable engine is the only Rust combat dispatcher. Bespoke contour
// bridge entries were deleted 2026-04-09 after fixture-parity verification.
export type RustMatchupBridge = {
  contractVersion: string;
  simulateComposableMatchup: RustComposableMatchupFn;
};

export type LoadedRustMatchupBridge = {
  contractVersion: string;
  simulateComposableMatchup: LoadedRustComposableMatchupFn;
};
