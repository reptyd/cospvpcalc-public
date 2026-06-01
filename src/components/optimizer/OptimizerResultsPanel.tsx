// Results panel for the A-vs-B Optimizer page.
//
// Renders BestBuildAggregateResult rows in a lean shape: winner / win-rate /
// average DPS / average TTK / effective damage + build breakdown. The OLD
// Optimizer rendered a parallel `OptimizerResult` shape with deathTimeA/B
// fields the BB engine doesn't surface per-result; for the single-opponent
// case the aggregate IS the matchup, so winRate ∈ {0, 0.5, 1} maps cleanly
// to winner ∈ {B, Draw, A}.

import type { BuildOptions } from "../../engine";
import type { BestBuildAggregateResult } from "../../optimizer/bestBuildsEvaluation";
import { computeAscensionCounts } from "../../shared/buildEncoding";
import { formatRoundedNumber, formatRoundedPercent, formatRoundedSeconds } from "../../shared/displayFormat";

type OptimizerResultsPanelProps = {
  results: BestBuildAggregateResult[];
  resultsLimit: number;
  nameA: string;
  nameB: string;
  onApplyBuildA: (build: BuildOptions) => void;
};

function winnerLabel(winRate: number, drawRate: number): string {
  if (winRate >= 0.5) return "A";
  if (winRate + drawRate >= 0.5) return drawRate > winRate ? "Draw" : "A";
  return "B";
}

export function OptimizerResultsPanel({
  results,
  resultsLimit,
  nameA,
  nameB,
  onApplyBuildA,
}: OptimizerResultsPanelProps) {
  const visible = results.slice(0, resultsLimit);
  return (
    <div className="panel-block optimizer-results-block">
      <h3>Top Builds — {nameA || "A"} vs {nameB || "B"}</h3>
      {results.length === 0 ? (
        <div className="muted">Run the optimizer to see results.</div>
      ) : null}
      {visible.length > 0 ? (
        <ul className="result-list">
          {visible.map((item, idx) => {
            const asc = computeAscensionCounts(
              item.build.traits,
              item.build.ascensionAssignments,
              item.build.venerationStage,
            );
            const agg = item.aggregate;
            const winner = winnerLabel(agg.winRate, agg.drawRate);
            return (
              <li key={`${idx}-${item.build.traits.join("+")}-${item.build.plushies.join("+")}`}>
                <strong>#{idx + 1}</strong> Winner {winner} | Win rate{" "}
                {formatRoundedPercent(agg.winRate * 100)} | Avg TTK{" "}
                {formatRoundedSeconds(agg.avgTtkWin)} | Avg DPS {formatRoundedNumber(agg.avgDps)} |
                Effective {formatRoundedNumber(agg.avgImmortalDamage)} | Survival{" "}
                {formatRoundedSeconds(agg.avgSurvival)}
                <div className="why">
                  Elder: {item.build.elder ?? "None"} | Traits: {item.build.traits.join(" + ") || "none"}{" "}
                  | Ascension:{" "}
                  {item.build.traits.map((trait, i) => `${trait}=${asc[i] ?? 0}`).join(", ") || "none"}{" "}
                  | Plushies: {item.build.plushies.join(" + ") || "none"} | Actives{" "}
                  {item.activesOn ? "ON" : "OFF"} | Breath {item.breathOn ? "ON" : "OFF"}
                </div>
                <div className="row-actions">
                  <button className="secondary" type="button" onClick={() => onApplyBuildA(item.build)}>
                    Apply build to Compare A
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
