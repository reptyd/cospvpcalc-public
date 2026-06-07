import { describe, expect, it } from "vitest";

import {
  decideTimedAbilityActivation,
  decideTimedAbilityModeChoice,
  decideTimedAbilityStateTransform,
  decideTimedAbilityToggleState,
} from "./timedAbilityPolicyRuntime";
import type { PolicyProjectionOptions } from "./policyRuntimeTypes";
import type { CombatantRuntime, CombatantState } from "./runtimeContext";
import type { AbilityTimingMode } from "./types";

describe("timedAbilityPolicyRuntime", () => {
  it("toggles only when the toggled state scores better than the current state", () => {
    const keepScore = { winRank: 1, ttk: 12, effectiveDamage: 100 };
    const toggledScore = { winRank: 2, ttk: 11, effectiveDamage: 120 };
    const decision = decideTimedAbilityToggleState(false, keepScore, toggledScore);
    expect(decision.shouldToggle).toBe(true);
    expect(decision.nextValue).toBe(true);
  });

  it("keeps the current toggle state when the candidate does not improve score", () => {
    const keepScore = { winRank: 1, ttk: 10, effectiveDamage: 140 };
    const toggledScore = { winRank: 1, ttk: 10, effectiveDamage: 120 };
    const decision = decideTimedAbilityToggleState(true, keepScore, toggledScore);
    expect(decision.shouldToggle).toBe(false);
    expect(decision.nextValue).toBe(true);
  });

  it("applies a transformed state only when it projects better than keeping the current state", () => {
    const keepScore = { winRank: 1, ttk: 15, effectiveDamage: 80 };
    const transformedScore = { winRank: 2, ttk: 13, effectiveDamage: 100 };
    expect(decideTimedAbilityStateTransform(keepScore, transformedScore).shouldTransform).toBe(true);
    expect(decideTimedAbilityStateTransform(transformedScore, keepScore).shouldTransform).toBe(false);
  });

  it("selects the strongest named ability mode choice", () => {
    const decision = decideTimedAbilityModeChoice([
      { id: "release", score: { winRank: 1, ttk: 10, effectiveDamage: 60 } },
      { id: "hold", score: { winRank: 2, ttk: 12, effectiveDamage: 40 } },
      { id: "tap", score: { winRank: 2, ttk: 15, effectiveDamage: 30 } },
    ]);

    expect(decision.bestChoiceId).toBe("hold");
    expect(decision.bestScore.winRank).toBe(2);
  });

  it("gives extreme mode a much denser activation search than ideal", () => {
    const mockDeps = {
      projectPolicyWindow: (
        _runtime: CombatantRuntime,
        _opponent: CombatantRuntime,
        _state: CombatantState,
        _opponentState: CombatantState,
        options: PolicyProjectionOptions | undefined,
        _abilityPolicy: AbilityTimingMode,
      ) => {
        if (options == null) {
          return { winRank: 0, ttk: 999, effectiveDamage: 0 };
        }
        const delay = options?.activationDelaySec ?? 999;
        const distance = Math.abs(delay - 0.1);
        return { winRank: 2, ttk: 10 + distance, effectiveDamage: 100 - distance };
      },
    };

    const idealDecision = decideTimedAbilityActivation(
      mockDeps,
      null as never,
      null as never,
      null as never,
      null as never,
      "ideal",
      (activationDelaySec) => ({ activationDelaySec }),
    );
    const extremeDecision = decideTimedAbilityActivation(
      mockDeps,
      null as never,
      null as never,
      null as never,
      null as never,
      "extreme",
      (activationDelaySec) => ({ activationDelaySec }),
    );

    expect(extremeDecision.candidates.length).toBeGreaterThan(idealDecision.candidates.length * 10);
    expect(extremeDecision.chosenDelaySec).toBe(0);
  });

  it("prefers the earliest practically equivalent activation window over a much later micro-edge", () => {
    const mockDeps = {
      projectPolicyWindow: (
        _runtime: CombatantRuntime,
        _opponent: CombatantRuntime,
        _state: CombatantState,
        _opponentState: CombatantState,
        options: PolicyProjectionOptions | undefined,
        _abilityPolicy: AbilityTimingMode,
      ) => {
        if (options == null) {
          return { winRank: 0, ttk: 999, effectiveDamage: 0 };
        }
        const delay = options.activationDelaySec ?? 0;
        if (Math.abs(delay - 0) < 1e-9) {
          return { winRank: 2, ttk: 20, effectiveDamage: 1000 };
        }
        if (Math.abs(delay - 4) < 1e-9) {
          return { winRank: 2, ttk: 20.02, effectiveDamage: 1001 };
        }
        return { winRank: 1, ttk: 30, effectiveDamage: 500 };
      },
    };

    const decision = decideTimedAbilityActivation(
      mockDeps,
      null as never,
      null as never,
      null as never,
      null as never,
      "ideal",
      (activationDelaySec) => ({ activationDelaySec }),
    );

    expect(decision.chosenDelaySec).toBe(0);
  });

  it("can choose an immediate self-hit follow-up delay from the live decision time instead of a stale pre-hit anchor", () => {
    const mockDeps = {
      projectPolicyWindow: (
        _runtime: CombatantRuntime,
        _opponent: CombatantRuntime,
        _state: CombatantState,
        _opponentState: CombatantState,
        options: PolicyProjectionOptions | undefined,
        _abilityPolicy: AbilityTimingMode,
      ) => {
        if (options == null) {
          return { winRank: 0, ttk: 999, effectiveDamage: 0 };
        }
        const delay = options.activationDelaySec ?? 999;
        if (Math.abs(delay - 0.45) < 1e-9) {
          return { winRank: 2, ttk: 12, effectiveDamage: 220 };
        }
        if (Math.abs(delay - 0.5) < 1e-9) {
          return { winRank: 2, ttk: 12.05, effectiveDamage: 223 };
        }
        return { winRank: 1, ttk: 30, effectiveDamage: 100 };
      },
    };

    const decision = decideTimedAbilityActivation(
      mockDeps,
      null as never,
      null as never,
      { lastUpdateAt: 0, nextHitAt: 0.45, nextRegenAt: 15, statuses: {} } as never,
      { lastUpdateAt: 0, nextHitAt: 0.6615, nextRegenAt: 15, statuses: {} } as never,
      "semiIdeal",
      (activationDelaySec) => ({ activationDelaySec }),
      undefined,
      { currentTimeSec: 0.45, extraActivationDelayCandidates: [0.45] },
    );

    expect(decision.chosenDelaySec).toBe(0.45);
  });
});
