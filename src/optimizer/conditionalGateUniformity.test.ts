import { describe, expect, it } from "vitest";
import { effectsCatalog } from "../engine/data";
import { SPEC_CONSTANTS } from "../engine/specConstants.generated";

// Guard for the Option B single-sourcing of the conditional-passive gate
// thresholds. First Strike (75% gate), Berserk (20% gate + 0.5x bite cooldown)
// and Quick Recovery (40% gate) are spec-universal, so the bridge
// (rustBestBuildsRuntime.ts) sources their threshold VALUES from the spec spine
// rather than the per-creature catalog copy, keyed only on the data's presence.
// That is correct only while the catalog copies stay uniform. A wiki re-scrape
// could introduce a creature whose gate differs from the spec-universal value;
// the bridge would then silently apply the spine value instead of the real one.
// This gate reds if any catalog copy diverges, forcing the universality
// assumption to be re-examined (docs/internal/plans/closeout_hardening_vectors.md, C).

type AbilityDef = {
  type?: string;
  trigger?: { hpRatioGte?: number; hpRatioLt?: number; hpRatioLte?: number };
  mods?: { biteCooldownMultiplier?: number };
};
type AbilityEntry = { name?: string; def?: AbilityDef };
type Effects = {
  specialAbilitiesDetailed?: AbilityEntry[];
  specialAbilities?: AbilityEntry[];
  otherAbilities?: AbilityEntry[];
};

const CATALOG = effectsCatalog as Record<string, Effects>;
const EPS = 1e-9;

function entriesFor(name: string): AbilityEntry[] {
  const effects = CATALOG[name] ?? {};
  return [
    ...(effects.specialAbilitiesDetailed ?? []),
    ...(effects.specialAbilities ?? []),
    ...(effects.otherAbilities ?? []),
  ];
}

function scan(
  abilityName: string,
  read: (def: AbilityDef) => number | undefined,
  expected: number,
): { checked: number; bad: string[] } {
  let checked = 0;
  const bad: string[] = [];
  for (const creatureName of Object.keys(CATALOG)) {
    for (const entry of entriesFor(creatureName)) {
      if (entry.name !== abilityName || !entry.def) continue;
      const value = read(entry.def);
      if (value == null) continue;
      checked++;
      if (Math.abs(value - expected) > EPS) {
        bad.push(`${creatureName}: ${abilityName} = ${value} (expected ${expected})`);
      }
    }
  }
  return { checked, bad: bad.sort() };
}

describe("conditional-passive gate thresholds stay spec-universal (Option B guard)", () => {
  it("First Strike hp gate matches the spec spine across the catalog", () => {
    const expected = SPEC_CONSTANTS.first_strike_hp_gate_pct / 100;
    const { checked, bad } = scan("First Strike", (d) => d.trigger?.hpRatioGte, expected);
    expect(checked, "guard is vacuous - no First Strike creature carries a gate value").toBeGreaterThan(0);
    expect(bad, "A First Strike creature's data gate diverges from the spec-universal value; the bridge would apply the spine value instead. Re-examine Option B sourcing.").toEqual([]);
  });

  it("Berserk hp gate matches the spec spine across the catalog", () => {
    const expected = SPEC_CONSTANTS.berserk_hp_gate_pct / 100;
    const { checked, bad } = scan("Berserk", (d) => d.trigger?.hpRatioLt ?? d.trigger?.hpRatioLte, expected);
    expect(checked, "guard is vacuous - no Berserk creature carries a gate value").toBeGreaterThan(0);
    expect(bad, "A Berserk creature's data gate diverges from the spec-universal value. Re-examine Option B sourcing.").toEqual([]);
  });

  it("Berserk bite-cooldown multiplier matches the spec spine across the catalog", () => {
    const expected = SPEC_CONSTANTS.berserk_bite_cooldown_multiplier;
    const { checked, bad } = scan("Berserk", (d) => d.mods?.biteCooldownMultiplier, expected);
    expect(checked, "guard is vacuous - no Berserk creature carries a bite-cooldown multiplier").toBeGreaterThan(0);
    expect(bad, "A Berserk creature's bite-cooldown multiplier diverges from the spec-universal value. Re-examine Option B sourcing.").toEqual([]);
  });

  it("Quick Recovery hp gate matches the spec spine across the catalog", () => {
    const expected = SPEC_CONSTANTS.quick_recovery_hp_gate_pct / 100;
    const { checked, bad } = scan("Quick Recovery", (d) => d.trigger?.hpRatioLte ?? d.trigger?.hpRatioLt, expected);
    expect(checked, "guard is vacuous - no Quick Recovery creature carries a gate value").toBeGreaterThan(0);
    expect(bad, "A Quick Recovery creature's data gate diverges from the spec-universal value. Re-examine Option B sourcing.").toEqual([]);
  });
});
