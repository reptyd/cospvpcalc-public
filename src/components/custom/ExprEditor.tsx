import { useEffect, useId, useMemo, useState, type ReactNode } from "react";
import type { BinOp, Expr, UnaryOp } from "../../shared/customAbilityTypes";
import { parseExpr, printExpr } from "../../shared/exprDsl";
import { defaultMockState, evalExpr, formatEvalResult } from "../../shared/exprEval";
import { buildVarSuggestions } from "../../shared/customAbilityVocab";

/**
 * Recursive editor for the engine's expression DSL. Mirrors the
 * `Expr` enum 1:1: const | var | bin | una | if. Each level renders
 * a `kind` picker plus the inputs for its current variant, and
 * recurses for sub-expressions. State is pure (parent owns the
 * tree); switching kind seeds a sensible default for the new shape
 * so the user can keep typing instead of starting over.
 */
export function ExprEditor({
  value,
  onChange,
  label,
  varSuggestions,
  level = 0,
}: {
  value: Expr;
  onChange: (next: Expr) => void;
  label?: ReactNode;
  varSuggestions?: string[];
  level?: number;
}) {
  const datalistId = useId();
  const headerLabel = label ? <span className="expr-editor-label">{label}</span> : null;
  // Top-level only: a Code/Constructor toggle so users can flip
  // between visual and DSL editing of the entire sub-tree. Nested
  // editors stay constructor-only — the textarea takes the whole
  // expression so a per-node code mode would be confusing.
  const isTopLevel = level === 0;
  const [codeMode, setCodeMode] = useState<boolean>(false);
  // Inline preview value at the typical state — only shown on the
  // top-level node so nested children don't crowd the layout.
  const previewValue = useMemo(() => {
    if (!isTopLevel) return null;
    try {
      return evalExpr(value, defaultMockState());
    } catch {
      return null;
    }
  }, [isTopLevel, value]);

  const swapKind = (kind: Expr["kind"]) => {
    onChange(seedExpr(kind, value));
  };

  if (isTopLevel && codeMode) {
    return (
      <ExprCodeEditor
        value={value}
        onChange={onChange}
        onExitCodeMode={() => setCodeMode(false)}
        label={label}
        varSuggestions={varSuggestions}
      />
    );
  }

  return (
    <div className={`expr-editor expr-editor-level-${Math.min(level, 5)}`}>
      <div className="expr-editor-row">
        {headerLabel}
        {previewValue !== null ? (
          <span
            className="expr-editor-preview"
            title="Value at a typical fight state (50% HP, sample Bleed_Status, no cooldowns, t=30s). Engine evaluates the real state at fire time."
          >
            ≈ {formatEvalResult(previewValue)}
          </span>
        ) : null}
        {isTopLevel ? (
          <button
            type="button"
            className="expr-editor-mode"
            onClick={() => setCodeMode(true)}
            title="Switch to text-DSL editing for this expression"
          >
            { } code
          </button>
        ) : null}
        <select
          className="expr-editor-kind"
          value={value.kind}
          onChange={(e) => swapKind(e.target.value as Expr["kind"])}
          aria-label="Expression kind"
        >
          <option value="const">const</option>
          <option value="var">var</option>
          <option value="bin">binary op</option>
          <option value="una">unary op</option>
          <option value="if">if/then/else</option>
          <option value="clamp">clamp</option>
        </select>
        {value.kind === "const" ? (
          <input
            className="expr-editor-number"
            type="number"
            step="any"
            value={Number.isFinite(value.value) ? value.value : 0}
            onChange={(e) => onChange({ kind: "const", value: Number(e.target.value) })}
            aria-label="Constant value"
          />
        ) : null}
        {value.kind === "var" ? (
          <>
            <input
              className="expr-editor-var"
              type="text"
              list={datalistId}
              placeholder="self.hp"
              value={value.path}
              onChange={(e) => onChange({ kind: "var", path: e.target.value })}
              aria-label="Variable path"
            />
            <datalist id={datalistId}>
              {(varSuggestions ?? DEFAULT_VAR_SUGGESTIONS).map((path) => (
                <option key={path} value={path} />
              ))}
            </datalist>
          </>
        ) : null}
        {value.kind === "bin" ? (
          <select
            className="expr-editor-op"
            value={value.op}
            onChange={(e) => onChange({ ...value, op: e.target.value as BinOp })}
            aria-label="Binary operator"
          >
            {BINARY_OPS.map((op) => (
              <option key={op} value={op}>
                {op}
              </option>
            ))}
          </select>
        ) : null}
        {value.kind === "una" ? (
          <select
            className="expr-editor-op"
            value={value.op}
            onChange={(e) => onChange({ ...value, op: e.target.value as UnaryOp })}
            aria-label="Unary operator"
          >
            {UNARY_OPS.map((op) => (
              <option key={op} value={op}>
                {op}
              </option>
            ))}
          </select>
        ) : null}
      </div>
      {value.kind === "bin" ? (
        <div className="expr-editor-children">
          <ExprEditor
            value={value.left}
            onChange={(left) => onChange({ ...value, left })}
            label="left"
            varSuggestions={varSuggestions}
            level={level + 1}
          />
          <ExprEditor
            value={value.right}
            onChange={(right) => onChange({ ...value, right })}
            label="right"
            varSuggestions={varSuggestions}
            level={level + 1}
          />
        </div>
      ) : null}
      {value.kind === "una" ? (
        <div className="expr-editor-children">
          <ExprEditor
            value={value.operand}
            onChange={(operand) => onChange({ ...value, operand })}
            label="operand"
            varSuggestions={varSuggestions}
            level={level + 1}
          />
        </div>
      ) : null}
      {value.kind === "if" ? (
        <div className="expr-editor-children">
          <ExprEditor
            value={value.cond}
            onChange={(cond) => onChange({ ...value, cond })}
            label="cond"
            varSuggestions={varSuggestions}
            level={level + 1}
          />
          <ExprEditor
            value={value.then}
            onChange={(then) => onChange({ ...value, then })}
            label="then"
            varSuggestions={varSuggestions}
            level={level + 1}
          />
          <ExprEditor
            value={value.otherwise}
            onChange={(otherwise) => onChange({ ...value, otherwise })}
            label="else"
            varSuggestions={varSuggestions}
            level={level + 1}
          />
        </div>
      ) : null}
      {value.kind === "clamp" ? (
        <div className="expr-editor-children">
          <ExprEditor
            value={value.value}
            onChange={(v) => onChange({ ...value, value: v })}
            label="value"
            varSuggestions={varSuggestions}
            level={level + 1}
          />
          <ExprEditor
            value={value.lo}
            onChange={(lo) => onChange({ ...value, lo })}
            label="lo"
            varSuggestions={varSuggestions}
            level={level + 1}
          />
          <ExprEditor
            value={value.hi}
            onChange={(hi) => onChange({ ...value, hi })}
            label="hi"
            varSuggestions={varSuggestions}
            level={level + 1}
          />
        </div>
      ) : null}
    </div>
  );
}

/**
 * Text-DSL editor for an entire `Expr` sub-tree. Keeps a local text
 * buffer so users can have transient invalid states while typing
 * without their progress being clobbered. The parent only sees AST
 * updates when the buffer parses cleanly.
 */
function ExprCodeEditor({
  value,
  onChange,
  onExitCodeMode,
  label,
  varSuggestions,
}: {
  value: Expr;
  onChange: (next: Expr) => void;
  onExitCodeMode: () => void;
  label?: ReactNode;
  varSuggestions?: string[];
}): ReactNode {
  // Inline preview of evaluated value at typical state. Updates
  // whenever `value` changes (which is every successful parse).
  const previewValue = useMemo(() => {
    try {
      return evalExpr(value, defaultMockState());
    } catch {
      return null;
    }
  }, [value]);
  // Seed the textarea with whatever the current AST prints to. We
  // re-print whenever `value` changes externally so a parent-driven
  // update (e.g. parent overwrote the spec) reflects in the text.
  const [text, setText] = useState<string>(() => printExpr(value));
  const [error, setError] = useState<{ message: string; column?: number } | null>(null);
  const [cursor, setCursor] = useState<number>(0);
  const [taEl, setTaEl] = useState<HTMLTextAreaElement | null>(null);
  const corpus = useMemo(
    () => buildAutocompleteCorpus(varSuggestions),
    [varSuggestions],
  );
  const suggestions = useMemo(() => {
    const { token } = tokenAtCursor(text, cursor);
    if (token.length < 1) return [];
    const lc = token.toLowerCase();
    const matches = corpus.filter(
      (entry) => entry.toLowerCase().startsWith(lc) && entry !== token,
    );
    matches.sort((a, b) => a.length - b.length);
    return matches.slice(0, 8);
  }, [text, cursor, corpus]);

  useEffect(() => {
    // Sync text from value when value changes externally — but only
    // when the local text is "clean" (parses to the current value),
    // so we don't overwrite in-progress edits.
    const parsed = parseExpr(text);
    if (parsed.ok && deepEqual(parsed.expr, value)) return;
    setText(printExpr(value));
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const tryCommit = (next: string) => {
    setText(next);
    const parsed = parseExpr(next);
    if (parsed.ok) {
      setError(null);
      // Only push to parent if AST actually changed — keeps render
      // count down when user is just reformatting whitespace.
      if (!deepEqual(parsed.expr, value)) {
        onChange(parsed.expr);
      }
    } else {
      setError({ message: parsed.error, column: parsed.column });
    }
  };

  const insertSuggestion = (full: string) => {
    const { start } = tokenAtCursor(text, cursor);
    const before = text.slice(0, start);
    const after = text.slice(cursor);
    const newText = before + full + after;
    const newCursor = (before + full).length;
    tryCommit(newText);
    setTimeout(() => {
      if (taEl) {
        taEl.focus();
        taEl.setSelectionRange(newCursor, newCursor);
        setCursor(newCursor);
      }
    }, 0);
  };

  return (
    <div className="expr-code-editor">
      <div className="expr-editor-row">
        {label ? <span className="expr-editor-label">{label}</span> : null}
        {previewValue !== null ? (
          <span
            className="expr-editor-preview"
            title="Value at a typical fight state (50% HP, sample Bleed_Status, no cooldowns, t=30s)."
          >
            ≈ {formatEvalResult(previewValue)}
          </span>
        ) : null}
        <button
          type="button"
          className="expr-editor-mode"
          onClick={onExitCodeMode}
          title="Switch back to constructor view"
        >
          ▦ visual
        </button>
      </div>
      <textarea
        ref={setTaEl}
        className={`expr-code-textarea ${error ? "has-error" : ""}`}
        value={text}
        onChange={(e) => {
          tryCommit(e.target.value);
          setCursor(e.target.selectionStart ?? e.target.value.length);
        }}
        onKeyUp={(e) =>
          setCursor((e.target as HTMLTextAreaElement).selectionStart ?? 0)
        }
        onClick={(e) =>
          setCursor((e.target as HTMLTextAreaElement).selectionStart ?? 0)
        }
        onSelect={(e) =>
          setCursor((e.target as HTMLTextAreaElement).selectionStart ?? 0)
        }
        spellCheck={false}
        rows={Math.max(2, Math.min(8, text.split("\n").length))}
      />
      {suggestions.length > 0 ? (
        <div className="expr-code-autocomplete">
          <span className="muted" style={{ fontSize: 11, marginRight: 8 }}>
            ↳ suggest:
          </span>
          {suggestions.map((s) => (
            <button
              key={s}
              type="button"
              className="expr-code-autocomplete-item"
              onMouseDown={(e) => {
                // mousedown not click — prevents the textarea blur
                // from racing the focus restore.
                e.preventDefault();
                insertSuggestion(s);
              }}
              title={`Insert "${s}"`}
            >
              <code>{s}</code>
            </button>
          ))}
        </div>
      ) : null}
      {error ? (
        <div className="expr-code-error">
          parse error{error.column !== undefined ? ` at col ${error.column + 1}` : ""}: {error.message}
        </div>
      ) : null}
      <details style={{ fontSize: 12, marginTop: 4 }}>
        <summary style={{ cursor: "pointer", color: "rgba(255,255,255,0.6)" }}>
          DSL cheatsheet
        </summary>
        <div className="expr-code-cheatsheet" style={{ marginTop: 8, paddingLeft: 12, borderLeft: "2px solid rgba(255,255,255,0.1)" }}>
          <p><strong>Operators</strong> (lowest → highest precedence):</p>
          <ul style={{ marginTop: 0 }}>
            <li><code>?:</code> ternary, <code>if … then … else …</code></li>
            <li><code>||</code> or, <code>&&</code> and</li>
            <li><code>==</code> <code>!=</code> <code>{"<"}</code> <code>{"<="}</code> <code>{">"}</code> <code>{">="}</code></li>
            <li><code>+</code> <code>-</code></li>
            <li><code>*</code> <code>/</code> <code>%</code></li>
            <li><code>**</code> (right-assoc power)</li>
            <li>unary <code>-x</code>, <code>!x</code></li>
          </ul>
          <p><strong>Functions:</strong></p>
          <ul style={{ marginTop: 0 }}>
            <li><code>min(a,b)</code> <code>max(a,b)</code> <code>pow(a,b)</code></li>
            <li><code>abs(x)</code> <code>sign(x)</code> <code>sqrt(x)</code></li>
            <li><code>floor(x)</code> <code>ceil(x)</code> <code>round(x)</code></li>
            <li><code>ln(x)</code> <code>exp(x)</code></li>
            <li><code>clamp(value, lo, hi)</code></li>
          </ul>
          <p><strong>Common var paths:</strong></p>
          <ul style={{ marginTop: 0 }}>
            <li><code>self.hp</code> <code>self.hp_ratio</code> <code>self.max_hp</code> <code>self.bite_dps</code></li>
            <li><code>self.breath_capacity</code> <code>self.next_hit</code> <code>self.is_alive</code></li>
            <li><code>self.statuses_count</code> <code>self.statuses_total_stacks</code></li>
            <li><code>self.status.&lt;id&gt;.stacks</code> <code>self.cooldown_remaining.&lt;id&gt;</code></li>
            <li><code>self.is_idle.&lt;id&gt;</code> <code>self.fired_count.&lt;id&gt;</code></li>
            <li><code>self.extras.&lt;key&gt;</code> (custom resource meters)</li>
            <li><code>self.stats.&lt;field&gt;</code> (any SimpleCombatantStats field)</li>
            <li><code>opponent.*</code> (mirror set on the other side)</li>
            <li><code>time</code>, <code>combat.iteration_count</code></li>
            <li>Inside trigger effects: <code>event.damage_taken</code>, <code>event.tick_index</code>, etc.</li>
          </ul>
          <p><strong>Examples:</strong></p>
          <ul style={{ marginTop: 0, fontFamily: "ui-monospace, SFMono-Regular, monospace" }}>
            <li><code>opponent.hp * 0.5</code></li>
            <li><code>self.hp_ratio &lt; 0.3 ? 1000 : 0</code></li>
            <li><code>clamp(self.bite_dps * 8, 100, 500)</code></li>
            <li><code>min(self.statuses_count * 50, 200)</code></li>
            <li><code>(self.max_hp - self.hp) * 1.5</code></li>
          </ul>
        </div>
      </details>
    </div>
  );
}

// Static autocomplete catalog — function names + common var paths.
// Cheap to build once at module load.
const DSL_FUNCTIONS = [
  "min(", "max(", "pow(", "abs(", "sign(", "sqrt(",
  "floor(", "ceil(", "round(", "ln(", "exp(", "clamp(",
];
const DSL_KEYWORDS = ["if ", "then ", "else "];

function buildAutocompleteCorpus(varSuggestions?: string[]): string[] {
  // Round 44 / A6: same source as the visual editor's datalist
  // autocomplete — keeps the code-mode corpus in sync with the engine
  // resolver vocab without a duplicate hardcoded list.
  const vars = varSuggestions ?? buildVarSuggestions();
  return [...DSL_FUNCTIONS, ...DSL_KEYWORDS, ...vars];
}

/** Find the partial token at cursor (run of [a-zA-Z0-9_.]). */
function tokenAtCursor(text: string, cursor: number): { start: number; token: string } {
  let start = cursor;
  while (start > 0) {
    const ch = text[start - 1];
    if (/[a-zA-Z0-9_.]/.test(ch)) {
      start -= 1;
    } else {
      break;
    }
  }
  return { start, token: text.slice(start, cursor) };
}

function deepEqual(a: unknown, b: unknown): boolean {
  // Lightweight structural equality for AST comparison. The AST is
  // pure data (no functions / Dates / regexes / circular refs), so
  // JSON.stringify is a fine fingerprint and avoids dragging in a
  // dep just for this.
  return JSON.stringify(a) === JSON.stringify(b);
}

function seedExpr(kind: Expr["kind"], previous: Expr): Expr {
  switch (kind) {
    case "const":
      return { kind: "const", value: previous.kind === "const" ? previous.value : 0 };
    case "var":
      return { kind: "var", path: previous.kind === "var" ? previous.path : "self.hp_ratio" };
    case "bin":
      return {
        kind: "bin",
        op: "add",
        left: previous.kind === "bin" ? previous.left : { kind: "const", value: 0 },
        right: previous.kind === "bin" ? previous.right : { kind: "const", value: 0 },
      };
    case "una":
      return {
        kind: "una",
        op: "neg",
        operand: previous.kind === "una" ? previous.operand : { kind: "const", value: 0 },
      };
    case "if":
      return {
        kind: "if",
        cond: previous.kind === "if" ? previous.cond : { kind: "const", value: 1 },
        then: previous.kind === "if" ? previous.then : { kind: "const", value: 1 },
        otherwise: previous.kind === "if" ? previous.otherwise : { kind: "const", value: 0 },
      };
    case "clamp":
      return {
        kind: "clamp",
        value: previous.kind === "clamp" ? previous.value : { kind: "const", value: 0 },
        lo: previous.kind === "clamp" ? previous.lo : { kind: "const", value: 0 },
        hi: previous.kind === "clamp" ? previous.hi : { kind: "const", value: 1 },
      };
    case "rand":
      // Round 34 / A1: no-operand variant. previous is ignored.
      return { kind: "rand" };
  }
}

const BINARY_OPS: BinOp[] = [
  "add",
  "sub",
  "mul",
  "div",
  "min",
  "max",
  "pow",
  "mod",
  "lt",
  "lte",
  "gt",
  "gte",
  "eq",
  "ne",
  "and",
  "or",
];

const UNARY_OPS: UnaryOp[] = [
  "neg",
  "not",
  "abs",
  "sign",
  "floor",
  "ceil",
  "round",
  "sqrt",
  "ln",
  "exp",
];

/**
 * Round 44 / A6: derived from `buildVarSuggestions()` so the autocomplete
 * list stays in sync with the engine's vocab as new paths land (env.*,
 * scaling.*, event.raw_damage, event.heal_amount, etc.). Computed once
 * at module load.
 *
 * Sub-namespaces (`cooldown_until.<id>`, `status.<id>.stacks`,
 * `stats.<field>`, `extra.<key>`, ...) appear as prefixes — the user
 * types the suffix. Mirror of the Rust `lookup_var` + `lookup_stat`
 * coverage in `wasm-engine/src/policy/user_ability.rs`.
 */
const DEFAULT_VAR_SUGGESTIONS: string[] = buildVarSuggestions();
