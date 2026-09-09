// The bridge between the boot-light custom-creature *registry*
// (`customCreatures.ts`) and the heavy *catalog* modules. Importing THIS module
// is what statically pulls creatureData (788 kB) + data/effects (445 kB) +
// compareAppetiteData, so it must only ever be reached lazily:
//   - App.loadCreatureData() (the async creature-data gateway), and
//   - the custom-creature write path (registerCustomCreatureRecord), which
//     dynamically imports it before validating/applying a save.
// This is the seam that keeps the boot main thread from parsing the catalogs.
import {
  creatureByName,
  registerTemporaryCreature,
  unregisterTemporaryCreature,
} from "./creatureData";
import {
  registerTemporaryCreatureEffects,
  unregisterTemporaryCreatureEffects,
} from "./data";
import { clampEffectsBlockFractions } from "./effectDerivation";
import { synthesizeCustomCreatureEffects } from "./customCreatureEffectSynthesis";
import {
  registerTemporaryCompareAppetiteEntry,
  unregisterTemporaryCompareAppetiteEntry,
} from "./compareAppetiteData";
import {
  installCustomCreatureCatalogInjector,
  type CustomCreatureCatalogInjector,
} from "./customCreatures";

const injector: CustomCreatureCatalogInjector = {
  applyCreature(record) {
    // Mirrors the original inline registration order in customCreatures.ts.
    // Re-derive effects from the creature definition here - the single seam
    // every load path (editor save, localStorage restore, share-link/match
    // ephemeral, COSC decode) funnels through. A named ability is the source of
    // truth, so this overrides any stale status row baked into a previously
    // saved/shared `effects` (e.g. a Block Poison ability edited to 100 whose
    // resist row was left at an old 0.3). Block fractions are then capped to the
    // engine's [-inf, 1] domain.
    registerTemporaryCreature(record.creature, {
      iconName: record.iconName,
      iconDataUrl: record.iconDataUrl,
    });
    registerTemporaryCreatureEffects(
      record.creature.name,
      clampEffectsBlockFractions(synthesizeCustomCreatureEffects(record.creature, record.effects)),
    );
    if (record.appetite) {
      registerTemporaryCompareAppetiteEntry(record.creature.name, record.appetite);
    } else {
      // Clear any stale appetite (e.g. on a replace that dropped the profile).
      unregisterTemporaryCompareAppetiteEntry(record.creature.name);
    }
  },
  removeCreature(name) {
    unregisterTemporaryCompareAppetiteEntry(name);
    unregisterTemporaryCreatureEffects(name);
    unregisterTemporaryCreature(name);
  },
  allKnownNames() {
    // Full live roster (base + every temporarily-registered custom), which is
    // exactly the set the registry's name-conflict check needs.
    return Object.keys(creatureByName);
  },
};

let installed = false;

/**
 * Idempotently wire the custom-creature registry to the live catalog. On first
 * call the injector drains every creature registered or restored before the
 * catalog was ready (persisted records held in the registry Map + buffered
 * share-link ephemerals), so the runtime catalog ends up identical regardless
 * of whether registration happened before or after the catalog loaded.
 */
export function ensureCustomCreatureCatalogBridge(): void {
  if (installed) return;
  installed = true;
  installCustomCreatureCatalogInjector(injector);
}
