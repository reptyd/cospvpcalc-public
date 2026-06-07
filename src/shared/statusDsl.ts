/**
 * Textual DSL for `UserStatusSpec` - the status-editor twin of
 * `abilityDsl.ts`. Parse a block of pseudocode into a complete status
 * spec, and serialize a spec back to text. The textual form and the
 * visual constructor are two views of the SAME `UserStatusSpec`; the
 * editor keeps them in sync by round-tripping through this module.
 *
 * Unlike abilities, a status is a flat parametric record (no nested
 * effect tree), so the grammar is dead simple: a header line plus one
 * `<key> <value>` line per field. One line ⇔ one field gives an exact
 * parse↔serialize bijection - a spec serialized then parsed is
 * deep-equal to the original (locked by statusConstructorCoverage.test).
 *
 * Syntax (indent-significant only in that body lines must be indented
 * past column 0; 2 spaces is canonical):
 *
 *   status user.bleed "Bleed"
 *     polarity negative
 *     stack_rule stacking
 *     max_stacks 10            # or `none` for unbounded
 *     decay 3                  # decay_interval_sec
 *     tick_kind dot_flat
 *     tick_base 5
 *     tick_per_stack 2
 *     tick_interval 1          # tick_interval_sec
 *     regen_mod -50            # regen_mod_pct
 *     regen_mod_per_stack -10  # regen_mod_per_stack_pct
 *     incoming_mult 1.2        # incoming_damage_mult
 *     outgoing_mult 0.9        # outgoing_damage_mult
 *     bite_cooldown_mult 1.1
 *
 * Every body line is optional - a status with only a header inherits all
 * engine defaults. Blank lines and `#` / `//` comments are ignored.
 */

import type {
  UserStatusSpec,
  UserStatusPolarity,
  UserStatusStackRule,
  UserStatusTickKind,
  EffectBatch,
} from "./customAbilityTypes";
import { parseExpr, printExpr } from "./exprDsl";
import { parseEffectBatchBlock, serializeEffectBatch } from "./abilityDsl";

// Programmable extensions: the *_expr keys carry a one-line Expr;
// hook keys (on_apply / on_expire / on_tick) carry an EffectBatch body parsed
// by the shared ability effect grammar.
const EXPR_FIELD_KEYS = [
  "tick_amount_expr",
  "incoming_damage_mult_expr",
  "outgoing_damage_mult_expr",
  "bite_cooldown_mult_expr",
  "regen_mod_expr",
] as const;

export type StatusParseResult =
  | { ok: true; spec: UserStatusSpec }
  | { ok: false; error: string; line?: number };

const POLARITIES: ReadonlySet<string> = new Set([
  "positive",
  "negative",
  "neutral",
]);
const STACK_RULES: ReadonlySet<string> = new Set([
  "stacking",
  "non_stacking",
  "unique",
]);
const TICK_KINDS: ReadonlySet<string> = new Set([
  "none",
  "dot_flat",
  "dot_pct_max_hp",
  "heal_flat",
  "heal_pct_max_hp",
]);

export function parseStatus(source: string): StatusParseResult {
  try {
    const spec = parseStatusInner(source);
    return { ok: true, spec };
  } catch (err) {
    if (err instanceof StatusDslError) {
      return { ok: false, error: err.message, line: err.line };
    }
    throw err;
  }
}

export function serializeStatus(spec: UserStatusSpec): string {
  const lines: string[] = [];
  const id = spec.id || "user.";
  const name = spec.display_name || "";
  lines.push(`status ${id} "${name}"`);

  // `version` is a schema stamp, not a user knob, but emit it when set so
  // the round-trip is lossless (parity with abilityDsl's `version` line).
  if (spec.version !== undefined && spec.version !== 1) {
    lines.push(`  version ${spec.version}`);
  }
  if (spec.polarity !== undefined) lines.push(`  polarity ${spec.polarity}`);
  if (spec.stack_rule !== undefined) {
    lines.push(`  stack_rule ${spec.stack_rule}`);
  }
  if (spec.max_stacks !== undefined) {
    lines.push(`  max_stacks ${spec.max_stacks === null ? "none" : spec.max_stacks}`);
  }
  if (spec.decay_interval_sec !== undefined) {
    lines.push(`  decay ${spec.decay_interval_sec}`);
  }
  if (spec.tick_kind !== undefined) lines.push(`  tick_kind ${spec.tick_kind}`);
  if (spec.tick_base !== undefined) lines.push(`  tick_base ${spec.tick_base}`);
  if (spec.tick_per_stack !== undefined) {
    lines.push(`  tick_per_stack ${spec.tick_per_stack}`);
  }
  if (spec.tick_interval_sec !== undefined) {
    lines.push(`  tick_interval ${spec.tick_interval_sec}`);
  }
  if (spec.regen_mod_pct !== undefined) {
    lines.push(`  regen_mod ${spec.regen_mod_pct}`);
  }
  if (spec.regen_mod_per_stack_pct !== undefined) {
    lines.push(`  regen_mod_per_stack ${spec.regen_mod_per_stack_pct}`);
  }
  if (spec.incoming_damage_mult !== undefined) {
    lines.push(`  incoming_mult ${spec.incoming_damage_mult}`);
  }
  if (spec.outgoing_damage_mult !== undefined) {
    lines.push(`  outgoing_mult ${spec.outgoing_damage_mult}`);
  }
  if (spec.bite_cooldown_mult !== undefined) {
    lines.push(`  bite_cooldown_mult ${spec.bite_cooldown_mult}`);
  }

  // ── Programmable extensions ───────────────────────────
  for (const key of EXPR_FIELD_KEYS) {
    const expr = spec[key];
    if (expr !== undefined) lines.push(`  ${key}: ${printExpr(expr)}`);
  }
  // Lifecycle + bearer-reactive hook batches. All are simple `<name>:` blocks
  // except on_tick (carries an interval). Order is fixed for a stable
  // round-trip; the parser accepts them in any order.
  const emitBatch = (name: string, batch: EffectBatch | undefined) => {
    if (!batch) return;
    lines.push(`  ${name}:`);
    lines.push(...serializeEffectBatch(batch, 2));
  };
  emitBatch("on_apply", spec.on_apply);
  if (spec.on_tick) {
    lines.push(`  on_tick ${spec.on_tick.interval_sec}:`);
    lines.push(...serializeEffectBatch(spec.on_tick.effects, 2));
  }
  emitBatch("on_expire", spec.on_expire);
  emitBatch("on_round_start", spec.on_round_start);
  emitBatch("on_take_damage", spec.on_take_damage);
  emitBatch("on_deal_damage", spec.on_deal_damage);
  emitBatch("on_kill", spec.on_kill);
  emitBatch("on_first_strike", spec.on_first_strike);
  emitBatch("on_heal", spec.on_heal);
  emitBatch("on_status_apply", spec.on_status_apply);
  emitBatch("on_status_expire", spec.on_status_expire);
  emitBatch("on_before_take_damage", spec.on_before_take_damage);
  emitBatch("on_before_deal_damage", spec.on_before_deal_damage);
  emitBatch("on_decay", spec.on_decay);
  emitBatch("on_restack", spec.on_restack);
  return lines.join("\n");
}

// ── Internals ─────────────────────────────────────────────────

type TokenLine = {
  indent: number;
  text: string;
  raw: number; // 1-based line number for errors
};

class StatusDslError extends Error {
  line?: number;
  constructor(message: string, line?: number) {
    super(message);
    this.line = line;
  }
}

function tokenizeLines(source: string): TokenLine[] {
  const out: TokenLine[] = [];
  const raw = source.split(/\r?\n/);
  for (let i = 0; i < raw.length; i += 1) {
    const trimmed = raw[i].replace(/\s+$/, "");
    const lstripped = trimmed.trimStart();
    if (!lstripped || lstripped.startsWith("//") || lstripped.startsWith("#")) {
      continue;
    }
    const indent = trimmed.length - lstripped.length;
    out.push({ indent, text: lstripped, raw: i + 1 });
  }
  return out;
}

function parseStatusInner(source: string): UserStatusSpec {
  const lines = tokenizeLines(source);
  if (lines.length === 0) throw new StatusDslError("empty source");

  const header = lines[0];
  if (header.indent !== 0) {
    throw new StatusDslError("status header must start at column 0", header.raw);
  }
  const m = header.text.match(
    /^status\s+(\S+)\s+(?:"([^"]*)"|'([^']*)'|(\S+))\s*$/,
  );
  if (!m) {
    throw new StatusDslError(
      `expected: status <id> "<display name>" - got: ${header.text}`,
      header.raw,
    );
  }
  const spec: UserStatusSpec = {
    id: m[1],
    display_name: (m[2] ?? m[3] ?? m[4] ?? "").trim(),
  };

  const seen = new Set<string>();
  const claim = (key: string, lineNo: number): void => {
    if (seen.has(key)) throw new StatusDslError(`duplicate key: ${key}`, lineNo);
    seen.add(key);
  };
  let i = 1;
  while (i < lines.length) {
    const line = lines[i];
    if (line.indent === 0) {
      throw new StatusDslError(
        `unexpected top-level line (status body must be indented): ${line.text}`,
        line.raw,
      );
    }

    // ── Hook block: any simple `<name>:` lifecycle/reactive hook, or
    // `on_tick <interval>:`. The indented body is parsed by the SHARED ability
    // effect grammar.
    const hookM = line.text.match(
      /^(on_apply|on_expire|on_round_start|on_take_damage|on_deal_damage|on_kill|on_first_strike|on_heal|on_status_apply|on_status_expire|on_before_take_damage|on_before_deal_damage|on_decay|on_restack)\s*:\s*$/,
    );
    const tickM = line.text.match(/^on_tick\s+([0-9.eE+-]+)\s*:\s*$/);
    if (hookM || tickM) {
      const blockKey = hookM ? hookM[1] : "on_tick";
      claim(blockKey, line.raw);
      const headerIndent = line.indent;
      i += 1;
      const bodyStart = i;
      while (i < lines.length && lines[i].indent > headerIndent) i += 1;
      const body = lines.slice(bodyStart, i);
      // An empty hook body is allowed (mirrors the ability editor's
      // added-but-empty stack) - `parseEffectBatchBlock("")` yields no effects.
      const bodyText = body
        .map((l) => " ".repeat(l.indent) + l.text)
        .join("\n");
      const res = parseEffectBatchBlock(bodyText, blockKey);
      if (!res.ok) {
        throw new StatusDslError(`${blockKey}: ${res.error}`, res.line ?? line.raw);
      }
      const batch: EffectBatch =
        res.when !== undefined
          ? { name: blockKey, effects: res.effects, when: res.when }
          : { name: blockKey, effects: res.effects };
      if (blockKey === "on_tick") {
        const interval = Number(tickM![1]);
        if (!Number.isFinite(interval) || interval <= 0) {
          throw new StatusDslError(`bad on_tick interval: ${tickM![1]}`, line.raw);
        }
        spec.on_tick = { interval_sec: interval, effects: batch };
      } else {
        // blockKey is exactly the (EffectBatch-typed) spec field name.
        (spec as unknown as Record<string, EffectBatch>)[blockKey] = batch;
      }
      continue;
    }

    // ── Expr-override one-liner: `<field>_expr: <expression>` ──
    const exprM = line.text.match(
      /^(tick_amount_expr|incoming_damage_mult_expr|outgoing_damage_mult_expr|bite_cooldown_mult_expr|regen_mod_expr)\s*:\s*(.+)$/,
    );
    if (exprM) {
      const key = exprM[1] as (typeof EXPR_FIELD_KEYS)[number];
      claim(key, line.raw);
      const parsed = parseExpr(exprM[2]);
      if (!parsed.ok) {
        throw new StatusDslError(`expr error in ${key}: ${parsed.error}`, line.raw);
      }
      spec[key] = parsed.expr;
      i += 1;
      continue;
    }

    // ── Flat `<key> <value>` knob ──
    const sp = line.text.indexOf(" ");
    const key = (sp === -1 ? line.text : line.text.slice(0, sp)).trim();
    const value = (sp === -1 ? "" : line.text.slice(sp + 1)).trim();
    claim(key, line.raw);
    applyKey(spec, key, value, line.raw);
    i += 1;
  }
  return spec;
}

function applyKey(
  spec: UserStatusSpec,
  key: string,
  value: string,
  lineNo: number,
): void {
  const num = (min?: number): number => parseNum(value, key, lineNo, min);
  switch (key) {
    case "version":
      spec.version = parseNum(value, key, lineNo, 1);
      return;
    case "polarity":
      if (!POLARITIES.has(value)) {
        throw new StatusDslError(
          `polarity must be positive | negative | neutral (got "${value}")`,
          lineNo,
        );
      }
      spec.polarity = value as UserStatusPolarity;
      return;
    case "stack_rule":
      if (!STACK_RULES.has(value)) {
        throw new StatusDslError(
          `stack_rule must be stacking | non_stacking | unique (got "${value}")`,
          lineNo,
        );
      }
      spec.stack_rule = value as UserStatusStackRule;
      return;
    case "max_stacks":
      // `none` / `unbounded` → null (explicit unbounded), else a number.
      if (value === "none" || value === "unbounded") {
        spec.max_stacks = null;
      } else {
        spec.max_stacks = parseNum(value, key, lineNo, 0);
      }
      return;
    case "decay":
      spec.decay_interval_sec = num(0);
      return;
    case "tick_kind":
      if (!TICK_KINDS.has(value)) {
        throw new StatusDslError(
          `tick_kind must be one of ${[...TICK_KINDS].join(" | ")} (got "${value}")`,
          lineNo,
        );
      }
      spec.tick_kind = value as UserStatusTickKind;
      return;
    case "tick_base":
      spec.tick_base = num();
      return;
    case "tick_per_stack":
      spec.tick_per_stack = num();
      return;
    case "tick_interval":
      spec.tick_interval_sec = num(0);
      return;
    case "regen_mod":
      spec.regen_mod_pct = num();
      return;
    case "regen_mod_per_stack":
      spec.regen_mod_per_stack_pct = num();
      return;
    case "incoming_mult":
      spec.incoming_damage_mult = num(0);
      return;
    case "outgoing_mult":
      spec.outgoing_damage_mult = num(0);
      return;
    case "bite_cooldown_mult":
      spec.bite_cooldown_mult = num(0);
      return;
    default:
      throw new StatusDslError(`unknown status key: ${key}`, lineNo);
  }
}

function parseNum(
  text: string,
  key: string,
  lineNo: number,
  min?: number,
): number {
  if (text === "") {
    throw new StatusDslError(`${key} needs a numeric value`, lineNo);
  }
  const n = Number(text);
  if (!Number.isFinite(n)) {
    throw new StatusDslError(`${key} must be a finite number (got "${text}")`, lineNo);
  }
  if (min !== undefined && n < min) {
    throw new StatusDslError(`${key} must be >= ${min} (got ${n})`, lineNo);
  }
  return n;
}

