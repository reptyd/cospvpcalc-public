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
