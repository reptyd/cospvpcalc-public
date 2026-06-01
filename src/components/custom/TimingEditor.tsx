import { useEffect, useMemo, useState, type ReactNode } from "react";
import { parseTiming, printTiming, type ParseResult } from "../../shared/timingDsl";
import {
  validateUserTiming,
  type ValidationResult,
} from "../../shared/customAbilityValidate";
import { registerCustomTimingRecord } from "../../shared/customTimings";
import type { UserTimingSpec } from "../../shared/customAbilityTypes";
import { useHistory } from "../../shared/useHistory";
import { PseudocodeDocs } from "./PseudocodeDocs";
import { TimingVisualEditor } from "./TimingVisualEditor";
import { TIMING_TEMPLATES } from "../../shared/customTimingTemplates";

/**
 * Code-first timing editor — paste / write a UserTimingSpec in
 * the textual DSL, save when valid. Mirrors AbilityEditor.
 */
export function TimingEditor({
  initialSpec,
  onSaved,
  onCancel,
  mode,
}: {
  initialSpec: UserTimingSpec;
  onSaved: (spec: UserTimingSpec) => void;
  onCancel: () => void;
  mode: "create" | "edit";
}): ReactNode {
  const initialText = useMemo(() => printTiming(initialSpec), [initialSpec]);
  const [text, setText, history] = useHistory<string>(initialText);
  const [savingState, setSavingState] = useState<SavingState>({ status: "idle" });
  const [docsOpen, setDocsOpen] = useState(false);
  const [viewMode, setViewMode] = useState<"code" | "visual">("visual");

  const parsed: ParseResult = useMemo(() => parseTiming(text), [text]);
  const currentSpec = parsed.ok ? parsed.spec : null;
  const validation: ValidationResult | null = currentSpec
    ? validateUserTiming(currentSpec)
    : null;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.isContentEditable) return;
      const meta = e.ctrlKey || e.metaKey;
      if (!meta) return;
      const key = e.key.toLowerCase();
      if (key === "z" && !e.shiftKey) {
        e.preventDefault();
        history.undo();
      } else if (key === "y" || (key === "z" && e.shiftKey)) {
        e.preventDefault();
        history.redo();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [history]);

  const canSave =
    !!currentSpec && !!validation?.ok && savingState.status !== "saving";

  const handleSave = async () => {
    if (!currentSpec || !validation?.ok) return;
    setSavingState({ status: "saving" });
    const outcome = await registerCustomTimingRecord(currentSpec);
    if (outcome.status === "ok") {
      setSavingState({ status: "saved" });
      onSaved(currentSpec);
    } else {
      setSavingState({ status: "error", errors: outcome.errors });
    }
  };

  const insertTemplate = (tplId: string) => {
    const tpl = TIMING_TEMPLATES.find((t) => t.id === tplId);
    if (!tpl) return;
    if (
      !window.confirm(
        `Replace the current timing with "${tpl.name}"? This drops your current text.`,
      )
    )
      return;
    const current = parsed.ok ? parsed.spec : initialSpec;
    const built = tpl.build({
      id: current.id || "user.",
      display_name: current.display_name || tpl.name,
    });
    setText(printTiming(built));
  };

  return (
    <div className="ce timing-code-editor">
      <header className="ce-header">
        <div className="ce-title">
          {mode === "create" ? "New timing" : `Edit ${initialSpec.display_name}`}
        </div>
        <div className="ce-actions">
          <div className="ce-viewmode" role="tablist">
            <button
              role="tab"
              type="button"
              className={`ce-viewmode-tab ${viewMode === "code" ? "is-active" : ""}`}
              onClick={() => setViewMode("code")}
              aria-selected={viewMode === "code"}
            >
              Code
            </button>
            <button
              role="tab"
              type="button"
              className={`ce-viewmode-tab ${viewMode === "visual" ? "is-active" : ""}`}
              onClick={() => setViewMode("visual")}
              aria-selected={viewMode === "visual"}
              disabled={!parsed.ok}
              title={parsed.ok ? "Visual constructor" : "Visual mode disabled while there's a parse error — fix the code first"}
            >
              Visual
            </button>
          </div>
          <button
            className="ce-btn ce-btn-ghost"
            onClick={history.undo}
            disabled={!history.canUndo}
            title="Undo (Ctrl/Cmd+Z)"
          >
            ↶
          </button>
          <button
            className="ce-btn ce-btn-ghost"
            onClick={history.redo}
            disabled={!history.canRedo}
            title="Redo"
          >
            ↷
          </button>
          <TimingTemplatesDropdown onPick={insertTemplate} />
          <button
            className="ce-btn ce-btn-ghost"
            onClick={() => setDocsOpen(true)}
            title="Open pseudocode reference"
          >
            ? Docs
          </button>
          <button className="ce-btn ce-btn-ghost" onClick={onCancel}>
            Cancel
          </button>
          <button
            className="ce-btn ce-btn-primary"
            onClick={() => void handleSave()}
            disabled={!canSave}
            title={
              !currentSpec
                ? "Fix the parse error to enable saving"
                : validation && !validation.ok
                  ? `Fix ${validation.errors.length} validation error(s) — ${validation.errors[0]}`
                  : savingState.status === "saving"
                    ? "Saving…"
                    : mode === "create"
                      ? "Register this timing into your library"
                      : "Save changes"
            }
          >
            {savingState.status === "saving"
              ? "Saving…"
              : mode === "create"
                ? "+ Add to library"
                : "Save changes"}
          </button>
        </div>
      </header>
      {!parsed.ok || (validation && !validation.ok) ? (
        <div className="ce-cant-save-banner">
          {!parsed.ok ? (
            <span>
              <strong>Can't add yet —</strong> parse error on line{" "}
              {parsed.line ?? "?"}: <code>{parsed.error}</code>
            </span>
          ) : validation && !validation.ok ? (
            <span>
              <strong>Can't add yet —</strong> {validation.errors.join("; ")}
            </span>
          ) : null}
        </div>
      ) : null}

      <div className="ce-body">
        <div className="ce-pane ce-pane-text">
          <div className="ce-pane-header">
            <span className="ce-pane-label">{viewMode === "code" ? "Code" : "Visual"}</span>
            {parsed.ok ? (
              <span className="ce-status ok">parsed</span>
            ) : (
              <span className="ce-status err">
                parse error{parsed.line ? ` · line ${parsed.line}` : ""}: {parsed.error}
              </span>
            )}
          </div>
          {viewMode === "code" ? (
            <textarea
              className="ce-textarea"
              value={text}
              onChange={(e) => setText(e.target.value)}
              spellCheck={false}
              wrap="off"
            />
          ) : currentSpec ? (
            <div className="ce-visual-pane">
              <TimingVisualEditor
                spec={currentSpec}
                onChange={(next) => setText(printTiming(next))}
              />
            </div>
          ) : (
            <div className="ce-visual-blocked">
              <p>
                Visual mode needs a parseable spec. Switch to{" "}
                <button
                  type="button"
                  className="ce-btn ce-btn-link"
                  onClick={() => setViewMode("code")}
                >
                  Code
                </button>{" "}
                and fix the parse error first.
              </p>
            </div>
          )}
          <div className="ce-pane-footer">
            <button
              type="button"
              className="ce-btn ce-btn-link"
              onClick={() => setDocsOpen(true)}
            >
              Open full pseudocode reference →
            </button>
          </div>
        </div>

        <aside className="ce-pane ce-pane-side">
          <div className="ce-card">
            <div className="ce-card-header">Summary</div>
            {currentSpec ? (
              <dl className="ce-summary">
                <div>
                  <dt>id</dt>
                  <dd>
                    <code>{currentSpec.id || "—"}</code>
                  </dd>
                </div>
                <div>
                  <dt>name</dt>
                  <dd>{currentSpec.display_name || "—"}</dd>
                </div>
                <div>
                  <dt>candidates</dt>
                  <dd>{currentSpec.candidates.length} entries</dd>
                </div>
                <div>
                  <dt>horizon</dt>
                  <dd>{currentSpec.horizon_sec}s</dd>
                </div>
                {currentSpec.threshold !== undefined ? (
                  <div>
                    <dt>threshold</dt>
                    <dd>{currentSpec.threshold}</dd>
                  </div>
                ) : null}
                {currentSpec.force_skip ? (
                  <div>
                    <dt>force_skip</dt>
                    <dd>(set)</dd>
                  </div>
                ) : null}
                {currentSpec.force_fire ? (
                  <div>
                    <dt>force_fire</dt>
                    <dd>(set)</dd>
                  </div>
                ) : null}
              </dl>
            ) : (
              <div className="ce-muted">Fix the parse error to see structure.</div>
            )}
          </div>

          {validation && !validation.ok ? (
            <div className="ce-card ce-card-error">
              <div className="ce-card-header">
                ⚠ {validation.errors.length} validation error(s)
              </div>
              <ul className="ce-error-list">
                {validation.errors.map((err, i) => (
                  <li key={i}>{err}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {savingState.status === "error" ? (
            <div className="ce-card ce-card-error">
              <div className="ce-card-header">Save failed</div>
              <ul className="ce-error-list">
                {savingState.errors.map((err, i) => (
                  <li key={i}>{err}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </aside>
      </div>
      {docsOpen ? <PseudocodeDocs onClose={() => setDocsOpen(false)} /> : null}
    </div>
  );
}

function TimingTemplatesDropdown({ onPick }: { onPick: (id: string) => void }): ReactNode {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target?.closest(".ce-templates-wrapper")) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("click", onClick);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("click", onClick);
    };
  }, [open]);
  return (
    <div className="ce-templates-wrapper">
      <button
        type="button"
        className="ce-btn ce-btn-ghost ce-templates-toggle"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        + Template ▾
      </button>
      {open ? (
        <div className="ce-templates-menu" role="listbox">
          {TIMING_TEMPLATES.map((tpl) => (
            <button
              key={tpl.id}
              type="button"
              role="option"
              className="ce-templates-item"
              onClick={() => {
                onPick(tpl.id);
                setOpen(false);
              }}
              title={tpl.description}
            >
              <span className="ce-templates-item-name">{tpl.name}</span>
              <span className="ce-templates-item-desc">{tpl.description}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

type SavingState =
  | { status: "idle" }
  | { status: "saving" }
  | { status: "saved" }
  | { status: "error"; errors: string[] };

/** Default starter spec — the parent passes one of these on "+ New". */
export function makeBlankTimingSpec(): UserTimingSpec {
  return {
    id: "user.",
    display_name: "",
    candidates: [0, 0.5, 1, 2, 5],
    horizon_sec: 15,
  };
}
