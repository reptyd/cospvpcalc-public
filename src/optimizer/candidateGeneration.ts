import type { BuildOptions } from "../engine";
import { elderOptions } from "../engine/buildData";
import { normalizeConstraintBuild } from "./constraintBuilds";
import { traits, veneration } from "../engine/buildData";
import { enumerateAssignmentsCounts } from "../shared/buildDomain";
import type { OptimizerContext } from "./contextAndCompare";
import {
  buildCandidateStages,
  buildPlushieCombos,
  buildTraitCombos,
  estimatePlushieComboCount,
  selectCandidateTraitIds,
} from "./candidateGenerationInputs";
import { preScoreBuild } from "./candidateGenerationScoring";

export { enumerateAssignmentsCounts } from "../shared/buildDomain";

export function generateBuildCandidates({
  quality,
  optimizePlushies,
  searchAllVeneration,
  fixedVenerationStage,
  searchToggles,
  goal,
  context,
  constraints,
  excludedTraits = [],
  excludedPlushies = [],
  lockElder = false,
}: {
  quality: "fast" | "balanced" | "quality";
  optimizePlushies: boolean;
  searchAllVeneration: boolean;
  fixedVenerationStage: number;
  searchToggles: boolean;
  goal: "lexicographic" | "effectiveDamage" | "dps";
  context?: OptimizerContext;
  constraints?: BuildOptions;
  excludedTraits?: readonly string[];
  excludedPlushies?: readonly string[];
  lockElder?: boolean;
}): Array<{ build: BuildOptions; activesOn: boolean; breathOn: boolean; preScore: number }> {
  const normalizedConstraints = constraints ? normalizeConstraintBuild(constraints) : undefined;
  const forcedTraits = normalizedConstraints?.traits ?? [];
  const forcedPlushies = normalizedConstraints?.plushies ?? [];
  const hasForcedAscension = Boolean(
    normalizedConstraints?.ascensionAssignments.some((assignment) => assignment && assignment.trim().length > 0),
  );
  const traitIds = selectCandidateTraitIds(context);
  const traitCombos = buildTraitCombos(traitIds, forcedTraits, excludedTraits);
  const plushieCombos = buildPlushieCombos({
    optimizePlushies,
    quality,
    context,
    forcedPlushies,
    excludedPlushies,
  });
  const stages = buildCandidateStages({
    searchAllVeneration,
    fixedVenerationStage,
    hasForcedAscension,
    normalizedConstraints,
  });
  const elderChoices = lockElder ? [normalizedConstraints?.elder ?? "None"] : elderOptions;

  const builds: Array<{ build: BuildOptions; activesOn: boolean; breathOn: boolean; preScore: number }> = [];
  for (const stage of stages) {
    for (const traitsSelection of traitCombos) {
      let assignments = enumerateAssignmentsCounts(traitsSelection, stage);
      if (hasForcedAscension && forcedTraits.length >= 1 && forcedTraits.every((id) => traitsSelection.includes(id))) {
        assignments = [normalizedConstraints!.ascensionAssignments];
      }
      for (const ascensionAssignments of assignments) {
        for (const elder of elderChoices) {
          for (const plushieCombo of plushieCombos) {
            const build: BuildOptions = {
              venerationStage: stage,
              traits: traitsSelection,
              ascensionAssignments,
              plushies: plushieCombo.filter(Boolean),
              elder,
            };
            const toggles = searchToggles ? [true, false] : [true];
            for (const activesOn of toggles) {
              for (const breathOn of toggles) {
                if (searchToggles && !activesOn && !breathOn) continue;
                builds.push({
                  build,
                  activesOn,
                  breathOn,
                  preScore: preScoreBuild(build, goal, context),
                });
              }
            }
          }
        }
      }
    }
  }

  return builds;
}

export function estimateCandidateCount({
  searchAllVeneration,
  searchToggles,
  optimizePlushies,
}: {
  searchAllVeneration: boolean;
  searchToggles: boolean;
  optimizePlushies: boolean;
}): number {
  const optimizerTraitOptions = traits.filter((trait) => ["Damage", "Bite", "Weight", "Health"].includes(trait.id));
  const traitCount = optimizerTraitOptions.length;
  const traitPairs = (traitCount * (traitCount - 1)) / 2;
  const stageCount = searchAllVeneration ? veneration.stages + 1 : 1;
  const ascensionCount = 6;
  const plushCount = estimatePlushieComboCount({
    optimizePlushies,
    quality: "fast",
  });
  const toggleCount = searchToggles ? 4 : 1;
  return Math.round(stageCount * traitPairs * ascensionCount * plushCount * toggleCount);
}

