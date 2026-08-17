import { describe, expect, it } from "vitest";
import { plushieByName } from "./data";
import { applyPlushies } from "./plushieBuildRuntime";
import type { CreatureRuntime } from "./types";

// Adding a plushie is pure data (data/plushies.runtime.json -> modifiersParsed).
// applyPlushieModifier dispatches on the stat name with a switch whose `default`
// branch SILENTLY ignores an unrecognised stat (it only adds an approximation
// note). So a plushie that introduces a brand-new or misspelled stat does
// nothing in combat with no error. This drives every catalog plushie through the
// real apply path and fails if any stat falls through to that default - turning a
// silent no-op into a red test. The switch stays the single source of truth (no
// hardcoded stat list here to drift out of sync).
describe("plushie stat coverage", () => {
  // Minimal stats carrying the fields applyPlushieModifier reads; values are
  // irrelevant to the default-branch detection this guard checks.
  const makeStats = (): CreatureRuntime["stats"] =>
    ({
      damage: 100,
      health: 1000,
      weight: 100,
      biteCooldown: 1,
      healthRegen: 10,
      stamRegen: 10,
      walkAndSwimSpeed: 10,
      sprintSpeed: 10,
      breathResistance: 0,
    }) as unknown as CreatureRuntime["stats"];

  it("handles every stat used by a catalog plushie (none silently ignored)", () => {
    const offenders: string[] = [];
    for (const name of Object.keys(plushieByName)) {
      const noAccum = () => ({ value: 0 });
      const unhandled = applyPlushies(
        makeStats(),
        [name],
        {},
        {},
        {},
        [],
        false,
        noAccum(),
        noAccum(),
        { hunger: 0, thirst: 0 },
        noAccum(),
        noAccum(),
        noAccum(),
      );
      // Two silent-fail modes, and the applier reports both: a stat with no
      // switch case, or a stack/block stat whose status-id mapping is missing.
      for (const stat of unhandled) offenders.push(`${name}: ${stat}`);
    }
    expect(
      offenders,
      `plushie stats hit a silent no-op in applyPlushieModifier - add the missing switch case or status mapping:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });
});
