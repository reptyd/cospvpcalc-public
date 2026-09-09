// Thin read-only view over data/creatures.runtime.json for the early-changes
// tool: does a creature exist, and which ability category (passive / activated
// / breath) does a given ability name live in. Category is derived from how the
// name is filed across the whole roster so a delta's override lands in the list
// wiki-sync will actually match.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AbilityCategory, AbilityRef } from "./manualOverrides";
import { heuristicBaseOf } from "../../src/shared/subspecies";

const __filename = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(__filename), "..", "..");
const CREATURES_FILE = path.join(ROOT, "data", "creatures.runtime.json");

export interface CreatureRuntime {
  name: string;
  stats: Record<string, number | string | null>;
  passiveAbilities: AbilityRef[];
  activatedAbilities: AbilityRef[];
  breathAbilities: AbilityRef[];
}

function canonical(name: string): string {
  return name.toLowerCase().replace(/[\s_]+/g, "");
}

export class CreatureRoster {
  private byName = new Map<string, CreatureRuntime>();
  private categoryByAbility = new Map<string, AbilityCategory>();

  constructor(creatures: CreatureRuntime[]) {
    for (const creature of creatures) {
      this.byName.set(canonical(creature.name), creature);
      this.recordCategories(creature.passiveAbilities, "passive");
      this.recordCategories(creature.activatedAbilities, "activated");
      this.recordCategories(creature.breathAbilities, "breath");
    }
  }

  private recordCategories(abilities: AbilityRef[], category: AbilityCategory): void {
    for (const ability of abilities) {
      const key = canonical(ability.name);
      // First filing wins; passive is scanned first, so a name that appears in
      // multiple lists keeps its most common (passive) home.
      if (!this.categoryByAbility.has(key)) this.categoryByAbility.set(key, category);
    }
  }

  names(): string[] {
    return [...this.byName.values()].map((c) => c.name);
  }

  has(name: string): boolean {
    return this.byName.has(canonical(name));
  }

  get(name: string): CreatureRuntime | undefined {
    return this.byName.get(canonical(name));
  }

  /** The base creature `name` is a subspecies of ("Icebreaker Meorlark" ->
   *  "Meorlark"), or null when it does not look like one. Uses the same
   *  heuristic the app uses to tag subspecies. */
  subspeciesBaseOf(name: string): string | null {
    const rosterLower = new Set([...this.byName.values()].map((c) => c.name.toLowerCase()));
    return heuristicBaseOf(name, rosterLower);
  }

  /** Category of an ability on a specific creature (most accurate), then the
   *  roster-wide filing, else null when the name is unknown everywhere. */
  categoryOf(abilityName: string, creatureName?: string): AbilityCategory | null {
    const key = canonical(abilityName);
    if (creatureName) {
      const creature = this.get(creatureName);
      if (creature) {
        if (creature.passiveAbilities.some((a) => canonical(a.name) === key)) return "passive";
        if (creature.activatedAbilities.some((a) => canonical(a.name) === key)) return "activated";
        if (creature.breathAbilities.some((a) => canonical(a.name) === key)) return "breath";
      }
    }
    return this.categoryByAbility.get(key) ?? null;
  }
}

export function loadRoster(): CreatureRoster {
  const parsed = JSON.parse(fs.readFileSync(CREATURES_FILE, "utf8")) as {
    creatures: CreatureRuntime[];
  };
  return new CreatureRoster(parsed.creatures);
}
