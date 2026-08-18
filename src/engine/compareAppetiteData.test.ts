import { describe, expect, it } from "vitest";
import {
  getCompareAppetiteEntry,
  registerTemporaryCompareAppetiteEntry,
  unregisterTemporaryCompareAppetiteEntry,
} from "./compareAppetiteData";

describe("compareAppetiteData", () => {
  it("returns null for built-in creatures - appetite now comes from creature.stats", () => {
    expect(getCompareAppetiteEntry("Venuella")).toBeNull();
    expect(getCompareAppetiteEntry("Korathos")).toBeNull();
    expect(getCompareAppetiteEntry(undefined)).toBeNull();
  });

  it("returns registered custom-creature appetite overrides until unregistered", () => {
    registerTemporaryCompareAppetiteEntry("MyCustomCreature", { appetite: 120 });
    expect(getCompareAppetiteEntry("MyCustomCreature")).toEqual({ appetite: 120 });
    unregisterTemporaryCompareAppetiteEntry("MyCustomCreature");
    expect(getCompareAppetiteEntry("MyCustomCreature")).toBeNull();
  });
});
