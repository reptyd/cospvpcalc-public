import type { AbilityTimingMode, AbilityTimingOverrideName, AbilityTimingOverrides } from "./types";

export const TIMED_ABILITY_POLICY_OVERRIDE_NAMES: AbilityTimingOverrideName[] = [
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

/**
 * Per-ability timing overrides applied on top of the user-chosen
 * global mode. Empty entries fall through to the global mode (today
 * "Ideal" by default on the Compare / Best Builds settings).
 *
 * Warden's Rage stays on ReallyFast for now - the policy hasn't been
 * reworked yet and the historical "always on" Reference rule for it
 * is conservative enough that ReallyFast matches the desired
 * behavior.
 *
 * Hunker WAS pinned to ReallyFast as a workaround for the earlier
 * Ideal flicker bug (long fights → tick-by-tick on/off). After the
 * policy rework landed (hysteresis dead-zone + event-discrete adaptive window),
 * Ideal is the correct mode and the override is removed so users get
 * the math-ideal toggle behavior by default.
 */
export const DEFAULT_ABILITY_TIMING_OVERRIDES: AbilityTimingOverrides = {
  "Warden's Rage": "reallyFast",
};

export function sanitizeAbilityTimingOverrides(
  overrides: AbilityTimingOverrides | null | undefined,
): AbilityTimingOverrides {
  if (!overrides) return {};
  const next: AbilityTimingOverrides = {};
  for (const abilityName of TIMED_ABILITY_POLICY_OVERRIDE_NAMES) {
    const mode = overrides[abilityName];
    if (mode) {
      next[abilityName] = mode;
    }
  }
  return next;
}

export function resolveAbilityTimingModeForAbility(
  abilityName: string,
  defaultMode: AbilityTimingMode,
  overrides: AbilityTimingOverrides | null | undefined,
): AbilityTimingMode {
  const normalizedOverrides = overrides ?? {};
  return normalizedOverrides[abilityName as AbilityTimingOverrideName] ?? defaultMode;
}
