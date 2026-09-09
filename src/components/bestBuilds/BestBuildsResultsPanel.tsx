import type { BuildOptions } from "../../engine";
import type { BestBuildAggregateResult } from "../../optimizer/bestBuildsFlow";
import type { BestBuildAggregate } from "../../optimizer/ranking";
import { buildResultKey, computeAscensionCounts } from "../../shared/buildEncoding";
import { formatRoundedNumber, formatRoundedPercent, formatRoundedSeconds } from "../../shared/displayFormat";

type BestBuildPerOpponentRow = {
  name: string;
  tier: number;
  winner: "A" | "B" | "Draw";
  ttk: number;
  dps: number;
  effective: number;
  survival: number;
};

type BestBuildsResultsPanelProps = {
  trueDeveloperMode: boolean;
  results: BestBuildAggregateResult[];
  topResultDiagnostic: {
    workerAggregate: BestBuildAggregate;
    mainThreadAggregate: BestBuildAggregate;
    buildLabel: string;
    referenceBuildComparisons: Array<{
      label: string;
      aggregate: BestBuildAggregate;
    }>;
  } | null;
  expandedResultKey: string | null;
  loadingPerOpponentKey: string | null;
  currentPerOpponentRows: BestBuildPerOpponentRow[] | null;
  onApplyBuildA: (value: BuildOptions) => void;
  onCopyBuildHeader: (item: BestBuildAggregateResult, idx: number) => void | Promise<void>;
  onTogglePerOpponent: (item: BestBuildAggregateResult, idx: number) => void | Promise<void>;
};

export function BestBuildsResultsPanel({
  trueDeveloperMode,
  results,
  topResultDiagnostic,
  expandedResultKey,
  loadingPerOpponentKey,
  currentPerOpponentRows,
  onApplyBuildA,
  onCopyBuildHeader,
  onTogglePerOpponent,
}: BestBuildsResultsPanelProps) {
  return (
    <div className="panel-block optimizer-results-block">
      <h3>Top aggregate builds</h3>
      {trueDeveloperMode && topResultDiagnostic ? (
        <div className="note">
          Top-1 diagnostic: {topResultDiagnostic.buildLabel}
          <br />
          Worker result: TTK {formatRoundedSeconds(topResultDiagnostic.workerAggregate.avgTtkWin)}, DPS{" "}
          {formatRoundedNumber(topResultDiagnostic.workerAggregate.avgDps)}, Effective{" "}
          {formatRoundedNumber(topResultDiagnostic.workerAggregate.avgImmortalDamage)}
          <br />
          Main-thread: TTK {formatRoundedSeconds(topResultDiagnostic.mainThreadAggregate.avgTtkWin)}, DPS{" "}
          {formatRoundedNumber(topResultDiagnostic.mainThreadAggregate.avgDps)}, Effective{" "}
          {formatRoundedNumber(topResultDiagnostic.mainThreadAggregate.avgImmortalDamage)}
          {topResultDiagnostic.referenceBuildComparisons.length > 0 ? (
            <>
              <br />
              Reference builds:{" "}
              {topResultDiagnostic.referenceBuildComparisons
                .map(
                  (row) =>
                    `${row.label} [WR ${formatRoundedPercent(row.aggregate.winRate * 100)} TTK ${formatRoundedSeconds(row.aggregate.avgTtkWin)} Eff ${formatRoundedNumber(row.aggregate.avgImmortalDamage)}]`,
                )
                .join(" | ")}
            </>
          ) : null}
        </div>
      ) : null}
      {results.length === 0 ? <div className="muted">Run calculation to see top builds.</div> : null}
      {results.length > 0 ? (
        <ul className="result-list">
          {results.map((item, idx) => {
            const asc = computeAscensionCounts(item.build.traits, item.build.ascensionAssignments, item.build.venerationStage);
            const resultKey = buildResultKey(item.build, item.activesOn, item.breathOn);
            return (
              <li key={resultKey}>
                <strong>#{idx + 1}</strong> {formatTopLine(item.aggregate)}
                <div className="why">
                  Elder: {item.build.elder ?? "None"} | 
                  {" "}
                  Traits: {item.build.traits.join(" + ")} | Ascension:{" "}
                  {item.build.traits.map((trait, i) => `${trait}=${asc[i] ?? 0}`).join(", ")} | Plushies:{" "}
                  {item.build.plushies.join(" + ") || "none"} | Pool: {item.opponentsCount}
                </div>
                <div className="row-actions">
                  <button className="secondary" type="button" onClick={() => onApplyBuildA(item.build)}>
                    Apply build to Compare A
                  </button>
                  <button className="secondary" type="button" onClick={() => void onCopyBuildHeader(item, idx)}>
                    Copy summary
                  </button>
                  <button className="secondary" type="button" onClick={() => void onTogglePerOpponent(item, idx)}>
                    {expandedResultKey === resultKey ? "Hide per-opponent" : "Show per-opponent"}
                  </button>
                </div>
                {loadingPerOpponentKey === resultKey ? <div className="note">Loading per-opponent results...</div> : null}
                {expandedResultKey === resultKey && currentPerOpponentRows ? (
                  <div className="aggregate-compare-table-wrap">
                    <table className="aggregate-compare-table">
                      <thead>
                        <tr>
                          <th>Opponent</th>
                          <th>Tier</th>
                          <th>Winner</th>
                          <th>TTK</th>
                          <th>DPS</th>
                          <th>Effective</th>
                          <th>Survival</th>
                        </tr>
                      </thead>
                      <tbody>
                        {currentPerOpponentRows.map((row) => (
                          <tr key={`${resultKey}-${row.name}`}>
                            <td>{row.name}</td>
                            <td>T{row.tier}</td>
                            <td>{row.winner}</td>
                            <td>{formatRoundedSeconds(row.ttk)}</td>
                            <td>{formatRoundedNumber(row.dps)}</td>
                            <td>{formatRoundedNumber(row.effective)}</td>
                            <td>{formatRoundedSeconds(row.survival)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

function formatTopLine(aggregate: BestBuildAggregate): string {
  const segments = [
    `WinRate ${formatBestBuildWinRatePercent(aggregate.winRate * 100)}`,
    buildMetricSegment("Avg survival", formatRoundedSeconds(aggregate.avgSurvival), getCommonWinsInlineMetric(aggregate, "survival")),
    buildMetricSegment("Avg DPS", formatRoundedNumber(aggregate.avgDps), getCommonWinsInlineMetric(aggregate, "avgDps")),
    buildMetricSegment("Avg TTK", formatBestBuildSeconds(aggregate.avgTtkWin), getCommonWinsInlineMetric(aggregate, "avgTtk")),
    buildMetricSegment("Effective", formatRoundedNumber(aggregate.avgImmortalDamage), getCommonWinsInlineMetric(aggregate, "immortalDamage")),
  ];
  return segments.join(" | ");
}

function buildMetricSegment(label: string, rawValue: string, commonValue: string | null): string {
  if (!commonValue) return `${label} ${rawValue}`;
  return `${label} ${rawValue} (${commonValue})`;
}

function getCommonWinsInlineMetric(
  aggregate: BestBuildAggregate,
  kind: "avgTtk" | "avgDps" | "immortalDamage" | "survival",
): string | null {
  if (!aggregate.commonWinsCount) return null;
  if (kind === "avgTtk" && aggregate.commonWinsAvgTtkWin != null) {
    return `common ${formatBestBuildSeconds(aggregate.commonWinsAvgTtkWin)} / ${aggregate.commonWinsCount}`;
  }
  if (kind === "avgDps" && aggregate.commonWinsAvgDps != null) {
    return `common ${formatRoundedNumber(aggregate.commonWinsAvgDps)} / ${aggregate.commonWinsCount}`;
  }
  if (kind === "immortalDamage" && aggregate.commonWinsAvgImmortalDamage != null) {
    return `common ${formatRoundedNumber(aggregate.commonWinsAvgImmortalDamage)} / ${aggregate.commonWinsCount}`;
  }
  if (kind === "survival" && aggregate.commonWinsAvgSurvival != null) {
    return `common ${formatRoundedSeconds(aggregate.commonWinsAvgSurvival)} / ${aggregate.commonWinsCount}`;
  }
  return null;
}

function formatBestBuildWinRatePercent(value: number): string {
  if (!Number.isFinite(value)) return "0%";
  const rounded = Math.round(value * 10) / 10;
  return `${rounded.toFixed(1)}%`;
}

function formatBestBuildSeconds(value: number): string {
  if (!Number.isFinite(value)) return "0s";
  const rounded = Math.round(value * 100) / 100;
  return `${rounded.toFixed(2)}s`;
}
