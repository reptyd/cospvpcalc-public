import { Suspense, lazy } from "react";
import type { BuildOptions, CreatureRuntime } from "./engine";
import type { CombatEventPhase } from "./engine/eventOrdering";
import type { CustomCreatureRecord } from "./engine/customCreatures";

// Classic Compare. Lazy like every other page: a STATIC import here dragged the
// whole compare engine + optimizer runtime + both ~1.2 MB catalogs into the
// boot bundle for ALL users (the module-level import is evaluated regardless of
// which design branch actually renders), which was the dominant boot cost.
const LazyComparePage = lazy(() => import("./pages/ComparePage"));
// Bespoke beta Compare ("Fight Playback"). Only rendered inside the beta
// shell; lazy so it never ships to the default bundle.
const LazyComparePageBeta = lazy(() => import("./pages/ComparePageBeta"));
const LazyBestBuildsPage = lazy(() => import("./pages/BestBuildsPage"));
// Bespoke beta Best Builds ("Best build finder"). Only inside the beta shell;
// lazy so it stays out of the default bundle.
const LazyBestBuildsPageBeta = lazy(() => import("./pages/BestBuildsPageBeta"));
// Speed Builds. No fight is simulated here - it ranks movement stats - so it
// shares nothing with the Best Builds runtime beyond the build shape.
const LazySpeedBuildsPage = lazy(() => import("./pages/SpeedBuildsPage"));
// Bespoke beta Speed Builds. Only inside the beta shell; lazy so it stays out
// of the default bundle.
const LazySpeedBuildsPageBeta = lazy(() => import("./pages/SpeedBuildsPageBeta"));
const LazyCustomPage = lazy(() => import("./pages/CustomPage"));
// Bespoke beta Custom library. Only inside the beta shell; lazy so it stays out
// of the default bundle.
const LazyCustomPageBeta = lazy(() => import("./pages/CustomPageBeta"));
const LazyOptimizerPage = lazy(() => import("./pages/OptimizerPage"));
// Bespoke beta Optimizer ("Counter recommendation"). Only inside the beta
// shell; lazy so it stays out of the default bundle.
const LazyOptimizerPageBeta = lazy(() => import("./pages/OptimizerPageBeta"));
const LazySandboxPage = lazy(() => import("./pages/SandboxPage"));
// Bespoke beta Sandbox ("Combat Lab"). Only inside the beta shell; lazy so it
// stays out of the default bundle.
const LazySandboxPageBeta = lazy(() => import("./pages/SandboxPageBeta"));
const LazyReferencePage = lazy(() => import("./pages/ReferencePage"));
// Bespoke beta Reference ("Combat Reference" knowledge-base). Only inside the
// beta shell; lazy so it stays out of the default bundle.
const LazyReferencePageBeta = lazy(() => import("./pages/ReferencePageBeta"));
const LazySearchPage = lazy(() => import("./pages/SearchPage"));
// Bespoke beta Search ("Browse and inspect the creature roster"). Only inside
// the beta shell; lazy so it stays out of the default bundle.
const LazySearchPageBeta = lazy(() => import("./pages/SearchPageBeta"));
const LazyCreditsPage = lazy(() => import("./pages/CreditsPage"));
const LazyContactPage = lazy(() => import("./pages/ContactPage"));
const LazyDonatePage = lazy(() => import("./pages/DonatePage"));
// Bespoke beta info pages (Credits / Contact / Donate "spotlight cards"). Only
// inside the beta shell; lazy so they stay out of the default bundle.
const LazyCreditsPageBeta = lazy(() => import("./pages/CreditsPageBeta"));
const LazyContactPageBeta = lazy(() => import("./pages/ContactPageBeta"));
const LazyDonatePageBeta = lazy(() => import("./pages/DonatePageBeta"));

export type AppPage =
  | "compare"
  | "bestBuilds"
  | "speedBuilds"
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
  // When true (site beta design active), the Compare tab renders the bespoke
  // Fight Playback page instead of the classic Compare layout.
  compareDesignBeta: boolean;
  // Viewing a shared matchup link: the Compare page must not hydrate or persist
  // the local session in this mode (the share's own state is authoritative).
  importedMatchMode: boolean;
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
  compareDesignBeta,
  importedMatchMode,
  getCreatureIcon,
  onNameAChange,
  onNameBChange,
  onBuildAChange,
  onBuildBChange,
}: AppPageRouterProps) {
  if (page === "compare") {
    const compareProps = {
      nameA, nameB, buildA, buildB, creatureA, creatureB, creatureNames,
      developerMode, trueDeveloperMode, trueRoundingMode, combatEventOrder,
      importedMatchMode,
      getCreatureIcon, onNameAChange, onNameBChange, onBuildAChange, onBuildBChange,
    };
    return (
      <Suspense fallback={<PageFallback />}>
        {compareDesignBeta
          ? <LazyComparePageBeta {...compareProps} />
          : <LazyComparePage {...compareProps} />}
      </Suspense>
    );
  }

  if (page === "bestBuilds") {
    const bestBuildsProps = {
      nameA, creatures, creatureNames, trueDeveloperMode, combatEventOrder,
      onNameAChange, onApplyBuildA: onBuildAChange,
      // Beta-only: apply a found build to Compare B (sets nameB + buildB). The
      // default page ignores these; spreading extra props is harmless in JSX.
      onNameBChange, onApplyBuildB: onBuildBChange,
    };
    return (
      <Suspense fallback={<PageFallback />}>
        {compareDesignBeta
          ? <LazyBestBuildsPageBeta {...bestBuildsProps} />
          : <LazyBestBuildsPage {...bestBuildsProps} />}
      </Suspense>
    );
  }

  if (page === "speedBuilds") {
    const speedBuildsProps = { nameA, creatureNames, getCreatureIcon, onNameAChange };
    return (
      <Suspense fallback={<PageFallback />}>
        {compareDesignBeta
          ? <LazySpeedBuildsPageBeta {...speedBuildsProps} />
          : <LazySpeedBuildsPage {...speedBuildsProps} />}
      </Suspense>
    );
  }

  if (page === "optimizer") {
    const optimizerProps = {
      nameA, nameB, buildA, creatureNames, developerMode, combatEventOrder,
      onNameAChange, onNameBChange, onApplyBuildB: onBuildBChange,
      // Beta-only: apply the optimized build to Compare A (sets nameA + buildA).
      onApplyBuildA: onBuildAChange,
    };
    return (
      <Suspense fallback={<PageFallback />}>
        {compareDesignBeta
          ? <LazyOptimizerPageBeta {...optimizerProps} />
          : <LazyOptimizerPage {...optimizerProps} />}
      </Suspense>
    );
  }

  if (page === "custom") {
    const customProps = {
      creatureNames,
      customCreatures,
      getCreatureIcon,
      onNameAChange,
      onNameBChange,
    };
    return (
      <Suspense fallback={<PageFallback />}>
        {compareDesignBeta ? <LazyCustomPageBeta {...customProps} /> : <LazyCustomPage {...customProps} />}
      </Suspense>
    );
  }

  if (page === "sandbox") {
    const sandboxProps = {
      nameA, nameB, buildA, buildB, creatureA, creatureB, creatureNames,
      getCreatureIcon, onNameAChange, onNameBChange, onBuildAChange, onBuildBChange,
    };
    return (
      <Suspense fallback={<PageFallback />}>
        {compareDesignBeta
          ? <LazySandboxPageBeta {...sandboxProps} />
          : <LazySandboxPage {...sandboxProps} />}
      </Suspense>
    );
  }

  if (page === "search") {
    const searchProps = {
      getCreatureIcon,
      onNameAChange,
      onNameBChange,
    };
    return (
      <Suspense fallback={<PageFallback />}>
        {compareDesignBeta
          ? <LazySearchPageBeta {...searchProps} />
          : <LazySearchPage {...searchProps} />}
      </Suspense>
    );
  }

  if (page === "reference") {
    return (
      <Suspense fallback={<PageFallback />}>
        {compareDesignBeta ? <LazyReferencePageBeta /> : <LazyReferencePage />}
      </Suspense>
    );
  }

  if (page === "credits") {
    return (
      <Suspense fallback={<PageFallback />}>
        {compareDesignBeta ? <LazyCreditsPageBeta /> : <LazyCreditsPage />}
      </Suspense>
    );
  }

  if (page === "contact") {
    return (
      <Suspense fallback={<PageFallback />}>
        {compareDesignBeta ? <LazyContactPageBeta /> : <LazyContactPage />}
      </Suspense>
    );
  }

  return (
    <Suspense fallback={<PageFallback />}>
      {compareDesignBeta ? <LazyDonatePageBeta /> : <LazyDonatePage />}
    </Suspense>
  );
}
