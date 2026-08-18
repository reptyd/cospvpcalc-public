import type { BuildOptions } from "../engine";
import { traits, veneration } from "../engine/buildData";
import { parsePercentValue, traitNameFromId } from "../shared/buildDomain";
import { computeAscensionCounts } from "../shared/buildEncoding";
import type {
  BuildDetailsExplainAnalysis,
  BuildDetailsPerspectiveMetrics,
  BuildDetailsSplitAnalysis,
  BuildDetailsStatusAnalysisSnapshot,
} from "./buildDetailsExplainTypes";

const traitOptions = traits;

export function resolveTraitLevelPercent(traitId: string, level: number): number {
  const traitName = traitNameFromId(traitId);
  const ascension = veneration.traitAscension[traitName];
  if (ascension?.sequence?.length) {
    const idx = Math.max(0, Math.min(level, ascension.sequence.length - 1));
    return parsePercentValue(ascension.sequence[idx]);
  }
  const trait = traitOptions.find((entry) => entry.id === traitId);
  if (trait?.effectText) return parsePercentValue(trait.effectText);
  return 0;
}

export function buildTraitCountById(build: BuildOptions): Record<string, number> {
  const ascCounts = computeAscensionCounts(build.traits, build.ascensionAssignments, build.venerationStage);
  const traitCountById: Record<string, number> = {};
  build.traits.forEach((id, idx) => {
    traitCountById[id] = ascCounts[idx] ?? 0;
  });
  return traitCountById;
}

export function createBuildDetailsExplainAnalysis({
  build,
  winner,
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
}: {
  build: BuildOptions;
  winner: string;
  base: BuildDetailsPerspectiveMetrics;
  noTraits: BuildDetailsPerspectiveMetrics;
  noTrait1: BuildDetailsPerspectiveMetrics;
  noTrait2: BuildDetailsPerspectiveMetrics;
  trait1Base: BuildDetailsPerspectiveMetrics;
  trait2Base: BuildDetailsPerspectiveMetrics;
  traitCountById: Record<string, number>;
  hasWeightTrait: boolean;
  noWeight: BuildDetailsPerspectiveMetrics;
  hasHealthTrait: boolean;
  noHealth: BuildDetailsPerspectiveMetrics;
  statusAnalysis: BuildDetailsStatusAnalysisSnapshot;
  topSplits: BuildDetailsSplitAnalysis[];
}): BuildDetailsExplainAnalysis {
  const trait1 = build.traits[0] ?? "";
  const trait2 = build.traits[1] ?? "";

  return {
    trait1,
    trait2,
    traitCountById,
    traitLine: build.traits.length > 0 ? build.traits.join(", ") : "None",
    plushieLine: build.plushies.filter(Boolean).length > 0 ? build.plushies.filter(Boolean).join(", ") : "None",
    ascLine:
      build.traits.length >= 2
        ? `${build.traits[0]}=${traitCountById[build.traits[0]] ?? 0}, ${build.traits[1]}=${traitCountById[build.traits[1]] ?? 0}`
        : "N/A",
    winner,
    dps: base.dps,
    killDps: base.killDps,
    ttk: base.ttk,
    effective: base.effective,
    baseTraitGain: base.effective - noTraits.effective,
    trait1PercentBase: trait1 ? resolveTraitLevelPercent(trait1, 0) : 0,
    trait1PercentTotal: trait1 ? resolveTraitLevelPercent(trait1, traitCountById[trait1] ?? 0) : 0,
    trait2PercentBase: trait2 ? resolveTraitLevelPercent(trait2, 0) : 0,
    trait2PercentTotal: trait2 ? resolveTraitLevelPercent(trait2, traitCountById[trait2] ?? 0) : 0,
    trait1FullEff: base.effective - noTrait1.effective,
    trait2FullEff: base.effective - noTrait2.effective,
    trait1BaseGain: trait1Base.effective - noTrait1.effective,
    trait2BaseGain: trait2Base.effective - noTrait2.effective,
    trait1UpgradeEff: base.effective - trait1Base.effective,
    trait2UpgradeEff: base.effective - trait2Base.effective,
    trait1FullDps: base.dps - noTrait1.dps,
    trait2FullDps: base.dps - noTrait2.dps,
    trait1BaseDps: trait1Base.dps - noTrait1.dps,
    trait2BaseDps: trait2Base.dps - noTrait2.dps,
    trait1UpgradeDps: base.dps - trait1Base.dps,
    trait2UpgradeDps: base.dps - trait2Base.dps,
    trait1TtkGain: noTrait1.ttk - base.ttk,
    trait2TtkGain: noTrait2.ttk - base.ttk,
    trait1BaseTtk: noTrait1.ttk - trait1Base.ttk,
    trait2BaseTtk: noTrait2.ttk - trait2Base.ttk,
    trait1UpgradeTtk: trait1Base.ttk - base.ttk,
    trait2UpgradeTtk: trait2Base.ttk - base.ttk,
    statusGainEffective: base.effective - statusAnalysis.noStatuses.effective,
    statusGainDps: base.dps - statusAnalysis.noStatuses.dps,
    statusGainTtk: statusAnalysis.noStatuses.ttk - base.ttk,
    statusPressureEstimate: (base.dps - statusAnalysis.noStatuses.dps) * Math.max(0.5, Math.min(60, base.ttk)),
    statusStacksBase: statusAnalysis.statusStacksBase,
    statusStacksNo: statusAnalysis.statusStacksNo,
    dotDpsBase: statusAnalysis.dotDpsBase,
    dotDpsNo: statusAnalysis.dotDpsNo,
    opponentRegenDenied: statusAnalysis.opponentRegenDenied,
    biteStatusSynergy: statusAnalysis.biteStatusSynergy,
    biteStatusStacksGain: statusAnalysis.biteStatusStacksGain,
    biteEffectiveGain: statusAnalysis.biteEffectiveGain,
    biteDpsGain: statusAnalysis.biteDpsGain,
    biteTtkGain: statusAnalysis.biteTtkGain,
    weightOffGain: hasWeightTrait ? base.effective - noWeight.effective : 0,
    weightDefGain: hasWeightTrait ? noWeight.incomingUntilDeath - base.incomingUntilDeath : 0,
    healthRegenGain: hasHealthTrait ? base.regenHealed - noHealth.regenHealed : 0,
    topSplits,
    statusAppliedBreakdown: statusAnalysis.statusAppliedBreakdown,
  };
}
