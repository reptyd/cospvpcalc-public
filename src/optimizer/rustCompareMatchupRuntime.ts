import type {
  AbilityTimingMode,
  AbilityTimingOverrides,
  BadOmenOutcome,
  BreathPolicyMode,
  CompareBiteVariantMode,
  CreatureRuntime,
  FinalStats,
  UserAbilityLevelOverrides,
  UserAbilityTimingOverrides,
} from "../engine";
import { normalizeAbilityName } from "../engine/runtimeHelpers";
import {
  type DerivedConfigGate,
  deriveBoolConfigGates,
  deriveOverrideKeys,
  deriveValueConfigGates,
} from "./abilityRegistry";
import { buildAbilityConfig } from "./buildAbilityConfig";
import {
  getHunkerReductionPct,
  toRustAbilityTimingMode,
  toRustBreathProfile,
  toRustStatusMeleeStats,
} from "./rustBestBuildsRuntime";
import type {
  RustAbilityPolicyOverrides,
  RustAbilityTimingMode,
  RustComposableAbilityConfig,
  RustSimpleBreathProfile,
  RustSimpleCombatantStats,
} from "./rustMatchupBridge";
import {
  isCompareBreathDisabled,
  normalizeCompareDisabledAbilities,
} from "../engine/compareCombatToggleOptions";
import { RECOMMENDED_COMBAT_EVENT_ORDER, type CombatEventPhase } from "../engine/eventOrdering";
import { rollBadOmenBatch } from "../engine/subsystems/statuses";
import { getSeasonMeterIntervals, type CompareSeason } from "../engine/compareSeason";

// ---------------------------------------------------------------------------
// Compare -> Rust composable bridge.
//
// Produces the six arguments that `simulateComposableMatchup` expects from
// Compare-shaped inputs. Rust's ComposableAbilityConfig covers almost all
// Compare-only knobs already; this mapper wires them through.
//
// Two knobs are intentionally pinned to 0 because Compare pre-bakes their
// effect into `finalStats` via applyCompareBuffRuntime / applyCompareSpecial
// Abilities:
//   - compareRegenBonusPct (Frosty/Volcanic/Pack Healer/... -> finalStats.healthRegen)
//   - compareGourmandizerFillPct (static weight bonus -> finalStats.weight)
// Passing non-zero would double-count the buff.
// ---------------------------------------------------------------------------

export type CompareInitialStatus = {
  statusId: string;
  stacks?: number;
  remainingSec?: number;
  sourceAbilityName?: string;
  noDecay?: boolean;
  stackValueMode?: "durationOnly";
};

export type CompareSidePerks = {
  /** "Traps" UI toggle - gates Thorn/Toxic trap tick behaviour. */
  traps: boolean;
  /** "Trails" UI toggle - gates Flame/Frost/Plague/Toxic/Healing Step. */
  trails: boolean;
  /** "Power Charge" pre-armed - first melee hit +50% damage + 2 Shredded Wings. */
  powerCharge: boolean;
  /** "Gore Charge" pre-armed - first melee hit applies Bleed + Deep Wounds. */
  goreCharge: boolean;
  /** "Spite charged" pre-armed - opening bite consumes charged Spite. */
  startingSpiteCharged: boolean;
  /** Mud Pile buff active - injects Muddy_Status at t=0. */
  muddyBuff: boolean;
  /** Hold bites and breath while the opponent's Reflect is up. False = swing
   *  into it, which is what the model always did. */
  reflectResponseHold?: boolean;
  /** The survival meters run. Compare always sets this - the meters are not a
   *  setting - but the engine keeps the flag so a caller can opt out. */
  hungerRule: boolean;
  /** Gourmandizer ability present on this side. */
  gourmandizer: boolean;
  /** Starting hunger in appetite *units* (convert from % before passing). */
  startingHungerUnits: number;
  /** Starting thirst, same units. Omitted = the meter starts full. */
  startingThirstUnits?: number;
  /** Which meters this creature carries. Omitted = both, which is what all
   *  but the Photovore / Aquatic / Photocarnivore creatures have. */
  hasHunger?: boolean;
  hasThirst?: boolean;
  /** Appetite base in units (TS default 100). Sizes both meters - the game
   *  aliases ThirstAppetite to Appetite. */
  appetiteBaseUnits: number;
  /** Defiled Ground level on this side (0/1/2/3). */
  defiledGroundLevel: number;
  /** Defiled Ground Weakness debuff from opponent. */
  defiledGroundWeakness: boolean;
  /** Darkstar plushie equipped - x1.25 sit/lay ailment recovery on the
   *  Defiled-Ground-recoverable set (engine-native via Rust). */
  hasDarkstar: boolean;
  /** Plushie drain multipliers, one per meter (1.0 = no change). Euvatops
   *  moves hunger, Aerodon thirst, Frost Dragon both. */
  appetiteDrainMultiplier: number;
  thirstDrainMultiplier?: number;
  /** Healing Pulse toggle enabled (requires creature to own Healing Pulse). */
  healingPulseEnabled: boolean;
  /** Healing Pulse mode flag: true = onceAtStart (self-only single cast); false = normal (radius, every 90s). */
  healingPulseOnce: boolean;
  /** Expunge enabled (true when creature owns Expunge). Default-modeled; ideal policy inlined (kill-secure OR heal-save). */
  expungeEnabled: boolean;
  /** Compare-only Warden's Rage setup. 0 disables; otherwise side starts at this percent of max HP. */
  wardenRageStartHpPct: number;
  /** Compare-only Head Start (seconds). 0 disables; otherwise this side's opponent stands inert for the first N seconds. Available to every creature. */
  headStartSec: number;
};

export type PosturePolicyMode = "off" | "regenAware" | "regenUnaware";

export type CompareFirstTickConfig = {
  /** Compare first-tick mode ("off" | "regen" | "ailments" | "both"). */
  mode: "off" | "regen" | "ailments" | "both";
  /** Delay in seconds for first-tick rule. TS default 1.0. */
  delaySec: number;
};

export type CompareToRustInput = {
  sourceCreature: CreatureRuntime;
  opponentCreature: CreatureRuntime;
  finalA: FinalStats;
  finalB: FinalStats;
  activesOn: boolean;
  breathOn: boolean;
  abilityPolicy: AbilityTimingMode;
  initialStatusesA: CompareInitialStatus[];
  initialStatusesB: CompareInitialStatus[];
  activeCooldownMultiplierA: number;
  activeCooldownMultiplierB: number;
  disabledAbilitiesA: string[];
  disabledAbilitiesB: string[];
  perksA: CompareSidePerks;
  perksB: CompareSidePerks;
  firstTick: CompareFirstTickConfig;
  /** Compare "No Move Facetank" toggle (default true). Inverts to *_compare_block_persistent_decay. */
  noMoveFacetank: boolean;
  /** Compare-only posture policy mode per side. "off" = no posture
   *  changes ever; "regenAware" = enabled, times decisions around
   *  regen ticks; "regenUnaware" = enabled but ignores regen timing.
   *  Optional with default "off" so existing fixtures keep compiling
   *  without explicit posture wiring. */
  posturePolicyA?: PosturePolicyMode;
  posturePolicyB?: PosturePolicyMode;
  /** Per-side breath firing policy, already resolved to a concrete engine
   *  mode (the UI's `"auto"` is mapped against the creature's breath spec
   *  upstream in `useCompareSimulation`). Optional with default
   *  `onAvailability` - the Rust serde default - so existing fixtures keep
   *  compiling without explicit breath wiring. */
  breathPolicyA?: BreathPolicyMode;
  breathPolicyB?: BreathPolicyMode;
  /** Pre-resolved Bad Omen outcome (null = not configured). */
  badOmenOutcome: BadOmenOutcome | null;
  /** Compare Fixed Bite Cadence enabled (shared both sides). */
  compareAirRuleEnabled: boolean;
  /** Fixed bite cooldown in seconds when Air PvP Rule is enabled (side A / shared). */
  compareAirRuleCooldownSec: number;
  /** Side B fixed bite cooldown; used only when the rule is unlinked. */
  compareAirRuleCooldownSecB?: number;
  /** When explicitly false, side B uses its own cooldown; otherwise it mirrors side A. */
  compareAirRuleCooldownLinked?: boolean;
  /** Dodge Chance rule enabled. */
  compareAerialDodgeEnabled?: boolean;
  /** Per-side chance (0..100) an incoming bite/breath lands on that flier. */
  compareAerialDodgeHitChancePctA?: number;
  compareAerialDodgeHitChancePctB?: number;
  /** Roll style: even deterministic pattern vs seeded real-random. */
  compareAerialDodgeRollStyle?: "even" | "random";
  /** Seed for real-random rolls (fresh per run so outcomes vary). */
  compareAerialDodgeSeed?: number;
  /** Compare "secondary attack only" on attacker - swap primary damage for
   *  the creature's secondary-attack damage AND suppress attacker on-hit
   *  statuses (mirrors TS `applyCompareSecondaryAttackOverride` + engine
   *  `hitStatusRuntime` early-return). */
  compareBiteVariantModeA: CompareBiteVariantMode;
  compareBiteVariantModeB: CompareBiteVariantMode;
  combatEventOrder?: CombatEventPhase[];
  /** Per-ability timing-mode overrides (display-name keys). Empty/undefined =
   *  all abilities use the session-default `abilityPolicy`. Mirrors TS
   *  `SimulationOptions.abilityPolicyOverridesA/B`. */
  abilityPolicyOverridesA?: AbilityTimingOverrides;
  abilityPolicyOverridesB?: AbilityTimingOverrides;
  /** Per-user-ability runtime override map. Keyed by user.<id>;
   * values pin the timing for that user ability for THIS matchup,
   * overriding the spec's own defaults. Wired via Rust's
   * `AbilityPolicyOverrides.userAbilityOverrides`. */
  userAbilityOverridesA?: UserAbilityTimingOverrides;
  userAbilityOverridesB?: UserAbilityTimingOverrides;
  /** Per-fight active-level override map for user
   * abilities with `levels > 1`. Keyed by user.<id>; 1-indexed.
   * Wired via Rust's `AbilityPolicyOverrides.userAbilityLevels`. */
  userAbilityLevelsA?: UserAbilityLevelOverrides;
  userAbilityLevelsB?: UserAbilityLevelOverrides;
  /** Compare-page day/night and moon UI knobs, forwarded into the
   * `env.*` expression namespace for user abilities.
   * Values: `"none" | "day" | "night"` and `"none" | "blueMoon" | "bloodMoon"`.
   * Stats buffs from these are already applied via `applyCompareBuffRuntime`
   * on the TS side - this wiring exposes the raw enum to user-ability gates. */
  compareDayNight?: "none" | "day" | "night";
  compareMoon?: "none" | "blueMoon" | "bloodMoon";
  compareSeason?: CompareSeason;
  /** Global weather cataclysm + per-side immunity (resolved on TS:
   *  Volcanic ignores Heat Wave, Frosty ignores Blizzard, Acid Rain none). */
  weather?: "none" | "heatWave" | "blizzard" | "acidRain";
  attackerWeatherImmune?: boolean;
  defenderWeatherImmune?: boolean;
  /** Global Oxygen / Moisture drain mode. The per-side oxygenTime /
   *  moistureTime pools ride through the shared stat producer; this selects
   *  which pool drains. "off" / undefined is inert. */
  oxygenMoistureMode?: "off" | "ground" | "underwater";
  /** Storming debuff per side (already gated to terrestrial-vs-aquatic on
   *  the TS side). Seeds a permanent +10%-incoming marker in the engine. */
  attackerStorming?: boolean;
  defenderStorming?: boolean;
  /** Nearby-radiated rule: count of extra radiated creatures (besides the two
   *  fighters) sharing the area. Scales each fighter's Radiation DOT; linked
   *  across both sides, so it is a single matchup-level figure. */
  radiationNearbyCount?: number;
};

export type CompareToRustOutput = {
  attacker: RustSimpleCombatantStats;
  defender: RustSimpleCombatantStats;
  attackerBreath: RustSimpleBreathProfile | null;
  defenderBreath: RustSimpleBreathProfile | null;
  abilityPolicy: RustAbilityTimingMode;
  abilityConfig: RustComposableAbilityConfig;
};

/**
 * Compare's t=0 status seeds, in the shape the engine reads. Shared with
 * BestBuilds and Sandbox, which feed the same `applyCompareBuffRuntime`
 * output through their own `startingStatuses` channel - the three pages seed
 * a buff identically because they run this one converter.
 */
export function toStartingStatuses(
  statuses: CompareInitialStatus[],
): NonNullable<RustSimpleCombatantStats["startingStatuses"]> {
  return statuses.map((entry) => ({
    statusId: entry.statusId,
    stacks: entry.stacks ?? 1,
    ...(entry.stackValueMode ? { stackValueMode: entry.stackValueMode } : {}),
    // Normalized so the engine's disabled-ability filter (which compares
    // against the normalized `disabledAbilities` set) can drop a seeded
    // status when the ability that produced it is switched off.
    ...(entry.sourceAbilityName
      ? { sourceAbility: normalizeAbilityName(entry.sourceAbilityName) }
      : {}),
    // The buff's own duration (Muddy's 90 s per land plushie, Clean Water's
    // 180 s, ...). Without it the engine falls back to the status registry's
    // decay pacing, which drops every duration the UI actually offers.
    ...(typeof entry.remainingSec === "number" && entry.remainingSec > 0
      ? { remainingSec: entry.remainingSec }
      : {}),
    ...(entry.noDecay ? { noDecay: true } : {}),
  }));
}

function withCompareSideAdjustments(
  base: RustSimpleCombatantStats,
  initialStatuses: CompareInitialStatus[],
  activeCooldownMultiplier: number,
  disabledAbilities: Set<string>,
): RustSimpleCombatantStats {
  const startingStatuses = toStartingStatuses(initialStatuses);
  const merged: RustSimpleCombatantStats = {
    ...base,
    activeCooldownMultiplier,
    startingStatuses: [...(base.startingStatuses ?? []), ...startingStatuses],
    disabledAbilities: [...disabledAbilities],
  };
  return merged;
}

export const BOOL_CONFIG_GATES: DerivedConfigGate[] = deriveBoolConfigGates();

export const VALUE_CONFIG_GATES: DerivedConfigGate[] = deriveValueConfigGates();

function zeroConfigForDisabledAbilities(
  config: RustComposableAbilityConfig,
  disabledAttacker: Set<string>,
  disabledDefender: Set<string>,
): RustComposableAbilityConfig {
  const next: RustComposableAbilityConfig = { ...config };
  for (const gate of BOOL_CONFIG_GATES) {
    const norm = normalizeAbilityName(gate.ability);
    if (disabledAttacker.has(norm)) (next as Record<string, unknown>)[gate.attackerKey] = false;
    if (disabledDefender.has(norm)) (next as Record<string, unknown>)[gate.defenderKey] = false;
  }
  for (const gate of VALUE_CONFIG_GATES) {
    const norm = normalizeAbilityName(gate.ability);
    if (disabledAttacker.has(norm)) (next as Record<string, unknown>)[gate.attackerKey] = 0;
    if (disabledDefender.has(norm)) (next as Record<string, unknown>)[gate.defenderKey] = 0;
  }
  if (disabledAttacker.has(normalizeAbilityName("Lich Mark"))) next.attackerLichMarkPayloadStatusId = null;
  if (disabledDefender.has(normalizeAbilityName("Lich Mark"))) next.defenderLichMarkPayloadStatusId = null;
  if (disabledAttacker.has(normalizeAbilityName("Yolk Bomb"))) next.attackerYolkBombValue = null;
  if (disabledDefender.has(normalizeAbilityName("Yolk Bomb"))) next.defenderYolkBombValue = null;
  // Aura (X) - disable when the specific subtype name is in the disabled set.
  if (next.attackerAuraSubtype && disabledAttacker.has(normalizeAbilityName(`Aura (${next.attackerAuraSubtype})`))) {
    next.attackerAuraSubtype = null;
  }
  if (next.defenderAuraSubtype && disabledDefender.has(normalizeAbilityName(`Aura (${next.defenderAuraSubtype})`))) {
    next.defenderAuraSubtype = null;
  }
  return next;
}

function addCompareRuntimeFlags(
  config: RustComposableAbilityConfig,
  perksA: CompareSidePerks,
  perksB: CompareSidePerks,
  firstTick: CompareFirstTickConfig,
  noMoveFacetank: boolean,
  posturePolicyA: PosturePolicyMode,
  posturePolicyB: PosturePolicyMode,
): RustComposableAbilityConfig {
  const firstTickRegen = firstTick.mode === "regen" || firstTick.mode === "both";
  const firstTickAilments = firstTick.mode === "ailments" || firstTick.mode === "both";
  const blockPersistentDecay = !noMoveFacetank;
  return {
    ...config,
    // Pre-armed charges
    attackerPowerCharge: perksA.powerCharge,
    defenderPowerCharge: perksB.powerCharge,
    attackerGoreCharge: perksA.goreCharge,
    defenderGoreCharge: perksB.goreCharge,
    attackerSpiteReadyAtStart: perksA.startingSpiteCharged,
    defenderSpiteReadyAtStart: perksB.startingSpiteCharged,
    // Mud Pile injection
    attackerCompareMuddyBuff: perksA.muddyBuff,
    defenderCompareMuddyBuff: perksB.muddyBuff,
    // First-tick rule (shared mode + per-side delay)
    attackerCompareFirstTickRegen: firstTickRegen,
    defenderCompareFirstTickRegen: firstTickRegen,
    attackerCompareFirstTickAilments: firstTickAilments,
    defenderCompareFirstTickAilments: firstTickAilments,
    attackerCompareFirstTickDelaySec: firstTick.delaySec,
    defenderCompareFirstTickDelaySec: firstTick.delaySec,
    // No-move facetank (inverse)
    attackerCompareBlockPersistentDecay: blockPersistentDecay,
    defenderCompareBlockPersistentDecay: blockPersistentDecay,
    // Hunger / Gourmandizer / Defiled Ground - runtime behavior only.
    // fill_pct stays 0 to avoid double-count with baked finalStats.weight.
    attackerCompareHungerRule: perksA.hungerRule,
    defenderCompareHungerRule: perksB.hungerRule,
    attackerCompareGourmandizer: perksA.gourmandizer,
    defenderCompareGourmandizer: perksB.gourmandizer,
    attackerCompareStartingHunger: perksA.startingHungerUnits,
    defenderCompareStartingHunger: perksB.startingHungerUnits,
    attackerReflectResponseHold: perksA.reflectResponseHold === true,
    defenderReflectResponseHold: perksB.reflectResponseHold === true,
    attackerCompareStartingThirst: perksA.startingThirstUnits ?? 0,
    defenderCompareStartingThirst: perksB.startingThirstUnits ?? 0,
    attackerCompareHasNoHunger: perksA.hasHunger === false,
    defenderCompareHasNoHunger: perksB.hasHunger === false,
    attackerCompareHasNoThirst: perksA.hasThirst === false,
    defenderCompareHasNoThirst: perksB.hasThirst === false,
    attackerCompareAppetiteBase: perksA.appetiteBaseUnits,
    defenderCompareAppetiteBase: perksB.appetiteBaseUnits,
    attackerCompareDefiledGroundLevel: perksA.defiledGroundLevel,
    defenderCompareDefiledGroundLevel: perksB.defiledGroundLevel,
    attackerCompareDefiledGroundWeakness: perksA.defiledGroundWeakness,
    defenderCompareDefiledGroundWeakness: perksB.defiledGroundWeakness,
    attackerCompareDarkStar: perksA.hasDarkstar,
    defenderCompareDarkStar: perksB.hasDarkstar,
    attackerCompareGourmandizerFillPct: 0,
    defenderCompareGourmandizerFillPct: 0,
    attackerCompareRegenBonusPct: 0,
    defenderCompareRegenBonusPct: 0,
    attackerComparePlushieDrainMultiplier: perksA.appetiteDrainMultiplier,
    attackerComparePlushieThirstDrainMultiplier: perksA.thirstDrainMultiplier ?? perksA.appetiteDrainMultiplier,
    defenderComparePlushieDrainMultiplier: perksB.appetiteDrainMultiplier,
    defenderComparePlushieThirstDrainMultiplier: perksB.thirstDrainMultiplier ?? perksB.appetiteDrainMultiplier,
    // Posture policy (Compare-only)
    attackerPosturePolicyEnabled: posturePolicyA !== "off",
    attackerPosturePolicyRegenAware: posturePolicyA === "regenAware",
    defenderPosturePolicyEnabled: posturePolicyB !== "off",
    defenderPosturePolicyRegenAware: posturePolicyB === "regenAware",
    // Healing Pulse (Compare-only disputed). Enabled flag + mode.
    attackerHealingPulse: perksA.healingPulseEnabled,
    defenderHealingPulse: perksB.healingPulseEnabled,
    attackerHealingPulseOnce: perksA.healingPulseOnce,
    defenderHealingPulseOnce: perksB.healingPulseOnce,
    // Expunge (default-modeled). Enabled iff creature owns ability; policy inlined (kill-secure OR heal-save).
    attackerExpunge: perksA.expungeEnabled,
    defenderExpunge: perksB.expungeEnabled,
    // Compare-only starting HP override, currently exposed for Warden's Rage disputes.
    attackerCompareStartHpPct: perksA.wardenRageStartHpPct,
    defenderCompareStartHpPct: perksB.wardenRageStartHpPct,
    // Head Start: the side that enables it makes its opponent inert for the
    // opening window. attackerHeadStartSec = N => the defender is inert.
    attackerHeadStartSec: perksA.headStartSec,
    defenderHeadStartSec: perksB.headStartSec,
  };
}

/** Built-in ability names whose per-ability timing override is
 * supported by the Rust engine. Excludes the map-shaped fields
 * (`userAbilityOverrides`, `userAbilityLevels`) - those are handled
 * separately in the conversion path. */
type RustBuiltInOverrideKey = Exclude<
  keyof RustAbilityPolicyOverrides,
  "userAbilityOverrides" | "userAbilityLevels"
>;

export const OVERRIDE_KEYS = deriveOverrideKeys() as RustBuiltInOverrideKey[];

export function toRustAbilityPolicyOverrides(
  overrides: AbilityTimingOverrides | undefined,
  userOverrides: UserAbilityTimingOverrides | undefined,
  userLevels: UserAbilityLevelOverrides | undefined,
): RustAbilityPolicyOverrides | undefined {
  const out: RustAbilityPolicyOverrides = {};
  let any = false;
  if (overrides) {
    for (const key of OVERRIDE_KEYS) {
      const value = overrides[key];
      if (value !== undefined) {
        out[key] = toRustAbilityTimingMode(value);
        any = true;
      }
    }
  }
  if (userOverrides) {
    const map: Record<string, { kind: "builtIn"; mode: RustAbilityTimingMode } | { kind: "user"; timingId: string }> = {};
    let userAny = false;
    for (const [id, choice] of Object.entries(userOverrides)) {
      if (choice.kind === "builtIn") {
        map[id] = { kind: "builtIn", mode: toRustAbilityTimingMode(choice.mode) };
      } else {
        map[id] = { kind: "user", timingId: choice.timingId };
      }
      userAny = true;
    }
    if (userAny) {
      out.userAbilityOverrides = map;
      any = true;
    }
  }
  // Per-fight level picks. Engine clamps stale or
  // out-of-range values silently - we forward the user's literal pick
  // and let the Rust side validate against the live spec.
  if (userLevels) {
    const levels: Record<string, number> = {};
    let levelAny = false;
    for (const [id, level] of Object.entries(userLevels)) {
      if (Number.isInteger(level) && level >= 1) {
        levels[id] = level;
        levelAny = true;
      }
    }
    if (levelAny) {
      out.userAbilityLevels = levels;
      any = true;
    }
  }
  return any ? out : undefined;
}

function applyCompareTrapsGate(
  config: RustComposableAbilityConfig,
  trapsA: boolean,
  trapsB: boolean,
): RustComposableAbilityConfig {
  const next: RustComposableAbilityConfig = { ...config };
  if (!trapsA) {
    next.attackerThornTrap = false;
    next.attackerToxicTrap = false;
  }
  if (!trapsB) {
    next.defenderThornTrap = false;
    next.defenderToxicTrap = false;
  }
  return next;
}

export function toRustComposableArgsFromCompare(input: CompareToRustInput): CompareToRustOutput {
  const disabledA = new Set(normalizeCompareDisabledAbilities(input.disabledAbilitiesA, input.finalA).map(normalizeAbilityName));
  const disabledB = new Set(normalizeCompareDisabledAbilities(input.disabledAbilitiesB, input.finalB).map(normalizeAbilityName));

  const attackerBase = toRustStatusMeleeStats(input.sourceCreature, input.finalA, disabledA, input.activesOn);
  const defenderBase = toRustStatusMeleeStats(input.opponentCreature, input.finalB, disabledB, input.activesOn);

  const attacker = withCompareSideAdjustments(
    attackerBase,
    input.initialStatusesA,
    input.activeCooldownMultiplierA,
    disabledA,
  );
  const defender = withCompareSideAdjustments(
    defenderBase,
    input.initialStatusesB,
    input.activeCooldownMultiplierB,
    disabledB,
  );

  if (
    input.compareAirRuleEnabled
    && Number.isFinite(input.compareAirRuleCooldownSec)
    && input.compareAirRuleCooldownSec > 0
  ) {
    attacker.compareAirRuleCooldownSec = Math.max(0.1, input.compareAirRuleCooldownSec);
    const cdB = input.compareAirRuleCooldownLinked === false
      ? input.compareAirRuleCooldownSecB
      : input.compareAirRuleCooldownSec;
    defender.compareAirRuleCooldownSec = Math.max(
      0.1,
      typeof cdB === "number" && Number.isFinite(cdB) && cdB > 0
        ? cdB
        : input.compareAirRuleCooldownSec,
    );
  }

  // Compare "secondary attack only": no longer a TS-side stat mutation.
  // Variant selection now lives in the Rust engine (see
  // `wasm-engine/src/policy/decisions/bite_variant.rs`). The bridge now
  // forwards `damage` and `damage2` both unconditionally and
  // sets the bite-variant mode on the ability config below - Rust reads
  // the mode per bite event in `process_phase_10_11_melee` and picks
  // primary or secondary at firing time. `secondaryOnly` produces the
  // same observable behavior the earlier TS-side substitution did (damage2 +
  // skipped on-hit ailments).

  const attackerBreath = input.breathOn && !isCompareBreathDisabled(disabledA, input.finalA) ? toRustBreathProfile(input.finalA) : null;
  const defenderBreath = input.breathOn && !isCompareBreathDisabled(disabledB, input.finalB) ? toRustBreathProfile(input.finalB) : null;

  let abilityConfig: RustComposableAbilityConfig = {} as RustComposableAbilityConfig;
  if (input.activesOn) {
    // Compare emits the full registry-gated surface plus the per-side trail
    // channel (the "Trails" toggle). The passive-Hunker reduction is resolved
    // without the disabled set here, matching the old base; the disabled-side
    // zeroing below still clears Hunker when it is toggled off.
    const built = buildAbilityConfig({
      sourceCreature: input.sourceCreature,
      opponentCreature: input.opponentCreature,
      hunkerReductionPctA: getHunkerReductionPct(input.sourceCreature),
      hunkerReductionPctB: getHunkerReductionPct(input.opponentCreature),
      includeTrails: true,
      trailsA: input.perksA.trails,
      trailsB: input.perksB.trails,
    });
    abilityConfig = applyCompareTrapsGate(
      zeroConfigForDisabledAbilities(built, disabledA, disabledB),
      input.perksA.traps,
      input.perksB.traps,
    );
  }
  abilityConfig = addCompareRuntimeFlags(
    abilityConfig,
    input.perksA,
    input.perksB,
    input.firstTick,
    input.noMoveFacetank,
    input.posturePolicyA ?? "off",
    input.posturePolicyB ?? "off",
  );

  // Dodge Chance (Compare-only miss rule). Active flag + roll style ride
  // the config; the per-side hit chance rides the stats. The engine gates the
  // roll on flier type (non-fliers always hit) and on Shredded Wings (grounded
  // fliers always hit), so the bridge just forwards the raw per-side chance.
  // Real-random varies per run via the fresh seed.
  if (input.compareAerialDodgeEnabled) {
    abilityConfig.aerialDodgeActive = true;
    abilityConfig.aerialDodgeRealRandom = input.compareAerialDodgeRollStyle === "random";
    abilityConfig.aerialDodgeSeed = input.compareAerialDodgeSeed ?? 0;
    const clampPct = (v: number | undefined) =>
      Math.max(0, Math.min(100, typeof v === "number" && Number.isFinite(v) ? v : 100));
    attacker.aerialDodgeHitChancePct = clampPct(input.compareAerialDodgeHitChancePctA);
    defender.aerialDodgeHitChancePct = clampPct(input.compareAerialDodgeHitChancePctB);
  }

  // Bad Omen follow-up on expiry. A pinned Roulette choice forces that one
  // outcome (debug determinism); otherwise roll a fresh random batch so each
  // expiry - and each re-run - gets a real random follow-up.
  abilityConfig.badOmenOutcomes = input.badOmenOutcome
    ? [
        {
          statusId: input.badOmenOutcome.statusId,
          stacks: input.badOmenOutcome.stacks,
          label: input.badOmenOutcome.label,
        },
      ]
    : rollBadOmenBatch();

  const overridesA = toRustAbilityPolicyOverrides(
    input.abilityPolicyOverridesA,
    input.userAbilityOverridesA,
    input.userAbilityLevelsA,
  );
  if (overridesA) abilityConfig.attackerAbilityPolicyOverrides = overridesA;
  const overridesB = toRustAbilityPolicyOverrides(
    input.abilityPolicyOverridesB,
    input.userAbilityOverridesB,
    input.userAbilityLevelsB,
  );
  if (overridesB) abilityConfig.defenderAbilityPolicyOverrides = overridesB;
  abilityConfig.combatEventOrder = input.combatEventOrder ?? RECOMMENDED_COMBAT_EVENT_ORDER;
  // Forward day/night + moon strings verbatim so the
  // Rust engine can map them to the `env.*` expression namespace. The
  // engine itself does no mechanical work with these strings - they're
  // pure data for user abilities to read.
  if (input.compareDayNight && input.compareDayNight !== "none") {
    abilityConfig.compareDayNight = input.compareDayNight;
  }
  if (input.compareMoon && input.compareMoon !== "none") {
    abilityConfig.compareMoon = input.compareMoon;
  }
  // Season reaches the engine as the two interval multipliers it actually
  // changes, rather than as a name the engine would have to know.
  if (input.compareSeason && input.compareSeason !== "none") {
    const intervals = getSeasonMeterIntervals(input.compareSeason);
    abilityConfig.compareSeasonHungerInterval = intervals.hunger;
    abilityConfig.compareSeasonThirstInterval = intervals.thirst;
  }
  // Weather cataclysm: the engine seeds a permanent weather status on each
  // non-immune side at setup. Immunity is resolved on the TS side and
  // delivered as the two flags below.
  if (input.weather && input.weather !== "none") {
    abilityConfig.weather = input.weather;
    abilityConfig.attackerWeatherImmune = input.attackerWeatherImmune ?? false;
    abilityConfig.defenderWeatherImmune = input.defenderWeatherImmune ?? false;
  }
  // Oxygen / Moisture drain mode (Compare-only global). Off / undefined leaves
  // the Rust serde default (None = inert). The per-side pools always ride
  // through the stat producer, so only the mode needs forwarding here.
  if (input.oxygenMoistureMode && input.oxygenMoistureMode !== "off") {
    abilityConfig.oxygenMoistureMode = input.oxygenMoistureMode;
  }
  if (input.attackerStorming) {
    abilityConfig.attackerStorming = true;
  }
  if (input.defenderStorming) {
    abilityConfig.defenderStorming = true;
  }
  if (input.radiationNearbyCount && input.radiationNearbyCount > 0) {
    abilityConfig.radiationNearbyCount = input.radiationNearbyCount;
  }
  // Forward the per-side bite-variant mode picked from the
  // Compare "Specific / disputed abilities" chip. Default
  // `primaryOnly` mirrors today's behavior for any creature.
  abilityConfig.attackerBiteVariantMode = input.compareBiteVariantModeA;
  abilityConfig.defenderBiteVariantMode = input.compareBiteVariantModeB;
  // Per-side breath firing policy. Already resolved upstream, so the fallback
  // here is just the Rust serde default.
  abilityConfig.attackerBreathPolicy = input.breathPolicyA ?? "onAvailability";
  abilityConfig.defenderBreathPolicy = input.breathPolicyB ?? "onAvailability";

  return {
    attacker,
    defender,
    attackerBreath,
    defenderBreath,
    abilityPolicy: toRustAbilityTimingMode(input.abilityPolicy),
    abilityConfig,
  };
}
