import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CreatureRuntime, EffectsCatalogByCreature } from "./types";
import type { CustomCreatureRecord, CustomCreatureCatalogInjector } from "./customCreatures";

const STORAGE_KEY = "cos_calc.customCreatures.v1";

function makeRecord(name: string): CustomCreatureRecord {
  return {
    creature: { name } as unknown as CreatureRuntime,
    effects: {} as EffectsCatalogByCreature,
    appetite: null,
    iconName: null,
    iconDataUrl: null,
    createdAt: 123,
  };
}

/** Recording mock injector - stands in for the real catalog bridge. */
function makeMockInjector() {
  const applied: string[] = [];
  const removed: string[] = [];
  const injector: CustomCreatureCatalogInjector = {
    applyCreature: (record) => applied.push(record.creature.name),
    removeCreature: (name) => removed.push(name),
    allKnownNames: () => [],
  };
  return { injector, applied, removed };
}

describe("customCreatures registry / catalog decouple", () => {
  beforeEach(() => {
    // Fresh module singleton (resets catalogInjector + the records Map + the
    // pending-ephemeral buffer) and a clean in-memory localStorage per test.
    vi.resetModules();
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    });
  });

  it("drains records restored before the injector was installed", async () => {
    const mod = await import("./customCreatures");
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ version: 1, records: [makeRecord("Foo"), makeRecord("Bar")] }),
    );
    // Restore runs at boot WITHOUT a catalog - records sit in the Map only.
    mod.restoreCustomCreatureRecords();
    const { injector, applied } = makeMockInjector();

    mod.installCustomCreatureCatalogInjector(injector);

    expect(applied.sort()).toEqual(["Bar", "Foo"]);
  });

  it("buffers an ephemeral registered before install, then drains it on install", async () => {
    const mod = await import("./customCreatures");
    mod.registerEphemeralCustomCreature(makeRecord("Ghost"));
    const { injector, applied } = makeMockInjector();

    mod.installCustomCreatureCatalogInjector(injector);

    expect(applied).toEqual(["Ghost"]);
  });

  it("applies an ephemeral immediately when the injector is already installed", async () => {
    const mod = await import("./customCreatures");
    const { injector, applied } = makeMockInjector();
    mod.installCustomCreatureCatalogInjector(injector);

    mod.registerEphemeralCustomCreature(makeRecord("Live"));

    expect(applied).toEqual(["Live"]);
  });

  it("injects restored records immediately when the injector is already installed", async () => {
    const mod = await import("./customCreatures");
    const { injector, applied } = makeMockInjector();
    mod.installCustomCreatureCatalogInjector(injector);
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ version: 1, records: [makeRecord("Baz")] }),
    );

    mod.restoreCustomCreatureRecords();

    expect(applied).toContain("Baz");
    expect(mod.getCustomCreatureRecord("Baz")).not.toBeNull();
  });

  it("removes from both the Map and the catalog on unregister", async () => {
    const mod = await import("./customCreatures");
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ version: 1, records: [makeRecord("Baz")] }),
    );
    mod.restoreCustomCreatureRecords();
    const { injector, removed } = makeMockInjector();
    mod.installCustomCreatureCatalogInjector(injector);

    mod.unregisterCustomCreatureRecord("Baz");

    expect(removed).toEqual(["Baz"]);
    expect(mod.getCustomCreatureRecord("Baz")).toBeNull();
  });

  it("uses the injector's full roster for known names once installed", async () => {
    const mod = await import("./customCreatures");
    // Before install, only the registry's own names are knowable.
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ version: 1, records: [makeRecord("OnlyCustom")] }),
    );
    mod.restoreCustomCreatureRecords();
    const injector: CustomCreatureCatalogInjector = {
      applyCreature: () => {},
      removeCreature: () => {},
      allKnownNames: () => ["BaseCreature", "OnlyCustom"],
    };
    mod.installCustomCreatureCatalogInjector(injector);
    // listCustomCreatureRecords still reflects the registry (custom-only).
    expect(mod.listCustomCreatureRecords().map((r) => r.creature.name)).toEqual(["OnlyCustom"]);
  });
});
