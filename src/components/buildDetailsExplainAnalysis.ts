import type { BuildOptions } from "../engine";
import type { BuildDetailsResult, DummyValues } from "./BuildDetails";
import { buildTopSplitAnalyses } from "./buildDetailsSplitAnalysis";
import { analyzeStatusImpact } from "./buildDetailsStatusAnalysis";
import {
  buildTraitCountById,
  createBuildDetailsExplainAnalysis,
} from "./buildDetailsTraitAnalysis";
import type { BuildDetailsExplainAnalysis } from "./buildDetailsExplainTypes";
import {
  buildWithTraitLevels,
  buildWithTraitSubset,
  getPerspectiveMetrics,
} from "./buildDetailsExplainHelpers";
import { createBuildDetailsSimRunner } from "./buildDetailsExplainSimulation";

export async function analyzeBuildExplainText({
  build,
  result,
  mode,
  side,
  nameA,
  nameB,
  dummyValues,
}: {
  build: BuildOptions;
  result: BuildDetailsResult;
  mode: "solo" | "counter";
  side: "A" | "B";
  nameA: string;
  nameB: string;
  dummyValues: DummyValues;
}): Promise<BuildDetailsExplainAnalysis | null> {
  const runSimWith = createBuildDetailsSimRunner({
    result,
    mode,
    nameA,
    nameB,
    dummyValues,
  });

  const baseSummary = await runSimWith(result.buildA, result.buildB);
  if (!baseSummary) return null;
  const base = getPerspectiveMetrics(baseSummary, side);

  const trait1 = build.traits[0] ?? "";
  const trait2 = build.traits[1] ?? "";
  const traitCountById = buildTraitCountById(build);

  const noTraitsBuild = buildWithTraitSubset(build, []);
  const noTrait1Build = trait1
    ? buildWithTraitLevels(build, trait2 ? { [trait2]: traitCountById[trait2] ?? 0 } : {}, trait2 || undefined)
    : build;
  const noTrait2Build = trait2
    ? buildWithTraitLevels(build, trait1 ? { [trait1]: traitCountById[trait1] ?? 0 } : {}, trait1 || undefined)
    : build;
  const trait1BaseBuild = trait1
    ? buildWithTraitLevels(
        build,
        { ...(trait2 ? { [trait2]: traitCountById[trait2] ?? 0 } : {}), [trait1]: 0 },
        trait1,
      )
    : build;
  const trait2BaseBuild = trait2
    ? buildWithTraitLevels(
        build,
        { ...(trait1 ? { [trait1]: traitCountById[trait1] ?? 0 } : {}), [trait2]: 0 },
        trait2,
      )
    : build;

  const buildAFor = (next: BuildOptions) => (side === "A" ? next : result.buildA);
  const buildBFor = (next: BuildOptions) => (side === "B" ? next : result.buildB);

  // Run independent simulations in parallel — Rust dispatch is bridge-bound,
  // not CPU-bound on the main thread, so concurrent awaits compose cleanly.
  const [
    noTraitsSummary,
    noTrait1Summary,
    noTrait2Summary,
    trait1BaseSummary,
    trait2BaseSummary,
  ] = await Promise.all([
    runSimWith(buildAFor(noTraitsBuild), buildBFor(noTraitsBuild)),
    runSimWith(buildAFor(noTrait1Build), buildBFor(noTrait1Build)),
    runSimWith(buildAFor(noTrait2Build), buildBFor(noTrait2Build)),
    trait1 ? runSimWith(buildAFor(trait1BaseBuild), buildBFor(trait1BaseBuild)) : Promise.resolve(null),
    trait2 ? runSimWith(buildAFor(trait2BaseBuild), buildBFor(trait2BaseBuild)) : Promise.resolve(null),
  ]);

  const noTraits = noTraitsSummary ? getPerspectiveMetrics(noTraitsSummary, side) : base;
  const noTrait1 = noTrait1Summary ? getPerspectiveMetrics(noTrait1Summary, side) : base;
  const noTrait2 = noTrait2Summary ? getPerspectiveMetrics(noTrait2Summary, side) : base;
  const trait1Base = trait1BaseSummary ? getPerspectiveMetrics(trait1BaseSummary, side) : noTraits;
  const trait2Base = trait2BaseSummary ? getPerspectiveMetrics(trait2BaseSummary, side) : noTraits;

  const hasWeightTrait = build.traits.includes("Weight");
  const noWeightBuild = hasWeightTrait ? buildWithTraitSubset(build, build.traits.filter((trait) => trait !== "Weight")) : build;
  const hasHealthTrait = build.traits.includes("Health");
  const noHealthBuild = hasHealthTrait ? buildWithTraitSubset(build, build.traits.filter((trait) => trait !== "Health")) : build;

  const [noWeightSummary, noHealthSummary] = await Promise.all([
    hasWeightTrait ? runSimWith(buildAFor(noWeightBuild), buildBFor(noWeightBuild)) : Promise.resolve(null),
    hasHealthTrait ? runSimWith(buildAFor(noHealthBuild), buildBFor(noHealthBuild)) : Promise.resolve(null),
  ]);
  const noWeight = noWeightSummary ? getPerspectiveMetrics(noWeightSummary, side) : base;
  const noHealth = noHealthSummary ? getPerspectiveMetrics(noHealthSummary, side) : base;

  const [statusAnalysis, topSplits] = await Promise.all([
    analyzeStatusImpact({
      build,
      side,
      baseSummary,
      baseMetrics: base,
      resultBuildA: result.buildA,
      resultBuildB: result.buildB,
      runSimWith,
    }),
    buildTopSplitAnalyses({
      build,
      side,
      buildAFor,
      buildBFor,
      runSimWith,
    }),
  ]);

  return createBuildDetailsExplainAnalysis({
    build,
    winner: baseSummary.winner,
    base,
    noTraits,
    noTrait1,
    noTrait2,
    trait1Base,
    trait2Base,
    traitCountById,
    hasWeightTrait,
    noWeight,
    hasHealthTrait,
    noHealth,
    statusAnalysis,
    topSplits,
  });
}
