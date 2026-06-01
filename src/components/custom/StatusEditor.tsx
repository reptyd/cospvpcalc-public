import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  validateUserStatus,
  type ValidationResult,
} from "../../shared/customAbilityValidate";
import { registerCustomStatusRecord } from "../../shared/customStatuses";
import {
  listUserStatuses,
  registerUserStatus,
} from "../../shared/customAbilityBridge";
import {
  parseStatus,
  serializeStatus,
  type StatusParseResult,
} from "../../shared/statusDsl";
import { useHistory } from "../../shared/useHistory";
import type { UserStatusSpec } from "../../shared/customAbilityTypes";
import { PseudocodeDocs } from "./PseudocodeDocs";
import { StatusVisualEditor } from "./StatusVisualEditor";

/**
 * Dual-mode editor for a user-defined status (Phase 6 / G6, dual-mode in
 * Phase 8) — the status twin of `AbilityEditor`. The textual `statusDsl`
 * is the single source of truth: every change reparses the text into a
 * `UserStatusSpec`; if the parse succeeds we validate and show a summary,
 * otherwise a parse-error chip surfaces and the previous spec is retained.
 *
 * Code mode edits the DSL directly; Visual mode renders the parametric
 * knobs as cards and writes back through `serializeStatus`, so the two
 * views stay continuously in sync and round-trip without loss — the
 * parity contract locked by `statusConstructorCoverage.test.ts`.
 */
export function StatusEditor({
  initialSpec,
  onSaved,
  onCancel,
  mode,
}: {
  initialSpec: UserStatusSpec;
  onSaved: (spec: UserStatusSpec) => void;
  onCancel: () => void;
  mode: "create" | "edit";
}): ReactNode {
  const initialText = useMemo(() => serializeStatus(initialSpec), [initialSpec]);
  const [text, setText, history] = useHistory<string>(initialText);
  const [savingState, setSavingState] = useState<SavingState>({ status: "idle" });
  const [testState, setTestState] = useState<TestState>({ status: "idle" });
  const [docsOpen, setDocsOpen] = useState(false);
  const [viewMode, setViewMode] = useState<"code" | "visual">("code");

  // Parse on every keystroke — cheap (a handful of key/value lines).
  const parsed: StatusParseResult = useMemo(() => parseStatus(text), [text]);
  const currentSpec = parsed.ok ? parsed.spec : null;
  const validation: ValidationResult | null = currentSpec
    ? validateUserStatus(currentSpec)
    : null;

  // Keyboard undo/redo (Ctrl/Cmd+Z / Y / Shift+Z) — twin of AbilityEditor.
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
    const outcome = await registerCustomStatusRecord(currentSpec);
    if (outcome.status === "ok") {
      setSavingState({ status: "saved" });
      onSaved(currentSpec);
    } else {
      setSavingState({ status: "error", errors: outcome.errors });
    }
  };

  const handleTest = async () => {
    if (!currentSpec || !validation?.ok) return;
    setTestState({ status: "running" });
    const reg = await registerUserStatus(currentSpec);
    if (reg.status === "rejected") {
      setTestState({ status: "rejected", message: reg.error });
      return;
    }
    if (reg.status === "skipped") {
      setTestState({ status: "skipped", reason: reg.reason });
      return;
    }
    const list = await listUserStatuses();
    if (list.status !== "ok") {
      setTestState({
        status: "registered-but-list-failed",
        registrationId: reg.value.id,
      });
      return;
    }
    const found = list.value.some((e) => e.id === currentSpec.id);
    setTestState({
      status: "ok",
      registrationId: reg.value.id,
      visibleInRegistry: found,
      registrySize: list.value.length,
    });
  };

  return (
    <div className="ce status-editor">
      <header className="ce-header">
        <div className="ce-title">
          {mode === "create" ? "New status" : `Edit ${initialSpec.display_name}`}
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
              title={
                parsed.ok
                  ? "Visual constructor"
                  : "Visual mode disabled while there's a parse error — fix the code first"
              }
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
            title="Redo (Ctrl/Cmd+Y / Shift+Z)"
          >
            ↷
          </button>
          <button
            className="ce-btn ce-btn-ghost"
            onClick={() => setDocsOpen(true)}
            title="Open pseudocode reference"
          >
            ? Docs
          </button>
          <button
            className="ce-btn ce-btn-ghost"
            onClick={() => void handleTest()}
            disabled={!canSave}
            title="Register the spec and check the engine accepts it"
          >
            Test
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
                      ? "Register this status into your library"
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
              <strong>Can't add yet —</strong> there's a parse error in the code.
              Switch to <em>Code</em> mode and fix line {parsed.line ?? "?"}:{" "}
              <code>{parsed.error}</code>
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
            <span className="ce-pane-label">
              {viewMode === "code" ? "Code" : "Visual"}
            </span>
            {parsed.ok ? (
              <span className="ce-status ok">parsed</span>
            ) : (
              <span className="ce-status err">
                parse error{parsed.line ? ` · line ${parsed.line}` : ""}:{" "}
                {parsed.error}
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
              <StatusVisualEditor
                spec={currentSpec}
                onChange={(next) => setText(serializeStatus(next))}
              />
            </div>
          ) : (
            <div className="ce-visual-blocked">
              <p>
                Visual mode needs a parseable spec. Switch back to{" "}
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
              <SummaryPanel spec={currentSpec} />
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

          {testState.status !== "idle" ? (
            <div className="ce-card">
              <div className="ce-card-header">Engine test</div>
              <TestResultMessage state={testState} />
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
      {docsOpen ? (
        <PseudocodeDocs
          onClose={() => setDocsOpen(false)}
          onInsertStatus={(snippet) => {
            if (
              text.trim() === "" ||
              window.confirm(
                "Replace the current spec with this example? This drops your current text.",
              )
            ) {
              setText(snippet);
              setDocsOpen(false);
            }
          }}
        />
      ) : null}
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────

function SummaryPanel({ spec }: { spec: UserStatusSpec }): ReactNode {
  return (
    <dl className="ce-summary">
      <div>
        <dt>id</dt>
        <dd>
          <code>{spec.id || "—"}</code>
        </dd>
      </div>
      <div>
        <dt>name</dt>
        <dd>{spec.display_name || "—"}</dd>
      </div>
      <div>
        <dt>polarity</dt>
        <dd>{spec.polarity ?? "negative"}</dd>
      </div>
      <div>
        <dt>stacking</dt>
        <dd>
          {spec.stack_rule ?? "stacking"}
          {typeof spec.max_stacks === "number"
            ? ` · max ${spec.max_stacks}`
            : ""}
        </dd>
      </div>
      <div>
        <dt>tick</dt>
        <dd>{tickSummary(spec)}</dd>
      </div>
      <div>
        <dt>modifiers</dt>
        <dd>{modifierSummary(spec)}</dd>
      </div>
    </dl>
  );
}

/**
 * Cheap computed preview of the periodic tick at a representative stack
 * count — `base + per_stack·stacks` (matches the engine's `tick_amount`).
 * Stands in for the full matchup preview the ability editor runs: a status
 * isn't applied to a creature in isolation, so a per-tick projection is the
 * honest, dependency-free summary.
 */
function tickSummary(spec: UserStatusSpec): ReactNode {
  if (!spec.tick_kind || spec.tick_kind === "none") {
    return <span className="ce-muted">no periodic tick</span>;
  }
  const stacks =
    typeof spec.max_stacks === "number" && spec.max_stacks > 0
      ? spec.max_stacks
      : 5;
  const amount = (spec.tick_base ?? 0) + (spec.tick_per_stack ?? 0) * stacks;
  const isPct = spec.tick_kind.endsWith("pct_max_hp");
  const isHeal = spec.tick_kind.startsWith("heal");
  const unit = isPct ? "% max HP" : " HP";
  const verb = isHeal ? "heal" : "damage";
  const interval = spec.tick_interval_sec ?? 0;
  const rounded = Math.round(amount * 100) / 100;
  const intervalNote = interval > 0 ? ` every ${interval}s` : " (no interval set)";
  return (
    <span>
      {stacks} stack{stacks === 1 ? "" : "s"} → {rounded}
      {unit} {verb}/tick{intervalNote}
    </span>
  );
}

function modifierSummary(spec: UserStatusSpec): ReactNode {
  const parts: string[] = [];
  if (spec.regen_mod_pct !== undefined || spec.regen_mod_per_stack_pct !== undefined) {
    const base = spec.regen_mod_pct ?? 0;
    const per = spec.regen_mod_per_stack_pct ?? 0;
    parts.push(`regen ${base >= 0 ? "+" : ""}${base}%${per ? ` (${per >= 0 ? "+" : ""}${per}%/stk)` : ""}`);
  }
  if (spec.incoming_damage_mult !== undefined && spec.incoming_damage_mult !== 1) {
    parts.push(`incoming ×${spec.incoming_damage_mult}`);
  }
  if (spec.outgoing_damage_mult !== undefined && spec.outgoing_damage_mult !== 1) {
    parts.push(`outgoing ×${spec.outgoing_damage_mult}`);
  }
  if (spec.bite_cooldown_mult !== undefined && spec.bite_cooldown_mult !== 1) {
    parts.push(`bite cd ×${spec.bite_cooldown_mult}`);
  }
  return parts.length > 0 ? (
    parts.join(" · ")
  ) : (
    <span className="ce-muted">none</span>
  );
}

function TestResultMessage({ state }: { state: TestState }): ReactNode {
  if (state.status === "idle" || state.status === "running") return null;
  if (state.status === "rejected") {
    return <div className="ce-status err">Engine rejected: {state.message}</div>;
  }
  if (state.status === "skipped") {
    return (
      <div className="ce-muted">
        Skipped — bridge reports <code>{state.reason}</code>. Run{" "}
        <code>npm run rust:build</code>.
      </div>
    );
  }
  if (state.status === "registered-but-list-failed") {
    return (
      <div className="ce-muted">
        Registered as <code>{state.registrationId}</code> but list call failed.
      </div>
    );
  }
  return (
    <div className={state.visibleInRegistry ? "ce-status ok" : "ce-status err"}>
      {state.visibleInRegistry
        ? `Registered as ${state.registrationId}. Engine sees ${state.registrySize} user status(es).`
        : `Registration returned ${state.registrationId} but engine list didn't include it.`}
    </div>
  );
}

/**
 * The `UserStatusSpec` fields the editor binds a control to (across both
 * modes — the Visual cards expose every one, and the Code DSL has a line
 * for each). Pairs with `EDITABLE_STATUS_SPEC_FIELDS` (customAbilityTypes.ts)
 * through `statusConstructorCoverage.test.ts` to lock the editor at 100% of
 * the schema. Keep in sync with `StatusVisualEditor`'s cards and the
 * `statusDsl` grammar — the test fails if a schema field marked `"editor"`
 * is missing here.
 */
export const STATUS_EDITOR_FIELDS: ReadonlySet<keyof UserStatusSpec> = new Set([
  // Identity
  "id",
  "display_name",
  "polarity",
  // Stacking & decay
  "stack_rule",
  "max_stacks",
  "decay_interval_sec",
  // NOTE: the Periodic-tick and Combat-modifier knobs are retired from the
  // editor (class "legacy") — periodic behaviour is authored via the on_tick
  // hook, damage scaling via pre-damage hooks, cooldown/regen via modify_stat.
  // The spec fields persist for backward-compat (DSL round-trip), not here.
]);

/**
 * Phase 9 programmable fields the Visual editor surfaces through the block
 * constructor / Expr-toggles / teardown card (rather than a flat field-card).
 * Pairs with `BLOCK_STATUS_SPEC_FIELDS` (customAbilityTypes.ts) in
 * `statusConstructorCoverage.test.ts`: every schema field marked `"blocks"`
 * must be reachable here — so the editor stays at 100% of the schema with no
 * code-only corners.
 */
export const STATUS_BLOCK_EDITOR_FIELDS: ReadonlySet<keyof UserStatusSpec> =
  new Set([
    // Hook stacks (StackView block constructor)
    "on_apply",
    "on_tick",
    "on_expire",
    // Bearer-reactive trigger stacks (status↔ability parity)
    "on_round_start",
    "on_take_damage",
    "on_deal_damage",
    "on_kill",
    "on_first_strike",
    "on_heal",
    "on_status_apply",
    "on_status_expire",
    "on_before_take_damage",
    "on_before_deal_damage",
    "on_decay",
    "on_restack",
  ]);

type SavingState =
  | { status: "idle" }
  | { status: "saving" }
  | { status: "saved" }
  | { status: "error"; errors: string[] };

type TestState =
  | { status: "idle" }
  | { status: "running" }
  | { status: "rejected"; message: string }
  | { status: "skipped"; reason: string }
  | { status: "registered-but-list-failed"; registrationId: string }
  | {
      status: "ok";
      registrationId: string;
      visibleInRegistry: boolean;
      registrySize: number;
    };

/** Default starter spec — a stacking negative DoT, ready to tweak. */
export function makeBlankStatusSpec(): UserStatusSpec {
  return {
    id: "user.",
    display_name: "",
    polarity: "negative",
    stack_rule: "stacking",
    decay_interval_sec: 3,
    tick_kind: "none",
    incoming_damage_mult: 1,
    outgoing_damage_mult: 1,
    bite_cooldown_mult: 1,
  };
}
