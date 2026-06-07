import { describe, expect, it } from "vitest";
import { parseStatus, serializeStatus } from "./statusDsl";
import type { UserStatusSpec } from "./customAbilityTypes";

function parse(text: string): UserStatusSpec {
  const r = parseStatus(text);
  if (!r.ok) throw new Error(`line ${r.line}: ${r.error}`);
  return r.spec;
}

describe("parseStatus", () => {
  it("parses a minimal header", () => {
    const spec = parse(`status user.bleed "Bleed"`);
    expect(spec.id).toBe("user.bleed");
    expect(spec.display_name).toBe("Bleed");
  });

  it("parses single-quoted and bare display names", () => {
    expect(parse(`status user.a 'Apple Pie'`).display_name).toBe("Apple Pie");
    expect(parse(`status user.b Plain`).display_name).toBe("Plain");
  });

  it("parses every scalar field", () => {
    const spec = parse(`
status user.bleed "Bleed"
  polarity negative
  stack_rule stacking
  max_stacks 10
  decay 3
  tick_kind dot_flat
  tick_base 5
  tick_per_stack 2
  tick_interval 1
  regen_mod -50
  regen_mod_per_stack -10
  incoming_mult 1.2
  outgoing_mult 0.9
  bite_cooldown_mult 1.1
`);
    expect(spec).toEqual({
      id: "user.bleed",
      display_name: "Bleed",
      polarity: "negative",
      stack_rule: "stacking",
      max_stacks: 10,
      decay_interval_sec: 3,
      tick_kind: "dot_flat",
      tick_base: 5,
      tick_per_stack: 2,
      tick_interval_sec: 1,
      regen_mod_pct: -50,
      regen_mod_per_stack_pct: -10,
      incoming_damage_mult: 1.2,
      outgoing_damage_mult: 0.9,
      bite_cooldown_mult: 1.1,
    });
  });

  it("parses max_stacks none → null (explicit unbounded)", () => {
    expect(parse(`status user.x "X"\n  max_stacks none`).max_stacks).toBeNull();
    expect(parse(`status user.x "X"\n  max_stacks unbounded`).max_stacks).toBeNull();
  });

  it("ignores blank lines and comments", () => {
    const spec = parse(`
# a leading comment
status user.x "X"

  // mid comment
  polarity positive
`);
    expect(spec.polarity).toBe("positive");
  });

  it("errors on a header not at column 0", () => {
    const r = parseStatus(`  status user.x "X"`);
    expect(r.ok).toBe(false);
  });

  it("errors on a bad header shape with a line number", () => {
    const r = parseStatus(`status`);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.line).toBe(1);
  });

  it("errors on an unknown key with a line number", () => {
    const r = parseStatus(`status user.x "X"\n  wat 3`);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toContain("unknown status key");
      expect(r.line).toBe(2);
    }
  });

  it("errors on a bad enum value", () => {
    expect(parseStatus(`status user.x "X"\n  polarity sideways`).ok).toBe(false);
    expect(parseStatus(`status user.x "X"\n  stack_rule pile`).ok).toBe(false);
    expect(parseStatus(`status user.x "X"\n  tick_kind boom`).ok).toBe(false);
  });

  it("errors on a non-finite / out-of-range number", () => {
    expect(parseStatus(`status user.x "X"\n  decay NaN`).ok).toBe(false);
    expect(parseStatus(`status user.x "X"\n  decay -1`).ok).toBe(false);
    expect(parseStatus(`status user.x "X"\n  incoming_mult -2`).ok).toBe(false);
  });

  it("errors on a duplicate key", () => {
    const r = parseStatus(`status user.x "X"\n  decay 1\n  decay 2`);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("duplicate");
  });
});

describe("serializeStatus → parse round-trip", () => {
  const fixtures: UserStatusSpec[] = [
    { id: "user.min", display_name: "Minimal" },
    {
      id: "user.bleed",
      display_name: "Bleed",
      polarity: "negative",
      stack_rule: "stacking",
      max_stacks: 10,
      decay_interval_sec: 3,
      tick_kind: "dot_flat",
      tick_base: 5,
      tick_per_stack: 2,
      tick_interval_sec: 1,
      regen_mod_pct: -50,
      regen_mod_per_stack_pct: -10,
      incoming_damage_mult: 1.2,
      outgoing_damage_mult: 0.9,
      bite_cooldown_mult: 1.1,
    },
    {
      id: "user.regen",
      display_name: "Regen Aura",
      polarity: "positive",
      stack_rule: "unique",
      max_stacks: null,
      tick_kind: "heal_pct_max_hp",
      tick_base: 1.5,
      tick_interval_sec: 0.5,
    },
    // Bearer-reactive trigger blocks (status↔ability parity). Each batch name
    // equals the hook key, matching what the DSL header re-applies on parse.
    {
      id: "user.reactor",
      display_name: "Reactor",
      polarity: "negative",
      on_take_damage: {
        name: "on_take_damage",
        effects: [{ kind: "deal_direct_damage", target: "opponent", amount: 40 }],
      },
      on_kill: {
        name: "on_kill",
        effects: [{ kind: "deal_direct_damage", target: "caster", amount: 3 }],
      },
      on_first_strike: {
        name: "on_first_strike",
        effects: [{ kind: "deal_direct_damage", target: "opponent", amount: 5 }],
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
    },
  ];

  for (const spec of fixtures) {
    it(`round-trips ${spec.id}`, () => {
      const text = serializeStatus(spec);
      const back = parseStatus(text);
      expect(back.ok).toBe(true);
      if (back.ok) expect(back.spec).toEqual(spec);
    });
  }

  it("emits no body lines for a header-only spec", () => {
    const text = serializeStatus({ id: "user.x", display_name: "X" });
    expect(text).toBe(`status user.x "X"`);
  });
});
