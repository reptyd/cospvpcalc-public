import type {
  AbilityTimingMode,
  AbilityTimingOverrides,
  BadOmenOutcome,
  CompareBiteVariantMode,
  CreatureRuntime,
  FinalStats,
  UserAbilityLevelOverrides,
  UserAbilityTimingOverrides,
} from "../engine";
import { canonicalizeAbilityValue } from "../engine/abilityValueOptions";
import { effectsCatalog } from "../engine/data";
import { hasAbilityName, normalizeAbilityName } from "../engine/runtimeHelpers";
import { resolveRuntimeAbilityValue } from "./runtimeAbilityValue";
import {
  toRustAbilityTimingMode,
  toRustBreathProfile,
  toRustComposableAbilityConfig,
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

// ---------------------------------------------------------------------------
// Compare → Rust composable bridge.
//
// Produces the six arguments that `simulateComposableMatchup` expects from
// Compare-shaped inputs. Rust's ComposableAbilityConfig covers almost all
// Compare-only knobs already; this mapper wires them through.
//
// Two knobs are intentionally pinned to 0 because Compare pre-bakes their
// effect into `finalStats` via applyCompareBuffRuntime / applyCompareSpecial
// Abilities:
//   - compareRegenBonusPct (Frosty/Volcanic/Pack Healer/... → finalStats.healthRegen)
//   - compareGourmandizerFillPct (static weight bonus → finalStats.weight)
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
  /** Hunger rule enabled - dynamic hunger drain simulation. */
  hungerRule: boolean;
  /** Gourmandizer ability active (gated by hungerRule in Rust). */
  gourmandizer: boolean;
  /** Starting hunger in appetite *units* (convert from % before passing). */
  startingHungerUnits: number;
  /** Appetite base in units (TS default 100). */
  appetiteBaseUnits: number;
  /** Defiled Ground level on this side (0/1/2/3). */
  defiledGroundLevel: number;
  /** Defiled Ground Weakness debuff from opponent. */
  defiledGroundWeakness: boolean;
  /** Plushie hunger drain multiplier (1.0 = no change; Euvatops/Aerodon = 0.85; Goldfish = 1.20). */
  appetiteDrainMultiplier: number;
  /** Healing Pulse toggle enabled (requires creature to own Healing Pulse). */
  healingPulseEnabled: boolean;
  /** Healing Pulse mode flag: true = onceAtStart (self-only single cast); false = normal (radius, every 90s). */
  healingPulseOnce: boolean;
  /** Expunge enabled (true when creature owns Expunge). Default-modeled; ideal policy inlined (kill-secure OR heal-save). */
  expungeEnabled: boolean;
  /** Compare-only Warden's Rage setup. 0 disables; otherwise side starts at this percent of max HP. */
  wardenRageStartHpPct: number;
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
  /** Pre-resolved Bad Omen outcome (null = not configured). */
  badOmenOutcome: BadOmenOutcome | null;
  /** Compare Special Air PvP Rule enabled (shared both sides). */
  compareAirRuleEnabled: boolean;
  /** Fixed bite cooldown in seconds when Air PvP Rule is enabled. */
  compareAirRuleCooldownSec: number;
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
  /** Global weather cataclysm + per-side immunity (resolved on TS:
   *  Volcanic ignores Heat Wave, Frosty ignores Blizzard, Acid Rain none). */
  weather?: "none" | "heatWave" | "blizzard" | "acidRain";
  attackerWeatherImmune?: boolean;
  defenderWeatherImmune?: boolean;
  /** Storming debuff per side (already gated to terrestrial-vs-aquatic on
   *  the TS side). Seeds a permanent +10%-incoming marker in the engine. */
  attackerStorming?: boolean;
  defenderStorming?: boolean;
};

export type CompareToRustOutput = {
  attacker: RustSimpleCombatantStats;
  defender: RustSimpleCombatantStats;
  attackerBreath: RustSimpleBreathProfile | null;
  defenderBreath: RustSimpleBreathProfile | null;
  abilityPolicy: RustAbilityTimingMode;
  abilityConfig: RustComposableAbilityConfig;
};

function numericAbilityValue(creature: CreatureRuntime, name: string): number {
  const raw = resolveRuntimeAbilityValue(creature, name);
  return typeof raw === "number" ? raw : 0;
}

function stringAbilityValue(creature: CreatureRuntime, name: string): string | null {
  const raw = resolveRuntimeAbilityValue(creature, name);
  const canonical = canonicalizeAbilityValue(name, raw);
  return typeof canonical === "string" ? canonical : null;
}

function hasActivatedAbility(creature: CreatureRuntime, name: string): boolean {
  const normalized = normalizeAbilityName(name);
  return (
    (creature.activatedAbilities ?? []).some((ability) => normalizeAbilityName(ability.name) === normalized) ||
    hasAbilityName(effectsCatalog[creature.name] ?? {}, name)
  );
}

function toStartingStatuses(
  statuses: CompareInitialStatus[],
): NonNullable<RustSimpleCombatantStats["startingStatuses"]> {
  return statuses.map((entry) => ({
    statusId: entry.statusId,
    stacks: entry.stacks ?? 1,
    ...(entry.stackValueMode ? { stackValueMode: entry.stackValueMode } : {}),
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

type ConfigAbilityGate = {
  ability: string;
  attackerKey: keyof RustComposableAbilityConfig;
  defenderKey: keyof RustComposableAbilityConfig;
};

const BOOL_CONFIG_GATES: ConfigAbilityGate[] = [
  { ability: "Thorn Trap", attackerKey: "attackerThornTrap", defenderKey: "defenderThornTrap" },
  { ability: "Toxic Trap", attackerKey: "attackerToxicTrap", defenderKey: "defenderToxicTrap" },
  { ability: "Frost Snare", attackerKey: "attackerFrostSnare", defenderKey: "defenderFrostSnare" },
  { ability: "Fortify", attackerKey: "attackerFortify", defenderKey: "defenderFortify" },
  { ability: "Drowsy Area", attackerKey: "attackerDrowsyArea", defenderKey: "defenderDrowsyArea" },
  { ability: "Unbridled Rage", attackerKey: "attackerUnbridledRage", defenderKey: "defenderUnbridledRage" },
  { ability: "Hunters Curse", attackerKey: "attackerHuntersCurse", defenderKey: "defenderHuntersCurse" },
  { ability: "Rewind", attackerKey: "attackerRewind", defenderKey: "defenderRewind" },
  { ability: "Warden's Rage", attackerKey: "attackerWardenRage", defenderKey: "defenderWardenRage" },
  { ability: "Adrenaline", attackerKey: "attackerAdrenaline", defenderKey: "defenderAdrenaline" },
  { ability: "Lich Mark", attackerKey: "attackerLichMark", defenderKey: "defenderLichMark" },
  { ability: "Frost Nova", attackerKey: "attackerFrostNova", defenderKey: "defenderFrostNova" },
  { ability: "Reflux", attackerKey: "attackerReflux", defenderKey: "defenderReflux" },
  { ability: "Totem", attackerKey: "attackerTotem", defenderKey: "defenderTotem" },
  { ability: "Reflect", attackerKey: "attackerReflect", defenderKey: "defenderReflect" },
  { ability: "Cause Fear", attackerKey: "attackerCauseFear", defenderKey: "defenderCauseFear" },
  { ability: "Grim Lariat", attackerKey: "attackerGrimLariat", defenderKey: "defenderGrimLariat" },
  { ability: "Hunker", attackerKey: "attackerHunker", defenderKey: "defenderHunker" },
  { ability: "Divination", attackerKey: "attackerDivination", defenderKey: "defenderDivination" },
  { ability: "Poison Area", attackerKey: "attackerPoisonArea", defenderKey: "defenderPoisonArea" },
  { ability: "Yolk Bomb", attackerKey: "attackerYolkBomb", defenderKey: "defenderYolkBomb" },
  { ability: "Harden", attackerKey: "attackerHarden", defenderKey: "defenderHarden" },
  { ability: "Cocoon", attackerKey: "attackerCocoon", defenderKey: "defenderCocoon" },
  { ability: "Expunge", attackerKey: "attackerExpunge", defenderKey: "defenderExpunge" },
];

const VALUE_CONFIG_GATES: ConfigAbilityGate[] = [
  { ability: "Life Leech", attackerKey: "attackerLifeLeechValue", defenderKey: "defenderLifeLeechValue" },
  { ability: "Cursed Sigil", attackerKey: "attackerCursedSigilStacks", defenderKey: "defenderCursedSigilStacks" },
  { ability: "Spite", attackerKey: "attackerSpiteValue", defenderKey: "defenderSpiteValue" },
  { ability: "Shadow Barrage", attackerKey: "attackerShadowBarrageValue", defenderKey: "defenderShadowBarrageValue" },
];

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

function findAuraSubtype(creature: CreatureRuntime): string | null {
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

function addAbilityPresenceFields(
  config: RustComposableAbilityConfig,
  sourceCreature: CreatureRuntime,
  opponentCreature: CreatureRuntime,
): RustComposableAbilityConfig {
  return {
    ...config,
    attackerPoisonArea: hasActivatedAbility(sourceCreature, "Poison Area"),
    defenderPoisonArea: hasActivatedAbility(opponentCreature, "Poison Area"),
    attackerYolkBomb: hasActivatedAbility(sourceCreature, "Yolk Bomb"),
    defenderYolkBomb: hasActivatedAbility(opponentCreature, "Yolk Bomb"),
    attackerYolkBombValue: stringAbilityValue(sourceCreature, "Yolk Bomb"),
    defenderYolkBombValue: stringAbilityValue(opponentCreature, "Yolk Bomb"),
    attackerHarden: hasActivatedAbility(sourceCreature, "Harden"),
    defenderHarden: hasActivatedAbility(opponentCreature, "Harden"),
    attackerCocoon: hasActivatedAbility(sourceCreature, "Cocoon"),
    defenderCocoon: hasActivatedAbility(opponentCreature, "Cocoon"),
    attackerAuraSubtype: findAuraSubtype(sourceCreature),
    defenderAuraSubtype: findAuraSubtype(opponentCreature),
  };
}

function addTrailValues(
  config: RustComposableAbilityConfig,
  sourceCreature: CreatureRuntime,
  opponentCreature: CreatureRuntime,
  trailsA: boolean,
  trailsB: boolean,
): RustComposableAbilityConfig {
  const sideA = trailsA;
  const sideB = trailsB;
  return {
    ...config,
    attackerHealingStepValue: sideA ? numericAbilityValue(sourceCreature, "Healing Step") : 0,
    defenderHealingStepValue: sideB ? numericAbilityValue(opponentCreature, "Healing Step") : 0,
    attackerFlameTrailValue: sideA ? numericAbilityValue(sourceCreature, "Flame Trail") : 0,
    defenderFlameTrailValue: sideB ? numericAbilityValue(opponentCreature, "Flame Trail") : 0,
    attackerFrostTrailValue: sideA ? numericAbilityValue(sourceCreature, "Frost Trail") : 0,
    defenderFrostTrailValue: sideB ? numericAbilityValue(opponentCreature, "Frost Trail") : 0,
    attackerPlagueTrailValue: sideA ? numericAbilityValue(sourceCreature, "Plague Trail") : 0,
    defenderPlagueTrailValue: sideB ? numericAbilityValue(opponentCreature, "Plague Trail") : 0,
    attackerToxicTrailValue: sideA ? numericAbilityValue(sourceCreature, "Toxic Trail") : 0,
    defenderToxicTrailValue: sideB ? numericAbilityValue(opponentCreature, "Toxic Trail") : 0,
  };
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
    attackerCompareAppetiteBase: perksA.appetiteBaseUnits,
    defenderCompareAppetiteBase: perksB.appetiteBaseUnits,
    attackerCompareDefiledGroundLevel: perksA.defiledGroundLevel,
    defenderCompareDefiledGroundLevel: perksB.defiledGroundLevel,
    attackerCompareDefiledGroundWeakness: perksA.defiledGroundWeakness,
    defenderCompareDefiledGroundWeakness: perksB.defiledGroundWeakness,
    attackerCompareGourmandizerFillPct: 0,
    defenderCompareGourmandizerFillPct: 0,
    attackerCompareRegenBonusPct: 0,
    defenderCompareRegenBonusPct: 0,
    attackerComparePlushieDrainMultiplier: perksA.appetiteDrainMultiplier,
    defenderComparePlushieDrainMultiplier: perksB.appetiteDrainMultiplier,
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

const OVERRIDE_KEYS: Array<RustBuiltInOverrideKey> = [
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
];

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
    const cd = Math.max(0.1, input.compareAirRuleCooldownSec);
    attacker.compareAirRuleCooldownSec = cd;
    defender.compareAirRuleCooldownSec = cd;
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
    const base = toRustComposableAbilityConfig(input.sourceCreature, input.opponentCreature);
    const withPresence = addAbilityPresenceFields(base, input.sourceCreature, input.opponentCreature);
    const withTrails = addTrailValues(
      withPresence,
      input.sourceCreature,
      input.opponentCreature,
      input.perksA.trails,
      input.perksB.trails,
    );
    abilityConfig = applyCompareTrapsGate(
      zeroConfigForDisabledAbilities(withTrails, disabledA, disabledB),
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

  if (input.badOmenOutcome) {
    abilityConfig.badOmenOutcome = {
      statusId: input.badOmenOutcome.statusId,
      stacks: input.badOmenOutcome.stacks,
      label: input.badOmenOutcome.label,
    };
  }

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
  // Weather cataclysm: the engine seeds a permanent weather status on each
  // non-immune side at setup. Immunity is resolved on the TS side and
  // delivered as the two flags below.
  if (input.weather && input.weather !== "none") {
    abilityConfig.weather = input.weather;
    abilityConfig.attackerWeatherImmune = input.attackerWeatherImmune ?? false;
    abilityConfig.defenderWeatherImmune = input.defenderWeatherImmune ?? false;
  }
  if (input.attackerStorming) {
    abilityConfig.attackerStorming = true;
  }
  if (input.defenderStorming) {
    abilityConfig.defenderStorming = true;
  }
  // Forward the per-side bite-variant mode picked from the
  // Compare "Specific / disputed abilities" chip. Default
  // `primaryOnly` mirrors today's behavior for any creature.
  abilityConfig.attackerBiteVariantMode = input.compareBiteVariantModeA;
  abilityConfig.defenderBiteVariantMode = input.compareBiteVariantModeB;

  return {
    attacker,
    defender,
    attackerBreath,
    defenderBreath,
    abilityPolicy: toRustAbilityTimingMode(input.abilityPolicy),
    abilityConfig,
  };
}
