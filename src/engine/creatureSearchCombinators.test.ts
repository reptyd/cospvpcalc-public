import { describe, expect, it } from "vitest";
import {
  SEARCHABLE_CREATURES,
  appendChild,
  createEmptyRootGroup,
  createDefaultPredicateNode,
  evaluateNode,
  groupCombinatorAt,
  removeNode,
  setGroupCombinatorAt,
  type Predicate,
  type PredicateNode,
  type QueryGroup,
} from "./creatureSearch";

// A real creature to evaluate against, plus predicates that are trivially true
// / false for it (every creature has health > 0; none has health < 0).
const target = SEARCHABLE_CREATURES[0];
const TRUE_PRED: Predicate = { kind: "stat-num", field: "health", op: "gt", value: 0 };
const FALSE_PRED: Predicate = { kind: "stat-num", field: "health", op: "lt", value: 0 };

let counter = 0;
function leaf(p: Predicate): PredicateNode {
  counter += 1;
  return { kind: "predicate", id: `t-${counter}`, predicate: p };
}
function group(
  combinator: "and" | "or",
  preds: Predicate[],
  combinators?: ("and" | "or")[],
): QueryGroup {
  return { kind: "group", id: `g-${(counter += 1)}`, combinator, children: preds.map(leaf), combinators };
}

const T = TRUE_PRED;
const F = FALSE_PRED;

describe("evaluateNode — uniform combinator (classic)", () => {
  it("AND requires all", () => {
    expect(evaluateNode(target, group("and", [T, F]))).toBe(false);
    expect(evaluateNode(target, group("and", [T, T]))).toBe(true);
  });
  it("OR requires any", () => {
    expect(evaluateNode(target, group("or", [T, F]))).toBe(true);
    expect(evaluateNode(target, group("or", [F, F]))).toBe(false);
  });
});

describe("evaluateNode — per-gap with AND-over-OR precedence", () => {
  it("(A AND B) OR C — not A AND (B OR C)", () => {
    // A=F, B=F, C=T, ops [and, or]: (F AND F) OR T = true.
    // The wrong grouping A AND (B OR C) would be F AND (F OR T) = false.
    expect(evaluateNode(target, group("and", [F, F, T], ["and", "or"]))).toBe(true);
  });
  it("A OR (B AND C) — not left-to-right ((A OR B) AND C)", () => {
    // A=T, B=F, C=F, ops [or, and]: T OR (F AND F) = true.
    // Left-to-right ((T OR F) AND F) would be false.
    expect(evaluateNode(target, group("and", [T, F, F], ["or", "and"]))).toBe(true);
  });
  it("all-AND run is false if any is false", () => {
    expect(evaluateNode(target, group("and", [T, T, F], ["and", "and"]))).toBe(false);
  });
  it("falls back to uniform combinator when combinators length is stale", () => {
    // combinators too short -> treated as uniform AND -> false.
    expect(evaluateNode(target, group("and", [T, F, T], ["or"]))).toBe(false);
  });
});

describe("groupCombinatorAt / setGroupCombinatorAt", () => {
  it("falls back to the uniform combinator when no per-gap data", () => {
    const g = group("or", [T, T]);
    expect(groupCombinatorAt(g, 0)).toBe("or");
  });
  it("materializes the array from the uniform default, then sets one gap", () => {
    let root = createEmptyRootGroup(); // combinator "and"
    root = appendChild(root, root.id, createDefaultPredicateNode("stat-num"));
    root = appendChild(root, root.id, createDefaultPredicateNode("stat-num"));
    root = appendChild(root, root.id, createDefaultPredicateNode("stat-num"));
    root = setGroupCombinatorAt(root, root.id, 1, "or");
    expect(root.combinators).toEqual(["and", "or"]); // gap 0 default, gap 1 set
    expect(groupCombinatorAt(root, 0)).toBe("and");
    expect(groupCombinatorAt(root, 1)).toBe("or");
  });
});

describe("combinators length is maintained on add / remove", () => {
  it("grows on append and shrinks on remove", () => {
    let root = createEmptyRootGroup();
    const a = createDefaultPredicateNode("stat-num");
    const b = createDefaultPredicateNode("stat-num");
    root = appendChild(root, root.id, a);
    root = appendChild(root, root.id, b);
    root = setGroupCombinatorAt(root, root.id, 0, "or"); // materialize -> length 1
    expect(root.combinators).toHaveLength(1);
    const c = createDefaultPredicateNode("stat-num");
    root = appendChild(root, root.id, c); // 3 children -> 2 gaps
    expect(root.combinators).toHaveLength(2);
    root = removeNode(root, c.id); // back to 2 children -> 1 gap
    expect(root.combinators).toHaveLength(1);
  });
});
