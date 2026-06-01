import type { CreatureRuntime } from "./types";

export const DEFAULT_COMPARE_AIR_RULE_COOLDOWN_SEC = 1.8;

export function isCompareAirRuleEligible(creature?: CreatureRuntime | null): boolean {
  const type = creature?.stats.type?.trim() ?? "";
  return /flier|glider/i.test(type);
}
