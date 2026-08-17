import { getSeasonMeterIntervals } from "../engine/compareSeason";
import type { BuildOptions, CreatureRuntime, FinalStats } from "../engine";
import type {
  BestBuildsBattleSettings,
  BestBuildsSideSpecific,
  BestBuildsSideTrapsTrails,
} from "../components/bestBuilds/bestBuildsBattleSettingsTypes";
import { creatureHasAbility } from "../components/compare/compareSpecialAbilities";
import { getCreatureBreathPolicyKind, getDefaultBreathPolicy } from "../engine/breathPolicy";
import { toRustAbilityPolicyOverrides } from "./rustCompareMatchupRuntime";
import { resolveGenericTrail, resolveRuntimeAbilityValue } from "./runtimeAbilityValue";
import {
  applyCompareBuffRuntime,
  type CompareBuffRuntimeResult,
  type CompareBuffSelection,
  type CompareDayNightMode,
  type CompareMoonMode,
  DEFAULT_COMPARE_BUFF_SELECTION,
} from "../engine/compareBuffRuntime";
import {
  getDefiledGroundConsumptionReductionPct,
  getDefiledGroundStatBonusPct,
} from "../engine/compareDefiledGroundData";
import type { RustComposableAbilityConfig, RustSimpleCombatantStats } from "./rustMatchupBridge";

/**
 * Sibling channel to `extraAbilityConfig`: per-side combatant-stat
 * overrides that get spread onto the `RustSimpleCombatantStats`
 * objects right before each matchup hits the Rust bridge.
 *
 * Used for BB settings whose effect lives on the combatant-stats
 * shape rather than the ability-config shape (e.g. Special Air PvP
 * Rule, which writes `compareAirRuleCooldownSec`).
 */
export type BestBuildsExtraCombatantStats = {
  source?: Partial<RustSimpleCombatantStats>;
  opponent?: Partial<RustSimpleCombatantStats>;
};

/**
 * Per-side Specific/Disputed payload. Channelled from the BB flow to
 * `simulateBestBuildMatchupWithPath`, where the TS-side modifiers
 * (FinalStats mutations + Broodwatcher starting status) are applied
 * before the Rust bridge call.
 */
export type BestBuildsExtraSpecialAbilities = {
  source?: BestBuildsSideSpecific;
  opponent?: BestBuildsSideSpecific;
};

/**
 * Per-side Compare-style buff payload + the environment knobs that
 * `applyCompareBuffRuntime` interprets alongside the buffs (day/night
 * and moon). Channelled to `simulateBestBuildMatchupWithPath`, where
 * each side feeds its halves into `applyCompareBuffRuntime` (the same
 * function Compare uses) before the Rust bridge call.
 */
export type BestBuildsExtraBuffs = {
  source?: CompareBuffSelection;
  opponent?: CompareBuffSelection;
  dayNight: CompareDayNightMode;
  moon: CompareMoonMode;
};

/**
 * Per-side Traps & Trails toggle payload. Channelled to
 * `simulateBestBuildMatchupWithPath` where each side's flags are
 * applied to the per-matchup `RustComposableAbilityConfig`. Sides
 * default to BB's pre-toggle behavior - `traps=true` preserves the
 * presence-based trap activation, `trails=false` keeps trail damage
 * values at the engine default of 0. The channel stays inert (the
 * builder returns `undefined`) when both sides match those defaults.
 */
export type BestBuildsExtraTrapsTrails = {
  source: BestBuildsSideTrapsTrails;
  opponent: BestBuildsSideTrapsTrails;
};

/**
 * Maps the shared Best Builds + Optimizer `BestBuildsBattleSettings`
 * into a `Partial<RustComposableAbilityConfig>` that gets spread onto
 * the per-matchup config inside the Rust BB pipeline.
 *
 * Centralised here so every consumer (main flow, refinement, finalize,
 * per-opponent rows, worker job builder, ...) reads the same translation
 * - adding a new field to BestBuildsBattleSettings means adding one line
 * here, and every downstream call site picks it up automatically.
 *
 * Returns `undefined` (not an empty object) when the input is undefined
 * or only carries default values, so downstream `extraAbilityConfig`
 * checks can short-circuit cleanly and the worker job message stays
 * minimal.
 */
export function buildBestBuildsExtraAbilityConfig(
  settings: BestBuildsBattleSettings | undefined,
  allowIdeal = false,
): Partial<RustComposableAbilityConfig> | undefined {
  if (!settings) return undefined;
  const extra: Partial<RustComposableAbilityConfig> = {};
  if (settings.global.dayNight !== "none") {
    extra.compareDayNight = settings.global.dayNight;
  }
  if (settings.global.moon !== "none") {
    extra.compareMoon = settings.global.moon;
  }
  // Season reaches the engine as the two interval multipliers it changes,
  // rather than as a name the engine would have to know. The ailment a season
  // carries is seeded per side alongside the other starting statuses.
  if (settings.global.season !== "none") {
    const intervals = getSeasonMeterIntervals(settings.global.season);
    extra.compareSeasonHungerInterval = intervals.hunger;
    extra.compareSeasonThirstInterval = intervals.thirst;
  }
  // Weather cataclysm applies to both sides for every matchup. Per-side
  // immunity (Volcanic vs Heat Wave, Frosty vs Blizzard) is resolved
  // per-matchup in rustBestBuildsRuntime (withWeatherImmunity), since the
  // opponent - and thus its abilities - varies across the pool.
  if (settings.global.weather !== "none") {
    extra.weather = settings.global.weather;
  }
  // Oxygen / Moisture drain mode applies to both sides for every matchup. The
  // per-side oxygenTime / moistureTime pools ride the shared stat producer
  // (toRustStatusMeleeStats -> FinalStats), so only the mode is forwarded here.
  if (settings.global.oxygenMoistureMode !== "off") {
    extra.oxygenMoistureMode = settings.global.oxygenMoistureMode;
  }
  // Aerial Dodge master switch. The per-side hit chances ride the
  // combatant-stats channel (buildBestBuildsExtraCombatantStats). Roll style is
  // honored in every mode; even (the default) keeps results deterministic, so
  // stable rankings are the default. Real-random rides the fixed seed 0, so a
  // run stays reproducible - every matchup sees the same roll sequence.
  if (settings.global.aerialDodgeEnabled) {
    extra.aerialDodgeActive = true;
    extra.aerialDodgeRealRandom = settings.global.aerialDodgeRollStyle === "random";
  }
  // Storming buff toggle (raw). The terrestrial-self / aquatic-opponent gate
  // is resolved per-matchup in rustBestBuildsRuntime (withWeatherAndStorming),
  // since the opponent - and thus its type - varies across the pool.
  if (settings.source.buffs.storming) {
    extra.attackerStorming = true;
  }
  if (settings.opponent.buffs.storming) {
    extra.defenderStorming = true;
  }
  // No Move Facetank: toggle ON (default, matches Compare) = decay naturally
  // = Rust serde default, no override. Toggle OFF = send block flag per side.
  // Mirrors comment in wasm-engine/src/composable/mod.rs:408 -
  // `block_persistent_decay = !compareNoMoveFacetank`.
  if (!settings.global.noMoveFacetank) {
    extra.attackerCompareBlockPersistentDecay = true;
    extra.defenderCompareBlockPersistentDecay = true;
  }
  // First Tick Rule: "off" (default) leaves Rust serde defaults (false /
  // false). Other modes send the corresponding flags per side plus the
  // user-set delay.
  if (settings.global.firstTickMode !== "off") {
    const regen =
      settings.global.firstTickMode === "regen" ||
      settings.global.firstTickMode === "both";
    const ailments =
      settings.global.firstTickMode === "ailments" ||
      settings.global.firstTickMode === "both";
    if (regen) {
      extra.attackerCompareFirstTickRegen = true;
      extra.defenderCompareFirstTickRegen = true;
    }
    if (ailments) {
      extra.attackerCompareFirstTickAilments = true;
      extra.defenderCompareFirstTickAilments = true;
    }
    extra.attackerCompareFirstTickDelaySec = settings.global.firstTickDelaySec;
    extra.defenderCompareFirstTickDelaySec = settings.global.firstTickDelaySec;
  }
  // Per-side AI policy - Sit/Lay/Stand posture + bite variant mode.
  // Source -> attacker, opponent -> defender in the BB engine call.
  if (settings.source.aiPolicy.posturePolicy !== "off") {
    extra.attackerPosturePolicyEnabled = true;
    extra.attackerPosturePolicyRegenAware =
      settings.source.aiPolicy.posturePolicy === "regenAware";
  }
  if (settings.opponent.aiPolicy.posturePolicy !== "off") {
    extra.defenderPosturePolicyEnabled = true;
    extra.defenderPosturePolicyRegenAware =
      settings.opponent.aiPolicy.posturePolicy === "regenAware";
  }
  if (settings.source.aiPolicy.biteVariantMode !== "primaryOnly") {
    extra.attackerBiteVariantMode = settings.source.aiPolicy.biteVariantMode;
  }
  if (settings.opponent.aiPolicy.biteVariantMode !== "primaryOnly") {
    extra.defenderBiteVariantMode = settings.opponent.aiPolicy.biteVariantMode;
  }
  // Breath firing policy: only an explicit pick rides this channel. "auto" is
  // left absent on purpose so `buildBreathPolicyDefaults` can fill the
  // creature-derived default per matchup - the field is emitted here exactly
  // when the user overrode that default. "ideal" runs a per-burst engine replay
  // that is affordable for a single fight (Sandbox, `allowIdeal`) but ruinous
  // across a best-builds / optimizer sweep. The sweep surfaces call this with
  // `allowIdeal` false, so a stale `ideal` setting is dropped rather than
  // forwarded (the sweep control already omits it - see
  // BREATH_POLICY_OPTIONS_BB); Sandbox passes `allowIdeal` and keeps it.
  const sourceBreathPolicy = settings.source.aiPolicy.breathPolicy;
  if (sourceBreathPolicy !== "auto" && (sourceBreathPolicy !== "ideal" || allowIdeal)) {
    extra.attackerBreathPolicy = sourceBreathPolicy;
  }
  const opponentBreathPolicy = settings.opponent.aiPolicy.breathPolicy;
  if (opponentBreathPolicy !== "auto" && (opponentBreathPolicy !== "ideal" || allowIdeal)) {
    extra.defenderBreathPolicy = opponentBreathPolicy;
  }
  // Nearby radiated creatures - matchup-level (applies to both sides). 0 is the
  // Rust serde default (a single radiation source); only send when positive.
  if (settings.global.radiationNearbyCount > 0) {
    extra.radiationNearbyCount = settings.global.radiationNearbyCount;
  }
  // Per-side starting state. Engine silently ignores fields for creatures
  // that don't own the relevant ability (Spite / Warden's Rage), so the
  // same setting can ride the whole opponent pool.
  if (settings.source.startingState.spiteReadyAtStart) {
    extra.attackerSpiteReadyAtStart = true;
  }
  if (settings.opponent.startingState.spiteReadyAtStart) {
    extra.defenderSpiteReadyAtStart = true;
  }
  if (settings.source.startingState.wardenRageStartHpEnabled) {
    extra.attackerCompareStartHpPct = settings.source.startingState.wardenRageStartHpPct;
  }
  if (settings.opponent.startingState.wardenRageStartHpEnabled) {
    extra.defenderCompareStartHpPct = settings.opponent.startingState.wardenRageStartHpPct;
  }
  if (settings.source.startingState.headStartEnabled) {
    extra.attackerHeadStartSec = settings.source.startingState.headStartSec;
  }
  if (settings.opponent.startingState.headStartEnabled) {
    extra.defenderHeadStartSec = settings.opponent.startingState.headStartSec;
  }
  // Per-side Healing Pulse - Compare-only modeled ability. `Once`
  // variant is a separate boolean flag, only meaningful when the main
  // toggle is on.
  if (settings.source.healingPulse.enabled) {
    extra.attackerHealingPulse = true;
    if (settings.source.healingPulse.mode === "onceAtStart") {
      extra.attackerHealingPulseOnce = true;
    }
  }
  if (settings.opponent.healingPulse.enabled) {
    extra.defenderHealingPulse = true;
    if (settings.opponent.healingPulse.mode === "onceAtStart") {
      extra.defenderHealingPulseOnce = true;
    }
  }
  // Per-side Specific/Disputed - config-side fields. Most of these name an
  // ability the engine only reads when the creature owns it, so the same
  // Opponent-side setting rides the whole pool. Defiled Ground is the
  // exception - its level feeds an ungated recovery multiplier and it owes
  // the other side a debuff - so both halves are resolved per matchup in
  // applyBbDefiledGroundToAbilityConfig, where the fighters are known.
  // (Volcanic / Frosty / Strength In Numbers / Broodwatcher live on the
  // FinalStats / starting-status pipelines, not here - see
  // applyBbSpecialAbilitiesToFinalStats + bbBroodwatcherStartingStatus.)
  applySpecificAbilityConfig(extra, "attacker", settings.source.specific);
  applySpecificAbilityConfig(extra, "defender", settings.opponent.specific);
  // Per-side Ability Timing Overrides + Custom-ability timing
  // overrides + Custom-ability level picks. All three flow into the
  // same `attacker/defenderAbilityPolicyOverrides` field - reuse
  // Compare's `toRustAbilityPolicyOverrides` so BB / Compare share
  // the same conversion (kind={builtIn|user}, level clamping, etc.)
  // and any future shape change happens in one place.
  const attackerOverrides = toRustAbilityPolicyOverrides(
    settings.source.abilityTimingOverrides,
    settings.source.userAbilityOverrides,
    settings.source.userAbilityLevels,
  );
  if (attackerOverrides) {
    extra.attackerAbilityPolicyOverrides = attackerOverrides;
  }
  const defenderOverrides = toRustAbilityPolicyOverrides(
    settings.opponent.abilityTimingOverrides,
    settings.opponent.userAbilityOverrides,
    settings.opponent.userAbilityLevels,
  );
  if (defenderOverrides) {
    extra.defenderAbilityPolicyOverrides = defenderOverrides;
  }
  return Object.keys(extra).length > 0 ? extra : undefined;
}

function applySpecificAbilityConfig(
  extra: Partial<RustComposableAbilityConfig>,
  prefix: "attacker" | "defender",
  spec: BestBuildsSideSpecific,
): void {
  if (spec.defiledGround) {
    extra[`${prefix}CompareDefiledGroundLevel`] = spec.defiledGroundLevel;
  }
  if (spec.darkstar) {
    extra[`${prefix}CompareDarkStar`] = true;
  }
  // The meters always run and Gourmandizer works for whoever owns it, so
  // neither is a setting any more. What is left is how full each bar starts.
  //
  // Best Builds runs its meters on a flat 100-unit bar rather than each
  // creature's own appetite: the per-build stats are produced deep inside the
  // search, past where a settings bridge can reach. That flat bar is the
  // engine's own default, so a fill percent lands as itself without this
  // bridge naming a base - which matters, because the Sandbox layers these
  // settings over a config that does carry the creature's real appetite.
  extra[`${prefix}CompareHungerRule`] = true;
  extra[`${prefix}CompareGourmandizer`] = true;
  extra[`${prefix}ReflectResponseHold`] = spec.reflectResponse === "hold";
  extra[`${prefix}CompareStartingHunger`] = spec.startingHungerPct;
  extra[`${prefix}CompareStartingThirst`] = spec.startingThirstPct;
  if (spec.powerCharge) {
    extra[`${prefix}PowerCharge`] = true;
  }
  if (spec.goreCharge) {
    extra[`${prefix}GoreCharge`] = true;
  }
}

/**
 * Translates BB battle settings into per-side `RustSimpleCombatantStats`
 * overrides. Symmetric for now (Air PvP applies the same shared
 * cooldown to both sides) - kept per-side so later settings that
 * need asymmetric per-side stats fit the same channel.
 */
export function buildBestBuildsExtraCombatantStats(
  settings: BestBuildsBattleSettings | undefined,
): BestBuildsExtraCombatantStats | undefined {
  if (!settings) return undefined;
  const source: Partial<RustSimpleCombatantStats> = {};
  const opponent: Partial<RustSimpleCombatantStats> = {};
  if (settings.global.airRuleEnabled) {
    source.compareAirRuleCooldownSec = settings.global.airRuleCooldownSec;
    opponent.compareAirRuleCooldownSec = settings.global.airRuleCooldownLinked === false
      ? settings.global.airRuleCooldownSecB
      : settings.global.airRuleCooldownSec;
  }
  if (settings.global.aerialDodgeEnabled) {
    // The engine gates the roll on flier type + Shredded Wings, so the bridge
    // just forwards the raw per-side chance (source = A, opponent = B).
    const clampPct = (v: number) => Math.max(0, Math.min(100, Number.isFinite(v) ? v : 100));
    source.aerialDodgeHitChancePct = clampPct(settings.global.aerialDodgeHitChancePctA);
    opponent.aerialDodgeHitChancePct = clampPct(settings.global.aerialDodgeHitChancePctB);
  }
  if (settings.source.disabledAbilities.length > 0) {
    source.disabledAbilities = [...settings.source.disabledAbilities];
  }
  if (settings.opponent.disabledAbilities.length > 0) {
    opponent.disabledAbilities = [...settings.opponent.disabledAbilities];
  }
  const hasSource = Object.keys(source).length > 0;
  const hasOpponent = Object.keys(opponent).length > 0;
  if (!hasSource && !hasOpponent) return undefined;
  return {
    source: hasSource ? source : undefined,
    opponent: hasOpponent ? opponent : undefined,
  };
}

// ---------------------------------------------------------------------------
// FinalStats-side Specific / Disputed mutations + Broodwatcher starting
// status. Mirror of `applyCompareSpecialAbilities` +
// `buildCompareInitialStatuses` in `useCompareSimulation.ts` so the BB
// pipeline matches Compare's per-side modifiers without re-exporting
// hook-private helpers. Keep these two surfaces in sync.
// ---------------------------------------------------------------------------

function applyPct(value: number | undefined, pct: number): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return value;
  return value * (1 + pct / 100);
}

/**
 * Builds the per-side Buffs payload + day/night/moon environment for
 * the matching `applyCompareBuffRuntime` apply step. Returns
 * `undefined` when there is nothing to do (no buff toggled and no
 * day/night/moon set), so the channel stays inert at defaults.
 *
 * Important: applying `applyCompareBuffRuntime` in BB also fixes a
 * pre-existing Compare<->BB divergence - BB used to send compareDayNight
 * / compareMoon strings to Rust but never apply the matching FinalStats
 * mutations (Photo-diet damage/regen, Eclipse plushie, blue/blood
 * moon). With this channel wired, BB now matches Compare's per-matchup
 * stats for those env settings.
 */
export function buildBestBuildsExtraBuffs(
  settings: BestBuildsBattleSettings | undefined,
): BestBuildsExtraBuffs | undefined {
  if (!settings) return undefined;
  const sourceHasBuff = anyBuffSet(settings.source.buffs);
  const opponentHasBuff = anyBuffSet(settings.opponent.buffs);
  const dayNightOn = settings.global.dayNight !== "none";
  const moonOn = settings.global.moon !== "none";
  if (!sourceHasBuff && !opponentHasBuff && !dayNightOn && !moonOn) {
    return undefined;
  }
  return {
    source: sourceHasBuff || dayNightOn || moonOn ? settings.source.buffs : undefined,
    opponent: opponentHasBuff || dayNightOn || moonOn ? settings.opponent.buffs : undefined,
    dayNight: settings.global.dayNight,
    moon: settings.global.moon,
  };
}

function anyBuffSet(selection: CompareBuffSelection): boolean {
  for (const key of Object.keys(DEFAULT_COMPARE_BUFF_SELECTION) as Array<keyof CompareBuffSelection>) {
    if (selection[key]) return true;
  }
  return false;
}

/**
 * Wraps `applyCompareBuffRuntime` for BB. Returns the runtime result
 * (mutated FinalStats + starting statuses + activeCooldownMultiplier)
 * for one side. `build` is required so plushie-variant logic (Bear
 * Aggressive/Scared, Land Muddy duration, Eclipse night override)
 * matches Compare exactly - callers in the BB pipeline plumb the
 * per-side build (source's optimized build / opponent baseline build)
 * down to this point.
 */
export function applyBbBuffsForSide(
  finalStats: FinalStats,
  buffs: CompareBuffSelection,
  dayNight: CompareDayNightMode,
  moon: CompareMoonMode,
  build: BuildOptions,
): CompareBuffRuntimeResult {
  return applyCompareBuffRuntime(finalStats, build, buffs, dayNight, moon);
}

/**
 * Builds the per-side Specific/Disputed payload channelled to
 * `simulateBestBuildMatchupWithPath`. Returns `undefined` when neither
 * side has anything enabled so the channel stays inert at defaults.
 */
export function buildBestBuildsExtraSpecialAbilities(
  settings: BestBuildsBattleSettings | undefined,
): BestBuildsExtraSpecialAbilities | undefined {
  if (!settings) return undefined;
  const anySpecificSet = (spec: BestBuildsSideSpecific) =>
    spec.volcanic ||
    spec.frosty ||
    spec.defiledGround ||
    spec.darkstar ||
    spec.broodwatcher ||
    spec.powerCharge ||
    spec.goreCharge ||
    spec.strengthInNumbers;
  const source = anySpecificSet(settings.source.specific) ? settings.source.specific : undefined;
  const opponent = anySpecificSet(settings.opponent.specific) ? settings.opponent.specific : undefined;
  if (!source && !opponent) return undefined;
  return { source, opponent };
}

/**
 * Returns a new FinalStats with the per-side Specific/Disputed
 * modifiers applied. Pure: never mutates the input. Returns the input
 * unchanged when no modifier is enabled or the creature doesn't own the
 * underlying ability (the same per-creature gating Compare uses).
 */
export function applyBbSpecialAbilitiesToFinalStats(
  finalStats: FinalStats,
  creature: CreatureRuntime | undefined,
  spec: BestBuildsSideSpecific,
): FinalStats {
  const wantsVolcanic = spec.volcanic && creatureHasAbility(creature, "Volcanic");
  const hasFrosty =
    creatureHasAbility(creature, "Frosty") ||
    !!finalStats.plushieGrantedOtherAbilities?.some((a) => a.name === "Frosty");
  const wantsFrosty = spec.frosty && hasFrosty;
  const wantsDefiledGround = spec.defiledGround && creatureHasAbility(creature, "Defiled Ground");
  const wantsStrengthInNumbers =
    spec.strengthInNumbers && creatureHasAbility(creature, "Strength In Numbers");
  if (
    !wantsVolcanic &&
    !wantsFrosty &&
    !wantsDefiledGround &&
    !wantsStrengthInNumbers
  ) {
    return finalStats;
  }
  const next: FinalStats = {
    ...finalStats,
    appliedTraits: [...finalStats.appliedTraits],
  };
  if (wantsVolcanic) {
    next.healthRegen = applyPct(next.healthRegen, 50);
  }
  if (wantsFrosty) {
    next.healthRegen = applyPct(next.healthRegen, 25);
    next.stamRegen = applyPct(next.stamRegen, 25);
  }
  if (wantsDefiledGround) {
    const statBonusPct = getDefiledGroundStatBonusPct(spec.defiledGroundLevel);
    next.health = applyPct(next.health, statBonusPct) ?? next.health;
    next.weight = applyPct(next.weight, statBonusPct) ?? next.weight;
    void getDefiledGroundConsumptionReductionPct; // referenced for future hunger-rule wiring
  }
  if (wantsStrengthInNumbers) {
    const allies = Math.max(0, Math.min(9, Math.floor(spec.strengthInNumbersAllies ?? 0)));
    if (allies > 0) {
      next.damage = applyPct(next.damage, 1.5 * allies) ?? next.damage;
    }
  }
  return next;
}

/**
 * Builds the per-opponent baseline `BuildOptions` from the settings,
 * or `undefined` when the override is disabled (in which case the
 * runtime falls back to `BEST_BUILDS_OPPONENT_BUILD`). Returning a
 * fresh object so downstream mutations can't leak back into the
 * settings store.
 */
export function buildBestBuildsOpponentBaselineBuild(
  settings: BestBuildsBattleSettings | undefined,
): BuildOptions | undefined {
  if (!settings?.opponentBaseline.enabled) return undefined;
  const source = settings.opponentBaseline.build;
  return {
    venerationStage: source.venerationStage,
    traits: [...source.traits],
    ascensionAssignments: [...source.ascensionAssignments],
    plushies: [...source.plushies],
    elder: source.elder,
  };
}

/**
 * Builds the Traps & Trails channel from the settings, or
 * `undefined` when both sides match the BB defaults (traps=true /
 * trails=false). When non-undefined, `simulateBestBuildMatchupWithPath`
 * passes the channel to `applyBbTrapsTrailsToAbilityConfig`, which
 * mutates the per-matchup config based on the toggles + the live
 * creatures.
 */
export function buildBestBuildsExtraTrapsTrails(
  settings: BestBuildsBattleSettings | undefined,
): BestBuildsExtraTrapsTrails | undefined {
  if (!settings) return undefined;
  const sourceAtDefault =
    settings.source.trapsTrails.traps === true &&
    settings.source.trapsTrails.trails === false;
  const opponentAtDefault =
    settings.opponent.trapsTrails.traps === true &&
    settings.opponent.trapsTrails.trails === false;
  if (sourceAtDefault && opponentAtDefault) return undefined;
  return {
    source: { ...settings.source.trapsTrails },
    opponent: { ...settings.opponent.trapsTrails },
  };
}

/**
 * Returns a new `extraAbilityConfig` overlay with the per-side
 * Traps & Trails toggles applied against the live source / opponent
 * creatures. The base overlay is kept verbatim; only the trap /
 * trail fields are touched.
 *
 *  - `traps=false`: force `attacker/defenderThornTrap` and
 *    `attacker/defenderToxicTrap` to `false`. Overrides BB's
 *    presence-based default in `rustBestBuildsRuntime.ts`. Frost Snare
 *    places no trap and Compare leaves it alone, so it is not in here.
 *  - `trails=true`: resolve numeric values for Healing Step / Flame
 *    Trail / Frost Trail / Plague Trail / Toxic Trail from the
 *    creature spec via `resolveRuntimeAbilityValue`. Creatures that
 *    don't own a given trail resolve to `0` silently.
 *
 *  Returns the input `extraAbilityConfig` unchanged when
 *  `extraTrapsTrails` is undefined.
 */
export function applyBbTrapsTrailsToAbilityConfig(
  extraAbilityConfig: Partial<RustComposableAbilityConfig> | undefined,
  sourceCreature: CreatureRuntime,
  opponentCreature: CreatureRuntime,
  extraTrapsTrails: BestBuildsExtraTrapsTrails | undefined,
): Partial<RustComposableAbilityConfig> | undefined {
  if (!extraTrapsTrails) return extraAbilityConfig;
  const next: Partial<RustComposableAbilityConfig> = { ...(extraAbilityConfig ?? {}) };
  if (extraTrapsTrails.source.traps === false) {
    next.attackerThornTrap = false;
    next.attackerToxicTrap = false;
  }
  if (extraTrapsTrails.opponent.traps === false) {
    next.defenderThornTrap = false;
    next.defenderToxicTrap = false;
  }
  if (extraTrapsTrails.source.trails === true) {
    next.attackerHealingStepValue = resolveNumeric(sourceCreature, "Healing Step");
    next.attackerFlameTrailValue = resolveNumeric(sourceCreature, "Flame Trail");
    next.attackerFrostTrailValue = resolveNumeric(sourceCreature, "Frost Trail");
    next.attackerPlagueTrailValue = resolveNumeric(sourceCreature, "Plague Trail");
    next.attackerToxicTrailValue = resolveNumeric(sourceCreature, "Toxic Trail");
    const aGenericTrail = resolveGenericTrail(sourceCreature);
    next.attackerTrailStatusId = aGenericTrail?.statusId ?? null;
    next.attackerTrailValue = aGenericTrail?.value ?? 0;
  }
  if (extraTrapsTrails.opponent.trails === true) {
    next.defenderHealingStepValue = resolveNumeric(opponentCreature, "Healing Step");
    next.defenderFlameTrailValue = resolveNumeric(opponentCreature, "Flame Trail");
    next.defenderFrostTrailValue = resolveNumeric(opponentCreature, "Frost Trail");
    next.defenderPlagueTrailValue = resolveNumeric(opponentCreature, "Plague Trail");
    next.defenderToxicTrailValue = resolveNumeric(opponentCreature, "Toxic Trail");
    const bGenericTrail = resolveGenericTrail(opponentCreature);
    next.defenderTrailStatusId = bGenericTrail?.statusId ?? null;
    next.defenderTrailValue = bGenericTrail?.value ?? 0;
  }
  return next;
}

/**
 * Resolves both halves of Defiled Ground against the live fighters: the side
 * that owns the ability keeps its contaminated-land level, and the side facing
 * it takes the Sickly weakness.
 *
 * The setting rides the whole pool while ownership is per-creature, so neither
 * half can be settled where the setting is read. Ungated, the level reached
 * `recoverable_recovery_mult` for every build in the pool - faster ailment
 * recovery for creatures that never defiled anything - while the weakness was
 * never set at all, so nobody paid for the ground they were standing on.
 *
 * Mirrors `useCompareSimulation`, which resolves the same pair through
 * `defiledGroundActive`. Returns the input untouched when the setting left no
 * level on either side.
 */
export function applyBbDefiledGroundToAbilityConfig(
  extraAbilityConfig: Partial<RustComposableAbilityConfig> | undefined,
  sourceCreature: CreatureRuntime,
  opponentCreature: CreatureRuntime,
): Partial<RustComposableAbilityConfig> | undefined {
  const attackerLevel = extraAbilityConfig?.attackerCompareDefiledGroundLevel ?? 0;
  const defenderLevel = extraAbilityConfig?.defenderCompareDefiledGroundLevel ?? 0;
  if (attackerLevel <= 0 && defenderLevel <= 0) return extraAbilityConfig;

  const attackerOwns = creatureHasAbility(sourceCreature, "Defiled Ground");
  const defenderOwns = creatureHasAbility(opponentCreature, "Defiled Ground");
  const attackerActive = attackerLevel > 0 && attackerOwns;
  const defenderActive = defenderLevel > 0 && defenderOwns;

  return {
    ...(extraAbilityConfig ?? {}),
    attackerCompareDefiledGroundLevel: attackerActive ? attackerLevel : 0,
    defenderCompareDefiledGroundLevel: defenderActive ? defenderLevel : 0,
    attackerCompareDefiledGroundWeakness: defenderActive,
    defenderCompareDefiledGroundWeakness: attackerActive,
  };
}

/**
 * Creature-derived breath-policy defaults for one matchup: chain breaths
 * (Energy / Lightning / Glacier) burst off a full bar, every other breath fires
 * on availability.
 *
 * The engine deliberately honors only an explicit mode - serde cannot tell an
 * unset field from an explicit `onAvailability` - so the default has to be
 * resolved on this side, per matchup, once both creatures are known. Callers
 * spread this UNDER the settings overlay so an explicit user pick wins.
 */
export function buildBreathPolicyDefaults(
  sourceCreature: CreatureRuntime,
  opponentCreature: CreatureRuntime,
): Pick<RustComposableAbilityConfig, "attackerBreathPolicy" | "defenderBreathPolicy"> {
  return {
    attackerBreathPolicy: getDefaultBreathPolicy(getCreatureBreathPolicyKind(sourceCreature)),
    defenderBreathPolicy: getDefaultBreathPolicy(getCreatureBreathPolicyKind(opponentCreature)),
  };
}

function resolveNumeric(creature: CreatureRuntime, abilityName: string): number {
  const raw = resolveRuntimeAbilityValue(creature, abilityName);
  return typeof raw === "number" ? raw : 0;
}

/**
 * Returns a starting-status entry for Broodwatcher's 5 Defensive
 * stacks at t=0, or null when the side toggle is off or the creature
 * doesn't own Broodwatcher. Caller folds the result into the
 * `extraCombatantStats.{source,opponent}.startingStatuses` channel.
 */
export function bbBroodwatcherStartingStatus(
  creature: CreatureRuntime | undefined,
  spec: BestBuildsSideSpecific,
): NonNullable<RustSimpleCombatantStats["startingStatuses"]>[number] | null {
  if (!spec.broodwatcher || !creatureHasAbility(creature, "Broodwatcher")) return null;
  return {
    statusId: "Defensive_Status",
    stacks: 5,
    stackValueMode: "durationOnly",
    sourceAbility: "Broodwatcher",
    noDecay: true,
  };
}
