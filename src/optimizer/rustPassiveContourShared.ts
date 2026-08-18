import { isOutOfModelAbility } from "./abilityCoverageRegistry";
import { normalizeAbilityName } from "../shared/abilityNameAliases";
import { COMPOSABLE_ROUTED_NAMES, deriveContourTsNoOpActivatedNames } from "./abilityRegistry";

// Includes "Defiled Ground" (activated, with space), a data-surface artifact:
// Reference classifies it as Compare-only / Disputed, TS has no combat handler
// for the activated entry, and the real Compare buff flows through the
// compareDefiledGroundLevel perk. Listed alongside "DefiledGround" (the
// otherAbility marker name) for no-op eligibility.
export const CONTOUR_TS_NO_OP_ACTIVATED_NAMES = deriveContourTsNoOpActivatedNames();

export function isOutOfModelAbilityName(name: string): boolean {
  return isOutOfModelAbility(name);
}

export function isIgnoredUnimplementedAbilityName(name: string): boolean {
  // Fail open for any ability the engine has no route for. The decision keys on
  // the explicit COMPOSABLE_ROUTED_NAMES set - the abilities the engine actually
  // has a handler / contour route for - so anything outside it is treated as an
  // ignorable "not modeled" ability: the Rust engine has no handler for a name
  // it doesn't recognize, so it simply doesn't act on it and the fight runs as
  // if the ability isn't there - it is counted without it. Brand-new or unclassified
  // abilities therefore fail open instead of blocking the matchup.
  //
  // Keying on the routed set (not the coverage-facing isModeledOtherAbility /
  // isModeledForCoverage classification) decouples eligibility from coverage: a
  // name that is "modeled for coverage" but unrouted - the Zeoarex "Radiation
  // Trail" case - is not in the routed set, so a coverage-side edit can no
  // longer flip a matchup ineligible. Coverage classifies the same ability
  // through its own independent path, so the surfaced label stays accurate.
  return !COMPOSABLE_ROUTED_NAMES.has(normalizeAbilityName(name));
}

export const DEFAULT_PASSIVE_CONTOUR_ABILITY_FILTERS = {
  isOutOfModelAbilityName,
  isIgnoredUnimplementedAbilityName,
} as const;
