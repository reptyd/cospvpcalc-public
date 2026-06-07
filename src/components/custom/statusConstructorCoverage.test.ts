import { describe, expect, it } from "vitest";
import {
  ALL_EFFECT_KINDS,
  ALL_STATUS_SPEC_FIELDS,
  BLOCK_STATUS_SPEC_FIELDS,
  EDITABLE_STATUS_SPEC_FIELDS,
  LEGACY_STATUS_SPEC_FIELDS,
} from "../../shared/customAbilityTypes";
import type { UserStatusSpec } from "../../shared/customAbilityTypes";
import { parseStatus, serializeStatus } from "../../shared/statusDsl";
import { PALETTE_EFFECT_KINDS } from "./AbilityVisualEditor";
import {
  STATUS_BLOCK_EDITOR_FIELDS,
  STATUS_EDITOR_FIELDS,
  makeBlankStatusSpec,
} from "./StatusEditor";

/**
 * Constructor-coverage lock for user statuses - the
 * status-editor twin of `abilityPaletteCoverage.test.ts`.
 *
 * The rule this enforces: constructor coverage = 100% of the schema:
 * every authorable `UserStatusSpec` field must be reachable through the
 * `StatusEditor` form, with no code-only / JSON-only corners.
 *
 * `ALL_STATUS_SPEC_FIELDS` / `EDITABLE_STATUS_SPEC_FIELDS` derive from a
 * compile-time-exhaustive `Record<keyof UserStatusSpec, …>`, so adding a
 * field to the spec without classifying it fails the build, and marking it
 * `"editor"` without wiring a control fails this test.
 */
describe("Status constructor coverage", () => {
  it("exposes a control for every editable schema field (no JSON-only corners)", () => {
    const missing = EDITABLE_STATUS_SPEC_FIELDS.filter(
      (field) => !STATUS_EDITOR_FIELDS.has(field),
    );
    expect(missing).toEqual([]);
  });

  it("exposes no controls for unknown or internal fields", () => {
    const editable = new Set<string>(EDITABLE_STATUS_SPEC_FIELDS);
    const known = new Set<string>(ALL_STATUS_SPEC_FIELDS);
    const extra = [...STATUS_EDITOR_FIELDS].filter(
      (field) => !known.has(field) || !editable.has(field),
    );
    expect(extra).toEqual([]);
  });
});

/**
 * Block-constructor coverage: every `"blocks"` schema field - the
 * lifecycle hooks, the Expr overrides, and the teardown policy - must be
 * reachable through the Visual editor (hook stacks / ƒx toggles / teardown
 * card), and the status hook palette must reach every effect kind. This is
 * the status twin of `abilityPaletteCoverage.test.ts`.
 */
describe("Status block-constructor coverage", () => {
  it("surfaces every block (hook / Expr / policy) schema field", () => {
    const missing = BLOCK_STATUS_SPEC_FIELDS.filter(
      (field) => !STATUS_BLOCK_EDITOR_FIELDS.has(field),
    );
    expect(missing).toEqual([]);
  });

  it("surfaces no block controls for non-block fields", () => {
    const block = new Set<string>(BLOCK_STATUS_SPEC_FIELDS);
    const extra = [...STATUS_BLOCK_EDITOR_FIELDS].filter(
      (field) => !block.has(field),
    );
    expect(extra).toEqual([]);
  });

  it("the hook palette can build every effect kind", () => {
    // StatusVisualEditor reuses the ability `Palette`, so its hooks reach the
    // same exhaustive effect set the ability palette does.
    const missing = ALL_EFFECT_KINDS.filter(
      (kind) => !PALETTE_EFFECT_KINDS.has(kind),
    );
    expect(missing).toEqual([]);
  });
});

/**
 * Code↔Visual parity lock (dual-mode). Both editor modes back the
 * SAME `UserStatusSpec`: the Visual cards mutate it directly, the Code
 * textarea round-trips it through `serializeStatus` / `parseStatus`. "Blocks
 * can always build exactly what code can" means that round-trip must be
 * lossless - so anything the Visual editor can express survives a trip
 * through the DSL unchanged.
 */
describe("Status Code↔Visual round-trip (parity lock)", () => {
  // A spec touching every editable field - the surface both modes represent.
  const fullSpec: UserStatusSpec = {
    id: "user.parity",
    display_name: "Parity",
    polarity: "positive",
    stack_rule: "unique",
    max_stacks: 7,
    decay_interval_sec: 2.5,
    tick_kind: "dot_pct_max_hp",
    tick_base: 0.2,
    tick_per_stack: 0.05,
    tick_interval_sec: 1.5,
    regen_mod_pct: -25,
    regen_mod_per_stack_pct: -5,
    incoming_damage_mult: 1.25,
    outgoing_damage_mult: 0.8,
    bite_cooldown_mult: 1.1,
    // Programmable extensions. Hook batch names normalize to the block
    // key through the DSL (the header carries the name), so the fixture uses
    // those names for an exact round-trip.
    tick_amount_expr: { kind: "var", path: "status.stacks" },
    incoming_damage_mult_expr: { kind: "var", path: "status.stacks" },
    outgoing_damage_mult_expr: { kind: "const", value: 0.5 },
    bite_cooldown_mult_expr: { kind: "const", value: 1.2 },
    // Canonical unary-neg form: a bare negative-const literal (`-50`) is not a
    // DSL fixed point (it re-parses as `neg(50)`) - that exprDsl quirk is
    // out of scope here, so the fixture uses the form the parser produces.
    regen_mod_expr: {
      kind: "una",
      op: "neg",
      operand: { kind: "var", path: "status.stacks" },
    },
    on_apply: {
      name: "on_apply",
      effects: [
        {
          kind: "form_swap",
          target: "caster",
          stat_changes: [{ field: "health", mode: "mul", value: 0.3 }],
          duration_sec: 0,
          hp_policy: { kind: "ratio" },
        },
      ],
    },
    on_tick: {
      interval_sec: 2,
      effects: {
        name: "on_tick",
        effects: [{ kind: "deal_direct_damage", target: "caster", amount: 10 }],
      },
    },
    on_expire: {
      name: "on_expire",
      effects: [{ kind: "deal_direct_damage", target: "opponent", amount: 50 }],
    },
    // Bearer-reactive triggers. Each batch name equals the hook key (the DSL
    // header carries it), so the round-trip is exact. Effects are arbitrary
    // valid nodes - this fixture locks field coverage + losslessness, not
    // semantics.
    on_round_start: {
      name: "on_round_start",
      effects: [{ kind: "deal_direct_damage", target: "caster", amount: 1 }],
    },
    on_take_damage: {
      name: "on_take_damage",
      effects: [{ kind: "deal_direct_damage", target: "opponent", amount: 5 }],
    },
    on_deal_damage: {
      name: "on_deal_damage",
      effects: [{ kind: "deal_direct_damage", target: "opponent", amount: 2 }],
    },
    on_kill: {
      name: "on_kill",
      effects: [{ kind: "deal_direct_damage", target: "caster", amount: 3 }],
    },
    on_first_strike: {
      name: "on_first_strike",
      effects: [{ kind: "deal_direct_damage", target: "opponent", amount: 4 }],
    },
    on_heal: {
      name: "on_heal",
      effects: [{ kind: "deal_direct_damage", target: "opponent", amount: 6 }],
    },
    on_status_apply: {
      name: "on_status_apply",
      effects: [{ kind: "deal_direct_damage", target: "caster", amount: 7 }],
    },
    on_status_expire: {
      name: "on_status_expire",
      effects: [{ kind: "deal_direct_damage", target: "caster", amount: 8 }],
    },
    on_before_take_damage: {
      name: "on_before_take_damage",
      effects: [
        {
          kind: "set_extra",
          target: "caster",
          key: "damage_override",
          value: { kind: "const", value: 0 },
        },
      ],
    },
    on_before_deal_damage: {
      name: "on_before_deal_damage",
      effects: [
        {
          kind: "set_extra",
          target: "caster",
          key: "damage_override",
          value: { kind: "const", value: 999 },
        },
      ],
    },
    on_decay: {
      name: "on_decay",
      effects: [{ kind: "deal_direct_damage", target: "opponent", amount: 9 }],
    },
    on_restack: {
      name: "on_restack",
      effects: [{ kind: "deal_direct_damage", target: "opponent", amount: 11 }],
    },
  };

  it("the parity fixture exercises every editable field", () => {
    const missing = EDITABLE_STATUS_SPEC_FIELDS.filter(
      (field) => (fullSpec as Record<string, unknown>)[field] === undefined,
    );
    expect(missing).toEqual([]);
  });

  it("the parity fixture exercises every block (DSL-authored) field", () => {
    const missing = BLOCK_STATUS_SPEC_FIELDS.filter(
      (field) => (fullSpec as Record<string, unknown>)[field] === undefined,
    );
    expect(missing).toEqual([]);
  });

  it("the parity fixture exercises every legacy (backward-compat) field", () => {
    // Legacy parametric knobs are retired from the editor but must still
    // round-trip through the DSL - the fixture exercises them so the
    // lossless lock below covers them.
    const missing = LEGACY_STATUS_SPEC_FIELDS.filter(
      (field) => (fullSpec as Record<string, unknown>)[field] === undefined,
    );
    expect(missing).toEqual([]);
  });

  it("serialize → parse is lossless for a fully-populated spec", () => {
    const r = parseStatus(serializeStatus(fullSpec));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.spec).toEqual(fullSpec);
  });

  it("serialize → parse is lossless for the blank starter spec", () => {
    const blank = makeBlankStatusSpec();
    const r = parseStatus(serializeStatus(blank));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.spec).toEqual(blank);
  });
});
