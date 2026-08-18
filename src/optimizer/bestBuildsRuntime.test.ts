import { describe, expect, it, vi, beforeEach } from "vitest";
import { applyRulesAndBuild } from "../engine";
import { creatureByName } from "../engine/creatureData";
import type { BestBuildsMatchupSummary } from "./bestBuildsMatchupContract";

const { rustComposableBreathSpy, rustComposableMeleeSpy } = vi.hoisted(() => ({
  rustComposableBreathSpy: vi.fn(),
  rustComposableMeleeSpy: vi.fn(),
}));

const fallbackSummary: BestBuildsMatchupSummary = {
  winner: "A",
  deathTimeA: null,
  maxTimeSec: 180,
  dpsAtoB: 100,
  ttkAtoB: 10,
  damageDealtA: 1000,
  damageDealtAAtBDeath: 1000,
  extendedDamagePotentialA: 0,
};

vi.mock("./rustMatchupLoader", () => ({
  isRustMatchupBridgeDisabled: () => false,
}));

vi.mock("./rustBestBuildsRuntime", () => ({
  trySimulateRustComposableBreathBestBuildMatchup: rustComposableBreathSpy,
  trySimulateRustComposableMeleeBestBuildMatchup: rustComposableMeleeSpy,
}));

import { simulateBestBuildMatchupWithPath } from "./bestBuildsRuntime";

describe("bestBuildsRuntime composable routing", () => {
  beforeEach(() => {
    rustComposableBreathSpy.mockImplementation(() => fallbackSummary);
    rustComposableMeleeSpy.mockImplementation(() => fallbackSummary);
    rustComposableBreathSpy.mockClear();
    rustComposableMeleeSpy.mockClear();
  });

  it("routes no-breath fights through composable melee, not composable breath", () => {
    const sourceCreature = creatureByName["Kendyll"];
    const opponentCreature = creatureByName["Empiterium"];
    if (!sourceCreature || !opponentCreature) {
      throw new Error("Missing test creatures");
    }

    const sourceBuild = {
      venerationStage: 5,
      traits: ["Bite", "Damage"],
      ascensionAssignments: ["Damage", "Damage", "Damage", "Damage", "Damage"],
      plushies: ["Void", "Void"],
    };
    const finalA = applyRulesAndBuild(sourceCreature, sourceBuild);

    const result = simulateBestBuildMatchupWithPath({
      sourceCreature,
      sourceBuild,
      finalA,
      opponentCreature,
      activesOn: true,
      breathOn: true,
      maxTimeSec: 180,
      abilityPolicy: "semiIdeal",
    });

    expect(finalA.hasBreath).toBe(false);
    expect(result.path).toBe("composable_melee");
    expect(rustComposableMeleeSpy).toHaveBeenCalledTimes(1);
    expect(rustComposableBreathSpy).not.toHaveBeenCalled();
  });

  it("routes breath fights through composable breath", () => {
    const sourceCreature = creatureByName["Phantejer"];
    const opponentCreature = creatureByName["Kragnyx"];
    if (!sourceCreature || !opponentCreature) {
      throw new Error("Missing test creatures");
    }

    const sourceBuild = {
      venerationStage: 5,
      traits: ["Damage", "Bite"],
      ascensionAssignments: ["Damage", "Damage", "Damage", "Damage", "Damage"],
      plushies: ["Void", "Void"],
    };
    const finalA = applyRulesAndBuild(sourceCreature, sourceBuild);

    const result = simulateBestBuildMatchupWithPath({
      sourceCreature,
      sourceBuild,
      finalA,
      opponentCreature,
      activesOn: true,
      breathOn: true,
      maxTimeSec: 180,
      abilityPolicy: "semiIdeal",
    });

    expect(finalA.hasBreath).toBe(true);
    expect(result.path).toBe("composable_breath");
    expect(rustComposableBreathSpy).toHaveBeenCalledTimes(1);
    expect(rustComposableMeleeSpy).not.toHaveBeenCalled();
  });

  it("threads ability policy into composable breath routing", () => {
    const sourceCreature = creatureByName["Phantejer"];
    const opponentCreature = creatureByName["Kragnyx"];
    if (!sourceCreature || !opponentCreature) {
      throw new Error("Missing test creatures");
    }

    const sourceBuild = {
      venerationStage: 5,
      traits: ["Damage", "Bite"],
      ascensionAssignments: ["Damage", "Damage", "Damage", "Damage", "Damage"],
      plushies: ["Void", "Void"],
    };
    const finalA = applyRulesAndBuild(sourceCreature, sourceBuild);

    simulateBestBuildMatchupWithPath({
      sourceCreature,
      sourceBuild,
      finalA,
      opponentCreature,
      activesOn: false,
      breathOn: true,
      maxTimeSec: 180,
      abilityPolicy: "fast",
    });

    expect(rustComposableBreathSpy).toHaveBeenCalledTimes(1);
    expect(rustComposableBreathSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        abilityPolicy: "fast",
      }),
    );
  });

  it("skips when composable declines instead of crashing the page", () => {
    rustComposableMeleeSpy.mockImplementation(() => null);
    rustComposableBreathSpy.mockImplementation(() => null);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const sourceCreature = creatureByName["Kendyll"];
    const opponentCreature = creatureByName["Empiterium"];
    if (!sourceCreature || !opponentCreature) {
      throw new Error("Missing test creatures");
    }

    const sourceBuild = {
      venerationStage: 5,
      traits: ["Bite", "Damage"],
      ascensionAssignments: ["Damage", "Damage", "Damage", "Damage", "Damage"],
      plushies: ["Void", "Void"],
    };
    const finalA = applyRulesAndBuild(sourceCreature, sourceBuild);

    try {
      const result = simulateBestBuildMatchupWithPath({
        sourceCreature,
        sourceBuild,
        finalA,
        opponentCreature,
        activesOn: true,
        breathOn: true,
        maxTimeSec: 180,
        abilityPolicy: "semiIdeal",
      });

      expect(result.path).toBe("rust_missing_skipped");
      expect(result.summary).toMatchObject({
        winner: "Draw",
        dpsAtoB: 0,
        ttkAtoB: 180,
      });
      expect(warnSpy).toHaveBeenCalledWith(expect.stringMatching(/Rust routing is missing/i));
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("routes Vulturobo Plasma Beam through Rust as a no-op missing-spec breath", () => {
    const sourceCreature = creatureByName["Eiroca"];
    const opponentCreature = creatureByName["Vulturobo"];
    if (!sourceCreature || !opponentCreature) {
      throw new Error("Missing test creatures");
    }

    const sourceBuild = {
      venerationStage: 5,
      traits: ["Bite", "Damage"],
      ascensionAssignments: ["Damage", "Damage", "Damage", "Damage", "Damage"],
      plushies: ["Void", "Void"],
    };
    const finalA = applyRulesAndBuild(sourceCreature, sourceBuild);

    const result = simulateBestBuildMatchupWithPath({
      sourceCreature,
      sourceBuild,
      finalA,
      opponentCreature,
      activesOn: true,
      breathOn: true,
      maxTimeSec: 180,
      abilityPolicy: "semiIdeal",
    });

    expect(result.path).toBe("composable_breath");
    expect(rustComposableBreathSpy).toHaveBeenCalledTimes(1);
    expect(rustComposableMeleeSpy).not.toHaveBeenCalled();
  });
});
