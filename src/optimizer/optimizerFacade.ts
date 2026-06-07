import type { AbilityTimingMode, BuildOptions, CreatureRuntime } from "../engine";
import { generateBuildCandidates } from "./candidateGeneration";
import { buildOptimizerContext } from "./contextAndCompare";

export type OptimizerGoal = "lexicographic" | "effectiveDamage" | "dps";
export type OptimizerMode = "solo" | "counter";
export type OptimizerSearchQuality = "fast" | "balanced" | "quality";
export type OptimizerAbilityPolicy = AbilityTimingMode;

export type OptimizerCandidates = Array<{
  build: BuildOptions;
  activesOn: boolean;
  breathOn: boolean;
  preScore: number;
}>;

export async function createOptimizerCandidates({
  creatureA,
  creatureB,
  mode,
  soloMode,
  quality,
  optimizePlushies,
  searchAllVeneration,
  fixedVenerationStage,
  searchToggles,
  goal,
  constraints,
  excludedTraits,
  excludedPlushies,
  lockElder,
}: {
  creatureA: CreatureRuntime;
  creatureB?: CreatureRuntime;
  mode: "vs" | "solo" | "counter";
  soloMode?: "dummy" | "composite";
  quality: OptimizerSearchQuality;
  optimizePlushies: boolean;
  searchAllVeneration: boolean;
  fixedVenerationStage?: number;
  searchToggles: boolean;
  goal: OptimizerGoal;
  constraints?: BuildOptions;
  excludedTraits?: readonly string[];
  excludedPlushies?: readonly string[];
  lockElder?: boolean;
}): Promise<OptimizerCandidates> {
  const context = await buildOptimizerContext(creatureA, creatureB ?? creatureA, mode);
  if (soloMode) context.soloMode = soloMode;
  return generateBuildCandidates({
    quality,
    optimizePlushies,
    searchAllVeneration,
    fixedVenerationStage: fixedVenerationStage ?? 0,
    searchToggles,
    goal,
    context,
    constraints,
    excludedTraits,
    excludedPlushies,
    lockElder,
  });
}

