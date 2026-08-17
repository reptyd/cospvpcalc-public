// Bespoke beta "Custom" page - routed in place of CustomPage when the beta
// design is active (the beaten path: a dedicated *PageBeta component, not a CSS
// reskin of the classic page). Owns the beta chrome (segmented tab nav +
// Library menu); reuses the shared sub-views: a bespoke creatures editor
// (CustomCreaturesBeta) and the existing Abilities / Timings / Statuses panels
// (which already wrap CustomRegisteredList + the ce-* creation editors). The
// root class `.cpb` deliberately avoids `.custom-page`, so none of App.css's
// `.custom-page`-coupled blanket rules apply - this page is styled solely by
// customPageBeta.css.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Download, Upload, Link2, X } from "lucide-react";
import { BooksStackIcon } from "../components/beta/customIcons";
import CustomCreaturesBeta from "./CustomCreaturesBeta";
import CustomAbilitiesPanel from "../components/custom/CustomAbilitiesPanel";
import CustomTimingsPanel from "../components/custom/CustomTimingsPanel";
import CustomStatusesPanel from "../components/custom/CustomStatusesPanel";
import {
  encodeBundleAsUrlHash,
  exportCustomLibraryBundleJson,
  importCustomLibraryBundleJson,
  listCustomLibraryBundleImportConflictsJson,
  type ImportConflictSummary,
  type ImportResult,
} from "../shared/customLibraryBundle";
import type { CustomCreatureRecord } from "../engine/customCreatures";
import "../components/beta/betaSelect.css";
import "./compareBeta.css";
import "./customPageBeta.css";

type CustomSubPage = "creatures" | "abilities" | "timings" | "statuses";

type Props = {
  creatureNames: string[];
  customCreatures: CustomCreatureRecord[];
  getCreatureIcon: (name: string) => string | null;
  onNameAChange: (name: string) => void;
  onNameBChange: (name: string) => void;
};

const SUB_TAB_STORAGE_KEY = "cos.customSubPage";

const SUB_TABS: ReadonlyArray<{ key: CustomSubPage; label: string }> = [
  { key: "creatures", label: "Creatures" },
  { key: "abilities", label: "Abilities" },
  { key: "timings", label: "Timings" },
  { key: "statuses", label: "Statuses" },
];

function readSubPage(): CustomSubPage {
  if (typeof window === "undefined") return "creatures";
  try {
    const stored = window.localStorage.getItem(SUB_TAB_STORAGE_KEY);
    if (stored === "creatures" || stored === "abilities" || stored === "timings" || stored === "statuses") {
      return stored;
    }
  } catch {
    // private mode etc - fall through
  }
  return "creatures";
}

function writeSubPage(value: CustomSubPage): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SUB_TAB_STORAGE_KEY, value);
  } catch {
    // no-op
  }
}

export default function CustomPageBeta({
  creatureNames,
  customCreatures,
  getCreatureIcon,
  onNameAChange,
  onNameBChange,
}: Props): ReactNode {
  const [subPage, setSubPage] = useState<CustomSubPage>(readSubPage);
  const [importStatus, setImportStatus] = useState<string | null>(null);

  useEffect(() => {
    writeSubPage(subPage);
  }, [subPage]);

  const onExport = () => {
    const json = exportCustomLibraryBundleJson();
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    link.download = `cos-calc-custom-library-${ts}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const onCopyShareLink = async () => {
    const hash = encodeBundleAsUrlHash();
    const url = `${window.location.origin}${window.location.pathname}#${hash}`;
    try {
      await navigator.clipboard.writeText(url);
      setImportStatus("Share link copied to clipboard.");
    } catch {
      window.prompt("Copy this link:", url);
    }
  };

  const onImport = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json,.json";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      const text = await file.text();
      try {
        const conflicts = listCustomLibraryBundleImportConflictsJson(text);
        const replaceConflicts =
          countImportConflicts(conflicts) > 0 ? window.confirm(formatImportConflictPrompt(conflicts)) : false;
        const result: ImportResult = await importCustomLibraryBundleJson(text, {
          replaceAbilityConflicts: replaceConflicts,
          replaceTimingConflicts: replaceConflicts,
          replaceCreatureConflicts: replaceConflicts,
        });
        const summary = [
          `abilities: ${result.abilities.imported} imported, ${result.abilities.skipped} skipped`,
          `timings: ${result.timings.imported} imported, ${result.timings.skipped} skipped`,
          `creatures: ${result.creatures.imported} imported, ${result.creatures.skipped} skipped`,
        ].join(" · ");
        setImportStatus(`Imported. ${summary}`);
      } catch (err) {
        setImportStatus(`Import failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    };
    input.click();
  };

  return (
    <div className="cpb">
      <header className="cpb-head">
        <div className="cpb-head__intro">
          <h2 className="cpb-head__title">Custom library</h2>
          <p className="cpb-head__sub">Build creatures, abilities, timings &amp; statuses — saved in this browser.</p>
        </div>
        <LibraryMenu onExport={onExport} onImport={onImport} onCopyShareLink={() => void onCopyShareLink()} />
      </header>

      <nav className="cpb-tabs" role="tablist" aria-label="Custom library sections">
        {SUB_TABS.map((tab) => (
          <button
            key={tab.key}
            role="tab"
            type="button"
            aria-selected={subPage === tab.key}
            className={subPage === tab.key ? "cpb-tab is-active" : "cpb-tab"}
            onClick={() => setSubPage(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      {importStatus ? (
        <div className="cpb-banner" role="status" aria-live="polite">
          <span>{importStatus}</span>
          <button type="button" className="cpb-banner__dismiss" onClick={() => setImportStatus(null)} aria-label="Dismiss">
            <X size={14} strokeWidth={2.4} aria-hidden="true" />
          </button>
        </div>
      ) : null}

      {subPage === "creatures" ? (
        <CustomCreaturesBeta
          creatureNames={creatureNames}
          customCreatures={customCreatures}
          getCreatureIcon={getCreatureIcon}
          onNameAChange={onNameAChange}
          onNameBChange={onNameBChange}
        />
      ) : null}
      {subPage === "abilities" ? <CustomAbilitiesPanel /> : null}
      {subPage === "timings" ? <CustomTimingsPanel /> : null}
      {subPage === "statuses" ? <CustomStatusesPanel /> : null}
    </div>
  );
}

function countImportConflicts(conflicts: ImportConflictSummary): number {
  return conflicts.abilities.length + conflicts.timings.length + conflicts.creatures.length;
}

function formatImportConflictPrompt(conflicts: ImportConflictSummary): string {
  const lines = [
    "This bundle contains records already in your custom library:",
    ...formatConflictGroup("Abilities", conflicts.abilities),
    ...formatConflictGroup("Timings", conflicts.timings),
    ...formatConflictGroup("Creatures", conflicts.creatures),
    "",
    "Replace matching records?",
    "OK = replace matching records. Cancel = keep yours and skip matching records.",
  ];
  return lines.join("\n");
}

function formatConflictGroup(label: string, conflicts: string[]): string[] {
  if (conflicts.length === 0) return [];
  const visible = conflicts.slice(0, 8);
  const extra = conflicts.length - visible.length;
  return [`${label}: ${visible.join(", ")}${extra > 0 ? `, and ${extra} more` : ""}`];
}

// Library dropdown (Export / Import / Share). Self-contained beta dropdown - a
// trigger button + an anchored menu that closes on outside-click / Escape.
function LibraryMenu({
  onExport,
  onImport,
  onCopyShareLink,
}: {
  onExport: () => void;
  onImport: () => void;
  onCopyShareLink: () => void;
}): ReactNode {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onClick = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("click", onClick);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("click", onClick);
    };
  }, [open]);
  const handle = (fn: () => void) => () => {
    fn();
    setOpen(false);
  };
  return (
    <div className="cpb-library" ref={ref}>
      <button
        type="button"
        className="cpb-library__trigger"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <BooksStackIcon size={16} strokeWidth={2} aria-hidden="true" />
        Library
      </button>
      {open ? (
        <div className="cpb-library__menu" role="menu">
          <button type="button" role="menuitem" onClick={handle(onExport)}>
            <span className="cpb-library__icon"><Download size={15} strokeWidth={2} aria-hidden="true" /></span>
            <span className="cpb-library__text">
              <span className="cpb-library__label">Export bundle</span>
              <span className="cpb-library__hint">Download a JSON of every custom creature, ability &amp; timing.</span>
            </span>
          </button>
          <button type="button" role="menuitem" onClick={handle(onImport)}>
            <span className="cpb-library__icon"><Upload size={15} strokeWidth={2} aria-hidden="true" /></span>
            <span className="cpb-library__text">
              <span className="cpb-library__label">Import bundle</span>
              <span className="cpb-library__hint">Add records from a JSON file without removing yours.</span>
            </span>
          </button>
          <button type="button" role="menuitem" onClick={handle(onCopyShareLink)}>
            <span className="cpb-library__icon"><Link2 size={15} strokeWidth={2} aria-hidden="true" /></span>
            <span className="cpb-library__text">
              <span className="cpb-library__label">Copy share link</span>
              <span className="cpb-library__hint">A URL that adds this library when opened.</span>
            </span>
          </button>
        </div>
      ) : null}
    </div>
  );
}
