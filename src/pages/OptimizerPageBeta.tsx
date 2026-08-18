// Beta "Counter recommendation" view of the Optimizer. Dev-gated (iddqd +
// Settings beta toggle), routed in place of the default OptimizerPage when the
// beta design is active. Shares useOptimizerPageController, so the search is
// identical - only the presentation differs.
//
// Design: the OUTPUT of the optimizer is a BUILD, so the build is the hero.
// Each result renders as a BuildCard (loadout chips + a metric readout whose
// LEAD stat follows the chosen objective). The frequently-iterated levers
// (the two creatures, the objective, Run) live on an always-visible control
// bar; the heavier config (full A build, B locks, search + battle settings)
// lives in a tabbed Setup overlay - the "hybrid" split, so re-running with a
// tweaked objective never means digging through a modal.

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Settings2, X } from "lucide-react";
import type { BuildOptions, TwoFacedMode } from "../engine";
import type { CombatEventPhase } from "../engine/eventOrdering";
import { getCreatureIcon } from "../engine/creatureData";
import { veneration } from "../engine/buildData";
import { IconImg } from "../components/IconImg";
import { CreatureNameInput } from "../components/CreatureNameInput";
import { AscensionSelectors, ElderSelector, PlushieSelectors, TraitSelectors } from "../components/BuildSelectors";
import { BuildLockControls } from "../components/optimizer/BuildLockControls";
import { OptimizerSettingsPanel } from "../components/optimizer/OptimizerSettingsPanel";
import { BuildLoadout } from "../components/beta/BuildLoadout";
import { ApplyToCompare } from "../components/beta/ApplyToCompare";
import { useOptimizerPageController } from "./useOptimizerPageController";
import { formatBuildHeaderLines } from "../optimizer/bestBuildsPageFlow";
import { useBestBuildsBattleSettings } from "../components/bestBuilds/BestBuildsBattleSettingsContext";
import type { BestBuildsBattleSettings } from "../components/bestBuilds/bestBuildsBattleSettingsTypes";
import type { OptimizationGoal, OptimizationMode } from "./optimizerLegacyTypes";
import type { BestBuildAggregateResult } from "../optimizer/bestBuildsEvaluation";
import { computeAscensionCounts } from "../shared/buildEncoding";
import { formatRoundedNumber, formatRoundedPercent, formatRoundedSeconds } from "../shared/displayFormat";
import { registerMatchSnapshotProvider } from "../shared/matchSnapshot";
import "./compareBeta.css";
import "./optimizerBeta.css";

export type OptimizerPageBetaProps = {
  nameA: string;
  nameB: string;
  buildA: BuildOptions;
  creatureNames: string[];
  developerMode: boolean;
  combatEventOrder: CombatEventPhase[];
  onNameAChange: (value: string) => void;
  onNameBChange: (value: string) => void;
  onApplyBuildB: (build: BuildOptions) => void;
  onApplyBuildA: (build: BuildOptions) => void;
};

type OptimizerSnapshotState = {
  nameA: string; nameB: string; fixedBuildA: BuildOptions;
  quality: "fast" | "balanced" | "quality"; optimizePlushies: boolean;
  searchAllVeneration: boolean; searchToggles: boolean;
  optimizationMode: OptimizationMode; optimizationGoal: OptimizationGoal;
  targetVenerationMode: "auto" | "fixed"; targetConstraints: BuildOptions;
  targetTraitLock: boolean; targetAscensionLock: boolean; targetPlushieLock: boolean; targetElderLock: boolean;
  debugPreScore: boolean; stage1TopK: number; stage2Cap: number; diversifyPlushiePairs: boolean;
  resultsLimit: number; useWorkers: boolean; twoFacedMode: TwoFacedMode; battleSettings: BestBuildsBattleSettings;
};

// Objective -> which metric is the headline. Keeps the page visibly answering
// the question the user asked (e.g. "optimize for survival" -> Survival leads).
const OBJECTIVE_META: Record<OptimizationGoal, { seg: string; leadKey: MetricKey }> = {
  lexicographic: { seg: "Win rate", leadKey: "win" },
  ttk: { seg: "TTK", leadKey: "ttk" },
  dps: { seg: "DPS", leadKey: "dps" },
  survival: { seg: "Survival", leadKey: "surv" },
};
const OBJECTIVE_ORDER: OptimizationGoal[] = ["lexicographic", "ttk", "dps", "survival"];

type MetricKey = "win" | "ttk" | "dps" | "eff" | "surv";
type Metric = { key: MetricKey; label: string; value: string };

function metricsOf(agg: BestBuildAggregateResult["aggregate"]): Metric[] {
  return [
    { key: "win", label: "Win rate", value: formatRoundedPercent(agg.winRate * 100) },
    { key: "ttk", label: "Avg TTK", value: formatRoundedSeconds(agg.avgTtkWin) },
    { key: "dps", label: "Avg DPS", value: formatRoundedNumber(agg.avgDps) },
    { key: "eff", label: "Effective", value: formatRoundedNumber(agg.avgImmortalDamage) },
    { key: "surv", label: "Survival", value: formatRoundedSeconds(agg.avgSurvival) },
  ];
}

function BuildCard({ rank, item, nameB, iconB, nameA, objective, hero, onApplyA, onApplyB, onCopy }: {
  rank: number;
  item: BestBuildAggregateResult;
  nameB: string;
  iconB: string | null;
  nameA: string;
  objective: OptimizationGoal;
  hero: boolean;
  onApplyA: (build: BuildOptions) => void;
  onApplyB: (build: BuildOptions) => void;
  onCopy: () => void;
}) {
  const agg = item.aggregate;
  // winRate/drawRate are the OPTIMIZED creature's (page B), and winRate counts
  // draws too - so the pure-win fraction is winRate - drawRate. Optimizer is
  // always a single opponent (A), so this resolves the matchup verdict; B
  // winning is the goal.
  const drew = agg.drawRate >= 0.5;
  const optimizedWon = !drew && agg.winRate - agg.drawRate >= 0.5;
  const verdict = drew
    ? { txt: "Draw", tone: "flat" as const }
    : optimizedWon
      ? { txt: `${nameB || "B"} wins`, tone: "good" as const }
      : { txt: `${nameA || "A"} wins`, tone: "bad" as const };
  const leadKey = OBJECTIVE_META[objective].leadKey;
  const metrics = metricsOf(agg);
  const lead = metrics.find((m) => m.key === leadKey)!;
  const rest = metrics.filter((m) => m.key !== leadKey);
  return (
    <div className={`ob-card${hero ? " ob-card--hero" : ""}`}>
      <div className="ob-card__head">
        <span className="ob-card__rank">#{rank}</span>
        <IconImg src={iconB} alt={nameB} size={hero ? 44 : 32} />
        <div className="ob-card__id">
          <div className="ob-card__name">{nameB || "B"}</div>
          <div className="ob-card__sub">optimized build</div>
        </div>
        <span className={`ob-verdict ob-verdict--${verdict.tone}`}>{verdict.txt}</span>
      </div>

      <div className="ob-card__metrics">
        <div className="ob-metric ob-metric--lead">
          <span>{lead.label}</span>
          <b>{lead.value}</b>
          <small>objective</small>
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
        <button type="button" className="cb-ghostbtn" onClick={onCopy}>Copy build</button>
      </div>
    </div>
  );
}

export default function OptimizerPageBeta(props: OptimizerPageBetaProps) {
  const { nameA, nameB, buildA, creatureNames, developerMode, combatEventOrder, onNameAChange, onNameBChange, onApplyBuildB, onApplyBuildA } = props;
  // The optimizer builds Creature B. "Apply to Compare B" just drops the build
  // on side B (B is already nameB). "Apply to Compare A" also moves the
  // optimized creature onto side A so the build lands on the right creature.
  const applyToCompareA = (build: BuildOptions) => { onNameAChange(nameB); onApplyBuildA(build); };
  const applyToCompareB = (build: BuildOptions) => { onApplyBuildB(build); };
  const c = useOptimizerPageController({ nameA, nameB, buildA, combatEventOrder });
  const { settings: bbBattleSettings, setSettings: setBbBattleSettings } = useBestBuildsBattleSettings();
  const [setupOpen, setSetupOpen] = useState(false);
  const [setupTab, setSetupTab] = useState<"a" | "b" | "search">("a");

  // Share-Match snapshot provider (parity with the default OptimizerPage).
  const shareRef = useRef<OptimizerSnapshotState | null>(null);
  shareRef.current = {
    nameA, nameB, fixedBuildA: c.fixedBuildA, quality: c.quality, optimizePlushies: c.optimizePlushies,
    searchAllVeneration: c.searchAllVeneration, searchToggles: c.searchToggles, optimizationMode: c.optimizationMode,
    optimizationGoal: c.optimizationGoal, targetVenerationMode: c.targetVenerationMode, targetConstraints: c.targetConstraints,
    targetTraitLock: c.targetTraitLock, targetAscensionLock: c.targetAscensionLock, targetPlushieLock: c.targetPlushieLock,
    targetElderLock: c.targetElderLock, debugPreScore: c.debugPreScore, stage1TopK: c.stage1TopK, stage2Cap: c.stage2Cap,
    diversifyPlushiePairs: c.diversifyPlushiePairs, resultsLimit: c.resultsLimit, useWorkers: c.useWorkers,
    twoFacedMode: c.twoFacedMode, battleSettings: bbBattleSettings,
  };
  useEffect(() => {
    return registerMatchSnapshotProvider({
      page: "optimizer",
      getSnapshot: () => {
        const s = shareRef.current!;
        return {
          pageState: { ...s } as unknown as Record<string, unknown>,
          participantCreatureNames: [s.nameA, s.nameB].filter((n): n is string => Boolean(n)),
        };
      },
      applySnapshot: (pageState) => {
        const s = pageState as Partial<OptimizerSnapshotState>;
        if (typeof s.nameA === "string") onNameAChange(s.nameA);
        if (typeof s.nameB === "string") onNameBChange(s.nameB);
        if (s.fixedBuildA) c.setFixedBuildA(s.fixedBuildA);
        if (s.quality !== undefined) c.setQuality(s.quality);
        if (s.optimizePlushies !== undefined) c.setOptimizePlushies(s.optimizePlushies);
        if (s.searchAllVeneration !== undefined) c.setSearchAllVeneration(s.searchAllVeneration);
        if (s.searchToggles !== undefined) c.setSearchToggles(s.searchToggles);
        if (s.optimizationMode !== undefined) c.setOptimizationMode(s.optimizationMode);
        if (s.optimizationGoal !== undefined) c.setOptimizationGoal(s.optimizationGoal);
        if (s.targetVenerationMode !== undefined) c.setTargetVenerationMode(s.targetVenerationMode);
        if (s.targetConstraints) c.setTargetConstraints(s.targetConstraints);
        if (s.targetTraitLock !== undefined) c.setTargetTraitLock(s.targetTraitLock);
        if (s.targetAscensionLock !== undefined) c.setTargetAscensionLock(s.targetAscensionLock);
        if (s.targetPlushieLock !== undefined) c.setTargetPlushieLock(s.targetPlushieLock);
        if (s.targetElderLock !== undefined) c.setTargetElderLock(s.targetElderLock);
        if (s.debugPreScore !== undefined) c.setDebugPreScore(s.debugPreScore);
        if (s.stage1TopK !== undefined) c.setStage1TopK(s.stage1TopK);
        if (s.stage2Cap !== undefined) c.setStage2Cap(s.stage2Cap);
        if (s.diversifyPlushiePairs !== undefined) c.setDiversifyPlushiePairs(s.diversifyPlushiePairs);
        if (s.resultsLimit !== undefined) c.setResultsLimit(s.resultsLimit);
        if (s.useWorkers !== undefined) c.setUseWorkers(s.useWorkers);
        if (s.twoFacedMode !== undefined) c.setTwoFacedMode(s.twoFacedMode);
        if (s.battleSettings) setBbBattleSettings(s.battleSettings);
      },
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps -- setters are stable
  }, [onNameAChange, onNameBChange]);

  const visible = useMemo(() => c.results.slice(0, c.resultsLimit), [c.results, c.resultsLimit]);

  const copyBuild = (item: BestBuildAggregateResult, idx: number) => {
    const asc = computeAscensionCounts(item.build.traits, item.build.ascensionAssignments, item.build.venerationStage);
    const ascSummary = item.build.traits.map((trait, i) => `${trait}=${asc[i] ?? 0}`).join(", ");
    const lines = formatBuildHeaderLines(item, idx, nameB || "Creature B", ascSummary);
    void navigator.clipboard.writeText(lines.join("\n")).catch(() => { /* clipboard unavailable */ });
  };

  return (
    <section className="ob">
      {/* Iteration control bar: target vs optimized creature, the objective
          lever (segmented), and Configure + Run. */}
      <div className="ob-bar">
        {/* Each side opens Setup on its own tab (A = target, B = optimized) -
            a quick edit shortcut, like the Best Builds source/pool chips. */}
        <div className="ob-matchup">
          <button type="button" className="ob-matchup__side ob-matchup__side--btn" onClick={() => { setSetupTab("a"); setSetupOpen(true); }} title="Edit target creature A">
            <IconImg src={getCreatureIcon(nameA)} alt={nameA} size={28} />
            <span><b title={nameA}>{nameA || "—"}</b><em>target</em></span>
          </button>
          <span className="ob-matchup__vs">→</span>
          <button type="button" className="ob-matchup__side ob-matchup__side--b ob-matchup__side--btn" onClick={() => { setSetupTab("b"); setSetupOpen(true); }} title="Edit optimized creature B">
            <span><b title={nameB}>{nameB || "—"}</b><em>building</em></span>
            <IconImg src={getCreatureIcon(nameB)} alt={nameB} size={28} />
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
                aria-selected={c.optimizationGoal === g}
                className={`cb-seg__opt${c.optimizationGoal === g ? " is-active" : ""}`}
                onClick={() => c.setOptimizationGoal(g)}
              >
                {OBJECTIVE_META[g].seg}
              </button>
            ))}
          </div>
        </div>

        {/* Zero-shift run controls (see BestBuildsPageBeta): % lives inside the
            fixed-width run button; Cancel renders only while running, to the
            LEFT of the right-pinned cluster, so the buttons never move. */}
        <div className="ob-bar__actions">
          {c.isRunning ? <button className="secondary ob-cancel" type="button" onClick={c.cancelRun}>Cancel</button> : null}
          <button className="cb-ghostbtn" type="button" onClick={() => setSetupOpen(true)}>
            <Settings2 size={15} strokeWidth={2} aria-hidden="true" /> Configure
          </button>
          {c.isRunning ? (
            <button className="ob-run ob-run--progress" type="button" disabled aria-label={`Running, ${formatRoundedPercent(c.progress * 100)} complete`}>
              <span className="ob-run__fill" style={{ width: `${Math.min(100, Math.round(c.progress * 100))}%` }} />
              <span className="ob-run__text">Running… {formatRoundedPercent(c.progress * 100)}</span>
            </button>
          ) : (
            <button className="primary ob-run" type="button" onClick={() => void c.runOptimizer()}>Run Optimizer</button>
          )}
        </div>
      </div>

      {c.error ? <div className="ob-error">{c.error}</div> : null}

      {/* Results - the recommended build(s) for B against the fixed A. */}
      {visible.length === 0 ? (
        <div className="cb-empty">{c.isRunning ? "Searching builds…" : `Press “Run” to find ${nameB || "Creature B"}’s best build against ${nameA || "Creature A"}.`}</div>
      ) : (
        <div className="ob-results">
          <div className="ob-results__head">
            <span className="ob-results__title">Best builds — {nameB || "B"} vs {nameA || "A"}</span>
            <span className="ob-results__hint">Ranked by {OBJECTIVE_META[c.optimizationGoal].seg.toLowerCase()}. Apply any to the Compare tab.</span>
          </div>
          {visible.map((item, idx) => (
            <BuildCard
              key={`${idx}-${item.build.traits.join("+")}-${item.build.plushies.join("+")}`}
              rank={idx + 1}
              item={item}
              nameB={nameB}
              iconB={getCreatureIcon(nameB)}
              nameA={nameA}
              objective={c.optimizationGoal}
              hero={idx === 0}
              onApplyA={applyToCompareA}
              onApplyB={applyToCompareB}
              onCopy={() => copyBuild(item, idx)}
            />
          ))}
        </div>
      )}

      {/* Setup overlay - heavier config, tabbed (Target A / Build B / Search).
          Reuses the existing config components; the cb-modal scope in
          compareBeta.css reskins their inputs/selects/chips to the beta kit. */}
      {setupOpen ? createPortal(
        <div className="beta-portal">
          <div className="cb-scrim" onClick={() => setSetupOpen(false)} />
          <aside className="cb-modal" role="dialog" aria-label="Optimizer setup" aria-modal="true">
            <div className="cb-modal__head">
              <h3>Configure</h3>
              <div className="cb-modal__head-actions">
                <button className="cb-runbtn" onClick={() => { void c.runOptimizer(); setSetupOpen(false); }} disabled={c.isRunning}>{c.isRunning ? "Running…" : "Run"}</button>
                <button className="cb-icon" aria-label="Close setup" onClick={() => setSetupOpen(false)}><X size={16} strokeWidth={2} /></button>
              </div>
            </div>
            <div className="cb-modal__tabs" role="tablist">
              <button type="button" role="tab" aria-selected={setupTab === "a"} className={`cb-modal__tab cb-modal__tab--a${setupTab === "a" ? " is-active" : ""}`} onClick={() => setSetupTab("a")}>
                <IconImg src={getCreatureIcon(nameA)} alt="" size={20} /><span>{nameA || "Target A"}</span>
              </button>
              <button type="button" role="tab" aria-selected={setupTab === "b"} className={`cb-modal__tab cb-modal__tab--b${setupTab === "b" ? " is-active" : ""}`} onClick={() => setSetupTab("b")}>
                <IconImg src={getCreatureIcon(nameB)} alt="" size={20} /><span>{nameB || "Build B"}</span>
              </button>
              <button type="button" role="tab" aria-selected={setupTab === "search"} className={`cb-modal__tab${setupTab === "search" ? " is-active" : ""}`} onClick={() => setSetupTab("search")}>
                <Settings2 size={15} strokeWidth={2} aria-hidden="true" /><span>Search</span>
              </button>
            </div>
            <div className="cb-modal__body">
              {/* Target A: fixed build. The creature selector lives ABOVE the
                  build panel-block (like Compare's hero) so the panel-block's
                  five fields map 1:1 to the cb-tabpane--creature grid areas
                  (ven/traits/asc/plushies/elder) - that's what gives Elder its
                  full-width row, so its cards lay out in a line, not a 2x2. */}
              <div className="cb-tabpane cb-tabpane--creature cb-tabpane--a" hidden={setupTab !== "a"}>
                <div className="field cb-setup-creature">
                  <label>Creature A (fixed target)</label>
                  <div className="icon-input">
                    <IconImg src={getCreatureIcon(nameA)} alt={nameA} size={36} />
                    <CreatureNameInput ariaLabel="Creature A (fixed build)" value={nameA} onChange={onNameAChange} creatureNames={creatureNames} />
                  </div>
                </div>
                <div className="panel-block">
                  <div className="field">
                    <label>Veneration</label>
                    <select aria-label="Fixed A Veneration" value={c.fixedBuildA.venerationStage} onChange={(e) => c.setFixedBuildA({ ...c.fixedBuildA, venerationStage: Number(e.target.value) })}>
                      {Array.from({ length: veneration.stages + 1 }, (_, idx) => <option key={idx} value={idx}>{idx}</option>)}
                    </select>
                  </div>
                  <div className="field"><label>Traits</label><TraitSelectors build={c.fixedBuildA} onBuildChange={c.setFixedBuildA} /></div>
                  <div className="field"><label>Ascension</label><AscensionSelectors build={c.fixedBuildA} onBuildChange={c.setFixedBuildA} /></div>
                  <div className="field"><label>Plushies</label><PlushieSelectors build={c.fixedBuildA} onBuildChange={c.setFixedBuildA} /></div>
                  <div className="field"><label>Elder</label><ElderSelector build={c.fixedBuildA} onBuildChange={c.setFixedBuildA} showDeltaChips /></div>
                </div>
              </div>

              {/* Build B: name + swap + optional locks */}
              <div className="cb-tabpane cb-tabpane--b" hidden={setupTab !== "b"}>
                <div className="panel-block">
                  <div className="field">
                    <label>Creature B (optimized)</label>
                    <div className="icon-input">
                      <IconImg src={getCreatureIcon(nameB)} alt={nameB} size={36} />
                      <CreatureNameInput ariaLabel="Creature B (optimized)" value={nameB} onChange={onNameBChange} creatureNames={creatureNames} />
                    </div>
                  </div>
                  <button className="cb-ghostbtn" type="button" onClick={() => { const a = nameB; const b = nameA; onNameAChange(a); onNameBChange(b); c.setFixedBuildA(buildA); }}>Swap A / B</button>
                  <BuildLockControls
                    targetConstraints={c.targetConstraints} setTargetConstraints={c.setTargetConstraints}
                    targetTraitLock={c.targetTraitLock} setTargetTraitLock={c.setTargetTraitLock}
                    targetAscensionLock={c.targetAscensionLock} setTargetAscensionLock={c.setTargetAscensionLock}
                    targetPlushieLock={c.targetPlushieLock} setTargetPlushieLock={c.setTargetPlushieLock}
                    targetElderLock={c.targetElderLock} setTargetElderLock={c.setTargetElderLock}
                    introNote="Optional locks for optimized Build B (leave empty for full search)."
                  />
                </div>
              </div>

              {/* Search & battle settings */}
              <div className="cb-tabpane cb-tabpane--search" hidden={setupTab !== "search"}>
                <OptimizerSettingsPanel
                  betaSkin
                  quality={c.quality} setQuality={c.setQuality}
                  optimizePlushies={c.optimizePlushies}
                  optimizationMode={c.optimizationMode} setOptimizationMode={c.setOptimizationMode}
                  optimizationGoal={c.optimizationGoal} setOptimizationGoal={c.setOptimizationGoal}
                  targetVenerationMode={c.targetVenerationMode} setTargetVenerationMode={c.setTargetVenerationMode}
                  targetConstraints={c.targetConstraints} setTargetConstraints={c.setTargetConstraints}
                  resultsLimit={c.resultsLimit} setResultsLimit={c.setResultsLimit}
                  developerMode={developerMode}
                  searchAllVeneration={c.searchAllVeneration} setSearchAllVeneration={c.setSearchAllVeneration}
                  searchToggles={c.searchToggles} setSearchToggles={c.setSearchToggles}
                  debugPreScore={c.debugPreScore} setDebugPreScore={c.setDebugPreScore}
                  stage1TopK={c.stage1TopK} setStage1TopK={c.setStage1TopK}
                  stage2Cap={c.stage2Cap} setStage2Cap={c.setStage2Cap}
                  diversifyPlushiePairs={c.diversifyPlushiePairs} setDiversifyPlushiePairs={c.setDiversifyPlushiePairs}
                  useWorkers={c.useWorkers} setUseWorkers={c.setUseWorkers}
                  guaranteedStats={c.guaranteedStats}
                  twoFacedMode={c.twoFacedMode} setTwoFacedMode={c.setTwoFacedMode}
                  nameA={nameA} nameB={nameB}
                />
              </div>
            </div>
          </aside>
        </div>,
        document.body,
      ) : null}
    </section>
  );
}
