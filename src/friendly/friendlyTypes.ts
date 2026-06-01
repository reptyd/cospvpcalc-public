import type { ElderVariant } from "../engine";

export type FriendlyShellPage = "home" | "bestBuildSelect" | "bestBuildWizard" | "bestBuildResult" | "battle";

export type FriendlyEnemyProfile = "sameTier" | "lowerTiers" | "higherTiers" | "aroundTier" | "custom";

export type FriendlyBestBuildFocus = "pvp" | "survivability";

export type FriendlyOptimizationGoal = "wins" | "fastKills" | "maxDps";

export type FriendlyBestBuildAnswers = {
  focus: FriendlyBestBuildFocus;
  enemyProfile: FriendlyEnemyProfile;
  customTiers: number[];
  preferredTraits: string[];
  preferredPlushies: string[];
  preferredElder: ElderVariant;
  optimizationGoal: FriendlyOptimizationGoal;
  airRuleEnabled: boolean;
  airRuleCooldownSec: number;
};

export type FriendlyBestBuildEngineIntent =
  | {
      mode: "standard";
    }
  | {
      mode: "survivability";
    };

export type FriendlyAirRuleIntent =
  | {
      enabled: false;
    }
  | {
      enabled: true;
      overrideBiteCooldownSec: number;
    };
