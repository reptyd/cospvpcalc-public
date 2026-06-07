import type { BuildOptions } from "../engine";
import { creatureByName } from "../engine/creatureData";
import type { CombatEventPhase } from "../engine/eventOrdering";
import { DEFAULT_MAX_TIME_SEC } from "../engine/subsystems/timing";
import { memoizedApplyRulesAndBuild } from "./bestBuildsOptimizations";
import type { BestBuildAggregateResult } from "./bestBuildsFlow";
import { simulateBestBuildMatchup } from "./bestBuildsRuntime";

export type BestBuildPerOpponentRow = {
  name: string;
  tier: number;
  winner: "A" | "B" | "Draw";
  ttk: number;
  dps: number;
  effective: number;
  survival: number;
};

export async function loadPerOpponentRows({
  sourceName,
  activePool,
  item,
  combatEventOrder,
  extraAbilityConfig,
  extraCombatantStats,
  extraSpecialAbilities,
  extraBuffs,
  extraTrapsTrails,
  opponentBaselineBuild,
}: {
  sourceName: string;
  activePool: string[];
  item: BestBuildAggregateResult;
  combatEventOrder?: CombatEventPhase[];
  extraAbilityConfig?: Partial<import("./rustMatchupBridge").RustComposableAbilityConfig>;
  extraCombatantStats?: import("./bestBuildsBattleSettingsBridge").BestBuildsExtraCombatantStats;
  extraSpecialAbilities?: import("./bestBuildsBattleSettingsBridge").BestBuildsExtraSpecialAbilities;
  extraBuffs?: import("./bestBuildsBattleSettingsBridge").BestBuildsExtraBuffs;
  extraTrapsTrails?: import("./bestBuildsBattleSettingsBridge").BestBuildsExtraTrapsTrails;
  opponentBaselineBuild?: BuildOptions;
}): Promise<BestBuildPerOpponentRow[]> {
  const source = creatureByName[sourceName];
  if (!source) return [];
  const finalA = memoizedApplyRulesAndBuild(source, item.build);
  const rows: BestBuildPerOpponentRow[] = [];

  for (let i = 0; i < activePool.length; i += 1) {
    const opponentName = activePool[i];
    const opponent = creatureByName[opponentName];
    if (!opponent) continue;
    const summary = simulateBestBuildMatchup({
      sourceCreature: source,
      sourceBuild: item.build,
      finalA,
      opponentCreature: opponent,
      opponentBaselineBuild,
      activesOn: item.activesOn,
      breathOn: item.breathOn,
      maxTimeSec: DEFAULT_MAX_TIME_SEC,
      abilityPolicy: "ideal",
      combatEventOrder,
      extraAbilityConfig,
      extraCombatantStats,
      extraSpecialAbilities,
      extraBuffs,
      extraTrapsTrails,
    });
    rows.push({
      name: opponentName,
      tier: opponent.stats.tier,
      winner: summary.winner,
      ttk: summary.ttkAtoB,
      dps: summary.dpsAtoB,
      effective: summary.winner === "A" ? summary.damageDealtAAtBDeath : summary.damageDealtA,
      survival: summary.deathTimeA ?? summary.maxTimeSec,
    });
    if (i % 12 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
  }

  rows.sort((a, b) => {
    const rankA = a.winner === "A" ? 0 : a.winner === "Draw" ? 1 : 2;
    const rankB = b.winner === "A" ? 0 : b.winner === "Draw" ? 1 : 2;
    return rankA - rankB || a.ttk - b.ttk;
  });
  return rows;
}
