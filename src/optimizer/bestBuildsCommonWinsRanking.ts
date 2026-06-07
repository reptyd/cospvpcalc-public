import type { AbilityTimingMode, CreatureRuntime } from "../engine";
import type { CombatEventPhase } from "../engine/eventOrdering";
import { creatureByName } from "../engine/creatureData";
import { DEFAULT_MAX_TIME_SEC } from "../engine/subsystems/timing";
import { buildResultKey } from "../shared/buildEncoding";
import type { BestBuildAggregateResult } from "./bestBuildsFlow";
import { memoizedApplyRulesAndBuild } from "./bestBuildsOptimizations";
import { simulateBestBuildMatchupWithPath } from "./bestBuildsRuntime";
import { compareAggregate, type BestBuildAggregate, type BestBuildAggregateObjective } from "./ranking";
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
  const survivalDelta = b.commonWinAvgSurvival - a.commonWinAvgSurvival;
  if (Math.abs(survivalDelta) > 1e-9) return survivalDelta;
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
  const shortlist = [...items]
    .sort((a, b) => compareWinRateFirst(a.result, b.result))
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
      return compareAggregate(a.result.aggregate, b.result.aggregate, objective);
    }
    const objectiveDelta = compareCommonWinsMetric(a, b, objective);
    if (Math.abs(objectiveDelta) > 1e-9) return objectiveDelta;
    const winRateDelta = b.result.aggregate.winRate - a.result.aggregate.winRate;
    if (Math.abs(winRateDelta) > 1e-9) return winRateDelta;
    const commonDelta = compareCommonWinsTieChain(a, b, objective);
    if (Math.abs(commonDelta) > 1e-9) return commonDelta;
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

  // Best Builds is Rust-only after the TS fallback was retired (E refactor).
  // Common-wins rerank is opportunistic - when Rust bridge is unavailable
  // (test env), skip the rerank and return the deduped list as-is.
  const bridge = await loadRustMatchupBridge().catch(() => null);
  if (!bridge) return deduped.slice(0, FINAL_RESULTS_LIMIT);

  const shortlist = [...deduped].sort(compareWinRateFirst).slice(0, COMMON_WINS_SHORTLIST_SIZE);
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
        maxTimeSec: DEFAULT_MAX_TIME_SEC,
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
