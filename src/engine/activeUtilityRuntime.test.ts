import { describe, expect, it, vi } from "vitest";

import { createActiveUtilityRuntime } from "./activeUtilityRuntime";
import type { ActivesDeps } from "./activesRuntimeTypes";
import { baseStats } from "./engine.test.helpers";
import { buildFinalFromCreatureName, buildRuntimePair } from "./engineTestFixtures";

function createTestDeps(): ActivesDeps {
  return {
    disableReflect: "Reflect",
    reflectDurationSec: 30,
    reflectCooldownSec: 60,
    adrenalineDurationSec: 30,
    adrenalineCooldownSec: 90,
    drowsyAreaCooldownSec: 60,
    totemDurationSec: 120,
    totemCooldownSec: 120,
    totemTickSec: 3,
    hardenStacks: 8,
    hardenCooldownSec: 120,
    lichMarkCooldownSec: 30,
    lichMarkArmedWindowSec: 5,
    huntersCurseDurationSec: 30,
    huntersCurseCooldownSec: 90,
    unbridledRageDurationSec: 30,
    unbridledRageCooldownSec: 120,
    fortifyCooldownSec: 60,
    fortifyStacks: 10,
    statusStackDurationSec: 3.75,
    frostNovaCooldownSec: 20,
    frostNovaDurationSec: 15,
    frostNovaTickSec: 3,
    isAbilityDisabled: () => false,
    hasAbilityName: () => true,
    isPrecisionPolicy: () => true,
    isFortifyRemovableStatus: () => false,
    shouldActivateFortifyHeuristic: () => false,
    isReflectActiveAt: () => false,
    markAbilityApplied: (state, abilityName) => {
      state.abilityAppliedCounts[abilityName] = (state.abilityAppliedCounts[abilityName] ?? 0) + 1;
    },
    applyStatusToTarget: () => {},
    policyRuntime: {
      estimateIncomingDps: () => 0,
      shouldActivateReflectBySearch: () => false,
      shouldActivateAdrenalineBySearch: () => false,
      decideAdrenalineActivationBySearch: vi.fn(),
      shouldActivateHuntersCurseBySearch: () => false,
      decideHuntersCurseActivationBySearch: () => ({
        shouldActivate: false,
        chosenDelaySec: null,
        keepScore: { winRank: 1, ttk: 24, effectiveDamage: 0 },
        bestScore: { winRank: 1, ttk: 24, effectiveDamage: 0 },
        candidates: [],
      }),
      shouldActivateHuntersCurse: () => false,
      shouldActivateUnbridledRageBySearch: () => false,
      decideUnbridledRageActivationBySearch: () => ({
        shouldActivate: false,
        chosenDelaySec: null,
        keepScore: { winRank: 1, ttk: 24, effectiveDamage: 0 },
        bestScore: { winRank: 1, ttk: 24, effectiveDamage: 0 },
        candidates: [],
      }),
      shouldActivateUnbridledRage: () => false,
      shouldActivateFortifyBySearch: () => false,
      shouldActivateFrostNovaBySearch: () => false,
      shouldActivateRewindBySearch: () => false,
    },
  };
}

describe("activeUtilityRuntime Adrenaline planning", () => {
  it("schedules delayed Adrenaline and executes it on the due boundary", () => {
    const attacker = buildFinalFromCreatureName("Veishyadar");
    const defender = baseStats({ name: "Dummy", health: 20000, weight: 50000, damage: 10, biteCooldown: 1 });
    const pair = buildRuntimePair(attacker, defender);
    const deps = createTestDeps();
    const decisionMock = vi.mocked(deps.policyRuntime.decideAdrenalineActivationBySearch);
    decisionMock.mockReturnValue({
      shouldActivate: true,
      chosenDelaySec: 0.5,
      keepScore: { winRank: 0, ttk: 5, effectiveDamage: 100 },
      bestScore: { winRank: 0, ttk: 5.5, effectiveDamage: 120 },
      candidates: [
        { activationDelaySec: 0, score: { winRank: 0, ttk: 5, effectiveDamage: 110 } },
        { activationDelaySec: 0.5, score: { winRank: 0, ttk: 5.5, effectiveDamage: 120 } },
      ],
    });
    const runtime = createActiveUtilityRuntime(deps);

    runtime.updateAdrenaline(
      0,
      pair.attacker.runtime,
      pair.defender.runtime,
      pair.attacker.state,
      pair.defender.state,
      true,
      "semiIdeal",
      new Set(),
    );

    expect(pair.attacker.state.adrenalinePlannedAt).toBe(0.5);
    expect(pair.attacker.state.abilityAppliedCounts["Adrenaline"] ?? 0).toBe(0);

    runtime.updateAdrenaline(
      0.5,
      pair.attacker.runtime,
      pair.defender.runtime,
      pair.attacker.state,
      pair.defender.state,
      true,
      "semiIdeal",
      new Set(),
    );

    expect(pair.attacker.state.adrenalinePlannedAt).toBe(0);
    expect(pair.attacker.state.abilityAppliedCounts["Adrenaline"] ?? 0).toBe(1);
    expect(pair.attacker.state.adrenalineActiveUntil).toBe(30.5);
    expect(pair.attacker.state.adrenalineCooldownUntil).toBe(90.5);
  });
});
