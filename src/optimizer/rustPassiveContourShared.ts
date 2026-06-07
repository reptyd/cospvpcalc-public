import { normalizeAbilityName } from "../engine/runtimeHelpers";
import { isModeledOtherAbility, isOutOfModelAbility, isPartialModeledAbility } from "./abilityCoverageRegistry";

// "Defiled Ground" (activated, with space) is a data-surface artifact: Reference
// classifies it as Compare-only / Disputed, TS has no combat handler for the
// activated entry, and the real Compare buff flows through the
// compareDefiledGroundLevel perk. Listed alongside "DefiledGround" (the
// otherAbility marker name) for no-op eligibility.
export const CONTOUR_TS_NO_OP_ACTIVATED_NAMES = new Set(
  ["Gourmandizer", "DefiledGround", "Defiled Ground"].map(normalizeAbilityName),
);

export function isOutOfModelAbilityName(name: string): boolean {
  return isOutOfModelAbility(name);
}

export function isIgnoredUnimplementedAbilityName(name: string): boolean {
  // Fail open for any ability we don't explicitly model. An ability that is
  // neither in MODELED_OTHER nor partially modeled is treated as an ignorable
  // "not modeled" ability - this covers the deferred / not-modeled / out-of-
  // model buckets AND brand-new or otherwise unclassified abilities the author
  // hasn't categorized yet. Such an ability must NOT block the whole matchup:
  // the Rust engine has no handler for an ability name it doesn't recognize,
  // so it simply doesn't act on it and the fight runs as if the ability isn't
  // there ("считается без неё"). Coverage classifies the same ability as
  // "not-modeled" through its own independent path, so the surfaced label
  // stays accurate. Modeled / partial abilities are excluded so they keep
  // their real engine handling and contour routing.
  return !isModeledOtherAbility(name) && !isPartialModeledAbility(name);
}

export const DEFAULT_PASSIVE_CONTOUR_ABILITY_FILTERS = {
  isOutOfModelAbilityName,
  isIgnoredUnimplementedAbilityName,
} as const;
