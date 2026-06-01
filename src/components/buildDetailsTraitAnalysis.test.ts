import { describe, expect, it } from "vitest";
import type { BuildOptions } from "../engine";
import {
  buildTraitCountById,
  createBuildDetailsExplainAnalysis,
  resolveTraitLevelPercent,
} from "./buildDetailsTraitAnalysis";
import type { BuildDetailsPerspectiveMetrics } from "./buildDetailsExplainTypes";

function metrics(overrides: Partial<BuildDetailsPerspectiveMetrics> = {}): BuildDetailsPerspectiveMetrics {
  return {
    dps: 100,
    killDps: 90,
    effective: 300,
    ttk: 12,
    didKill: true,
    incomingUntilDeath: 150,
    regenHealed: 10,
    ...overrides,
  };
}

describe("build details trait analysis", () => {
  it("builds trait count map from ascension assignments", () => {
    const build: BuildOptions = {
      venerationStage: 5,
      traits: ["Damage", "Weight"],
      ascensionAssignments: ["Damage", "Damage", "Damage", "Weight", "Weight"],
      plushies: ["Void", "Ice Wolf"],
    };

    expect(buildTraitCountById(build)).toEqual({
      Damage: 3,
      Weight: 2,
    });
  });

  it("resolves trait level percent from ascension sequence", () => {
    expect(resolveTraitLevelPercent("Damage", 0)).toBeGreaterThan(0);
    expect(resolveTraitLevelPercent("Damage", 5)).toBeGreaterThan(resolveTraitLevelPercent("Damage", 0));
  });

  it("assembles explain analysis from precomputed metric snapshots", () => {
    const build: BuildOptions = {
      venerationStage: 5,
      traits: ["Damage", "Weight"],
      ascensionAssignments: ["Damage", "Damage", "Damage", "Weight", "Weight"],
      plushies: ["Void", "Ice Wolf"],
    };

    const analysis = createBuildDetailsExplainAnalysis({
      build,
      winner: "A",
      base: metrics(),
      noTraits: metrics({ effective: 220 }),
      noTrait1: metrics({ effective: 250, dps: 82, ttk: 15 }),
      noTrait2: metrics({ effective: 270, dps: 91, ttk: 13 }),
      trait1Base: metrics({ effective: 265, dps: 90, ttk: 14 }),
      trait2Base: metrics({ effective: 282, dps: 96, ttk: 12.5 }),
      traitCountById: { Damage: 3, Weight: 2 },
      hasWeightTrait: true,
      noWeight: metrics({ effective: 280, incomingUntilDeath: 165 }),
      hasHealthTrait: false,
      noHealth: metrics({ regenHealed: 3 }),
      statusAnalysis: {
        noStatuses: metrics({ effective: 260, dps: 88, ttk: 14 }),
        statusStacksBase: 9,
        statusStacksNo: 2,
        dotDpsBase: 18,
        dotDpsNo: 4,
        opponentRegenDenied: 12,
        biteStatusSynergy: 15,
        biteStatusStacksGain: 5,
        biteEffectiveGain: 20,
        biteDpsGain: 7,
        biteTtkGain: 2,
        statusAppliedBreakdown: [["Burn", 6]],
      },
      topSplits: [],
    });

    expect(analysis.traitLine).toBe("Damage, Weight");
    expect(analysis.plushieLine).toBe("Void, Ice Wolf");
    expect(analysis.ascLine).toBe("Damage=3, Weight=2");
    expect(analysis.baseTraitGain).toBe(80);
    expect(analysis.trait1FullEff).toBe(50);
    expect(analysis.trait1UpgradeEff).toBe(35);
    expect(analysis.statusGainEffective).toBe(40);
    expect(analysis.weightOffGain).toBe(20);
    expect(analysis.weightDefGain).toBe(15);
    expect(analysis.healthRegenGain).toBe(0);
    expect(analysis.statusAppliedBreakdown).toEqual([["Burn", 6]]);
  });
});
