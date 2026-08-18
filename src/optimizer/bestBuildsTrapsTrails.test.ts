import { describe, expect, it } from "vitest";
import type { CreatureRuntime } from "../engine";
import { applyBbTrapsTrailsToAbilityConfig } from "./bestBuildsBattleSettingsBridge";

const CREATURE = { name: "fixture", abilities: [] } as unknown as CreatureRuntime;

describe("Best Builds traps toggle", () => {
  it("turns off the two trap abilities and leaves Frost Snare alone [REF:compare_traps]", () => {
    const config = applyBbTrapsTrailsToAbilityConfig({}, CREATURE, CREATURE, {
      source: { traps: false, trails: false },
      opponent: { traps: false, trails: false },
    });
    expect(config?.attackerThornTrap).toBe(false);
    expect(config?.attackerToxicTrap).toBe(false);
    expect(config?.defenderThornTrap).toBe(false);
    expect(config?.defenderToxicTrap).toBe(false);
    // Frost Snare places no trap, and Compare's own traps setting does not
    // reach it, so the two surfaces would disagree if this toggle did.
    expect(config?.attackerFrostSnare).toBeUndefined();
    expect(config?.defenderFrostSnare).toBeUndefined();
  });

  it("leaves every trap alone while the setting is on", () => {
    const config = applyBbTrapsTrailsToAbilityConfig({}, CREATURE, CREATURE, {
      source: { traps: true, trails: false },
      opponent: { traps: true, trails: false },
    });
    expect(config?.attackerThornTrap).toBeUndefined();
    expect(config?.defenderToxicTrap).toBeUndefined();
  });
});
