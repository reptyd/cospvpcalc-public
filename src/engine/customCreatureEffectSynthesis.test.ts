import { describe, expect, it } from "vitest";
import { applyRulesAndBuild } from "./engine";
import { __test_buildCombatantRuntime } from "./engineTestApi";
import { creatureByName } from "./creatureData";
import { effectsCatalog } from "./data";
import { normalizeCustomCreaturePayload } from "./customCreatureValidation";
import type { CreatureRuntime, EffectsCatalogByCreature } from "./types";

const baseStats = {
  tier: 1,
  health: 1000,
  weight: 1000,
  damage: 100,
  biteCooldown: 1,
};

describe("custom creature effect synthesis", () => {
  it("mirrors all custom ability kinds and derives offensive, defensive, and block status effects", () => {
    const normalized = normalizeCustomCreaturePayload({
      creature: {
        name: "Custom Status Synthesis",
        stats: baseStats,
        passiveAbilities: [
          { abilityId: "Burn Attack", name: "Burn Attack", value: 3, semantics: "offensive", subtype: null },
        ],
        activatedAbilities: [
          { abilityId: "Defensive Burn", name: "Defensive Burn", value: 2, semantics: "defensive", subtype: null },
        ],
        breathAbilities: [
          { abilityId: "Plasma Beam", name: "Plasma Beam", value: null, semantics: "offensive", subtype: null },
        ],
      },
      effects: {
        otherAbilities: [{ name: "Block Burn", value: 0.4, semantics: "block" }],
      },
    });

    expect(normalized.ok).toBe(true);
    const effects = normalized.payload?.effects;
    expect(effects?.otherAbilities?.map((entry) => entry.name)).toEqual([
      "Block Burn",
      "Burn Attack",
      "Defensive Burn",
      "Plasma Beam",
    ]);
    expect(effects?.applyStatusOnHit).toContainEqual({
      statusId: "Burn_Status",
      stacks: 3,
      sourceAbility: "Burn Attack",
    });
    expect(effects?.applyStatusOnHitTaken).toContainEqual({
      statusId: "Burn_Status",
      stacks: 2,
      sourceAbility: "Defensive Burn",
    });
    expect(effects?.resistStatus).toContainEqual({
      statusId: "Burn_Status",
      fraction: 0.4,
      sourceAbility: "Block Burn",
    });
  });

  it("lets runtime active flags read custom active abilities from effects when creature arrays are sparse", () => {
    const creature: CreatureRuntime = {
      name: "Custom Effects Only Warden",
      stats: baseStats,
    };
    const effects: EffectsCatalogByCreature = {
      otherAbilities: [{ name: "Warden's Rage", value: null, semantics: "neutral" }],
    };
    (creatureByName as Record<string, CreatureRuntime>)[creature.name] = creature;
    (effectsCatalog as Record<string, EffectsCatalogByCreature>)[creature.name] = effects;

    try {
      const final = applyRulesAndBuild(creature, {
        venerationStage: 0,
        traits: [],
        ascensionAssignments: ["", "", "", "", ""],
        plushies: [],
      });
      const runtime = __test_buildCombatantRuntime(final);
      expect(runtime.hasWardenRage).toBe(true);
    } finally {
      delete (creatureByName as Record<string, CreatureRuntime>)[creature.name];
      delete (effectsCatalog as Record<string, EffectsCatalogByCreature>)[creature.name];
    }
  });

  it("normalizes configurable custom ability values before registration", () => {
    const normalized = normalizeCustomCreaturePayload({
      creature: {
        name: "Custom Yolk Values",
        stats: baseStats,
        activatedAbilities: [
          { abilityId: "Yolk Bomb", name: "Yolk Bomb", value: "Bad Omen", semantics: "neutral", subtype: null },
        ],
      },
      effects: {},
    });

    expect(normalized.ok).toBe(true);
    expect(normalized.payload?.creature.activatedAbilities?.[0]?.value).toBe("BadOmen");
    expect(normalized.payload?.effects.otherAbilities).toContainEqual({
      name: "Yolk Bomb",
      value: "BadOmen",
      semantics: "neutral",
    });
  });

  it("preserves a user-authored custom breath profile (Phase 7 / G7)", () => {
    const normalized = normalizeCustomCreaturePayload({
      creature: {
        name: "Custom Breath Beast",
        stats: { ...baseStats, breath: "Custom" },
        customBreathProfile: {
          dpsPct: 4,
          capacity: 10,
          regenRate: 8,
          critChancePct: 0,
          chain: 0,
          chainMaxStacks: 0,
          specialKind: "lance",
          lanceDamagePct: 5,
          lanceChargeSec: 3,
          lanceCooldownSec: 60,
          lanceStatusId: "Burn_Status",
          specialStatuses: [{ statusId: "user.CustomBurn", stacks: 2 }],
        },
      },
      effects: {},
    });

    expect(normalized.ok).toBe(true);
    const profile = normalized.payload?.creature.customBreathProfile;
    expect(profile).toBeDefined();
    expect(profile?.dpsPct).toBe(4);
    expect(profile?.specialKind).toBe("lance");
    expect(profile?.lanceDamagePct).toBe(5);
    expect(profile?.lanceStatusId).toBe("Burn_Status");
    expect(profile?.specialStatuses).toEqual([{ statusId: "user.CustomBurn", stacks: 2 }]);
    // A custom profile suppresses the "breath spec not found" warning for the
    // sentinel "Custom" breath name.
    expect(normalized.warnings.some((w) => w.includes("Breath spec"))).toBe(false);
  });
});
