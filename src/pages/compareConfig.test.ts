import { describe, expect, it } from "vitest";
import { badOmenOutcomes, resolveBadOmenChoice } from "./compareConfig";

describe("compareConfig", () => {
  it("returns null for auto choice", () => {
    expect(resolveBadOmenChoice("auto")).toBeNull();
  });

  it("resolves a valid serialized outcome", () => {
    const sample = badOmenOutcomes[0];
    const key = `${sample.statusId}|${sample.stacks}`;
    expect(resolveBadOmenChoice(key)).toEqual(sample);
  });

  it("returns null for invalid serialized outcome", () => {
    expect(resolveBadOmenChoice("Unknown_Status|999")).toBeNull();
  });
});
