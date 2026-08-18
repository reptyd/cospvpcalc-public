import { describe, expect, it } from "vitest";
import { parseAbilityToken, parseEarlyChanges, splitCamelCase } from "./earlyChangeParser";

describe("parseAbilityToken", () => {
  it("reads a trailing value", () => {
    expect(parseAbilityToken("AreaWindBlast 200")).toEqual({ name: "Area Wind Blast", value: 200 });
  });
  it("reads a leading value", () => {
    expect(parseAbilityToken("2 BurnAttack")).toEqual({ name: "Burn Attack", value: 2 });
  });
  it("reads a bare name", () => {
    expect(parseAbilityToken("Charge Launch")).toEqual({ name: "Charge Launch", value: null });
  });
  it("splits CamelCase", () => {
    expect(splitCamelCase("BlockFrostbite")).toBe("Block Frostbite");
  });
});

describe("parseEarlyChanges - delta block", () => {
  const text = `Icebreaker Meorlark

Weight from 5600 to 6000
Damage from 475 to 425
HealthRegen from 5 to 4
BlockFrostbite from 35 to 50
InjuryAttack from 2 to 3
BleedAttack from 3 to 0.5
Addition of Frosty
Addition of Charge Launch
Addition of Lance Frostbite

Stat Insight: Icebreaker Meorlark is bulkier than Meorlark.`;

  const parsed = parseEarlyChanges(text);

  it("finds one creature", () => {
    expect(parsed.creatures).toHaveLength(1);
    expect(parsed.creatures[0].creature).toBe("Icebreaker Meorlark");
    expect(parsed.format).toBe("delta");
  });

  it("maps core numeric stats to fields", () => {
    const byField = Object.fromEntries(
      parsed.creatures[0].deltas.filter((d) => d.kind === "stat").map((d) => [d.field, [d.from, d.to]]),
    );
    expect(byField.weight).toEqual([5600, 6000]);
    expect(byField.damage).toEqual([475, 425]);
    expect(byField.healthRegen).toEqual([5, 4]);
  });

  it("treats resistances and ailments as ability-value changes, not stats", () => {
    const block = parsed.creatures[0].deltas.find((d) => d.ability === "Block Frostbite");
    expect(block).toMatchObject({ kind: "ability-value", from: 35, to: 50 });
    const bleed = parsed.creatures[0].deltas.find((d) => d.ability === "Bleed Attack");
    expect(bleed).toMatchObject({ kind: "ability-value", from: 3, to: 0.5 });
  });

  it("captures additions with and without values", () => {
    const adds = parsed.creatures[0].deltas.filter((d) => d.kind === "ability-add").map((d) => d.ability);
    expect(adds).toEqual(["Frosty", "Charge Launch", "Lance Frostbite"]);
  });

  it("captures the insight", () => {
    expect(parsed.creatures[0].insight).toContain("bulkier than Meorlark");
  });
});

describe("parseEarlyChanges - value-first addition", () => {
  it("reads 'Addition of 2 BurnAttack' as Burn Attack value 2", () => {
    const parsed = parseEarlyChanges(`Ashen Sochuri\nAddition of 2 BurnAttack`);
    expect(parsed.creatures[0].deltas[0]).toMatchObject({
      kind: "ability-add",
      ability: "Burn Attack",
      value: 2,
    });
  });
});

describe("parseEarlyChanges - Notion aside", () => {
  const text = `<aside>
**Buffs**

- **Celeritas**

    Addition of AreaWindBlast 200
    BlockPoison from 20 to 80

    ***Insight: Big wings means big flaps, and big gusts of wind!*

</aside>`;

  const parsed = parseEarlyChanges(text);

  it("skips the section heading and finds the creature", () => {
    expect(parsed.creatures.map((c) => c.creature)).toEqual(["Celeritas"]);
    expect(parsed.format).toBe("notion-aside");
  });

  it("parses the buffs", () => {
    const add = parsed.creatures[0].deltas.find((d) => d.kind === "ability-add");
    expect(add).toMatchObject({ ability: "Area Wind Blast", value: 200 });
    const block = parsed.creatures[0].deltas.find((d) => d.kind === "ability-value");
    expect(block).toMatchObject({ ability: "Block Poison", from: 20, to: 80 });
  });
});

describe("parseEarlyChanges - Notion multi-creature with removal", () => {
  const text = `<aside>
**Buffs**
- **Halaqual**
    Addition of AreaWindBlast 100
    ***Insight: Some more wind in Halaqual's cloudy sails!*
- **Shiziyou**
    Removal of CursedSigil
    Addition of AreaWindBlast 175
    ***Insight: Another trick up the sleeve!*
</aside>`;

  const parsed = parseEarlyChanges(text);

  it("separates the two creatures", () => {
    expect(parsed.creatures.map((c) => c.creature)).toEqual(["Halaqual", "Shiziyou"]);
  });

  it("reads a removal", () => {
    const remove = parsed.creatures[1].deltas.find((d) => d.kind === "ability-remove");
    expect(remove?.ability).toBe("Cursed Sigil");
  });
});

describe("parseEarlyChanges - full stat block is routed, not delta-parsed", () => {
  it("marks a 'Creature:' block as new-full", () => {
    const text = `Creature: Mirageon\n\nBasic Stats:\nType: Semi-Aquatic\nHealth: 3950`;
    const parsed = parseEarlyChanges(text);
    expect(parsed.creatures[0]).toMatchObject({ creature: "Mirageon", kind: "new-full" });
    expect(parsed.format).toBe("full-creature");
  });
});
