import type { BuildOptions, SimulationSummary } from "../../engine";
import { formatRoundedNumber, formatRoundedPercent, formatRoundedSeconds } from "../../shared/displayFormat";
import { computeAscensionCounts } from "../../shared/buildEncoding";
import type { AbilityCoverageSummary } from "./types";
import { DebugPanel } from "./DebugPanel";
import {
  DEFAULT_COMPARE_DPS_SETTINGS,
  getViewMetrics,
  type CompareDpsSettings,
  type CompareResultViewMode,
} from "./compareResultView";
import { describeDpsSettings } from "./BattleSettingsPanel";
import { resolveCompareDisplayNames } from "./compareDisplayNames";

const DISCLAIMER_EXCLUDED_ABILITIES = new Set([
  "Broodwatcher",
  "Defiled Ground",
  "First Tick Rule",
  "Frosty",
  "Gore Charge",
  "Gourmandizer",
  "Lich Mark",
  "Mud Pile",
  "Pack Healer",
  "Power Charge",
  "Reflux",
  "Special Air PvP Rule",
  "Spite ready at start",
  "Use hunger rules",
  "Volcanic",
]);

export function SummaryCard({
  summary,
  nameA,
  nameB,
  buildA,
  buildB,
  abilityCoverage,
  debugMode,
  needsCalc,
  resultViewMode,
  onResultViewModeChange,
  dpsSettings = DEFAULT_COMPARE_DPS_SETTINGS,
}: {
  summary: SimulationSummary | null;
  nameA: string;
  nameB: string;
  buildA: BuildOptions;
  buildB: BuildOptions;
  abilityCoverage: AbilityCoverageSummary;
  debugMode: boolean;
  needsCalc: boolean;
  resultViewMode: CompareResultViewMode;
  onResultViewModeChange: (value: CompareResultViewMode) => void;
  dpsSettings?: CompareDpsSettings;
}) {
  const getDisclaimerAbilities = (current: SimulationSummary): string[] => {
    const names = [
      ...(current.debug?.A.abilitiesNotModeled ?? []),
      ...(current.debug?.B.abilitiesNotModeled ?? []),
    ];
    return Array.from(
      new Set(names.filter((name) => !DISCLAIMER_EXCLUDED_ABILITIES.has(name))),
    ).sort((left, right) => left.localeCompare(right));
  };

  const formatTtk = (ttk: number, deathTime: number | null, maxTime: number) => {
    if (deathTime == null) return `inf (no kill within ${formatRoundedSeconds(maxTime)})`;
    return formatRoundedSeconds(ttk);
  };

  const renderWinnerHp = (current: SimulationSummary) => {
    if (current.winner === "A") {
      const pct = current.maxHpA > 0 ? (current.hpAAtBDeath / current.maxHpA) * 100 : 0;
      return `${formatRoundedNumber(current.hpAAtBDeath)} / ${formatRoundedNumber(current.maxHpA)} (${formatRoundedPercent(pct)})`;
    }
    if (current.winner === "B") {
      const pct = current.maxHpB > 0 ? (current.hpBAtADeath / current.maxHpB) * 100 : 0;
      return `${formatRoundedNumber(current.hpBAtADeath)} / ${formatRoundedNumber(current.maxHpB)} (${formatRoundedPercent(pct)})`;
    }
    return "N/A";
  };

  const renderOutcomeWinnerHp = (current: SimulationSummary, mode: CompareResultViewMode) => {
    if (mode === "fullFight") return renderWinnerHp(current);
    return renderWinnerHp(current);
  };

  const formatBuildShort = (build: BuildOptions) => {
    const asc = computeAscensionCounts(build.traits, build.ascensionAssignments, build.venerationStage);
    const plushPart = build.plushies.length > 0 ? build.plushies.join("/") : "none";
    const ascPart = build.traits.length > 0 ? build.traits.map((trait, i) => `${trait}${asc[i] ?? 0}`).join("/") : "none";
    return {
      elder: build.elder ?? "None",
      plushies: plushPart,
      ascension: ascPart,
    };
  };

  const dpsLabel = dpsSettings.denominator === "perBite" ? "Dmg/bite" : "DPS";

  const copySummary = async (current: SimulationSummary, mode: CompareResultViewMode) => {
    const metrics = getViewMetrics(current, mode, dpsSettings);
    const loserDeath =
      current.winner === "A" ? current.deathTimeB : current.winner === "B" ? current.deathTimeA : null;
    const buildShortA = formatBuildShort(buildA);
    const buildShortB = formatBuildShort(buildB);
    const { displayA, displayB } = resolveCompareDisplayNames(nameA, nameB);
    const lines = [
      `${displayA} vs ${displayB}`,
      `View: ${mode === "firstDeath" ? "First death" : "Full fight"}`,
      `Winner: ${current.winner}`,
      `Winner HP: ${renderOutcomeWinnerHp(current, mode)}`,
      `Loser Death: ${loserDeath != null ? formatRoundedSeconds(loserDeath) : "N/A"}`,
      `A ${formatRoundedNumber(metrics.dpsAtoB)} ${dpsLabel} | ${formatTtk(current.ttkAtoB, current.deathTimeB, current.maxTimeSec)} TTK`,
      `B ${formatRoundedNumber(metrics.dpsBtoA)} ${dpsLabel} | ${formatTtk(current.ttkBtoA, current.deathTimeA, current.maxTimeSec)} TTK`,
      `A ${buildShortA.elder} | ${buildShortA.plushies} | ${buildShortA.ascension}`,
      `B ${buildShortB.elder} | ${buildShortB.plushies} | ${buildShortB.ascension}`,
      "Provided by Sonaria Stat Lab",
    ];
    await navigator.clipboard.writeText(lines.join("\n"));
  };

  return (
    <div className="panel-block">
      <h3>Outcome</h3>
      {!summary && <div className="muted">{needsCalc ? "Press Calculate to run the fight." : "Select both creatures."}</div>}
      {summary && (
        <>
          {(() => {
            const disclaimerAbilities = getDisclaimerAbilities(summary);
            if (disclaimerAbilities.length === 0) return null;
            const shown = disclaimerAbilities.slice(0, 4).join(", ");
            const remaining = disclaimerAbilities.length - 4;
            return (
              <div className="note">
                Some abilities in this matchup are still outside the default stand-and-fight model: {shown}
                {remaining > 0 ? `, and ${remaining} more.` : "."}
              </div>
            );
          })()}
          {(() => {
            const metrics = getViewMetrics(summary, resultViewMode, dpsSettings);
            const loserDeath =
              summary.winner === "A" ? summary.deathTimeB : summary.winner === "B" ? summary.deathTimeA : null;
            return (
              <>
                <div className="compare-outcome-mode-switch" role="tablist" aria-label="Compare result view mode">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={resultViewMode === "firstDeath"}
                    className={`compare-outcome-mode-button${resultViewMode === "firstDeath" ? " is-active" : ""}`}
                    onClick={() => onResultViewModeChange("firstDeath")}
                  >
                    First death
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={resultViewMode === "fullFight"}
                    className={`compare-outcome-mode-button${resultViewMode === "fullFight" ? " is-active" : ""}`}
                    onClick={() => onResultViewModeChange("fullFight")}
                  >
                    Full fight
                  </button>
                </div>
                <ul className="stat-list">
                <li>{dpsLabel} A-&gt;B: {formatRoundedNumber(metrics.dpsAtoB)}</li>
                <li>{dpsLabel} B-&gt;A: {formatRoundedNumber(metrics.dpsBtoA)}</li>
                <li>EHP A: {formatRoundedNumber(summary.ehpA)}</li>
                <li>EHP B: {formatRoundedNumber(summary.ehpB)}</li>
                <li>TTK A-&gt;B: {formatTtk(summary.ttkAtoB, summary.deathTimeB, summary.maxTimeSec)}</li>
                <li>TTK B-&gt;A: {formatTtk(summary.ttkBtoA, summary.deathTimeA, summary.maxTimeSec)}</li>
                <li>Winner: {summary.winner}</li>
                <li>Winner Remaining HP: {renderOutcomeWinnerHp(summary, resultViewMode)}</li>
                <li>Loser Death Time: {loserDeath != null ? formatRoundedSeconds(loserDeath) : "N/A"}</li>
                <li>Max sim time: {formatRoundedSeconds(summary.maxTimeSec)}</li>
                <li>Damage Dealt A: {formatRoundedNumber(metrics.damageDealtA)}</li>
                <li>Damage Dealt B: {formatRoundedNumber(metrics.damageDealtB)}</li>
                </ul>
                <div className="note">{dpsLabel}: {describeDpsSettings(dpsSettings)}</div>
              </>
            );
          })()}
          <div className="row-actions">
            <button className="secondary" type="button" onClick={() => void copySummary(summary, resultViewMode)}>
              Copy summary
            </button>
          </div>
          {summary.debug && debugMode ? <DebugPanel debug={summary.debug} abilityCoverage={abilityCoverage} summary={summary} /> : null}
        </>
      )}
    </div>
  );
}
