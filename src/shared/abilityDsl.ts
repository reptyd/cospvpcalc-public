/**
 * Full-spec textual DSL for UserAbilitySpec - parse a block of
 * pseudocode into a complete ability spec, and print a spec
 * back as text. The textual form is the intended primary
 * authoring path; the visual constructor is a complementary
 * read-and-tweak view of the same AST.
 *
 * Syntax overview (Python-like, indent-significant):
 *
 *   ability user.execute "Execute"
 *     timing really_fast
 *     utility: opp.hp_ratio < 0.3 ? 1000000 : 0
 *     available: opp.hp_ratio < 0.3
 *     on_fire:
 *       set_hp opp 1
 *       cooldown self user.execute 30
 *     on_take_damage:
 *       if event.damage_taken > 100:
 *         deal event.damage_taken * 0.5 to opp
 *
 * Decision exprs (`utility:` / `available:` / `reallyfast_gate:`)
 * use the existing Expr DSL - see exprDsl.ts.
 *
 * Effect statements (under blocks like on_fire / on_take_damage /
 * etc.) are lower-case command-and-args lines. See parseEffect().
 *
 * Indentation: 2 spaces is canonical, but the parser accepts any
 * non-zero indent - child blocks just need to be indented strictly
 * more than their parent. Tabs convert to one indent level each
 * (mixing is fine but discouraged).
 */

import { parseExpr, printExpr } from "./exprDsl";
import type {
  EffectBatch,
  EffectKind,
  EffectTarget,
  Expr,
  HpPolicy,
  ModifierMode,
  TickTrigger,
  TriggerHooks,
  UserAbilitySpec,
} from "./customAbilityTypes";

export type ParseResult =
  | { ok: true; spec: UserAbilitySpec }
  | { ok: false; error: string; line?: number };

export function parseAbility(source: string): ParseResult {
  try {
    const lines = tokenizeLines(source);
    const parser = new Parser(lines);
    const spec = parser.parseAbility();
    return { ok: true, spec };
  } catch (err) {
    if (err instanceof DslError) {
      return { ok: false, error: err.message, line: err.line };
    }
    throw err;
  }
}

export function printAbility(spec: UserAbilitySpec): string {
  const lines: string[] = [];
  const id = spec.id || "user.";
  const name = spec.display_name || "";
  lines.push(`ability ${id} "${name}"`);
  if (spec.version && spec.version !== 1) {
    lines.push(`  version ${spec.version}`);
  }
  if (spec.timing_mode_override) {
    lines.push(`  timing ${spec.timing_mode_override}`);
  }
  if (spec.timing_user_override) {
    lines.push(`  timing ${spec.timing_user_override}`);
  }
  // Levels block. Emit only when the spec has actual
  // level shape - single-level abilities (the earlier default) print
  // exactly as before.
  const levels = spec.levels ?? 1;
  const defaultLevel = spec.default_level ?? 1;
  const scalingEntries = spec.scaling ? Object.entries(spec.scaling) : [];
  if (levels !== 1 || defaultLevel !== 1 || scalingEntries.length > 0) {
    if (levels !== 1) lines.push(`  levels ${levels}`);
    if (defaultLevel !== 1) lines.push(`  default_level ${defaultLevel}`);
    // Stable order: alphabetical on keys - matches the BTreeMap ordering
    // the Rust serializer emits, so the DSL round-trip is deterministic
    // even if the in-memory map was constructed in a different order.
    scalingEntries.sort(([a], [b]) => a.localeCompare(b));
    for (const [key, values] of scalingEntries) {
      lines.push(`  scaling ${key}: ${values.join(", ")}`);
    }
  }
  lines.push(`  utility: ${printExpr(spec.utility)}`);
  lines.push(`  available: ${printExpr(spec.is_available)}`);
  if (spec.really_fast_gate) {
    lines.push(`  reallyfast_gate: ${printExpr(spec.really_fast_gate)}`);
  }
  // 2026-05-12: helper - when a trigger / on_fire batch has a B6
  // gate, emit `when: <expr>` as the first indented line of the
  // block. parseBatchBody recognises this shape and rehydrates the
  // gate on the way back in.
  const pushBatch = (header: string, batch: EffectBatch, effectsList: EffectKind[]) => {
    lines.push(header);
    if (batch.when) {
      lines.push(`    when: ${printExpr(batch.when)}`);
    }
    pushEffectLines(lines, effectsList, 2);
  };
  if (spec.on_fire) {
    pushBatch(`  on_fire:`, spec.on_fire, spec.on_fire.effects);
  }
  const t = spec.triggers;
  if (t) {
    if (t.on_round_start) {
      pushBatch(`  on_round_start:`, t.on_round_start, t.on_round_start.effects);
    }
    if (t.on_take_damage) {
      pushBatch(`  on_take_damage:`, t.on_take_damage, t.on_take_damage.effects);
    }
    if (t.on_deal_damage) {
      pushBatch(`  on_deal_damage:`, t.on_deal_damage, t.on_deal_damage.effects);
    }
    if (t.on_tick) {
      pushBatch(
        `  on_tick ${t.on_tick.interval_sec}:`,
        t.on_tick.effects,
        t.on_tick.effects.effects,
      );
    }
    if (t.on_status_apply) {
      pushBatch(`  on_status_apply:`, t.on_status_apply, t.on_status_apply.effects);
    }
    if (t.on_status_expire) {
      pushBatch(`  on_status_expire:`, t.on_status_expire, t.on_status_expire.effects);
    }
    if (t.on_kill) {
      pushBatch(`  on_kill:`, t.on_kill, t.on_kill.effects);
    }
    if (t.on_first_strike) {
      pushBatch(`  on_first_strike:`, t.on_first_strike, t.on_first_strike.effects);
    }
    if (t.on_heal) {
      pushBatch(`  on_heal:`, t.on_heal, t.on_heal.effects);
    }
    if (t.on_active_end) {
      pushBatch(`  on_active_end:`, t.on_active_end, t.on_active_end.effects);
    }
    if (t.on_before_take_damage) {
      pushBatch(`  on_before_take_damage:`, t.on_before_take_damage, t.on_before_take_damage.effects);
    }
    if (t.on_before_deal_damage) {
      pushBatch(`  on_before_deal_damage:`, t.on_before_deal_damage, t.on_before_deal_damage.effects);
    }
  }
  return lines.join("\n");
}

// ── Reusable effect-batch sub-grammar ─────────────────────────
// The status DSL composes the SAME effect grammar for its hooks
// (on_apply / on_tick / on_expire) instead of duplicating it. These two
// helpers expose the batch serialize/parse the ability printer/parser already
// use, so the two DSLs can never drift.

/**
 * Serialize an EffectBatch body - the optional `when:` gate plus the effect
 * lines - at the given indent depth (2 spaces per level). The caller emits
 * the block header (e.g. `  on_apply:`); this emits the indented body.
 */
export function serializeEffectBatch(batch: EffectBatch, depth: number): string[] {
  const out: string[] = [];
  if (batch.when) {
    out.push(`${"  ".repeat(depth)}when: ${printExpr(batch.when)}`);
  }
  pushEffectLines(out, batch.effects, depth);
  return out;
}

export type EffectBatchBlockResult =
  | { ok: true; when?: Expr; effects: EffectKind[] }
  | { ok: false; error: string; line?: number };

/**
 * Parse a standalone EffectBatch block body (the indented lines under a
 * trigger/hook header) into `{ when?, effects }`, reusing the full effect
 * grammar (compositors, schedule, choose, the when-gate). `bodyText` is the
 * raw indented body; an empty body yields an empty effect list.
 */
export function parseEffectBatchBlock(
  bodyText: string,
  blockName = "block",
): EffectBatchBlockResult {
  try {
    const lines = tokenizeLines(bodyText);
    if (lines.length === 0) return { ok: true, effects: [] };
    const parser = new Parser(lines);
    const minIndent = lines[0].indent;
    const { when, effects } = parser.parseBatchBody(minIndent, lines[0].raw, blockName);
    if (!parser.eof()) {
      const extra = parser.peek()!;
      return {
        ok: false,
        error: `unexpected line in ${blockName}: ${extra.text}`,
        line: extra.raw,
      };
    }
    return when === undefined ? { ok: true, effects } : { ok: true, when, effects };
  } catch (err) {
    if (err instanceof DslError) {
      return { ok: false, error: err.message, line: err.line };
    }
    throw err;
  }
}

// ── Internals ─────────────────────────────────────────────────

type TokenLine = {
  indent: number;
  text: string;
  raw: number; // 1-based line number for errors
};

class DslError extends Error {
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
    const line = raw[i];
    const trimmed = line.replace(/\s+$/, "");
    // Skip blank lines and comments (// or #).
    const lstripped = trimmed.trimStart();
    if (!lstripped || lstripped.startsWith("//") || lstripped.startsWith("#")) {
      continue;
    }
    const indent = trimmed.length - lstripped.length;
    out.push({ indent, text: lstripped, raw: i + 1 });
  }
  return out;
}

class Parser {
  i = 0;
  private readonly lines: TokenLine[];
  constructor(lines: TokenLine[]) {
    this.lines = lines;
  }

  eof(): boolean {
    return this.i >= this.lines.length;
  }
  peek(): TokenLine | undefined {
    return this.lines[this.i];
  }
  advance(): TokenLine {
    return this.lines[this.i++];
  }

  parseAbility(): UserAbilitySpec {
    if (this.eof()) throw new DslError("empty source");
    const header = this.advance();
    if (header.indent !== 0) {
      throw new DslError("ability header must start at column 0", header.raw);
    }
    const m = header.text.match(/^ability\s+(\S+)\s+(?:"([^"]*)"|'([^']*)'|(\S+))\s*$/);
    if (!m) {
      throw new DslError(
        `expected: ability <id> "<display name>" - got: ${header.text}`,
        header.raw,
      );
    }
    const id = m[1];
    const display_name = (m[2] ?? m[3] ?? m[4] ?? "").trim();
    const baseIndent = this.peek()?.indent ?? 0;
    const spec: UserAbilitySpec = {
      version: 1,
      id,
      display_name,
      utility: { kind: "const", value: 0 },
      is_available: { kind: "const", value: 1 },
    };
    let utilitySet = false;
    let availableSet = false;
    while (!this.eof() && this.peek()!.indent >= baseIndent) {
      const line = this.advance();
      // metadata one-liners
      const verM = line.text.match(/^version\s+(\d+)$/);
      if (verM) {
        spec.version = Number(verM[1]);
        continue;
      }
      const timingM = line.text.match(/^timing\s+(\S+)$/);
      if (timingM) {
        const mode = timingM[1];
        if (
          mode === "really_fast" ||
          mode === "fast" ||
          mode === "semi_ideal" ||
          mode === "ideal" ||
          mode === "extreme"
        ) {
          spec.timing_mode_override = mode;
        } else if (mode.startsWith("user.")) {
          spec.timing_user_override = mode;
        } else {
          throw new DslError(`unknown timing: ${mode}`, line.raw);
        }
        continue;
      }
      // Levels metadata.
      const levelsM = line.text.match(/^levels\s+(\d+)\s*$/);
      if (levelsM) {
        const n = Number(levelsM[1]);
        if (!Number.isInteger(n) || n < 1) {
          throw new DslError(
            `levels must be a positive integer, got ${levelsM[1]}`,
            line.raw,
          );
        }
        spec.levels = n;
        continue;
      }
      const defaultLevelM = line.text.match(/^default_level\s+(\d+)\s*$/);
      if (defaultLevelM) {
        const n = Number(defaultLevelM[1]);
        if (!Number.isInteger(n) || n < 1) {
          throw new DslError(
            `default_level must be a positive integer, got ${defaultLevelM[1]}`,
            line.raw,
          );
        }
        spec.default_level = n;
        continue;
      }
      const scalingM = line.text.match(/^scaling\s+([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.+)$/);
      if (scalingM) {
        const key = scalingM[1];
        const valueText = scalingM[2];
        const parts = valueText.split(",").map((s) => s.trim());
        const numbers: number[] = [];
        for (const p of parts) {
          if (!p) {
            throw new DslError(
              `empty value in scaling ${key} list`,
              line.raw,
            );
          }
          const n = Number(p);
          if (!Number.isFinite(n)) {
            throw new DslError(
              `scaling ${key}: "${p}" is not a finite number`,
              line.raw,
            );
          }
          numbers.push(n);
        }
        spec.scaling = spec.scaling ?? {};
        spec.scaling[key] = numbers;
        continue;
      }
      // decision exprs (one-liner):  key: <expr>
      const exprM = line.text.match(/^(utility|available|is_available|reallyfast_gate|really_fast_gate)\s*:\s*(.+)$/);
      if (exprM) {
        const key = exprM[1];
        const exprText = exprM[2];
        const parsed = parseExpr(exprText);
        if (!parsed.ok) {
          throw new DslError(`expr error in ${key}: ${parsed.error}`, line.raw);
        }
        if (key === "utility") {
          spec.utility = parsed.expr;
          utilitySet = true;
        } else if (key === "available" || key === "is_available") {
          spec.is_available = parsed.expr;
          availableSet = true;
        } else {
          spec.really_fast_gate = parsed.expr;
        }
        continue;
      }
      // block sections
      const blockM = line.text.match(/^(on_fire|on_round_start|on_take_damage|on_deal_damage|on_status_apply|on_status_expire|on_kill|on_first_strike|on_heal|on_active_end|on_before_take_damage|on_before_deal_damage)\s*:\s*$/);
      if (blockM) {
        const block = blockM[1] as keyof TriggerHooks | "on_fire";
        const { when, effects } = this.parseBatchBody(line.indent + 1, line.raw, block);
        const batch: EffectBatch = when
          ? { name: block, effects, when }
          : { name: block, effects };
        if (block === "on_fire") {
          spec.on_fire = batch;
        } else {
          spec.triggers = spec.triggers ?? {};
          (spec.triggers as Record<string, EffectBatch>)[block] = batch;
        }
        continue;
      }
      const tickM = line.text.match(/^on_tick\s+([0-9.eE+-]+)\s*:\s*$/);
      if (tickM) {
        const interval = Number(tickM[1]);
        if (!Number.isFinite(interval) || interval <= 0) {
          throw new DslError(`bad on_tick interval: ${tickM[1]}`, line.raw);
        }
        const { when, effects } = this.parseBatchBody(line.indent + 1, line.raw, "on_tick");
        const batch: EffectBatch = when
          ? { name: "on_tick", effects, when }
          : { name: "on_tick", effects };
        const tick: TickTrigger = {
          interval_sec: interval,
          effects: batch,
        };
        spec.triggers = spec.triggers ?? {};
        spec.triggers.on_tick = tick;
        continue;
      }
      throw new DslError(`unrecognized statement: ${line.text}`, line.raw);
    }
    if (!utilitySet && !spec.on_fire && !spec.triggers) {
      throw new DslError("ability has no body");
    }
    void availableSet;
    return spec;
  }

  /**
   * 2026-05-12: parse a trigger / on_fire block body. Same shape as
   * `parseEffectBlock` but ALSO accepts an optional leading
   * `when: <expr>` line that becomes the EffectBatch's batch-level
   * gate. `parseEffectBlock` doesn't handle `when` directly
   * because nested compositors (`if:` / `repeat:` etc) don't need
   * the gate - it lives one level higher.
   */
  parseBatchBody(
    minIndent: number,
    blockLineNo: number,
    blockName: string,
  ): { when?: Expr; effects: EffectKind[] } {
    let when: Expr | undefined;
    // Look for `when: <expr>` as the very first indented line.
    if (!this.eof() && this.peek()!.indent >= minIndent) {
      const head = this.peek()!;
      const m = head.text.match(/^when\s*:\s*(.+)$/);
      if (m) {
        const parsed = parseExpr(m[1]);
        if (!parsed.ok) {
          throw new DslError(
            `when expr in ${blockName}: ${parsed.error}`,
            head.raw,
          );
        }
        when = parsed.expr;
        this.advance();
      }
    }
    const effects = this.parseEffectBlock(minIndent);
    void blockLineNo;
    return when === undefined ? { effects } : { when, effects };
  }

  parseEffectBlock(minIndent: number): EffectKind[] {
    const out: EffectKind[] = [];
    while (!this.eof() && this.peek()!.indent >= minIndent) {
      const line = this.peek()!;
      // Block-form effect (ends with `:`)
      if (line.text.endsWith(":")) {
        this.advance();
        const effect = this.parseBlockEffect(line);
        if (effect) out.push(effect);
        continue;
      }
      this.advance();
      const effect = parseEffectStatement(line.text, line.raw);
      out.push(effect);
    }
    return out;
  }

  parseBlockEffect(line: TokenLine): EffectKind | null {
    const ifM = line.text.match(/^if\s+(.+)\s*:\s*$/);
    if (ifM) {
      const cond = parseExpr(ifM[1]);
      if (!cond.ok) {
        throw new DslError(`if cond expr error: ${cond.error}`, line.raw);
      }
      const then = this.parseEffectBlock(line.indent + 1);
      let otherwise: EffectKind[] = [];
      // Optional `else:` at same indent
      if (
        !this.eof() &&
        this.peek()!.indent === line.indent &&
        this.peek()!.text === "else:"
      ) {
        this.advance();
        otherwise = this.parseEffectBlock(line.indent + 1);
      }
      return { kind: "conditional", cond: cond.expr, then, otherwise };
    }
    const repeatM = line.text.match(/^repeat\s+(\d+)\s*:\s*$/);
    if (repeatM) {
      const count = Number(repeatM[1]);
      const body = this.parseEffectBlock(line.indent + 1);
      return { kind: "repeat", count, body };
    }
    const chanceM = line.text.match(/^chance\s+(.+)\s*:\s*$/);
    if (chanceM) {
      const prob = parseExpr(chanceM[1]);
      if (!prob.ok) throw new DslError(`chance prob error: ${prob.error}`, line.raw);
      const then = this.parseEffectBlock(line.indent + 1);
      return { kind: "chance", probability: prob.expr, then };
    }
    // schedule <delay_sec> [as <name>]:
    // The `as <name>` suffix is the named-schedule form
    // that pairs with `cancel_schedule` / `reschedule`. Omitting it
    // keeps the legacy fire-and-forget semantics.
    const schedM = line.text.match(/^schedule\s+([0-9.eE+-]+)(?:\s+as\s+(\S+))?\s*:\s*$/);
    if (schedM) {
      const delay = Number(schedM[1]);
      const name = schedM[2];
      const effects = this.parseEffectBlock(line.indent + 1);
      return name
        ? { kind: "schedule_effect", delay_sec: delay, effects, name }
        : { kind: "schedule_effect", delay_sec: delay, effects };
    }
    // choose:
    //   weight <expr>:
    //     <effects>
    //   weight <expr>:
    //     <effects>
    // Weighted one-of-N picker. Every child of `choose:`
    // must be a `weight <expr>:` line; the effects under each weight
    // are nested one indent level deeper. An empty `choose:` (no
    // children) round-trips to `{ branches: [] }`, which the engine
    // treats as a no-op.
    const chooseM = line.text.match(/^choose\s*:\s*$/);
    if (chooseM) {
      const branches: Array<{ weight: Expr; effects: EffectKind[] }> = [];
      while (!this.eof() && this.peek()!.indent > line.indent) {
        const branchLine = this.peek()!;
        const wM = branchLine.text.match(/^weight\s+(.+)\s*:\s*$/);
        if (!wM) {
          throw new DslError(
            `choose: only 'weight <expr>:' children allowed, got "${branchLine.text}"`,
            branchLine.raw,
          );
        }
        this.advance();
        const weightR = parseExpr(wM[1]);
        if (!weightR.ok) {
          throw new DslError(
            `choose branch weight: ${weightR.error}`,
            branchLine.raw,
          );
        }
        const effects = this.parseEffectBlock(branchLine.indent + 1);
        branches.push({ weight: weightR.expr, effects });
      }
      return { kind: "choose", branches };
    }
    throw new DslError(`unknown block effect: ${line.text}`, line.raw);
  }
}

// ── Effect-statement parser (single-line effects) ──────────────

function parseEffectStatement(text: string, lineNo: number): EffectKind {
  // Tokens are whitespace-separated; we match against a few shapes.
  // Try literal patterns first (simpler), then Expr-backed shapes.
  const t = text.trim();

  // deal <num-or-expr> to <side>
  let m = t.match(/^deal\s+(.+?)\s+to\s+(self|opp|opponent|caster)$/);
  if (m) {
    const target = parseTarget(m[2], lineNo);
    const amountText = m[1];
    const num = tryParseNumber(amountText);
    if (num !== null) {
      return { kind: "deal_direct_damage", target, amount: num };
    }
    const expr = parseExpr(amountText);
    if (!expr.ok) throw new DslError(`deal amount: ${expr.error}`, lineNo);
    return { kind: "deal_expr_damage", target, amount: expr.expr };
  }

  // heal <side> <num-or-expr>
  m = t.match(/^heal\s+(self|opp|opponent|caster)\s+(.+)$/);
  if (m) {
    const target = parseTarget(m[1], lineNo);
    const num = tryParseNumber(m[2]);
    if (num !== null) {
      return { kind: "heal_hp", target, amount: num };
    }
    const expr = parseExpr(m[2]);
    if (!expr.ok) throw new DslError(`heal amount: ${expr.error}`, lineNo);
    return { kind: "heal_expr_amount", target, amount: expr.expr };
  }

  // apply [<id> x<count>, <id> x<count>, ...] to <side>
  // Array form. Must precede the single-status pattern
  // below so the bracket prefix wins disambiguation.
  m = t.match(/^apply\s*\[(.+)\]\s+to\s+(self|opp|opponent|caster)\s*$/);
  if (m) {
    const target = parseTarget(m[2], lineNo);
    const entries = m[1].split(",").map((s) => s.trim()).filter((s) => s.length > 0);
    if (entries.length === 0) {
      throw new DslError(`apply [...] needs at least one entry`, lineNo);
    }
    const statuses = entries.map((entry) => {
      const em = entry.match(/^(\S+)\s+x([0-9.]+)$/);
      if (!em) {
        throw new DslError(`apply entry must be "<status_id> x<count>": ${entry}`, lineNo);
      }
      return { status_id: em[1], stacks: Number(em[2]), source_ability: null };
    });
    return { kind: "apply_statuses_to_target", target, statuses };
  }

  // apply <status_id> x<count> to <side>
  m = t.match(/^apply\s+(\S+)\s+x(.+?)\s+to\s+(self|opp|opponent|caster)$/);
  if (m) {
    const status_id = m[1];
    const target = parseTarget(m[3], lineNo);
    const num = tryParseNumber(m[2]);
    if (num !== null) {
      return {
        kind: "apply_status_to_target",
        target,
        status: { status_id, stacks: num, source_ability: null },
      };
    }
    const expr = parseExpr(m[2]);
    if (!expr.ok) throw new DslError(`apply stacks: ${expr.error}`, lineNo);
    return {
      kind: "apply_status_expr_stacks",
      target,
      status_id,
      stacks: expr.expr,
    };
  }

  // cleanse <side>
  m = t.match(/^cleanse\s+(self|opp|opponent|caster)$/);
  if (m) {
    return {
      kind: "cleanse_fortify_removable_statuses",
      target: parseTarget(m[1], lineNo),
    };
  }

  // cooldown <side> <id> for <num-or-expr>     OR     cooldown <side> <id> <num-or-expr>
  // 2026-05-12: relaxed the duration to accept an Expr (e.g. `scaling.window`).
  // Plain numbers still emit `set_cooldown_until` for spec-shape stability;
  // anything non-numeric routes to `set_cooldown_until_expr`.
  m = t.match(/^cooldown\s+(self|opp|opponent|caster)\s+(\S+)\s+(?:for\s+)?(.+)$/);
  if (m) {
    const target = parseTarget(m[1], lineNo);
    const num = tryParseNumber(m[3]);
    if (num !== null) {
      return {
        kind: "set_cooldown_until",
        target,
        cooldown_id: m[2],
        duration_sec: num,
      };
    }
    const expr = parseExpr(m[3]);
    if (!expr.ok) throw new DslError(`cooldown duration: ${expr.error}`, lineNo);
    return {
      kind: "set_cooldown_until_expr",
      target,
      cooldown_id: m[2],
      duration_sec: expr.expr,
    };
  }

  // active <side> <id> for <num-or-expr>
  m = t.match(/^active\s+(self|opp|opponent|caster)\s+(\S+)\s+(?:for\s+)?(.+)$/);
  if (m) {
    const target = parseTarget(m[1], lineNo);
    const num = tryParseNumber(m[3]);
    if (num !== null) {
      return {
        kind: "set_active_until",
        target,
        active_id: m[2],
        duration_sec: num,
      };
    }
    const expr = parseExpr(m[3]);
    if (!expr.ok) throw new DslError(`active duration: ${expr.error}`, lineNo);
    return {
      kind: "set_active_until_expr",
      target,
      active_id: m[2],
      duration_sec: expr.expr,
    };
  }

  // pay <side> <fraction>%
  m = t.match(/^pay\s+(self|opp|opponent|caster)\s+([0-9.]+)\s*%$/);
  if (m) {
    return {
      kind: "pay_self_cost_max_hp_fraction",
      target: parseTarget(m[1], lineNo),
      fraction: Number(m[2]) / 100,
    };
  }

  // set_hp <side> <num-or-expr>
  m = t.match(/^set_hp\s+(self|opp|opponent|caster)\s+(.+)$/);
  if (m) {
    const target = parseTarget(m[1], lineNo);
    const num = tryParseNumber(m[2]);
    if (num !== null) return { kind: "set_hp", target, value: num };
    const expr = parseExpr(m[2]);
    if (!expr.ok) throw new DslError(`set_hp value: ${expr.error}`, lineNo);
    return { kind: "set_hp_expr", target, value: expr.expr };
  }

  // transfer <num> hp from <side> to <side>
  m = t.match(/^transfer\s+([0-9.]+)\s+hp\s+from\s+(self|opp|opponent|caster)\s+to\s+(self|opp|opponent|caster)$/);
  if (m) {
    return {
      kind: "transfer_hp",
      from: parseTarget(m[2], lineNo),
      to: parseTarget(m[3], lineNo),
      amount: Number(m[1]),
    };
  }

  // swap_hp
  if (t === "swap_hp") return { kind: "swap_hp_ratio" };

  // clear <side> [<id>, <id>, ...]
  // Array form. Must precede the single-status pattern
  // below so the bracket prefix wins disambiguation.
  m = t.match(/^clear\s+(self|opp|opponent|caster)\s+\[(.+)\]\s*$/);
  if (m) {
    const target = parseTarget(m[1], lineNo);
    const status_ids = m[2]
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    if (status_ids.length === 0) {
      throw new DslError(`clear [...] needs at least one status id`, lineNo);
    }
    return { kind: "clear_statuses", target, status_ids };
  }

  // clear <side> <status_id>
  m = t.match(/^clear\s+(self|opp|opponent|caster)\s+(\S+)$/);
  if (m) {
    return {
      kind: "clear_status",
      target: parseTarget(m[1], lineNo),
      status_id: m[2],
    };
  }

  // dispel <side>
  m = t.match(/^dispel\s+(self|opp|opponent|caster)$/);
  if (m) {
    return {
      kind: "dispel_all_statuses",
      target: parseTarget(m[1], lineNo),
    };
  }

  // modify_status <side> <id> add|set <num>
  m = t.match(/^modify_status\s+(self|opp|opponent|caster)\s+(\S+)\s+(add|set|mul)\s+(.+)$/);
  if (m) {
    return {
      kind: "modify_status_stacks",
      target: parseTarget(m[1], lineNo),
      status_id: m[2],
      mode: m[3] as ModifierMode,
      value: Number(m[4]),
    };
  }

  // reset_cooldown <side> <id>     /     reset_active <side> <id>
  m = t.match(/^reset_(cooldown|active)\s+(self|opp|opponent|caster)\s+(\S+)$/);
  if (m) {
    return {
      kind: "cooldown_reset",
      target: parseTarget(m[2], lineNo),
      cooldown_id: m[3],
      which: m[1] === "cooldown" ? "cooldown" : "active_until",
    };
  }

  // interrupt <side> <secs>
  m = t.match(/^interrupt\s+(self|opp|opponent|caster)\s+([0-9.]+)$/);
  if (m) {
    return {
      kind: "interrupt_next_hit",
      target: parseTarget(m[1], lineNo),
      delay_sec: Number(m[2]),
    };
  }

  // consume_breath / restore_breath <side> <secs>
  m = t.match(/^(consume_breath|restore_breath)\s+(self|opp|opponent|caster)\s+([0-9.]+)$/);
  if (m) {
    return {
      kind: m[1] as "consume_breath" | "restore_breath",
      target: parseTarget(m[2], lineNo),
      amount: Number(m[3]),
    };
  }

  // modify_stat <side> <field> add|mul|set <num-or-expr> for <num-or-expr>
  // Disambiguation: if BOTH value and duration parse as plain numbers,
  // emit `modify_stat` (numeric kind). Otherwise emit `modify_stat_expr`
  // and store the parsed Exprs. The printer for both kinds uses the
  // same `modify_stat` token, so the parser owns the distinction.
  m = t.match(/^modify_stat\s+(self|opp|opponent|caster)\s+(\S+)\s+(add|mul|set)\s+(.+?)\s+for\s+(.+)$/);
  if (m) {
    const valueText = m[4];
    const durationText = m[5];
    const valueNum = Number(valueText);
    const durationNum = Number(durationText);
    const valueIsPlainNumber =
      valueText.trim() !== "" && Number.isFinite(valueNum) &&
      String(valueNum) === valueText.trim();
    const durationIsPlainNumber =
      durationText.trim() !== "" && Number.isFinite(durationNum) &&
      String(durationNum) === durationText.trim();
    if (valueIsPlainNumber && durationIsPlainNumber) {
      return {
        kind: "modify_stat",
        target: parseTarget(m[1], lineNo),
        field: m[2],
        mode: m[3] as ModifierMode,
        value: valueNum,
        duration_sec: durationNum,
      };
    }
    const valueExpr = parseExpr(valueText);
    if (!valueExpr.ok) throw new DslError(`modify_stat value: ${valueExpr.error}`, lineNo);
    const durationExpr = parseExpr(durationText);
    if (!durationExpr.ok) throw new DslError(`modify_stat duration: ${durationExpr.error}`, lineNo);
    return {
      kind: "modify_stat_expr",
      target: parseTarget(m[1], lineNo),
      field: m[2],
      mode: m[3] as ModifierMode,
      value: valueExpr.expr,
      duration_sec: durationExpr.expr,
    };
  }

  // form_swap [<field> <mode> <value>, ...] on <side> for <num> hp:<ratio|absolute|set <num>>
  m = t.match(
    /^form_swap\s*\[(.+)\]\s+on\s+(self|opp|opponent|caster)\s+for\s+(\S+)\s+hp:(.+)$/,
  );
  if (m) {
    const target = parseTarget(m[2], lineNo);
    const durationNum = Number(m[3]);
    if (!Number.isFinite(durationNum)) {
      throw new DslError(`form_swap duration must be a number: ${m[3]}`, lineNo);
    }
    const entries = m[1].split(",").map((s) => s.trim()).filter((s) => s.length > 0);
    if (entries.length === 0) {
      throw new DslError(`form_swap [...] needs at least one stat change`, lineNo);
    }
    const stat_changes = entries.map((entry) => {
      const em = entry.match(/^(\S+)\s+(add|mul|set)\s+(\S+)$/);
      if (!em) {
        throw new DslError(
          `form_swap entry must be "<field> <add|mul|set> <value>": ${entry}`,
          lineNo,
        );
      }
      const value = Number(em[3]);
      if (!Number.isFinite(value)) {
        throw new DslError(`form_swap value must be a number: ${em[3]}`, lineNo);
      }
      return { field: em[1], mode: em[2] as ModifierMode, value };
    });
    const policyText = m[4].trim();
    let hp_policy: HpPolicy;
    if (policyText === "ratio") {
      hp_policy = { kind: "ratio" };
    } else if (policyText === "absolute") {
      hp_policy = { kind: "absolute" };
    } else {
      const sm = policyText.match(/^set\s+(\S+)$/);
      if (!sm) {
        throw new DslError(
          `form_swap hp policy must be ratio|absolute|set <value>: ${policyText}`,
          lineNo,
        );
      }
      const setVal = Number(sm[1]);
      if (!Number.isFinite(setVal)) {
        throw new DslError(`form_swap hp:set value must be a number: ${sm[1]}`, lineNo);
      }
      hp_policy = { kind: "set", value: setVal };
    }
    return { kind: "form_swap", target, stat_changes, duration_sec: durationNum, hp_policy };
  }

  // set_extra <side> <key> = <num-or-expr>
  m = t.match(/^set_extra\s+(self|opp|opponent|caster)\s+(\S+)\s*=\s*(.+)$/);
  if (m) {
    const target = parseTarget(m[1], lineNo);
    const expr = parseExpr(m[3]);
    if (!expr.ok) throw new DslError(`set_extra value: ${expr.error}`, lineNo);
    return { kind: "set_extra", target, key: m[2], value: expr.expr };
  }

  // inc_extra <side> <key> [+=] <num-or-expr>
  m = t.match(/^inc_extra\s+(self|opp|opponent|caster)\s+(\S+)\s*(?:\+=)?\s*(.+)$/);
  if (m) {
    const target = parseTarget(m[1], lineNo);
    const expr = parseExpr(m[3]);
    if (!expr.ok) throw new DslError(`inc_extra amount: ${expr.error}`, lineNo);
    return { kind: "increment_extra", target, key: m[2], amount: expr.expr };
  }

  // Numbered-key extras arrays:
  //   push_extra <side> <key> <num-or-expr>
  //   clear_array <side> <key>
  m = t.match(/^push_extra\s+(self|opp|opponent|caster)\s+(\S+)\s+(.+)$/);
  if (m) {
    const target = parseTarget(m[1], lineNo);
    const expr = parseExpr(m[3]);
    if (!expr.ok) throw new DslError(`push_extra value: ${expr.error}`, lineNo);
    return { kind: "push_extra", target, key: m[2], value: expr.expr };
  }
  m = t.match(/^clear_array\s+(self|opp|opponent|caster)\s+(\S+)\s*$/);
  if (m) {
    const target = parseTarget(m[1], lineNo);
    return { kind: "clear_extra_array", target, key: m[2] };
  }

  // detonate <side> <status_id> @<num-or-expr>
  m = t.match(/^detonate\s+(self|opp|opponent|caster)\s+(\S+)\s*@\s*(.+)$/);
  if (m) {
    const target = parseTarget(m[1], lineNo);
    const expr = parseExpr(m[3]);
    if (!expr.ok) throw new DslError(`detonate per-stack: ${expr.error}`, lineNo);
    return {
      kind: "consume_status_for_damage",
      target,
      status_id: m[2],
      damage_per_stack: expr.expr,
    };
  }

  // extend <side> <status_id> <secs>
  m = t.match(/^extend\s+(self|opp|opponent|caster)\s+(\S+)\s+(-?[0-9.]+)$/);
  if (m) {
    return {
      kind: "extend_status",
      target: parseTarget(m[1], lineNo),
      status_id: m[2],
      seconds: Number(m[3]),
    };
  }

  // tick_next <side> <status_id> @<absolute_time>
  // Re-arm the named status's next DOT-style tick. Engine
  // floors the timestamp at sim time, so passing a past value collapses
  // to "fire on the next status-tick phase".
  m = t.match(/^tick_next\s+(self|opp|opponent|caster)\s+(\S+)\s+@\s*(-?[0-9.eE+-]+)\s*$/);
  if (m) {
    return {
      kind: "set_status_next_tick",
      target: parseTarget(m[1], lineNo),
      status_id: m[2],
      absolute_time: Number(m[3]),
    };
  }

  // decay_next <side> <status_id> @<absolute_time>
  // Sibling of `tick_next` for the stack-decay timer. Same semantics:
  // engine floors at current sim time; absent statuses are silent no-ops.
  m = t.match(/^decay_next\s+(self|opp|opponent|caster)\s+(\S+)\s+@\s*(-?[0-9.eE+-]+)\s*$/);
  if (m) {
    return {
      kind: "set_status_next_decay",
      target: parseTarget(m[1], lineNo),
      status_id: m[2],
      absolute_time: Number(m[3]),
    };
  }

  // cancel_schedule <name>
  // Remove all queued scheduled entries on the caster's
  // side whose `name` matches. No-op if no entries match.
  m = t.match(/^cancel_schedule\s+(\S+)\s*$/);
  if (m) {
    return { kind: "cancel_schedule", name: m[1] };
  }

  // reschedule <name> <delay_sec>
  // Find the first queued entry with the matching `name`
  // and move its due time to `time + delay_sec` (clamped to [0, 600]).
  m = t.match(/^reschedule\s+(\S+)\s+(-?[0-9.eE+-]+)\s*$/);
  if (m) {
    return {
      kind: "reschedule",
      name: m[1],
      delay_sec: Number(m[2]),
    };
  }

  // trigger <ability_id>
  m = t.match(/^trigger\s+(\S+)$/);
  if (m) {
    return { kind: "trigger_ability", ability_id: m[1] };
  }

  // snapshot <side> <key>
  m = t.match(/^snapshot\s+(self|opp|opponent|caster)\s+(\S+)$/);
  if (m) {
    return {
      kind: "record_snapshot",
      target: parseTarget(m[1], lineNo),
      key: m[2],
    };
  }
  // restore <side> <key>
  m = t.match(/^restore\s+(self|opp|opponent|caster)\s+(\S+)$/);
  if (m) {
    return {
      kind: "restore_snapshot",
      target: parseTarget(m[1], lineNo),
      key: m[2],
    };
  }

  // deal_typed bite|breath|true <num> to <side>
  m = t.match(/^deal_typed\s+(bite|breath|true)\s+([0-9.]+)\s+to\s+(self|opp|opponent|caster)$/);
  if (m) {
    return {
      kind: "deal_typed_damage",
      target: parseTarget(m[3], lineNo),
      damage_type: m[1] as "bite" | "breath" | "true",
      amount: Number(m[2]),
    };
  }

  throw new DslError(`unknown effect: ${t}`, lineNo);
}

function parseTarget(text: string, lineNo: number): EffectTarget {
  if (text === "self" || text === "caster") return "caster";
  if (text === "opp" || text === "opponent") return "opponent";
  throw new DslError(`unknown target: ${text}`, lineNo);
}

function tryParseNumber(text: string): number | null {
  const t = text.trim();
  if (!/^-?[0-9]+(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

// ── Printer (effect statements) ───────────────────────────────

function pushEffectLines(out: string[], effects: EffectKind[], depth: number) {
  const pad = "  ".repeat(depth);
  for (const e of effects) {
    pushEffectLine(out, e, pad);
  }
}

function pushEffectLine(out: string[], e: EffectKind, pad: string) {
  const target = (t: EffectTarget) => (t === "caster" ? "self" : "opp");
  switch (e.kind) {
    case "deal_direct_damage":
      out.push(`${pad}deal ${e.amount} to ${target(e.target)}`);
      return;
    case "deal_expr_damage":
      out.push(`${pad}deal ${printExpr(e.amount)} to ${target(e.target)}`);
      return;
    case "deal_direct_damage_max_hp_fraction":
      out.push(`${pad}deal ${e.fraction * 100}% maxhp to ${target(e.target)}`);
      return;
    case "heal_hp":
      out.push(`${pad}heal ${target(e.target)} ${e.amount}`);
      return;
    case "heal_expr_amount":
      out.push(`${pad}heal ${target(e.target)} ${printExpr(e.amount)}`);
      return;
    case "apply_status_to_target":
      out.push(
        `${pad}apply ${e.status.status_id} x${e.status.stacks} to ${target(e.target)}`,
      );
      return;
    case "apply_statuses_to_target":
      out.push(
        `${pad}apply [${e.statuses.map((s) => `${s.status_id} x${s.stacks}`).join(", ")}] to ${target(e.target)}`,
      );
      return;
    case "apply_status_expr_stacks":
      out.push(
        `${pad}apply ${e.status_id} x${printExpr(e.stacks)} to ${target(e.target)}`,
      );
      return;
    case "cleanse_fortify_removable_statuses":
      out.push(`${pad}cleanse ${target(e.target)}`);
      return;
    case "set_cooldown_until":
      out.push(
        `${pad}cooldown ${target(e.target)} ${e.cooldown_id} for ${e.duration_sec}`,
      );
      return;
    case "set_active_until":
      out.push(
        `${pad}active ${target(e.target)} ${e.active_id} for ${e.duration_sec}`,
      );
      return;
    case "set_cooldown_until_expr":
      out.push(
        `${pad}cooldown ${target(e.target)} ${e.cooldown_id} for ${printExpr(e.duration_sec)}`,
      );
      return;
    case "set_active_until_expr":
      out.push(
        `${pad}active ${target(e.target)} ${e.active_id} for ${printExpr(e.duration_sec)}`,
      );
      return;
    case "pay_self_cost_max_hp_fraction":
      out.push(`${pad}pay ${target(e.target)} ${e.fraction * 100}%`);
      return;
    case "set_hp":
      out.push(`${pad}set_hp ${target(e.target)} ${e.value}`);
      return;
    case "set_hp_expr":
      out.push(`${pad}set_hp ${target(e.target)} ${printExpr(e.value)}`);
      return;
    case "transfer_hp":
      out.push(
        `${pad}transfer ${e.amount} hp from ${target(e.from)} to ${target(e.to)}`,
      );
      return;
    case "swap_hp_ratio":
      out.push(`${pad}swap_hp`);
      return;
    case "clear_status":
      out.push(`${pad}clear ${target(e.target)} ${e.status_id}`);
      return;
    case "clear_statuses":
      out.push(`${pad}clear ${target(e.target)} [${e.status_ids.join(", ")}]`);
      return;
    case "modify_status_stacks":
      out.push(
        `${pad}modify_status ${target(e.target)} ${e.status_id} ${e.mode} ${e.value}`,
      );
      return;
    case "dispel_all_statuses":
      out.push(`${pad}dispel ${target(e.target)}`);
      return;
    case "cooldown_reset":
      out.push(
        `${pad}reset_${e.which === "cooldown" ? "cooldown" : "active"} ${target(e.target)} ${e.cooldown_id}`,
      );
      return;
    case "interrupt_next_hit":
      out.push(`${pad}interrupt ${target(e.target)} ${e.delay_sec}`);
      return;
    case "consume_breath":
    case "restore_breath":
      out.push(`${pad}${e.kind} ${target(e.target)} ${e.amount}`);
      return;
    case "modify_stat":
      out.push(
        `${pad}modify_stat ${target(e.target)} ${e.field} ${e.mode} ${e.value} for ${e.duration_sec}`,
      );
      return;
    case "modify_stat_expr":
      out.push(
        `${pad}modify_stat ${target(e.target)} ${e.field} ${e.mode} ${printExpr(e.value)} for ${printExpr(e.duration_sec)}`,
      );
      return;
    case "form_swap": {
      const changes = e.stat_changes
        .map((c) => `${c.field} ${c.mode} ${c.value}`)
        .join(", ");
      const policy =
        e.hp_policy.kind === "set" ? `set ${e.hp_policy.value}` : e.hp_policy.kind;
      out.push(
        `${pad}form_swap [${changes}] on ${target(e.target)} for ${e.duration_sec} hp:${policy}`,
      );
      return;
    }
    case "set_extra":
      out.push(`${pad}set_extra ${target(e.target)} ${e.key} = ${printExpr(e.value)}`);
      return;
    case "increment_extra":
      out.push(`${pad}inc_extra ${target(e.target)} ${e.key} += ${printExpr(e.amount)}`);
      return;
    case "push_extra":
      out.push(`${pad}push_extra ${target(e.target)} ${e.key} ${printExpr(e.value)}`);
      return;
    case "clear_extra_array":
      out.push(`${pad}clear_array ${target(e.target)} ${e.key}`);
      return;
    case "deal_typed_damage":
      out.push(`${pad}deal_typed ${e.damage_type} ${e.amount} to ${target(e.target)}`);
      return;
    case "consume_status_for_damage":
      out.push(
        `${pad}detonate ${target(e.target)} ${e.status_id} @ ${printExpr(e.damage_per_stack)}`,
      );
      return;
    case "extend_status":
      out.push(`${pad}extend ${target(e.target)} ${e.status_id} ${e.seconds}`);
      return;
    case "set_status_next_decay":
      out.push(
        `${pad}decay_next ${target(e.target)} ${e.status_id} @${e.absolute_time}`,
      );
      return;
    case "set_status_next_tick":
      out.push(
        `${pad}tick_next ${target(e.target)} ${e.status_id} @${e.absolute_time}`,
      );
      return;
    case "trigger_ability":
      out.push(`${pad}trigger ${e.ability_id}`);
      return;
    case "record_snapshot":
      out.push(`${pad}snapshot ${target(e.target)} ${e.key}`);
      return;
    case "restore_snapshot":
      out.push(`${pad}restore ${target(e.target)} ${e.key}`);
      return;
    case "schedule_effect":
      if (e.name) {
        out.push(`${pad}schedule ${e.delay_sec} as ${e.name}:`);
      } else {
        out.push(`${pad}schedule ${e.delay_sec}:`);
      }
      pushEffectLines(out, e.effects, (pad.length / 2) + 1);
      return;
    case "cancel_schedule":
      out.push(`${pad}cancel_schedule ${e.name}`);
      return;
    case "reschedule":
      out.push(`${pad}reschedule ${e.name} ${e.delay_sec}`);
      return;
    case "choose":
      out.push(`${pad}choose:`);
      for (const branch of e.branches) {
        out.push(`${pad}  weight ${printExpr(branch.weight)}:`);
        pushEffectLines(out, branch.effects, (pad.length / 2) + 2);
      }
      return;
    case "chance":
      out.push(`${pad}chance ${printExpr(e.probability)}:`);
      pushEffectLines(out, e.then, (pad.length / 2) + 1);
      return;
    case "repeat":
      out.push(`${pad}repeat ${e.count}:`);
      pushEffectLines(out, e.body, (pad.length / 2) + 1);
      return;
    case "conditional":
      out.push(`${pad}if ${printExpr(e.cond)}:`);
      pushEffectLines(out, e.then, (pad.length / 2) + 1);
      if (e.otherwise && e.otherwise.length > 0) {
        out.push(`${pad}else:`);
        pushEffectLines(out, e.otherwise, (pad.length / 2) + 1);
      }
      return;
  }
}
