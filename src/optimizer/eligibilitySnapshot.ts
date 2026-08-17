import { creaturesData } from "../engine/creatureData";
import {
  getRustUnsupportedActivatedAbilityNamesForComposable,
  getRustUnsupportedPassiveAbilityNamesForBreath,
} from "./rustBestBuildsRuntime";

/**
 * Per-creature snapshot of the ability names the Rust best-builds / passive-
 * contour eligibility path treats as UNSUPPORTED. A non-empty entry means the
 * creature carries an ability the engine can neither route nor safely ignore,
 * which makes its matchups ineligible ("battle stops running"). Pure, per-
 * creature, no WASM. Frozen as a committed baseline so an eligibility
 * regression (e.g. the Zeoarex "Radiation Trail" break) surfaces as an explicit
 * diff in CI instead of silently reaching prod.
 */
export type EligibilityUnsupportedSnapshot = Record<
  string,
  { passive?: string[]; activated?: string[] }
>;

export function computeEligibilityUnsupportedSnapshot(): EligibilityUnsupportedSnapshot {
  const snapshot: EligibilityUnsupportedSnapshot = {};
  for (const creature of creaturesData) {
    const passive = [...getRustUnsupportedPassiveAbilityNamesForBreath(creature)].sort();
    const activated = [...getRustUnsupportedActivatedAbilityNamesForComposable(creature)].sort();
    if (passive.length === 0 && activated.length === 0) continue;
    const entry: { passive?: string[]; activated?: string[] } = {};
    if (passive.length) entry.passive = passive;
    if (activated.length) entry.activated = activated;
    snapshot[creature.name] = entry;
  }
  // Stable key order so the committed JSON diff is review-friendly.
  return Object.fromEntries(
    Object.keys(snapshot).sort().map((name) => [name, snapshot[name]]),
  ) as EligibilityUnsupportedSnapshot;
}
