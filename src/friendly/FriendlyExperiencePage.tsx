/**
 * Friendly UI — an alternative, simpler front-end skin over the same
 * Rust + WASM engine. INTENTIONALLY PARKED: cut from the router as
 * outdated and kept for possible revival. By design nothing outside
 * `src/friendly/` imports this subtree — it is NOT dead code. A dead-code
 * scan flagging this directory is a false positive. See ./README.md.
 */
import { Suspense, lazy, useEffect, useMemo, useState } from "react";
import "./friendly.css";
import type { BuildOptions, CreatureRuntime } from "../engine";
import type { AppPage } from "../AppPageRouter";
import { DEFAULT_FRIENDLY_BEST_BUILD_ANSWERS } from "./friendlyConfig";
import {
  FriendlyBestBuildSelection,
  type CreatureFilters,
} from "./FriendlyBestBuildFlow";
import { getAvailableCreatureTypes, getCreatureFacetTags, isAirBattleEligible } from "./friendlyData";
import type { FriendlyBestBuildAnswers, FriendlyShellPage } from "./friendlyTypes";
import { FriendlySectionRail } from "./FriendlyUiPrimitives";

const LazyFriendlyBestBuildPageShell = lazy(() =>
  import("./FriendlyBestBuildPageShell").then((module) => ({ default: module.FriendlyBestBuildPageShell })),
);
const LazyFriendlyBattlePageShell = lazy(() =>
  import("./FriendlyBattlePageShell").then((module) => ({ default: module.FriendlyBattlePageShell })),
);

export type FriendlyExperiencePageProps = {
  nameA: string;
  nameB: string;
  buildA: BuildOptions;
  buildB: BuildOptions;
  creatureA?: CreatureRuntime;
  creatureB?: CreatureRuntime;
  creatures: CreatureRuntime[];
  creatureDataLoaded: boolean;
  creatureNames?: string[];
  getCreatureIcon: (name: string) => string | null;
  onRequireCreatureData: () => void;
  onNameAChange: (value: string) => void;
  onNameBChange: (value: string) => void;
  onBuildAChange: (build: BuildOptions) => void;
  onBuildBChange: (build: BuildOptions) => void;
  onSwitchToAdvanced: (page?: AppPage) => void;
};

export default function FriendlyExperiencePage({
  nameA,
  nameB,
  buildA,
  buildB,
  creatureA,
  creatureB,
  creatures,
  creatureDataLoaded,
  creatureNames: _creatureNames,
  getCreatureIcon,
  onRequireCreatureData,
  onNameAChange,
  onNameBChange,
  onBuildAChange,
  onBuildBChange,
  onSwitchToAdvanced,
}: FriendlyExperiencePageProps) {
  const [page, setPage] = useState<FriendlyShellPage>("home");
  const [answers, setAnswers] = useState<FriendlyBestBuildAnswers>(DEFAULT_FRIENDLY_BEST_BUILD_ANSWERS);
  const [selectedBestBuildCreature, setSelectedBestBuildCreature] = useState(() => nameA || creatures[0]?.name || "");
  const [bestBuildStep, setBestBuildStep] = useState(0);
  const [filters, setFilters] = useState<CreatureFilters>({
    query: "",
    selectedTiers: [],
    selectedTypes: [],
  });

  const tierOptions = useMemo(
    () => Array.from(new Set(creatures.map((creature) => creature.stats.tier))).sort((a, b) => a - b),
    [creatures],
  );
  const typeOptions = useMemo(() => getAvailableCreatureTypes(creatures), [creatures]);
  const selectedBestBuildData = useMemo(
    () => creatures.find((creature) => creature.name === selectedBestBuildCreature),
    [creatures, selectedBestBuildCreature],
  );
  const eligibleForAirRule = isAirBattleEligible(selectedBestBuildData);
  const needsCreatureData = page !== "home";

  useEffect(() => {
    if (selectedBestBuildCreature) return;
    if (nameA) {
      setSelectedBestBuildCreature(nameA);
      return;
    }
    if (creatures.length > 0) {
      setSelectedBestBuildCreature(creatures[0].name);
    }
  }, [creatures, nameA, selectedBestBuildCreature]);

  const filteredCreatures = useMemo(() => {
    const query = filters.query.trim().toLowerCase();
    return creatures.filter((creature) => {
      if (query && !creature.name.toLowerCase().includes(query)) return false;
      if (filters.selectedTiers.length > 0 && !filters.selectedTiers.includes(creature.stats.tier)) return false;
      if (filters.selectedTypes.length > 0) {
        const tags = getCreatureFacetTags(creature);
        if (!filters.selectedTypes.every((type) => tags.includes(type))) return false;
      }
      return true;
    });
  }, [creatures, filters]);
  const railPage = page === "battle" ? "battle" : page === "home" ? "home" : "bestBuild";
  const shellThemeClass =
    page === "home" ? "home-active" : page === "battle" ? "battle-active" : "bestbuild-active";

  useEffect(() => {
    if (needsCreatureData && !creatureDataLoaded) {
      onRequireCreatureData();
    }
  }, [creatureDataLoaded, needsCreatureData, onRequireCreatureData]);

  return (
    <div className={`friendly-shell ${shellThemeClass}`}>
      <div className="friendly-backdrop" aria-hidden="true">
        <div className="friendly-backdrop-panorama" />
        <div className="friendly-backdrop-layer friendly-backdrop-a" />
        <div className="friendly-backdrop-layer friendly-backdrop-b" />
        <div className="friendly-backdrop-grid" />
      </div>

      {page === "home" ? (
        <button className="floating-advanced floating-advanced-right" type="button" onClick={() => onSwitchToAdvanced()}>
          Advanced
        </button>
      ) : null}
      <a
        className="advanced-discord-orb"
        href="https://discord.gg/WgYSkw6rag"
        target="_blank"
        rel="noreferrer"
        aria-label="Join Discord"
        title="Join Discord"
      >
        <img src="/discord-icon.svg" alt="" aria-hidden="true" />
      </a>

      <div className="friendly-shell-inner">
        {page !== "home" ? (
          <FriendlySectionRail
            activePage={railPage}
            onGoHome={() => setPage("home")}
            onGoBestBuild={() => setPage("bestBuildSelect")}
            onGoBattle={() => setPage("battle")}
          />
        ) : null}
        {page === "home" ? (
          <section className="friendly-home">
            <div className="friendly-home-copy">
              <span className="friendly-kicker">Sonaria Stat Lab</span>
              <h1>Choose the flow that matches how you actually play.</h1>
              <p>Pick a simple best-build flow or set up a direct head-to-head battle with a cleaner layout.</p>
            </div>
            <div className="friendly-home-grid">
              <button className="mode-card" type="button" onClick={() => setPage("bestBuildSelect")}>
                <span className="mode-card-badge">Mode 01</span>
                <strong>Find Best Build</strong>
                <p>Choose a creature, answer a few simple questions, and get 3 strong builds.</p>
              </button>
              <button className="mode-card mode-card-battle" type="button" onClick={() => setPage("battle")}>
                <span className="mode-card-badge">Mode 02</span>
                <strong>Who Wins?</strong>
                <p>Set up two creatures, load full builds on both sides, and compare the result with health bars and battle stats.</p>
              </button>
            </div>
          </section>
        ) : null}

        {page === "bestBuildSelect" ? (
          creatureDataLoaded ? (
            <FriendlyBestBuildSelection
              filters={filters}
              setFilters={setFilters}
              tierOptions={tierOptions}
              typeOptions={typeOptions}
              selectedCreatureName={selectedBestBuildCreature}
              selectedCreature={selectedBestBuildData}
              filteredCreatures={filteredCreatures}
              eligibleForAirRule={eligibleForAirRule}
              getCreatureIcon={getCreatureIcon}
              onSelectCreature={setSelectedBestBuildCreature}
              onContinue={() => {
                onNameAChange(selectedBestBuildCreature);
                setBestBuildStep(0);
                setPage("bestBuildWizard");
              }}
              onBack={() => setPage("home")}
            />
          ) : (
            <FriendlyFlowFallback />
          )
        ) : null}

        {page === "bestBuildWizard" || page === "bestBuildResult" ? (
          <Suspense fallback={<FriendlyFlowFallback />}>
            <LazyFriendlyBestBuildPageShell
              mode={page === "bestBuildWizard" ? "wizard" : "result"}
              creatures={creatures}
              selectedBestBuildCreature={selectedBestBuildCreature}
              selectedBestBuildData={selectedBestBuildData}
              answers={answers}
              setAnswers={setAnswers}
              bestBuildStep={bestBuildStep}
              setBestBuildStep={setBestBuildStep}
              eligibleForAirRule={eligibleForAirRule}
              tierOptions={tierOptions}
              getCreatureIcon={getCreatureIcon}
              onNameAChange={onNameAChange}
              onBuildAChange={onBuildAChange}
              onSwitchToAdvanced={onSwitchToAdvanced}
              onPageChange={setPage}
            />
          </Suspense>
        ) : null}

        {page === "battle" ? (
          <Suspense fallback={<FriendlyFlowFallback />}>
            <LazyFriendlyBattlePageShell
              nameA={nameA}
              nameB={nameB}
              buildA={buildA}
              buildB={buildB}
              creatureA={creatureA}
              creatureB={creatureB}
              creatures={creatures}
              getCreatureIcon={getCreatureIcon}
              onNameAChange={onNameAChange}
              onNameBChange={onNameBChange}
              onBuildAChange={onBuildAChange}
              onBuildBChange={onBuildBChange}
              onSwitchToAdvanced={onSwitchToAdvanced}
              onPageChange={setPage}
            />
          </Suspense>
        ) : null}
      </div>
    </div>
  );
}

function FriendlyFlowFallback() {
  return (
    <section className="friendly-panel friendly-panel-fallback">
      <div className="friendly-card friendly-card-fallback">Loading...</div>
    </section>
  );
}
