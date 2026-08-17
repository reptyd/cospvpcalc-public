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
  returnPerOpponentOutcomes?: boolean;
  twoFacedMode?: TwoFacedMode;
  combatEventOrder?: CombatEventPhase[];
  extraAbilityConfig?: Partial<RustComposableAbilityConfig>;
  extraCombatantStats?: BestBuildsExtraCombatantStats;
  extraSpecialAbilities?: BestBuildsExtraSpecialAbilities;
  extraBuffs?: BestBuildsExtraBuffs;
  extraTrapsTrails?: BestBuildsExtraTrapsTrails;
  opponentBaselineBuild?: BuildOptions;
  /** Score the job's whole (build x opponent) rectangle in one WASM crossing.
   * Only valid without the battle-settings channels above; the funnel sets it,
   * the page flow does not. */
  batchMatchups?: boolean;
  /** Seconds between Fortify rollout decisions. Omitted / 0 = decide every
   * tick, which is what every path outside the funnel uses. */
  screenFortifyFast?: boolean;
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

export type BestBuildsPerOpponentOutcome = {
  opponentName: string;
  winner: "A" | "B" | "Draw";
  ttk: number;
  dps: number;
  effective: number;
  survival: number;
};

export type BestBuildsWorkerResult = {
  skeletonKey: string;
  build: BuildOptions;
  aggregate: BestBuildAggregate;
  /** Present only when the job asked for them. The funnel pipeline scores a
   * build against different opponent subsets in different stages and needs the
   * per-opponent outcomes to merge those partial passes into one full-pool
   * aggregate - and to feed the common-wins ranking without re-simulating. */
  perOpponent?: BestBuildsPerOpponentOutcome[];
};

export type BestBuildsPathCounts = Record<string, number>;

export type OptimizerWorkerResponse = {
  id: number;
  error?: string;
  bestBuildsResults?: BestBuildsWorkerResult[];
  bestBuildsPathCounts?: BestBuildsPathCounts;
  /** Engine work the job consumed, summed over every fight it ran. The unit is
   * the engine's own event-loop iteration, so it is identical on every machine
   * and additive across workers. */
  bestBuildsWorkUnits?: number;
};
