import type { BuildOptions, SimulationSummary } from "../engine";
import { compareResult, scoreResult } from "../optimizer/scoring";
import { enumerateAssignmentsCounts } from "../shared/buildDomain";
import { computeAscensionCounts } from "../shared/buildEncoding";
import { getPerspectiveMetrics } from "./buildDetailsExplainHelpers";
import type { BuildDetailsSplitAnalysis } from "./buildDetailsExplainTypes";

export async function buildTopSplitAnalyses({
  build,
  side,
  buildAFor,
  buildBFor,
  runSimWith,
}: {
  build: BuildOptions;
  side: "A" | "B";
  buildAFor: (next: BuildOptions) => BuildOptions;
  buildBFor: (next: BuildOptions) => BuildOptions;
  runSimWith: (nextBuildA: BuildOptions, nextBuildB: BuildOptions) => Promise<SimulationSummary | null>;
}): Promise<BuildDetailsSplitAnalysis[]> {
  const variants = enumerateAssignmentsCounts(build.traits, build.venerationStage);
  const summaries = await Promise.all(
    variants.map((ascensionAssignments) => {
      const variant = { ...build, ascensionAssignments };
      return runSimWith(buildAFor(variant), buildBFor(variant)).then((summary) => ({ variant, summary }));
    }),
  );

  const splits = summaries
    .map(({ variant, summary }) => {
      if (!summary) return null;
      return {
        score: scoreResult(summary, side),
        metrics: getPerspectiveMetrics(summary, side),
        counts: computeAscensionCounts(variant.traits, variant.ascensionAssignments, variant.venerationStage),
      };
    })
    .filter(Boolean) as BuildDetailsSplitAnalysis[];

  splits.sort((a, b) => compareResult(a.score, b.score));
  return splits.slice(0, 3);
}
