import { describe, expect, it } from "vitest";
import baseline from "./eligibilityUnsupported.baseline.json";
import { computeEligibilityUnsupportedSnapshot } from "./eligibilitySnapshot";

// Roster-wide engine-eligibility regression guard. The Zeoarex break (a
// coverage-side broadening leaked into the engine's isModeledOtherAbility, so
// "Radiation Trail" became un-ignorable -> un-routable -> the matchup could not
// run) reached prod because nothing exercised eligibility across the real
// creature roster. This freezes that surface: any creature whose unsupported-
// ability set changes (an ability the engine can neither route nor safely
// ignore) fails here, on the exact creature + ability, before prod.
describe("roster engine-eligibility regression guard", () => {
  it("every creature's unsupported-ability set matches the committed baseline", () => {
    const current = computeEligibilityUnsupportedSnapshot();
    // On failure vitest prints which creature/ability changed. If the change is
    // intentional (a newly modeled/routed ability, or a deliberately accepted
    // unsupported one), regenerate the baseline and review the diff:
    //   npx tsx tools/generate_eligibility_unsupported_baseline.ts
    expect(current).toEqual(baseline);
  });
});
