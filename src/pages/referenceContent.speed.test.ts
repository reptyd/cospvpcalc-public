import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { SPEED_EFFECTS } from "../speed/speedEffects";
import {
  BATTLE_SETTING_REFERENCE_DRAFTS,
  MODELED_ABILITY_REFERENCE_DRAFTS,
  MOVEMENT_SPEED_REFERENCE_DRAFTS,
  PLUSHIE_REFERENCE_DRAFTS,
  STATUS_REFERENCE_DRAFTS,
} from "./referenceContent";

// What the Movement section claims about itself rather than about a figure:
// which registry rows it joins, and that no movement figure can reach a fight.
// The figures are checked one claim at a time, with the numbers written out, in
// src/speed/referenceMovement.test.ts.

/** A Movement effect entry is its registry row's id behind this prefix. */
const EFFECT_PREFIX = "speed_effect_";

const entryIds = new Set(MOVEMENT_SPEED_REFERENCE_DRAFTS.map((entry) => entry.id));

describe("the Movement section against the registry", () => {
  it("gives every effect entry a registry row, and leaves rows for the other sections", () => {
    const rowIds = new Set(SPEED_EFFECTS.map((effect) => effect.id));
    const orphans = [...entryIds].filter((id) => id.startsWith(EFFECT_PREFIX) && !rowIds.has(id.slice(EFFECT_PREFIX.length)));
    expect(orphans, `Movement entries naming no registry row: ${orphans.join(", ")}`).toEqual([]);
    // Rows documented elsewhere - a plushie, an ability, a status - carry their
    // movement side in that entry rather than a second one here.
    expect(SPEED_EFFECTS.filter((effect) => !entryIds.has(`${EFFECT_PREFIX}${effect.id}`)).length).toBeGreaterThan(0);
  });

  // "Every effect that moves a movement channel is described once. An effect
  // with an entry of its own in another section carries its movement side
  // there." A row with neither is an effect the page applies and nothing
  // describes. [REF:speed_out_of_combat_model]
  it("describes every effect it applies, here or in another section", () => {
    const elsewhere = new Set(
      [
        ...MODELED_ABILITY_REFERENCE_DRAFTS,
        ...BATTLE_SETTING_REFERENCE_DRAFTS,
        ...STATUS_REFERENCE_DRAFTS,
        ...PLUSHIE_REFERENCE_DRAFTS,
      ].map((draft) => draft.name),
    );
    const undescribed = SPEED_EFFECTS.filter((effect) => {
      if (entryIds.has(`${EFFECT_PREFIX}${effect.id}`)) return false;
      return ![effect.label, effect.plushie, effect.ability, effect.trait].some((name) => name && elsewhere.has(name));
    }).map((effect) => effect.label);
    expect(
      undescribed,
      `The registry applies these and no Reference entry describes them: ${undescribed.join(", ")}`,
    ).toEqual([]);
  });

  // "No movement channel reaches a fight. Speed Builds ranks movement stats and
  // simulates no combat." Read as an import-graph fact: the movement registry is
  // reachable from the Speed Builds surface and from nowhere else, so no combat
  // path can pick a movement figure up. [REF:speed_out_of_combat_model]
  it("keeps the movement registry out of every path that reaches a fight", () => {
    const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "..");
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.tsx?$/.test(name)) files.push(path);
      }
    };
    walk(SRC);

    const readers = files
      .filter((path) => /from "[^"]*\/speed\/speed\w+"/.test(readFileSync(path, "utf8")))
      .map((path) => relative(SRC, path).split(sep).join("/"))
      .filter((path) => !path.startsWith("speed/"))
      .sort();

    const SPEED_BUILDS_SURFACE =
      /^(?:components\/speedBuilds\/|pages\/(?:SpeedBuilds|speedBuilds|useSpeedBuilds|referenceContent\.speed))/;
    expect(readers.filter((path) => !SPEED_BUILDS_SURFACE.test(path))).toEqual([]);
    // A floor, so a rename that empties the search cannot pass as isolation.
    expect(readers.length).toBeGreaterThanOrEqual(4);
  });
});
