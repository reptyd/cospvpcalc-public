import type { BuildOptions } from "../engine";
import type { BuildDetailsResult, DummyValues } from "./BuildDetails";
import { analyzeBuildExplainText } from "./buildDetailsExplainAnalysis";
import { formatBuildExplainText } from "./buildDetailsExplainTextFormat";

export { resolveTraitPercentLocal } from "./buildDetailsExplainHelpers";

export async function buildExplainText({
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
}): Promise<string> {
  if (mode === "solo" && side === "B") {
    return "Build B is a dummy target in solo mode; trait/plush optimization math is not applicable.";
  }

  const analysis = await analyzeBuildExplainText({
    build,
    result,
    mode,
    side,
    nameA,
    nameB,
    dummyValues,
  });
  if (!analysis) return "Unable to build explanation: missing creature data.";

  return formatBuildExplainText(build, side, analysis);
}
