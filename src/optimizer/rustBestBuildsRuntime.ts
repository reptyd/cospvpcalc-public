import type { AbilityTimingMode, AbilityTimingOverrides, CreatureRuntime, FinalStats } from "../engine";
import { DEFAULT_ABILITY_TIMING_OVERRIDES } from "../engine/abilityTimingOverrides";
import { creatureHasAbility } from "../components/compare/compareSpecialAbilities";
import { isAquaticType, isTerrestrialType, isWeatherImmune, type WeatherCondition } from "../engine/weather";
import { buildPlushieRustStatusBlockFractions } from "./rustStatusBlockFractions";
import { getRawElderBlockFraction } from "../engine/statusBlockMath";
import { breathSpecByName, effectsCatalog } from "../engine/data";
import { hasAbilityName, normalizeAbilityName, parseBreathAilments, resolveStatusId } from "../engine/runtimeHelpers";
import { isModeledOtherAbility } from "./abilityCoverageRegistry";
import { SPEC_CONSTANTS } from "../engine/specConstants.generated";
import {
  deriveComposableSupportedActivatedNames,
  deriveComposableSupportedPassiveNames,
  deriveContourNoEffectPassiveNames,
  deriveContourPrebuiltActivatedNames,
  deriveContourTsNoOpPassiveNames,
} from "./abilityRegistry";
import type { BestBuildsMatchupSummary } from "./bestBuildsMatchupContract";
import { buildAbilityConfig } from "./buildAbilityConfig";
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
  LoadedRustMatchupBridge,
  RustAbilityPolicyOverrides,
  RustComposableAbilityConfig,
  RustComposableMatchupBatch,
  RustPinnedDefensiveSchedule,
  RustSimpleBreathProfile,
  RustSimpleCombatantStats,
} from "./rustMatchupBridge";
import { getLoadedRustMatchupBridge } from "./rustMatchupLoader";

// Best Builds inherits the global ability-timing overrides set
// (Warden's Rage on ReallyFast) plus any Best-Builds-specific
// extras. Fortify previously had `"fast"` here as a workaround for
// the earlier Ideal "fires too early" bug. After the stack-pressure
// projection (via POLICY_SEARCH_DELAY_KEY) the Ideal path produces
// math-ideal Fortify timing, so the override is gone - Best Builds
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

export const COMPOSABLE_SUPPORTED_ACTIVATED_NAMES = deriveComposableSupportedActivatedNames();

export const COMPOSABLE_SUPPORTED_PASSIVE_NAMES = deriveComposableSupportedPassiveNames();

// The engine detects these abilities by name regardless of whether the wiki
// data files them under passiveAbilities or activatedAbilities (e.g. Zeoarex
// carries "Totem" - an activated mechanic - in its passive list). Eligibility
// therefore checks the UNION: an ability is supported as long as it is modeled
// in either role. This keeps eligibility placement-agnostic (matching the
// engine) and prevents "a modeled ability in the unexpected list silently makes
// the whole matchup ineligible and the battle stops running".
const COMPOSABLE_SUPPORTED_ABILITY_NAMES = new Set<string>([
  ...COMPOSABLE_SUPPORTED_ACTIVATED_NAMES,
  ...COMPOSABLE_SUPPORTED_PASSIVE_NAMES,
]);

export const CONTOUR_NO_EFFECT_PASSIVE_NAMES = deriveContourNoEffectPassiveNames();

export const CONTOUR_TS_NO_OP_PASSIVE_NAMES = deriveContourTsNoOpPassiveNames();

export const CONTOUR_PREBUILT_ACTIVATED_NAMES = deriveContourPrebuiltActivatedNames();

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

// Pure functions of `creature` - result is stable for the session. BB's
// eligibility check hits these 4x per matchup x 170K matchups, all just to
// read `.length`. WeakMap cache collapses that to 1x per creature.
const unsupportedActivatedForComposableCache = new WeakMap<CreatureRuntime, string[]>();
const unsupportedPassiveForBreathCache = new WeakMap<CreatureRuntime, string[]>();

export function getRustUnsupportedActivatedAbilityNamesForComposable(creature: CreatureRuntime): string[] {
  const cached = unsupportedActivatedForComposableCache.get(creature);
  if (cached) return cached;
  const computed = filterComposableShapingOutliers(
    creature,
    getRustUnsupportedActivatedAbilityNames(
      creature,
      COMPOSABLE_SUPPORTED_ABILITY_NAMES,
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
    COMPOSABLE_SUPPORTED_ABILITY_NAMES,
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

  // Guilt reduces all incoming damage (game Guilt.OnDamage); the bite side folds
  // in here alongside the bite-only Ligament Tear reducer.
  multiplier *= getGuiltDamageMultiplier(creature, disabled);

  return multiplier;
}

/**
 * Guilt's incoming-damage multiplier (game `Guilt.OnDamage -> x0.5`). Guilt
 * halves ALL direct damage, so this feeds both the bite aggregate above and the
 * dedicated breath channel (`damageTakenMultiplierOnBreath`). Bite-only reducers
 * like Ligament Tear are deliberately excluded here. Returns 1 when Guilt is
 * absent or disabled.
 */
function getGuiltDamageMultiplier(
  creature: CreatureRuntime,
  disabled: ReadonlySet<string> = EMPTY_DISABLED,
): number {
  const effects = effectsCatalog[creature.name] ?? {};
  const allAbilities = [
    ...(effects.specialAbilitiesDetailed ?? []),
    ...(effects.specialAbilities ?? []),
    ...(effects.otherAbilities ?? []),
  ].filter((ability) => !isAbilityDisabled(disabled, ability.name));
  const guilt = allAbilities.find((ability) => ability.name === "Guilt");
  const guiltDef =
    guilt && "def" in guilt && guilt.def?.type === "damageTakenMultiplier"
      ? (guilt.def as {
          type: "damageTakenMultiplier";
          when?: string;
          multiplier: number;
        })
      : undefined;
  return guiltDef && typeof guiltDef.multiplier === "number" && Number.isFinite(guiltDef.multiplier)
    ? guiltDef.multiplier
    : 1;
}

/** Weather statuses a creature shrugs off wherever they come from, keyed by the
 * ability that grants the immunity. The weather setting has its own gate at
 * setup, but the same status also arrives from Yolk Bomb and Lich Mark, and a
 * Frosty creature does not start feeling the cold because a Frosflit threw it. */
const WEATHER_IMMUNITY_BY_ABILITY: Record<string, string> = {
  Frosty: "Hypothermia_Status",
  Volcanic: "Heat_Wave_Status",
};

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
  const fromCatalog = Array.isArray(def?.immuneTo) ? def.immuneTo : [];
  const fromWeatherAbilities = Object.entries(WEATHER_IMMUNITY_BY_ABILITY)
    .filter(([ability]) => !isAbilityDisabled(disabled, ability) && creatureHasAbility(creature, ability))
    .map(([, statusId]) => statusId);
  return [...new Set([...fromCatalog, ...fromWeatherAbilities])];
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
  // The gate threshold is spec-universal (every creature with First Strike
  // shares it); source it from the spec spine, not the per-creature data
  // copy. `pct` (the damage bonus) is genuinely creature-specific.
  const hpRatioThreshold =
    conditionalDef?.trigger.hpRatioGte != null ? SPEC_CONSTANTS.first_strike_hp_gate_pct / 100 : 1;
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
  // Berserk's gate and cooldown factor are spec-universal; source both from
  // the spec spine, gated on the per-creature data presence.
  return {
    biteCooldownMultiplier:
      def?.mods?.biteCooldownMultiplier != null ? SPEC_CONSTANTS.berserk_bite_cooldown_multiplier : 1,
    hpRatioThreshold:
      (def?.trigger.hpRatioLt ?? def?.trigger.hpRatioLte) != null ? SPEC_CONSTANTS.berserk_hp_gate_pct / 100 : 0,
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
  return (def?.trigger.hpRatioLte ?? def?.trigger.hpRatioLt) != null
    ? SPEC_CONSTANTS.quick_recovery_hp_gate_pct / 100
    : 0;
}

export function getHunkerReductionPct(
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
  // The Rust engine has no activesOn check, so the mapper must zero the profile.
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
      stacks: 2,
      sourceAbility: "Sticky Fur",
    }));
}

function isSupportedRustBreathName(_name: string | null): boolean {
  // Every breath is runnable, so a breath never makes a matchup ineligible:
  //  - a breath WITH a spec is simulated as a real breath fight;
  //  - a breath WITHOUT a spec (Moon Beam, Heal Breath, Plasma Beam, a Lance,
  //    or any new/unknown breath) has no capacity, so toRustBreathProfile /
  //    buildBreathProfileByName return null and the composable dispatcher runs
  //    a melee-equivalent fight.
  // Previously only a hand-picked few no-spec breaths were whitelisted and
  // every other no-spec breath silently blocked the whole matchup (the battle
  // just stopped running). Defaulting to "runnable" makes the eligibility
  // robust to new breaths instead of failing closed on them.
  return true;
}

// Plasma Beam has no row in the breath spec table, so its constants live here:
// in game the Plasma Beam breath has Damage 2, Critical 35, TimeBeforeFire 0.8,
// Capacity 1.5, Ammo 3, Cooldown 40, RecastCooldown 2.5, and applies Slowed at
// 100% for a single stack.
function plasmaBeamProfile(): RustSimpleBreathProfile {
  return {
    dpsPct: 2.0,
    capacity: 1.5,
    regenRate: 0,
    critChancePct: 35,
    chain: 0,
    chainMaxStacks: 0,
    specialKind: "plasma_beam",
    selfHealPct: 0,
    cleanseStacks: 0,
    lanceDamagePct: 0,
    lanceChargeSec: 0,
    lanceCooldownSec: 0,
    lanceStatusId: null,
    autoFireDelaySec: 0.8,
    autoFireCooldownSec: 2.5,
    chargesMax: 3,
    chargeRegenSec: 40,
    specialStatuses: [{ statusId: "Slow_Status", stacks: 1 }],
  };
}

// Chances the scraped spec text gets wrong, against the game's own breath
// table. `wikiPct` is the value being corrected: when a re-scrape brings the
// text in line, the entry stops matching and can be dropped.
export const SPEC_CHANCE_CORRECTIONS: Record<string, Array<{ status: string; wikiPct: number; gamePct: number }>> = {
  "Glacier Breath": [{ status: "Slowed", wikiPct: 30, gamePct: 15 }],
};

// The profile's `specialStatuses` land on the breath's target, so the self
// rolls (Cloud Breath's Water Regeneration and Muddy) are not part of it -
// Cloud's own Muddy proc is engine-side, on the actor.
function getRustBreathSpecialStatuses(
  raw: string | undefined,
  breathName?: string,
): Array<{ statusId: string; stacks: number }> {
  if (!raw) return [];
  const corrections = SPEC_CHANCE_CORRECTIONS[breathName ?? ""] ?? [];
  return parseBreathAilments(raw)
    .filter((ailment) => ailment.target === "opponent")
    .map((ailment) => {
      const statusId = resolveStatusId(ailment.name);
      if (!statusId) return null;
      const fix = corrections.find(
        (c) => resolveStatusId(c.status) === statusId && c.wikiPct === ailment.probability,
      );
      const stacks = ((fix?.gamePct ?? ailment.probability) / 100) * (ailment.stacks ?? 1);
      if (!(stacks > 0)) return null;
      return { statusId, stacks };
    })
    .filter((entry): entry is { statusId: string; stacks: number } => entry !== null);
}

// `Lance (Necropoison)` -> `Necropoison_Status`. The Reference says each aura
// tick applies "the user's carrier-specific Lance ailment", and the flavour in
// the name IS that ailment, so it is read off the status catalog rather than
// listed here. Listing them is what went wrong: the three that were named
// covered Burn, Frostbite and a Radiation lance, while Bleed, Disease, Injury
// and Necropoison fell through to `null` and their aura ticked damage with no
// ailment behind it.
function lanceStatusIdForBreathName(name: string): string | null {
  const flavour = name.match(/\(([^)]+)\)/)?.[1]?.trim();
  return flavour ? resolveStatusId(flavour) : null;
}

export function toRustBreathProfile(finalStats: FinalStats): RustSimpleBreathProfile | null {
  if (rustBreathProfileCache.has(finalStats)) {
    return rustBreathProfileCache.get(finalStats) ?? null;
  }

  // A user-authored custom breath profile takes precedence
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

  // Every name-based branch - Plasma Beam, the Lances, the beam family, the
  // support breaths, the spec-driven tail - lives in `buildBreathProfileByName`.
  // This used to carry a second copy of all of it, so a new special breath had
  // to be added in both and the two could part company in between.
  const profile = buildBreathProfileByName(
    finalStats.breathType ?? "",
    finalStats.breathDamagePct ?? 0,
    finalStats.breathRegenPct ?? 0,
  );
  rustBreathProfileCache.set(finalStats, profile);
  return profile;
}

/**
 * Construct a `RustSimpleBreathProfile` from JUST the breath name -
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

  if (name === "Plasma Beam") return plasmaBeamProfile();

  const spec = breathSpecByName[name];
  if (!spec && /^Lance/i.test(name)) {
    const lanceStatusId = lanceStatusIdForBreathName(name);
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

  const parsedSpecialStatuses = getRustBreathSpecialStatuses(spec.raw, name);
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
      ? { specialKind: "cloud" as const, selfHealPct: 1, cleanseStacks: 0 }
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
    // the Rust BiteVariant policy can read it per-bite when dynamic
    // mode is on. Defaults to 0 when the creature has no secondary attack;
    // the policy treats `damage2 <= 0` as "primary-only-eligible".
    damage2: typeof finalStats.damage2 === "number" ? finalStats.damage2 : 0,
    healthRegen: finalStats.healthRegen ?? 0,
    activeCooldownMultiplier: finalStats.activeCooldownMultiplier ?? 1,
    unbreakableDamageCapPct: getUnbreakableDamageCapPct(creature, disabled),
    damageTakenMultiplierOnBeingBitten: getDamageTakenMultiplierOnBeingBitten(creature, disabled),
    damageTakenMultiplierOnBreath: getGuiltDamageMultiplier(creature, disabled),
    breathResistance: 0,
    hasReflect: hasActivatedAbilityNamed(creature, "Reflect", disabled),
    immuneStatusIds: [],
    // Read-only creature identity for the decision-DSL
    // is_type / is_diet / is_elder / tier read-vars. Sourced from
    // FinalStats; empty/0 when unknown (Rust reads resolve to 0/false).
    // Pure function of finalStats, so it rides the existing cache safely.
    identity: {
      type: finalStats.type ?? "",
      diet: finalStats.diet ?? "",
      elder: finalStats.elder ?? "",
      tier: finalStats.tier ?? 0,
      // Aerial = can fly or glide (has a fly-speed or take-off stat); drives
      // the Aerial Dodge rule. Grounded creatures never dodge.
      isAerial: (creature.stats?.flySpeed ?? 0) > 0 || (creature.stats?.takeoffMultiplier ?? 0) > 0,
    },
    // Oxygen / Moisture pools for the Compare-only drain mode. Forwarded
    // unconditionally (0 when the stat is absent) so the engine has the pool
    // when the mode is on; inert when the mode is off. Pure function of
    // finalStats, so it rides the existing cache safely.
    oxygenTime: typeof finalStats.oxygenTime === "number" ? finalStats.oxygenTime : 0,
    moistureTime: typeof finalStats.moistureTime === "number" ? finalStats.moistureTime : 0,
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
    // Mirror the TS engine's getBreathResistance (combatMath.ts): the ability
    // value plus finalStats.breathResistance (the plushie contribution, e.g.
    // Astral Quetzal +50%), clamped to [0,1]. No creature carries a base
    // breathResistance stat, so the two terms never double-count. Feeding only
    // the ability value dropped the plushie boost in Compare/BestBuilds.
    breathResistance: Math.max(
      0,
      Math.min(
        1,
        (typeof breathResistanceAbility?.value === "number" ? breathResistanceAbility.value : 0) +
          (typeof finalStats.breathResistance === "number" ? finalStats.breathResistance : 0),
      ),
    ),
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
    // Per-plushie per-status ailment blocks (the specific BlockX stats).
    // The elder all-ailment block (Gentle's +10% Ailment Block) rides its own
    // `elderBlockFraction` scalar below instead of being folded in here, so
    // Radiation - which only weakens the specific per-ailment blocks - leaves
    // the umbrella block intact.
    plushieStatusBlockFractions: buildPlushieRustStatusBlockFractions(finalStats),
    elderBlockFraction: getRawElderBlockFraction(finalStats),
    plushieReflectAvgPct: finalStats.plushieReflectAvgPct ?? 0,
    muddyStrengthBoostPct: finalStats.muddyStrengthBoostPct ?? 0,
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
  // Best Builds emits the registry-gated ability surface but not the trails -
  // a BB matchup never carries the Compare "Trails" toggle. The passive-Hunker
  // reduction is OR'd into the Hunker flag the same way Compare resolves it.
  const computed = buildAbilityConfig({
    sourceCreature,
    opponentCreature,
    hunkerReductionPctA: getHunkerReductionPct(sourceCreature),
    hunkerReductionPctB: getHunkerReductionPct(opponentCreature),
  });
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

// ---------------------------------------------------------------------------
// Shared matchup marshalling
//
// The melee / breath dispatchers, the pin-capture and the pinned-replay all
// feed the composable engine the SAME per-matchup config + stats. Keeping the
// three-way construction in one place is what lets the Best Builds funnel
// (bbFunnel/) capture a defensive schedule and replay it under GateOnly against
// bit-identical inputs to the exact `ideal` fight.
// ---------------------------------------------------------------------------

export type BestBuildsComposableMatchupArgs = {
  sourceCreature: CreatureRuntime;
  opponentCreature: CreatureRuntime;
  finalA: FinalStats;
  finalB: FinalStats;
  activesOn: boolean;
  breathFight: boolean;
  combatEventOrder?: import("../engine/eventOrdering").CombatEventPhase[];
  extraAbilityConfig?: Partial<RustComposableAbilityConfig>;
  extraCombatantStats?: import("./bestBuildsBattleSettingsBridge").BestBuildsExtraCombatantStats;
};

export function buildBestBuildsMatchupConfig({
  sourceCreature,
  opponentCreature,
  finalA,
  finalB,
  activesOn,
  combatEventOrder,
  extraAbilityConfig,
}: Omit<BestBuildsComposableMatchupArgs, "breathFight" | "extraCombatantStats">): RustComposableAbilityConfig {
  // With actives off, feed an empty config so composable replicates the
  // status/breath-only semantics (no ability activations, just bites + breath +
  // statuses).
  const baseConfig = activesOn
    ? withBestBuildsDefaultAbilityPolicyOverrides(
        toRustComposableAbilityConfig(sourceCreature, opponentCreature),
        sourceCreature,
        opponentCreature,
      )
    : ({} as RustComposableAbilityConfig);
  return withWeatherAndStorming(
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
}

/** One side's combatant stats exactly as a Best Builds matchup marshals them.
 * Split out so a batched rectangle can marshal each distinct combatant once
 * instead of once per pairing. */
export function toBestBuildsCombatantStats(
  creature: CreatureRuntime,
  finalStats: FinalStats,
  activesOn: boolean,
): RustSimpleCombatantStats {
  return toRustStatusMeleeStats(creature, finalStats, EMPTY_DISABLED, activesOn);
}

function buildBestBuildsMatchupStats({
  sourceCreature,
  opponentCreature,
  finalA,
  finalB,
  activesOn,
  extraCombatantStats,
}: Pick<
  BestBuildsComposableMatchupArgs,
  "sourceCreature" | "opponentCreature" | "finalA" | "finalB" | "activesOn" | "extraCombatantStats"
>): { sourceStats: RustSimpleCombatantStats; opponentStats: RustSimpleCombatantStats } {
  const sourceStatsBase = toBestBuildsCombatantStats(sourceCreature, finalA, activesOn);
  const opponentStatsBase = toBestBuildsCombatantStats(opponentCreature, finalB, activesOn);
  const sourceStats = extraCombatantStats?.source
    ? { ...sourceStatsBase, ...extraCombatantStats.source }
    : sourceStatsBase;
  const opponentStats = extraCombatantStats?.opponent
    ? { ...opponentStatsBase, ...extraCombatantStats.opponent }
    : opponentStatsBase;
  return { sourceStats, opponentStats };
}

type MarshalledBestBuildsMatchup = {
  sourceStats: RustSimpleCombatantStats;
  opponentStats: RustSimpleCombatantStats;
  sourceBreath: RustSimpleBreathProfile | null;
  opponentBreath: RustSimpleBreathProfile | null;
  config: RustComposableAbilityConfig;
};

function marshalBestBuildsMatchup(args: BestBuildsComposableMatchupArgs): MarshalledBestBuildsMatchup {
  const config = buildBestBuildsMatchupConfig(args);
  const { sourceStats, opponentStats } = buildBestBuildsMatchupStats(args);
  return {
    sourceStats,
    opponentStats,
    sourceBreath: args.breathFight ? toRustBreathProfile(args.finalA) : null,
    opponentBreath: args.breathFight ? toRustBreathProfile(args.finalB) : null,
    config,
  };
}

/**
 * Capture the committed defensive schedule (Fortify fires + Hunker/Warden
 * toggle timelines) of a full `ideal` Best Builds fight. The funnel captures
 * this once on a group representative and replays it for the rest of the group
 * via `simulateBestBuildMatchupPinned`. Returns null when no bridge is loaded.
 */
export function captureBestBuildDefensivePin(
  args: BestBuildsComposableMatchupArgs,
  maxTimeSec: number,
  bridge: LoadedRustMatchupBridge | null = getLoadedRustMatchupBridge(),
): RustPinnedDefensiveSchedule | null {
  if (!bridge) return null;
  const { sourceStats, opponentStats, sourceBreath, opponentBreath, config } = marshalBestBuildsMatchup(args);
  return bridge.captureDefensivePinSchedule(sourceStats, opponentStats, sourceBreath, opponentBreath, config, maxTimeSec);
}

/**
 * Replay a Best Builds matchup under `GateOnly` with a captured defensive
 * schedule pinned on both sides. Proven bit-identical to the full `ideal` fight
 * for the fight the schedule was captured from; for a DIFFERENT attacker in the
 * same rollout group it is exact only when that attacker induces the same
 * defensive schedule (the funnel verifies a sample and falls back to `ideal` on
 * any mismatch). Returns null when no bridge is loaded.
 */
export function simulateBestBuildMatchupPinned(
  args: BestBuildsComposableMatchupArgs,
  pinnedSchedule: RustPinnedDefensiveSchedule,
  maxTimeSec: number,
  bridge: LoadedRustMatchupBridge | null = getLoadedRustMatchupBridge(),
): BestBuildsMatchupSummary | null {
  if (!bridge) return null;
  const { sourceStats, opponentStats, sourceBreath, opponentBreath, config } = marshalBestBuildsMatchup(args);
  return bridge.simulateComposableMatchupPinned(
    sourceStats,
    opponentStats,
    sourceBreath,
    opponentBreath,
    config,
    pinnedSchedule,
    maxTimeSec,
  );
}

/**
 * Run a whole rectangle of Best Builds fights in one WASM crossing. Each
 * distinct attacker / defender / breath / config crosses once and `fights`
 * pairs them up, which is what makes the screen stages cheap: their fights are
 * short enough that the per-call marshalling was a double-digit share of the
 * cost. Returns null when the loaded bundle predates the batch export.
 */
export function simulateBestBuildMatchupBatch(
  batch: RustComposableMatchupBatch,
  bridge: LoadedRustMatchupBridge | null = getLoadedRustMatchupBridge(),
): BestBuildsMatchupSummary[] | null {
  return bridge?.simulateComposableMatchupBatch?.(batch) ?? null;
}

/** Whether the loaded bundle carries the batch export, so a caller can decide
 * between the rectangle and the per-matchup path before marshalling anything. */
export function isBestBuildsBatchAvailable(
  bridge: LoadedRustMatchupBridge | null = getLoadedRustMatchupBridge(),
): boolean {
  return typeof bridge?.simulateComposableMatchupBatch === "function";
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

  const { sourceStats, opponentStats, config } = marshalBestBuildsMatchup({
    sourceCreature,
    opponentCreature,
    finalA,
    finalB,
    activesOn,
    breathFight: true,
    combatEventOrder,
    extraAbilityConfig,
    extraCombatantStats,
  });

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

  const { sourceStats, opponentStats, config } = marshalBestBuildsMatchup({
    sourceCreature,
    opponentCreature,
    finalA,
    finalB,
    activesOn,
    breathFight: false,
    combatEventOrder,
    extraAbilityConfig,
    extraCombatantStats,
  });

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
