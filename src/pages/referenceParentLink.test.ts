import { describe, expect, it } from "vitest";
import { KNOWN_APPROXIMATION_REFERENCE_DRAFTS } from "./referenceContent";
import { referenceParentLabel } from "./referencePageShared";

// An approximation points at the entry it is a concession about. The pointer is
// an `id`, which nothing spells out for a reader, so the page resolves it to a
// display name and section. A renamed or deleted parent would leave the pointer
// pointing nowhere and the line would simply stop rendering.

describe("an approximation's parent link resolves", () => {
  const withParent = KNOWN_APPROXIMATION_REFERENCE_DRAFTS.filter((entry) => entry.parentId);

  it("covers most of the approximations", () => {
    expect(withParent.length).toBeGreaterThan(KNOWN_APPROXIMATION_REFERENCE_DRAFTS.length / 2);
  });

  it.each(withParent)("$name", (entry) => {
    expect(referenceParentLabel(entry.parentId), `${entry.id} points at "${entry.parentId}"`).toBeTruthy();
  });
});
