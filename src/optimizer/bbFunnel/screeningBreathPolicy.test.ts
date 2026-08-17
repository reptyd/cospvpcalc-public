// Best Builds can now be set to the breath `ideal` policy, which was excluded
// because it replays the fight from every moment the breath could fire. The
// funnel is what makes it affordable: the setting reaches the stage that
// produces the displayed numbers and nothing before it. If screening ever
// starts carrying it, a run pays that replay on every surviving build.
import { describe, expect, it } from "vitest";
import { withoutIdealBreath } from "./funnelPipeline";

describe("screening does not carry the breath ideal policy", () => {
  it("strips it from either side", () => {
    const screened = withoutIdealBreath({
      extraAbilityConfig: { attackerBreathPolicy: "ideal", defenderBreathPolicy: "ideal" },
    });
    expect(screened?.extraAbilityConfig).toEqual({});
  });

  it("leaves the other breath policies alone", () => {
    const extras = {
      extraAbilityConfig: { attackerBreathPolicy: "onFullBar" as const, defenderBreathPolicy: "ideal" as const },
    };
    const screened = withoutIdealBreath(extras);
    expect(screened?.extraAbilityConfig).toEqual({ attackerBreathPolicy: "onFullBar" });
  });

  it("keeps every other setting, and does not touch the caller's object", () => {
    const extras = {
      extraAbilityConfig: { attackerBreathPolicy: "ideal" as const, compareDayNight: "night" as const },
    };
    const screened = withoutIdealBreath(extras);
    expect(screened?.extraAbilityConfig).toEqual({ compareDayNight: "night" });
    expect(extras.extraAbilityConfig).toEqual({ attackerBreathPolicy: "ideal", compareDayNight: "night" });
  });

  it("passes through untouched when no one asked for it", () => {
    const extras = { extraAbilityConfig: { compareDayNight: "day" as const } };
    expect(withoutIdealBreath(extras)).toBe(extras);
    expect(withoutIdealBreath(undefined)).toBeUndefined();
  });
});
