import { normalizeAbilityName } from "../shared/abilityNameAliases";
import type { RustComposableAbilityConfig } from "./rustMatchupBridge";

// ---------------------------------------------------------------------------
// Declarative ability registry.
//
// "Name -> capability" knowledge for the abilities the engine recognises is
// currently spread across ~10 hand-maintained string sets in five files, none
// derivable from each other (COMPOSABLE_SUPPORTED_ACTIVATED/PASSIVE_NAMES, the
// narrow MODELED_OTHER_ABILITIES list, BOOL/VALUE_CONFIG_GATES, OVERRIDE_KEYS,
// GENERIC_TRAIL_STATUS, the CONTOUR_* no-op/prebuilt sets). A forgotten entry
// fails differently per list - inert in BB, un-disableable in Compare, or an
// ineligible matchup - which is why adding an ability is expensive and fragile.
//
// This file is the single source those lists derive from: one record per
// ability, plus pure `derive*` functions that rebuild each current list. It is
// not yet wired into any consumer; abilityRegistry.test.ts proves every derive
// reproduces its hand list before the consumers are switched over.
// ---------------------------------------------------------------------------

/**
 * A Compare config gate: the `RustComposableAbilityConfig` fields the ability
 * drives on each side. `kind` is `bool` for presence flags (`false` when
 * disabled) and `value` for numeric magnitudes (`0` when disabled).
 */
export type AbilityConfigGate = {
  attackerKey: keyof RustComposableAbilityConfig;
  defenderKey: keyof RustComposableAbilityConfig;
  kind: "bool" | "value";
};

/**
 * One record per ability. Every field maps to membership in exactly one
 * hand-maintained list; an ability sets only the flags that apply to it.
 * Flags are independent because an ability can sit in several lists at once -
 * Hunker is both an activated- and a passive-supported name, Adrenaline is an
 * activated-supported name and a no-effect passive.
 */
export type AbilityDescriptor = {
  /** Display name, normalised through `normalizeAbilityName` by the derive helpers. */
  name: string;
  /** Member of `COMPOSABLE_SUPPORTED_ACTIVATED_NAMES`. */
  composableActivated?: boolean;
  /** Member of `COMPOSABLE_SUPPORTED_PASSIVE_NAMES`. */
  composablePassive?: boolean;
  /** Member of the narrow engine-facing `MODELED_OTHER_ABILITIES` list. */
  modeledOther?: boolean;
  /** Member of `CONTOUR_NO_EFFECT_PASSIVE_NAMES`. */
  contourNoEffectPassive?: boolean;
  /** Member of `CONTOUR_TS_NO_OP_PASSIVE_NAMES`. */
  contourTsNoOpPassive?: boolean;
  /** Member of `CONTOUR_TS_NO_OP_ACTIVATED_NAMES`. */
  contourTsNoOpActivated?: boolean;
  /** Member of `CONTOUR_PREBUILT_ACTIVATED_NAMES`. */
  contourPrebuiltActivated?: boolean;
  /** Per-fight timing-override key (`OVERRIDE_KEYS`); the engine's override slot. */
  overrideKey?: boolean;
  /** Generic (non-flavor) damage trail: the engine status id it rides. */
  genericTrailStatusId?: string;
  /** Heals its owner by an amount that does NOT scale with the owner's max HP.
   * Such a source is non-monotone in the HP axis against %-max-HP damage - more
   * max HP scales the incoming damage up while the heal stays put - so the Best
   * Builds skyline prune refuses to order on health when one is present. */
  flatSelfHeal?: boolean;
  /** Compare config gate (`BOOL_CONFIG_GATES` / `VALUE_CONFIG_GATES`). */
  configGate?: AbilityConfigGate;
  /** The engine runs this ability rather than declaring the matchup ineligible,
   * even though part of it is unmodeled. Routing, not a coverage label - the
   * label comes from the Reference entry's own status. */
  routedDespitePartialModel?: boolean;
};

// Grouped by the part of the engine each ability touches; ordering inside a
// group follows the source list it was lifted from. The derive functions read
// flags, not position, so the grouping is for the reader only.
export const ABILITY_REGISTRY: AbilityDescriptor[] = [
  // --- Activated abilities with a Compare config gate ----------------------
  {
    name: "Thorn Trap",
    composableActivated: true,
    modeledOther: true,
    configGate: { attackerKey: "attackerThornTrap", defenderKey: "defenderThornTrap", kind: "bool" },
  },
  {
    name: "Toxic Trap",
    composableActivated: true,
    modeledOther: true,
    configGate: { attackerKey: "attackerToxicTrap", defenderKey: "defenderToxicTrap", kind: "bool" },
  },
  {
    name: "Frost Snare",
    composableActivated: true,
    modeledOther: true,
    configGate: { attackerKey: "attackerFrostSnare", defenderKey: "defenderFrostSnare", kind: "bool" },
  },
  {
    name: "Fortify",
    composableActivated: true,
    modeledOther: true,
    overrideKey: true,
    configGate: { attackerKey: "attackerFortify", defenderKey: "defenderFortify", kind: "bool" },
  },
  {
    name: "Drowsy Area",
    composableActivated: true,
    modeledOther: true,
    configGate: { attackerKey: "attackerDrowsyArea", defenderKey: "defenderDrowsyArea", kind: "bool" },
  },
  {
    name: "Unbridled Rage",
    composableActivated: true,
    modeledOther: true,
    overrideKey: true,
    configGate: { attackerKey: "attackerUnbridledRage", defenderKey: "defenderUnbridledRage", kind: "bool" },
  },
  {
    name: "Hunters Curse",
    composableActivated: true,
    modeledOther: true,
    overrideKey: true,
    configGate: { attackerKey: "attackerHuntersCurse", defenderKey: "defenderHuntersCurse", kind: "bool" },
  },
  {
    name: "Rewind",
    composableActivated: true,
    modeledOther: true,
    overrideKey: true,
    configGate: { attackerKey: "attackerRewind", defenderKey: "defenderRewind", kind: "bool" },
  },
  {
    name: "Warden's Rage",
    composableActivated: true,
    modeledOther: true,
    overrideKey: true,
    configGate: { attackerKey: "attackerWardenRage", defenderKey: "defenderWardenRage", kind: "bool" },
  },
  {
    name: "Adrenaline",
    composableActivated: true,
    modeledOther: true,
    overrideKey: true,
    contourNoEffectPassive: true,
    configGate: { attackerKey: "attackerAdrenaline", defenderKey: "defenderAdrenaline", kind: "bool" },
  },
  {
    name: "Lich Mark",
    composableActivated: true,
    modeledOther: true,
    configGate: { attackerKey: "attackerLichMark", defenderKey: "defenderLichMark", kind: "bool" },
  },
  {
    name: "Frost Nova",
    composableActivated: true,
    modeledOther: true,
    overrideKey: true,
    configGate: { attackerKey: "attackerFrostNova", defenderKey: "defenderFrostNova", kind: "bool" },
  },
  {
    name: "Reflux",
    composableActivated: true,
    modeledOther: true,
    routedDespitePartialModel: true,
    configGate: { attackerKey: "attackerReflux", defenderKey: "defenderReflux", kind: "bool" },
  },
  {
    name: "Totem",
    composableActivated: true,
    modeledOther: true,
    configGate: { attackerKey: "attackerTotem", defenderKey: "defenderTotem", kind: "bool" },
  },
  {
    name: "Guardians Passage",
    composableActivated: true,
    modeledOther: true,
    overrideKey: true,
    configGate: {
      attackerKey: "attackerGuardiansPassage",
      defenderKey: "defenderGuardiansPassage",
      kind: "bool",
    },
  },
  {
    name: "Reflect",
    composableActivated: true,
    modeledOther: true,
    overrideKey: true,
    configGate: { attackerKey: "attackerReflect", defenderKey: "defenderReflect", kind: "bool" },
  },
  {
    name: "Cause Fear",
    composableActivated: true,
    modeledOther: true,
    configGate: { attackerKey: "attackerCauseFear", defenderKey: "defenderCauseFear", kind: "bool" },
  },
  {
    name: "Grim Lariat",
    composableActivated: true,
    modeledOther: true,
    configGate: { attackerKey: "attackerGrimLariat", defenderKey: "defenderGrimLariat", kind: "bool" },
  },
  {
    name: "Hunker",
    composableActivated: true,
    composablePassive: true,
    modeledOther: true,
    overrideKey: true,
    configGate: { attackerKey: "attackerHunker", defenderKey: "defenderHunker", kind: "bool" },
  },
  {
    name: "Divination",
    composableActivated: true,
    modeledOther: true,
    configGate: { attackerKey: "attackerDivination", defenderKey: "defenderDivination", kind: "bool" },
  },
  {
    name: "Poison Area",
    composableActivated: true,
    modeledOther: true,
    configGate: { attackerKey: "attackerPoisonArea", defenderKey: "defenderPoisonArea", kind: "bool" },
  },
  {
    name: "Yolk Bomb",
    composableActivated: true,
    modeledOther: true,
    configGate: { attackerKey: "attackerYolkBomb", defenderKey: "defenderYolkBomb", kind: "bool" },
  },
  {
    name: "Harden",
    composableActivated: true,
    modeledOther: true,
    contourPrebuiltActivated: true,
    configGate: { attackerKey: "attackerHarden", defenderKey: "defenderHarden", kind: "bool" },
  },
  {
    name: "Cocoon",
    composableActivated: true,
    modeledOther: true,
    overrideKey: true,
    configGate: { attackerKey: "attackerCocoon", defenderKey: "defenderCocoon", kind: "bool" },
  },
  {
    name: "Expunge",
    composableActivated: true,
    modeledOther: true,
    configGate: { attackerKey: "attackerExpunge", defenderKey: "defenderExpunge", kind: "bool" },
  },
  {
    name: "Life Leech",
    composableActivated: true,
    modeledOther: true,
    overrideKey: true,
    flatSelfHeal: true,
    configGate: { attackerKey: "attackerLifeLeechValue", defenderKey: "defenderLifeLeechValue", kind: "value" },
  },
  {
    name: "Cursed Sigil",
    composableActivated: true,
    modeledOther: true,
    configGate: { attackerKey: "attackerCursedSigilStacks", defenderKey: "defenderCursedSigilStacks", kind: "value" },
  },
  {
    name: "Spite",
    composableActivated: true,
    modeledOther: true,
    configGate: { attackerKey: "attackerSpiteValue", defenderKey: "defenderSpiteValue", kind: "value" },
  },
  {
    name: "Shadow Barrage",
    composableActivated: true,
    modeledOther: true,
    configGate: { attackerKey: "attackerShadowBarrageValue", defenderKey: "defenderShadowBarrageValue", kind: "value" },
  },

  // --- Activated abilities without a config gate ---------------------------
  { name: "Aura (Disease)", composableActivated: true, modeledOther: true },
  { name: "Aura (Corrosion)", composableActivated: true, modeledOther: true },
  { name: "Aura (Burn)", composableActivated: true, modeledOther: true },

  // --- Passive abilities ---------------------------------------------------
  { name: "Wing Shredder", composablePassive: true, modeledOther: true },
  { name: "Serrated Teeth", composablePassive: true, modeledOther: true },
  { name: "First Strike", composablePassive: true, modeledOther: true },
  { name: "Warden's Resistance", composablePassive: true, modeledOther: true },
  { name: "Berserk", composablePassive: true, modeledOther: true },
  { name: "Guilt", composablePassive: true, modeledOther: true },
  { name: "Unbreakable", composablePassive: true, modeledOther: true },
  { name: "Sticky Fur", composablePassive: true, modeledOther: true },
  { name: "Self-Destruct", composablePassive: true, modeledOther: true },
  { name: "Quick Recovery", composablePassive: true },
  { name: "Stubborn Stacker", composablePassive: true, modeledOther: true },
  { name: "Block Bleed", composablePassive: true },
  { name: "Block Burn", composablePassive: true },
  { name: "Block Disease", composablePassive: true },
  { name: "Block Frostbite", composablePassive: true },
  { name: "Block Injury", composablePassive: true },
  { name: "Block Necropoison", composablePassive: true },
  { name: "Block Poison", composablePassive: true },
  { name: "Bleed Attack", composablePassive: true },
  { name: "Burn Attack", composablePassive: true },
  { name: "Corrosion Attack", composablePassive: true },
  { name: "Disease Attack", composablePassive: true },
  { name: "Frostbite Attack", composablePassive: true },
  { name: "Injury Attack", composablePassive: true },
  { name: "Necropoison Attack", composablePassive: true },
  { name: "Poison Attack", composablePassive: true },
  { name: "Defensive Bleed", composablePassive: true },
  { name: "Defensive Burn", composablePassive: true },
  { name: "Defensive Corrosion", composablePassive: true },
  { name: "Defensive Disease", composablePassive: true },
  { name: "Defensive Frostbite", composablePassive: true },
  { name: "Defensive Injury", composablePassive: true },
  { name: "Defensive Necropoison", composablePassive: true },
  { name: "Defensive Paralyze", composablePassive: true },
  { name: "Defensive Poison", composablePassive: true },
  { name: "Ligament Tear", composablePassive: true, modeledOther: true },

  // --- No-effect / no-op contour passives ----------------------------------
  { name: "Breath Resistance", contourNoEffectPassive: true, modeledOther: true },
  { name: "Volcanic", contourNoEffectPassive: true },
  { name: "Frosty", contourNoEffectPassive: true },
  { name: "Toxic Trail", contourNoEffectPassive: true, modeledOther: true },
  { name: "Plague Trail", contourNoEffectPassive: true, modeledOther: true },
  { name: "Flame Trail", contourNoEffectPassive: true, modeledOther: true },
  { name: "Frost Trail", contourNoEffectPassive: true, modeledOther: true },
  { name: "Healing Step", contourNoEffectPassive: true, modeledOther: true },
  { name: "Silent Hunter", contourNoEffectPassive: true },
  { name: "Ambush", contourNoEffectPassive: true },
  { name: "Charge Power", contourNoEffectPassive: true },
  { name: "Driver", contourNoEffectPassive: true },
  { name: "Block", contourNoEffectPassive: true },
  { name: "Channeling", contourTsNoOpPassive: true },
  { name: "Gourmandizer", contourTsNoOpPassive: true, contourTsNoOpActivated: true, routedDespitePartialModel: true },

  // --- Activated no-op contour names ---------------------------------------
  { name: "DefiledGround", contourTsNoOpActivated: true },
  { name: "Defiled Ground", contourTsNoOpActivated: true },

  // --- Prebuilt-contour activated, no Compare config gate ------------------
  { name: "Two-Faced", contourPrebuiltActivated: true, modeledOther: true },

  // --- Generic (non-flavor) damage trails ----------------------------------
  { name: "Necropoison Trail", genericTrailStatusId: "Necropoison_Status" },
  { name: "Radiation Trail", genericTrailStatusId: "Radiation_Status" },
  // Blood Trail rides the generic channel with Bleed; the "Blood" name
  // doesn't match the "Bleed" status, so it was never auto-detected.
  { name: "Blood Trail", genericTrailStatusId: "Bleed_Status" },

  // --- Modeled-other entries with no TS-side list membership ---------------
  // Engine-recognised breaths/beams the narrow MODELED_OTHER list credits so
  // their carrier matchups stay eligible; none belongs to a contour/config set.
  { name: "Lance", modeledOther: true },
  { name: "Heal Breath", modeledOther: true },
  { name: "Solar Beam", modeledOther: true },
  { name: "Spirit Glare", modeledOther: true },
  { name: "Cloud Breath", modeledOther: true },
];

// ---------------------------------------------------------------------------
// Derive functions - each rebuilds one current hand list from the registry.
// ---------------------------------------------------------------------------

function normalizedNamesWhere(predicate: (entry: AbilityDescriptor) => boolean): string[] {
  return ABILITY_REGISTRY.filter(predicate).map((entry) => normalizeAbilityName(entry.name));
}

export function deriveComposableSupportedActivatedNames(): Set<string> {
  return new Set(normalizedNamesWhere((entry) => entry.composableActivated === true));
}

export function deriveComposableSupportedPassiveNames(): Set<string> {
  return new Set(normalizedNamesWhere((entry) => entry.composablePassive === true));
}

export function deriveFlatSelfHealNames(): Set<string> {
  return new Set(normalizedNamesWhere((entry) => entry.flatSelfHeal === true));
}

export function deriveModeledOtherAbilityNames(): Set<string> {
  return new Set(normalizedNamesWhere((entry) => entry.modeledOther === true));
}

/** The narrow engine-facing modeled-other list as display names, in registry
 *  order. Consumers that key off the raw display name (parenthetical subtypes,
 *  wiki-sync canonicalisation) read this; eligibility reads the normalised set. */
export function deriveModeledOtherAbilities(): string[] {
  return ABILITY_REGISTRY.filter((entry) => entry.modeledOther === true).map((entry) => entry.name);
}

// The explicit "routed" set the fail-open keys on: the abilities the engine has
// a real handler / contour route for AND credits to keep a carrier eligible.
// An ability NOT in here is treated as ignorable-unimplemented - the engine has
// no handler for the name, so it just doesn't act on it and the fight runs as if
// the ability isn't there; it must never block the matchup.
//
// Two parts, both engine facts:
//  - the narrow `modeledOther` flag (the engine-recognised activated/passive/
//    breath/beam abilities), and
//  - `routedDespitePartialModel`: abilities the engine handles well enough to
//    run rather than skip, even though part of them is unmodeled.
//
// Deliberately derived from the registry's own routing intent, NOT from the
// coverage-display classification (`isModeledForCoverage` /
// `REFERENCE_MODELED_ABILITY_NAMES`). That is what decouples eligibility from
// coverage: a name that is "modeled for coverage" but unrouted (the canonical
// Zeoarex "Radiation Trail" case - a generic trail with no contour handler)
// stays out of this set and never gates a matchup, so a coverage-side edit can
// no longer flip a matchup ineligible.
export function deriveComposableRoutedNames(): Set<string> {
  return new Set<string>([
    ...deriveModeledOtherAbilityNames(),
    ...normalizedNamesWhere((entry) => entry.routedDespitePartialModel === true),
  ]);
}

/**
 * Frozen routed-name set used by the fail-open eligibility decision. Module-level
 * so the per-matchup hot path reads a prebuilt set instead of rebuilding it.
 */
export const COMPOSABLE_ROUTED_NAMES = deriveComposableRoutedNames();

export function deriveContourNoEffectPassiveNames(): Set<string> {
  return new Set(normalizedNamesWhere((entry) => entry.contourNoEffectPassive === true));
}

export function deriveContourTsNoOpPassiveNames(): Set<string> {
  return new Set(normalizedNamesWhere((entry) => entry.contourTsNoOpPassive === true));
}

export function deriveContourTsNoOpActivatedNames(): Set<string> {
  return new Set(normalizedNamesWhere((entry) => entry.contourTsNoOpActivated === true));
}

export function deriveContourPrebuiltActivatedNames(): Set<string> {
  return new Set(normalizedNamesWhere((entry) => entry.contourPrebuiltActivated === true));
}

export function deriveOverrideKeyNames(): Set<string> {
  return new Set(normalizedNamesWhere((entry) => entry.overrideKey === true));
}

/** Override-key ability display names in registry order. The consumer pins the
 *  element type to its `RustAbilityPolicyOverrides` keys; every name here is a
 *  display name that matches one of those keys verbatim. */
export function deriveOverrideKeys(): string[] {
  return ABILITY_REGISTRY.filter((entry) => entry.overrideKey === true).map((entry) => entry.name);
}

export function deriveGenericTrailStatus(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const entry of ABILITY_REGISTRY) {
    if (entry.genericTrailStatusId) out[entry.name] = entry.genericTrailStatusId;
  }
  return out;
}

/** A config gate row in the `{ ability, attackerKey, defenderKey }` shape the
 *  current `BOOL_CONFIG_GATES` / `VALUE_CONFIG_GATES` arrays use. */
export type DerivedConfigGate = {
  ability: string;
  attackerKey: keyof RustComposableAbilityConfig;
  defenderKey: keyof RustComposableAbilityConfig;
};

function deriveConfigGates(kind: "bool" | "value"): DerivedConfigGate[] {
  const out: DerivedConfigGate[] = [];
  for (const entry of ABILITY_REGISTRY) {
    if (entry.configGate?.kind === kind) {
      out.push({
        ability: entry.name,
        attackerKey: entry.configGate.attackerKey,
        defenderKey: entry.configGate.defenderKey,
      });
    }
  }
  return out;
}

export function deriveBoolConfigGates(): DerivedConfigGate[] {
  return deriveConfigGates("bool");
}

export function deriveValueConfigGates(): DerivedConfigGate[] {
  return deriveConfigGates("value");
}
