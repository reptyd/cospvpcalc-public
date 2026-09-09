import type { BuildOptions } from "../engine";
import { formatRoundedNumber, formatRoundedPercent, formatRoundedSeconds } from "../shared/displayFormat";
import type { BuildDetailsExplainAnalysis } from "./buildDetailsExplainTypes";

export function formatBuildExplainText(
  build: BuildOptions,
  side: "A" | "B",
  analysis: BuildDetailsExplainAnalysis,
): string {
  const lines = [
    `Build setup: Veneration=${build.venerationStage} | Traits=[${analysis.traitLine}] | Plushies=[${analysis.plushieLine}] | Ascension=[${analysis.ascLine}]`,
    `Build ${side} - mathematical explanation`,
    `Winner=${analysis.winner} | DPS=${formatRoundedNumber(analysis.dps)} | Kill-DPS=${formatRoundedNumber(analysis.killDps)} | TTK=${formatRoundedSeconds(analysis.ttk)} | EffectiveDamage=${formatRoundedNumber(analysis.effective)}`,
    "",
    "1) Trait distribution rationale",
    `- Base trait gain vs no traits: ${formatRoundedNumber(analysis.baseTraitGain)} effective damage`,
    analysis.trait1
      ? `- ${analysis.trait1} raw value: ${formatRoundedPercent(analysis.trait1PercentBase)} base + ${formatRoundedPercent(analysis.trait1PercentTotal - analysis.trait1PercentBase)} from ${analysis.traitCountById[analysis.trait1] ?? 0} ascension points (total ${formatRoundedPercent(analysis.trait1PercentTotal)})`
      : "- Trait1: not selected",
    `- ${analysis.trait1 || "Trait1"} FULL impact: effective ${formatRoundedNumber(analysis.trait1FullEff)}, DPS ${formatRoundedNumber(analysis.trait1FullDps)}, TTK gain ${formatRoundedSeconds(analysis.trait1TtkGain)}`,
    analysis.trait1 ? `- ${analysis.trait1} BASE impact: effective ${formatRoundedNumber(analysis.trait1BaseGain)}, DPS ${formatRoundedNumber(analysis.trait1BaseDps)}` : "",
    analysis.trait1
      ? `- ${analysis.trait1} UPGRADES impact: effective ${formatRoundedNumber(analysis.trait1UpgradeEff)}, DPS ${formatRoundedNumber(analysis.trait1UpgradeDps)}, TTK gain ${formatRoundedSeconds(analysis.trait1UpgradeTtk)} (base TTK gain ${formatRoundedSeconds(analysis.trait1BaseTtk)})`
      : "",
    analysis.trait2
      ? `- ${analysis.trait2} raw value: ${formatRoundedPercent(analysis.trait2PercentBase)} base + ${formatRoundedPercent(analysis.trait2PercentTotal - analysis.trait2PercentBase)} from ${analysis.traitCountById[analysis.trait2] ?? 0} ascension points (total ${formatRoundedPercent(analysis.trait2PercentTotal)})`
      : "- Trait2: not selected",
    `- ${analysis.trait2 || "Trait2"} FULL impact: effective ${formatRoundedNumber(analysis.trait2FullEff)}, DPS ${formatRoundedNumber(analysis.trait2FullDps)}, TTK gain ${formatRoundedSeconds(analysis.trait2TtkGain)}`,
    analysis.trait2 ? `- ${analysis.trait2} BASE impact: effective ${formatRoundedNumber(analysis.trait2BaseGain)}, DPS ${formatRoundedNumber(analysis.trait2BaseDps)}` : "",
    analysis.trait2
      ? `- ${analysis.trait2} UPGRADES impact: effective ${formatRoundedNumber(analysis.trait2UpgradeEff)}, DPS ${formatRoundedNumber(analysis.trait2UpgradeDps)}, TTK gain ${formatRoundedSeconds(analysis.trait2UpgradeTtk)} (base TTK gain ${formatRoundedSeconds(analysis.trait2BaseTtk)})`
      : "",
    "",
    "2) On-hit status contribution",
    `- Effective delta with statuses ON vs OFF: ${formatRoundedNumber(analysis.statusGainEffective)}`,
    `- DPS delta with statuses ON vs OFF: ${formatRoundedNumber(analysis.statusGainDps)}`,
    `- TTK gain from statuses (seconds): ${formatRoundedNumber(analysis.statusGainTtk)}`,
    `- Estimated status pressure over fight: ${formatRoundedNumber(analysis.statusPressureEstimate)}`,
    `- Status stacks applied (ON/OFF): ${formatRoundedNumber(analysis.statusStacksBase)} / ${formatRoundedNumber(analysis.statusStacksNo)}`,
    `- Dot DPS at end (ON/OFF): ${formatRoundedNumber(analysis.dotDpsBase)} / ${formatRoundedNumber(analysis.dotDpsNo)}`,
    `- Opponent regen denied by statuses: ${formatRoundedNumber(analysis.opponentRegenDenied)}`,
    `- Bite -> status synergy effective delta: ${formatRoundedNumber(analysis.biteStatusSynergy)}`,
    `- Bite-driven extra status stacks: ${formatRoundedNumber(analysis.biteStatusStacksGain)}`,
    `- Bite trait direct gain (effective / DPS / TTKs): ${formatRoundedNumber(analysis.biteEffectiveGain)} / ${formatRoundedNumber(analysis.biteDpsGain)} / ${formatRoundedNumber(analysis.biteTtkGain)}`,
    "",
    "3) Defensive/offensive survivability factors",
    `- Weight trait offensive gain: ${formatRoundedNumber(analysis.weightOffGain)} effective damage`,
    `- Weight trait prevented incoming damage: ${formatRoundedNumber(analysis.weightDefGain)}`,
    `- Health trait extra regen healed: ${formatRoundedNumber(analysis.healthRegenGain)}`,
    "",
    "4) Closest ascension alternatives (same traits/plushies/veneration)",
    "- Ranking uses score tuple in this order: winRank(2=win,1=draw,0=lose) -> TTK -> effectiveDamage -> extendedDamage",
    ...analysis.topSplits.map((split, idx) => {
      const partA = `${build.traits[0] ?? "Trait1"}=${split.counts[0] ?? 0}`;
      const partB = `${build.traits[1] ?? "Trait2"}=${split.counts[1] ?? 0}`;
      return `- #${idx + 1}: ${partA}, ${partB} | score(win=${split.score.winRank}, ttk=${formatRoundedNumber(split.score.ttk)}, eff=${formatRoundedNumber(split.score.effectiveDamage)}, ext=${formatRoundedNumber(split.score.extendedDamage)}) | DPS=${formatRoundedNumber(split.metrics.dps)} | Kill-DPS=${formatRoundedNumber(split.metrics.killDps)} | TTK=${formatRoundedSeconds(split.metrics.ttk)} | Effective=${formatRoundedNumber(split.metrics.effective)}`;
    }),
    "",
    "5) Status application breakdown on opponent",
    ...(analysis.statusAppliedBreakdown.length === 0
      ? ["- No status stacks were applied by this side in this run."]
      : analysis.statusAppliedBreakdown.map(([statusId, stacks]) => `- ${statusId}: ${formatRoundedNumber(stacks)} stacks applied`)),
    "",
    "Conclusion: this build is ranked by score tuple first (win, then TTK, then effective, then extended), not by raw DPS alone.",
  ];

  return lines.filter((line) => line !== "").join("\n");
}
