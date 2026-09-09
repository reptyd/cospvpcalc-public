import { applyRulesAndBuild } from "../engine";
import type { CreatureRuntime, FinalStats, SimulationSummary } from "../engine";
import { plushieByName } from "../engine/data";
import { DEFAULT_BUILD, blockStatToStatusId } from "../shared/buildDomain";
import { simulateBuildMatchupViaRust } from "../shared/buildSimulationRust";
import type { OptimizerContext } from "./optimizerContextTypes";
import { compareResult, scoreResult } from "./scoring";

function hasStatImpact(baseline: FinalStats, modified: FinalStats, context: OptimizerContext): boolean {
  if (baseline.damage !== modified.damage) return true;
  if (baseline.health !== modified.health) return true;
  if (baseline.weight !== modified.weight) return true;
  if (baseline.biteCooldown !== modified.biteCooldown) return true;
  if (context.healthRelevant && (baseline.healthRegen ?? 0) !== (modified.healthRegen ?? 0)) return true;
  return false;
}

function totalStatusStacks(statuses: Record<string, number> | undefined): number {
  if (!statuses) return 0;
  return Object.values(statuses).reduce((sum, value) => sum + value, 0);
}

function hasSummaryImpact(baseline: SimulationSummary, current: SimulationSummary, perspective: "A" | "B"): boolean {
  const baseScore = scoreResult(baseline, perspective);
  const nextScore = scoreResult(current, perspective);
  if (baseScore.winRank !== nextScore.winRank) return true;
  if (Math.abs(baseScore.effectiveDamage - nextScore.effectiveDamage) > 0.01) return true;
  if (Math.abs(baseScore.ttk - nextScore.ttk) > 0.01) return true;
  if (Math.abs(baseScore.extendedDamage - nextScore.extendedDamage) > 0.01) return true;
  return false;
}

function isPureBlockPlushieRelevant(plushieName: string, context: OptimizerContext): boolean {
  const plushie = plushieByName[plushieName];
  const blockMods = (plushie?.modifiersParsed ?? []).filter((mod) => mod.stat.startsWith("block"));
  const nonBlockMods = (plushie?.modifiersParsed ?? []).filter((mod) => !mod.stat.startsWith("block"));
  if (blockMods.length === 0 || nonBlockMods.length > 0) return true;

  let hasPositive = false;
  let hasNegative = false;
  for (const mod of blockMods) {
    const statusId = blockStatToStatusId(mod.stat);
    if (!statusId || !context.opponentStatusIds.has(statusId)) continue;
    if (mod.value > 0) hasPositive = true;
    if (mod.value < 0) hasNegative = true;
  }
  return hasPositive && !hasNegative;
}

export async function plushieHasImpact({
  holder,
  plushieName,
  baselineHolder,
  baselineOpponent,
  baselineOpponentDebug,
  context,
  baselineSummary,
  perspective,
}: {
  holder: CreatureRuntime;
  plushieName: string;
  baselineHolder: FinalStats;
  baselineOpponent: FinalStats;
  baselineOpponentDebug: NonNullable<SimulationSummary["debug"]>["A"] | undefined;
  context: OptimizerContext;
  baselineSummary: SimulationSummary;
  perspective: "A" | "B";
}): Promise<boolean> {
  if (!isPureBlockPlushieRelevant(plushieName, context)) return false;

  const plushie = plushieByName[plushieName];
  const blockMods = (plushie?.modifiersParsed ?? []).filter((mod) => mod.stat.startsWith("block"));
  const holderWith = applyRulesAndBuild(holder, { ...DEFAULT_BUILD, venerationStage: 5, plushies: [plushieName] });
  if (hasStatImpact(baselineHolder, holderWith, context)) return true;

  const sim = await simulateBuildMatchupViaRust({
    creatureA: holder,
    buildA: { ...DEFAULT_BUILD, venerationStage: 5, plushies: [plushieName] },
    finalB: baselineOpponent,
    options: { activesOn: true, breathOn: true, maxTimeSec: 12 },
  });
  // If Rust declines, fall back to a stat-only impact check (already done above).
  if (!sim) return false;
  const summary = sim.summary;

  const holderDebug = summary.debug?.A;
  const opponentDebug = summary.debug?.B;
  if ((holderDebug?.plushieOffensiveStacksApplied ?? 0) > 0 || (holderDebug?.plushieDefensiveStacksApplied ?? 0) > 0) {
    return true;
  }

  // Rust adapter populates statusStacksApplied (cumulative stacks landed on
  // opponent during the fight) instead of TS-shape `statuses` (instantaneous
  // end-of-fight). Cumulative is the right metric for "did this plushie cause
  // additional status pressure".
  if (baselineOpponentDebug && opponentDebug) {
    const diff = totalStatusStacks(opponentDebug.statusStacksApplied) - totalStatusStacks(baselineOpponentDebug.statusStacksApplied);
    if (Math.abs(diff) > 0.01) return true;
  }

  if (blockMods.length > 0 && plushie && plushie.modifiersParsed?.every((mod) => mod.stat.startsWith("block"))) {
    return compareResult(scoreResult(summary, perspective), scoreResult(baselineSummary, perspective)) < 0;
  }

  return hasSummaryImpact(baselineSummary, summary, perspective);
}
