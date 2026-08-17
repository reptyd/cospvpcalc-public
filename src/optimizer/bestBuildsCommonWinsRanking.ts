import type { AbilityTimingMode, CreatureRuntime } from "../engine";
import type { CombatEventPhase } from "../engine/eventOrdering";
import { creatureByName } from "../engine/creatureData";
import { DEFAULT_MAX_TIME_SEC } from "../engine/subsystems/timing";
import { buildResultKey } from "../shared/buildEncoding";
import type { BestBuildAggregateResult } from "./bestBuildsFlow";
import { memoizedApplyRulesAndBuild } from "./bestBuildsOptimizations";
import { simulateBestBuildMatchupWithPath } from "./bestBuildsRuntime";
import { compareAggregate, type BestBuildAggregate, type BestBuildAggregateObjective } from "./ranking";
import { objectiveBuildFit } from "./candidateGenerationScoring";
import { loadRustMatchupBridge } from "./rustMatchupLoader";
import { buildResultKeyWithoutAscension } from "./runtimeHelpers";

const COMMON_WINS_SHORTLIST_SIZE = 10;
const FINAL_RESULTS_LIMIT = 10;

export type CommonWinsOutcomeRow = {
  opponentName: string;
  winner: "A" | "B" | "Draw";
  ttk: number;
  dps: number;
  effective: number;
  survival: number;
};

type RankedCommonWinsEntry = {
  result: BestBuildAggregateResult;
  commonWinCount: number;
  commonWinAvgTtk: number;
  commonWinAvgDps: number;
  commonWinAvgEffective: number;
  commonWinAvgSurvival: number;
};

// Absolute, per-objective metric for the pure-metric objectives.
function objectiveMetricDelta(
  a: BestBuildAggregateResult,
  b: BestBuildAggregateResult,
  objective: BestBuildAggregateObjective,
): number {
  if (objective === "avgTtk") return a.aggregate.avgTtkWin - b.aggregate.avgTtkWin; // lower is better
  if (objective === "avgDps") return b.aggregate.avgDps - a.aggregate.avgDps;
  if (objective === "immortalDamage") return b.aggregate.avgImmortalDamage - a.aggregate.avgImmortalDamage;
  return b.aggregate.avgSurvival - a.aggregate.avgSurvival; // survival
}

// Pure-metric ranking: order ABSOLUTELY by the objective's own combat metric
// across the whole opponent pool, then break ties by how well the build's
// composition fits the objective (offence traits win a DPS/TTK tie, regen wins
// a survival tie), then a stable final comparator. Winning is NOT part of these
// objectives, so the win-centric common-wins rerank is bypassed - that machine
// (which shortlists by win-rate and averages over WON matchups only) is a
// winRate-objective feature. Without this, regen lifts win-rate AND survival,
// the universal late tiebreaks, so a regen build silently won every objective's
// ties (e.g. the Health=regen trait flooding DPS/TTK tops).
function rankByAbsoluteObjective(
  results: BestBuildAggregateResult[],
  objective: BestBuildAggregateObjective,
): BestBuildAggregateResult[] {
  return [...results]
    .sort((a, b) => {
      const metric = objectiveMetricDelta(a, b, objective);
      if (Math.abs(metric) > 1e-9) return metric;
      const fit = objectiveBuildFit(b.build, objective) - objectiveBuildFit(a.build, objective);
      if (Math.abs(fit) > 1e-9) return fit;
      return compareAggregate(a.aggregate, b.aggregate, objective);
    })
    .slice(0, FINAL_RESULTS_LIMIT);
}

function compareWinRateFirst(a: BestBuildAggregateResult, b: BestBuildAggregateResult): number {
  const winRateDelta = b.aggregate.winRate - a.aggregate.winRate;
  if (Math.abs(winRateDelta) > 1e-9) return winRateDelta;
  const ttkDelta = a.aggregate.avgTtkWin - b.aggregate.avgTtkWin;
  if (Math.abs(ttkDelta) > 1e-9) return ttkDelta;
  const effectiveDelta = b.aggregate.avgImmortalDamage - a.aggregate.avgImmortalDamage;
  if (Math.abs(effectiveDelta) > 1e-9) return effectiveDelta;
  const dpsDelta = b.aggregate.avgDps - a.aggregate.avgDps;
  if (Math.abs(dpsDelta) > 1e-9) return dpsDelta;
  return b.aggregate.avgSurvival - a.aggregate.avgSurvival;
}

// Which builds enter the common-wins shortlist. winRate keeps the legacy
// win-rate-first seed; every other objective is seeded by its OWN metric and
// then by build-fit, so the shortlist isn't pre-filled with regen builds that
// merely have a higher win-rate/survival - which was letting the Health=regen
// trait crowd DPS/TTK results.
function compareSeedForObjective(
  a: BestBuildAggregateResult,
  b: BestBuildAggregateResult,
  objective: BestBuildAggregateObjective,
): number {
  if (objective === "winRate") return compareWinRateFirst(a, b);
  const metric = objectiveMetricDelta(a, b, objective);
  if (Math.abs(metric) > 1e-9) return metric;
  const fit = objectiveBuildFit(b.build, objective) - objectiveBuildFit(a.build, objective);
  if (Math.abs(fit) > 1e-9) return fit;
  return compareWinRateFirst(a, b);
}

function intersectCommonWins(rowsByBuild: CommonWinsOutcomeRow[][]): string[] {
  if (rowsByBuild.length === 0) return [];
  const isNonLoss = (winner: "A" | "B" | "Draw") => winner !== "B";
  let common = new Set(
    rowsByBuild[0].filter((row) => isNonLoss(row.winner)).map((row) => row.opponentName),
  );
  for (let i = 1; i < rowsByBuild.length; i += 1) {
    const wins = new Set(rowsByBuild[i].filter((row) => isNonLoss(row.winner)).map((row) => row.opponentName));
    common = new Set(Array.from(common).filter((name) => wins.has(name)));
    if (common.size === 0) return [];
  }
  return Array.from(common).sort((a, b) => a.localeCompare(b));
}

function computeCommonWinMetrics(rows: CommonWinsOutcomeRow[], commonWins: Set<string>): Omit<RankedCommonWinsEntry, "result"> {
  const commonRows = rows.filter((row) => commonWins.has(row.opponentName));
  if (commonRows.length === 0) {
    return {
      commonWinCount: 0,
      commonWinAvgTtk: Number.POSITIVE_INFINITY,
      commonWinAvgDps: 0,
      commonWinAvgEffective: 0,
      commonWinAvgSurvival: 0,
    };
  }
  const totalTtk = commonRows.reduce((sum, row) => sum + row.ttk, 0);
  const totalDps = commonRows.reduce((sum, row) => sum + row.dps, 0);
  const totalEffective = commonRows.reduce((sum, row) => sum + row.effective, 0);
  const totalSurvival = commonRows.reduce((sum, row) => sum + row.survival, 0);
  return {
    commonWinCount: commonRows.length,
    commonWinAvgTtk: totalTtk / commonRows.length,
    commonWinAvgDps: totalDps / commonRows.length,
    commonWinAvgEffective: totalEffective / commonRows.length,
    commonWinAvgSurvival: totalSurvival / commonRows.length,
  };
}

function compareCommonWinsMetric(
  a: RankedCommonWinsEntry,
  b: RankedCommonWinsEntry,
  objective: BestBuildAggregateObjective,
): number {
  if (objective === "avgTtk") return a.commonWinAvgTtk - b.commonWinAvgTtk;
  if (objective === "avgDps") return b.commonWinAvgDps - a.commonWinAvgDps;
  if (objective === "immortalDamage") return b.commonWinAvgEffective - a.commonWinAvgEffective;
  if (objective === "survival") return b.commonWinAvgSurvival - a.commonWinAvgSurvival;
  return 0;
}

function compareWinRateWithCommonTiebreak(
  a: RankedCommonWinsEntry,
  b: RankedCommonWinsEntry,
): number {
  const winRateDelta = b.result.aggregate.winRate - a.result.aggregate.winRate;
  if (Math.abs(winRateDelta) > 1e-9) return winRateDelta;
  const ttkDelta = a.commonWinAvgTtk - b.commonWinAvgTtk;
  if (Math.abs(ttkDelta) > 1e-9) return ttkDelta;
  const dpsDelta = b.commonWinAvgDps - a.commonWinAvgDps;
  if (Math.abs(dpsDelta) > 1e-9) return dpsDelta;
  const effectiveDelta = b.commonWinAvgEffective - a.commonWinAvgEffective;
  if (Math.abs(effectiveDelta) > 1e-9) return effectiveDelta;
  // No commonWinAvgSurvival tiebreak here: survival rewards the regen (Health)
  // trait, which let it ride win-rate ties to the top. The caller applies an
  // offence build-fit tiebreak next, then falls to compareAggregate (whose
  // survival tail stays as the deterministic last resort).
  return 0;
}

function compareCommonWinsTieChain(
  a: RankedCommonWinsEntry,
  b: RankedCommonWinsEntry,
  objective: BestBuildAggregateObjective,
): number {
  const baseOrder: BestBuildAggregateObjective[] = ["avgTtk", "avgDps", "immortalDamage", "survival"];
  const order: BestBuildAggregateObjective[] = baseOrder.filter((key) => key !== objective);
  for (const key of order) {
    const delta = compareCommonWinsMetric(a, b, key);
    if (Math.abs(delta) > 1e-9) return delta;
  }
  return 0;
}

function applyCommonWinsMetadata(
  result: BestBuildAggregateResult,
  commonWinsEntry: RankedCommonWinsEntry,
  objective: BestBuildAggregateObjective,
): BestBuildAggregateResult {
  const aggregate: BestBuildAggregate = {
    ...result.aggregate,
    commonWinsCount: commonWinsEntry.commonWinCount,
    commonWinsMetricKind:
      objective === "avgTtk" || objective === "avgDps" || objective === "immortalDamage" || objective === "survival"
        ? objective
        : "avgTtk",
    commonWinsAvgTtkWin: commonWinsEntry.commonWinAvgTtk,
    commonWinsAvgDps: commonWinsEntry.commonWinAvgDps,
    commonWinsAvgImmortalDamage: commonWinsEntry.commonWinAvgEffective,
    commonWinsAvgSurvival: commonWinsEntry.commonWinAvgSurvival,
  };
  return {
    ...result,
    aggregate,
  };
}

export function rerankBestBuildsByCommonWinsData(
  items: Array<{ result: BestBuildAggregateResult; rows: CommonWinsOutcomeRow[] }>,
  objective: BestBuildAggregateObjective,
): BestBuildAggregateResult[] {
  // Survival is a pure-lifespan objective - rank by absolute avgSurvival, not
  // common wins (winning isn't part of it). All other objectives keep the
  // common-wins ranking, but the shortlist is seeded by the OBJECTIVE's own
  // metric + fit (see compareSeedForObjective) rather than win-rate-first, so a
  // regen build no longer crowds the shortlist on win-rate/survival for a
  // DPS/TTK objective.
  if (objective === "survival") {
    return rankByAbsoluteObjective(items.map((item) => item.result), "survival");
  }
  const shortlist = [...items]
    .sort((a, b) => compareSeedForObjective(a.result, b.result, objective))
    .slice(0, COMMON_WINS_SHORTLIST_SIZE);
  if (shortlist.length === 0) return [];

  const commonWinsList = intersectCommonWins(shortlist.map((item) => item.rows));
  if (commonWinsList.length === 0) {
    return shortlist.map((item) => item.result).slice(0, FINAL_RESULTS_LIMIT);
  }
  const commonWins = new Set(commonWinsList);

  const ranked: RankedCommonWinsEntry[] = shortlist.map((item) => ({
    result: item.result,
    ...computeCommonWinMetrics(item.rows, commonWins),
  }));

  ranked.sort((a, b) => {
    if (objective === "winRate") {
      const delta = compareWinRateWithCommonTiebreak(a, b);
      if (Math.abs(delta) > 1e-9) return delta;
      // Offence build-fit BEFORE the survival-ending aggregate chain, so a
      // genuine win-rate tie favours the build that fits (offence) instead of
      // whichever has more regen - the same tiebreak the other objectives use
      // (lines below); it was missed for winRate, which let the Health=regen
      // trait flood the win-rate tops.
      const fitDelta =
        objectiveBuildFit(b.result.build, "winRate") - objectiveBuildFit(a.result.build, "winRate");
      if (Math.abs(fitDelta) > 1e-9) return fitDelta;
      return compareAggregate(a.result.aggregate, b.result.aggregate, objective);
    }
    const objectiveDelta = compareCommonWinsMetric(a, b, objective);
    if (Math.abs(objectiveDelta) > 1e-9) return objectiveDelta;
    const winRateDelta = b.result.aggregate.winRate - a.result.aggregate.winRate;
    if (Math.abs(winRateDelta) > 1e-9) return winRateDelta;
    const commonDelta = compareCommonWinsTieChain(a, b, objective);
    if (Math.abs(commonDelta) > 1e-9) return commonDelta;
    // Final tie-break by objective fit BEFORE falling to the raw-aggregate
    // chain (which ends in survival) - so a genuine all-metrics tie favours the
    // build that fits the objective, not whichever happens to have more regen.
    const fitDelta =
      objectiveBuildFit(b.result.build, objective) - objectiveBuildFit(a.result.build, objective);
    if (Math.abs(fitDelta) > 1e-9) return fitDelta;
    return compareAggregate(a.result.aggregate, b.result.aggregate, objective);
  });

  return ranked
    .map((item) => applyCommonWinsMetadata(item.result, item, objective))
    .slice(0, FINAL_RESULTS_LIMIT);
}

export async function rerankBestBuildResultsByCommonWins({
  results,
  sourceCreature,
  activePool,
  objective,
  showAllAscensionDistributions,
  abilityPolicy,
  combatEventOrder,
  extraAbilityConfig,
  extraCombatantStats,
  extraSpecialAbilities,
  extraBuffs,
  extraTrapsTrails,
  opponentBaselineBuild,
  maxTimeSec = DEFAULT_MAX_TIME_SEC,
}: {
  results: BestBuildAggregateResult[];
  sourceCreature: CreatureRuntime;
  activePool: string[];
  objective: BestBuildAggregateObjective;
  showAllAscensionDistributions: boolean;
  abilityPolicy: AbilityTimingMode;
  combatEventOrder?: CombatEventPhase[];
  extraAbilityConfig?: Partial<import("./rustMatchupBridge").RustComposableAbilityConfig>;
  extraCombatantStats?: import("./bestBuildsBattleSettingsBridge").BestBuildsExtraCombatantStats;
  extraSpecialAbilities?: import("./bestBuildsBattleSettingsBridge").BestBuildsExtraSpecialAbilities;
  extraBuffs?: import("./bestBuildsBattleSettingsBridge").BestBuildsExtraBuffs;
  extraTrapsTrails?: import("./bestBuildsBattleSettingsBridge").BestBuildsExtraTrapsTrails;
  opponentBaselineBuild?: import("../engine").BuildOptions;
  maxTimeSec?: number;
}): Promise<BestBuildAggregateResult[]> {
  const bestByKey = new Map<string, BestBuildAggregateResult>();
  for (const result of results) {
    const key = showAllAscensionDistributions
      ? buildResultKey(result.build, result.activesOn, result.breathOn)
      : buildResultKeyWithoutAscension(result.build, result.activesOn, result.breathOn);
    const existing = bestByKey.get(key);
    if (!existing || compareAggregate(result.aggregate, existing.aggregate, objective) < 0) {
      bestByKey.set(key, result);
    }
  }
  const deduped = Array.from(bestByKey.values());

  // Survival ranks by absolute average lifespan and skips the common-wins
  // re-simulation entirely (winning isn't part of it). Other objectives keep
  // common wins, but with an objective-seeded shortlist (below).
  if (objective === "survival") {
    return rankByAbsoluteObjective(deduped, "survival");
  }

  // Best Builds is Rust-only after the TS fallback was retired (E refactor).
  // Common-wins rerank is opportunistic - when Rust bridge is unavailable
  // (test env), skip the rerank and return the deduped list as-is.
  const bridge = await loadRustMatchupBridge().catch(() => null);
  if (!bridge) return deduped.slice(0, FINAL_RESULTS_LIMIT);

  const shortlist = [...deduped]
    .sort((a, b) => compareSeedForObjective(a, b, objective))
    .slice(0, COMMON_WINS_SHORTLIST_SIZE);
  const withRows = shortlist.map((result) => {
    const finalA = memoizedApplyRulesAndBuild(sourceCreature, result.build);
    const rows: CommonWinsOutcomeRow[] = [];
    for (const opponentName of activePool) {
      const opponentCreature = creatureByName[opponentName] as CreatureRuntime | undefined;
      if (!opponentCreature) continue;
      const { summary, path } = simulateBestBuildMatchupWithPath({
        sourceCreature,
        sourceBuild: result.build,
        finalA,
        opponentCreature,
        opponentBaselineBuild,
        activesOn: result.activesOn,
        breathOn: result.breathOn,
        maxTimeSec,
        abilityPolicy,
        combatEventOrder,
        extraAbilityConfig,
        extraCombatantStats,
        extraSpecialAbilities,
        extraBuffs,
        extraTrapsTrails,
      });
      void path;
      rows.push({
        opponentName,
        winner: summary.winner,
        ttk: summary.ttkAtoB,
        dps: summary.dpsAtoB,
        effective:
          summary.winner === "A"
            ? summary.damageDealtAAtBDeath + summary.extendedDamagePotentialA
            : summary.damageDealtA,
        survival: summary.deathTimeA ?? summary.maxTimeSec,
      });
    }
    return { result, rows };
  });

  return rerankBestBuildsByCommonWinsData(withRows, objective);
}
