import { describe, expect, it } from "vitest";
import type { CreatureRuntime, EffectsCatalogByCreature } from "./types";
import { ensureCustomCreatureCatalogBridge } from "./customCreatureCatalogBridge";
import { registerEphemeralCustomCreature } from "./customCreatures";
import { creatureByName, getCreatureByName } from "./creatureData";
import { effectsCatalog } from "./data";

// Integration: proves the lazy bridge actually wires the boot-light registry to
// the real catalog modules. Each test file gets its own module registry, so the
// bridge starts uninstalled here.
describe("customCreatureCatalogBridge", () => {
  it("injects a buffered ephemeral into the real creature catalog on install", () => {
    const name = "__TestBridgeDragon__";
    registerEphemeralCustomCreature({
      creature: { name } as unknown as CreatureRuntime,
      effects: {} as EffectsCatalogByCreature,
      appetite: null,
      iconName: null,
    });
    // Buffered (no injector yet) - not in the live catalog.
    expect(creatureByName[name]).toBeUndefined();

    ensureCustomCreatureCatalogBridge();

    // Drained into the real roster.
    expect(creatureByName[name]).toBeDefined();
    expect(getCreatureByName(name)?.name).toBe(name);
  });

  it("re-derives effects from the creature on apply so a stale baked status row can't win", () => {
    // The shared-match bug: a creature carries a Block Poison ability edited to
    // 100, but its effects still hold the old resist row (0.3). The bridge must
    // recompute from the ability (the source of truth) when it injects, so the
    // engine sees the ability value (capped to 1.0), not the stale 0.3.
    const name = "__TestStaleResistDragon__";
    ensureCustomCreatureCatalogBridge();
    registerEphemeralCustomCreature({
      creature: {
        name,
        stats: { tier: 1, health: 1000, weight: 1000, damage: 100, biteCooldown: 1 },
        passiveAbilities: [
          { abilityId: "Block Poison", name: "Block Poison", value: 100, semantics: "block", subtype: null },
        ],
      } as unknown as CreatureRuntime,
      effects: {
        resistStatus: [{ statusId: "Poison_Status", fraction: 0.3, sourceAbility: "Block Poison" }],
      } as EffectsCatalogByCreature,
      appetite: null,
      iconName: null,
    });

    const poison = (effectsCatalog as Record<string, EffectsCatalogByCreature>)[name]?.resistStatus?.find(
      (e) => e.statusId === "Poison_Status",
    );
    expect(poison?.fraction).toBe(1);
  });
});
