import type {
  FriendlyAirRuleIntent,
  FriendlyBestBuildAnswers,
  FriendlyBestBuildEngineIntent,
} from "./friendlyTypes";

export const DEFAULT_FRIENDLY_AIR_RULE_COOLDOWN_SEC = 1.8;

export const DEFAULT_FRIENDLY_BEST_BUILD_ANSWERS: FriendlyBestBuildAnswers = {
  focus: "pvp",
  enemyProfile: "aroundTier",
  customTiers: [],
  preferredTraits: [],
  preferredPlushies: [],
  preferredElder: "None",
  optimizationGoal: "wins",
  airRuleEnabled: false,
  airRuleCooldownSec: DEFAULT_FRIENDLY_AIR_RULE_COOLDOWN_SEC,
};

export function buildFriendlyBestBuildEngineIntent(
  answers: FriendlyBestBuildAnswers,
): FriendlyBestBuildEngineIntent {
  if (answers.focus === "survivability") {
    return {
      mode: "survivability",
    };
  }

  return {
    mode: "standard",
  };
}

export function buildFriendlyAirRuleIntent(answers: FriendlyBestBuildAnswers): FriendlyAirRuleIntent {
  if (!answers.airRuleEnabled) {
    return {
      enabled: false,
    };
  }

  return {
    enabled: true,
    overrideBiteCooldownSec: answers.airRuleCooldownSec,
  };
}
