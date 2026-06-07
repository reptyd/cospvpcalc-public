import type { AbilityTimingMode } from "../types";

export const POLICY_SEARCH_HORIZON_SEC = 24;
export const POLICY_SEARCH_STEP_SEC = 1;

export function isPrecisionPolicy(policy: AbilityTimingMode): boolean {
  return policy !== "reallyFast" && policy !== "fast";
}

export function getPolicySearchConfig(policy: AbilityTimingMode): { horizonSec: number; stepSec: number } {
  if (policy === "extreme") {
    return { horizonSec: 120, stepSec: 0.1 };
  }
  if (policy === "ideal") {
    return { horizonSec: 45, stepSec: 0.5 };
  }
  return { horizonSec: POLICY_SEARCH_HORIZON_SEC, stepSec: POLICY_SEARCH_STEP_SEC };
}
