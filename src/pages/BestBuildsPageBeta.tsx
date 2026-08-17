// Beta "Best build finder" view of Best Builds. Dev-gated (iddqd + Settings
// beta toggle), routed in place of the default BestBuildsPage when the beta
// design is active. Shares useBestBuildsPageController, so the search is
// identical - only the presentation differs.
//
// Design: Best Builds answers "what single build is best for creature X across
// a whole meta pool?" The OUTPUT is a BUILD, so - like the beta Optimizer - the
// build is the hero (BuildCard: loadout chips + a metric readout whose LEAD
// stat follows the objective). What's bespoke to Best Builds:
//   - the headline is a POOL win-rate (coverage across N opponents), not a
//     single 1-v-1 verdict;
//   - each card expands to a per-opponent matchup grid (weak matchups first);
//   - the heavy config is a tabbed Setup overlay whose middle tab is a real
//     POOL BUILDER (meta-size + tier scope, or a custom list with live preview).
// The frequently-iterated levers (creature, pool summary, objective, Run) live
// on an always-visible control bar - the same "hybrid" split as the Optimizer.

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Settings2, Users, X } from "lucide-react";
import type { BuildOptions, TwoFacedMode } from "../engine";
import type { CombatEventPhase } from "../engine/eventOrdering";
import { creatureByName, getCreatureIcon } from "../engine/creatureData";
import { creatureHasAbility } from "../components/compare/compareSpecialAbilities";
import { IconImg } from "../components/IconImg";
import { CreatureNameInput } from "../components/CreatureNameInput";
import { BestBuildsConstraintControls } from "../components/bestBuilds/BestBuildsConstraintControls";
import { BestBuildsBattleSettingsPanel } from "../components/bestBuilds/BestBuildsBattleSettings";
import { BuildLoadout } from "../components/beta/BuildLoadout";
import { ApplyToCompare } from "../components/beta/ApplyToCompare";
import { useBestBuildsPageController } from "./useBestBuildsPageController";
import { useBestBuildsBattleSettings } from "../components/bestBuilds/BestBuildsBattleSettingsContext";
import type { BestBuildsBattleSettings } from "../components/bestBuilds/bestBuildsBattleSettingsTypes";
import type { DefaultPoolScope } from "../optimizer/poolUtils";
import type { BestBuildAggregate, BestBuildAggregateObjective } from "../optimizer/ranking";
import type { BestBuildAggregateResult } from "../optimizer/bestBuildsFlow";
import type { BestBuildPerOpponentRow } from "../optimizer/bestBuildsPageFlow";
import { buildResultKey } from "../shared/buildEncoding";
import { formatRoundedNumber, formatRoundedPercent, formatRoundedSeconds } from "../shared/displayFormat";
import { registerMatchSnapshotProvider } from "../shared/matchSnapshot";
import "./compareBeta.css";
import "./optimizerBeta.css";
import "./bestBuildsBeta.css";

export type BestBuildsPageBetaProps = {
  nameA: string;
  creatures: Array<{ name: string; stats: { tier: number } }>;
  creatureNames: string[];
  trueDeveloperMode: boolean;
  combatEventOrder: CombatEventPhase[];
  onNameAChange: (value: string) => void;
  onApplyBuildA: (value: BuildOptions) => void;
  onNameBChange: (value: string) => void;
  onApplyBuildB: (value: BuildOptions) => void;
};

type BestBuildsSnapshotState = {
  nameA: string;
  searchDepth: "soft" | "detailed";
  objective: BestBuildAggregateObjective;
  winRateGuardPct: number;
  poolMode: string;
  poolScope: DefaultPoolScope;
  selectedPoolTiers: number[];
  customPoolText: string;
  targetConstraints: BuildOptions;
  excludedTraits: string[];
  excludedPlushies: string[];
  targetTraitLock: boolean;
  targetAscensionLock: boolean;
  targetPlushieLock: boolean;
  targetElderLock: boolean;
  showAllAscensionDistributions: boolean;
  twoFacedMode: TwoFacedMode;
  battleSettings: BestBuildsBattleSettings;
};

// Objective -> which metric is the headline + its segmented label. Mirrors the
// default page's objective enum (winRate / survival / avgDps / avgTtk /
// immortalDamage), keeping the search byte-identical.
const OBJECTIVE_META: Record<BestBuildAggregateObjective, { seg: string; leadKey: MetricKey }> = {
  winRate: { seg: "Win rate", leadKey: "win" },
  survival: { seg: "Survival", leadKey: "surv" },
  avgDps: { seg: "DPS", leadKey: "dps" },
  avgTtk: { seg: "TTK", leadKey: "ttk" },
  immortalDamage: { seg: "Effective", leadKey: "eff" },
};
// "immortalDamage" (Effective) is intentionally omitted as a selectable
// objective here - it cluttered the OPTIMIZE FOR row (5th option wrapping on
// phones). Effective is still shown as a metric on each card.
const OBJECTIVE_ORDER: BestBuildAggregateObjective[] = ["winRate", "survival", "avgDps", "avgTtk"];

const META_SIZES = [40, 60, 80, 120, 160, 200, 240, 280, 320] as const;
const SCOPE_OPTIONS: Array<{ id: DefaultPoolScope; label: string; short: string }> = [
  { id: "sameOrHigher", label: "Tier & above", short: "tier & up" },
  { id: "sameOrLower", label: "Tier & below", short: "tier & down" },
  { id: "withinOneTier", label: "Within 1 tier", short: "±1 tier" },
  { id: "exactTiers", label: "Exact tiers", short: "exact tiers" },
];

type MetricKey = "win" | "surv" | "dps" | "ttk" | "eff";
type Metric = { key: MetricKey; label: string; value: string };

// "avg" = averaged over ALL opponents (losses included, so the values are
// noisy). "common" = averaged only over the opponents that EVERY displayed
// build beats (the win intersection) - an apples-to-apples comparison, and the
// basis the ranking's tie-breaks already use. Win rate is always pool-level
// (there's no "common win rate"). Common metrics exist only after the
// common-wins rerank populated them (commonWinsCount > 0).
type MetricBasis = "avg" | "common";

function anyCommonWins(results: BestBuildAggregateResult[]): boolean {
  return results.some((r) => (r.aggregate.commonWinsCount ?? 0) > 0);
}

function metricsOf(agg: BestBuildAggregate, basis: MetricBasis): Metric[] {
  const common = basis === "common";
  const surv = common && agg.commonWinsAvgSurvival != null ? agg.commonWinsAvgSurvival : agg.avgSurvival;
  const dps = common && agg.commonWinsAvgDps != null ? agg.commonWinsAvgDps : agg.avgDps;
  const ttk = common && agg.commonWinsAvgTtkWin != null ? agg.commonWinsAvgTtkWin : agg.avgTtkWin;
  const eff = common && agg.commonWinsAvgImmortalDamage != null ? agg.commonWinsAvgImmortalDamage : agg.avgImmortalDamage;
  return [
    { key: "win", label: "Win rate", value: formatRoundedPercent(agg.winRate * 100) },
    { key: "surv", label: "Survival", value: formatRoundedSeconds(surv) },
    { key: "dps", label: "DPS", value: formatRoundedNumber(dps) },
    { key: "ttk", label: "TTK", value: formatRoundedSeconds(ttk) },
    { key: "eff", label: "Effective", value: formatRoundedNumber(eff) },
  ];
}

// Winner pill ordering for the per-opponent grid: surface LOSSES first so the
// user sees where the build struggles (the actionable matchups).
const WINNER_RANK: Record<BestBuildPerOpponentRow["winner"], number> = { B: 0, Draw: 1, A: 2 };

type PerOpponentSortKey = "opponent" | "result" | "ttk" | "dps" | "eff" | "surv";
// Initial direction when a column is first clicked: losses-first for Result,
// ascending TTK (faster kill = better), descending for the "more is better"
// rate columns. Clicking the active column toggles direction.
const PER_OPPONENT_DEFAULT_DIR: Record<PerOpponentSortKey, "asc" | "desc"> = {
  opponent: "asc", result: "asc", ttk: "asc", dps: "desc", eff: "desc", surv: "desc",
};
const PER_OPPONENT_COLUMNS: ReadonlyArray<readonly [PerOpponentSortKey, string]> = [
  ["opponent", "Opponent"], ["result", "Result"], ["ttk", "TTK"], ["dps", "DPS"], ["eff", "Eff"], ["surv", "Surv"],
];

function BuildCard({
  rank,
  item,
  sourceName,
  icon,
  objective,
  basis,
  hero,
  expanded,
  loading,
  rows,
  onApplyA,
  onApplyB,
  onCopy,
  onToggleOpponents,
}: {
  rank: number;
  item: BestBuildAggregateResult;
  sourceName: string;
  icon: string | null;
  objective: BestBuildAggregateObjective;
  basis: MetricBasis;
  hero: boolean;
  expanded: boolean;
  loading: boolean;
  rows: BestBuildPerOpponentRow[] | null;
  onApplyA: (build: BuildOptions) => void;
  onApplyB: (build: BuildOptions) => void;
  onCopy: () => void;
  onToggleOpponents: () => void;
}) {
  const agg = item.aggregate;
  const wr = agg.winRate * 100;
  const wrTone = wr >= 60 ? "good" : wr >= 35 ? "flat" : "bad";
  const leadIsWin = objective === "winRate";
  const leadKey = OBJECTIVE_META[objective].leadKey;
  const metrics = metricsOf(agg, basis);
  const lead = metrics.find((m) => m.key === leadKey)!;
  const rest = metrics.filter((m) => m.key !== leadKey);
  // Sort state for the per-opponent table - columns are clickable to re-sort.
  // Default: losses first (Result asc), the actionable matchups.
  const [sort, setSort] = useState<{ key: PerOpponentSortKey; dir: "asc" | "desc" }>({ key: "result", dir: "asc" });
  const sortValue = (r: BestBuildPerOpponentRow): number | string => {
    switch (sort.key) {
      case "opponent": return r.name.toLowerCase();
      case "result": return WINNER_RANK[r.winner];
      case "ttk": return r.ttk;
      case "dps": return r.dps;
      case "eff": return r.effective;
      case "surv": return r.survival;
    }
  };
  const toggleSort = (key: PerOpponentSortKey) =>
    setSort((s) => ({ key, dir: s.key === key ? (s.dir === "asc" ? "desc" : "asc") : PER_OPPONENT_DEFAULT_DIR[key] }));
  const sortedRows = rows
    ? [...rows].sort((a, b) => {
        const va = sortValue(a);
        const vb = sortValue(b);
        let cmp = typeof va === "string" ? va.localeCompare(vb as string) : (va as number) - (vb as number);
        if (cmp === 0) cmp = a.name.localeCompare(b.name);
        return sort.dir === "asc" ? cmp : -cmp;
      })
    : null;
  return (
    <div className={`ob-card${hero ? " ob-card--hero" : ""}`}>
      <div className="ob-card__head">
        <span className="ob-card__rank">#{rank}</span>
        <IconImg src={icon} alt={sourceName} size={hero ? 44 : 32} />
        <div className="ob-card__id">
          <div className="ob-card__name">{sourceName || "—"}</div>
          <div className="ob-card__sub">best build · {item.opponentsCount} opponents</div>
        </div>
        {/* Coverage badge: pool win-rate, color-graded. Suppressed when win
            rate is already the lead metric (avoids showing the same % twice). */}
        {!leadIsWin ? (
          <span className={`ob-verdict ob-verdict--${wrTone}`} title="Win rate across the pool">
            {formatRoundedPercent(wr)} win
          </span>
        ) : null}
      </div>

      <div className="ob-card__metrics">
        <div className={`ob-metric ob-metric--lead${leadIsWin ? ` bbb-lead-${wrTone}` : ""}`}>
          <span>{lead.label}</span>
          <b>{lead.value}</b>
          <small>{leadIsWin ? "across pool" : "objective"}</small>
        </div>
        <div className="ob-metric-grid">
          {rest.map((m) => (
            <div className="ob-metric" key={m.key}>
              <span>{m.label}</span>
              <b>{m.value}</b>
            </div>
          ))}
        </div>
      </div>

      <div className="ob-card__build">
        <BuildLoadout build={item.build} activesOn={item.activesOn} breathOn={item.breathOn} />
      </div>

      <div className="ob-card__actions">
        <ApplyToCompare onApplyA={() => onApplyA(item.build)} onApplyB={() => onApplyB(item.build)} />
        <button type="button" className="cb-ghostbtn" onClick={onCopy}>Copy summary</button>
        <button
          type="button"
          className={`cb-ghostbtn bbb-opp-toggle${expanded ? " is-open" : ""}`}
          onClick={onToggleOpponents}
          aria-expanded={expanded}
        >
          {expanded ? "Hide matchups" : `Per-opponent (${item.opponentsCount})`}
        </button>
      </div>

      {expanded ? (
        <div className="bbb-matchups">
          {loading ? (
            <div className="bbb-matchups__loading">Simulating each matchup…</div>
          ) : sortedRows && sortedRows.length ? (
            <>
              <div className="bbb-matchups__head">
                <span>Per-opponent · {sortedRows.length}</span>
                <span className="bbb-matchups__hint">Weakest matchups first</span>
              </div>
              {/* Fixed-column grid table: headers once, numeric columns
                  right-aligned + tabular-nums so values line up across rows. */}
              <div className="bbb-mtable" role="table" aria-label="Per-opponent results">
                <div className="bbb-mtable__head" role="row">
                  {PER_OPPONENT_COLUMNS.map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      role="columnheader"
                      className={`bbb-mtable__th${sort.key === key ? ` is-sorted is-${sort.dir}` : ""}`}
                      aria-sort={sort.key === key ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
                      onClick={() => toggleSort(key)}
                      title={`Sort by ${label}`}
                    >
                      {label}
                      <span className="bbb-sort-arrow" aria-hidden="true">{sort.key === key ? (sort.dir === "asc" ? "▲" : "▼") : ""}</span>
                    </button>
                  ))}
                </div>
                {sortedRows.map((row) => {
                  const tone = row.winner === "A" ? "good" : row.winner === "B" ? "bad" : "flat";
                  const label = row.winner === "A" ? "Win" : row.winner === "B" ? "Loss" : "Draw";
                  return (
                    <div className="bbb-mtable__row" role="row" key={row.name}>
                      <span className="bbb-mtable__opp" role="cell">
                        <IconImg src={getCreatureIcon(row.name)} alt="" size={22} />
                        <span className="bbb-mtable__name">{row.name}</span>
                        <span className="bbb-mtable__tier">T{row.tier}</span>
                      </span>
                      <span className="bbb-mtable__result" role="cell">
                        <span className={`bbb-winner bbb-winner--${tone}`}>{label}</span>
                      </span>
                      <span className="bbb-mtable__num" role="cell" data-label="TTK">{formatRoundedSeconds(row.ttk)}</span>
                      <span className="bbb-mtable__num" role="cell" data-label="DPS">{formatRoundedNumber(row.dps)}</span>
                      <span className="bbb-mtable__num" role="cell" data-label="Eff">{formatRoundedNumber(row.effective)}</span>
                      <span className="bbb-mtable__num" role="cell" data-label="Surv">{formatRoundedSeconds(row.survival)}</span>
                    </div>
                  );
                })}
              </div>
            </>
          ) : (
            <div className="bbb-matchups__loading">No per-opponent rows.</div>
          )}
        </div>
      ) : null}
    </div>
  );
}

export default function BestBuildsPageBeta({
  nameA,
  creatures,
  creatureNames,
  trueDeveloperMode,
  combatEventOrder,
  onNameAChange,
  onApplyBuildA,
  onNameBChange,
  onApplyBuildB,
}: BestBuildsPageBetaProps) {
  // Best Builds finds builds for the SOURCE creature (nameA). "Apply to Compare
  // A" drops the build on side A (A is already nameA). "Apply to Compare B" also
  // moves the source creature onto side B so the build lands on it.
  const applyToCompareA = (build: BuildOptions) => { onApplyBuildA(build); };
  const applyToCompareB = (build: BuildOptions) => { onNameBChange(nameA); onApplyBuildB(build); };
  const tierOptions = useMemo(
    () => Array.from(new Set(creatures.map((c) => c.stats.tier))).sort((a, b) => a - b),
    [creatures],
  );
  const c = useBestBuildsPageController({
    nameA,
    availableCreatures: creatures,
    combatEventOrder,
    developerMode: trueDeveloperMode,
  });
  const { settings: bbBattleSettings, setSettings: setBbBattleSettings } = useBestBuildsBattleSettings();
  const [setupOpen, setSetupOpen] = useState(false);
  const [setupTab, setSetupTab] = useState<"build" | "pool" | "battle">("pool");
  // Metric basis for the result cards. Default to "common" so the numbers match
  // the common-based ranking; falls back to "avg" automatically when no common
  // set exists (commonWinsCount 0 / Rust bridge absent).
  const [metricBasis, setMetricBasis] = useState<MetricBasis>("common");

  const sourceCreature = creatureByName[nameA];
  const showTwoFaced = creatureHasAbility(sourceCreature, "Two-Faced");
  const isCustom = c.poolMode === "custom";
  const metaSize = Number((c.poolMode.match(/^meta(\d+)$/) ?? [])[1] ?? 80);
  const scopeShort = SCOPE_OPTIONS.find((s) => s.id === c.poolScope)?.short ?? "";
  const poolSummary = isCustom
    ? `Custom · ${c.activePool.length}`
    : `Meta-${metaSize} · ${c.poolScope === "exactTiers" && c.selectedPoolTiers.length ? c.selectedPoolTiers.map((t) => `T${t}`).join("/") : scopeShort} · ${c.activePool.length}`;
  const poolLabelShort = isCustom ? `custom pool` : `Meta-${metaSize}`;
  const canRun = Boolean(c.creature) && c.activePool.length > 0;
  // Common-wins metric basis: available only when the rerank found a shared-win
  // set. N (the shared-win count) is uniform across displayed builds.
  const commonAvailable = anyCommonWins(c.results);
  const commonWinsN = c.results[0]?.aggregate.commonWinsCount ?? 0;
  const effectiveBasis: MetricBasis = commonAvailable ? metricBasis : "avg";

  // Share-Match snapshot provider (parity with the default BestBuildsPage - same
  // shape, so share links interoperate between default and beta).
  const shareSnapshotRef = useRef<BestBuildsSnapshotState | null>(null);
  shareSnapshotRef.current = {
    nameA,
    searchDepth: c.searchDepth,
    objective: c.objective,
    winRateGuardPct: c.winRateGuardPct,
    poolMode: c.poolMode,
    poolScope: c.poolScope,
    selectedPoolTiers: c.selectedPoolTiers,
    customPoolText: c.customPoolText,
    targetConstraints: c.targetConstraints,
    excludedTraits: c.excludedTraits,
    excludedPlushies: c.excludedPlushies,
    targetTraitLock: c.targetTraitLock,
    targetAscensionLock: c.targetAscensionLock,
    targetPlushieLock: c.targetPlushieLock,
    targetElderLock: c.targetElderLock,
    showAllAscensionDistributions: c.showAllAscensionDistributions,
    twoFacedMode: c.twoFacedMode,
    battleSettings: bbBattleSettings,
  };
  const activePoolRef = useRef<string[]>([]);
  activePoolRef.current = c.activePool;
  useEffect(() => {
    return registerMatchSnapshotProvider({
      page: "bestBuilds",
      getSnapshot: () => {
        const s = shareSnapshotRef.current!;
        return {
          pageState: { ...s } as unknown as Record<string, unknown>,
          participantCreatureNames: [s.nameA, ...activePoolRef.current].filter((n): n is string => Boolean(n)),
        };
      },
      applySnapshot: (pageState) => {
        const s = pageState as Partial<BestBuildsSnapshotState>;
        if (typeof s.nameA === "string") onNameAChange(s.nameA);
        if (s.searchDepth !== undefined) c.setSearchDepth(s.searchDepth);
        if (s.objective !== undefined) c.setObjective(s.objective);
        if (s.winRateGuardPct !== undefined) c.setWinRateGuardPct(s.winRateGuardPct);
        if (s.poolMode !== undefined) c.setPoolMode(s.poolMode as Parameters<typeof c.setPoolMode>[0]);
        if (s.poolScope !== undefined) c.setPoolScope(s.poolScope);
        if (s.selectedPoolTiers !== undefined) c.setSelectedPoolTiers(s.selectedPoolTiers);
        if (s.customPoolText !== undefined) c.setCustomPoolText(s.customPoolText);
        if (s.targetConstraints) c.setTargetConstraints(s.targetConstraints);
        if (s.excludedTraits !== undefined) c.setExcludedTraits(s.excludedTraits);
        if (s.excludedPlushies !== undefined) c.setExcludedPlushies(s.excludedPlushies);
        if (s.targetTraitLock !== undefined) c.setTargetTraitLock(s.targetTraitLock);
        if (s.targetAscensionLock !== undefined) c.setTargetAscensionLock(s.targetAscensionLock);
        if (s.targetPlushieLock !== undefined) c.setTargetPlushieLock(s.targetPlushieLock);
        if (s.targetElderLock !== undefined) c.setTargetElderLock(s.targetElderLock);
        if (s.showAllAscensionDistributions !== undefined) c.setShowAllAscensionDistributions(s.showAllAscensionDistributions);
        if (s.twoFacedMode !== undefined) c.setTwoFacedMode(s.twoFacedMode);
        if (s.battleSettings) setBbBattleSettings(s.battleSettings);
      },
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps -- setters are stable through the controller hook
  }, [onNameAChange]);

  // Dev API parity with the default page (E2E automation hooks).
  useEffect(() => {
    if (!trueDeveloperMode || typeof window === "undefined") return;
    const devApi = {
      setCreature: onNameAChange,
      setSearchDepth: c.setSearchDepth,
      setPoolMode: c.setPoolMode,
      setPoolScope: c.setPoolScope,
      setSelectedPoolTiers: c.setSelectedPoolTiers,
      setObjective: c.setObjective,
      runBestBuilds: async () => await c.runBestBuilds(),
      getResultsState: () => ({
        count: c.results.length,
        topResults: c.results.slice(0, 3).map((item, index) => ({
          index,
          build: item.build,
          activesOn: item.activesOn,
          breathOn: item.breathOn,
        })),
      }),
      getRunState: () => ({ isRunning: c.isRunning, runtimePathTelemetry: c.lastRunRuntimePathTelemetry }),
      getConfigState: () => ({
        creatureName: nameA,
        activePoolLength: c.activePool.length,
        poolScope: c.poolScope,
        selectedPoolTiers: c.selectedPoolTiers,
      }),
    };
    Reflect.set(window, "__bestBuildsDevApi", devApi);
    return () => {
      if (Reflect.get(window, "__bestBuildsDevApi") === devApi) {
        Reflect.deleteProperty(window, "__bestBuildsDevApi");
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- setters stable; re-run on the values the getters close over
  }, [trueDeveloperMode, onNameAChange, nameA, c.results, c.isRunning, c.lastRunRuntimePathTelemetry, c.activePool.length, c.poolScope, c.selectedPoolTiers]);

  const togglePoolTier = (tier: number) => {
    c.setSelectedPoolTiers(
      c.selectedPoolTiers.includes(tier)
        ? c.selectedPoolTiers.filter((v) => v !== tier)
        : [...c.selectedPoolTiers, tier].sort((a, b) => a - b),
    );
  };

  const openSetup = (tab: "build" | "pool" | "battle") => {
    setSetupTab(tab);
    setSetupOpen(true);
  };

  return (
    <section className="ob bbb">
      {/* Control bar: source creature + pool summary chip, the objective lever,
          and Configure + Calculate. */}
      <div className="ob-bar">
        <div className="bbb-source">
          {/* Creature + name opens Setup on the Build tab; the pool chip opens
              the Pool tab - both quick edit shortcuts. */}
          <button type="button" className="bbb-source__btn" onClick={() => openSetup("build")} title="Edit creature & build">
            <IconImg src={getCreatureIcon(nameA)} alt={nameA} size={30} />
            <span className="bbb-source__id">
              <em>best build for</em>
              <b>{nameA || "—"}</b>
            </span>
          </button>
          <button type="button" className="bbb-pool-chip" onClick={() => openSetup("pool")} title="Edit the opponent pool">
            <Users size={13} strokeWidth={2} aria-hidden="true" />
            {poolSummary}
          </button>
        </div>

        <div className="ob-bar__obj">
          <span className="ob-bar__obj-label">Optimize for</span>
          <div className="cb-seg" role="tablist" aria-label="Optimization objective">
            {OBJECTIVE_ORDER.map((g) => (
              <button
                key={g}
                type="button"
                role="tab"
                aria-selected={c.objective === g}
                className={`cb-seg__opt${c.objective === g ? " is-active" : ""}`}
                onClick={() => c.setObjective(g)}
              >
                {OBJECTIVE_META[g].seg}
              </button>
            ))}
          </div>
        </div>

        {/* Zero-shift run controls: the % lives INSIDE the run button as a
            fill + label (the button has a FIXED width, so a ticking percentage
            never resizes it). Cancel only renders while running and sits to the
            LEFT of the fixed Configure + run cluster - since the cluster is
            right-pinned, Cancel appears in the flexible gap and the two buttons
            don't move (and there's no reserved void when idle). */}
        <div className="ob-bar__actions">
          {c.isRunning ? <button className="secondary ob-cancel" type="button" onClick={c.cancelRun}>Cancel</button> : null}
          <button className="cb-ghostbtn" type="button" onClick={() => openSetup("build")}>
            <Settings2 size={15} strokeWidth={2} aria-hidden="true" /> Configure
          </button>
          {c.isRunning ? (
            <button className="ob-run ob-run--progress" type="button" disabled aria-label={`Running, ${formatRoundedPercent(c.progress * 100)} complete`}>
              <span className="ob-run__fill" style={{ width: `${Math.min(100, Math.round(c.progress * 100))}%` }} />
              <span className="ob-run__text">Running… {formatRoundedPercent(c.progress * 100)}</span>
            </button>
          ) : (
            <button className="primary ob-run" type="button" onClick={() => void c.runBestBuilds()} disabled={!canRun}>Calculate</button>
          )}
        </div>
      </div>

      {c.runtimeRequirementError ? <div className="ob-error">{c.runtimeRequirementError}</div> : null}

      {c.results.length === 0 ? (
        <div className="cb-empty">
          {c.isRunning
            ? "Searching builds…"
            : `Press “Calculate” to find ${nameA || "the creature"}'s best build across the ${poolLabelShort} pool.`}
        </div>
      ) : (
        <div className="ob-results">
          <div className="ob-results__head">
            <span className="ob-results__title">Best builds — {nameA || "creature"}</span>
            {commonAvailable ? (
              <div className="bbb-basis">
                <span className="bbb-basis__cap">Metrics</span>
                <div className="cb-seg bbb-basis__seg" role="tablist" aria-label="Metric basis">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={metricBasis === "common"}
                    className={`cb-seg__opt${metricBasis === "common" ? " is-active" : ""}`}
                    onClick={() => setMetricBasis("common")}
                    title={`Common — DPS / TTK / Effective / Survival averaged ONLY over the ${commonWinsN} opponent${commonWinsN === 1 ? "" : "s"} that every build below beats. A fair head-to-head, and the basis the ranking uses.`}
                  >
                    Common · {commonWinsN}
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={metricBasis === "avg"}
                    className={`cb-seg__opt${metricBasis === "avg" ? " is-active" : ""}`}
                    onClick={() => setMetricBasis("avg")}
                    title="Average — across all opponents in the pool, including losses (where the metric is noisy)."
                  >
                    Avg
                  </button>
                </div>
              </div>
            ) : null}
            {/* Hint is forced onto its own full-width row (flex-basis 100%) so
                its length - which changes with the basis - never reflows the
                title/toggle row above it. */}
            <span className="ob-results__hint bbb-results-hint">
              Ranked by {OBJECTIVE_META[c.objective].seg.toLowerCase()} across {c.results[0]?.opponentsCount ?? c.activePool.length} opponents.
              {c.lastRunMs != null && !c.isRunning ? ` Computed in ${formatRoundedSeconds(c.lastRunMs / 1000)}.` : ""}{" "}
              {commonAvailable && effectiveBasis === "common"
                ? `Metrics: common — averaged over the ${commonWinsN} opponent${commonWinsN === 1 ? "" : "s"} every build below beats.`
                : "Metrics: average across all opponents."}
            </span>
          </div>

          {trueDeveloperMode && c.topResultDiagnostic ? (
            <div className="note bbb-dev-note">
              Top-1: {c.topResultDiagnostic.buildLabel} · worker TTK {formatRoundedSeconds(c.topResultDiagnostic.workerAggregate.avgTtkWin)} / Eff{" "}
              {formatRoundedNumber(c.topResultDiagnostic.workerAggregate.avgImmortalDamage)} · main TTK{" "}
              {formatRoundedSeconds(c.topResultDiagnostic.mainThreadAggregate.avgTtkWin)} / Eff{" "}
              {formatRoundedNumber(c.topResultDiagnostic.mainThreadAggregate.avgImmortalDamage)}
            </div>
          ) : null}

          {c.results.map((item, idx) => {
            const key = buildResultKey(item.build, item.activesOn, item.breathOn);
            const expanded = c.expandedResultKey === key;
            return (
              <BuildCard
                key={key}
                rank={idx + 1}
                item={item}
                sourceName={nameA}
                icon={getCreatureIcon(nameA)}
                objective={c.objective}
                basis={effectiveBasis}
                hero={idx === 0}
                expanded={expanded}
                loading={c.loadingPerOpponentKey === key}
                rows={expanded ? c.currentPerOpponentRows : null}
                onApplyA={applyToCompareA}
                onApplyB={applyToCompareB}
                onCopy={() => void c.copyBuildHeader(item, idx, nameA)}
                onToggleOpponents={() => void c.loadPerOpponentRows(item, idx, nameA)}
              />
            );
          })}
        </div>
      )}

      {/* Setup overlay - Build (creature + depth + constraints) / Pool (builder)
          / Battle (settings + two-faced + dev guard). Portaled to <body> + the
          beta-portal token scope so a transformed ancestor never traps it. */}
      {setupOpen ? createPortal(
        <div className="beta-portal">
          <div className="cb-scrim" onClick={() => setSetupOpen(false)} />
          <aside className="cb-modal" role="dialog" aria-label="Best Builds setup" aria-modal="true">
            <div className="cb-modal__head">
              <h3>Configure</h3>
              <div className="cb-modal__head-actions">
                <button
                  className="cb-runbtn"
                  onClick={() => { void c.runBestBuilds(); setSetupOpen(false); }}
                  disabled={!canRun || c.isRunning}
                >
                  {c.isRunning ? "Running…" : "Calculate"}
                </button>
                <button className="cb-icon" aria-label="Close setup" onClick={() => setSetupOpen(false)}>
                  <X size={16} strokeWidth={2} />
                </button>
              </div>
            </div>
            <div className="cb-modal__tabs" role="tablist">
              <button type="button" role="tab" aria-selected={setupTab === "build"} className={`cb-modal__tab${setupTab === "build" ? " is-active" : ""}`} onClick={() => setSetupTab("build")}>
                <IconImg src={getCreatureIcon(nameA)} alt="" size={20} /><span>{nameA || "Build"}</span>
              </button>
              <button type="button" role="tab" aria-selected={setupTab === "pool"} className={`cb-modal__tab${setupTab === "pool" ? " is-active" : ""}`} onClick={() => setSetupTab("pool")}>
                <Users size={15} strokeWidth={2} aria-hidden="true" /><span>Pool ({c.activePool.length})</span>
              </button>
              <button type="button" role="tab" aria-selected={setupTab === "battle"} className={`cb-modal__tab${setupTab === "battle" ? " is-active" : ""}`} onClick={() => setSetupTab("battle")}>
                <Settings2 size={15} strokeWidth={2} aria-hidden="true" /><span>Battle</span>
              </button>
            </div>
            <div className="cb-modal__body">
              {/* Build: creature, search depth, constraints */}
              <div className="cb-tabpane" hidden={setupTab !== "build"}>
                <div className="panel-block">
                  <div className="field">
                    <label>Creature</label>
                    <div className="icon-input">
                      <IconImg src={getCreatureIcon(nameA)} alt={nameA} size={36} />
                      <CreatureNameInput ariaLabel="Best Builds creature" value={nameA} onChange={onNameAChange} creatureNames={creatureNames} />
                    </div>
                  </div>
                  <div className="field">
                    <label>Search depth</label>
                    <div className="cb-seg bbb-depth-seg" role="tablist" aria-label="Search depth">
                      {([["soft", "Soft", "quicker"], ["detailed", "Detailed", "more thorough"]] as const).map(([id, label, hint]) => (
                        <button
                          key={id}
                          type="button"
                          role="tab"
                          aria-selected={c.searchDepth === id}
                          className={`cb-seg__opt${c.searchDepth === id ? " is-active" : ""}`}
                          onClick={() => c.setSearchDepth(id)}
                        >
                          {label} <em>{hint}</em>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="panel-block">
                  <BestBuildsConstraintControls
                    targetConstraints={c.targetConstraints}
                    setTargetConstraints={c.setTargetConstraints}
                    excludedTraits={c.excludedTraits}
                    toggleExcludedTrait={c.toggleExcludedTrait}
                    traitBlacklistOptions={c.traitBlacklistOptions}
                    excludedPlushies={c.excludedPlushies}
                    toggleExcludedPlushie={c.toggleExcludedPlushie}
                    plushieBlacklistOptions={c.plushieBlacklistOptions}
                    targetTraitLock={c.targetTraitLock}
                    setTargetTraitLock={c.setTargetTraitLock}
                    targetAscensionLock={c.targetAscensionLock}
                    setTargetAscensionLock={c.setTargetAscensionLock}
                    targetPlushieLock={c.targetPlushieLock}
                    setTargetPlushieLock={c.setTargetPlushieLock}
                    targetElderLock={c.targetElderLock}
                    setTargetElderLock={c.setTargetElderLock}
                    showAllAscensionDistributions={c.showAllAscensionDistributions}
                    setShowAllAscensionDistributions={c.setShowAllAscensionDistributions}
                  />
                </div>
              </div>

              {/* Pool: the opponent-pool builder */}
              <div className="cb-tabpane" hidden={setupTab !== "pool"}>
                <div className="bbb-pool">
                  <div className="bbb-pool__seg">
                    <div className="cb-seg" role="tablist" aria-label="Pool source">
                      <button
                        type="button"
                        role="tab"
                        aria-selected={!isCustom}
                        className={`cb-seg__opt${!isCustom ? " is-active" : ""}`}
                        onClick={() => { if (isCustom) c.setPoolMode(`meta${metaSize}` as Parameters<typeof c.setPoolMode>[0]); }}
                      >
                        Meta pool
                      </button>
                      <button
                        type="button"
                        role="tab"
                        aria-selected={isCustom}
                        className={`cb-seg__opt${isCustom ? " is-active" : ""}`}
                        onClick={() => c.setPoolMode("custom")}
                      >
                        Custom list
                      </button>
                    </div>
                    <button type="button" className="cb-ghostbtn bbb-copycode" onClick={() => void c.copyPoolCode()}>Copy pool code</button>
                  </div>

                  {!isCustom ? (
                    <>
                      <div className="bbb-pool__group">
                        <span className="bbb-pool__label">Pool size</span>
                        <div className="bbb-chiprow">
                          {META_SIZES.map((size) => (
                            <button
                              key={size}
                              type="button"
                              className={`bbb-sizechip${metaSize === size && !isCustom ? " is-active" : ""}`}
                              onClick={() => c.setPoolMode(`meta${size}` as Parameters<typeof c.setPoolMode>[0])}
                            >
                              {size}
                            </button>
                          ))}
                        </div>
                        <div className="note">How many opponents the automatic meta pool includes. It stays varied instead of clustering on one kind of creature.</div>
                      </div>
                      <div className="bbb-pool__group">
                        <span className="bbb-pool__label">Tier scope</span>
                        <div className="bbb-chiprow">
                          {SCOPE_OPTIONS.map((s) => (
                            <button
                              key={s.id}
                              type="button"
                              className={`bbb-scopechip${c.poolScope === s.id ? " is-active" : ""}`}
                              onClick={() => c.setPoolScope(s.id)}
                            >
                              {s.label}
                            </button>
                          ))}
                        </div>
                        {c.poolScope === "exactTiers" ? (
                          <div className="bbb-chiprow bbb-chiprow--tiers">
                            {tierOptions.map((tier) => (
                              <button
                                key={tier}
                                type="button"
                                className={`bbb-tierchip${c.selectedPoolTiers.includes(tier) ? " is-active" : ""}`}
                                onClick={() => togglePoolTier(tier)}
                              >
                                T{tier}
                              </button>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="bbb-pool__group">
                        <span className="bbb-pool__label">Add opponents</span>
                        <input
                          className="bbb-pool__search"
                          placeholder="Search creature…"
                          value={c.customPickerQuery}
                          onChange={(e) => c.setCustomPickerQuery(e.target.value)}
                          aria-label="Search creatures to add to the custom pool"
                        />
                        <div className="bbb-pickgrid">
                          {c.filteredCustomChoices.slice(0, 60).map((name) => {
                            const selected = c.selectedCustomSet.has(name);
                            const row = creatureByName[name];
                            return (
                              <button
                                key={name}
                                type="button"
                                className={`bbb-pickchip${selected ? " is-selected" : ""}`}
                                onClick={() => (selected ? c.removeFromCustomPool(name) : c.addToCustomPool(name))}
                              >
                                <IconImg src={getCreatureIcon(name)} alt={name} size={20} />
                                <span className="bbb-pickchip__name">{name}</span>
                                <span className="bbb-pickchip__tier">T{row?.stats.tier ?? "?"}</span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                      <div className="bbb-pool__group">
                        <span className="bbb-pool__label">Pool code (names split by comma / newline / |)</span>
                        <textarea
                          className="bbb-pool__code"
                          value={c.customPoolText}
                          onChange={(e) => c.setCustomPoolText(e.target.value)}
                          rows={3}
                          aria-label="Custom pool code"
                        />
                      </div>
                    </>
                  )}

                  {/* Live preview of the resolved pool. */}
                  <div className="bbb-pool__group">
                    <span className="bbb-pool__label">In pool · {c.activePool.length}</span>
                    {c.activePool.length === 0 ? (
                      <div className="note">No opponents in the pool yet.</div>
                    ) : (
                      <div className="bbb-preview" role="region" aria-label="Pool preview" tabIndex={0}>
                        {c.activePool.map((name) => {
                          const row = creatureByName[name];
                          return (
                            <span key={name} className={`bbb-preview__item${isCustom ? " is-removable" : ""}`} onClick={isCustom ? () => c.removeFromCustomPool(name) : undefined} title={isCustom ? "Click to remove" : undefined}>
                              <IconImg src={getCreatureIcon(name)} alt={name} size={20} />
                              <span className="bbb-preview__name">{name}</span>
                              <span className="bbb-preview__tier">T{row?.stats.tier ?? "?"}</span>
                            </span>
                          );
                        })}
                      </div>
                    )}
                    <div className="note">Pool baseline: Veneration 5, Damage+Bite (Damage ascension max), Void+Void plushies.</div>
                  </div>
                </div>
              </div>

              {/* Battle: settings modal + two-faced + dev guard */}
              <div className="cb-tabpane cb-tabpane--search" hidden={setupTab !== "battle"}>
                <div className="panel-block">
                  <h3>Battle settings</h3>
                  <BestBuildsBattleSettingsPanel sourceName={nameA} opponentNames={c.activePool} betaSkin inline />
                  <div className="note">Per-side AI policy, environment, healing, traps, disabled abilities, buffs and ability-timing overrides.</div>
                  {showTwoFaced ? (
                    <div className="best-builds-two-faced-mode">
                      <div className="compare-buff-heading"><span>Two-Faced mode</span></div>
                      <div className="compare-special-level-grid">
                        {[{ id: "madness" as const, label: "Madness" }, { id: "tranquility" as const, label: "Tranquility" }].map((m) => (
                          <button
                            key={m.id}
                            type="button"
                            className={c.twoFacedMode === m.id ? "compare-special-level-button active" : "compare-special-level-button"}
                            onClick={() => c.setTwoFacedMode(m.id)}
                          >
                            {m.label}
                          </button>
                        ))}
                      </div>
                      <span className="note">
                        {c.twoFacedMode === "madness"
                          ? "Madness: ×0.625 damage, ×0.625 bite cooldown. Applies to the source and every opponent that owns Two-Faced."
                          : "Tranquility: ×1.6 damage, ×1.6 bite cooldown. Applies to the source and every opponent that owns Two-Faced."}
                      </span>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          </aside>
        </div>,
        document.body,
      ) : null}
    </section>
  );
}
