// Reference lookups the full-creature parser uses to canonicalise a drop
// against what the runtime already knows: which breath a "Breath X" line names,
// and which multi-word ability tokens are really an ability + a value-subtype
// ("LichMark BrokenLegs" -> name "Lich Mark", value "Broken Legs"). Both are
// derived from the live data so a new breath / ability is picked up for free.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AbilityRef } from "./manualOverrides";
import type { CreatureRuntime } from "./creatureRoster";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const CREATURES_FILE = path.join(ROOT, "data", "creatures.runtime.json");
const BREATH_FILE = path.join(ROOT, "data", "breath_specs.runtime.json");

function canonical(s: string): string {
  return s.toLowerCase().replace(/[\s_()]+/g, "");
}

export interface CreatureParseRefs {
  /** Canonical breath name for a "Breath X" line's type (X), or null when X
   *  matches no known breath - e.g. "Toxin" -> "Toxin Breath", "Plasma Beam"
   *  -> "Plasma Beam". */
  canonicalBreath(type: string): string | null;
  /** Split an ability token into name + value-subtype when its prefix is a
   *  known ability that carries a string value ("Lich Mark" -> value "Drowsy"
   *  in the roster), else null. `token` is the already space-split display form
   *  ("Lich Mark Broken Legs"). Longest matching prefix wins. */
  matchSubtypeAbility(token: string): { name: string; value: string } | null;
}

function buildBreathLookup(creatures: CreatureRuntime[]): Map<string, string> {
  const specs = JSON.parse(fs.readFileSync(BREATH_FILE, "utf8")) as {
    breathTypes: { name: string }[];
  };
  const byKey = new Map<string, string>();
  for (const b of specs.breathTypes) {
    // Key by the full name AND the name minus a trailing " Breath", so both
    // "Toxin" and "Toxin Breath" resolve, while special names (Plasma Beam)
    // still match on their full form.
    byKey.set(canonical(b.name), b.name);
    const stem = b.name.replace(/\s*breath$/i, "").trim();
    if (stem && !byKey.has(canonical(stem))) byKey.set(canonical(stem), b.name);
  }
  // Fallback: breaths creatures actually carry that the spec list doesn't
  // enumerate (e.g. Plasma Beam). breath_specs stays authoritative - only add
  // keys it didn't already provide, so a stray creature breath ("Toxin") can't
  // shadow the canonical "Toxin Breath".
  for (const c of creatures) {
    const b = c.stats?.breath;
    if (typeof b === "string" && b && b !== "N/A") {
      const key = canonical(b);
      if (!byKey.has(key)) byKey.set(key, b);
    }
  }
  return byKey;
}

/** Ability display names that carry a string value-subtype somewhere in the
 *  roster (Lich Mark = Drowsy, Lance = Frostbite, ...). Concatenated mis-parses
 *  ("Lich Mark Broken Legs", value null) are excluded by the string-value
 *  filter, so they can't shadow the real base ability. */
function buildSubtypeAbilities(creatures: CreatureRuntime[]): Map<string, string> {
  const byKey = new Map<string, string>();
  const scan = (abilities: AbilityRef[]) => {
    for (const a of abilities) {
      if (typeof a.value === "string" && a.value.trim()) byKey.set(canonical(a.name), a.name);
    }
  };
  for (const c of creatures) {
    scan(c.activatedAbilities);
    scan(c.passiveAbilities);
    scan(c.breathAbilities);
  }
  return byKey;
}

export function loadCreatureRefs(): CreatureParseRefs {
  const parsed = JSON.parse(fs.readFileSync(CREATURES_FILE, "utf8")) as { creatures: CreatureRuntime[] };
  const breathByKey = buildBreathLookup(parsed.creatures);
  const subtypeByKey = buildSubtypeAbilities(parsed.creatures);
  return makeCreatureRefs(breathByKey, subtypeByKey);
}

/** Pure constructor over the lookups, so tests can supply their own. */
export function makeCreatureRefs(
  breathByKey: Map<string, string>,
  subtypeByKey: Map<string, string>,
): CreatureParseRefs {
  return {
    canonicalBreath(type) {
      return breathByKey.get(canonical(type)) ?? null;
    },
    matchSubtypeAbility(token) {
      const words = token.trim().split(/\s+/);
      // Longest ability prefix leaving a non-empty value wins.
      for (let cut = words.length - 1; cut >= 1; cut--) {
        const name = subtypeByKey.get(canonical(words.slice(0, cut).join(" ")));
        if (name) return { name, value: words.slice(cut).join(" ") };
      }
      return null;
    },
  };
}
