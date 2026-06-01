import { describe, expect, it } from "vitest";
import { parseExpr, printExpr } from "./exprDsl";
import type { Expr } from "./customAbilityTypes";

function parse(text: string): Expr {
  const r = parseExpr(text);
  if (!r.ok) throw new Error(`parse failed at col ${r.column}: ${r.error}`);
  return r.expr;
}

function roundTrip(text: string): string {
  return printExpr(parse(text));
}

describe("parseExpr", () => {
  it("parses simple numeric literals", () => {
    expect(parse("42")).toEqual({ kind: "const", value: 42 });
    expect(parse("-1.5")).toEqual({
      kind: "una",
      op: "neg",
      operand: { kind: "const", value: 1.5 },
    });
    expect(parse("1e3")).toEqual({ kind: "const", value: 1000 });
  });

  it("parses var paths", () => {
    expect(parse("self.hp_ratio")).toEqual({ kind: "var", path: "self.hp_ratio" });
    expect(parse("opponent.cooldown_until.user.x")).toEqual({
      kind: "var",
      path: "opponent.cooldown_until.user.x",
    });
  });

  it("respects arithmetic precedence", () => {
    // `1 + 2 * 3` == 7, not 9.
    const e = parse("1 + 2 * 3");
    expect(e).toEqual({
      kind: "bin",
      op: "add",
      left: { kind: "const", value: 1 },
      right: {
        kind: "bin",
        op: "mul",
        left: { kind: "const", value: 2 },
        right: { kind: "const", value: 3 },
      },
    });
  });

  it("respects comparison + logical chain", () => {
    const e = parse("self.hp < 100 && opponent.hp > 0");
    expect(e.kind).toBe("bin");
    expect((e as { op: string }).op).toBe("and");
  });

  it("parses ternary as if-expression", () => {
    expect(parse("a < 1 ? 100 : 0").kind).toBe("if");
    expect(parse("if a < 1 then 100 else 0").kind).toBe("if");
  });

  it("parses unary functions", () => {
    expect(parse("abs(-3)")).toEqual({
      kind: "una",
      op: "abs",
      operand: { kind: "una", op: "neg", operand: { kind: "const", value: 3 } },
    });
    expect(parse("sqrt(self.hp)").kind).toBe("una");
    expect((parse("sqrt(self.hp)") as { op: string }).op).toBe("sqrt");
  });

  it("parses binary functions", () => {
    expect(parse("min(a, b)")).toEqual({
      kind: "bin",
      op: "min",
      left: { kind: "var", path: "a" },
      right: { kind: "var", path: "b" },
    });
    expect((parse("max(self.hp, 100)") as { op: string }).op).toBe("max");
    expect((parse("pow(2, 10)") as { op: string }).op).toBe("pow");
  });

  it("parses clamp as 3-arg call", () => {
    expect(parse("clamp(self.hp, 0, 1000)")).toEqual({
      kind: "clamp",
      value: { kind: "var", path: "self.hp" },
      lo: { kind: "const", value: 0 },
      hi: { kind: "const", value: 1000 },
    });
  });

  it("parses ** as right-associative", () => {
    // 2 ** 3 ** 2 should parse as 2 ** (3 ** 2) = 512, not (2 ** 3) ** 2 = 64
    const e = parse("2 ** 3 ** 2") as Extract<Expr, { kind: "bin" }>;
    expect(e.kind).toBe("bin");
    expect(e.op).toBe("pow");
    expect((e.right as Extract<Expr, { kind: "bin" }>).op).toBe("pow");
  });

  it("parses parentheses to override precedence", () => {
    const e = parse("(1 + 2) * 3") as Extract<Expr, { kind: "bin" }>;
    expect(e.op).toBe("mul");
    expect((e.left as Extract<Expr, { kind: "bin" }>).op).toBe("add");
  });

  it("rejects empty input", () => {
    const r = parseExpr("");
    expect(r.ok).toBe(false);
  });

  it("rejects unbalanced parens", () => {
    expect(parseExpr("(1 + 2").ok).toBe(false);
    expect(parseExpr("1 + 2)").ok).toBe(false);
  });

  it("rejects unknown function", () => {
    const r = parseExpr("unknown_func(1)");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toMatch(/unknown function/i);
    }
  });

  it("rejects wrong arity", () => {
    expect(parseExpr("clamp(1, 2)").ok).toBe(false);
    expect(parseExpr("min(1)").ok).toBe(false);
    expect(parseExpr("abs(1, 2)").ok).toBe(false);
  });
});

describe("printExpr", () => {
  it("prints const without superfluous parens", () => {
    expect(printExpr({ kind: "const", value: 1.5 })).toBe("1.5");
  });

  it("prints var paths verbatim", () => {
    expect(printExpr({ kind: "var", path: "self.cooldown_until.user.x" })).toBe(
      "self.cooldown_until.user.x",
    );
  });

  it("prints infix ops with right-precedence parens", () => {
    // 1 + (2 * 3) — no parens needed
    expect(roundTrip("1 + 2 * 3")).toBe("1 + 2 * 3");
    // (1 + 2) * 3 — parens preserved
    expect(roundTrip("(1 + 2) * 3")).toBe("(1 + 2) * 3");
  });

  it("prints unary functions in call form", () => {
    expect(roundTrip("abs(self.hp)")).toBe("abs(self.hp)");
    expect(roundTrip("sqrt(9)")).toBe("sqrt(9)");
  });

  it("prints min/max in call form, pow as ** infix", () => {
    // min/max have no infix syntax; printer keeps the call form.
    expect(roundTrip("min(a, b)")).toBe("min(a, b)");
    expect(roundTrip("max(self.hp, 100)")).toBe("max(self.hp, 100)");
    // pow has `**` infix — both inputs map to the same AST, printer
    // picks the shorter form. (Round-trip property is AST-stable,
    // not text-stable.)
    expect(roundTrip("pow(2, 10)")).toBe("2 ** 10");
    expect(roundTrip("2 ** 10")).toBe("2 ** 10");
  });

  it("prints clamp", () => {
    expect(roundTrip("clamp(self.hp, 0, 1000)")).toBe("clamp(self.hp, 0, 1000)");
  });

  it("prints if as ternary", () => {
    expect(roundTrip("if self.hp < 0.5 then 100 else 0")).toBe(
      "self.hp < 0.5 ? 100 : 0",
    );
  });
});

describe("round-trip", () => {
  // Pinning a few specs the constructor would produce — these are
  // the shapes the editor will hand back and forth between text
  // and AST modes.
  const specs = [
    "self.hp_ratio < 0.5 ? 100 : 0",
    "min(self.bite_dps * 8, 200)",
    "clamp(self.hp / 1000, 0, 1)",
    "(opponent.hp - self.hp) * 0.5",
    "self.hp <= 0 || opponent.hp <= 0",
    "abs(self.hp - opponent.hp)",
    "if self.cooldown_until.user.x <= time then self.bite_dps else 0",
    "(a && b) || (c && d)",
    "pow(2, 10) + sqrt(64)",
  ];

  for (const text of specs) {
    it(`survives parse → print: ${text}`, () => {
      const ast = parse(text);
      const printed = printExpr(ast);
      // Printed form must re-parse to the same AST.
      const reparsed = parse(printed);
      expect(reparsed).toEqual(ast);
    });
  }
});
