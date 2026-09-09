import type {
  AbilityTimingMode,
  AbilityTimingOverrideName,
  AbilityTimingOverrides,
  CreatureRuntime,
} from "../../engine";
import {
  DEFAULT_ABILITY_TIMING_OVERRIDES,
  TIMED_ABILITY_POLICY_OVERRIDE_NAMES,
} from "../../engine/abilityTimingOverrides";
import { creatureHasAbility } from "./compareSpecialAbilities";

export type CompareAbilityTimingOverrideDraft = Partial<Record<AbilityTimingOverrideName, AbilityTimingMode | null>>;

export const COMPARE_DEFAULT_ABILITY_TIMING_OVERRIDES: AbilityTimingOverrides = DEFAULT_ABILITY_TIMING_OVERRIDES;

export const ABILITY_TIMING_MODE_LABELS: Record<AbilityTimingMode, string> = {
  reallyFast: "Really fast",
  fast: "Fast",
  semiIdeal: "Semi-ideal",
  ideal: "Ideal",
  extreme: "Extreme",
};

export const ABILITY_TIMING_MODE_OPTIONS: AbilityTimingMode[] = [
  "reallyFast",
  "fast",
  "semiIdeal",
  "ideal",
  "extreme",
];

export function getCompareAvailableAbilityTimingNames(creature: CreatureRuntime | undefined): AbilityTimingOverrideName[] {
  return TIMED_ABILITY_POLICY_OVERRIDE_NAMES.filter((abilityName) => creatureHasAbility(creature, abilityName));
}

export function sanitizeCompareAbilityTimingOverrideDraft(
  draft: CompareAbilityTimingOverrideDraft,
  creature: CreatureRuntime | undefined,
): CompareAbilityTimingOverrideDraft {
  const allowed = new Set(getCompareAvailableAbilityTimingNames(creature));
  const next: CompareAbilityTimingOverrideDraft = {};
  for (const abilityName of TIMED_ABILITY_POLICY_OVERRIDE_NAMES) {
    if (!allowed.has(abilityName)) continue;
    if (draft[abilityName] !== undefined) {
      next[abilityName] = draft[abilityName];
    }
  }
  return next;
}

export function buildCompareEffectiveAbilityTimingOverrides(
  creature: CreatureRuntime | undefined,
  draft: CompareAbilityTimingOverrideDraft,
): AbilityTimingOverrides {
  const allowed = new Set(getCompareAvailableAbilityTimingNames(creature));
  const next: AbilityTimingOverrides = {};
  for (const abilityName of TIMED_ABILITY_POLICY_OVERRIDE_NAMES) {
    if (!allowed.has(abilityName)) continue;
    const custom = draft[abilityName];
    if (custom === null) continue;
    if (custom) {
      next[abilityName] = custom;
      continue;
    }
    const defaultMode = COMPARE_DEFAULT_ABILITY_TIMING_OVERRIDES[abilityName];
    if (defaultMode) {
      next[abilityName] = defaultMode;
    }
  }
  return next;
}

export function countCompareEffectiveAbilityTimingOverrides(
  creature: CreatureRuntime | undefined,
  draft: CompareAbilityTimingOverrideDraft,
): number {
  return Object.keys(buildCompareEffectiveAbilityTimingOverrides(creature, draft)).length;
}

export function countCompareCustomAbilityTimingOverrides(
  creature: CreatureRuntime | undefined,
  draft: CompareAbilityTimingOverrideDraft,
): number {
  const allowed = new Set(getCompareAvailableAbilityTimingNames(creature));
  let count = 0;
  for (const abilityName of TIMED_ABILITY_POLICY_OVERRIDE_NAMES) {
    if (!allowed.has(abilityName)) continue;
    if (draft[abilityName] !== undefined) count += 1;
  }
  return count;
}

export function getCompareAbilityTimingOverrideSource(
  abilityName: AbilityTimingOverrideName,
  draft: CompareAbilityTimingOverrideDraft,
): "global" | "compareDefault" | "custom" {
  const choice = draft[abilityName];
  if (choice === null) return "global";
  if (choice) return "custom";
  return COMPARE_DEFAULT_ABILITY_TIMING_OVERRIDES[abilityName] ? "compareDefault" : "global";
}

export function getCompareAbilityTimingEffectiveMode(
  abilityName: AbilityTimingOverrideName,
  globalMode: AbilityTimingMode,
  draft: CompareAbilityTimingOverrideDraft,
): AbilityTimingMode {
  const choice = draft[abilityName];
  if (choice === null) return globalMode;
  if (choice) return choice;
  return COMPARE_DEFAULT_ABILITY_TIMING_OVERRIDES[abilityName] ?? globalMode;
}
