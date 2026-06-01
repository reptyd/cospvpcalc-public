import { describe, expect, it } from "vitest";
import { applyRulesAndBuild } from "./engine";
import { __test_computeIncomingDamageMultiplier, __test_computeOutgoingDamageMultiplier } from "./engineTestApi";
import { creatureByName } from "./data";
import { buildRuntimeState, EMPTY_BUILD_0 } from "./engineTestFixtures";
import type { StatusAggregate } from "./runtimeContext";

function emptyMods(): StatusAggregate {
  return {
    damagePct: 0,
    damageBoostPct: 0,
    damageReductionPct: 0,
    biteCooldownIncreasePct: 0,
    biteCooldownIncreasePerStackPct: 0,
    weightReductionBasePct: 0,
    weightReductionPerStackPct: 0,
    weightReductionCapPct: 0,
    weightBoostPct: 0,
    weightBoostPerStackPct: 0,
    reflectsMeleeDamage: false,
    hpRegenDebuffPct: 0,
    hpRegenDebuffPerStackPct: 0,
    hpRegenBoostPct: 0,
    stamRegenPct: 0,
    disablesHpRegen: false,
  };
}

describe("First Strike mechanics", () => {
  it("applies First Strike even when actives are off", () => {
    // Adharcaiin replaces Sigmatox here — wiki removed First Strike
    // from Sigmatox during a previous sync, but the hand-maintained
    // effects-catalog kept it. Post-2026-05-12 the catalog is
    // re-derived from creatures.runtime on every wiki-sync, so
    // Sigmatox no longer carries First Strike. Adharcaiin has the
    // same value=0.2 the test previously asserted via Sigmatox.
    const creature = creatureByName["Adharcaiin"];
    if (!creature) throw new Error("Adharcaiin missing");
    const final = applyRulesAndBuild(creature, EMPTY_BUILD_0);
    const { runtime, state } = buildRuntimeState(final);

    state.hp = final.health;

    const withActivesOff = __test_computeOutgoingDamageMultiplier(runtime, state, emptyMods(), false);
    const withActivesOn = __test_computeOutgoingDamageMultiplier(runtime, state, emptyMods(), true);

    expect(withActivesOff).toBeGreaterThan(1);
    expect(withActivesOff).toBeCloseTo(withActivesOn, 8);
  });

  it("applies Guilt even when actives are off", () => {
    const creature = creatureByName["Nemni"];
    if (!creature) throw new Error("Nemni missing");
    const final = applyRulesAndBuild(creature, EMPTY_BUILD_0);
    const { runtime, state } = buildRuntimeState(final);

    const withActivesOff = __test_computeIncomingDamageMultiplier(runtime, state, emptyMods(), false);
    const withActivesOn = __test_computeIncomingDamageMultiplier(runtime, state, emptyMods(), true);

    expect(withActivesOn).toBeLessThan(1);
    expect(withActivesOff).toBeCloseTo(withActivesOn, 8);
  });
});
