import type { AbilityTimingMode, BuildOptions, CreatureRuntime, TwoFacedMode } from "../engine";
import type { CompareAppetiteEntry } from "../engine/compareAppetiteData";
import type { EffectsCatalogByCreature } from "../engine/types";
import type { CombatEventPhase } from "../engine/eventOrdering";
import type { RustComposableAbilityConfig } from "./rustMatchupBridge";
import type {
  BestBuildsExtraBuffs,
  BestBuildsExtraCombatantStats,
  BestBuildsExtraSpecialAbilities,
  BestBuildsExtraTrapsTrails,
} from "./bestBuildsBattleSettingsBridge";
import type { BestBuildAggregate, BestBuildAggregateObjective } from "./ranking";

export type BestBuildsSkeletonJob = {
  key: string;
  traits: string[];
  plushies: string[];
  venerationStage: number;
  elder?: BuildOptions["elder"];
  activesOn: boolean;
  breathOn: boolean;
  ascensionAssignments?: string[];
};

export type BestBuildsPhase2Job = {
  kind: "bestBuildsPhase2";
  id: number;
  sourceCreatureName: string;
  opponentNames: string[];
  skeletons: BestBuildsSkeletonJob[];
  objective: BestBuildAggregateObjective;
  maxTimeSec: number;
  abilityPolicy?: AbilityTimingMode;
  returnAllDistributions?: boolean;
  twoFacedMode?: TwoFacedMode;
  combatEventOrder?: CombatEventPhase[];
  extraAbilityConfig?: Partial<RustComposableAbilityConfig>;
  extraCombatantStats?: BestBuildsExtraCombatantStats;
  extraSpecialAbilities?: BestBuildsExtraSpecialAbilities;
  extraBuffs?: BestBuildsExtraBuffs;
  extraTrapsTrails?: BestBuildsExtraTrapsTrails;
  opponentBaselineBuild?: BuildOptions;
};

export type OptimizerWorkerPing = {
  kind: "ping";
  id: number;
};

export type CustomCreaturePayload = {
  creature: CreatureRuntime;
  effects: EffectsCatalogByCreature;
  appetite: CompareAppetiteEntry | null;
  iconName: string | null;
};

export type OptimizerWorkerCustomCreaturesSync = {
  kind: "customCreaturesSync";
  id: number;
  records: CustomCreaturePayload[];
};

export type BestBuildsWorkerResult = {
  skeletonKey: string;
  build: BuildOptions;
  aggregate: BestBuildAggregate;
};

export type BestBuildsPathCounts = Record<string, number>;

export type OptimizerWorkerResponse = {
  id: number;
  error?: string;
  bestBuildsResults?: BestBuildsWorkerResult[];
  bestBuildsPathCounts?: BestBuildsPathCounts;
};
