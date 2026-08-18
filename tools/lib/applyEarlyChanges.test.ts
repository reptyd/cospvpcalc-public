import { describe, expect, it } from "vitest";
import { CreatureRoster } from "./creatureRoster";
import { parseEarlyChanges } from "./earlyChangeParser";
import { creatureDeltasToOverrides, type ApplyOptions } from "./applyEarlyChanges";

const roster = new CreatureRoster([
  {
    name: "Meorlark",
    stats: {},
    passiveAbilities: [
      { abilityId: "Frosty", name: "Frosty", value: null, semantics: "neutral", subtype: null },
      { abilityId: "Block_Frostbite", name: "Block Frostbite", value: 35, semantics: "block", subtype: null },
    ],
    activatedAbilities: [],
    breathAbilities: [],
  },
]);

const opts: ApplyOptions = { channel: "early", source: "test", anchor: true };

function convert(text: string, override: Partial<ApplyOptions> = {}) {
  const parsed = parseEarlyChanges(text);
  return creatureDeltasToOverrides(parsed.creatures[0], { ...opts, ...override }, roster, new Set());
}

describe("creatureDeltasToOverrides", () => {
  it("makes an anchored stat override", () => {
    const { entries } = convert("Meorlark\nWeight from 5600 to 6000");
    expect(entries[0]).toMatchObject({
      kind: "stat",
      creature: "Meorlark",
      field: "weight",
      value: 6000,
      expectedWikiValue: 5600,
      channel: "early",
    });
  });

  it("makes an anchored ability-value override with the roster category", () => {
    const { entries } = convert("Meorlark\nBlockFrostbite from 35 to 50");
    expect(entries[0]).toMatchObject({
      kind: "ability",
      category: "passive",
      matchAbilityName: "Block Frostbite",
      expectedWikiValue: 0.35, // Block percents (35) become runtime fractions
    });
    expect((entries[0] as { abilities: unknown[] }).abilities).toEqual([
      { abilityId: "Block_Frostbite", name: "Block Frostbite", value: 0.5, semantics: "block", subtype: null },
    ]);
  });

  it("adds an ability with no anchor", () => {
    const { entries } = convert("Meorlark\nAddition of Frosty");
    expect(entries[0]).toMatchObject({ kind: "ability", matchAbilityName: "Frosty" });
    expect("expectedWikiValue" in entries[0]).toBe(false);
  });

  it("removes an ability with an empty replacement list", () => {
    const { entries } = convert("Meorlark\nRemoval of Frosty");
    expect((entries[0] as { abilities: unknown[] }).abilities).toEqual([]);
  });

  it("--no-anchor drops the wiki anchor", () => {
    const { entries } = convert("Meorlark\nWeight from 5600 to 6000", { anchor: false });
    expect("expectedWikiValue" in entries[0]).toBe(false);
  });

  it("warns and files an unknown ability as passive", () => {
    const { entries, warnings } = convert("Meorlark\nAddition of Lance Frostbite");
    expect((entries[0] as { category: string }).category).toBe("passive");
    expect(warnings.join(" ")).toMatch(/Lance Frostbite.*passive/);
  });

  it("skips a creature that is not in the roster", () => {
    const { skipped, entries } = convert("Ghostcreature\nWeight from 1 to 2");
    expect(entries).toHaveLength(0);
    expect(skipped).toMatch(/not in roster/);
  });

  it("skips a full stat block", () => {
    const parsed = parseEarlyChanges("Creature: Mirageon\nBasic Stats:\nHealth: 3950");
    const result = creatureDeltasToOverrides(parsed.creatures[0], opts, roster, new Set());
    expect(result.skipped).toMatch(/full stat block/);
  });
});
