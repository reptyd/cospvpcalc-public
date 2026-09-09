import { describe, it, expect } from "vitest";
import { SHARE_VOCABULARY } from "./shareVocabulary";

describe("shareVocabulary", () => {
  it("is non-empty", () => {
    expect(SHARE_VOCABULARY.length).toBeGreaterThan(0);
  });

  it("has no duplicate entries (a duplicate would make decode ambiguous)", () => {
    expect(new Set(SHARE_VOCABULARY).size).toBe(SHARE_VOCABULARY.length);
  });
});
