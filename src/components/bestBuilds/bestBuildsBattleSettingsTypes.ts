import type {
  AbilityTimingMode,
  BuildOptions,
  CompareBiteVariantMode,
  UserAbilityLevelOverrides,
  UserAbilityTimingOverrides,
} from "../../engine";
import type {
  CompareBuffSelection,
  CompareDayNightMode,
  CompareMoonMode,
} from "../../engine/compareBuffRuntime";
import { DEFAULT_COMPARE_BUFF_SELECTION } from "../../engine/compareBuffRuntime";
import type { WeatherCondition } from "../../engine/weather";
import type { PosturePolicyMode } from "../../optimizer/rustCompareMatchupRuntime";

/**
 * Battle settings surfaced in the Best Builds + Optimizer pages. Mirrors
 * the configurable parts of Compare's Battle Settings panel, but reshaped
 * into a per-side model: one set applies to the source creature, another
 * set applies collectively to every opponent in the active pool (where
 * the ability/effect is applicable to a given opponent — toggles for
 * abilities a particular opponent doesn't own are silently ignored).
 */
export type FirstTickMode = "off" | "ailments" | "regen" | "both";

/** Per-side AI policy knobs — mirror the Compare per-creature card. */
export type BestBuildsSideAiPolicy = {
  /** Sit/Lay/Stand decision policy. "off" = always Standing. */
  posturePolicy: PosturePolicyMode;
  /** Per-bite primary/dynamic/secondary attack pick. */
  biteVariantMode: CompareBiteVariantMode;
};

/** Per-side fight-start condition tweaks. */
export type BestBuildsSideStartingState = {
  /** Spite arrives pre-charged (compare-only disputed). Applies only to
   *  creatures with Spite — silently ignored otherwise. */
  spiteReadyAtStart: boolean;
  /** Override the Warden's-Rage starting HP percent. Only sent when
   *  `wardenRageStartHpEnabled` is true so BB defaults to the engine's
   *  full-HP start. Applies only to creatures with Warden's Rage. */
  wardenRageStartHpEnabled: boolean;
  /** Starting HP percent when the override is enabled. 1-100. */
  wardenRageStartHpPct: number;
};

/** Per-side Healing Pulse mode — applies only to creatures with the
 *  Compare-only Healing Pulse ability. */
export type BestBuildsSideHealingPulse = {
  enabled: boolean;
  mode: "normal" | "onceAtStart";
};

/** Per-side Traps & Trails master toggles. Mirrors Compare's
 *  `Traps` + `Trails` combat-toggle pair. Defaults preserve BB's
 *  pre-toggle behavior:
 *
 *   - `traps` defaults `true` (matches BB's historical behavior —
 *     traps fire whenever the creature owns Thorn Trap, Toxic Trap,
 *     or Frost Snare). Flipping to `false` forces the three trap
 *     booleans to `false` in the matchup config even if the
 *     creature owns the ability.
 *   - `trails` defaults `false` (matches BB's historical behavior —
 *     trail damage values default to `0` regardless of the
 *     creature). Flipping to `true` resolves per-creature numeric
 *     values for Healing Step / Flame Trail / Frost Trail / Plague
 *     Trail / Toxic Trail and forwards them to the engine.
 */
export type BestBuildsSideTrapsTrails = {
  traps: boolean;
  trails: boolean;
};

/** Per-side Specific / Disputed Compare-only ability toggles. Each
 *  toggle is silently ignored by the engine for creatures that don't
 *  own the underlying ability. Mirrors the chip set in Compare's
 *  CreatureSelectorCard.
 *
 *  Wiring summary (see bestBuildsBattleSettingsBridge.ts):
 *   - Volcanic / Frosty / Strength In Numbers / Defiled Ground /
 *     Gourmandizer (without hunger rule) — TS-side FinalStats
 *     mutation, applied in simulateBestBuildMatchupWithPath.
 *   - Broodwatcher — adds a starting Defensive status via the
 *     extraCombatantStats.startingStatuses channel.
 *   - Defiled Ground level / Gourmandizer / hunger rule / Power
 *     Charge / Gore Charge — Rust config fields via the
 *     extraAbilityConfig channel.
 */
export type BestBuildsSideSpecific = {
  volcanic: boolean;
  frosty: boolean;
  defiledGround: boolean;
  /** 1, 2 or 3 — only applied when defiledGround is true. */
  defiledGroundLevel: 1 | 2 | 3;
  gourmandizer: boolean;
  /** Starting appetite fill %. 100 = exactly full. */
  gourmandizerStartingHunger: number;
  broodwatcher: boolean;
  hungerRule: boolean;
  powerCharge: boolean;
  goreCharge: boolean;
  strengthInNumbers: boolean;
  /** Number of nearby allies (0-9). */
  strengthInNumbersAllies: number;
};

/** Ability names supported by the Rust per-ability policy override map
 *  (`RustAbilityPolicyOverrides`). Hardcoded here so the UI can build
 *  one picker per ability without depending on RustAbilityPolicyOverrides
 *  key introspection (which is a Partial type — its keys aren't available
 *  at runtime). Keep in sync with the per-ability entries in
 *  `RustAbilityPolicyOverrides` in `rustMatchupBridge.ts`. */
export const BB_KNOWN_OVERRIDE_ABILITIES = [
  "Warden's Rage",
  "Hunker",
  "Life Leech",
  "Adrenaline",
  "Hunters Curse",
  "Unbridled Rage",
  "Fortify",
  "Rewind",
  "Reflect",
  "Frost Nova",
  "Cocoon",
] as const;

export type BbAbilityTimingOverrideKey = typeof BB_KNOWN_OVERRIDE_ABILITIES[number];

/** Per-ability AbilityTimingMode override map. Mirrors the
 *  `attackerAbilityPolicyOverrides` / `defenderAbilityPolicyOverrides`
 *  shape on RustComposableAbilityConfig minus the user-abilities and
 *  user-levels fields. Missing entries fall back to the session-default
 *  `abilityTimingMode` from the global rules block. */
export type BbAbilityTimingOverrides = Partial<Record<BbAbilityTimingOverrideKey, AbilityTimingMode>>;

/** Per-side settings shape, repeated for source and opponent. */
export type BestBuildsSideSettings = {
  aiPolicy: BestBuildsSideAiPolicy;
  startingState: BestBuildsSideStartingState;
  healingPulse: BestBuildsSideHealingPulse;
  specific: BestBuildsSideSpecific;
  trapsTrails: BestBuildsSideTrapsTrails;
  /** Normalised ability names to disable. Mirrors Compare's
   *  CombatTogglePanel result; the engine zeroes the controlling
   *  passive flag and skips on-hit / on-hit-taken / starting statuses
   *  whose `sourceAbility` matches an entry here. */
  disabledAbilities: string[];
  /** Per-ability AbilityTimingMode pin. Engine reads
   *  `attacker/defenderAbilityPolicyOverrides` and uses the override
   *  for that ability instead of the session default. */
  abilityTimingOverrides: BbAbilityTimingOverrides;
  /** Per-user-ability timing override map. Keyed by the custom
   *  ability id (e.g. `user.MyCharge`); value is either a built-in
   *  AbilityTimingMode or a registered custom-timing id. Engine reads
   *  this via `RustAbilityPolicyOverrides.userAbilityOverrides`. */
  userAbilityOverrides: UserAbilityTimingOverrides;
  /** Per-user-ability active-level pick (when the spec declares
   *  `levels > 1`). Engine reads via
   *  `RustAbilityPolicyOverrides.userAbilityLevels`; out-of-range
   *  values are clamped silently to the spec's `default_level`. */
  userAbilityLevels: UserAbilityLevelOverrides;
  /** Compare-style buffs (Damage Boost / Regen Boost / Pack Healer
   *  nearby / Clean water / Refreshed / Newborn / Muddy / Aggressive /
   *  Scared). Applied via `applyCompareBuffRuntime` per matchup —
   *  mutates FinalStats + appends starting statuses + multiplies the
   *  active cooldown. */
  buffs: CompareBuffSelection;
};

/** Opponent-pool baseline build. When `enabled` is `false` (default),
 *  BB falls back to the hardcoded `BEST_BUILDS_OPPONENT_BUILD`
 *  (Void/Void · Damage/Bite · Damage×5 · Powerful · stage 5) — the
 *  same baseline that has shipped since the BB feature launched.
 *  When `enabled`, the provided `build` is applied to every opponent
 *  in the pool. */
export type BestBuildsOpponentBaseline = {
  enabled: boolean;
  build: BuildOptions;
};

export type BestBuildsBattleSettings = {
  /** Applied to both sides for every matchup in the run. */
  global: {
    /** Ability timing search depth for the refinement (final) scoring
     *  stage. Quick + stage-2 stages keep their hardcoded `fast` /
     *  `ideal` cadence so the candidate funnel stays fast — only the
     *  last scoring pass honors this knob. */
    abilityTimingMode: AbilityTimingMode;
    /** Day / Night environment. Affects Photovore / Photocarnivore diets
     *  via Compare's `applyCompareBuffRuntime`-derived final stats plus
     *  Rust-side `env.is_day` / `env.is_night` expression vars. */
    dayNight: CompareDayNightMode;
    /** Moon event. Mirrors Compare's "Moon" select; drives `env.is_blue_moon`
     *  / `env.is_blood_moon` on the Rust side. */
    moon: CompareMoonMode;
    /** Global weather cataclysm applied to both sides. Mirrors Compare's
     *  "Weather" select; the engine seeds a permanent weather status on
     *  each non-immune side (Volcanic ignores Heat Wave, Frosty ignores
     *  Blizzard, Acid Rain has none). */
    weather: WeatherCondition;
    /** Mirrors Compare's "No Move Facetank" toggle. When `true` (default,
     *  matches Compare's UI default), the engine lets persistent stand-
     *  and-fight statuses decay naturally — this is the Rust serde
     *  default. When `false`, sends `compareBlockPersistentDecay=true`
     *  per side so persistent PvP statuses stop decaying.
     *
     *  Comment from `wasm-engine/src/composable/mod.rs`:
     *    block_persistent_decay = !compareNoMoveFacetank */
    noMoveFacetank: boolean;
    /** Mirrors Compare's "First Tick Rule" select. "off" sends nothing
     *  (Rust serde defaults to false on both regen + ailments flags).
     *  Other modes send `compareFirstTickRegen` / `compareFirstTickAilments`
     *  + `compareFirstTickDelaySec` per side. */
    firstTickMode: FirstTickMode;
    /** First-tick delay in seconds when `firstTickMode !== "off"`. */
    firstTickDelaySec: number;
    /** Mirrors Compare's "Special Air PvP Rule" toggle. When `true`, both
     *  combatants use `airRuleCooldownSec` as a shared bite cadence and
     *  bite-cooldown buffs/debuffs/berserk modifiers are ignored on the
     *  Rust side. Wired through a separate `extraCombatantStats` channel
     *  because the field lives on `RustSimpleCombatantStats`, not
     *  `RustComposableAbilityConfig`. */
    airRuleEnabled: boolean;
    /** Shared bite cooldown in seconds when `airRuleEnabled` is `true`.
     *  Matches Compare's `DEFAULT_COMPARE_AIR_RULE_COOLDOWN_SEC` default. */
    airRuleCooldownSec: number;
  };
  /** Source creature (the one whose build is being optimized). */
  source: BestBuildsSideSettings;
  /** Applied collectively to every opponent in the active pool —
   *  toggles that target abilities a particular opponent doesn't own
   *  are silently ignored by the engine. */
  opponent: BestBuildsSideSettings;
  /** Per-opponent baseline build override. Defaults to disabled, in
   *  which case BB uses the legacy hardcoded baseline. */
  opponentBaseline: BestBuildsOpponentBaseline;
};

const DEFAULT_SIDE: BestBuildsSideSettings = {
  aiPolicy: {
    posturePolicy: "off",
    biteVariantMode: "primaryOnly",
  },
  startingState: {
    spiteReadyAtStart: false,
    wardenRageStartHpEnabled: false,
    wardenRageStartHpPct: 50,
  },
  healingPulse: {
    enabled: false,
    mode: "normal",
  },
  // Default: traps ON (preserves the long-standing BB behavior where
  // creatures with Thorn Trap / Toxic Trap / Frost Snare fire them).
  // Default: trails OFF (preserves the long-standing BB behavior
  // where trail damage values stay at the Rust serde default of 0).
  trapsTrails: { traps: true, trails: false },
  specific: {
    volcanic: false,
    frosty: false,
    defiledGround: false,
    defiledGroundLevel: 1,
    gourmandizer: false,
    gourmandizerStartingHunger: 100,
    broodwatcher: false,
    hungerRule: false,
    powerCharge: false,
    goreCharge: false,
    strengthInNumbers: false,
    strengthInNumbersAllies: 0,
  },
  disabledAbilities: [],
  abilityTimingOverrides: {},
  userAbilityOverrides: {},
  userAbilityLevels: {},
  buffs: { ...DEFAULT_COMPARE_BUFF_SELECTION },
};

export const DEFAULT_BB_BATTLE_SETTINGS: BestBuildsBattleSettings = {
  global: {
    abilityTimingMode: "ideal",
    dayNight: "none",
    moon: "none",
    weather: "none",
    noMoveFacetank: true,
    firstTickMode: "off",
    firstTickDelaySec: 1,
    airRuleEnabled: false,
    airRuleCooldownSec: 1.8,
  },
  source: {
    aiPolicy: { ...DEFAULT_SIDE.aiPolicy },
    startingState: { ...DEFAULT_SIDE.startingState },
    healingPulse: { ...DEFAULT_SIDE.healingPulse },
    specific: { ...DEFAULT_SIDE.specific },
    disabledAbilities: [],
    abilityTimingOverrides: {},
    userAbilityOverrides: {},
    userAbilityLevels: {},
    trapsTrails: { ...DEFAULT_SIDE.trapsTrails },
    buffs: { ...DEFAULT_COMPARE_BUFF_SELECTION },
  },
  opponent: {
    aiPolicy: { ...DEFAULT_SIDE.aiPolicy },
    startingState: { ...DEFAULT_SIDE.startingState },
    healingPulse: { ...DEFAULT_SIDE.healingPulse },
    specific: { ...DEFAULT_SIDE.specific },
    disabledAbilities: [],
    abilityTimingOverrides: {},
    userAbilityOverrides: {},
    userAbilityLevels: {},
    trapsTrails: { ...DEFAULT_SIDE.trapsTrails },
    buffs: { ...DEFAULT_COMPARE_BUFF_SELECTION },
  },
  opponentBaseline: {
    enabled: false,
    // Mirrors `BEST_BUILDS_OPPONENT_BUILD` in `bestBuildsRuntime.ts`. The
    // runtime constant is the source of truth for the *defaults*; this
    // copy seeds the UI so users see those values as the starting point
    // when they enable the override.
    build: {
      venerationStage: 5,
      traits: ["Damage", "Bite"],
      ascensionAssignments: ["Damage", "Damage", "Damage", "Damage", "Damage"],
      plushies: ["Void", "Void"],
      elder: "Powerful",
    },
  },
};
