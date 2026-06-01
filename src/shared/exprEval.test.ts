import { describe, expect, it } from "vitest";
import type { Expr } from "./customAbilityTypes";
import { defaultMockState, evalExpr, formatEvalResult } from "./exprEval";

describe("evalExpr", () => {
  it("evaluates const literal", () => {
    expect(evalExpr({ kind: "const", value: 42 }, defaultMockState())).toBe(42);
  });

  it("evaluates simple arithmetic", () => {
    const expr: Expr = {
      kind: "bin",
      op: "add",
      left: { kind: "const", value: 1 },
      right: {
        kind: "bin",
        op: "mul",
        left: { kind: "const", value: 2 },
        right: { kind: "const", value: 3 },
      },
    };
    expect(evalExpr(expr, defaultMockState())).toBe(7);
  });

  it("looks up self.hp / self.hp_ratio / self.bite_dps", () => {
    const state = defaultMockState();
    expect(evalExpr({ kind: "var", path: "self.hp" }, state)).toBe(5000);
    expect(evalExpr({ kind: "var", path: "self.hp_ratio" }, state)).toBe(0.5);
    expect(evalExpr({ kind: "var", path: "self.bite_dps" }, state)).toBe(50);
  });

  it("looks up status stacks", () => {
    expect(
      evalExpr(
        { kind: "var", path: "self.status.Bleed_Status.stacks" },
        defaultMockState(),
      ),
    ).toBe(3);
    expect(
      evalExpr(
        { kind: "var", path: "self.status.Unknown_Status.stacks" },
        defaultMockState(),
      ),
    ).toBe(0);
  });

  it("returns 0 for unknown var paths", () => {
    expect(
      evalExpr({ kind: "var", path: "self.nonexistent" }, defaultMockState()),
    ).toBe(0);
  });

  it("ternary picks correctly", () => {
    const e: Expr = {
      kind: "if",
      cond: {
        kind: "bin",
        op: "lt",
        left: { kind: "var", path: "self.hp_ratio" },
        right: { kind: "const", value: 0.5 },
      },
      then: { kind: "const", value: 100 },
      otherwise: { kind: "const", value: 0 },
    };
    // hp_ratio == 0.5, so lt 0.5 is false → otherwise.
    expect(evalExpr(e, defaultMockState())).toBe(0);
  });

  it("clamp respects bounds", () => {
    const inside = evalExpr(
      {
        kind: "clamp",
        value: { kind: "const", value: 5 },
        lo: { kind: "const", value: 0 },
        hi: { kind: "const", value: 10 },
      },
      defaultMockState(),
    );
    expect(inside).toBe(5);
    const overflow = evalExpr(
      {
        kind: "clamp",
        value: { kind: "const", value: 15 },
        lo: { kind: "const", value: 0 },
        hi: { kind: "const", value: 10 },
      },
      defaultMockState(),
    );
    expect(overflow).toBe(10);
  });

  it("div by zero yields zero (matches Rust)", () => {
    expect(
      evalExpr(
        {
          kind: "bin",
          op: "div",
          left: { kind: "const", value: 10 },
          right: { kind: "const", value: 0 },
        },
        defaultMockState(),
      ),
    ).toBe(0);
  });

  it("sign 0 is 0 (matches Rust override of f64::signum)", () => {
    expect(
      evalExpr(
        { kind: "una", op: "sign", operand: { kind: "const", value: 0 } },
        defaultMockState(),
      ),
    ).toBe(0);
  });

  it("realistic example: opponent.hp * 0.5", () => {
    const e: Expr = {
      kind: "bin",
      op: "mul",
      left: { kind: "var", path: "opponent.hp" },
      right: { kind: "const", value: 0.5 },
    };
    expect(evalExpr(e, defaultMockState())).toBe(2500);
  });
});

describe("formatEvalResult", () => {
  it("integers pass through", () => {
    expect(formatEvalResult(42)).toBe("42");
    expect(formatEvalResult(-100)).toBe("-100");
  });

  it("typical floats get 4-sig-fig precision", () => {
    expect(formatEvalResult(0.5)).toBe("0.5");
    expect(formatEvalResult(0.42)).toBe("0.42");
  });

  it("very small / very large non-integer use exponential", () => {
    // Tiny float — exponential.
    expect(formatEvalResult(1e-6)).toMatch(/e[+-]?\d+$/);
    // Large non-integer — exponential.
    expect(formatEvalResult(1234567.89)).toMatch(/e[+-]?\d+$/);
    // Integer — passes through regardless of magnitude.
    expect(formatEvalResult(1e8)).toBe("100000000");
  });

  it("infinity prints as +∞ / −∞", () => {
    expect(formatEvalResult(Infinity)).toBe("+∞");
    expect(formatEvalResult(-Infinity)).toBe("−∞");
  });
});
