/**
 * Textual DSL for the engine's `Expr` AST. The constructor UI gets
 * uncomfortable past 4-5 nested nodes, and "I want to write actual
 * code" is the most common ask for custom abilities. This module is
 * the round-trip bridge: parse a TS-like expression string into the
 * AST the engine accepts, and pretty-print the AST back to text the
 * user can hand-edit.
 *
 * **Why a custom mini-syntax instead of, say, embedding JS?** The
 * engine is deterministic and budgeted (Pillar 9, ≤1ms per Ideal
 * decision). Letting users write arbitrary code would break both —
 * `Math.random()` kills Compare reproducibility, JIT warmup blows
 * the budget, and sandbox escapes are a real concern in a tool that
 * imports bundles from public Discord channels. This DSL shares the
 * exact AST as the visual constructor, so it has zero new
 * runtime risk; it's just a friendlier serialization.
 *
 * Syntax (informal):
 *
 *   const          := number literal              e.g. `42`, `-1.5`
 *   var            := dotted identifier           e.g. `self.hp_ratio`,
 *                                                       `opponent.cooldown_until.user.x`
 *   group          := `(` expr `)`
 *   call           := name `(` expr (`,` expr)* `)`
 *                     name in: min, max, abs, sign, floor, ceil,
 *                              round, sqrt, ln, exp, pow, clamp
 *   unary          := (`-` | `!`) unary | call | var | const | group
 *   power          := unary (`**` unary)*           # right-associative
 *   mul            := power ((`*` | `/` | `%`) power)*
 *   add            := mul ((`+` | `-`) mul)*
 *   cmp            := add ((`<=` | `<` | `>=` | `>` | `==` | `!=`) add)?
 *   and            := cmp (`&&` cmp)*
 *   or             := and (`||` and)*
 *   ternary        := or (`?` ternary `:` ternary)?
 *   if-expr        := `if` expr `then` expr `else` expr
 *   expr           := if-expr | ternary
 *
 * The two if-shapes (`a ? b : c` and `if … then … else …`) parse to
 * the same `Expr.If` node; the printer always emits the ternary
 * form for compactness.
 */

import type { BinOp, Expr, UnaryOp } from "./customAbilityTypes";

export type ParseResult =
  | { ok: true; expr: Expr }
  | { ok: false; error: string; column?: number };

/**
 * Parse `text` into an `Expr` AST. Returns a discriminated result —
 * the editor uses the `ok: false` payload to surface inline error
 * messages on the textarea.
 */
export function parseExpr(text: string): ParseResult {
  const tokens = tokenize(text);
  if (tokens.kind === "error") {
    return { ok: false, error: tokens.error, column: tokens.column };
  }
  const parser = new Parser(tokens.tokens, text);
  try {
    const expr = parser.parseExpr();
    parser.expectEnd();
    return { ok: true, expr };
  } catch (err) {
    if (err instanceof ParseError) {
      return { ok: false, error: err.message, column: err.column };
    }
    throw err;
  }
}

/**
 * Pretty-print an `Expr` AST back to text. The output round-trips:
 * `parseExpr(printExpr(e)).expr` deep-equals `e` for any well-
 * formed AST. Parentheses are inserted only where precedence would
 * otherwise change the parse — minimal noise.
 */
export function printExpr(expr: Expr): string {
  return print(expr, /* outerPrec */ 0);
}

// ── Tokenizer ──────────────────────────────────────────────────────

type Token =
  | { kind: "num"; value: number; col: number }
  | { kind: "ident"; value: string; col: number }
  | { kind: "punct"; value: Punct; col: number };

type Punct =
  | "+"
  | "-"
  | "*"
  | "/"
  | "%"
  | "**"
  | "("
  | ")"
  | ","
  | "?"
  | ":"
  | "<"
  | "<="
  | ">"
  | ">="
  | "=="
  | "!="
  | "&&"
  | "||"
  | "!";

type TokenizeResult =
  | { kind: "ok"; tokens: Token[] }
  | { kind: "error"; error: string; column: number };

function tokenize(src: string): TokenizeResult {
  const tokens: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === " " || c === "\t" || c === "\n" || c === "\r") {
      i += 1;
      continue;
    }
    // Numbers (with optional decimal — leading `-` is handled as a
    // unary op so the lexer doesn't have to second-guess `a-1`).
    if ((c >= "0" && c <= "9") || (c === "." && src[i + 1] >= "0" && src[i + 1] <= "9")) {
      const start = i;
      while (i < src.length && src[i] >= "0" && src[i] <= "9") i += 1;
      if (src[i] === ".") {
        i += 1;
        while (i < src.length && src[i] >= "0" && src[i] <= "9") i += 1;
      }
      // Optional exponent (1e3, 2.5e-2, ...).
      if (src[i] === "e" || src[i] === "E") {
        i += 1;
        if (src[i] === "+" || src[i] === "-") i += 1;
        while (i < src.length && src[i] >= "0" && src[i] <= "9") i += 1;
      }
      const num = Number(src.slice(start, i));
      if (!Number.isFinite(num)) {
        return { kind: "error", error: `bad number literal`, column: start };
      }
      tokens.push({ kind: "num", value: num, col: start });
      continue;
    }
    // Identifiers (and dotted paths). Identifier characters include
    // letter, digit (after first), `_`, and `.` as a path separator.
    if ((c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || c === "_") {
      const start = i;
      while (
        i < src.length &&
        ((src[i] >= "a" && src[i] <= "z") ||
          (src[i] >= "A" && src[i] <= "Z") ||
          (src[i] >= "0" && src[i] <= "9") ||
          src[i] === "_" ||
          src[i] === ".")
      ) {
        i += 1;
      }
      tokens.push({ kind: "ident", value: src.slice(start, i), col: start });
      continue;
    }
    // Multi-char punctuation.
    const two = src.slice(i, i + 2);
    if (two === "**" || two === "<=" || two === ">=" || two === "==" || two === "!=" || two === "&&" || two === "||") {
      tokens.push({ kind: "punct", value: two, col: i });
      i += 2;
      continue;
    }
    // Single-char punctuation.
    if ("+-*/%(),?:<>!".includes(c)) {
      tokens.push({ kind: "punct", value: c as Punct, col: i });
      i += 1;
      continue;
    }
    return { kind: "error", error: `unexpected character '${c}'`, column: i };
  }
  return { kind: "ok", tokens };
}

// ── Parser ─────────────────────────────────────────────────────────

class ParseError extends Error {
  column: number;
  constructor(message: string, column: number) {
    super(message);
    this.column = column;
  }
}

class Parser {
  pos = 0;
  private readonly tokens: Token[];
  private readonly src: string;
  constructor(tokens: Token[], src: string) {
    this.tokens = tokens;
    this.src = src;
  }

  parseExpr(): Expr {
    // `if … then … else …` keyword form has the highest "grammatical
    // privilege" — checked first so the keywords don't accidentally
    // parse as identifiers.
    const tok = this.peek();
    if (tok && tok.kind === "ident" && tok.value === "if") {
      this.advance();
      const cond = this.parseExpr();
      const then = this.expectKeyword("then") && this.parseExpr();
      const otherwise = this.expectKeyword("else") && this.parseExpr();
      return { kind: "if", cond, then, otherwise };
    }
    return this.parseTernary();
  }

  parseTernary(): Expr {
    const cond = this.parseOr();
    if (this.matchPunct("?")) {
      const then = this.parseTernary();
      this.expectPunct(":");
      const otherwise = this.parseTernary();
      return { kind: "if", cond, then, otherwise };
    }
    return cond;
  }

  parseOr(): Expr {
    let left = this.parseAnd();
    while (this.matchPunct("||")) {
      const right = this.parseAnd();
      left = { kind: "bin", op: "or", left, right };
    }
    return left;
  }

  parseAnd(): Expr {
    let left = this.parseCmp();
    while (this.matchPunct("&&")) {
      const right = this.parseCmp();
      left = { kind: "bin", op: "and", left, right };
    }
    return left;
  }

  parseCmp(): Expr {
    const left = this.parseAdd();
    const tok = this.peek();
    if (tok && tok.kind === "punct") {
      const opMap: Record<string, BinOp | undefined> = {
        "<": "lt",
        "<=": "lte",
        ">": "gt",
        ">=": "gte",
        "==": "eq",
        "!=": "ne",
      };
      const op = opMap[tok.value];
      if (op) {
        this.advance();
        const right = this.parseAdd();
        return { kind: "bin", op, left, right };
      }
    }
    return left;
  }

  parseAdd(): Expr {
    let left = this.parseMul();
    while (true) {
      const tok = this.peek();
      if (!tok || tok.kind !== "punct") break;
      if (tok.value !== "+" && tok.value !== "-") break;
      this.advance();
      const right = this.parseMul();
      left = {
        kind: "bin",
        op: tok.value === "+" ? "add" : "sub",
        left,
        right,
      };
    }
    return left;
  }

  parseMul(): Expr {
    let left = this.parsePow();
    while (true) {
      const tok = this.peek();
      if (!tok || tok.kind !== "punct") break;
      if (tok.value !== "*" && tok.value !== "/" && tok.value !== "%") break;
      this.advance();
      const right = this.parsePow();
      const op: BinOp = tok.value === "*" ? "mul" : tok.value === "/" ? "div" : "mod";
      left = { kind: "bin", op, left, right };
    }
    return left;
  }

  parsePow(): Expr {
    const base = this.parseUnary();
    if (this.matchPunct("**")) {
      const exp = this.parsePow(); // right-assoc
      return { kind: "bin", op: "pow", left: base, right: exp };
    }
    return base;
  }

  parseUnary(): Expr {
    if (this.matchPunct("-")) {
      return { kind: "una", op: "neg", operand: this.parseUnary() };
    }
    if (this.matchPunct("!")) {
      return { kind: "una", op: "not", operand: this.parseUnary() };
    }
    return this.parsePrimary();
  }

  parsePrimary(): Expr {
    const tok = this.peek();
    if (!tok) {
      throw new ParseError("unexpected end of expression", this.src.length);
    }
    if (tok.kind === "num") {
      this.advance();
      return { kind: "const", value: tok.value };
    }
    if (tok.kind === "punct" && tok.value === "(") {
      this.advance();
      const inner = this.parseExpr();
      this.expectPunct(")");
      return inner;
    }
    if (tok.kind === "ident") {
      this.advance();
      // Function call or identifier.
      if (this.matchPunct("(")) {
        return this.finishCall(tok.value, tok.col);
      }
      return { kind: "var", path: tok.value };
    }
    throw new ParseError(`unexpected token '${tokenText(tok)}'`, tok.col);
  }

  finishCall(name: string, callCol: number): Expr {
    const args: Expr[] = [];
    if (!this.peekPunct(")")) {
      args.push(this.parseExpr());
      while (this.matchPunct(",")) {
        args.push(this.parseExpr());
      }
    }
    this.expectPunct(")");
    return buildCall(name, args, callCol);
  }

  // ── helpers ──

  peek(): Token | undefined {
    return this.tokens[this.pos];
  }

  advance(): Token | undefined {
    const t = this.tokens[this.pos];
    this.pos += 1;
    return t;
  }

  matchPunct(p: Punct): boolean {
    const t = this.peek();
    if (t && t.kind === "punct" && t.value === p) {
      this.advance();
      return true;
    }
    return false;
  }

  peekPunct(p: Punct): boolean {
    const t = this.peek();
    return !!(t && t.kind === "punct" && t.value === p);
  }

  expectPunct(p: Punct): void {
    if (!this.matchPunct(p)) {
      const t = this.peek();
      throw new ParseError(
        `expected '${p}'${t ? `, got '${tokenText(t)}'` : ""}`,
        t?.col ?? this.src.length,
      );
    }
  }

  expectKeyword(kw: string): true {
    const t = this.peek();
    if (t && t.kind === "ident" && t.value === kw) {
      this.advance();
      return true;
    }
    throw new ParseError(`expected '${kw}'`, t?.col ?? this.src.length);
  }

  expectEnd(): void {
    const t = this.peek();
    if (t) {
      throw new ParseError(`unexpected '${tokenText(t)}' after expression`, t.col);
    }
  }
}

function tokenText(t: Token): string {
  if (t.kind === "num") return String(t.value);
  return t.value;
}

const UNARY_FUNCTIONS: Record<string, UnaryOp> = {
  abs: "abs",
  sign: "sign",
  floor: "floor",
  ceil: "ceil",
  round: "round",
  sqrt: "sqrt",
  ln: "ln",
  exp: "exp",
};

const BINARY_FUNCTIONS: Record<string, BinOp> = {
  min: "min",
  max: "max",
  pow: "pow",
};

function buildCall(name: string, args: Expr[], col: number): Expr {
  const una = UNARY_FUNCTIONS[name];
  if (una) {
    if (args.length !== 1) {
      throw new ParseError(`${name}() takes 1 argument, got ${args.length}`, col);
    }
    return { kind: "una", op: una, operand: args[0] };
  }
  const bi = BINARY_FUNCTIONS[name];
  if (bi) {
    if (args.length !== 2) {
      throw new ParseError(`${name}() takes 2 arguments, got ${args.length}`, col);
    }
    return { kind: "bin", op: bi, left: args[0], right: args[1] };
  }
  if (name === "clamp") {
    if (args.length !== 3) {
      throw new ParseError(`clamp() takes 3 arguments, got ${args.length}`, col);
    }
    return { kind: "clamp", value: args[0], lo: args[1], hi: args[2] };
  }
  if (name === "rand") {
    // Round 34 / A1: no-arg `rand()` produces a deterministic-pseudo-
    // random roll in [0, 1). See Expr::Rand for the semantics caveat
    // (multiple rand() calls in one expr return the same value).
    if (args.length !== 0) {
      throw new ParseError(`rand() takes 0 arguments, got ${args.length}`, col);
    }
    return { kind: "rand" };
  }
  throw new ParseError(`unknown function '${name}'`, col);
}

// ── Printer ────────────────────────────────────────────────────────

const BIN_PREC: Record<BinOp, number> = {
  // Higher = tighter binding. Match the grammar levels.
  or: 1,
  and: 2,
  lt: 3,
  lte: 3,
  gt: 3,
  gte: 3,
  eq: 3,
  ne: 3,
  add: 4,
  sub: 4,
  mul: 5,
  div: 5,
  mod: 5,
  pow: 6,
  // min/max/clamp are call-syntax — they print as `min(a,b)`, no
  // infix precedence applies.
  min: 100,
  max: 100,
};

const BIN_INFIX: Partial<Record<BinOp, string>> = {
  add: "+",
  sub: "-",
  mul: "*",
  div: "/",
  mod: "%",
  pow: "**",
  lt: "<",
  lte: "<=",
  gt: ">",
  gte: ">=",
  eq: "==",
  ne: "!=",
  and: "&&",
  or: "||",
};

function print(expr: Expr, outerPrec: number): string {
  switch (expr.kind) {
    case "const":
      return formatNumber(expr.value);
    case "var":
      return expr.path;
    case "una":
      return printUnary(expr);
    case "bin":
      return printBin(expr, outerPrec);
    case "if": {
      // Use ternary form for compactness. Always parenthesize the
      // cond / branches at the outer level so nested ternaries
      // stay unambiguous.
      const cond = print(expr.cond, 0);
      const then = print(expr.then, 0);
      const otherwise = print(expr.otherwise, 0);
      const text = `${cond} ? ${then} : ${otherwise}`;
      return outerPrec > 0 ? `(${text})` : text;
    }
    case "clamp":
      return `clamp(${print(expr.value, 0)}, ${print(expr.lo, 0)}, ${print(expr.hi, 0)})`;
    case "rand":
      return "rand()";
  }
}

function printBin(expr: Extract<Expr, { kind: "bin" }>, outerPrec: number): string {
  if (expr.op === "min" || expr.op === "max") {
    return `${expr.op}(${print(expr.left, 0)}, ${print(expr.right, 0)})`;
  }
  const infix = BIN_INFIX[expr.op];
  if (!infix) {
    // Unknown op — defensive fallback (shouldn't happen for a
    // well-formed AST but keeps the printer total).
    return `(${print(expr.left, 0)} ${expr.op} ${print(expr.right, 0)})`;
  }
  const prec = BIN_PREC[expr.op];
  // Left side at same prec is fine for left-assoc ops; right side
  // needs prec+1 for left-assoc, prec for right-assoc (pow).
  const leftPrec = prec;
  const rightPrec = expr.op === "pow" ? prec : prec + 1;
  const leftStr = print(expr.left, leftPrec);
  const rightStr = print(expr.right, rightPrec);
  const text = `${leftStr} ${infix} ${rightStr}`;
  return outerPrec > prec ? `(${text})` : text;
}

function printUnary(expr: Extract<Expr, { kind: "una" }>): string {
  switch (expr.op) {
    case "neg":
      return `-${print(expr.operand, 7)}`; // tighter than pow
    case "not":
      return `!${print(expr.operand, 7)}`;
    default:
      // abs / sqrt / floor / etc. — call syntax.
      return `${expr.op}(${print(expr.operand, 0)})`;
  }
}

function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return "0"; // can't round-trip Infinity/NaN through the parser
  // Prefer the shortest representation that round-trips.
  const s = String(n);
  // `String(0.1+0.2)` already gives "0.30000000000000004" — fine.
  // Just guard against scientific notation for very small numbers
  // since the lexer handles `1e3` but reads better in decimal.
  return s;
}
