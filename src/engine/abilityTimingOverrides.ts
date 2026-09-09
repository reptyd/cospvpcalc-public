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
 * global mode. Empty entries fall through to the global mode, which
 * is Ideal by default on the Compare / Best Builds settings.
 *
 * Warden's Rage is the one entry. Its passive switches on with the
 * first damage taken below full HP and stays on, and really fast is
 * the mode that turns the manual one on immediately and keeps it
 * active - so really fast is the mode that matches the passive.
 *
 * Hunker is in the list above and carries no override. Its policy runs a
 * hysteresis dead-zone and an event-discrete adaptive window, so ideal is the
 * mode that matches it, and pinning it would take the ideal toggle behaviour
 * away by default.
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
