import { describe, expect, it } from "vitest";
import { resolveCompareDisplayNames } from "./compareDisplayNames";

describe("resolveCompareDisplayNames", () => {
  it("returns names unchanged when they differ", () => {
    expect(resolveCompareDisplayNames("Korathos", "Opra")).toEqual({
      displayA: "Korathos",
      displayB: "Opra",
    });
  });

  it("appends A / B suffix when names are identical", () => {
    expect(resolveCompareDisplayNames("Korathos", "Korathos")).toEqual({
      displayA: "Korathos A",
      displayB: "Korathos B",
    });
  });

  it("leaves empty names alone — no spurious ' A' / ' B' on blanks", () => {
    expect(resolveCompareDisplayNames("", "")).toEqual({
      displayA: "",
      displayB: "",
    });
    expect(resolveCompareDisplayNames("", "Korathos")).toEqual({
      displayA: "",
      displayB: "Korathos",
    });
    expect(resolveCompareDisplayNames("Korathos", "")).toEqual({
      displayA: "Korathos",
      displayB: "",
    });
  });
});
