import { describe, expect, it } from "vitest";
import { buildSubspeciesSet, computeSubspecies, heuristicBaseOf } from "./subspecies";

const ROSTER = [
  "Meorlark",
  "Icebreaker Meorlark",
  "Sochuri",
  "Ashen Sochuri",
  "Caldonterrus",
  "Origin Caldonterrus",
  "Adharcaiin", // single-word, not a subspecies
  "Jeff",
  "Scuba Jeff",
];

describe("subspecies detection", () => {
  it("maps a '<prefix> <Base>' name to its base when the base is in the roster", () => {
    const map = computeSubspecies(ROSTER);
    expect(map.get("Icebreaker Meorlark")).toBe("Meorlark");
    expect(map.get("Ashen Sochuri")).toBe("Sochuri");
    expect(map.get("Origin Caldonterrus")).toBe("Caldonterrus");
    expect(map.get("Scuba Jeff")).toBe("Jeff");
  });

  it("does not flag base creatures or single-word names", () => {
    const set = buildSubspeciesSet(ROSTER);
    expect(set.has("Meorlark")).toBe(false);
    expect(set.has("Adharcaiin")).toBe(false);
    expect(set.has("Jeff")).toBe(false);
  });

  it("does not flag a multi-word name whose suffix is not a creature", () => {
    expect(heuristicBaseOf("Frost Giant", new Set(["frost giant"]))).toBeNull();
    expect(buildSubspeciesSet(["Frost Giant"]).has("Frost Giant")).toBe(false);
  });

  it("prefers the longest trailing base match", () => {
    const roster = ["Terrus", "Caldonterrus", "Origin Caldonterrus"];
    expect(computeSubspecies(roster).get("Origin Caldonterrus")).toBe("Caldonterrus");
  });

  it("forceExclude keeps a heuristic hit as an ordinary creature", () => {
    const set = buildSubspeciesSet(ROSTER, { forceInclude: [], forceExclude: ["Scuba Jeff"] });
    expect(set.has("Scuba Jeff")).toBe(false);
    expect(set.has("Icebreaker Meorlark")).toBe(true);
  });

  it("forceInclude marks a name the heuristic misses (base not in roster)", () => {
    const map = computeSubspecies(["Solo Variant"], { forceInclude: ["Solo Variant"], forceExclude: [] });
    expect(map.has("Solo Variant")).toBe(true);
    expect(map.get("Solo Variant")).toBeNull();
  });

  it("rejects a coincidental name match when the tier differs (Buff Eulopii rule)", () => {
    const roster = ["Eulopii", "Buff Eulopii", "Meorlark", "Icebreaker Meorlark"];
    const tiers: Record<string, number> = { eulopii: 1, "buff eulopii": 4, meorlark: 4, "icebreaker meorlark": 4 };
    const set = buildSubspeciesSet(roster, undefined, (n) => tiers[n.toLowerCase()]);
    expect(set.has("Buff Eulopii")).toBe(false); // tier 4 vs base Eulopii tier 1
    expect(set.has("Icebreaker Meorlark")).toBe(true); // both tier 4
  });

  it("keeps a candidate when a tier is unknown (permissive)", () => {
    const set = buildSubspeciesSet(["Base", "Prefix Base"], undefined, (n) => (n === "Base" ? 3 : undefined));
    expect(set.has("Prefix Base")).toBe(true);
  });
});
