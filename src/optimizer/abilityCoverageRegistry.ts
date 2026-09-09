import { MODELED_OTHER_ABILITIES } from "../shared/modeledOtherAbilities";
import { normalizeAbilityName } from "../shared/abilityNameAliases";
import { GENERIC_TRAIL_STATUS } from "./runtimeAbilityValue";
import {
  REFERENCE_MODELED_ABILITY_NAMES,
  REFERENCE_NOT_MODELED_ABILITY_NAMES,
  REFERENCE_OUT_OF_MODEL_ABILITY_NAMES,
  REFERENCE_PARTIAL_ABILITY_NAMES,
  REFERENCE_SPEED_BUILDS_ONLY_ABILITY_NAMES,
} from "../pages/referenceContent";

export { normalizeAbilityName };

// ENGINE-facing NARROW set: the curated abilities the engine actually has a real
// handler / passive-contour route for. rustBestBuildsRuntime + rustPassiveContour
// gate on isModeledOtherAbility to split "ignorable unimplemented" abilities (the
// engine skips them, the fight runs without them) from routed ones. It MUST stay
// narrow: a false-positive routes an UNHANDLED ability into the contour and BLOCKS
// the matchup. Reference-derived breadth is for COVERAGE DISPLAY only - see
// isModeledForCoverage / REFERENCE_MODELED_NAME_SET.
export const MODELED_OTHER_ABILITY_NAMES = new Set(MODELED_OTHER_ABILITIES.map(normalizeAbilityName));
// COVERAGE-facing BROAD set: everything the Reference marks Modeled / Compare-only.
const REFERENCE_MODELED_NAME_SET = new Set(REFERENCE_MODELED_ABILITY_NAMES.map(normalizeAbilityName));
// Generic damage trails (Radiation/Necropoison/...) are modeled by the engine's
// GENERIC trail channel (`GENERIC_TRAIL_STATUS` in runtimeAbilityValue), not the
// dedicated flavor fields the manual list covers (Flame/Frost/Plague/Toxic).
// Crediting the engine's own trail registry here keeps coverage from greying a
// trail the engine actually simulates - and auto-tracks any future row added
// to GENERIC_TRAIL_STATUS without a second edit.
const GENERIC_TRAIL_ABILITY_NAMES = new Set(
  Object.keys(GENERIC_TRAIL_STATUS).map(normalizeAbilityName),
);
// The three display buckets, all read off the Reference entry's own status.
// One source, so the coloured label in Compare and the coverage count can no
// longer disagree with the entry a reader opens.
export const OUT_OF_MODEL_ABILITIES = new Set(
  REFERENCE_OUT_OF_MODEL_ABILITY_NAMES.map(normalizeAbilityName),
);
export const NOT_MODELED_ABILITY_NAMES = new Set(
  REFERENCE_NOT_MODELED_ABILITY_NAMES.map(normalizeAbilityName),
);
export const PARTIAL_MODELED_ABILITY_NAMES = new Set(
  REFERENCE_PARTIAL_ABILITY_NAMES.map(normalizeAbilityName),
);
export const SPEED_BUILDS_ONLY_ABILITY_NAMES = new Set(
  REFERENCE_SPEED_BUILDS_ONLY_ABILITY_NAMES.map(normalizeAbilityName),
);

// A "Base (Variant)" ability (Aura (Corrosion), Lance (Frostbite),
// Unbreakable (12)) is ONE ability whose parenthetical is just a value, so it
// matches its single base Reference entry. The four flavored trails each carry
// their own Reference entry and already match by full name.
function baseAbilityName(name: string): string {
  return name.replace(/\s*\([^)]*\)\s*$/, "").trim();
}

// NARROW, ENGINE-facing: does the engine have a real handler / contour route for
// this ability? Curated hand-list only - deliberately NO base-name / Reference /
// generic-trail breadth, because a false-positive here routes an unhandled ability
// into the passive contour and BLOCKS the matchup (see rustPassiveContourShared).
export function isModeledOtherAbility(abilityName: string, creatureName?: string): boolean {
  void creatureName;
  return MODELED_OTHER_ABILITY_NAMES.has(normalizeAbilityName(abilityName));
}

// BROAD, COVERAGE-DISPLAY-ONLY: every ability the Reference marks Modeled /
// Compare-only, matched by full name, base name (Aura (Corrosion) -> Aura), or the
// engine's generic damage-trail channel. NEVER feed this to the engine/contour
// path - it intentionally credits toggle-backed + generic-trail abilities the
// contour has no handler for (correct for the grey indicator, fatal for routing).
export function isModeledForCoverage(abilityName: string): boolean {
  const normalized = normalizeAbilityName(abilityName);
  if (GENERIC_TRAIL_ABILITY_NAMES.has(normalized)) return true;
  if (REFERENCE_MODELED_NAME_SET.has(normalized)) return true;
  const base = normalizeAbilityName(baseAbilityName(abilityName));
  return base !== normalized && REFERENCE_MODELED_NAME_SET.has(base);
}

export function isOutOfModelAbility(abilityName: string): boolean {
  return OUT_OF_MODEL_ABILITIES.has(normalizeAbilityName(abilityName));
}

export function isNotModeledAbility(abilityName: string): boolean {
  return NOT_MODELED_ABILITY_NAMES.has(normalizeAbilityName(abilityName));
}

export function isPartialModeledAbility(abilityName: string): boolean {
  return PARTIAL_MODELED_ABILITY_NAMES.has(normalizeAbilityName(abilityName));
}

export function isSpeedBuildsOnlyAbility(abilityName: string): boolean {
  return SPEED_BUILDS_ONLY_ABILITY_NAMES.has(normalizeAbilityName(abilityName));
}
