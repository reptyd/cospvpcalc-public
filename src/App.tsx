import { useEffect, useRef, useState } from "react";
import "./App.css";
import { AppPageRouter, type AppPage } from "./AppPageRouter";
import { BestBuildsBattleSettingsProvider } from "./components/bestBuilds/BestBuildsBattleSettingsContext";
import { DiagnosePanel } from "./components/DiagnosePanel";
import { AdSlot, AppFooter, AppHero } from "./AppShellSections";
import type { BuildOptions, CreatureRuntime } from "./engine";
import {
  normalizeCombatEventOrder,
  parseStoredCombatEventOrder,
  type CombatEventPhase,
} from "./engine/eventOrdering";
import { listCustomCreatureRecords, subscribeCustomCreatureRegistry, type CustomCreatureRecord } from "./engine/customCreatures";
import { subscribeVersionStale } from "./bootstrap/versionPoll";
import {
  MIRROR_URL,
  shouldOfferMirror,
  isMirrorNoticeDismissed,
  dismissMirrorNotice,
} from "./bootstrap/mirrorNotice";
import { safeReadLocalStorage, safeWriteLocalStorage } from "./shared/safeStorage";
import {
  getRustMatchupBridgeStatus,
  subscribeRustMatchupBridgeStatus,
  type RustMatchupBridgeStatus,
} from "./optimizer/rustMatchupLoader";
import {
  buildMatchSnapshotForActivePage,
  clearStashedImportedMatch,
  consumeInitialImportedMatch,
  encodeMatchSnapshot,
  setPendingImportedMatch,
  MATCH_SNAPSHOT_QUERY_PARAM,
  type MatchGlobalSettings,
  type MatchSnapshotV1,
} from "./shared/matchSnapshot";
import { captureDiagnosticSnapshot } from "./observability/diagnosticSnapshot";

type CreatureDataRuntime = {
  creaturesData: CreatureRuntime[];
  creatureByName: Record<string, CreatureRuntime>;
  creatureIcons: Record<string, string>;
  getCreatureByName: (name: string) => CreatureRuntime | undefined;
  getCreatureIcon: (name: string) => string | null;
};

const defaultBuild: BuildOptions = {
  venerationStage: 0,
  traits: [],
  ascensionAssignments: ["", "", "", "", ""],
  plushies: [],
  elder: "None",
};

const INTERNAL_DEV_CODE = "IDDQD";
let creatureDataPromise: Promise<CreatureDataRuntime> | null = null;
function loadCreatureData(): Promise<CreatureDataRuntime> {
  if (!creatureDataPromise) {
    creatureDataPromise = import("./engine/creatureData").then((module) => ({
      creaturesData: module.creaturesData,
      creatureByName: module.creatureByName,
      creatureIcons: module.creatureIcons,
      getCreatureByName: module.getCreatureByName,
      getCreatureIcon: module.getCreatureIcon,
    }));
  }
  return creatureDataPromise;
}

function App() {
  const storedDevMode = safeReadLocalStorage("cos.devMode") !== "0";
  const storedTrueRoundingMode = safeReadLocalStorage("cos.trueRoundingMode") === "1";
  const storedCombatEventOrder = parseStoredCombatEventOrder(
    safeReadLocalStorage("cos.combatEventOrder"),
  );
  const [page, setPage] = useState<AppPage>("compare");
  const [nameA, setNameA] = useState("");
  const [nameB, setNameB] = useState("");
  const [buildA, setBuildA] = useState<BuildOptions>(defaultBuild);
  const [buildB, setBuildB] = useState<BuildOptions>(defaultBuild);
  const [creaturesData, setCreaturesData] = useState<CreatureRuntime[]>([]);
  const [customCreatures, setCustomCreatures] = useState<CustomCreatureRecord[]>([]);
  const [creatureNames, setCreatureNames] = useState<string[]>([]);
  const [creatureLookup, setCreatureLookup] = useState<Record<string, CreatureRuntime>>({});
  const [creatureIcons, setCreatureIcons] = useState<Record<string, string>>({});
  const [lookupCreatureByName, setLookupCreatureByName] = useState<(name: string) => CreatureRuntime | undefined>(() => () => undefined);
  const [lookupCreatureIcon, setLookupCreatureIcon] = useState<(name: string) => string | null>(() => () => null);
  const [developerUnlocked, setDeveloperUnlocked] = useState(false);
  const [developerMode, setDeveloperMode] = useState(storedDevMode);
  const [trueRoundingMode, setTrueRoundingMode] = useState(storedTrueRoundingMode);
  const [combatEventOrder, setCombatEventOrderState] = useState<CombatEventPhase[]>(storedCombatEventOrder);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const keyBufferRef = useRef("");
  const trueDeveloperMode = developerUnlocked;
  const buildHash = (import.meta.env.VITE_BUILD_HASH ?? "local").toString();
  const [updateAvailable, setUpdateAvailable] = useState(false);
  // Mirror notice: only on the fragile `.ru` custom domain (host is
  // mount-constant, so resolve it once via lazy init).
  const [offerMirror] = useState(shouldOfferMirror);
  const [mirrorNoticeDismissed, setMirrorNoticeDismissed] = useState(isMirrorNoticeDismissed);
  const [bridgeStatus, setBridgeStatus] = useState<RustMatchupBridgeStatus>(
    getRustMatchupBridgeStatus(),
  );
  const [bridgeBannerDismissed, setBridgeBannerDismissed] = useState(false);
  // Imported-match (share-link) viewing. Consume the snapshot
  // synchronously during render so the localStorage-persist effects
  // below see imported mode on their very first mount run and skip
  // writing - otherwise that first persist clobbers the viewer's own
  // saved settings before the apply effect could flip a flag.
  const initialImportedRef = useRef<MatchSnapshotV1 | null | undefined>(undefined);
  if (initialImportedRef.current === undefined) {
    initialImportedRef.current = consumeInitialImportedMatch();
  }
  // eslint-disable-next-line react-hooks/refs -- initialImportedRef is mount-constant (consumeInitialImportedMatch is one-shot)
  const importedMatchModeRef = useRef(initialImportedRef.current !== null);
  // eslint-disable-next-line react-hooks/refs -- initialImportedRef is mount-constant (consumeInitialImportedMatch is one-shot)
  const [importedMatchMode] = useState(() => initialImportedRef.current !== null);

  useEffect(() => subscribeVersionStale(setUpdateAvailable), []);
  useEffect(() => subscribeRustMatchupBridgeStatus(setBridgeStatus), []);

  useEffect(() => {
    let cancelled = false;
    const applyLoadedCreatureData = (data: CreatureDataRuntime) => {
      const names = data.creaturesData.map((c) => c.name).sort((a, b) => a.localeCompare(b));
      setCreaturesData([...data.creaturesData]);
      setCustomCreatures(listCustomCreatureRecords());
      setCreatureNames(names);
      setCreatureLookup({ ...data.creatureByName });
      setCreatureIcons({ ...data.creatureIcons });
      setLookupCreatureByName(() => data.getCreatureByName);
      setLookupCreatureIcon(() => data.getCreatureIcon);
      setNameA((prev) => prev || names[0] || "");
      setNameB((prev) => prev || names[1] || names[0] || "");
    };
    void loadCreatureData()
      .then((data) => {
        if (cancelled) return;
        applyLoadedCreatureData(data);
      })
      .catch(() => {
        if (cancelled) return;
        setCreaturesData([]);
        setCreatureNames([]);
        setCreatureLookup({});
        setCreatureIcons({});
        setLookupCreatureByName(() => () => undefined);
        setLookupCreatureIcon(() => () => null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    return subscribeCustomCreatureRegistry(() => {
      void loadCreatureData().then((data) => {
        setCreaturesData([...data.creaturesData]);
        setCustomCreatures(listCustomCreatureRecords());
        setCreatureNames(data.creaturesData.map((c) => c.name).sort((a, b) => a.localeCompare(b)));
        setCreatureLookup({ ...data.creatureByName });
        setCreatureIcons({ ...data.creatureIcons });
      });
    });
  }, []);

  useEffect(() => {
    if (importedMatchModeRef.current) return;
    safeWriteLocalStorage("cos.devMode", developerMode ? "1" : "0");
  }, [developerMode]);

  useEffect(() => {
    if (importedMatchModeRef.current) return;
    safeWriteLocalStorage("cos.trueRoundingMode", trueRoundingMode ? "1" : "0");
  }, [trueRoundingMode]);

  useEffect(() => {
    if (importedMatchModeRef.current) return;
    safeWriteLocalStorage("cos.combatEventOrder", JSON.stringify(combatEventOrder));
  }, [combatEventOrder]);

  // Consume an imported match (share-link) once on mount: flag the
  // ref before any state set so the localStorage effects skip writes,
  // apply global settings, switch to the shared page. The page
  // provider applies its own state when it registers (see
  // setPendingImportedMatch). Custom participants are registered
  // ephemerally in main.tsx before App mounts.
  useEffect(() => {
    const imported = initialImportedRef.current;
    if (!imported) return;
    setDeveloperMode(imported.globalSettings.developerMode);
    setTrueRoundingMode(imported.globalSettings.trueRoundingMode);
    setCombatEventOrderState(normalizeCombatEventOrder(imported.globalSettings.combatEventOrder));
    setPage(imported.page);
    setPendingImportedMatch(imported);
    // Clear the reload-resilience stash once the boot is stable (past
    // staleChunkReload's ~5s window). If a reload fires before this, the
    // reloaded page re-reads the stash and re-applies, then reschedules
    // this timer. After a stable boot the stash is cleared so a later
    // manual refresh returns the viewer to their own state.
    const stashClearTimer = window.setTimeout(clearStashedImportedMatch, 10000);
    return () => window.clearTimeout(stashClearTimer);
  }, []);

  useEffect(() => {
    const codeToChar = (code: string): string | null => {
      if (/^Key[A-Z]$/.test(code)) return code.slice(3);
      if (/^Digit[0-9]$/.test(code)) return code.slice(5);
      return null;
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.altKey || event.metaKey) return;
      const nextChar = codeToChar(event.code) ?? (event.key && event.key.length === 1 ? event.key.toUpperCase() : null);
      if (!nextChar || !/[A-Z0-9]/.test(nextChar)) return;
      keyBufferRef.current = `${keyBufferRef.current}${nextChar}`.slice(-24);
      if (keyBufferRef.current.includes(INTERNAL_DEV_CODE)) {
        setDeveloperUnlocked(true);
        keyBufferRef.current = "";
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  void creatureLookup;
  void creatureIcons;
  const creatureA = lookupCreatureByName(nameA);
  const creatureB = lookupCreatureByName(nameB);
  const getCreatureIcon = (name: string): string | null => lookupCreatureIcon(name);
  const setCombatEventOrder = (order: CombatEventPhase[]) => {
    setCombatEventOrderState(normalizeCombatEventOrder(order));
  };

  // Clean shareable link - opens the exact matchup state, nothing else.
  const buildShareText = (): string => {
    const globalSettings: MatchGlobalSettings = {
      combatEventOrder,
      trueRoundingMode,
      developerMode,
    };
    const snapshot = buildMatchSnapshotForActivePage({
      page,
      globalSettings,
      customRecords: listCustomCreatureRecords(),
    });
    const code = encodeMatchSnapshot(snapshot);
    return `${window.location.origin}${window.location.pathname}?${MATCH_SNAPSHOT_QUERY_PARAM}=${encodeURIComponent(code)}`;
  };

  // Bug-report payload - the share link plus the diagnostic tech block
  // (build / WASM / bridge / errors) that can't be replayed from the link.
  const buildReportText = (): string =>
    `${buildShareText()}\n\n--- Diagnostic ---\n${captureDiagnosticSnapshot()}`;

  return (
    <BestBuildsBattleSettingsProvider>
    <div className="app">
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      {updateAvailable ? (
        <div className="app-update-banner" role="status" aria-live="polite">
          <span>A new version of the calculator is available.</span>
          <button
            type="button"
            className="app-update-banner__btn"
            onClick={() => {
              const url = new URL(window.location.href);
              url.searchParams.set("_v", String(Date.now()));
              window.location.replace(url.toString());
            }}
          >
            Reload
          </button>
        </div>
      ) : null}
      {bridgeStatus === "failed" && !bridgeBannerDismissed ? (
        <div className="app-update-banner" role="alert" aria-live="polite">
          <span>
            The Rust simulation engine couldn&apos;t load - using the JavaScript
            fallback. Some features may run slower or behave differently.
            Reloading sometimes fixes this.
          </span>
          <button
            type="button"
            className="app-update-banner__btn"
            onClick={() => setBridgeBannerDismissed(true)}
            aria-label="Dismiss bridge load warning"
          >
            Dismiss
          </button>
        </div>
      ) : null}
      {importedMatchMode ? (
        <div className="app-update-banner" role="status" aria-live="polite">
          <span>Viewing a shared match - your own settings and saved creatures are preserved.</span>
        </div>
      ) : null}
      {offerMirror && !mirrorNoticeDismissed ? (
        <div className="app-update-banner" role="status" aria-live="polite">
          <span>
            If this site ever fails to open, use our mirror:{" "}
            <a className="app-update-banner__link" href={MIRROR_URL}>
              cospvpcalc.pages.dev
            </a>
          </span>
          <button
            type="button"
            className="app-update-banner__btn"
            onClick={() => {
              dismissMirrorNotice();
              setMirrorNoticeDismissed(true);
            }}
            aria-label="Dismiss mirror notice"
          >
            Dismiss
          </button>
        </div>
      ) : null}
      {trueDeveloperMode ? <AdSlot position="top" /> : null}
      <AppHero
        page={page}
        setPage={setPage}
        onBuildShareText={buildShareText}
        onBuildReportText={buildReportText}
        settingsOpen={settingsOpen}
        setSettingsOpen={setSettingsOpen}
        developerMode={developerMode}
        setDeveloperMode={setDeveloperMode}
        trueRoundingMode={trueRoundingMode}
        setTrueRoundingMode={setTrueRoundingMode}
        combatEventOrder={combatEventOrder}
        setCombatEventOrder={setCombatEventOrder}
        trueDeveloperMode={trueDeveloperMode}
        buildHash={buildHash}
      />

      <main id="main-content">
      <AppPageRouter
        page={page}
        nameA={nameA}
        nameB={nameB}
        buildA={buildA}
        buildB={buildB}
        creatureA={creatureA}
        creatureB={creatureB}
        creatures={creaturesData}
        customCreatures={customCreatures}
        creatureNames={creatureNames}
        developerMode={developerMode}
        trueRoundingMode={trueRoundingMode}
        combatEventOrder={combatEventOrder}
        trueDeveloperMode={trueDeveloperMode}
        getCreatureIcon={getCreatureIcon}
        onNameAChange={setNameA}
        onNameBChange={setNameB}
        onBuildAChange={setBuildA}
        onBuildBChange={setBuildB}
      />
      </main>

      <AppFooter />
      {trueDeveloperMode ? <AdSlot position="bottom" /> : null}
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
      {/* Power-user diagnostic overlay. Renders nothing until triggered by
          `#diagnose` or Ctrl+Shift+D. */}
      <DiagnosePanel />
    </div>
    </BestBuildsBattleSettingsProvider>
  );
}

export default App;
