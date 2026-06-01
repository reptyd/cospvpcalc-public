import { describe, expect, it } from "vitest";
import { ALL_EFFECT_KINDS } from "../../shared/customAbilityTypes";
import { PALETTE_EFFECT_KINDS } from "./AbilityVisualEditor";

/**
 * Constructor-coverage lock.
 *
 * The design contract is "Constructor coverage = 100% of the JSON DSL" —
 * every `EffectKind` must be reachable through the Visual palette, with
 * no code-only corners. This test asserts the Visual palette can spawn
 * every `EffectKind` discriminant.
 *
 * `ALL_EFFECT_KINDS` is itself compile-time-exhaustive: it derives from
 * a `Record<EffectKind["kind"], true>` that `tsc` forces to list every
 * kind. So adding a new `EffectKind` variant without also adding a
 * palette item fails this test (and omitting it from the registry fails
 * the build).
 */
describe("Visual palette coverage", () => {
  it("can spawn every EffectKind (no code-only corners)", () => {
    const missing = ALL_EFFECT_KINDS.filter(
      (kind) => !PALETTE_EFFECT_KINDS.has(kind),
    );
    expect(missing).toEqual([]);
  });

  it("exposes no palette items for unknown kinds", () => {
    const known = new Set<string>(ALL_EFFECT_KINDS);
    const extra = [...PALETTE_EFFECT_KINDS].filter((kind) => !known.has(kind));
    expect(extra).toEqual([]);
  });
});
