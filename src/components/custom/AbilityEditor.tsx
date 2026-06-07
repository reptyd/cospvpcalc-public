import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  parseAbility,
  printAbility,
  type ParseResult,
} from "../../shared/abilityDsl";
import {
  validateUserAbility,
  type ValidationResult,
} from "../../shared/customAbilityValidate";
import {
  listUserAbilities,
  registerUserAbility,
} from "../../shared/customAbilityBridge";
import { registerCustomAbilityRecord } from "../../shared/customAbilities";
import {
  listCustomTimingRecords,
  subscribeCustomTimingRegistry,
  type CustomTimingRecord,
} from "../../shared/customTimings";
import type { UserAbilitySpec } from "../../shared/customAbilityTypes";
import { useHistory } from "../../shared/useHistory";
import { ABILITY_TEMPLATES } from "../../shared/customAbilityTemplates";
import { PseudocodeDocs } from "./PseudocodeDocs";
import { AbilityVisualEditor } from "./AbilityVisualEditor";
import { applyRulesAndBuild } from "../../engine/buildRules";
import { creatureByName, creaturesData } from "../../engine/creatureData";
import { trySimulateRustCompareMatchup } from "../../optimizer/rustCompareDispatch";
import type { SimulationSummary } from "../../engine/types";

/**
 * Code-first ability editor. The textarea is the source of truth.
 * On every change we parse; if the parse succeeds we update the
 * "current spec" state and show a compact preview panel; if not,
 * the previous spec is retained and a parse-error chip surfaces.
 *
 * This is the second-generation editor: the first was a multi-tab
 * visual constructor that tried to surface every spec field as a
 * dedicated form control. That ended up being noisier than it was
 * helpful - users who knew what they wanted wrote it faster as
 * code than as forms, and users who didn't were no less confused
 * by the fields. Code-first keeps the page focused on one input,
 * surfaces validation immediately, and lets the live-preview pane
 * answer "did my edit do what I think?".
 */
export function AbilityEditor({
  initialSpec,
  onSaved,
  onCancel,
  mode,
}: {
  initialSpec: UserAbilitySpec;
  onSaved: (spec: UserAbilitySpec) => void;
  onCancel: () => void;
  mode: "create" | "edit";
}): ReactNode {
  const initialText = useMemo(() => printAbility(initialSpec), [initialSpec]);
  const [text, setText, history] = useHistory<string>(initialText);
  const [savingState, setSavingState] = useState<SavingState>({ status: "idle" });
  const [testState, setTestState] = useState<TestState>({ status: "idle" });
  const [previewState, setPreviewState] = useState<PreviewState>({ status: "idle" });
  const [previewAttacker, setPreviewAttacker] = useState<string>(
    () => creaturesData[0]?.name ?? "",
  );
  const [previewOpponent, setPreviewOpponent] = useState<string>(
    () => creaturesData[1]?.name ?? creaturesData[0]?.name ?? "",
  );
  const [timingRecords, setTimingRecords] = useState<CustomTimingRecord[]>(
    () => listCustomTimingRecords(),
  );
  const [docsOpen, setDocsOpen] = useState(false);
  const [viewMode, setViewMode] = useState<"code" | "visual">("code");
  useEffect(
    () =>
      subscribeCustomTimingRegistry(() => setTimingRecords(listCustomTimingRecords())),
    [],
  );

  // Parse on every keystroke. Cheap (recursive descent over <1KB).
  const parsed: ParseResult = useMemo(() => parseAbility(text), [text]);
  const currentSpec = parsed.ok ? parsed.spec : null;
  const validation: ValidationResult | null = currentSpec
    ? validateUserAbility(currentSpec)
    : null;

  // Keyboard shortcuts: Ctrl/Cmd+Z / Y / Shift+Z, but only when
  // focus isn't in a child input.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.isContentEditable) return;
      // Allow Ctrl+Z inside textarea - but our useHistory should
      // own undo for the whole editor. Capture only when modifier
      // is Ctrl/Cmd.
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
    const outcome = await registerCustomAbilityRecord(currentSpec);
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
    const reg = await registerUserAbility(currentSpec);
    if (reg.status === "rejected") {
      setTestState({ status: "rejected", message: reg.error });
      return;
    }
    if (reg.status === "skipped") {
      setTestState({ status: "skipped", reason: reg.reason });
      return;
    }
    const list = await listUserAbilities();
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

  const handlePreview = async () => {
    if (!currentSpec || !validation?.ok) return;
    setPreviewState({ status: "running" });
    const reg = await registerUserAbility(currentSpec);
    if (reg.status === "rejected") {
      setPreviewState({ status: "rejected", message: reg.error });
      return;
    }
    if (reg.status === "skipped") {
      setPreviewState({ status: "skipped", reason: reg.reason });
      return;
    }
    const aBase = creatureByName[previewAttacker];
    const bBase = creatureByName[previewOpponent];
    if (!aBase || !bBase) {
      setPreviewState({ status: "rejected", message: "creature not found" });
      return;
    }
    const aWith = {
      ...aBase,
      userAbilityIds: [...(aBase.userAbilityIds ?? []), currentSpec.id],
    };
    try {
      const finalA = applyRulesAndBuild(aWith);
      const finalB = applyRulesAndBuild(bBase);
      const perks = defaultPerks();
      const summary = await trySimulateRustCompareMatchup({
        sourceCreature: aWith,
        opponentCreature: bBase,
        finalA,
        finalB,
        activesOn: true,
        breathOn: true,
        abilityPolicy: "ideal",
        initialStatusesA: [],
        initialStatusesB: [],
        activeCooldownMultiplierA: 1,
        activeCooldownMultiplierB: 1,
        disabledAbilitiesA: [],
        disabledAbilitiesB: [],
        perksA: perks,
        perksB: perks,
        firstTick: { mode: "off", delaySec: 1 },
        noMoveFacetank: false,
        badOmenOutcome: null,
        compareAirRuleEnabled: false,
        compareAirRuleCooldownSec: 0,
        compareBiteVariantModeA: "primaryOnly",
        compareBiteVariantModeB: "primaryOnly",
        maxTimeSec: 120,
      });
      if (!summary) {
        setPreviewState({
          status: "ineligible",
          message:
            "Compare matchup ineligible (likely WASM bundle stale or matchup not Rust-compatible).",
        });
        return;
      }
      setPreviewState({ status: "ok", summary });
    } catch (err) {
      setPreviewState({
        status: "rejected",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const insertTemplate = (tplId: string) => {
    const tpl = ABILITY_TEMPLATES.find((t) => t.id === tplId);
    if (!tpl) return;
    if (
      !window.confirm(
        `Replace the current spec with "${tpl.name}"? This drops your current text.`,
      )
    )
      return;
    // Build template against current id/display_name if parse OK,
    // else generic.
    const current = parsed.ok ? parsed.spec : initialSpec;
    const built = tpl.build({
      id: current.id || "user.",
      display_name: current.display_name || tpl.name,
    });
    setText(printAbility(built));
  };

  return (
    <div className="ce ability-code-editor">
      <header className="ce-header">
        <div className="ce-title">
          {mode === "create" ? "New ability" : `Edit ${initialSpec.display_name}`}
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
              title={parsed.ok ? "Visual constructor" : "Visual mode disabled while there's a parse error - fix the code first"}
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
          <TemplatesDropdown onPick={insertTemplate} />
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
                  ? `Fix ${validation.errors.length} validation error(s) - ${validation.errors[0]}`
                  : savingState.status === "saving"
                    ? "Saving…"
                    : mode === "create"
                      ? "Register this ability into your library"
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
      {/* Sticky disable-reason bar - shown only when Save is disabled
          due to validation errors, so the user understands why the
          button is grey instead of guessing. Parse errors are already
          surfaced in the pane header; this targets the "I forgot to
          fill the name" case explicitly. */}
      {!parsed.ok || (validation && !validation.ok) ? (
        <div className="ce-cant-save-banner">
          {!parsed.ok ? (
            <span>
              <strong>Can't add yet -</strong> there's a parse error in
              the code. Switch to <em>Code</em> mode and fix line {parsed.line ?? "?"}: <code>{parsed.error}</code>
            </span>
          ) : validation && !validation.ok ? (
            <span>
              <strong>Can't add yet -</strong> {validation.errors.join("; ")}
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
              <AbilityVisualEditor
                spec={currentSpec}
                onChange={(next) => setText(printAbility(next))}
                timingRecords={timingRecords}
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
              <SummaryPanel spec={currentSpec} timingRecordsCount={timingRecords.length} />
            ) : (
              <div className="ce-muted">Fix the parse error to see structure.</div>
            )}
          </div>

          {validation && !validation.ok ? (
            <div className="ce-card ce-card-error">
              <div className="ce-card-header">⚠ {validation.errors.length} validation error(s)</div>
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

          <div className="ce-card">
            <div className="ce-card-header">Live preview</div>
            <div className="ce-form-row">
              <label className="ce-field">
                <span>attacker</span>
                <select
                  value={previewAttacker}
                  onChange={(e) => setPreviewAttacker(e.target.value)}
                >
                  {creaturesData.map((c) => (
                    <option key={c.name} value={c.name}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="ce-field">
                <span>opponent</span>
                <select
                  value={previewOpponent}
                  onChange={(e) => setPreviewOpponent(e.target.value)}
                >
                  {creaturesData.map((c) => (
                    <option key={c.name} value={c.name}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <button
              className="ce-btn ce-btn-primary ce-btn-block"
              onClick={() => void handlePreview()}
              disabled={!canSave || previewState.status === "running"}
            >
              {previewState.status === "running" ? "Simulating…" : "▶ Run preview"}
            </button>
            {previewState.status === "ok" ? (
              <PreviewResultDisplay summary={previewState.summary} />
            ) : null}
            {previewState.status === "rejected" ? (
              <div className="ce-status err">{previewState.message}</div>
            ) : null}
            {previewState.status === "skipped" ? (
              <div className="ce-muted">Skipped - bridge: <code>{previewState.reason}</code></div>
            ) : null}
            {previewState.status === "ineligible" ? (
              <div className="ce-muted">{previewState.message}</div>
            ) : null}
          </div>

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

// ── Helpers ────────────────────────────────────────────────────

/**
 * Custom dropdown for template selection - fully styled (vs the
 * native <select> which inherits the OS accent colour and tends
 * to look harsh on dark themes). Closes on outside-click and
 * Escape.
 */
function TemplatesDropdown({ onPick }: { onPick: (id: string) => void }): ReactNode {
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
          {ABILITY_TEMPLATES.map((tpl) => (
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

function SummaryPanel({
  spec,
  timingRecordsCount,
}: {
  spec: UserAbilitySpec;
  timingRecordsCount: number;
}): ReactNode {
  const triggers = spec.triggers ?? {};
  const triggerKeys = Object.entries(triggers)
    .filter(([, v]) => Boolean(v))
    .map(([k]) => k);
  return (
    <dl className="ce-summary">
      <div>
        <dt>id</dt>
        <dd><code>{spec.id || "-"}</code></dd>
      </div>
      <div>
        <dt>name</dt>
        <dd>{spec.display_name || "-"}</dd>
      </div>
      <div>
        <dt>timing</dt>
        <dd>
          {spec.timing_user_override
            ? <code>{spec.timing_user_override}</code>
            : spec.timing_mode_override ?? "(session default)"}
        </dd>
      </div>
      <div>
        <dt>on_fire</dt>
        <dd>
          {spec.on_fire
            ? `${spec.on_fire.effects.length} effect${spec.on_fire.effects.length === 1 ? "" : "s"}`
            : <span className="ce-muted">passive (no on_fire)</span>}
        </dd>
      </div>
      <div>
        <dt>triggers</dt>
        <dd>
          {triggerKeys.length > 0 ? triggerKeys.join(", ") : <span className="ce-muted">none</span>}
        </dd>
      </div>
      {timingRecordsCount > 0 ? (
        <div>
          <dt>custom timings</dt>
          <dd className="ce-muted">{timingRecordsCount} available</dd>
        </div>
      ) : null}
    </dl>
  );
}

function PreviewResultDisplay({ summary }: { summary: SimulationSummary }): ReactNode {
  const winner = summary.winner;
  const winnerColor =
    winner === "A" ? "var(--ce-good)" : winner === "B" ? "var(--ce-bad)" : "var(--ce-warn)";
  return (
    <div className="ce-preview-result">
      <div>
        Winner:{" "}
        <strong style={{ color: winnerColor }}>
          {winner === "Draw" ? "Draw" : winner === "A" ? "Attacker" : "Opponent"}
        </strong>
      </div>
      <div className="ce-muted">
        Final HP - A: {Math.round(summary.finalHpA)}, B: {Math.round(summary.finalHpB)}
      </div>
      <div className="ce-muted">
        TTK - A→B: {summary.ttkAtoB?.toFixed(1) ?? "∞"}s · B→A: {summary.ttkBtoA?.toFixed(1) ?? "∞"}s
      </div>
    </div>
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
        Skipped - bridge reports <code>{state.reason}</code>. Run <code>npm run rust:build</code>.
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
        ? `Registered as ${state.registrationId}. Engine sees ${state.registrySize} user ability(ies).`
        : `Registration returned ${state.registrationId} but engine list didn't include it.`}
    </div>
  );
}

function defaultPerks() {
  return {
    traps: false,
    trails: false,
    powerCharge: false,
    goreCharge: false,
    startingSpiteCharged: false,
    muddyBuff: false,
    hungerRule: false,
    gourmandizer: false,
    startingHungerUnits: 100,
    appetiteBaseUnits: 100,
    defiledGroundLevel: 0,
    defiledGroundWeakness: false,
    appetiteDrainMultiplier: 1.0,
    healingPulseEnabled: false,
    healingPulseOnce: false,
    expungeEnabled: false,
    wardenRageStartHpPct: 0,
  };
}

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

type PreviewState =
  | { status: "idle" }
  | { status: "running" }
  | { status: "ok"; summary: SimulationSummary }
  | { status: "rejected"; message: string }
  | { status: "skipped"; reason: string }
  | { status: "ineligible"; message: string };

/** Default starter spec - the parent passes one of these on "+ New". */
export function makeBlankAbilitySpec(): UserAbilitySpec {
  return {
    version: 1,
    id: "user.",
    display_name: "",
    utility: { kind: "const", value: 1 },
    is_available: { kind: "const", value: 1 },
    on_fire: {
      name: "Fire",
      effects: [{ kind: "deal_direct_damage", target: "opponent", amount: 100 }],
    },
  };
}
