import type { BuildOptions, SimulationSummary } from "../engine";
import { buildWithTraitSubset, getPerspectiveMetrics } from "./buildDetailsExplainHelpers";

const DISABLE_STATUS_ATTACKS = ["Status Attacks", "Plushie Offensive Procs"];

function sumValues(values: Record<string, number> | undefined): number {
  return Object.values(values ?? {}).reduce((sum, value) => sum + value, 0);
}

export async function analyzeStatusImpact({
  build,
  side,
  baseSummary,
  baseMetrics,
  resultBuildA,
  resultBuildB,
  runSimWith,
}: {
  build: BuildOptions;
  side: "A" | "B";
  baseSummary: SimulationSummary;
  baseMetrics: ReturnType<typeof getPerspectiveMetrics>;
  resultBuildA: BuildOptions;
  resultBuildB: BuildOptions;
  runSimWith: (
    nextBuildA: BuildOptions,
    nextBuildB: BuildOptions,
    disabledA?: string[],
    disabledB?: string[],
  ) => Promise<SimulationSummary | null>;
}) {
  const hasBiteTrait = build.traits.includes("Bite");
  const noBiteBuild = hasBiteTrait ? buildWithTraitSubset(build, build.traits.filter((trait) => trait !== "Bite")) : build;
  const buildAFor = (next: BuildOptions) => (side === "A" ? next : resultBuildA);
  const buildBFor = (next: BuildOptions) => (side === "B" ? next : resultBuildB);

  const [noStatusesSummary, noBiteSummary] = await Promise.all([
    runSimWith(
      resultBuildA,
      resultBuildB,
      side === "A" ? DISABLE_STATUS_ATTACKS : [],
      side === "B" ? DISABLE_STATUS_ATTACKS : [],
    ),
    hasBiteTrait ? runSimWith(buildAFor(noBiteBuild), buildBFor(noBiteBuild)) : Promise.resolve(null),
  ]);

  const noStatuses = noStatusesSummary ? getPerspectiveMetrics(noStatusesSummary, side) : baseMetrics;
  const targetDebug = side === "A" ? baseSummary.debug?.B : baseSummary.debug?.A;
  const noStatusesTargetDebug = noStatusesSummary
    ? side === "A"
      ? noStatusesSummary.debug?.B
      : noStatusesSummary.debug?.A
    : undefined;
  const statusStacksBase = sumValues(targetDebug?.statusStacksApplied);
  const statusStacksNo = sumValues(noStatusesTargetDebug?.statusStacksApplied);
  const dotDpsBase = targetDebug?.dotDps ?? 0;
  const dotDpsNo = noStatusesTargetDebug?.dotDps ?? 0;
  const opponentRegenBase = side === "A" ? baseSummary.regenHealedB : baseSummary.regenHealedA;
  const opponentRegenNo = noStatusesSummary
    ? side === "A"
      ? noStatusesSummary.regenHealedB
      : noStatusesSummary.regenHealedA
    : opponentRegenBase;

  const noBite = noBiteSummary ? getPerspectiveMetrics(noBiteSummary, side) : baseMetrics;
  const noBiteNoStatusesSummary =
    hasBiteTrait && noBiteSummary
      ? await runSimWith(
          buildAFor(noBiteBuild),
          buildBFor(noBiteBuild),
          side === "A" ? DISABLE_STATUS_ATTACKS : [],
          side === "B" ? DISABLE_STATUS_ATTACKS : [],
        )
      : null;
  const noBiteNoStatuses = noBiteNoStatusesSummary ? getPerspectiveMetrics(noBiteNoStatusesSummary, side) : noBite;
  const noBiteTargetDebug = noBiteSummary ? (side === "A" ? noBiteSummary.debug?.B : noBiteSummary.debug?.A) : undefined;
  const statusStacksNoBite = sumValues(noBiteTargetDebug?.statusStacksApplied);
  const statusAppliedBreakdown = Object.entries(targetDebug?.statusStacksApplied ?? {})
    .filter(([, stacks]) => stacks > 0)
    .sort((a, b) => b[1] - a[1]);

  return {
    noStatuses,
    hasBiteTrait,
    noBite,
    noBiteNoStatuses,
    statusStacksBase,
    statusStacksNo,
    dotDpsBase,
    dotDpsNo,
    opponentRegenDenied: opponentRegenNo - opponentRegenBase,
    biteStatusSynergy: hasBiteTrait ? (baseMetrics.effective - noStatuses.effective) - (noBite.effective - noBiteNoStatuses.effective) : 0,
    biteStatusStacksGain: hasBiteTrait ? statusStacksBase - statusStacksNoBite : 0,
    biteEffectiveGain: hasBiteTrait ? baseMetrics.effective - noBite.effective : 0,
    biteDpsGain: hasBiteTrait ? baseMetrics.dps - noBite.dps : 0,
    biteTtkGain: hasBiteTrait ? noBite.ttk - baseMetrics.ttk : 0,
    statusAppliedBreakdown,
  };
}
