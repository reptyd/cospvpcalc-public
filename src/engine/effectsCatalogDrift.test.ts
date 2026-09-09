import { describe, expect, it } from "vitest";

/**
 * Drift guard between `creatures.runtime.json` (wiki-sync source) and
 * `effects_catalog.runtime.v2.json` (engine consumes).
 * `tools/sync_effects_catalog.ts` derives the catalog from
 * creatures.runtime plus the mapping rules; this test asserts both
 * directions of the correspondence - no creature without a catalog
 * entry, no catalog entry without a creature. A creature the catalog
 * omits gets no Block %, no on-bite status proc and no modeled-ability
 * classification, and nothing else reports that.
 *
 * If this test fails after a wiki-sync, re-run:
 *   npx tsx tools/sync_effects_catalog.ts
 * which regenerates the catalog deterministically.
 */
describe("effects_catalog drift guard", () => {
  it("every creature in creatures.runtime has an effects_catalog entry", async () => {
    const creaturesJson = (await import(
      "../../data/creatures.runtime.json"
    )) as { creatures?: Array<{ name: string }>; default?: { creatures: Array<{ name: string }> } };
    const effectsJson = (await import(
      "../../data/effects_catalog.runtime.v2.json"
    )) as {
      byCreature?: Record<string, unknown>;
      default?: { byCreature: Record<string, unknown> };
    };

    const creatures =
      creaturesJson.creatures ?? creaturesJson.default?.creatures ?? [];
    const byCreature =
      effectsJson.byCreature ?? effectsJson.default?.byCreature ?? {};

    const creatureNames = new Set(creatures.map((c) => c.name));
    const catalogNames = new Set(Object.keys(byCreature));

    const missingFromCatalog = [...creatureNames].filter(
      (n) => !catalogNames.has(n),
    );
    const orphanInCatalog = [...catalogNames].filter(
      (n) => !creatureNames.has(n),
    );

    expect(
      missingFromCatalog,
      `${missingFromCatalog.length} creatures missing from effects_catalog: ${missingFromCatalog.slice(0, 10).join(", ")}${missingFromCatalog.length > 10 ? "..." : ""}. Run \`npx tsx tools/sync_effects_catalog.ts\` to regenerate.`,
    ).toEqual([]);

    expect(
      orphanInCatalog,
      `${orphanInCatalog.length} orphan entries in effects_catalog (creature gone from creatures.runtime): ${orphanInCatalog.slice(0, 10).join(", ")}${orphanInCatalog.length > 10 ? "..." : ""}. Run \`npx tsx tools/sync_effects_catalog.ts\` to regenerate.`,
    ).toEqual([]);
  });
});
