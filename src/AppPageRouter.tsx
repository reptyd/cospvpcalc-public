import { Suspense, lazy } from "react";
import type { BuildOptions, CreatureRuntime } from "./engine";
import type { CombatEventPhase } from "./engine/eventOrdering";
import type { CustomCreatureRecord } from "./engine/customCreatures";
import ComparePage from "./pages/ComparePage";

const LazyBestBuildsPage = lazy(() => import("./pages/BestBuildsPage"));
const LazyCustomPage = lazy(() => import("./pages/CustomPage"));
const LazyOptimizerPage = lazy(() => import("./pages/OptimizerPage"));
const LazySandboxPage = lazy(() => import("./pages/SandboxPage"));
const LazyReferencePage = lazy(() => import("./pages/ReferencePage"));
const LazySearchPage = lazy(() => import("./pages/SearchPage"));
const LazyCreditsPage = lazy(() => import("./pages/CreditsPage"));
const LazyContactPage = lazy(() => import("./pages/ContactPage"));
const LazyDonatePage = lazy(() => import("./pages/DonatePage"));

export type AppPage =
  | "compare"
  | "bestBuilds"
  | "optimizer"
  | "sandbox"
  | "custom"
  | "search"
  | "reference"
  | "credits"
  | "contact"
  | "donate";

type AppPageRouterProps = {
  page: AppPage;
  nameA: string;
  nameB: string;
  buildA: BuildOptions;
  buildB: BuildOptions;
  creatureA?: CreatureRuntime;
  creatureB?: CreatureRuntime;
  creatures: CreatureRuntime[];
  customCreatures: CustomCreatureRecord[];
  creatureNames: string[];
  developerMode: boolean;
  trueRoundingMode: boolean;
  combatEventOrder: CombatEventPhase[];
  trueDeveloperMode: boolean;
  getCreatureIcon: (name: string) => string | null;
  onNameAChange: (value: string) => void;
  onNameBChange: (value: string) => void;
  onBuildAChange: (build: BuildOptions) => void;
  onBuildBChange: (build: BuildOptions) => void;
};

function PageFallback() {
  return (
    <section className="panel">
      <div className="panel-block muted">Loading...</div>
    </section>
  );
}

export function AppPageRouter({
  page,
  nameA,
  nameB,
  buildA,
  buildB,
  creatureA,
  creatureB,
  creatures,
  customCreatures,
  creatureNames,
  developerMode,
  trueRoundingMode,
  combatEventOrder,
  trueDeveloperMode,
  getCreatureIcon,
  onNameAChange,
  onNameBChange,
  onBuildAChange,
  onBuildBChange,
}: AppPageRouterProps) {
  if (page === "compare") {
    return (
      <ComparePage
        nameA={nameA}
        nameB={nameB}
        buildA={buildA}
        buildB={buildB}
        creatureA={creatureA}
        creatureB={creatureB}
        creatureNames={creatureNames}
        developerMode={developerMode}
        trueDeveloperMode={trueDeveloperMode}
        trueRoundingMode={trueRoundingMode}
        combatEventOrder={combatEventOrder}
        getCreatureIcon={getCreatureIcon}
        onNameAChange={onNameAChange}
        onNameBChange={onNameBChange}
        onBuildAChange={onBuildAChange}
        onBuildBChange={onBuildBChange}
      />
    );
  }

  if (page === "bestBuilds") {
    return (
      <Suspense fallback={<PageFallback />}>
        <LazyBestBuildsPage
          nameA={nameA}
          creatures={creatures}
          creatureNames={creatureNames}
          trueDeveloperMode={trueDeveloperMode}
          combatEventOrder={combatEventOrder}
          onNameAChange={onNameAChange}
          onApplyBuildA={onBuildAChange}
        />
      </Suspense>
    );
  }

  if (page === "optimizer") {
    return (
      <Suspense fallback={<PageFallback />}>
        <LazyOptimizerPage
          nameA={nameA}
          nameB={nameB}
          buildA={buildA}
          creatureNames={creatureNames}
          developerMode={developerMode}
          combatEventOrder={combatEventOrder}
          onNameAChange={onNameAChange}
          onNameBChange={onNameBChange}
          onApplyBuildB={onBuildBChange}
        />
      </Suspense>
    );
  }

  if (page === "custom") {
    return (
      <Suspense fallback={<PageFallback />}>
        <LazyCustomPage
          creatureNames={creatureNames}
          customCreatures={customCreatures}
          getCreatureIcon={getCreatureIcon}
          onNameAChange={onNameAChange}
          onNameBChange={onNameBChange}
        />
      </Suspense>
    );
  }

  if (page === "sandbox") {
    return (
      <Suspense fallback={<PageFallback />}>
        <LazySandboxPage
          nameA={nameA}
          nameB={nameB}
          buildA={buildA}
          buildB={buildB}
          creatureA={creatureA}
          creatureB={creatureB}
          creatureNames={creatureNames}
          getCreatureIcon={getCreatureIcon}
          onNameAChange={onNameAChange}
          onNameBChange={onNameBChange}
          onBuildAChange={onBuildAChange}
          onBuildBChange={onBuildBChange}
        />
      </Suspense>
    );
  }

  if (page === "search") {
    return (
      <Suspense fallback={<PageFallback />}>
        <LazySearchPage
          getCreatureIcon={getCreatureIcon}
          onNameAChange={onNameAChange}
          onNameBChange={onNameBChange}
        />
      </Suspense>
    );
  }

  if (page === "reference") {
    return (
      <Suspense fallback={<PageFallback />}>
        <LazyReferencePage />
      </Suspense>
    );
  }

  if (page === "credits") {
    return (
      <Suspense fallback={<PageFallback />}>
        <LazyCreditsPage />
      </Suspense>
    );
  }

  if (page === "contact") {
    return (
      <Suspense fallback={<PageFallback />}>
        <LazyContactPage />
      </Suspense>
    );
  }

  return (
    <Suspense fallback={<PageFallback />}>
      <LazyDonatePage />
    </Suspense>
  );
}
