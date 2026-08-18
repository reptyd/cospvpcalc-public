import { describe, expect, it } from "vitest";
import {
  appendChild,
  createEmptyRootGroup,
  createDefaultPredicateNode,
  createSubGroup,
  moveNode,
  type QueryGroup,
} from "./creatureSearch";

// Build a root group with `count` predicate children; returns the root plus the
// ids of the created children in order.
function rootWithPredicates(count: number): { root: QueryGroup; ids: string[] } {
  let root = createEmptyRootGroup();
  const ids: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const node = createDefaultPredicateNode("stat-num");
    ids.push(node.id);
    root = appendChild(root, root.id, node);
  }
  return { root, ids };
}

const childIds = (group: QueryGroup): string[] => group.children.map((c) => c.id);

describe("moveNode", () => {
  it("reorders a condition within its group (before a later sibling)", () => {
    const { root, ids } = rootWithPredicates(3); // [0,1,2]
    const next = moveNode(root, ids[0], root.id, ids[2]); // move 0 to before 2
    expect(childIds(next)).toEqual([ids[1], ids[0], ids[2]]);
  });

  it("moves a condition to the end when beforeId is null", () => {
    const { root, ids } = rootWithPredicates(3);
    const next = moveNode(root, ids[0], root.id, null);
    expect(childIds(next)).toEqual([ids[1], ids[2], ids[0]]);
  });

  it("moves a condition into a nested group", () => {
    const { root: initialRoot, ids } = rootWithPredicates(2); // [p0, p1]
    let root = initialRoot;
    const sub = createSubGroup();
    root = appendChild(root, root.id, sub); // [p0, p1, sub]
    const next = moveNode(root, ids[0], sub.id, null); // p0 into sub
    expect(childIds(next)).toEqual([ids[1], sub.id]);
    const subAfter = next.children.find((c) => c.id === sub.id) as QueryGroup;
    expect(childIds(subAfter)).toEqual([ids[0]]);
  });

  it("pulls a condition out of a nested group back to the root", () => {
    let root = createEmptyRootGroup();
    const sub = createSubGroup();
    root = appendChild(root, root.id, sub);
    const inner = createDefaultPredicateNode("stat-num");
    root = appendChild(root, sub.id, inner); // root -> [sub -> [inner]]
    const next = moveNode(root, inner.id, root.id, null); // inner up to root
    expect(childIds(next)).toEqual([sub.id, inner.id]);
    const subAfter = next.children.find((c) => c.id === sub.id) as QueryGroup;
    expect(subAfter.children).toHaveLength(0);
  });

  it("is a no-op when dropping a node immediately before itself", () => {
    const { root, ids } = rootWithPredicates(3);
    const next = moveNode(root, ids[1], root.id, ids[1]);
    expect(childIds(next)).toEqual(ids);
  });

  it("is a no-op for an unknown node id", () => {
    const { root, ids } = rootWithPredicates(2);
    const next = moveNode(root, "does-not-exist", root.id, null);
    expect(childIds(next)).toEqual(ids);
  });
});
