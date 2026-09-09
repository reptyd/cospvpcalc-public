/**
 * Effect / ability templates the user can insert as starting
 * points. Each entry is a partial UserAbilitySpec - the user
 * picks one, the editor merges it into the current spec (id /
 * display_name kept; everything else replaced).
 *
 * Add new templates here as they're discovered to be common
 * enough to deserve a one-click insert.
 */

import type { Expr, UserAbilitySpec } from "./customAbilityTypes";

export type AbilityTemplate = {
  /** Internal id; used in localStorage of user's "favorite templates" if needed. */
  id: string;
  /** Display label in the picker. */
  name: string;
  /** Short description of what this template does. */
  description: string;
  /**
   * Partial UserAbilitySpec - id + display_name come from the
   * editor's current state; everything else replaces.
   */
  build: (next: { id: string; display_name: string }) => UserAbilitySpec;
};

export const ABILITY_TEMPLATES: AbilityTemplate[] = [
  {
    id: "life-leech-style",
    name: "Life Leech (vampirism)",
    description:
      "Passive: heal caster for 30% of every damage dealt to opponent. LifeLeech-style proportional healing - no active fire.",
    build: ({ id, display_name }) => ({
      id,
      display_name,
      utility: { kind: "const", value: 0 },
      is_available: { kind: "const", value: 0 },
      on_fire: undefined,
      triggers: {
        on_deal_damage: {
          name: "Vampiric heal",
          effects: [
            {
              kind: "heal_expr_amount",
              target: "caster",
              amount: {
                kind: "bin",
                op: "mul",
                left: { kind: "var", path: "event.damage_dealt" },
                right: { kind: "const", value: 0.3 },
              } satisfies Expr,
            },
          ],
        },
      },
    }),
  },
  {
    id: "reflect-50",
    name: "Reflect 50%",
    description:
      "Passive: when hit, deal 50% of damage taken back to the attacker.",
    build: ({ id, display_name }) => ({
      id,
      display_name,
      utility: { kind: "const", value: 0 },
      is_available: { kind: "const", value: 0 },
      on_fire: undefined,
      triggers: {
        on_take_damage: {
          name: "Reflect",
          effects: [
            {
              kind: "deal_expr_damage",
              target: "opponent",
              amount: {
                kind: "bin",
                op: "mul",
                left: { kind: "var", path: "event.damage_taken" },
                right: { kind: "const", value: 0.5 },
              } satisfies Expr,
            },
          ],
        },
      },
    }),
  },
  {
    id: "execute-low-hp",
    name: "Execute Below 30%",
    description:
      "Active: when opponent.hp_ratio < 0.3, set opponent HP to 1. ReallyFast.",
    build: ({ id, display_name }) => ({
      id,
      display_name,
      utility: {
        kind: "if",
        cond: {
          kind: "bin",
          op: "lt",
          left: { kind: "var", path: "opponent.hp_ratio" },
          right: { kind: "const", value: 0.3 },
        },
        then: { kind: "const", value: 1_000_000 },
        otherwise: { kind: "const", value: 0 },
      },
      is_available: {
        kind: "bin",
        op: "lt",
        left: { kind: "var", path: "opponent.hp_ratio" },
        right: { kind: "const", value: 0.3 },
      },
      timing_mode_override: "really_fast",
      on_fire: {
        name: "Execute",
        effects: [{ kind: "set_hp", target: "opponent", value: 1 }],
      },
    }),
  },
  {
    id: "stacking-combo",
    name: "Stacking Combo (Rage Meter)",
    description:
      "Build a custom rage meter on every bite taken; cast unleashes meter × 100 damage and resets.",
    build: ({ id, display_name }) => ({
      id,
      display_name,
      utility: {
        kind: "if",
        cond: {
          kind: "bin",
          op: "gte",
          left: { kind: "var", path: "self.extras.rage" },
          right: { kind: "const", value: 5 },
        },
        then: { kind: "const", value: 1_000_000 },
        otherwise: { kind: "const", value: 0 },
      },
      is_available: {
        kind: "bin",
        op: "gte",
        left: { kind: "var", path: "self.extras.rage" },
        right: { kind: "const", value: 5 },
      },
      timing_mode_override: "really_fast",
      on_fire: {
        name: "Unleash",
        effects: [
          {
            kind: "deal_expr_damage",
            target: "opponent",
            amount: {
              kind: "bin",
              op: "mul",
              left: { kind: "var", path: "self.extras.rage" },
              right: { kind: "const", value: 100 },
            } satisfies Expr,
          },
          {
            kind: "set_extra",
            target: "caster",
            key: "rage",
            value: { kind: "const", value: 0 } satisfies Expr,
          },
        ],
      },
      triggers: {
        on_take_damage: {
          name: "+Rage",
          effects: [
            {
              kind: "increment_extra",
              target: "caster",
              key: "rage",
              amount: { kind: "const", value: 1 } satisfies Expr,
            },
          ],
        },
      },
    }),
  },
  {
    id: "telegraph-detonate",
    name: "Telegraph + Detonate",
    description:
      "Active: telegraph a hit (apply Mark status); 3s later schedule fires for 800 damage scaled by stacks.",
    build: ({ id, display_name }) => ({
      id,
      display_name,
      utility: { kind: "var", path: "self.bite_dps" },
      is_available: { kind: "const", value: 1 },
      on_fire: {
        name: "Telegraph",
        effects: [
          {
            kind: "apply_status_to_target",
            target: "opponent",
            status: { status_id: "Mark_Status", stacks: 3, source_ability: id },
          },
          {
            kind: "schedule_effect",
            delay_sec: 3,
            effects: [
              {
                kind: "consume_status_for_damage",
                target: "opponent",
                status_id: "Mark_Status",
                damage_per_stack: { kind: "const", value: 250 } satisfies Expr,
              },
            ],
          },
        ],
      },
    }),
  },
  {
    id: "rewind-on-low-hp",
    name: "Rewind to Full",
    description:
      "Record state at fight start; when below 30% HP fire to restore captured state. 60s cooldown.",
    build: ({ id, display_name }) => ({
      id,
      display_name,
      utility: {
        kind: "if",
        cond: {
          kind: "bin",
          op: "lt",
          left: { kind: "var", path: "self.hp_ratio" },
          right: { kind: "const", value: 0.3 },
        },
        then: { kind: "const", value: 1_000_000 },
        otherwise: { kind: "const", value: 0 },
      },
      is_available: {
        kind: "bin",
        op: "lt",
        left: { kind: "var", path: "self.hp_ratio" },
        right: { kind: "const", value: 0.3 },
      },
      timing_mode_override: "really_fast",
      on_fire: {
        name: "Rewind",
        effects: [
          { kind: "restore_snapshot", target: "caster", key: "open" },
          {
            kind: "set_cooldown_until",
            target: "caster",
            cooldown_id: id,
            duration_sec: 60,
          },
        ],
      },
      triggers: {
        on_round_start: {
          name: "Record",
          effects: [{ kind: "record_snapshot", target: "caster", key: "open" }],
        },
      },
    }),
  },
  {
    id: "berserker-rage",
    name: "Berserker Rage",
    description:
      "Damage scales with missing HP - passive multiplier increases as you take hits. Sets damage modifier proportional to (1 + 0.5 × hp_loss_ratio).",
    build: ({ id, display_name }) => ({
      id,
      display_name,
      utility: { kind: "const", value: 0 },
      is_available: { kind: "const", value: 0 },
      on_fire: undefined,
      triggers: {
        on_take_damage: {
          name: "Refresh rage modifier",
          effects: [
            {
              kind: "modify_stat_expr",
              target: "caster",
              field: "damage",
              mode: "mul",
              value: {
                kind: "bin",
                op: "add",
                left: { kind: "const", value: 1.0 },
                right: {
                  kind: "bin",
                  op: "mul",
                  left: {
                    kind: "bin",
                    op: "sub",
                    left: { kind: "const", value: 1.0 },
                    right: { kind: "var", path: "self.hp_ratio" },
                  },
                  right: { kind: "const", value: 0.5 },
                },
              } satisfies Expr,
              duration_sec: { kind: "const", value: 999 } satisfies Expr,
            },
          ],
        },
      },
    }),
  },
  {
    id: "thorn-shield",
    name: "Thorn Shield (counter)",
    description:
      "Active 30s buff: when active and you take damage, deal back 100 to attacker. Cast on cooldown.",
    build: ({ id, display_name }) => ({
      id,
      display_name,
      utility: { kind: "var", path: "self.bite_dps" },
      is_available: {
        kind: "bin",
        op: "lte",
        left: { kind: "var", path: `self.cooldown_until.${id}` },
        right: { kind: "var", path: "time" },
      },
      on_fire: {
        name: "Thorn Shield",
        effects: [
          {
            kind: "set_active_until",
            target: "caster",
            active_id: id,
            duration_sec: 30,
          },
          {
            kind: "set_cooldown_until",
            target: "caster",
            cooldown_id: id,
            duration_sec: 60,
          },
        ],
      },
      triggers: {
        on_take_damage: {
          name: "Counter",
          effects: [
            {
              kind: "conditional",
              cond: {
                kind: "bin",
                op: "gt",
                left: { kind: "var", path: `self.active_until.${id}` },
                right: { kind: "var", path: "time" },
              },
              then: [
                { kind: "deal_direct_damage", target: "opponent", amount: 100 },
              ],
              otherwise: [],
            },
          ],
        },
      },
    }),
  },
  {
    id: "kill-streak",
    name: "Kill Streak",
    description:
      "On kill, gain a permanent +20% damage modifier (stacks once). For 1v1, fires at most once but the modifier persists.",
    build: ({ id, display_name }) => ({
      id,
      display_name,
      utility: { kind: "const", value: 0 },
      is_available: { kind: "const", value: 0 },
      on_fire: undefined,
      triggers: {
        on_kill: {
          name: "Power up",
          effects: [
            {
              kind: "modify_stat",
              target: "caster",
              field: "damage",
              mode: "mul",
              value: 1.2,
              duration_sec: 0, // permanent
            },
          ],
        },
      },
    }),
  },
  {
    id: "burn-stacker",
    name: "Burn Stacker",
    description:
      "Active: applies 3 stacks of Burn_Status. 8-second cooldown. Plain DoT pressure.",
    build: ({ id, display_name }) => ({
      id,
      display_name,
      utility: { kind: "var", path: "self.bite_dps" },
      is_available: {
        kind: "bin",
        op: "lte",
        left: { kind: "var", path: `self.cooldown_until.${id}` },
        right: { kind: "var", path: "time" },
      },
      on_fire: {
        name: "Burn Stacker",
        effects: [
          {
            kind: "apply_status_to_target",
            target: "opponent",
            status: { status_id: "Burn_Status", stacks: 3, source_ability: id },
          },
          {
            kind: "set_cooldown_until",
            target: "caster",
            cooldown_id: id,
            duration_sec: 8,
          },
        ],
      },
    }),
  },
  {
    id: "cleansing-strike",
    name: "Cleansing Strike",
    description:
      "Active: deal 200 damage AND cleanse all your removable statuses. 12s cooldown.",
    build: ({ id, display_name }) => ({
      id,
      display_name,
      utility: {
        kind: "if",
        cond: {
          kind: "bin",
          op: "gt",
          left: { kind: "var", path: "self.statuses_count" },
          right: { kind: "const", value: 0 },
        },
        then: { kind: "const", value: 1000 },
        otherwise: { kind: "var", path: "self.bite_dps" },
      },
      is_available: {
        kind: "bin",
        op: "lte",
        left: { kind: "var", path: `self.cooldown_until.${id}` },
        right: { kind: "var", path: "time" },
      },
      on_fire: {
        name: "Cleansing Strike",
        effects: [
          { kind: "deal_direct_damage", target: "opponent", amount: 200 },
          { kind: "cleanse_fortify_removable_statuses", target: "caster" },
          {
            kind: "set_cooldown_until",
            target: "caster",
            cooldown_id: id,
            duration_sec: 12,
          },
        ],
      },
    }),
  },
  {
    id: "tick-aura",
    name: "Tick Aura",
    description:
      "Passive: every 1s deal 25 damage to opponent. Constant low-grade pressure.",
    build: ({ id, display_name }) => ({
      id,
      display_name,
      utility: { kind: "const", value: 0 },
      is_available: { kind: "const", value: 0 },
      on_fire: undefined,
      triggers: {
        on_tick: {
          interval_sec: 1.0,
          effects: {
            name: "Tick",
            effects: [
              { kind: "deal_direct_damage", target: "opponent", amount: 25 },
            ],
          },
        },
      },
    }),
  },
  {
    id: "low-hp-emergency-heal",
    name: "Low-HP Emergency Heal",
    description:
      "Auto-fires below 25% HP: heals 40% of max HP. 90s cooldown.",
    build: ({ id, display_name }) => ({
      id,
      display_name,
      utility: {
        kind: "if",
        cond: {
          kind: "bin",
          op: "lt",
          left: { kind: "var", path: "self.hp_ratio" },
          right: { kind: "const", value: 0.25 },
        },
        then: { kind: "const", value: 1_000_000 },
        otherwise: { kind: "const", value: 0 },
      },
      is_available: {
        kind: "bin",
        op: "and",
        left: {
          kind: "bin",
          op: "lt",
          left: { kind: "var", path: "self.hp_ratio" },
          right: { kind: "const", value: 0.25 },
        },
        right: {
          kind: "bin",
          op: "lte",
          left: { kind: "var", path: `self.cooldown_until.${id}` },
          right: { kind: "var", path: "time" },
        },
      },
      timing_mode_override: "really_fast",
      on_fire: {
        name: "Emergency Heal",
        effects: [
          {
            kind: "heal_expr_amount",
            target: "caster",
            amount: {
              kind: "bin",
              op: "mul",
              left: { kind: "var", path: "self.max_hp" },
              right: { kind: "const", value: 0.4 },
            } satisfies Expr,
          },
          {
            kind: "set_cooldown_until",
            target: "caster",
            cooldown_id: id,
            duration_sec: 90,
          },
        ],
      },
    }),
  },
  {
    id: "berserk-on-low-hp",
    name: "Berserk Trigger",
    description:
      "When below 50% HP, set damage *2 for 15s. 60s cooldown. Single-shot defensive override.",
    build: ({ id, display_name }) => ({
      id,
      display_name,
      utility: {
        kind: "if",
        cond: {
          kind: "bin",
          op: "lt",
          left: { kind: "var", path: "self.hp_ratio" },
          right: { kind: "const", value: 0.5 },
        },
        then: { kind: "const", value: 1000 },
        otherwise: { kind: "const", value: 0 },
      },
      is_available: {
        kind: "bin",
        op: "and",
        left: {
          kind: "bin",
          op: "lt",
          left: { kind: "var", path: "self.hp_ratio" },
          right: { kind: "const", value: 0.5 },
        },
        right: {
          kind: "bin",
          op: "lte",
          left: { kind: "var", path: `self.cooldown_until.${id}` },
          right: { kind: "var", path: "time" },
        },
      },
      on_fire: {
        name: "Berserk",
        effects: [
          {
            kind: "modify_stat",
            target: "caster",
            field: "damage",
            mode: "mul",
            value: 2.0,
            duration_sec: 15,
          },
          {
            kind: "set_cooldown_until",
            target: "caster",
            cooldown_id: id,
            duration_sec: 60,
          },
        ],
      },
    }),
  },
  {
    id: "anti-status-burst",
    name: "Anti-Status Burst",
    description:
      "When you gain ≥3 statuses simultaneously (e.g. ailment volley), dispel all and heal 30% max HP.",
    build: ({ id, display_name }) => ({
      id,
      display_name,
      utility: { kind: "const", value: 0 },
      is_available: { kind: "const", value: 0 },
      on_fire: undefined,
      triggers: {
        on_status_apply: {
          name: "Anti-status",
          effects: [
            {
              kind: "conditional",
              cond: {
                kind: "bin",
                op: "gte",
                left: { kind: "var", path: "event.applied_status_count" },
                right: { kind: "const", value: 3 },
              },
              then: [
                { kind: "dispel_all_statuses", target: "caster" },
                {
                  kind: "heal_expr_amount",
                  target: "caster",
                  amount: {
                    kind: "bin",
                    op: "mul",
                    left: { kind: "var", path: "self.max_hp" },
                    right: { kind: "const", value: 0.3 },
                  } satisfies Expr,
                },
              ],
              otherwise: [],
            },
          ],
        },
      },
    }),
  },
  {
    id: "scaled-strike",
    name: "Scaled Strike (Lv 1/2/3)",
    description:
      "Demonstrates the per-ability scaling table: deals damage equal to scaling.damage at the chosen level (50 / 150 / 350) on a 5s cooldown.",
    build: ({ id, display_name }) => ({
      id,
      display_name,
      levels: 3,
      default_level: 2,
      scaling: {
        damage: [50, 150, 350],
      },
      utility: { kind: "const", value: 1 },
      is_available: {
        kind: "bin",
        op: "lte",
        left: { kind: "var", path: `self.cooldown_until.${id}` },
        right: { kind: "var", path: "time" },
      },
      on_fire: {
        name: "Scaled Strike",
        effects: [
          {
            kind: "deal_expr_damage",
            target: "opponent",
            amount: { kind: "var", path: "scaling.damage" },
          },
          {
            kind: "set_cooldown_until",
            target: "caster",
            cooldown_id: id,
            duration_sec: 5.0,
          },
        ],
      },
    }),
  },
  {
    id: "absorb-shield",
    name: "Absorb Shield",
    description:
      "Defensive passive: absorbs up to 50 incoming damage per bite. Uses on_before_take_damage to write damage_override = max(0, event.damage_taken - 50).",
    build: ({ id, display_name }) => ({
      id,
      display_name,
      utility: { kind: "const", value: 0 },
      is_available: { kind: "const", value: 0 },
      on_fire: undefined,
      triggers: {
        on_before_take_damage: {
          name: "Absorb",
          effects: [
            {
              kind: "set_extra",
              target: "caster",
              key: "damage_override",
              value: {
                kind: "bin",
                op: "sub",
                left: { kind: "var", path: "event.damage_taken" },
                right: { kind: "const", value: 50 },
              } satisfies Expr,
            },
          ],
        },
      },
    }),
  },
  {
    id: "burst-counter-5s",
    name: "5s Burst Counter",
    description:
      "When self has taken ≥ 300 damage in the last 5 seconds, fire a 600-damage counterattack on a 10s cooldown. Demonstrates the sliding-window helper damage_taken_last.5.",
    build: ({ id, display_name }) => ({
      id,
      display_name,
      utility: { kind: "const", value: 1_000 },
      is_available: {
        kind: "bin",
        op: "and",
        left: {
          kind: "bin",
          op: "gte",
          left: { kind: "var", path: "self.damage_taken_last.5" },
          right: { kind: "const", value: 300 },
        },
        right: {
          kind: "bin",
          op: "lte",
          left: { kind: "var", path: `self.cooldown_until.${id}` },
          right: { kind: "var", path: "time" },
        },
      } satisfies Expr,
      on_fire: {
        name: "Counter",
        effects: [
          { kind: "deal_direct_damage", target: "opponent", amount: 600 },
          {
            kind: "set_cooldown_until",
            target: "caster",
            cooldown_id: id,
            duration_sec: 10.0,
          },
        ],
      },
    }),
  },
  {
    id: "recent-hits-array",
    name: "Recent-Hits Array",
    description:
      "Tracks every incoming hit in a numbered-key extras array (push_extra). When extras.recent.sum exceeds 500, fire a 1000-damage finisher and clear the array.",
    build: ({ id, display_name }) => ({
      id,
      display_name,
      utility: { kind: "const", value: 0 },
      is_available: { kind: "const", value: 0 },
      on_fire: undefined,
      triggers: {
        on_take_damage: {
          name: "Track hits",
          effects: [
            {
              kind: "push_extra",
              target: "caster",
              key: "recent",
              value: { kind: "var", path: "event.damage_taken" },
            },
            {
              kind: "conditional",
              cond: {
                kind: "bin",
                op: "gte",
                left: { kind: "var", path: "self.extras.recent.sum" },
                right: { kind: "const", value: 500 },
              } satisfies Expr,
              then: [
                { kind: "deal_direct_damage", target: "opponent", amount: 1_000 },
                { kind: "clear_extra_array", target: "caster", key: "recent" },
              ],
              otherwise: [],
            },
          ],
        },
      },
    }),
  },
  {
    id: "form-swap-glass-cannon",
    name: "Form Swap (glass cannon)",
    description:
      "Active on cooldown: swap into a 12s glass-cannon form (×2 damage, ×0.5 weight), preserving HP fraction, then auto-revert. Showcases form_swap.",
    build: ({ id, display_name }) => ({
      id,
      display_name,
      utility: { kind: "var", path: "self.bite_dps" },
      is_available: {
        kind: "bin",
        op: "lte",
        left: { kind: "var", path: `self.cooldown_until.${id}` },
        right: { kind: "var", path: "time" },
      },
      on_fire: {
        name: "Glass-cannon form",
        effects: [
          {
            kind: "form_swap",
            target: "caster",
            stat_changes: [
              { field: "damage", mode: "mul", value: 2 },
              { field: "weight", mode: "mul", value: 0.5 },
            ],
            duration_sec: 12,
            hp_policy: { kind: "ratio" },
          },
          {
            kind: "set_cooldown_until",
            target: "caster",
            cooldown_id: id,
            duration_sec: 30,
          },
        ],
      },
    }),
  },
  {
    id: "flier-hunter",
    name: "Flier Hunter (type-gated)",
    description:
      "Active vs Fliers only: 400 bonus damage when the opponent's creature type is Flier, on an 8s cooldown. Showcases the is_type creature-attribute read.",
    build: ({ id, display_name }) => ({
      id,
      display_name,
      utility: {
        kind: "if",
        cond: { kind: "var", path: "opponent.is_type.Flier" },
        then: { kind: "const", value: 1_000 },
        otherwise: { kind: "const", value: 0 },
      },
      is_available: {
        kind: "bin",
        op: "and",
        left: { kind: "var", path: "opponent.is_type.Flier" },
        right: {
          kind: "bin",
          op: "lte",
          left: { kind: "var", path: `self.cooldown_until.${id}` },
          right: { kind: "var", path: "time" },
        },
      } satisfies Expr,
      on_fire: {
        name: "Anti-air strike",
        effects: [
          { kind: "deal_direct_damage", target: "opponent", amount: 400 },
          {
            kind: "set_cooldown_until",
            target: "caster",
            cooldown_id: id,
            duration_sec: 8,
          },
        ],
      },
    }),
  },
  {
    id: "custom-status-on-hit",
    name: "Custom Status On Hit",
    description:
      "Passive: apply 3 stacks of your own user.MyDoT custom status to the opponent on every bite dealt. Define it first under Custom > Statuses (id user.MyDoT), then edit the id here. Showcases user-defined statuses.",
    build: ({ id, display_name }) => ({
      id,
      display_name,
      utility: { kind: "const", value: 0 },
      is_available: { kind: "const", value: 0 },
      on_fire: undefined,
      triggers: {
        on_deal_damage: {
          name: "Apply custom status",
          effects: [
            {
              kind: "conditional",
              cond: { kind: "var", path: "event.is_bite" },
              then: [
                {
                  kind: "apply_status_to_target",
                  target: "opponent",
                  status: { status_id: "user.MyDoT", stacks: 3 },
                },
              ],
              otherwise: [],
            },
          ],
        },
      },
    }),
  },
];
