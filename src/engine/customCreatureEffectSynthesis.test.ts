import { describe, expect, it } from "vitest";
import { synthesizeCustomCreatureEffects } from "./customCreatureEffectSynthesis";
import { normalizeCustomCreaturePayload } from "./customCreatureValidation";

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

  it("caps a block fraction at 1.0 so display, validation, and the engine agree", () => {
    const normalized = normalizeCustomCreaturePayload({
      creature: {
        name: "Custom Overblock",
        stats: baseStats,
        passiveAbilities: [
          { abilityId: "Block Poison", name: "Block Poison", value: 100, semantics: "block", subtype: null },
          { abilityId: "Block Necropoison", name: "Block Necropoison", value: 0.6, semantics: "block", subtype: null },
        ],
      },
      effects: {},
    });

    expect(normalized.ok).toBe(true);
    const effects = normalized.payload?.effects;
    // 100 (would display as "10000%") is clamped to the engine's 100% ceiling.
    expect(effects?.resistStatus).toContainEqual({
      statusId: "Poison_Status",
      fraction: 1,
      sourceAbility: "Block Poison",
    });
    // Necropoison stays distinct from Poison (shared table, not the legacy alias).
    expect(effects?.resistStatus).toContainEqual({
      statusId: "Necropoison_Status",
      fraction: 0.6,
      sourceAbility: "Block Necropoison",
    });
  });

  it("clamps an explicit out-of-range resist fraction and warns the user", () => {
    const normalized = normalizeCustomCreaturePayload({
      creature: { name: "Custom Explicit Resist", stats: baseStats },
      effects: {
        resistStatus: [{ statusId: "Bleed_Status", fraction: 100, sourceAbility: "Block Bleed" }],
      },
    });

    expect(normalized.ok).toBe(true);
    expect(normalized.payload?.effects.resistStatus).toContainEqual({
      statusId: "Bleed_Status",
      fraction: 1,
      sourceAbility: "Block Bleed",
    });
    expect(normalized.warnings.some((w) => w.includes("capped to 1.0"))).toBe(true);
  });

  it("lets the named ability override a stale status row left in the effects", () => {
    // Repro of the shared-match bug: the ability value was edited (Block Poison
    // -> 100, Defensive Poison -> 3) but the effects still carried the old
    // derived rows (resist 0.3, on-hit-taken 4.5). The ability is the source of
    // truth, so synthesis must win with the ability-derived value.
    const effects = synthesizeCustomCreatureEffects(
      {
        name: "Stale Effects Repro",
        stats: baseStats,
        passiveAbilities: [
          { abilityId: "Block Poison", name: "Block Poison", value: 100, semantics: "block", subtype: null },
          { abilityId: "Defensive Poison", name: "Defensive Poison", value: 3, semantics: "defensive", subtype: null },
        ],
      },
      {
        resistStatus: [{ statusId: "Poison_Status", fraction: 0.3, sourceAbility: "Block Poison" }],
        applyStatusOnHitTaken: [{ statusId: "Poison_Status", stacks: 4.5, sourceAbility: "Defensive Poison" }],
      },
    );

    const poisonResist = effects.resistStatus?.filter((e) => e.statusId === "Poison_Status") ?? [];
    expect(poisonResist).toHaveLength(1);
    expect(poisonResist[0].fraction).toBe(1); // 100 -> capped, NOT the stale 0.3

    const poisonDefensive = effects.applyStatusOnHitTaken?.filter((e) => e.statusId === "Poison_Status") ?? [];
    expect(poisonDefensive).toHaveLength(1);
    expect(poisonDefensive[0].stacks).toBe(3); // the ability value, NOT the stale 4.5
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

  it("preserves a user-authored custom breath profile", () => {
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
