import { useState } from "react";
import type { AppPage } from "./AppPageRouter";
import { ToggleSwitch } from "./components/ToggleSwitch";
import { ShareMatchButton } from "./components/ShareMatchButton";
import {
  COMBAT_EVENT_PHASE_LABELS,
  FIXED_FIRST_COMBAT_EVENT_PHASE,
  RECOMMENDED_COMBAT_EVENT_ORDER,
  type CombatEventPhase,
} from "./engine/eventOrdering";

function CombatEventOrderControl({
  value,
  onChange,
}: {
  value: CombatEventPhase[];
  onChange: (next: CombatEventPhase[]) => void;
}) {
  const [selectedPhase, setSelectedPhase] = useState<CombatEventPhase | null>(null);
  const movable = value.filter((phase) => phase !== FIXED_FIRST_COMBAT_EVENT_PHASE);
  const ordered = [FIXED_FIRST_COMBAT_EVENT_PHASE, ...movable];

  const movePhaseTo = (phase: CombatEventPhase, targetPhase: CombatEventPhase) => {
    if (
      phase === targetPhase ||
      phase === FIXED_FIRST_COMBAT_EVENT_PHASE ||
      targetPhase === FIXED_FIRST_COMBAT_EVENT_PHASE
    ) {
      return;
    }
    const fromIndex = movable.indexOf(phase);
    const toIndex = movable.indexOf(targetPhase);
    if (fromIndex < 0 || toIndex < 0) return;
    const nextMovable = [...movable];
    const [removed] = nextMovable.splice(fromIndex, 1);
    nextMovable.splice(toIndex, 0, removed);
    onChange([FIXED_FIRST_COMBAT_EVENT_PHASE, ...nextMovable]);
  };

  const swapPhaseWithSelection = (phase: CombatEventPhase) => {
    if (phase === FIXED_FIRST_COMBAT_EVENT_PHASE) {
      setSelectedPhase(null);
      return;
    }
    if (!selectedPhase) {
      setSelectedPhase(phase);
      return;
    }
    if (selectedPhase === phase) {
      setSelectedPhase(null);
      return;
    }
    const selectedIndex = movable.indexOf(selectedPhase);
    const targetIndex = movable.indexOf(phase);
    if (selectedIndex >= 0 && targetIndex >= 0) {
      const nextMovable = [...movable];
      [nextMovable[selectedIndex], nextMovable[targetIndex]] = [
        nextMovable[targetIndex],
        nextMovable[selectedIndex],
      ];
      onChange([FIXED_FIRST_COMBAT_EVENT_PHASE, ...nextMovable]);
    }
    setSelectedPhase(null);
  };

  return (
    <div className="settings-order-control">
      <div className="settings-order-heading">
        <span>Same-time order</span>
        <button
          className="settings-order-reset"
          type="button"
          onClick={() => {
            setSelectedPhase(null);
            onChange([...RECOMMENDED_COMBAT_EVENT_ORDER]);
          }}
        >
          Recommended
        </button>
      </div>
      <div className="settings-order-strip">
        {ordered.map((phase, index) => (
          <button
            type="button"
            className={[
              "settings-order-chip",
              phase === FIXED_FIRST_COMBAT_EVENT_PHASE ? "fixed" : "",
              selectedPhase === phase ? "selected" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            draggable={phase !== FIXED_FIRST_COMBAT_EVENT_PHASE}
            onClick={() => swapPhaseWithSelection(phase)}
            onDragStart={(event) => {
              if (phase === FIXED_FIRST_COMBAT_EVENT_PHASE) return;
              event.dataTransfer.effectAllowed = "move";
              event.dataTransfer.setData("text/plain", phase);
            }}
            onDragOver={(event) => {
              if (phase !== FIXED_FIRST_COMBAT_EVENT_PHASE) event.preventDefault();
            }}
            onDrop={(event) => {
              event.preventDefault();
              movePhaseTo(event.dataTransfer.getData("text/plain") as CombatEventPhase, phase);
              setSelectedPhase(null);
            }}
            aria-pressed={selectedPhase === phase}
            key={phase}
          >
            <span className="settings-order-index">{index + 1}</span>
            <span className="settings-order-label">{COMBAT_EVENT_PHASE_LABELS[phase]}</span>
            {phase === FIXED_FIRST_COMBAT_EVENT_PHASE ? <span className="settings-order-fixed">Fixed</span> : null}
          </button>
        ))}
      </div>
    </div>
  );
}

export function AppHero({
  page,
  setPage,
  settingsOpen,
  setSettingsOpen,
  developerMode,
  setDeveloperMode,
  trueRoundingMode,
  setTrueRoundingMode,
  combatEventOrder,
  setCombatEventOrder,
  trueDeveloperMode,
  buildHash,
  onBuildShareText,
}: {
  page: AppPage;
  setPage: (page: AppPage) => void;
  settingsOpen: boolean;
  setSettingsOpen: (open: boolean | ((prev: boolean) => boolean)) => void;
  developerMode: boolean;
  setDeveloperMode: (enabled: boolean) => void;
  trueRoundingMode: boolean;
  setTrueRoundingMode: (enabled: boolean) => void;
  combatEventOrder: CombatEventPhase[];
  setCombatEventOrder: (order: CombatEventPhase[]) => void;
  trueDeveloperMode: boolean;
  buildHash: string;
  onBuildShareText: () => string;
}) {
  return (
    <header className="hero">
      <div className="hero-text">
        <h1>Sonaria Stat Lab{trueDeveloperMode ? ` #${buildHash}` : ""}</h1>
        <p>
          Disclaimer: This calculator is built around a strict 1v1 stand-and-fight model. It does not simulate
          movement, disengage, chasing, spacing, terrain, or running, so real PvP outcomes can differ from the results
          shown here. Within that stand-and-fight scope the model is complete; any mechanic not covered is
          intentionally out of scope and is not planned to be added. Like any large combat simulator, this one may
          still contain unknown bugs or edge cases.
        </p>
      </div>
      <div className="hero-actions">
        <nav className="tabs">
          <button className={page === "compare" ? "active" : ""} onClick={() => setPage("compare")}>
            Compare
          </button>
          <button className={page === "bestBuilds" ? "active" : ""} onClick={() => setPage("bestBuilds")}>
            Best Builds
          </button>
          <button className={page === "optimizer" ? "active" : ""} onClick={() => setPage("optimizer")}>
            Optimizer
          </button>
          <button className={page === "sandbox" ? "active" : ""} onClick={() => setPage("sandbox")}>
            Sandbox
          </button>
          <button className={page === "custom" ? "active" : ""} onClick={() => setPage("custom")}>
            Custom
          </button>
          <button className={page === "search" ? "active" : ""} onClick={() => setPage("search")}>
            Search
          </button>
          <button className={page === "reference" ? "active" : ""} onClick={() => setPage("reference")}>
            Reference
          </button>
          <button className={page === "credits" ? "active" : ""} onClick={() => setPage("credits")}>
            Credits
          </button>
          <button className={page === "contact" ? "active" : ""} onClick={() => setPage("contact")}>
            Contact
          </button>
          <button className={page === "donate" ? "active" : ""} onClick={() => setPage("donate")}>
            Donate
          </button>
        </nav>
        <div className="hero-action-row">
          <ShareMatchButton onBuildShareText={onBuildShareText} />
          <button className="settings-btn" type="button" onClick={() => setSettingsOpen((prev) => !prev)}>
            Settings
          </button>
        </div>
        {settingsOpen ? (
          <div className="settings-panel">
            <ToggleSwitch
              checked={developerMode}
              onChange={setDeveloperMode}
              label="Developer Mode"
              description="Shows advanced controls for optimizer and compare."
            />
            <ToggleSwitch
              checked={trueRoundingMode}
              onChange={setTrueRoundingMode}
              label="True Rounding Mode"
              description="Rounds final damage and final weight before compare simulation."
            />
            <CombatEventOrderControl value={combatEventOrder} onChange={setCombatEventOrder} />
            <div className="note">Internal mode: {trueDeveloperMode ? "active" : "locked"}.</div>
          </div>
        ) : null}
      </div>
    </header>
  );
}

export function AppFooter() {
  return (
    <footer className="site-footer">
      <div className="site-footer-inner">
        <span>(c) {new Date().getFullYear()} Sonaria Stat Lab</span>
        <a href="/privacy.html" target="_blank" rel="noreferrer">
          Privacy
        </a>
      </div>
    </footer>
  );
}

export function AdSlot({ position }: { position: "top" | "side" | "bottom" }) {
  return (
    <div className={`ad-slot ad-${position}`}>
      <div className="ad-title">Ad space</div>
      <div className="ad-subtitle">Placeholder ({position})</div>
    </div>
  );
}
