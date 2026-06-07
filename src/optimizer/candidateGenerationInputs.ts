import type { BuildOptions } from "../engine";
import { traits, veneration } from "../engine/buildData";
import type { OptimizerContext } from "./contextAndCompare";
import { expandForcedPlushieCombos, generateRelevantPlushieCombos } from "./optimizerPlushieRules";

export function selectCandidateTraitIds(context?: OptimizerContext): string[] {
  let traitIds = traits
    .filter((trait) => ["Damage", "Bite", "Weight", "Health"].includes(trait.id))
    .map((trait) => trait.id)
    .filter((id) => (context?.healthRelevant === false ? id !== "Health" : true));

  if (context?.mode === "solo" && context?.soloMode === "dummy") {
    traitIds = traitIds.filter((id) => id !== "Health");
  }

  return traitIds;
}

export function buildTraitCombos(traitIds: string[], forcedTraits: string[], excludedTraits: readonly string[] = []): string[][] {
  const excludedTraitSet = new Set(excludedTraits);
  const availableTraitIds = traitIds.filter((traitId) => !excludedTraitSet.has(traitId));
  const allowedForcedTraits = forcedTraits.filter((traitId) => !excludedTraitSet.has(traitId));
  const traitCombos: string[][] = [];
  if (allowedForcedTraits.length >= 2) {
    traitCombos.push([allowedForcedTraits[0], allowedForcedTraits[1]]);
  } else if (allowedForcedTraits.length === 1) {
    const first = allowedForcedTraits[0];
    for (const other of availableTraitIds) {
      if (other === first) continue;
      traitCombos.push([first, other]);
    }
  } else {
    for (let i = 0; i < availableTraitIds.length; i += 1) {
      for (let j = i + 1; j < availableTraitIds.length; j += 1) {
        traitCombos.push([availableTraitIds[i], availableTraitIds[j]]);
      }
    }
  }
  return traitCombos;
}

export function buildPlushieCombos({
  optimizePlushies,
  quality,
  context,
  forcedPlushies,
  excludedPlushies = [],
}: {
  optimizePlushies: boolean;
  quality: "fast" | "balanced" | "quality";
  context?: OptimizerContext;
  forcedPlushies: string[];
  excludedPlushies?: readonly string[];
}): string[][] {
  const excludedPlushieSet = new Set(excludedPlushies);
  let plushieCombos = optimizePlushies ? generateRelevantPlushieCombos(quality, context) : [["", ""]];
  const allowedForcedPlushies = forcedPlushies.filter((plushie) => !excludedPlushieSet.has(plushie));
  if (allowedForcedPlushies.length >= 2) {
    plushieCombos = [[allowedForcedPlushies[0], allowedForcedPlushies[1]]];
  } else if (allowedForcedPlushies.length === 1) {
    const first = allowedForcedPlushies[0];
    if (optimizePlushies) {
      plushieCombos = expandForcedPlushieCombos(first);
    } else {
      plushieCombos = [[first, ""]];
    }
  }
  return plushieCombos.filter((combo) => combo.every((plushie) => !plushie || !excludedPlushieSet.has(plushie)));
}

export function estimatePlushieComboCount({
  optimizePlushies,
  quality,
}: {
  optimizePlushies: boolean;
  quality: "fast" | "balanced" | "quality";
}): number {
  return optimizePlushies ? generateRelevantPlushieCombos(quality).length : 1;
}

export function buildCandidateStages({
  searchAllVeneration,
  fixedVenerationStage,
  hasForcedAscension,
  normalizedConstraints,
}: {
  searchAllVeneration: boolean;
  fixedVenerationStage: number;
  hasForcedAscension: boolean;
  normalizedConstraints?: BuildOptions;
}): number[] {
  const safeStage = Math.max(0, Math.min(veneration.stages, Math.round(fixedVenerationStage)));
  if (hasForcedAscension) {
    const lockedStage = normalizedConstraints?.ascensionAssignments.filter((a) => a && a.trim().length > 0).length ?? 0;
    return [lockedStage];
  }
  return searchAllVeneration ? Array.from({ length: veneration.stages + 1 }, (_, idx) => idx) : [safeStage];
}
