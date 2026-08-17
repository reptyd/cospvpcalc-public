import { describe, expect, it } from "vitest";
import { materializeNewCreature, parseFullCreatures } from "./fullCreatureParser";
import { makeCreatureRefs } from "./creatureRefs";

const MIRAGEON = `Creature: Mirageon

Basic Stats:
Type: Semi-Aquatic
Tier: 3
Health: 3950
Weight: 3350
Damage: 265
BiteCooldown: 1.4
GrowthRate: 2400
Stamina: 120
Speed: 34
SprintSpeed: 98

Dietary:
FoodType: Carnivore
Appetite: 75

Advanced Stats:
HealthRegen: 4
StaminaRegen: 2.5
Nightvision: 3/3
Turn Speed: 3
Oxygen: 110

Advanced Mobility:
DartData: 0, 0, -4
DartStamina: 20
JumpData: 0, 2, -3
JumpStamina: 20

Resistances:
BlockBleed 60
BlockBurn 60
BlockInjury 40

Ailments:
3.5 BurnAttack
3.5 PoisonAttack
2 WingShredder

Effects:
AgileSwimmer 77
Climber

Abilities:
Spite 20
LichMark BlurredVision
DrowsyArea

Stat Insight: Beware the Dreamful Haze, Mirageon!`;

describe("parseFullCreatures - Mirageon", () => {
  const [c] = parseFullCreatures(MIRAGEON);

  it("reads the name and core stats", () => {
    expect(c.name).toBe("Mirageon");
    expect(c.stats).toMatchObject({
      type: "Semi-Aquatic",
      tier: 3,
      health: 3950,
      weight: 3350,
      damage: 265,
      biteCooldown: 1.4,
      stamina: 120,
      walkAndSwimSpeed: 34,
      sprintSpeed: 98,
      diet: "Carnivore",
      appetite: 75,
      healthRegen: 4,
      stamRegen: 2.5,
      turn: 3,
      oxygenTime: 110,
      dartStamina: 20,
      jumpStamina: 20,
    });
  });

  it("takes the first number of a fractional nightvision", () => {
    expect(c.stats.nightvision).toBe(3);
  });

  it("flags GrowthRate, DartData and JumpData rather than guessing", () => {
    const w = c.warnings.join(" ");
    expect(w).toMatch(/GrowthRate/);
    expect(w).toMatch(/DartData/);
    expect(w).toMatch(/JumpData/);
    expect(c.stats.growthTime).toBeUndefined();
    expect(c.stats.dartPower).toBeUndefined();
  });

  it("files resistances and ailments as passive abilities", () => {
    const passiveNames = c.passiveAbilities.map((a) => a.name);
    expect(passiveNames).toContain("Block Bleed");
    expect(passiveNames).toContain("Block Injury");
    expect(passiveNames).toContain("Burn Attack");
    expect(passiveNames).toContain("Wing Shredder");
    expect(passiveNames).toContain("Agile Swimmer");
    const block = c.passiveAbilities.find((a) => a.name === "Block Bleed");
    expect(block).toMatchObject({ value: 0.6, semantics: "block" }); // 60% -> runtime fraction
    const burn = c.passiveAbilities.find((a) => a.name === "Burn Attack");
    expect(burn).toMatchObject({ value: 3.5, semantics: "offensive" });
  });

  it("files the Abilities section as activated", () => {
    const activated = c.activatedAbilities.map((a) => a.name);
    expect(activated).toContain("Spite");
    expect(activated).toContain("Drowsy Area");
    expect(c.activatedAbilities.find((a) => a.name === "Spite")?.value).toBe(20);
  });

  it("captures the insight", () => {
    expect(c.insight).toContain("Dreamful Haze");
  });
});

describe("parseFullCreatures - flier breath", () => {
  const [c] = parseFullCreatures(
    `Creature: Velkhyra\nBasic Stats:\nType: Flier\nTier: 3\nHealth: 2400\nWeight: 2700\nDamage: 160\nBiteCooldown: 0.6\nFlySpeed: 43\nFlySprintMultiplier: 1.4\nAdvanced Stats:\nGlideRegen: 2\nTakeoff: 15\nAbilities:\nBreath Miasma\nGrab`,
  );

  it("maps flier stats and the breath", () => {
    expect(c.stats.flySpeed).toBe(43);
    expect(c.stats.flySprintMultiplier).toBe(1.4);
    expect(c.stats.glideStaminaRegen).toBe(2);
    expect(c.stats.takeoffMultiplier).toBe(15);
    expect(c.breath).toBe("Miasma");
    expect(c.breathAbilities[0]).toMatchObject({ abilityId: "Breath", name: "Miasma", subtype: "Miasma" });
    expect(c.activatedAbilities.map((a) => a.name)).toContain("Grab");
  });
});

describe("materializeNewCreature", () => {
  it("builds a full-shaped CreatureRuntime with all fields present", () => {
    const [parsed] = parseFullCreatures(MIRAGEON);
    const { creature } = materializeNewCreature(parsed);
    expect(creature.name).toBe("Mirageon");
    expect(creature.stats.tier).toBe(3);
    expect(creature.stats.breath).toBe("N/A");
    // unset optionals default to null, not undefined
    expect(creature.stats.dartPower).toBeNull();
    expect(creature.stats.venerationRate).toBeNull();
    expect(creature.stats.mobilityOverride).toBe("");
    expect(creature.passiveAbilities.length).toBeGreaterThan(0);
  });

  it("defaults and flags a missing required stat", () => {
    const [parsed] = parseFullCreatures(`Creature: Stub\nBasic Stats:\nHealth: 100`);
    const { creature, warnings } = materializeNewCreature(parsed);
    expect(creature.stats.tier).toBe(0);
    expect(creature.stats.biteCooldown).toBe(1);
    expect(warnings.join(" ")).toMatch(/Required stat "tier" missing/);
  });
});

describe("parseFullCreatures - refs canonicalisation", () => {
  const refs = makeCreatureRefs(
    new Map([
      ["toxin", "Toxin Breath"],
      ["toxinbreath", "Toxin Breath"],
      ["plasmabeam", "Plasma Beam"],
    ]),
    new Map([["lichmark", "Lich Mark"]]),
  );
  const [c] = parseFullCreatures(
    `Creature: Thryxx\nAbilities:\nBreath Toxin\nLichMark BrokenLegs\nShadowBarrage 3`,
    refs,
  );

  it("canonicalises a 'Breath X' line to the engine breath name", () => {
    expect(c.breath).toBe("Toxin Breath");
    expect(c.breathResolved).toBe(true);
    expect(c.breathAbilities[0]).toMatchObject({ abilityId: "Breath", name: "Toxin Breath" });
  });

  it("splits an ability + status-subtype into name + value, keeping numeric values", () => {
    const lich = c.activatedAbilities.find((a) => a.name === "Lich Mark");
    expect(lich?.value).toBe("Broken Legs");
    expect(c.activatedAbilities.find((a) => a.name === "Shadow Barrage")?.value).toBe(3);
    // The concatenated mis-parse must not survive.
    expect(c.activatedAbilities.map((a) => a.name)).not.toContain("Lich Mark Broken Legs");
  });

  it("keeps an unknown breath raw and flags it (no guessing)", () => {
    const [d] = parseFullCreatures(`Creature: X\nAbilities:\nBreath Nonsense`, refs);
    expect(d.breath).toBe("Nonsense");
    expect(d.breathResolved).toBe(false);
    expect(materializeNewCreature(d).warnings.join(" ")).toMatch(/unrecognised/);
  });
});
