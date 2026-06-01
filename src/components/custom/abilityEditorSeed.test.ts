import { describe, expect, it } from "vitest";
import { makeBlankAbilitySpec } from "./AbilityEditor";
import { validateUserAbility } from "../../shared/customAbilityValidate";

/**
 * Confirms the constructor's "+ New ability" starting state is
 * structurally valid in every sub-tree (utility expr, is_available
 * expr, on_fire batch). The only fields that should fail
 * `validateUserAbility` on a blank spec are `id` (just the
 * `user.` prefix) and `display_name` (empty string) — once the
 * user fills those, the spec must pass without touching anything
 * else.
 *
 * Regression guard: if a future change to the seed introduces an
 * empty `var` path or zero-length effect list, this test catches
 * it before it lands in the UI.
 */
describe("makeBlankAbilitySpec", () => {
  it("only fails on id + display_name", () => {
    const result = validateUserAbility(makeBlankAbilitySpec());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // Errors should mention id and display_name; nothing about
      // expressions or effects.
      const joined = result.errors.join("\n");
      expect(joined).toMatch(/display_name/);
      expect(joined).not.toMatch(/utility|is_available|on_fire|effect|expr/);
    }
  });

  it("becomes valid when id + display_name are filled", () => {
    const spec = {
      ...makeBlankAbilitySpec(),
      id: "user.test_seed",
      display_name: "Test seed",
    };
    expect(validateUserAbility(spec)).toEqual({ ok: true });
  });
});
