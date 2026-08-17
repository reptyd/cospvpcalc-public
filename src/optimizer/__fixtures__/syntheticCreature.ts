// Test-only helpers for building synthetic creatures whose stats and ability
// values are OWNED by the test, not read from live game data.
//
// A behavioral test (does the builder thread a field? does the catalog fallback
// fire?) must drive the code with one of these fixtures - or assert a relation
// against a live field - so that a routine wiki sync changing a creature's stats
// or ability values can never false-fail it. Asserting a raw game number that
// the sync owns is the anti-pattern this module exists to replace.
// See docs/data_refresh.md ("Tests and data coupling").

import type { AbilityRef, CreatureRuntime, CreatureStats, EffectsCatalogByCreature } from "../../engine/types";
import { registerTemporaryCreature, unregisterTemporaryCreature } from "../../engine/creatureData";
import { registerTemporaryCreatureEffects, unregisterTemporaryCreatureEffects } from "../../engine/data";

// A neutral, obviously-synthetic stat block: valid for applyRulesAndBuild
// (positive tier / health / weight / damage / cooldown) and not any real
// creature's numbers. Override per fixture only when a test needs a specific
// stat.
const BASELINE_STATS: CreatureStats = {
  tier: 5,
  health: 10_000,
  weight: 100,
  damage: 100,
  biteCooldown: 1,
  healthRegen: 0,
  breathResistance: 0,
};

/** One ability entry with a test-chosen value. `value` is the number/string the
 *  ability carries (e.g. Shadow Barrage `7`, Totem `"Radiation"`); null = present
 *  but value-less. */
export function makeAbility(
  name: string,
  value: AbilityRef["value"] = null,
  opts: { semantics?: AbilityRef["semantics"]; subtype?: string | null; abilityId?: string } = {},
): AbilityRef {
  return {
    abilityId: opts.abilityId ?? name.replace(/[^A-Za-z0-9]+/g, "_"),
    name,
    value,
    semantics: opts.semantics ?? "neutral",
    subtype: opts.subtype ?? null,
  };
}

/** Build a synthetic creature from explicit, test-owned fields. */
export function makeSyntheticCreature(spec: {
  name: string;
  stats?: Partial<CreatureStats>;
  passiveAbilities?: AbilityRef[];
  activatedAbilities?: AbilityRef[];
  breathAbilities?: AbilityRef[];
}): CreatureRuntime {
  return {
    name: spec.name,
    stats: { ...BASELINE_STATS, ...spec.stats },
    passiveAbilities: spec.passiveAbilities ?? [],
    activatedAbilities: spec.activatedAbilities ?? [],
    breathAbilities: spec.breathAbilities ?? [],
  };
}

/**
 * Register a synthetic creature + its effects-catalog entry into the global
 * catalogs (the same production seams custom creatures use), run `fn`, then
 * always unregister - even if `fn` throws - so the test stays hermetic.
 *
 * Use this only when the code under test reads the GLOBAL catalog by creature
 * name (e.g. the catalog fallback in `resolveRuntimeAbilityValue`). Tests that
 * pass a `CreatureRuntime` straight into a builder don't need registration.
 */
export function withRegisteredFixture<T>(
  creature: CreatureRuntime,
  effects: EffectsCatalogByCreature,
  fn: () => T,
): T {
  registerTemporaryCreature(creature);
  registerTemporaryCreatureEffects(creature.name, effects);
  try {
    return fn();
  } finally {
    unregisterTemporaryCreatureEffects(creature.name);
    unregisterTemporaryCreature(creature.name);
  }
}
