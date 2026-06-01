import type { AbilityTimingMode, AbilityTimingOverrides, CreatureRuntime, FinalStats } from "../engine";
import { DEFAULT_ABILITY_TIMING_OVERRIDES } from "../engine/abilityTimingOverrides";
import { creatureHasAbility } from "../components/compare/compareSpecialAbilities";
import { isAquaticType, isTerrestrialType, isWeatherImmune, type WeatherCondition } from "../engine/weather";
import { buildCombinedRustStatusBlockFractions } from "./rustStatusBlockFractions";
import { breathSpecByName, effectsCatalog } from "../engine/data";
import { hasAbilityName, normalizeAbilityName, parseBreathAilments, resolveStatusId } from "../engine/runtimeHelpers";
import { isModeledOtherAbility } from "./abilityCoverageRegistry";
import type { BestBuildsMatchupSummary } from "./bestBuildsMatchupContract";
import { resolveRuntimeAbilityValue } from "./runtimeAbilityValue";
import {
  getRustBlockingActivatedAbilityNamesForPassiveContours as getBlockingActivatedAbilityNames,
  getRustUnsupportedActivatedAbilityNames,
  getRustUnsupportedPassiveAbilityNames,
} from "./rustEligibilityHelpers";
import {
  CONTOUR_TS_NO_OP_ACTIVATED_NAMES,
  DEFAULT_PASSIVE_CONTOUR_ABILITY_FILTERS,
} from "./rustPassiveContourShared";
import { getExplicitOnHitStatuses } from "./rustActiveProfiles";
import type {
  RustAbilityPolicyOverrides,
  RustComposableAbilityConfig,
  RustSimpleBreathProfile,
  RustSimpleCombatantStats,
} from "./rustMatchupBridge";
import { getLoadedRustMatchupBridge } from "./rustMatchupLoader";

// Best Builds inherits the global ability-timing overrides set
// (Warden's Rage on ReallyFast) plus any Best-Builds-specific
// extras. Fortify previously had `"fast"` here as a workaround for
// the pre-P4 Ideal "fires too early" bug. After P4 (stack-pressure
// projection via POLICY_SEARCH_DELAY_KEY) the Ideal path produces
// math-ideal Fortify timing, so the override is gone — Best Builds
// uses the user-selected global mode for Fortify, same as Compare.
const BEST_BUILDS_DEFAULT_ABILITY_TIMING_OVERRIDES: AbilityTimingOverrides = {
  ...DEFAULT_ABILITY_TIMING_OVERRIDES,
};

// ---------------------------------------------------------------------------
// Composable engine is the only Rust combat dispatcher for best builds /
// optimizer. The bespoke contour functions (simple_melee, status_melee,
// active_melee, life_leech_melee, and 12 bespoke breath contours) were
// deleted on 2026-04-09 after full fixture parity with composable. Shared
// eligibility helpers remain for passive-contour filtering used by pages
// and engine tests.
// ---------------------------------------------------------------------------

export function toRustAbilityTimingMode(
  abilityPolicy: AbilityTimingMode,
): "reallyFast" | "fast" | "semiIdeal" | "ideal" | "extreme" {
  return abilityPolicy;
}

function hasDefaultAbilityTimingOverride(creature: CreatureRuntime, abilityName: string): boolean {
  return (
    hasActivatedAbilityNamed(creature, abilityName) ||
    (creature.passiveAbilities ?? []).some((ability) => normalizeAbilityName(ability.name) === normalizeAbilityName(abilityName))
  );
}

function toRustDefaultAbilityPolicyOverrides(creature: CreatureRuntime): RustAbilityPolicyOverrides | undefined {
  const out: RustAbilityPolicyOverrides = {};
  let any = false;
  for (const [abilityName, mode] of Object.entries(BEST_BUILDS_DEFAULT_ABILITY_TIMING_OVERRIDES) as Array<
    [keyof AbilityTimingOverrides, AbilityTimingMode]
  >) {
    if (hasDefaultAbilityTimingOverride(creature, abilityName)) {
      out[abilityName] = toRustAbilityTimingMode(mode);
      any = true;
    }
  }
  return any ? out : undefined;
}

export function __test_toRustDefaultAbilityPolicyOverrides(
  creature: CreatureRuntime,
): RustAbilityPolicyOverrides | undefined {
  return toRustDefaultAbilityPolicyOverrides(creature);
}

function withBestBuildsDefaultAbilityPolicyOverrides(
  config: RustComposableAbilityConfig,
  sourceCreature: CreatureRuntime,
  opponentCreature: CreatureRuntime,
): RustComposableAbilityConfig {
  const attackerAbilityPolicyOverrides = toRustDefaultAbilityPolicyOverrides(sourceCreature);
  const defenderAbilityPolicyOverrides = toRustDefaultAbilityPolicyOverrides(opponentCreature);
  if (!attackerAbilityPolicyOverrides && !defenderAbilityPolicyOverrides) return config;
  return {
    ...config,
    ...(attackerAbilityPolicyOverrides ? { attackerAbilityPolicyOverrides } : {}),
    ...(defenderAbilityPolicyOverrides ? { defenderAbilityPolicyOverrides } : {}),
  };
}

// ---------------------------------------------------------------------------
// Supported ability name sets
// ---------------------------------------------------------------------------

const COMPOSABLE_SUPPORTED_ACTIVATED_NAMES = new Set(
  [
    "Thorn Trap",
    "Frost Snare",
    "Aura (Disease)",
    "Aura (Corrosion)",
    "Aura (Burn)",
    "Cursed Sigil",
    "Fortify",
    "Drowsy Area",
    "Unbridled Rage",
    "Hunters Curse",
    "Life Leech",
    "Rewind",
    "Warden's Rage",
    "Adrenaline",
    "Lich Mark",
    "Spite",
    "Frost Nova",
    "Reflux",
    "Totem",
    "Reflect",
    "Cause Fear",
    "Grim Lariat",
    "Shadow Barrage",
    "Hunker",
    "Divination",
    "Poison Area",
    "Toxic Trap",
    "Yolk Bomb",
    "Harden",
    "Cocoon",
    "Expunge",
  ].map(normalizeAbilityName),
);

const COMPOSABLE_SUPPORTED_PASSIVE_NAMES = new Set(
  [
    "Wing Shredder",
    "Serrated Teeth",
    "First Strike",
    "Warden's Resistance",
    "Berserk",
    "Guilt",
    "Unbreakable",
    "Sticky Fur",
    "Self-Destruct",
    "Hunker",
    "Quick Recovery",
    "Stubborn Stacker",
    "Block Bleed",
    "Block Burn",
    "Block Disease",
    "Block Frostbite",
    "Block Injury",
    "Block Necropoison",
    "Block Poison",
    "Bleed Attack",
    "Burn Attack",
    "Corrosion Attack",
    "Disease Attack",
    "Frostbite Attack",
    "Injury Attack",
    "Necropoison Attack",
    "Poison Attack",
    "Defensive Bleed",
    "Defensive Burn",
    "Defensive Corrosion",
    "Defensive Disease",
    "Defensive Frostbite",
    "Defensive Injury",
    "Defensive Necropoison",
    "Defensive Paralyze",
    "Defensive Poison",
    "Ligament Tear",
  ].map(normalizeAbilityName),
);

const CONTOUR_NO_EFFECT_PASSIVE_NAMES = new Set(
  [
    "Breath Resistance",
    // Season/environment-only passives with zero stand-and-fight combat effect:
    "Volcanic",
    "Frosty",
    // Trails: Compare-only toggle (disabled by default in BB path), so zero
    // effect for BB Rust eligibility. TS models them when compareTrailsEnabled.
    "Toxic Trail",
    "Plague Trail",
    "Flame Trail",
    "Frost Trail",
    "Healing Step",
    // Audio/stealth-only passive, no combat math:
    "Silent Hunter",
    "Ambush",
    // Movement/charge passives with no facetank combat effect:
    "Charge Power",
    "Driver",
    // Adrenaline as passive (neutral semantics, no combat def — distinct from
    // the activated ability which IS modeled):
    "Adrenaline",
    // Generic block (dodge-type mechanic, not modeled in stand-and-fight):
    "Block",
    // Data typo variant seen on Tarakotu; same compare-only semantics.
  ].map(normalizeAbilityName),
);

const CONTOUR_TS_NO_OP_PASSIVE_NAMES = new Set(
  [
    // Channeling has a TS stub handler that does nothing and no Rust model yet.
    "Channeling",
    // Gourmandizer is compare-only for now (hunger rules parked by policy).
    "Gourmandizer",
  ].map(normalizeAbilityName),
);

const CONTOUR_PREBUILT_ACTIVATED_NAMES = new Set(
  ["Harden", "Two-Faced"].map(normalizeAbilityName),
);

const DEFAULT_ABILITY_FILTERS = DEFAULT_PASSIVE_CONTOUR_ABILITY_FILTERS;

const LICH_MARK_ABILITY_NAME = normalizeAbilityName("Lich Mark");

// ---------------------------------------------------------------------------
// Ability shaping / filtering helpers
// ---------------------------------------------------------------------------

function isApproximationOnlyLichMarkCarrier(creature: CreatureRuntime, abilityName: string): boolean {
  return (
    normalizeAbilityName(abilityName) === LICH_MARK_ABILITY_NAME &&
    !isModeledOtherAbility(abilityName, creature.name)
  );
}

function isActivatedDataSurfaceShapingOutlier(creature: CreatureRuntime, abilityName: string): boolean {
  const normalized = normalizeAbilityName(abilityName);
  return normalized === normalizeAbilityName("First Strike") || isApproximationOnlyLichMarkCarrier(creature, abilityName);
}

function isSharedSpecialEventActivatedShapingOutlier(abilityName: string): boolean {
  return /^Aura \([^)]+\)$/.test(abilityName.trim());
}

function filterComposableShapingOutliers(creature: CreatureRuntime, names: string[]): string[] {
  return names.filter((name) => {
    if (isActivatedDataSurfaceShapingOutlier(creature, name)) return false;
    return !isSharedSpecialEventActivatedShapingOutlier(name);
  });
}

const EMPTY_DISABLED: ReadonlySet<string> = new Set<string>();

function isAbilityDisabled(disabled: ReadonlySet<string>, name: string): boolean {
  return disabled.has(normalizeAbilityName(name));
}

function hasActivatedAbilityNamed(
  creature: CreatureRuntime,
  abilityName: string,
  disabled: ReadonlySet<string> = EMPTY_DISABLED,
): boolean {
  const normalized = normalizeAbilityName(abilityName);
  if (disabled.has(normalized)) return false;
  return (
    (creature.activatedAbilities ?? []).some((ability) => normalizeAbilityName(ability.name) === normalized) ||
    hasAbilityName(effectsCatalog[creature.name] ?? {}, abilityName)
  );
}

// Extracts the X from "Aura (X)" on a creature's activated list, or null.
// Adding a new subtype on the Rust side is enough to extend coverage —
// the bridge does not need to know which subtypes exist.
function getActivatedAuraSubtype(creature: CreatureRuntime): string | null {
  for (const ability of creature.activatedAbilities ?? []) {
    const match = ability.name?.trim().match(/^Aura \(([^)]+)\)$/);
    if (match) return match[1].trim();
  }
  const effects = effectsCatalog[creature.name] ?? {};
  for (const ability of [
    ...(effects.otherAbilities ?? []),
    ...(effects.specialAbilities ?? []),
    ...(effects.specialAbilitiesDetailed ?? []),
  ]) {
    const match = ability.name?.trim().match(/^Aura \(([^)]+)\)$/);
    if (match) return match[1].trim();
  }
  return null;
}

// Pure functions of `creature` — result is stable for the session. BB's
// eligibility check hits these 4× per matchup × 170K matchups, all just to
// read `.length`. WeakMap cache collapses that to 1× per creature.
const unsupportedActivatedForComposableCache = new WeakMap<CreatureRuntime, string[]>();
const unsupportedPassiveForBreathCache = new WeakMap<CreatureRuntime, string[]>();

export function getRustUnsupportedActivatedAbilityNamesForComposable(creature: CreatureRuntime): string[] {
  const cached = unsupportedActivatedForComposableCache.get(creature);
  if (cached) return cached;
  const computed = filterComposableShapingOutliers(
    creature,
    getRustUnsupportedActivatedAbilityNames(
      creature,
      COMPOSABLE_SUPPORTED_ACTIVATED_NAMES,
      CONTOUR_TS_NO_OP_ACTIVATED_NAMES,
      CONTOUR_PREBUILT_ACTIVATED_NAMES,
      DEFAULT_ABILITY_FILTERS,
    ),
  );
  unsupportedActivatedForComposableCache.set(creature, computed);
  return computed;
}

// ---------------------------------------------------------------------------
// Exported shared helpers (used by pages + engine.specials tests)
// ---------------------------------------------------------------------------

export function getRustUnsupportedPassiveAbilityNamesForBreath(creature: CreatureRuntime): string[] {
  const cached = unsupportedPassiveForBreathCache.get(creature);
  if (cached) return cached;
  const computed = getRustUnsupportedPassiveAbilityNames(
    creature,
    COMPOSABLE_SUPPORTED_PASSIVE_NAMES,
    CONTOUR_NO_EFFECT_PASSIVE_NAMES,
    CONTOUR_TS_NO_OP_PASSIVE_NAMES,
    DEFAULT_ABILITY_FILTERS,
  );
  unsupportedPassiveForBreathCache.set(creature, computed);
  return computed;
}

export function getRustBlockingActivatedAbilityNamesForPassiveContours(
  creature: CreatureRuntime,
): string[] {
  return filterComposableShapingOutliers(
    creature,
    getBlockingActivatedAbilityNames(
      creature,
      CONTOUR_TS_NO_OP_ACTIVATED_NAMES,
      CONTOUR_PREBUILT_ACTIVATED_NAMES,
      DEFAULT_ABILITY_FILTERS,
    ),
  );
}

// ---------------------------------------------------------------------------
// Stats marshallers
// ---------------------------------------------------------------------------

const rustSimpleStatsCache = new WeakMap<FinalStats, WeakMap<CreatureRuntime, RustSimpleCombatantStats>>();
const rustStatusMeleeStatsCache = new WeakMap<FinalStats, WeakMap<CreatureRuntime, RustSimpleCombatantStats>>();
const rustBreathProfileCache = new WeakMap<FinalStats, RustSimpleBreathProfile | null>();
const rustComposableAbilityConfigCache = new WeakMap<
  CreatureRuntime,
  WeakMap<CreatureRuntime, RustComposableAbilityConfig>
>();

function getDamageTakenMultiplierOnBeingBitten(
  creature: CreatureRuntime,
  disabled: ReadonlySet<string> = EMPTY_DISABLED,
): number {
  const effects = effectsCatalog[creature.name] ?? {};
  const allAbilities = [
    ...(effects.specialAbilitiesDetailed ?? []),
    ...(effects.specialAbilities ?? []),
    ...(effects.otherAbilities ?? []),
  ].filter((ability) => !isAbilityDisabled(disabled, ability.name));
  let multiplier = 1;

  // Ligament Tear: conditionalDamageMultiplier with when=onBeingBitten
  const ligamentTear = allAbilities.find((ability) => ability.name === "Ligament Tear");
  const ligamentDef =
    ligamentTear && "def" in ligamentTear && ligamentTear.def?.type === "conditionalDamageMultiplier"
      ? (ligamentTear.def as {
          type: "conditionalDamageMultiplier";
          when?: string;
          multiplier: number;
        })
      : undefined;
  if (ligamentDef?.when === "onBeingBitten" && typeof ligamentDef.multiplier === "number" && Number.isFinite(ligamentDef.multiplier)) {
    multiplier *= ligamentDef.multiplier;
  }

  // Guilt: damageTakenMultiplier with when=onBeingBitten
  const guilt = allAbilities.find((ability) => ability.name === "Guilt");
  const guiltDef =
    guilt && "def" in guilt && guilt.def?.type === "damageTakenMultiplier"
      ? (guilt.def as {
          type: "damageTakenMultiplier";
          when?: string;
          multiplier: number;
        })
      : undefined;
  if (guiltDef && typeof guiltDef.multiplier === "number" && Number.isFinite(guiltDef.multiplier)) {
    multiplier *= guiltDef.multiplier;
  }

  return multiplier;
}

function getImmuneStatusIds(
  creature: CreatureRuntime,
  disabled: ReadonlySet<string> = EMPTY_DISABLED,
): string[] {
  // Unbreakable is no longer a status immunity; Rust models it as a per-hit
  // damage cap through unbreakableDamageCapPct.
  const effects = effectsCatalog[creature.name] ?? {};
  const entry = [
    ...(effects.specialAbilitiesDetailed ?? []),
    ...(effects.specialAbilities ?? []),
    ...(effects.otherAbilities ?? []),
  ].find(
    (ability) =>
      ability.name !== "Unbreakable" &&
      !isAbilityDisabled(disabled, ability.name) &&
      "def" in ability &&
      ability.def?.type === "statusImmunity",
  );
  const def =
    entry && "def" in entry && entry.def?.type === "statusImmunity"
      ? (entry.def as {
          type: "statusImmunity";
          immuneTo?: string[];
        })
      : undefined;
  return Array.isArray(def?.immuneTo) ? def.immuneTo : [];
}

function getUnbreakableDamageCapPct(
  creature: CreatureRuntime,
  disabled: ReadonlySet<string> = EMPTY_DISABLED,
): number {
  if (isAbilityDisabled(disabled, "Unbreakable")) return 0;
  const passive = (creature.passiveAbilities ?? []).find(
    (ability) => normalizeAbilityName(ability.name) === normalizeAbilityName("Unbreakable"),
  );
  if (typeof passive?.value === "number" && Number.isFinite(passive.value)) return passive.value;
  const effects = effectsCatalog[creature.name] ?? {};
  const entry = [
    ...(effects.specialAbilitiesDetailed ?? []),
    ...(effects.specialAbilities ?? []),
    ...(effects.otherAbilities ?? []),
  ].find((ability) => ability.name === "Unbreakable");
  return typeof entry?.value === "number" && Number.isFinite(entry.value) ? entry.value : 0;
}

function getFirstStrikeData(
  creature: CreatureRuntime,
  disabled: ReadonlySet<string> = EMPTY_DISABLED,
): { pct: number; hpRatioThreshold: number } {
  if (isAbilityDisabled(disabled, "First Strike")) {
    return { pct: 0, hpRatioThreshold: 1 };
  }
  const effects = effectsCatalog[creature.name] ?? {};
  const entry = [
    ...(effects.specialAbilitiesDetailed ?? []),
    ...(effects.specialAbilities ?? []),
    ...(effects.otherAbilities ?? []),
  ].find((ability) => ability.name === "First Strike");
  const pct = typeof entry?.value === "number" ? entry.value : 0;
  const def = entry && "def" in entry ? entry.def : undefined;
  const conditionalDef =
    def?.type === "conditionalDamageBoost"
      ? (def as { type: "conditionalDamageBoost"; trigger: { hpRatioGte?: number } })
      : undefined;
  const hpRatioThreshold = conditionalDef?.trigger.hpRatioGte ?? 1;
  return { pct, hpRatioThreshold };
}

function getBerserkData(
  creature: CreatureRuntime,
  disabled: ReadonlySet<string> = EMPTY_DISABLED,
): { biteCooldownMultiplier: number; hpRatioThreshold: number } {
  if (isAbilityDisabled(disabled, "Berserk")) {
    return { biteCooldownMultiplier: 1, hpRatioThreshold: 0 };
  }
  const effects = effectsCatalog[creature.name] ?? {};
  const entry = [
    ...(effects.specialAbilitiesDetailed ?? []),
    ...(effects.specialAbilities ?? []),
    ...(effects.otherAbilities ?? []),
  ].find((ability) => ability.name === "Berserk");
  const def =
    entry && "def" in entry && entry.def?.type === "conditionalMultiStat"
      ? (entry.def as {
          type: "conditionalMultiStat";
          trigger: { hpRatioLt?: number; hpRatioLte?: number };
          mods?: { biteCooldownMultiplier?: number };
        })
      : undefined;
  return {
    biteCooldownMultiplier: def?.mods?.biteCooldownMultiplier ?? 1,
    hpRatioThreshold: def?.trigger.hpRatioLt ?? def?.trigger.hpRatioLte ?? 0,
  };
}

function getQuickRecoveryHpRatioThreshold(
  creature: CreatureRuntime,
  disabled: ReadonlySet<string> = EMPTY_DISABLED,
): number {
  if (isAbilityDisabled(disabled, "Quick Recovery")) return 0;
  const effects = effectsCatalog[creature.name] ?? {};
  const entry = [
    ...(effects.specialAbilitiesDetailed ?? []),
    ...(effects.specialAbilities ?? []),
    ...(effects.otherAbilities ?? []),
  ].find((ability) => ability.name === "Quick Recovery");
  const def =
    entry && "def" in entry && entry.def?.type === "conditionalHpRegenBoost"
      ? (entry.def as {
          type: "conditionalHpRegenBoost";
          trigger: { hpRatioLte?: number; hpRatioLt?: number };
        })
      : undefined;
  return def?.trigger.hpRatioLte ?? def?.trigger.hpRatioLt ?? 0;
}

function getHunkerReductionPct(
  creature: CreatureRuntime,
  disabled: ReadonlySet<string> = EMPTY_DISABLED,
): number {
  if (isAbilityDisabled(disabled, "Hunker")) return 0;
  const hunker = (creature.passiveAbilities ?? []).find(
    (ability) => normalizeAbilityName(ability.name) === normalizeAbilityName("Hunker"),
  );
  const value = hunker?.value;
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return value <= 1 ? value * 100 : value;
}

function getSelfDestructProfile(
  creature: CreatureRuntime,
  disabled: ReadonlySet<string> = EMPTY_DISABLED,
  activesOn: boolean = true,
) {
  // Mirror TS selfDestructRuntime.ts gate: `if (!activesOn) return;`.
  // Rust Phase 7 has no activesOn check, so the mapper must zero the profile.
  if (!activesOn) return null;
  if (isAbilityDisabled(disabled, "Self-Destruct")) return null;
  const effects = effectsCatalog[creature.name] ?? {};
  const entry = [
    ...(effects.specialAbilitiesDetailed ?? []),
    ...(effects.specialAbilities ?? []),
    ...(effects.otherAbilities ?? []),
  ].find((ability) => ability.name === "Self-Destruct");
  const def =
    entry && "def" in entry && entry.def?.type === "conditionalDelayedExplosion"
      ? (entry.def as {
          type: "conditionalDelayedExplosion";
          trigger: { hpRatioLte?: number; hpRatioLt?: number };
          cooldownSec: number;
          onExplode: { dealDamage: { pct: number }; applyStatus?: Array<{ statusId: string; stacks: number }> };
          selfAfterExplode: { hpFloorPct: number };
        })
      : undefined;
  if (!def) return null;
  return {
    triggerHpRatioLte: def.trigger.hpRatioLte ?? def.trigger.hpRatioLt ?? 0,
    damagePct: def.onExplode.dealDamage.pct,
    selfHpFloorPct: def.selfAfterExplode.hpFloorPct,
    cooldownSec: def.cooldownSec ?? 300,
    armingStacks: 3,
    applyStatuses: (def.onExplode.applyStatus ?? []).map((status) => ({
      statusId: status.statusId,
      stacks: status.stacks,
    })),
  };
}

function getExplicitOnHitTakenStatuses(
  creature: CreatureRuntime,
  disabled: ReadonlySet<string> = EMPTY_DISABLED,
): Array<{ statusId: string; stacks: number; sourceAbility: string }> {
  if (isAbilityDisabled(disabled, "Sticky Fur")) return [];
  return (creature.passiveAbilities ?? [])
    .filter((ability) => ability.name === "Sticky Fur")
    .map(() => ({
      statusId: "Sticky_Teeth_Status",
      stacks: 1,
      sourceAbility: "Sticky Fur",
    }));
}

function isSupportedRustBreathName(name: string | null): boolean {
  if (!name || name === "N/A") return true;
  if (name === "Heal Breath" || name === "Cloud Breath" || name === "Spirit Glare") return true;
  // These breath names have no breath spec. TS also no-ops them because they
  // have no capacity, so Rust treats them as no-breath: toRustBreathProfile returns null,
  // and the composable dispatcher runs a melee-equivalent fight.
  if (name === "Silly Beam" || name === "Plasma Beam") return true;
  if (/^Lance/i.test(name)) return true;
  return name in breathSpecByName;
}

function getRustBreathSpecialStatuses(raw: string | undefined): Array<{ statusId: string; stacks: number }> {
  if (!raw) return [];
  return parseBreathAilments(raw)
    .map((ailment) => {
      const statusId = resolveStatusId(ailment.name);
      if (!statusId) return null;
      const stacks = (ailment.probability / 100) * (ailment.stacks ?? 1);
      if (!(stacks > 0)) return null;
      return { statusId, stacks };
    })
    .filter((entry): entry is { statusId: string; stacks: number } => entry !== null);
}

export function toRustBreathProfile(finalStats: FinalStats): RustSimpleBreathProfile | null {
  if (rustBreathProfileCache.has(finalStats)) {
    return rustBreathProfileCache.get(finalStats) ?? null;
  }

  // Phase 7 / G7: a user-authored custom breath profile takes precedence
  // over the breath-type-name lookup. Build buffs (breathDamagePct /
  // breathRegenPct from traits / plushies / elder) still apply on top, the
  // same transforms the standard spec path uses, so a custom breath scales
  // with the creature's build like a built-in one.
  const custom = finalStats.customBreathProfile;
  if (custom) {
    const baseRegen = custom.regenRate ?? 0;
    const profile: RustSimpleBreathProfile = {
      ...custom,
      dpsPct: (custom.dpsPct ?? 0) * (1 + (finalStats.breathDamagePct ?? 0) / 100),
      regenRate:
        baseRegen > 0
          ? Math.max(0.5, baseRegen / (1 + (finalStats.breathRegenPct ?? 0) / 100))
          : baseRegen,
    };
    rustBreathProfileCache.set(finalStats, profile);
    return profile;
  }

  const name = finalStats.breathType;
  if (!name || name === "N/A") {
    rustBreathProfileCache.set(finalStats, null);
    return null;
  }

  // Plasma Beam runs entirely on hand-authored constants — there is no
  // wiki spec for it yet (the in-game effect was reverse-engineered from
  // damage tests). Resolve the profile before the spec lookup so adding
  // a Plasma_Beam entry to `breath_specs.runtime.json` later (or having
  // the wiki scraper overwrite our manual one) doesn't accidentally
  // hijack the discrete-charge behaviour.
  if (name === "Plasma Beam") {
    const profile: RustSimpleBreathProfile = {
      dpsPct: 2.0,
      capacity: 1.5,
      regenRate: 0,
      critChancePct: 50,
      chain: 0,
      chainMaxStacks: 0,
      specialKind: "plasma_beam",
      selfHealPct: 0,
      cleanseStacks: 0,
      lanceDamagePct: 0,
      lanceChargeSec: 0,
      lanceCooldownSec: 0,
      lanceStatusId: null,
      autoFireDelaySec: 1,
      autoFireCooldownSec: 0,
      chargesMax: 3,
      chargeRegenSec: 40,
      specialStatuses: [],
    };
    rustBreathProfileCache.set(finalStats, profile);
    return profile;
  }

  const spec = breathSpecByName[name];
  if (!spec && /^Lance/i.test(name)) {
    const lanceStatusId =
      /Burn/i.test(name) ? "Burn_Status" : /Frostbite/i.test(name) ? "Frostbite_Status" : null;
    const profile: RustSimpleBreathProfile = {
      dpsPct: 0,
      capacity: 0,
      regenRate: 0,
      critChancePct: 0,
      chain: 0,
      chainMaxStacks: 0,
      specialKind: "lance" as const,
      selfHealPct: 0,
      cleanseStacks: 0,
      lanceDamagePct: 5,
      lanceChargeSec: 3,
      lanceCooldownSec: 60,
      lanceStatusId,
      autoFireDelaySec: 0,
      autoFireCooldownSec: 0,
      specialStatuses: [],
    };
    rustBreathProfileCache.set(finalStats, profile);
    return profile;
  }
  if (!spec) {
    rustBreathProfileCache.set(finalStats, null);
    return null;
  }
  const parsedSpecialStatuses = getRustBreathSpecialStatuses(spec.raw);
  if (name === "Solar Beam" || name === "Spirit Glare" || name === "Heliolyth's Judgement") {
    const isSolarBeam = name === "Solar Beam";
    const isHeliolythJudgement = name === "Heliolyth's Judgement";
    const breathDamageBoost = 1 + (finalStats.breathDamagePct ?? 0) / 100;
    const profile: RustSimpleBreathProfile = {
      dpsPct: (spec.effect?.dps ?? 5) * breathDamageBoost,
      capacity: spec.stats?.capacity ?? 10,
      regenRate: spec.stats?.regenRate ?? 0,
      critChancePct: spec.stats?.critChancePct ?? 0,
      chain: spec.stats?.chain ?? 0,
      chainMaxStacks: spec.stats?.chainMaxStacks ?? 0,
      specialKind: isHeliolythJudgement ? "heliolyth_judgement" : isSolarBeam ? "solar_beam" : "spirit_glare",
      selfHealPct: 0,
      cleanseStacks: 0,
      lanceDamagePct: 0,
      lanceChargeSec: 0,
      lanceCooldownSec: 0,
      lanceStatusId: null,
      autoFireDelaySec: isSolarBeam || isHeliolythJudgement ? 3 : 0,
      autoFireCooldownSec: 120,
      specialStatuses: isSolarBeam || isHeliolythJudgement
        ? parsedSpecialStatuses
        : [
            { statusId: "Burn_Status", stacks: 1 },
            { statusId: "Fear_Status", stacks: 1 },
            ...parsedSpecialStatuses.filter(
              (entry) => entry.statusId !== "Burn_Status" && entry.statusId !== "Fear_Status",
            ),
          ],
    };
    rustBreathProfileCache.set(finalStats, profile);
    return profile;
  }
  const supportBreath =
    name === "Heal Breath"
      ? { specialKind: "heal" as const, selfHealPct: 3, cleanseStacks: 0.5 }
      : name === "Miasma Breath"
      ? { specialKind: "miasma" as const, selfHealPct: 0.5, cleanseStacks: 0 }
      : name === "Energy Breath"
      ? { specialKind: "energy" as const, selfHealPct: 0, cleanseStacks: 0 }
      : name === "Cloud Breath"
      ? { specialKind: "cloud" as const, selfHealPct: 0.5, cleanseStacks: 0 }
      : { specialKind: null, selfHealPct: 0, cleanseStacks: 0 };
  const baseDps = spec.effect?.dps ?? 0;
  const baseRegenRate = spec.stats?.regenRate ?? 0;
  const profile: RustSimpleBreathProfile = {
    dpsPct: baseDps * (1 + (finalStats.breathDamagePct ?? 0) / 100),
    capacity: spec.stats?.capacity ?? 0,
    regenRate: baseRegenRate > 0
      ? Math.max(0.5, baseRegenRate / (1 + (finalStats.breathRegenPct ?? 0) / 100))
      : baseRegenRate,
    critChancePct: spec.stats?.critChancePct ?? 0,
    chain: spec.stats?.chain ?? 0,
    chainMaxStacks: spec.stats?.chainMaxStacks ?? 0,
    specialKind: supportBreath.specialKind,
    selfHealPct: supportBreath.selfHealPct,
    cleanseStacks: supportBreath.cleanseStacks,
    lanceDamagePct: 0,
    lanceChargeSec: 0,
    lanceCooldownSec: 0,
    lanceStatusId: null,
    autoFireDelaySec: 0,
    autoFireCooldownSec: 0,
    specialStatuses: parsedSpecialStatuses,
  };
  rustBreathProfileCache.set(finalStats, profile);
  return profile;
}

/**
 * Construct a `RustSimpleBreathProfile` from JUST the breath name —
 * no `FinalStats` needed. Mirrors `toRustBreathProfile`'s
 * name-based branches (Plasma Beam, Lance, Solar Beam, Spirit Glare,
 * Heliolyth's Judgement, Heal Breath, Miasma Breath, Energy Breath,
 * Cloud Breath, every wiki-spec breath) but assumes no breath-damage
 * / breath-regen modifiers (factor 1.0). Sandbox uses this to build
 * a profile when the user picks a breath from the override dropdown.
 *
 * `breathDamagePct` / `breathRegenPct` default to 0 (no boost). Pass
 * non-zero values if the Sandbox UI later exposes those modifiers.
 */
export function buildBreathProfileByName(
  name: string,
  breathDamagePct: number = 0,
  breathRegenPct: number = 0,
): RustSimpleBreathProfile | null {
  if (!name || name === "N/A") return null;

  if (name === "Plasma Beam") {
    return {
      dpsPct: 2.0,
      capacity: 1.5,
      regenRate: 0,
      critChancePct: 50,
      chain: 0,
      chainMaxStacks: 0,
      specialKind: "plasma_beam",
      selfHealPct: 0,
      cleanseStacks: 0,
      lanceDamagePct: 0,
      lanceChargeSec: 0,
      lanceCooldownSec: 0,
      lanceStatusId: null,
      autoFireDelaySec: 1,
      autoFireCooldownSec: 0,
      chargesMax: 3,
      chargeRegenSec: 40,
      specialStatuses: [],
    };
  }

  const spec = breathSpecByName[name];
  if (!spec && /^Lance/i.test(name)) {
    const lanceStatusId =
      /Burn/i.test(name) ? "Burn_Status" : /Frostbite/i.test(name) ? "Frostbite_Status" : null;
    return {
      dpsPct: 0,
      capacity: 0,
      regenRate: 0,
      critChancePct: 0,
      chain: 0,
      chainMaxStacks: 0,
      specialKind: "lance" as const,
      selfHealPct: 0,
      cleanseStacks: 0,
      lanceDamagePct: 5,
      lanceChargeSec: 3,
      lanceCooldownSec: 60,
      lanceStatusId,
      autoFireDelaySec: 0,
      autoFireCooldownSec: 0,
      specialStatuses: [],
    };
  }
  if (!spec) return null;

  const parsedSpecialStatuses = getRustBreathSpecialStatuses(spec.raw);
  const breathDamageBoost = 1 + breathDamagePct / 100;

  if (name === "Solar Beam" || name === "Spirit Glare" || name === "Heliolyth's Judgement") {
    const isSolarBeam = name === "Solar Beam";
    const isHeliolythJudgement = name === "Heliolyth's Judgement";
    return {
      dpsPct: (spec.effect?.dps ?? 5) * breathDamageBoost,
      capacity: spec.stats?.capacity ?? 10,
      regenRate: spec.stats?.regenRate ?? 0,
      critChancePct: spec.stats?.critChancePct ?? 0,
      chain: spec.stats?.chain ?? 0,
      chainMaxStacks: spec.stats?.chainMaxStacks ?? 0,
      specialKind: isHeliolythJudgement ? "heliolyth_judgement" : isSolarBeam ? "solar_beam" : "spirit_glare",
      selfHealPct: 0,
      cleanseStacks: 0,
      lanceDamagePct: 0,
      lanceChargeSec: 0,
      lanceCooldownSec: 0,
      lanceStatusId: null,
      autoFireDelaySec: isSolarBeam || isHeliolythJudgement ? 3 : 0,
      autoFireCooldownSec: 120,
      specialStatuses: isSolarBeam || isHeliolythJudgement
        ? parsedSpecialStatuses
        : [
            { statusId: "Burn_Status", stacks: 1 },
            { statusId: "Fear_Status", stacks: 1 },
            ...parsedSpecialStatuses.filter(
              (entry) => entry.statusId !== "Burn_Status" && entry.statusId !== "Fear_Status",
            ),
          ],
    };
  }

  const supportBreath =
    name === "Heal Breath"
      ? { specialKind: "heal" as const, selfHealPct: 3, cleanseStacks: 0.5 }
      : name === "Miasma Breath"
      ? { specialKind: "miasma" as const, selfHealPct: 0.5, cleanseStacks: 0 }
      : name === "Energy Breath"
      ? { specialKind: "energy" as const, selfHealPct: 0, cleanseStacks: 0 }
      : name === "Cloud Breath"
      ? { specialKind: "cloud" as const, selfHealPct: 0.5, cleanseStacks: 0 }
      : { specialKind: null, selfHealPct: 0, cleanseStacks: 0 };
  const baseDps = spec.effect?.dps ?? 0;
  const baseRegenRate = spec.stats?.regenRate ?? 0;
  return {
    dpsPct: baseDps * breathDamageBoost,
    capacity: spec.stats?.capacity ?? 0,
    regenRate: baseRegenRate > 0
      ? Math.max(0.5, baseRegenRate / (1 + breathRegenPct / 100))
      : baseRegenRate,
    critChancePct: spec.stats?.critChancePct ?? 0,
    chain: spec.stats?.chain ?? 0,
    chainMaxStacks: spec.stats?.chainMaxStacks ?? 0,
    specialKind: supportBreath.specialKind,
    selfHealPct: supportBreath.selfHealPct,
    cleanseStacks: supportBreath.cleanseStacks,
    lanceDamagePct: 0,
    lanceChargeSec: 0,
    lanceCooldownSec: 0,
    lanceStatusId: null,
    autoFireDelaySec: 0,
    autoFireCooldownSec: 0,
    specialStatuses: parsedSpecialStatuses,
  };
}

/**
 * Canonical list of breath / beam ability names the Sandbox UI can
 * pick. Combines the wiki-spec catalog (`breath_specs.runtime.json`)
 * with the hand-authored special breaths (Plasma Beam, Solar Beam,
 * Spirit Glare, Heliolyth's Judgement) that don't have a wiki entry
 * yet. Sorted alphabetically for the dropdown.
 */
export function listAvailableBreathNames(): string[] {
  const fromCatalog = Object.keys(breathSpecByName);
  const hardcoded = ["Plasma Beam", "Solar Beam", "Spirit Glare", "Heliolyth's Judgement"];
  const all = new Set<string>([...fromCatalog, ...hardcoded]);
  return [...all].sort((a, b) => a.localeCompare(b));
}

function toRustSimpleStats(
  creature: CreatureRuntime,
  finalStats: FinalStats,
  disabled: ReadonlySet<string> = EMPTY_DISABLED,
  activesOn: boolean = true,
): RustSimpleCombatantStats {
  const useCache = disabled.size === 0 && activesOn;
  if (useCache) {
    let cacheByCreature = rustSimpleStatsCache.get(finalStats);
    if (!cacheByCreature) {
      cacheByCreature = new WeakMap<CreatureRuntime, RustSimpleCombatantStats>();
      rustSimpleStatsCache.set(finalStats, cacheByCreature);
    }
    const cached = cacheByCreature.get(creature);
    if (cached) return cached;
  }

  const stats = {
    health: finalStats.health,
    weight: finalStats.weight,
    damage: finalStats.damage,
    biteCooldown: finalStats.biteCooldown,
    // Wiki-sourced secondary-attack damage. Forwarded unconditionally so
    // the Rust BiteVariant policy (P3) can read it per-bite when dynamic
    // mode is on. Defaults to 0 when the creature has no secondary attack;
    // the policy treats `damage2 <= 0` as "primary-only-eligible".
    damage2: typeof finalStats.damage2 === "number" ? finalStats.damage2 : 0,
    healthRegen: finalStats.healthRegen ?? 0,
    activeCooldownMultiplier: finalStats.activeCooldownMultiplier ?? 1,
    unbreakableDamageCapPct: getUnbreakableDamageCapPct(creature, disabled),
    damageTakenMultiplierOnBeingBitten: getDamageTakenMultiplierOnBeingBitten(creature, disabled),
    breathResistance: 0,
    hasReflect: hasActivatedAbilityNamed(creature, "Reflect", disabled),
    immuneStatusIds: [],
    // Phase 5 / G8: read-only creature identity for the decision-DSL
    // is_type / is_diet / is_elder / tier read-vars. Sourced from
    // FinalStats; empty/0 when unknown (Rust reads resolve to 0/false).
    // Pure function of finalStats, so it rides the existing cache safely.
    identity: {
      type: finalStats.type ?? "",
      diet: finalStats.diet ?? "",
      elder: finalStats.elder ?? "",
      tier: finalStats.tier ?? 0,
    },
  };
  if (useCache) {
    rustSimpleStatsCache.get(finalStats)!.set(creature, stats);
  }
  return stats;
}

export function toRustStatusMeleeStats(
  creature: CreatureRuntime,
  finalStats: FinalStats,
  disabled: ReadonlySet<string> = EMPTY_DISABLED,
  activesOn: boolean = true,
): RustSimpleCombatantStats {
  const useCache = disabled.size === 0 && activesOn;
  if (useCache) {
    const byCreature = rustStatusMeleeStatsCache.get(finalStats);
    const cached = byCreature?.get(creature);
    if (cached) return cached;
  }

  const effects = effectsCatalog[creature.name] ?? {};
  const firstStrike = getFirstStrikeData(creature, disabled);
  const berserk = getBerserkData(creature, disabled);
  const breathResistanceAbility = !isAbilityDisabled(disabled, "Breath Resistance")
    ? creature.passiveAbilities?.find((ability) => ability.name === "Breath Resistance")
    : undefined;
  const hasWardenResistance =
    !isAbilityDisabled(disabled, "Warden's Resistance") &&
    (creature.passiveAbilities ?? []).some((ability) => ability.name === "Warden's Resistance");

  const filterBySource = <T extends { sourceAbility?: string | null }>(list: T[]): T[] =>
    list.filter((entry) => {
      const src = entry.sourceAbility;
      return !src || !isAbilityDisabled(disabled, src);
    });

  const computed: RustSimpleCombatantStats = {
    ...toRustSimpleStats(creature, finalStats, disabled, activesOn),
    quickRecoveryHpRatioThreshold: getQuickRecoveryHpRatioThreshold(creature, disabled),
    berserkBiteCooldownMultiplier: berserk.biteCooldownMultiplier,
    berserkHpRatioThreshold: berserk.hpRatioThreshold,
    firstStrikePct: firstStrike.pct,
    firstStrikeHpRatioThreshold: firstStrike.hpRatioThreshold,
    hasWardenResistance,
    breathResistance: typeof breathResistanceAbility?.value === "number" ? breathResistanceAbility.value : 0,
    immuneStatusIds: getImmuneStatusIds(creature, disabled),
    hunkerReductionPct: getHunkerReductionPct(creature, disabled),
    selfDestructProfile: getSelfDestructProfile(creature, disabled, activesOn),
    onHitStatuses: [
      ...filterBySource(
        (effects.applyStatusOnHit ?? []).map((status) => ({
          statusId: status.statusId,
          stacks: status.stacks,
          sourceAbility: status.sourceAbility,
        })),
      ),
      ...getExplicitOnHitStatuses(creature).filter(
        (entry) => !isAbilityDisabled(disabled, entry.sourceAbility),
      ),
      ...Object.entries(finalStats.plushieStatusOnHit ?? {}).map(([statusId, stacks]) => ({
        statusId,
        stacks,
      })),
    ],
    onHitTakenStatuses: [
      ...filterBySource(
        (effects.applyStatusOnHitTaken ?? []).map((status) => ({
          statusId: status.statusId,
          stacks: status.stacks,
          sourceAbility: status.sourceAbility,
        })),
      ),
      ...getExplicitOnHitTakenStatuses(creature, disabled),
      ...Object.entries(finalStats.plushieStatusOnHitTaken ?? {}).map(([statusId, stacks]) => ({
        statusId,
        stacks,
      })),
    ],
    statusResistFractions: Object.fromEntries(
      (effects.resistStatus ?? [])
        .filter((entry) => !isAbilityDisabled(disabled, entry.sourceAbility))
        .map((entry) => [entry.statusId, entry.fraction]),
    ),
    // Combined status-block fractions: per-plushie per-status blocks PLUS the
    // elder all-ailment block (Gentle's +10% Ailment Block), summed and
    // clamped per status. The elder block spreads across every known ailment;
    // a plushie block stacks additively on top for its specific status. Both
    // ride the engine's `plushie_status_block_fractions` channel.
    plushieStatusBlockFractions: buildCombinedRustStatusBlockFractions(finalStats),
    plushieReflectAvgPct: finalStats.plushieReflectAvgPct ?? 0,
    userAbilityIds:
      creature.userAbilityIds && creature.userAbilityIds.length > 0
        ? [...creature.userAbilityIds]
        : undefined,
  };

  if (useCache) {
    const cacheForFinal =
      rustStatusMeleeStatsCache.get(finalStats) ?? new WeakMap<CreatureRuntime, RustSimpleCombatantStats>();
    cacheForFinal.set(creature, computed);
    rustStatusMeleeStatsCache.set(finalStats, cacheForFinal);
  }
  return computed;
}

export function __test_toRustStatusMeleeStats(
  creature: CreatureRuntime,
  finalStats: FinalStats,
): RustSimpleCombatantStats {
  return toRustStatusMeleeStats(creature, finalStats);
}

export function toRustComposableAbilityConfig(
  sourceCreature: CreatureRuntime,
  opponentCreature: CreatureRuntime,
): RustComposableAbilityConfig {
  const cachedByOpponent = rustComposableAbilityConfigCache.get(sourceCreature);
  const cached = cachedByOpponent?.get(opponentCreature);
  if (cached !== undefined) {
    return cached;
  }
  const sourceLifeLeechValue = resolveRuntimeAbilityValue(sourceCreature, "Life Leech");
  const opponentLifeLeechValue = resolveRuntimeAbilityValue(opponentCreature, "Life Leech");
  const sourceCursedSigilValue = resolveRuntimeAbilityValue(sourceCreature, "Cursed Sigil");
  const opponentCursedSigilValue = resolveRuntimeAbilityValue(opponentCreature, "Cursed Sigil");
  const sourceSpiteValue = resolveRuntimeAbilityValue(sourceCreature, "Spite");
  const opponentSpiteValue = resolveRuntimeAbilityValue(opponentCreature, "Spite");
  const sourceLichMarkValue = resolveRuntimeAbilityValue(sourceCreature, "Lich Mark");
  const opponentLichMarkValue = resolveRuntimeAbilityValue(opponentCreature, "Lich Mark");
  const sourceShadowBarrageValue = resolveRuntimeAbilityValue(sourceCreature, "Shadow Barrage");
  const opponentShadowBarrageValue = resolveRuntimeAbilityValue(opponentCreature, "Shadow Barrage");
  const sourceYolkBombValue = resolveRuntimeAbilityValue(sourceCreature, "Yolk Bomb");
  const opponentYolkBombValue = resolveRuntimeAbilityValue(opponentCreature, "Yolk Bomb");
  const computed: RustComposableAbilityConfig = {
    attackerThornTrap: hasActivatedAbilityNamed(sourceCreature, "Thorn Trap"),
    defenderThornTrap: hasActivatedAbilityNamed(opponentCreature, "Thorn Trap"),
    attackerToxicTrap: hasActivatedAbilityNamed(sourceCreature, "Toxic Trap"),
    defenderToxicTrap: hasActivatedAbilityNamed(opponentCreature, "Toxic Trap"),
    attackerFrostSnare: hasActivatedAbilityNamed(sourceCreature, "Frost Snare"),
    defenderFrostSnare: hasActivatedAbilityNamed(opponentCreature, "Frost Snare"),
    attackerPoisonArea: hasActivatedAbilityNamed(sourceCreature, "Poison Area"),
    defenderPoisonArea: hasActivatedAbilityNamed(opponentCreature, "Poison Area"),
    attackerYolkBomb: hasActivatedAbilityNamed(sourceCreature, "Yolk Bomb"),
    defenderYolkBomb: hasActivatedAbilityNamed(opponentCreature, "Yolk Bomb"),
    attackerYolkBombValue: typeof sourceYolkBombValue === "string" ? sourceYolkBombValue : null,
    defenderYolkBombValue: typeof opponentYolkBombValue === "string" ? opponentYolkBombValue : null,
    attackerAuraSubtype: getActivatedAuraSubtype(sourceCreature),
    defenderAuraSubtype: getActivatedAuraSubtype(opponentCreature),
    attackerCursedSigilStacks: typeof sourceCursedSigilValue === "number" ? sourceCursedSigilValue : 0,
    defenderCursedSigilStacks: typeof opponentCursedSigilValue === "number" ? opponentCursedSigilValue : 0,
    attackerFortify: hasActivatedAbilityNamed(sourceCreature, "Fortify"),
    defenderFortify: hasActivatedAbilityNamed(opponentCreature, "Fortify"),
    attackerDrowsyArea: hasActivatedAbilityNamed(sourceCreature, "Drowsy Area"),
    defenderDrowsyArea: hasActivatedAbilityNamed(opponentCreature, "Drowsy Area"),
    attackerUnbridledRage: hasActivatedAbilityNamed(sourceCreature, "Unbridled Rage"),
    defenderUnbridledRage: hasActivatedAbilityNamed(opponentCreature, "Unbridled Rage"),
    attackerHuntersCurse: hasActivatedAbilityNamed(sourceCreature, "Hunters Curse"),
    defenderHuntersCurse: hasActivatedAbilityNamed(opponentCreature, "Hunters Curse"),
    attackerLifeLeechValue: typeof sourceLifeLeechValue === "number" ? sourceLifeLeechValue : 0,
    defenderLifeLeechValue: typeof opponentLifeLeechValue === "number" ? opponentLifeLeechValue : 0,
    attackerRewind: hasActivatedAbilityNamed(sourceCreature, "Rewind"),
    defenderRewind: hasActivatedAbilityNamed(opponentCreature, "Rewind"),
    attackerWardenRage: hasActivatedAbilityNamed(sourceCreature, "Warden's Rage"),
    defenderWardenRage: hasActivatedAbilityNamed(opponentCreature, "Warden's Rage"),
    attackerAdrenaline: hasActivatedAbilityNamed(sourceCreature, "Adrenaline"),
    defenderAdrenaline: hasActivatedAbilityNamed(opponentCreature, "Adrenaline"),
    attackerLichMark: hasActivatedAbilityNamed(sourceCreature, "Lich Mark"),
    defenderLichMark: hasActivatedAbilityNamed(opponentCreature, "Lich Mark"),
    attackerLichMarkPayloadStatusId:
      typeof sourceLichMarkValue === "string"
        ? (resolveStatusId(sourceLichMarkValue) ?? `${sourceLichMarkValue.replace(/[^A-Za-z0-9]+/g, "_")}_Status`)
        : null,
    defenderLichMarkPayloadStatusId:
      typeof opponentLichMarkValue === "string"
        ? (resolveStatusId(opponentLichMarkValue) ?? `${opponentLichMarkValue.replace(/[^A-Za-z0-9]+/g, "_")}_Status`)
        : null,
    attackerSpiteValue: typeof sourceSpiteValue === "number" ? sourceSpiteValue : 0,
    defenderSpiteValue: typeof opponentSpiteValue === "number" ? opponentSpiteValue : 0,
    attackerFrostNova: hasActivatedAbilityNamed(sourceCreature, "Frost Nova"),
    defenderFrostNova: hasActivatedAbilityNamed(opponentCreature, "Frost Nova"),
    attackerReflux: hasActivatedAbilityNamed(sourceCreature, "Reflux"),
    defenderReflux: hasActivatedAbilityNamed(opponentCreature, "Reflux"),
    attackerTotem: hasActivatedAbilityNamed(sourceCreature, "Totem"),
    defenderTotem: hasActivatedAbilityNamed(opponentCreature, "Totem"),
    attackerReflect: hasActivatedAbilityNamed(sourceCreature, "Reflect"),
    defenderReflect: hasActivatedAbilityNamed(opponentCreature, "Reflect"),
    attackerCauseFear: hasActivatedAbilityNamed(sourceCreature, "Cause Fear"),
    defenderCauseFear: hasActivatedAbilityNamed(opponentCreature, "Cause Fear"),
    attackerGrimLariat: hasActivatedAbilityNamed(sourceCreature, "Grim Lariat"),
    defenderGrimLariat: hasActivatedAbilityNamed(opponentCreature, "Grim Lariat"),
    attackerShadowBarrageValue: typeof sourceShadowBarrageValue === "number" ? sourceShadowBarrageValue : 0,
    defenderShadowBarrageValue: typeof opponentShadowBarrageValue === "number" ? opponentShadowBarrageValue : 0,
    attackerHunker: hasActivatedAbilityNamed(sourceCreature, "Hunker") || getHunkerReductionPct(sourceCreature) > 0,
    defenderHunker: hasActivatedAbilityNamed(opponentCreature, "Hunker") || getHunkerReductionPct(opponentCreature) > 0,
    attackerHarden: hasActivatedAbilityNamed(sourceCreature, "Harden"),
    defenderHarden: hasActivatedAbilityNamed(opponentCreature, "Harden"),
    attackerDivination: hasActivatedAbilityNamed(sourceCreature, "Divination"),
    defenderDivination: hasActivatedAbilityNamed(opponentCreature, "Divination"),
    attackerCocoon: hasActivatedAbilityNamed(sourceCreature, "Cocoon"),
    defenderCocoon: hasActivatedAbilityNamed(opponentCreature, "Cocoon"),
    attackerExpunge: hasActivatedAbilityNamed(sourceCreature, "Expunge"),
    defenderExpunge: hasActivatedAbilityNamed(opponentCreature, "Expunge"),
  };
  const byOpponent =
    cachedByOpponent ?? new WeakMap<CreatureRuntime, RustComposableAbilityConfig>();
  byOpponent.set(opponentCreature, computed);
  rustComposableAbilityConfigCache.set(sourceCreature, byOpponent);
  return computed;
}

// ---------------------------------------------------------------------------
// Composable breath dispatcher (breath fight path)
// ---------------------------------------------------------------------------

export type RustComposableBreathEligibilityReason =
  | "unsupported-ability-policy"
  | "source-has-unsupported-passive-ability"
  | "defender-has-unsupported-passive-ability"
  | "attacker-has-unsupported-breath"
  | "defender-has-unsupported-breath"
  | "attacker-has-unsupported-activated-ability"
  | "defender-has-unsupported-activated-ability";

export function getRustComposableBreathIneligibilityReasons({
  sourceCreature,
  opponentCreature,
  finalA,
  finalB,
  activesOn,
  abilityPolicy,
}: {
  sourceCreature: CreatureRuntime;
  opponentCreature: CreatureRuntime;
  finalA: FinalStats;
  finalB: FinalStats;
  activesOn: boolean;
  abilityPolicy: AbilityTimingMode;
}): RustComposableBreathEligibilityReason[] {
  void activesOn;
  const reasons: RustComposableBreathEligibilityReason[] = [];
  if (
    abilityPolicy !== "reallyFast" &&
    abilityPolicy !== "fast" &&
    abilityPolicy !== "semiIdeal" &&
    abilityPolicy !== "ideal" &&
    abilityPolicy !== "extreme"
  ) {
    reasons.push("unsupported-ability-policy");
  }
  if (getRustUnsupportedPassiveAbilityNamesForBreath(sourceCreature).length > 0) {
    reasons.push("source-has-unsupported-passive-ability");
  }
  if (getRustUnsupportedPassiveAbilityNamesForBreath(opponentCreature).length > 0) {
    reasons.push("defender-has-unsupported-passive-ability");
  }
  if (!isSupportedRustBreathName(finalA.breathType)) reasons.push("attacker-has-unsupported-breath");
  if (!isSupportedRustBreathName(finalB.breathType)) reasons.push("defender-has-unsupported-breath");
  if (getRustUnsupportedActivatedAbilityNamesForComposable(sourceCreature).length > 0) {
    reasons.push("attacker-has-unsupported-activated-ability");
  }
  if (getRustUnsupportedActivatedAbilityNamesForComposable(opponentCreature).length > 0) {
    reasons.push("defender-has-unsupported-activated-ability");
  }
  return reasons;
}

export function isRustComposableBreathEligible(args: {
  sourceCreature: CreatureRuntime;
  opponentCreature: CreatureRuntime;
  finalA: FinalStats;
  finalB: FinalStats;
  activesOn: boolean;
  abilityPolicy: AbilityTimingMode;
}): boolean {
  return getRustComposableBreathIneligibilityReasons(args).length === 0;
}

/**
 * Resolve per-matchup environmental config for a single matchup:
 *  - Weather immunity (the two `*WeatherImmune` flags), intrinsic to having
 *    the Volcanic/Frosty ability (matches the Reference), so it resolves the
 *    same way for every opponent in the pool.
 *  - Storming gate: the raw `*Storming` toggle only takes effect when the
 *    afflicted side is Terrestrial and its opponent is Aquatic.
 * No-op for whichever feature is inactive.
 */
function withWeatherAndStorming(
  config: RustComposableAbilityConfig,
  sourceCreature: CreatureRuntime,
  opponentCreature: CreatureRuntime,
  finalA: FinalStats,
  finalB: FinalStats,
): RustComposableAbilityConfig {
  let next = config;
  const weather = config.weather as WeatherCondition | undefined;
  if (weather && weather !== "none") {
    const hasFrosty = (creature: CreatureRuntime, final: FinalStats): boolean =>
      creatureHasAbility(creature, "Frosty")
      || !!final.plushieGrantedOtherAbilities?.some((a) => a.name === "Frosty");
    next = {
      ...next,
      attackerWeatherImmune: isWeatherImmune(
        weather,
        creatureHasAbility(sourceCreature, "Volcanic"),
        hasFrosty(sourceCreature, finalA),
      ),
      defenderWeatherImmune: isWeatherImmune(
        weather,
        creatureHasAbility(opponentCreature, "Volcanic"),
        hasFrosty(opponentCreature, finalB),
      ),
    };
  }
  if (config.attackerStorming || config.defenderStorming) {
    const sourceType = sourceCreature.stats.type;
    const opponentType = opponentCreature.stats.type;
    next = {
      ...next,
      attackerStorming: !!config.attackerStorming && isTerrestrialType(sourceType) && isAquaticType(opponentType),
      defenderStorming: !!config.defenderStorming && isTerrestrialType(opponentType) && isAquaticType(sourceType),
    };
  }
  return next;
}

export function trySimulateRustComposableBreathBestBuildMatchup({
  sourceCreature,
  opponentCreature,
  finalA,
  finalB,
  activesOn,
  maxTimeSec,
  abilityPolicy,
  combatEventOrder,
  extraAbilityConfig,
  extraCombatantStats,
}: {
  sourceCreature: CreatureRuntime;
  opponentCreature: CreatureRuntime;
  finalA: FinalStats;
  finalB: FinalStats;
  activesOn: boolean;
  maxTimeSec: number;
  abilityPolicy: AbilityTimingMode;
  combatEventOrder?: import("../engine/eventOrdering").CombatEventPhase[];
  extraAbilityConfig?: Partial<RustComposableAbilityConfig>;
  extraCombatantStats?: import("./bestBuildsBattleSettingsBridge").BestBuildsExtraCombatantStats;
}): BestBuildsMatchupSummary | null {
  const bridge = getLoadedRustMatchupBridge();
  if (!bridge) return null;
  if (
    !isRustComposableBreathEligible({
      sourceCreature,
      opponentCreature,
      finalA,
      finalB,
      activesOn,
      abilityPolicy,
    })
  ) {
    return null;
  }

  // With actives off, feed an empty config so composable replicates
  // breath-only semantics (no ability activations, just bites + breath + statuses).
  const baseConfig = activesOn
    ? withBestBuildsDefaultAbilityPolicyOverrides(
        toRustComposableAbilityConfig(sourceCreature, opponentCreature),
        sourceCreature,
        opponentCreature,
      )
    : ({} as RustComposableAbilityConfig);
  const config: RustComposableAbilityConfig = withWeatherAndStorming(
    {
      ...baseConfig,
      ...(combatEventOrder ? { combatEventOrder } : null),
      ...(extraAbilityConfig ?? null),
    },
    sourceCreature,
    opponentCreature,
    finalA,
    finalB,
  );
  const sourceStatsBase = toRustStatusMeleeStats(sourceCreature, finalA, EMPTY_DISABLED, activesOn);
  const opponentStatsBase = toRustStatusMeleeStats(opponentCreature, finalB, EMPTY_DISABLED, activesOn);
  const sourceStats = extraCombatantStats?.source
    ? { ...sourceStatsBase, ...extraCombatantStats.source }
    : sourceStatsBase;
  const opponentStats = extraCombatantStats?.opponent
    ? { ...opponentStatsBase, ...extraCombatantStats.opponent }
    : opponentStatsBase;

  return bridge.simulateComposableMatchup(
    sourceStats,
    opponentStats,
    toRustBreathProfile(finalA),
    toRustBreathProfile(finalB),
    toRustAbilityTimingMode(abilityPolicy),
    config,
    maxTimeSec,
  );
}

// ---------------------------------------------------------------------------
// Composable melee dispatcher (no-breath fight path)
// ---------------------------------------------------------------------------

export type RustComposableMeleeEligibilityReason =
  | "breath-on-source"
  | "breath-on-defender"
  | "unsupported-ability-policy"
  | "source-has-unsupported-passive-ability"
  | "defender-has-unsupported-passive-ability"
  | "source-has-unsupported-activated-ability"
  | "defender-has-unsupported-activated-ability";

export function getRustComposableMeleeIneligibilityReasons({
  sourceCreature,
  opponentCreature,
  finalA,
  finalB,
  abilityPolicy,
}: {
  sourceCreature: CreatureRuntime;
  opponentCreature: CreatureRuntime;
  finalA: FinalStats;
  finalB: FinalStats;
  abilityPolicy: AbilityTimingMode;
}): RustComposableMeleeEligibilityReason[] {
  const reasons: RustComposableMeleeEligibilityReason[] = [];
  // Composable melee means a fight without breath on either side. Breath
  // matchups go through composable breath instead.
  if (finalA.hasBreath) reasons.push("breath-on-source");
  if (finalB.hasBreath) reasons.push("breath-on-defender");
  if (
    abilityPolicy !== "reallyFast" &&
    abilityPolicy !== "fast" &&
    abilityPolicy !== "semiIdeal" &&
    abilityPolicy !== "ideal" &&
    abilityPolicy !== "extreme"
  ) {
    reasons.push("unsupported-ability-policy");
  }
  if (getRustUnsupportedPassiveAbilityNamesForBreath(sourceCreature).length > 0) {
    reasons.push("source-has-unsupported-passive-ability");
  }
  if (getRustUnsupportedPassiveAbilityNamesForBreath(opponentCreature).length > 0) {
    reasons.push("defender-has-unsupported-passive-ability");
  }
  if (getRustUnsupportedActivatedAbilityNamesForComposable(sourceCreature).length > 0) {
    reasons.push("source-has-unsupported-activated-ability");
  }
  if (getRustUnsupportedActivatedAbilityNamesForComposable(opponentCreature).length > 0) {
    reasons.push("defender-has-unsupported-activated-ability");
  }
  return reasons;
}

export function isRustComposableMeleeEligible(args: {
  sourceCreature: CreatureRuntime;
  opponentCreature: CreatureRuntime;
  finalA: FinalStats;
  finalB: FinalStats;
  abilityPolicy: AbilityTimingMode;
}): boolean {
  return getRustComposableMeleeIneligibilityReasons(args).length === 0;
}

export function trySimulateRustComposableMeleeBestBuildMatchup({
  sourceCreature,
  opponentCreature,
  finalA,
  finalB,
  activesOn,
  maxTimeSec,
  abilityPolicy,
  combatEventOrder,
  extraAbilityConfig,
  extraCombatantStats,
}: {
  sourceCreature: CreatureRuntime;
  opponentCreature: CreatureRuntime;
  finalA: FinalStats;
  finalB: FinalStats;
  activesOn: boolean;
  maxTimeSec: number;
  abilityPolicy: AbilityTimingMode;
  combatEventOrder?: import("../engine/eventOrdering").CombatEventPhase[];
  extraAbilityConfig?: Partial<RustComposableAbilityConfig>;
  extraCombatantStats?: import("./bestBuildsBattleSettingsBridge").BestBuildsExtraCombatantStats;
}): BestBuildsMatchupSummary | null {
  const bridge = getLoadedRustMatchupBridge();
  if (!bridge) return null;
  if (
    !isRustComposableMeleeEligible({
      sourceCreature,
      opponentCreature,
      finalA,
      finalB,
      abilityPolicy,
    })
  ) {
    return null;
  }

  // With actives off, feed an empty config so composable replicates
  // status_melee semantics (no ability activations, just bites + statuses).
  const baseConfig = activesOn
    ? withBestBuildsDefaultAbilityPolicyOverrides(
        toRustComposableAbilityConfig(sourceCreature, opponentCreature),
        sourceCreature,
        opponentCreature,
      )
    : ({} as RustComposableAbilityConfig);
  const config: RustComposableAbilityConfig = withWeatherAndStorming(
    {
      ...baseConfig,
      ...(combatEventOrder ? { combatEventOrder } : null),
      ...(extraAbilityConfig ?? null),
    },
    sourceCreature,
    opponentCreature,
    finalA,
    finalB,
  );
  const sourceStatsBase = toRustStatusMeleeStats(sourceCreature, finalA, EMPTY_DISABLED, activesOn);
  const opponentStatsBase = toRustStatusMeleeStats(opponentCreature, finalB, EMPTY_DISABLED, activesOn);
  const sourceStats = extraCombatantStats?.source
    ? { ...sourceStatsBase, ...extraCombatantStats.source }
    : sourceStatsBase;
  const opponentStats = extraCombatantStats?.opponent
    ? { ...opponentStatsBase, ...extraCombatantStats.opponent }
    : opponentStatsBase;

  return bridge.simulateComposableMatchup(
    sourceStats,
    opponentStats,
    null,
    null,
    toRustAbilityTimingMode(abilityPolicy),
    config,
    maxTimeSec,
  );
}
