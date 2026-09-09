import { describe, expect, it } from "vitest";

import type { CreatureRuntime } from "../../engine";
import {
  buildCompareEffectiveAbilityTimingOverrides,
  getCompareAbilityTimingEffectiveMode,
  type CompareAbilityTimingOverrideDraft,
} from "./compareAbilityTimingPolicy";

function createCreature(name: string, abilities: string[]): CreatureRuntime {
  return {
    name,
    stats: {
      tier: 1,
      health: 100,
      weight: 100,
      damage: 10,
      biteCooldown: 1,
    },
    activatedAbilities: abilities.map((abilityName) => ({
      abilityId: abilityName.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
      name: abilityName,
      value: null,
      semantics: "neutral",
      subtype: null,
    })),
  };
}

describe("compareAbilityTimingPolicy", () => {
  it("applies compare defaults for supported abilities", () => {
    // Hunker was removed from the compare-default override map after
    // the policy rewrite - its Ideal toggle now uses hysteresis
    // and an event-discrete window, so the ReallyFast workaround is
    // no longer needed. Warden's Rage stays pinned (no policy rework
    // yet for it).
    const creature = createCreature("Test Warden", ["Warden's Rage", "Hunker"]);

    expect(buildCompareEffectiveAbilityTimingOverrides(creature, {})).toEqual({
      "Warden's Rage": "reallyFast",
    });
  });

  it("allows explicitly clearing a compare default back to the global mode", () => {
    const creature = createCreature("Test Warden", ["Warden's Rage"]);
    const draft: CompareAbilityTimingOverrideDraft = { "Warden's Rage": null };

    expect(buildCompareEffectiveAbilityTimingOverrides(creature, draft)).toEqual({});
    expect(getCompareAbilityTimingEffectiveMode("Warden's Rage", "ideal", draft)).toBe("ideal");
  });
});

// A chosen mode has to survive the builder. Dropping the `next[abilityName] =
// custom` line leaves the dropdown accepting a choice the fight never sees,
// with the default silently standing in for it - and the two cases above only
// exercised "no choice" and "cleared to null".
describe("a chosen timing mode reaches the fight [REF:policy_what_ability_policies_are]", () => {
  const carrier = createCreature("Probe", ["Fortify", "Rewind"]);

  it("keeps the mode the user picked, not the default", () => {
    const defaults = buildCompareEffectiveAbilityTimingOverrides(carrier, {});
    const chosen = buildCompareEffectiveAbilityTimingOverrides(carrier, { Fortify: "extreme" });

    expect(chosen.Fortify).toBe("extreme");
    // The point of the row: the choice has to differ from what it replaced, or
    // a builder that ignored it would look identical.
    expect(defaults.Fortify).not.toBe("extreme");
  });

  it("changes only the ability it was chosen for", () => {
    const defaults = buildCompareEffectiveAbilityTimingOverrides(carrier, {});
    const chosen = buildCompareEffectiveAbilityTimingOverrides(carrier, { Fortify: "extreme" });
    expect(chosen.Rewind).toBe(defaults.Rewind);
  });

  it("carries every mode the control offers", () => {
    for (const mode of ["reallyFast", "fast", "semiIdeal", "ideal", "extreme"] as const) {
      const built = buildCompareEffectiveAbilityTimingOverrides(carrier, { Fortify: mode });
      expect(built.Fortify, `mode ${mode}`).toBe(mode);
    }
  });
});
