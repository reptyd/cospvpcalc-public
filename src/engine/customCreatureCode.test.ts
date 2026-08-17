import { describe, expect, it } from "vitest";
import { encodeCustomCreatureCode, decodeCustomCreatureCode } from "./customCreatures";
import type { CustomCreatureRecord } from "./customCreatures";

const record: Pick<CustomCreatureRecord, "creature" | "effects" | "appetite" | "iconName"> = {
  creature: {
    name: "Compact Codec Beast",
    stats: { tier: 5, health: 12500, weight: 34500, damage: 400, biteCooldown: 1.5, healthRegen: 5.5 },
    passiveAbilities: [
      { abilityId: "Bleed Attack", name: "Bleed Attack", value: 2, semantics: "offensive", subtype: null },
      { abilityId: "Block Poison", name: "Block Poison", value: 0.3, semantics: "block", subtype: null },
      { abilityId: "Defensive Injury", name: "Defensive Injury", value: 2.5, semantics: "defensive", subtype: null },
    ],
    activatedAbilities: [
      { abilityId: "Unbridled Rage", name: "Unbridled Rage", value: null, semantics: "neutral", subtype: null },
    ],
  },
  effects: {
    otherAbilities: [{ name: "Bleed Attack", value: 2, semantics: "offensive" }],
    applyStatusOnHit: [{ statusId: "Bleed_Status", stacks: 2, sourceAbility: "Bleed Attack" }],
    applyStatusOnHitTaken: [{ statusId: "Injury_Status", stacks: 2.5, sourceAbility: "Defensive Injury" }],
    resistStatus: [{ statusId: "Poison_Status", fraction: 0.3, sourceAbility: "Block Poison" }],
  },
  appetite: null,
  iconName: null,
};

describe("custom creature share code", () => {
  it("emits the compact COSC2 form and round-trips losslessly", () => {
    const code = encodeCustomCreatureCode(record);
    expect(code.startsWith("COSC2:")).toBe(true);

    const decoded = decodeCustomCreatureCode(code);
    expect(decoded.ok).toBe(true);
    expect(decoded.payload?.creature).toEqual(record.creature);
    expect(decoded.payload?.effects).toEqual(record.effects);
  });

  it("is shorter than the legacy base64 form", () => {
    const code = encodeCustomCreatureCode(record);
    const json = JSON.stringify({ version: 1, creature: record.creature, effects: record.effects, appetite: record.appetite, iconName: record.iconName });
    const legacy = `COSC1:${btoa(unescape(encodeURIComponent(json))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "")}`;
    expect(code.length).toBeLessThan(legacy.length);
  });

  it("still decodes a legacy COSC1 code", () => {
    const json = JSON.stringify({ version: 1, ...record });
    const legacy = `COSC1:${btoa(unescape(encodeURIComponent(json))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "")}`;
    const decoded = decodeCustomCreatureCode(legacy);
    expect(decoded.ok).toBe(true);
    expect(decoded.payload?.creature.name).toBe("Compact Codec Beast");
  });
});
