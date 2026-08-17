import { describe, it, expect, beforeEach } from "vitest";
import {
  createNormalizedBuildKey,
  createNormalizedSimCacheKey,
  isStrictlyDominated,
  clearBuildCache,
  getBuildCacheSize,
  memoizedApplyRulesAndBuild,
} from "./bestBuildsOptimizations";
import type { BuildOptions } from "../engine/types";
import { creatureByName } from "../engine/creatureData";

describe("Best Builds Optimizations", () => {
  beforeEach(() => {
    clearBuildCache();
  });

  describe("createNormalizedBuildKey", () => {
    it("creates consistent keys regardless of trait order", () => {
      const build1: BuildOptions = {
        venerationStage: 5,
        traits: ["Damage", "Bite"],
        ascensionAssignments: ["Damage", "Damage", "Damage", "Bite", "Bite"],
        plushies: ["Void", "Ice Wolf"],
      };

      const build2: BuildOptions = {
        venerationStage: 5,
        traits: ["Bite", "Damage"], // Different order
        ascensionAssignments: ["Damage", "Damage", "Damage", "Bite", "Bite"],
        plushies: ["Void", "Ice Wolf"],
      };

      const key1 = createNormalizedBuildKey("Kendyll", build1);
      const key2 = createNormalizedBuildKey("Kendyll", build2);

      expect(key1).toBe(key2);
    });

    it("creates consistent keys regardless of plushie order", () => {
      const build1: BuildOptions = {
        venerationStage: 5,
        traits: ["Damage", "Bite"],
        ascensionAssignments: ["Damage", "Damage", "Damage", "Bite", "Bite"],
        plushies: ["Void", "Ice Wolf"],
      };

      const build2: BuildOptions = {
        venerationStage: 5,
        traits: ["Damage", "Bite"],
        ascensionAssignments: ["Damage", "Damage", "Damage", "Bite", "Bite"],
        plushies: ["Ice Wolf", "Void"], // Different order
      };

      const key1 = createNormalizedBuildKey("Kendyll", build1);
      const key2 = createNormalizedBuildKey("Kendyll", build2);

      expect(key1).toBe(key2);
    });

    it("creates different keys for different builds", () => {
      const build1: BuildOptions = {
        venerationStage: 5,
        traits: ["Damage", "Bite"],
        ascensionAssignments: ["Damage", "Damage", "Damage", "Bite", "Bite"],
        plushies: ["Void", "Ice Wolf"],
      };

      const build2: BuildOptions = {
        venerationStage: 5,
        traits: ["Damage", "Weight"], // Different trait
        ascensionAssignments: ["Damage", "Damage", "Damage", "Weight", "Weight"],
        plushies: ["Void", "Ice Wolf"],
      };

      const key1 = createNormalizedBuildKey("Kendyll", build1);
      const key2 = createNormalizedBuildKey("Kendyll", build2);

      expect(key1).not.toBe(key2);
    });

    it("creates different keys for different elder variants", () => {
      const build1: BuildOptions = {
        venerationStage: 5,
        traits: ["Damage", "Bite"],
        ascensionAssignments: ["Damage", "Damage", "Damage", "Bite", "Bite"],
        plushies: ["Void", "Ice Wolf"],
        elder: "None",
      };

      const build2: BuildOptions = {
        ...build1,
        elder: "Powerful",
      };

      const key1 = createNormalizedBuildKey("Kendyll", build1);
      const key2 = createNormalizedBuildKey("Kendyll", build2);

      expect(key1).not.toBe(key2);
    });
  });

  describe("createNormalizedSimCacheKey", () => {
    it("creates consistent keys with normalized build components", () => {
      const build1: BuildOptions = {
        venerationStage: 5,
        traits: ["Damage", "Bite"],
        ascensionAssignments: ["Damage", "Damage", "Damage", "Bite", "Bite"],
        plushies: ["Void", "Ice Wolf"],
      };

      const build2: BuildOptions = {
        venerationStage: 5,
        traits: ["Bite", "Damage"], // Different order
        ascensionAssignments: ["Damage", "Damage", "Damage", "Bite", "Bite"],
        plushies: ["Ice Wolf", "Void"], // Different order
      };

      const key1 = createNormalizedSimCacheKey("Kendyll", "Boreal", build1, true, true, "semiIdeal", 180);
      const key2 = createNormalizedSimCacheKey("Kendyll", "Boreal", build2, true, true, "semiIdeal", 180);

      expect(key1).toBe(key2);
    });

    it("creates different keys for different settings", () => {
      const build: BuildOptions = {
        venerationStage: 5,
        traits: ["Damage", "Bite"],
        ascensionAssignments: ["Damage", "Damage", "Damage", "Bite", "Bite"],
        plushies: ["Void", "Ice Wolf"],
      };

      const key1 = createNormalizedSimCacheKey("Kendyll", "Boreal", build, true, true, "semiIdeal", 180);
      const key2 = createNormalizedSimCacheKey("Kendyll", "Boreal", build, false, true, "semiIdeal", 180);

      expect(key1).not.toBe(key2);
    });

    it("creates different simulation keys for different elder variants", () => {
      const build: BuildOptions = {
        venerationStage: 5,
        traits: ["Damage", "Bite"],
        ascensionAssignments: ["Damage", "Damage", "Damage", "Bite", "Bite"],
        plushies: ["Void", "Ice Wolf"],
        elder: "None",
      };

      const key1 = createNormalizedSimCacheKey("Kendyll", "Boreal", build, true, true, "semiIdeal", 180);
      const key2 = createNormalizedSimCacheKey("Kendyll", "Boreal", { ...build, elder: "Devious" }, true, true, "semiIdeal", 180);

      expect(key1).not.toBe(key2);
    });
  });

  describe("isStrictlyDominated", () => {
    it("returns true when A is strictly worse in all metrics", () => {
      const a = {
        winRate: 0.5,
        avgTtkWin: 30,
        avgDps: 100,
        avgSurvival: 50,
        avgImmortalDamage: 1000,
      };

      const b = {
        winRate: 0.6, // Better
        avgTtkWin: 25, // Better (lower is better)
        avgDps: 110, // Better
        avgSurvival: 60, // Better
        avgImmortalDamage: 1100, // Better
      };

      expect(isStrictlyDominated(a, b)).toBe(true);
    });

    it("returns false when A is better in at least one metric", () => {
      const a = {
        winRate: 0.6, // Better than B
        avgTtkWin: 30,
        avgDps: 100,
        avgSurvival: 50,
        avgImmortalDamage: 1000,
      };

      const b = {
        winRate: 0.5,
        avgTtkWin: 25,
        avgDps: 110,
        avgSurvival: 60,
        avgImmortalDamage: 1100,
      };

      expect(isStrictlyDominated(a, b)).toBe(false);
    });

    it("returns false when builds are equal", () => {
      const a = {
        winRate: 0.5,
        avgTtkWin: 30,
        avgDps: 100,
        avgSurvival: 50,
        avgImmortalDamage: 1000,
      };

      const b = {
        winRate: 0.5,
        avgTtkWin: 30,
        avgDps: 100,
        avgSurvival: 50,
        avgImmortalDamage: 1000,
      };

      expect(isStrictlyDominated(a, b)).toBe(false);
    });

    it("handles edge case with zero TTK", () => {
      const a = {
        winRate: 0.5,
        avgTtkWin: 0, // No wins
        avgDps: 100,
        avgSurvival: 50,
        avgImmortalDamage: 1000,
      };

      const b = {
        winRate: 0.6,
        avgTtkWin: 25,
        avgDps: 110,
        avgSurvival: 60,
        avgImmortalDamage: 1100,
      };

      expect(isStrictlyDominated(a, b)).toBe(true);
    });
  });

  describe("memoizedApplyRulesAndBuild", () => {
    it("caches results for identical builds", () => {
      const creature = creatureByName["Kendyll"];
      if (!creature) throw new Error("Kendyll not found");

      const build: BuildOptions = {
        venerationStage: 5,
        traits: ["Damage", "Bite"],
        ascensionAssignments: ["Damage", "Damage", "Damage", "Bite", "Bite"],
        plushies: ["Void", "Ice Wolf"],
      };

      expect(getBuildCacheSize()).toBe(0);

      const result1 = memoizedApplyRulesAndBuild(creature, build);
      expect(getBuildCacheSize()).toBe(1);

      const result2 = memoizedApplyRulesAndBuild(creature, build);
      expect(getBuildCacheSize()).toBe(1); // Should still be 1 (cached)

      // Results should be identical (same reference)
      expect(result1).toBe(result2);
    });

    it("caches results for builds with different trait order", () => {
      const creature = creatureByName["Kendyll"];
      if (!creature) throw new Error("Kendyll not found");

      const build1: BuildOptions = {
        venerationStage: 5,
        traits: ["Damage", "Bite"],
        ascensionAssignments: ["Damage", "Damage", "Damage", "Bite", "Bite"],
        plushies: ["Void", "Ice Wolf"],
      };

      const build2: BuildOptions = {
        venerationStage: 5,
        traits: ["Bite", "Damage"], // Different order
        ascensionAssignments: ["Damage", "Damage", "Damage", "Bite", "Bite"],
        plushies: ["Void", "Ice Wolf"],
      };

      const result1 = memoizedApplyRulesAndBuild(creature, build1);
      expect(getBuildCacheSize()).toBe(1);

      const result2 = memoizedApplyRulesAndBuild(creature, build2);
      expect(getBuildCacheSize()).toBe(1); // Should still be 1 (same normalized key)

      // Results should be identical (same reference due to cache)
      expect(result1).toBe(result2);
    });

    it("creates separate cache entries for different builds", () => {
      const creature = creatureByName["Kendyll"];
      if (!creature) throw new Error("Kendyll not found");

      const build1: BuildOptions = {
        venerationStage: 5,
        traits: ["Damage", "Bite"],
        ascensionAssignments: ["Damage", "Damage", "Damage", "Bite", "Bite"],
        plushies: ["Void", "Ice Wolf"],
      };

      const build2: BuildOptions = {
        venerationStage: 5,
        traits: ["Damage", "Weight"], // Different trait
        ascensionAssignments: ["Damage", "Damage", "Damage", "Weight", "Weight"],
        plushies: ["Void", "Ice Wolf"],
      };

      memoizedApplyRulesAndBuild(creature, build1);
      expect(getBuildCacheSize()).toBe(1);

      memoizedApplyRulesAndBuild(creature, build2);
      expect(getBuildCacheSize()).toBe(2); // Different build, new cache entry
    });
  });

  describe("clearBuildCache", () => {
    it("clears the cache", () => {
      const creature = creatureByName["Kendyll"];
      if (!creature) throw new Error("Kendyll not found");

      const build: BuildOptions = {
        venerationStage: 5,
        traits: ["Damage", "Bite"],
        ascensionAssignments: ["Damage", "Damage", "Damage", "Bite", "Bite"],
        plushies: ["Void", "Ice Wolf"],
      };

      memoizedApplyRulesAndBuild(creature, build);
      expect(getBuildCacheSize()).toBe(1);

      clearBuildCache();
      expect(getBuildCacheSize()).toBe(0);
    });
  });
});

