import { describe, expect, it } from "vitest";
import { creatureByName, creaturesData, getCreatureByName } from "../engine/creatureData";
import {
  type DefaultPoolScope,
  buildAdaptiveQuickOpponents,
  buildDefaultMetaPool,
  encodeCreaturePoolCode,
  parseCreaturePoolCode,
} from "./poolUtils";

describe("pool utils", () => {
  it("encodes and parses with filtering and dedupe", () => {
    const known = creaturesData.slice(0, 2).map((c) => c.name);
    expect(known.length).toBe(2);

    const encoded = encodeCreaturePoolCode([known[0], known[1], known[0]]);
    expect(encoded).toContain("|");

    const parsed = parseCreaturePoolCode(`${known[0]}, unknown, ${known[1]}\n${known[0]}`);
    expect(parsed).toEqual([known[0], known[1]]);
  });

  it("buildDefaultMetaPool returns bounded list and excludes source", () => {
    const source = creaturesData[0]?.name;
    expect(source).toBeTruthy();
    if (!source) return;

    const pool = buildDefaultMetaPool(source, 10);
    expect(pool.length).toBeLessThanOrEqual(10);
    expect(pool).not.toContain(source);
  });

  it("buildDefaultMetaPool respects selected tier scope", () => {
    const sourceCreature = [...creaturesData].sort((a, b) => a.stats.tier - b.stats.tier).find((creature) => {
      const tiers = new Set(
        creaturesData
          .filter((entry) => entry.name !== creature.name)
          .map((entry) => entry.stats.tier),
      );
      return tiers.has(creature.stats.tier - 1) && tiers.has(creature.stats.tier + 1);
    });
    expect(sourceCreature).toBeTruthy();
    if (!sourceCreature) return;

    const verifyScope = (scope: DefaultPoolScope, predicate: (tier: number, sourceTier: number) => boolean) => {
      const pool = buildDefaultMetaPool(sourceCreature.name, 60, scope);
      expect(pool.length).toBeGreaterThan(0);
      expect(pool).not.toContain(sourceCreature.name);
      for (const name of pool) {
        const creature = creatureByName[name];
        expect(creature).toBeTruthy();
        if (!creature) continue;
        expect(predicate(creature.stats.tier, sourceCreature.stats.tier)).toBe(true);
      }
    };

    verifyScope("sameOrHigher", (tier, sourceTier) => tier >= sourceTier);
    verifyScope("sameOrLower", (tier, sourceTier) => tier <= sourceTier);
    verifyScope("withinOneTier", (tier, sourceTier) => Math.abs(tier - sourceTier) <= 1);
  });

  it("buildDefaultMetaPool can use exact tiers as an alternative range mode", () => {
    const sourceCreature = creaturesData.find((creature) =>
      creaturesData.some((entry) => entry.name !== creature.name && entry.stats.tier !== creature.stats.tier),
    );
    expect(sourceCreature).toBeTruthy();
    if (!sourceCreature) return;

    const exactTier = creaturesData.find(
      (entry) => entry.name !== sourceCreature.name && entry.stats.tier !== sourceCreature.stats.tier,
    )?.stats.tier;
    expect(exactTier).toBeTruthy();
    if (!exactTier) return;

    const pool = buildDefaultMetaPool(sourceCreature.name, 80, "exactTiers", [exactTier]);
    expect(pool.length).toBeGreaterThan(0);
    for (const name of pool) {
      expect(creatureByName[name]?.stats.tier).toBe(exactTier);
    }
  });

  it("buildDefaultMetaPool returns empty for exact tiers when none are selected", () => {
    const source = creaturesData[0]?.name;
    expect(source).toBeTruthy();
    if (!source) return;

    expect(buildDefaultMetaPool(source, 80, "exactTiers", [])).toEqual([]);
  });

  it("buildDefaultMetaPool returns empty for unknown source", () => {
    expect(buildDefaultMetaPool("__unknown_source__", 10)).toEqual([]);
  });

  it("resolves creature names without diacritics for lookup and pool parsing", () => {
    expect(getCreatureByName("Baruw")?.name).toBe("Bäruw");
    expect(parseCreaturePoolCode("Baruw|Bäruw")).toEqual(["Bäruw"]);
  });

  it("buildAdaptiveQuickOpponents returns unique bounded subset", () => {
    const valid = creaturesData.map((c) => c.name).filter((name) => Boolean(creatureByName[name]));
    const pool = valid.slice(0, Math.min(valid.length, 30));
    const picked = buildAdaptiveQuickOpponents(pool, 12);

    expect(picked.length).toBeLessThanOrEqual(12);
    expect(new Set(picked).size).toBe(picked.length);
    for (const name of picked) {
      expect(pool.includes(name)).toBe(true);
    }
  });
});

