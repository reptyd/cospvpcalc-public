import { useEffect, useState, type ReactNode } from "react";
import CustomCreaturesPage from "./CustomCreaturesPage";
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

export type CustomSubPage = "creatures" | "abilities" | "timings" | "statuses";

type Props = {
  creatureNames: string[];
  customCreatures: CustomCreatureRecord[];
  getCreatureIcon: (name: string) => string | null;
  onNameAChange: (name: string) => void;
  onNameBChange: (name: string) => void;
};

const SUB_TAB_STORAGE_KEY = "cos.customSubPage";

function readSubPage(): CustomSubPage {
  if (typeof window === "undefined") return "creatures";
  try {
    const stored = window.localStorage.getItem(SUB_TAB_STORAGE_KEY);
    if (
      stored === "creatures" ||
      stored === "abilities" ||
      stored === "timings" ||
      stored === "statuses"
    ) {
      return stored;
    }
  } catch {
    // private mode etc - fall through to default
  }
  return "creatures";
}

function writeSubPage(value: CustomSubPage): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SUB_TAB_STORAGE_KEY, value);
  } catch {
    // no-op - same fall-through as readSubPage
  }
}

export default function CustomPage({
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
      // Fallback: show in a prompt-textarea for manual copy.
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
          countImportConflicts(conflicts) > 0
            ? window.confirm(formatImportConflictPrompt(conflicts))
            : false;
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
        setImportStatus(
          `Import failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    };
    input.click();
  };

  return (
    <div className="custom-page">
      <div className="custom-page-header">
        <div className="custom-page-tabs tabs" role="tablist" aria-label="Custom library">
          <button
            role="tab"
            aria-selected={subPage === "creatures"}
            className={subPage === "creatures" ? "active" : ""}
            onClick={() => setSubPage("creatures")}
          >
            Creatures
          </button>
          <button
            role="tab"
            aria-selected={subPage === "abilities"}
            className={subPage === "abilities" ? "active" : ""}
            onClick={() => setSubPage("abilities")}
          >
            Abilities
          </button>
          <button
            role="tab"
            aria-selected={subPage === "timings"}
            className={subPage === "timings" ? "active" : ""}
            onClick={() => setSubPage("timings")}
          >
            Timings
          </button>
          <button
            role="tab"
            aria-selected={subPage === "statuses"}
            className={subPage === "statuses" ? "active" : ""}
            onClick={() => setSubPage("statuses")}
          >
            Statuses
          </button>
        </div>
        <BundleActionsMenu
          onExport={onExport}
          onImport={onImport}
          onCopyShareLink={() => void onCopyShareLink()}
        />
      </div>
      {importStatus ? (
        <div className="custom-page-bundle-status muted" role="status" aria-live="polite">
          {importStatus}
          <button
            type="button"
            className="bundle-status-dismiss"
            onClick={() => setImportStatus(null)}
            aria-label="Dismiss"
          >
            ✕
          </button>
        </div>
      ) : null}

      {subPage === "creatures" ? (
        <CustomCreaturesPage
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
  return [
    `${label}: ${visible.join(", ")}${extra > 0 ? `, and ${extra} more` : ""}`,
  ];
}

function BundleActionsMenu({
  onExport,
  onImport,
  onCopyShareLink,
}: {
  onExport: () => void;
  onImport: () => void;
  onCopyShareLink: () => void;
}): ReactNode {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target?.closest(".bundle-actions-menu-wrapper")) setOpen(false);
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
    <div className="bundle-actions-menu-wrapper">
      <button
        type="button"
        className="bundle-actions-toggle"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Library actions: export / import / share"
      >
        Library ▾
      </button>
      {open ? (
        <div className="bundle-actions-menu" role="menu">
          <button type="button" role="menuitem" onClick={handle(onExport)}>
            <span className="bundle-actions-icon">⬇</span>
            <span>
              <span className="bundle-actions-label">Export bundle</span>
              <span className="bundle-actions-hint">
                Download a JSON of every custom creature, ability, and timing.
              </span>
            </span>
          </button>
          <button type="button" role="menuitem" onClick={handle(onImport)}>
            <span className="bundle-actions-icon">⬆</span>
            <span>
              <span className="bundle-actions-label">Import bundle</span>
              <span className="bundle-actions-hint">
                Add records from a JSON file without removing your current library.
              </span>
            </span>
          </button>
          <button type="button" role="menuitem" onClick={handle(onCopyShareLink)}>
            <span className="bundle-actions-icon">🔗</span>
            <span>
              <span className="bundle-actions-label">Copy share link</span>
              <span className="bundle-actions-hint">
                A URL that adds this library when opened.
              </span>
            </span>
          </button>
        </div>
      ) : null}
    </div>
  );
}
