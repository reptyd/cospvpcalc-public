import { useEffect, type ReactNode } from "react";
import {
  KNOWN_STATUS_IDS,
  STATS_FIELDS,
  BUILT_IN_ABILITY_IDS,
  EXPR_SIDE_FIELDS,
  EXPR_SIDE_TIMER_FAMILIES,
  EXPR_EVENT_FIELDS,
} from "../../shared/customAbilityVocab";

/**
 * Full pseudocode reference for the ability/timing/status DSL. Opens as a
 * modal overlay so the user can scroll through it without losing
 * the editor state behind. Sections: structure, exprs, effect
 * statements, block forms, full examples, common patterns.
 *
 * `onInsertStatus`, when supplied (the Status editor passes it), turns the
 * Status DSL examples into one-click "Insert" buttons that drop the snippet
 * into the editor. Omitting it (the Ability editor) just renders the
 * examples as read-only code.
 */
export function PseudocodeDocs({
  onClose,
  onInsertStatus,
}: {
  onClose: () => void;
  onInsertStatus?: (snippet: string) => void;
}): ReactNode {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);
  return (
    <div className="ce-docs-backdrop" onClick={onClose}>
      <div
        className="ce-docs-panel"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <header className="ce-docs-header">
          <h2>Ability / Timing / Status pseudocode reference</h2>
          <button className="ce-btn ce-btn-ghost" onClick={onClose}>
            Close (Esc)
          </button>
        </header>
        <div className="ce-docs-body">
          <DocsContent onInsertStatus={onInsertStatus} />
        </div>
      </div>
    </div>
  );
}

function DocsContent({
  onInsertStatus,
}: {
  onInsertStatus?: (snippet: string) => void;
}): ReactNode {
  return (
    <>
      <Section title="Quick start — your first ability + timing">
        <p className="hint">
          Five steps from zero to a custom ability that actually
          fires in Compare. Each step links to the relevant editor
          tab.
        </p>
        <Subhead>1. Author the ability</Subhead>
        <p>
          <code>Custom &gt; Abilities &gt; + New ability</code>. Pick{" "}
          <em>Visual</em> mode (default), give it an id starting with{" "}
          <code>user.</code>, a display name, and pick a built-in
          timing for now (e.g. <code>ideal</code>). Drag a few palette
          blocks into the workspace — at minimum a damage / heal /
          status effect under <code>on_fire</code>. Click <strong>+ Add to library</strong>.
        </p>
        <Subhead>2. (Optional) Author a custom timing</Subhead>
        <p>
          <code>Custom &gt; Timings &gt; + New timing</code>. Pick a
          strategy (
          <code>always when ready</code> /<code> conditional </code>/
          <code>future-look</code> / etc.), set the parameters, click
          <strong> + Add to library</strong>. Then go back to your
          ability and switch its <code>Timing</code> dropdown to your
          new entry under <em>Your custom timings</em>.
        </p>
        <Subhead>3. Attach to a creature</Subhead>
        <p>
          <code>Custom &gt; Creatures</code>. Either edit an existing
          custom creature or create a new one. In the{" "}
          <em>Supported abilities</em> picker, click the <strong>Custom</strong>{" "}
          filter chip — your authored abilities appear there alongside
          built-ins. Click <strong>Add</strong> on yours.{" "}
          <code>Save Creature</code>.
        </p>
        <Subhead>4. Run a Compare match</Subhead>
        <p>
          Go to <code>Compare</code>, pick your custom creature on one
          side and any opponent on the other, click <strong>Calculate</strong>.
          Open the combat log and you should see your ability firing.
          If it doesn't — see <em>Troubleshooting</em> below.
        </p>
        <Subhead>5. (Optional) Override timing per-fight</Subhead>
        <p>
          In <em>Compare &gt; Battle Settings &gt; Custom-ability per-fight
          timing</em>, you'll see a row for each user ability attached
          to the creature. Pick a different timing for THIS matchup
          without editing the spec — useful for A/B comparing two
          policies on the same ability.
        </p>
      </Section>

      <Section title="At a glance">
        <p>
          The pseudocode is a small, indent-significant DSL.
          One file = one <code>ability</code> or <code>timing</code>.
          The text is the source of truth — saving validates and
          registers the parsed spec into the engine.
        </p>
        <p>
          The engine executes specs deterministically; the same
          inputs always produce the same outcome (Compare-friendly).
          Random gates use a deterministic-pseudo-random seed.
        </p>
      </Section>

      <Section title="Ability structure">
        <Code>{`ability <id> "<display name>"
  // Optional metadata
  version <number>
  timing really_fast | fast | semi_ideal | ideal | extreme | user.<id>

  // A11: ability levels + scaling tables (skip if single-level)
  levels <N>                         // total level count, default 1
  default_level <N>                  // 1..=levels, default 1
  scaling <key>: v1, v2, ..., vN     // table of length=levels; read as
                                     // scaling.<key> in expressions

  // Decision halves (single-line expressions)
  utility:        <Expr>     // higher = more attractive to the policy
  available:      <Expr>     // 0 = unavailable
  reallyfast_gate:<Expr>     // optional ReallyFast override

  // Active firing
  on_fire:
    <effect>
    <effect>

  // Reactive triggers (any combination — all optional)
  on_round_start:           ...     // fires once at t=0
  on_take_damage:           ...     // event.damage_taken / .raw_damage /
                                    // .prevented_damage / .is_bite/breath/dot
  on_deal_damage:           ...     // same shape, dealer side
  on_before_take_damage:    ...     // A13 pre-damage hook (VICTIM).
                                    // Write set_extra self damage_override = N
                                    // to replace the incoming amount.
  on_before_deal_damage:    ...     // A13 (DEALER, fires before victim hook)
  on_status_apply:          ...     // event.applied_status_count;
                                    // per-id flags event.applied.<status_id>
  on_status_expire:         ...     // event.expired_status_count;
                                    // event.expired.<status_id>
  on_kill:                  ...     // event.damage_dealt (killing blow)
  on_first_strike:          ...     // event.first_strike_active (1 newly on)
  on_heal:                  ...     // event.heal_amount
  on_active_end:            ...     // event.ended.<ability_id>; event.ended_count
  on_tick <secs>:           ...     // event.tick_index (0-based)`}</Code>
        <p className="hint">
          Indentation matters: child blocks must be strictly more
          indented than their parent. 2 spaces is canonical but the
          parser accepts any consistent depth.
        </p>
        <p className="hint">
          <strong>Validation rule.</strong> A spec must do something —
          either populate <code>on_fire</code> or at least one trigger
          hook. A spec with only decision exprs and no firing path is
          rejected at save time.
        </p>
      </Section>

      <Section title="Two editor modes — Visual vs Code">
        <p>
          The ability editor has two views you can toggle between with the
          mode pill at the top:
        </p>
        <ul>
          <li>
            <strong>Visual</strong> (default) — drag-drop palette of "hats"
            (trigger types) and effect blocks. Each block has typed
            inputs / dropdowns / expression slots. Use this when you're
            learning the surface or want compile-time-safe authoring.
          </li>
          <li>
            <strong>Code</strong> — the textarea above. Source-of-truth
            for the spec; parsed live on every keystroke. Use this for
            speed, copy-paste from these docs, or anything the Visual
            palette doesn't cover yet (e.g. some advanced compositors).
          </li>
        </ul>
        <p>
          Both modes back the same in-memory spec, so switching back
          and forth never loses data. If the Code view shows a parse
          error, the Visual view sticks on the last valid parse and
          the chip on the toggle says <em>"parse error — fix code"</em>.
        </p>
        <p className="hint">
          <strong>Templates</strong>: the <code>+ New ability</code> menu
          has a <strong>Start from template</strong> shortcut. Templates
          ship for: Life Leech / Reflect 50% / Execute / Rage / Telegraph
          + Detonate / Anti-Status Burst / Scaled Strike /
          Absorb Shield / 5s Burst Counter / Recent-Hits Array /
          Form Swap (glass cannon) / Flier Hunter (type-gated) /
          Custom Status On Hit. Pick one closest to what you want and
          edit; faster than starting from blank.
        </p>
      </Section>

      <Section title="How a decision actually evaluates">
        <p className="hint">
          A common confusion: <code>utility</code>,{" "}
          <code>available</code>, and the timing policy interact in
          subtle ways. This section pins the actual order.
        </p>
        <Subhead>The two halves: decision and timing</Subhead>
        <p>
          <strong>Decision</strong> = the spec — <code>utility</code>{" "}
          (how valuable is firing this RIGHT NOW or after some delay?)
          and <code>available</code> (a hard 0/1 gate). Authored on the
          ability spec.
        </p>
        <p>
          <strong>Timing</strong> = the policy — given a decision,
          which moment to fire it at. The five built-in policies
          (really_fast / fast / semi_ideal / ideal / extreme) and any
          custom timing you author all share the same evaluator shape.
        </p>
        <Subhead>What the policy does on each tick</Subhead>
        <Code>{`1. force_skip — if the timing spec has force_skip and it's truthy,
                return Skip immediately. (Skip wins over force_fire.)
2. force_fire — if truthy AND is_available is truthy, return Now.
                (force_fire BYPASSES is_available being 0 only if its
                own gate is true — but does check is_available before
                emitting Now in the standard timings.)
3. is_available — if 0, return Skip.
4. Candidate search — for each delay D in candidates:
     project state forward by D seconds (light projection: time, hp,
     status decay; does NOT replay events that would have happened)
     if is_available is still truthy at projected state:
       u = utility(projected_state)
       track best (delay, u) pair
5. If best.utility > threshold:
     if best.delay <= threshold: return Now
     else: return Wait(best.delay)
   else: return Skip`}</Code>
        <Subhead>Practical consequences</Subhead>
        <ul>
          <li>
            <strong><code>utility</code> is evaluated AT THE PROJECTED
            STATE</strong>, not at the current state. If you read{" "}
            <code>self.hp</code>, you're reading the projected HP at
            <em>t + delay</em>. Light projection covers HP, time, status
            decay — but NOT future bites / heals / triggers, so
            forward-look is an approximation.
          </li>
          <li>
            <strong><code>is_available</code> is also evaluated against
            the projected state</strong>. So a gate like
            <code> self.cooldown_remaining.X &lt;= 0</code> correctly
            answers "will the cooldown have elapsed by t+delay?".
          </li>
          <li>
            <strong>Sliding windows (B2)</strong> read the buffer at the
            projected time, but the buffer itself doesn't get new events
            during projection. So{" "}
            <code>damage_taken_last.5</code> at projected t+10 reads
            "what's in the buffer between t+5 and t+10", which is empty
            because no projected events landed there. Best read at{" "}
            <code>delay = 0</code>; use ReallyFast for cleanest semantics.
          </li>
          <li>
            <strong>Triggers do NOT consult timing</strong> — they fire
            unconditionally when their event happens, against the current
            (not projected) state.
          </li>
        </ul>
      </Section>

      <Section title="Expression DSL">
        <p>
          Used in <code>utility:</code> / <code>available:</code> /{" "}
          <code>reallyfast_gate:</code> and inside any{" "}
          <code>{"<num-or-Expr>"}</code> field of an effect statement.
        </p>
        <Subhead>Operators (lowest → highest precedence)</Subhead>
        <ul>
          <li><code>?:</code> ternary, also <code>if X then Y else Z</code></li>
          <li><code>||</code> or, <code>&&</code> and</li>
          <li><code>{"=="}</code> <code>{"!="}</code> <code>{"<"}</code> <code>{"<="}</code> <code>{">"}</code> <code>{">="}</code></li>
          <li><code>+</code> <code>-</code></li>
          <li><code>*</code> <code>/</code> <code>%</code></li>
          <li><code>**</code> (right-assoc power)</li>
          <li>unary <code>-x</code>, <code>!x</code></li>
        </ul>
        <Subhead>Functions</Subhead>
        <ul>
          <li><code>min(a, b)</code> <code>max(a, b)</code> <code>pow(a, b)</code></li>
          <li><code>abs(x)</code> <code>sign(x)</code> <code>sqrt(x)</code></li>
          <li><code>floor(x)</code> <code>ceil(x)</code> <code>round(x)</code></li>
          <li><code>ln(x)</code> <code>exp(x)</code></li>
          <li><code>clamp(value, lo, hi)</code></li>
          <li>
            <code>rand()</code> — deterministic-pseudo-random roll in
            <code>[0, 1)</code>. All <code>rand()</code> calls within
            one expression evaluation return the SAME number — use
            it for "variable per ability fire" (e.g. <code>50 + rand() * 50</code>),
            not for two independent rolls in one expression.
          </li>
        </ul>
        <Subhead>Variable paths</Subhead>
        <Code>{`# Globals (no side prefix)
time                          # seconds since fight start
combat.iteration_count        # engine loop iteration
combat.bites_dealt            # B4: cumulative bites dealt by self
combat.bites_taken            # by self (perspective = firing side)
combat.damage_dealt_total     # cumulative post-mitigation damage dealt
combat.damage_taken_total     # by self
scaling.<key>                 # A11: spec.scaling[<key>][active_level-1]
                              # (only set when the firing spec declares it)

# Compare-page environment flags (constant for the fight, 0 or 1)
env.is_day                    # "Day/Night" set to "day"
env.is_night                  # "Day/Night" set to "night"
env.is_blue_moon              # "Moon" set to "blueMoon"
env.is_blood_moon             # "Moon" set to "bloodMoon"
env.air_rule_active           # "Special Air PvP Rule" enabled

# Per side: self / opp (= caster / opponent)
self.hp                       # current HP
self.max_hp
self.hp_ratio                 # 0..1
self.bite_dps                 # damage / max(bite_cooldown, 0.1)
self.breath_capacity
self.next_hit                 # sim time of next bite
self.is_alive                 # 0 or 1
self.statuses_count
self.statuses_total_stacks

self.status.<id>.stacks       # stack count of named status
self.cooldown_until.<id>      # absolute time
self.cooldown_remaining.<id>  # max(0, cd_until - time)
self.is_idle.<id>             # 0/1, both timers past
self.active_until.<id>
self.active_remaining.<id>
self.status_block.<id>        # combined resist + plushie block [0..1];
                              # 1.0 if id is in immune_status_ids
self.is_immune.<id>           # 1/0 — immune_status_ids membership flag
self.is_posture.<P>           # 1/0 — committed posture matches <P>
                              # (Standing / Sitting / Laying, case-insensitive)
self.is_type.<T>              # 1/0 — creature type matches <T> (e.g. Flier)
self.is_diet.<D>              # 1/0 — diet matches <D> (Carnivore/Herbivore/…)
self.is_elder                 # 1/0 — any non-None elder variant
self.is_elder.<V>             # 1/0 — elder variant matches <V> (Devious/…)
self.tier                     # numeric rarity tier (ordinal: opp.tier >= 4)

self.stats.damage             # any SimpleCombatantStats field
self.stats.weight             # full list: damage, weight, health,
self.stats.bite_cooldown      # bite_cooldown, health_regen,
self.stats.first_strike_pct   # active_cooldown_multiplier,
self.stats.has_reflect        # quick_recovery_hp_ratio_threshold,
                              # unbreakable_damage_cap_pct,
                              # damage_taken_multiplier_on_being_bitten,
                              # breath_resistance,
                              # berserk_bite_cooldown_multiplier,
                              # berserk_hp_ratio_threshold,
                              # first_strike_pct,
                              # first_strike_hp_ratio_threshold,
                              # has_warden_resistance, has_reflect,
                              # hunker_reduction_pct,
                              # plushie_reflect_avg_pct
self.extras.<key>             # custom counters via set_extra/inc_extra
self.extras.<key>.length      # B3: numbered-key array length
self.extras.<key>.sum         # B3: sum of array entries
self.extras.<key>.last        # B3: most recently pushed
self.extras.<key>.<i>         # B3: literal-index read
self.fired_count.<id>         # how many times <id> fired this fight
self.last_fire_time.<id>      # sim time of last fire
self.time_since_fire.<id>     # time - last_fire (Inf if never)
self.damage_taken_last.<N>    # B2: post-mitigation damage TAKEN in last N
                              # seconds (bite-only; engine keeps a 30s buffer)
self.damage_dealt_last.<N>    # B2: same for damage DEALT

opp.*                         # mirror of every self.* path. opp is an
opponent.*                    # alias for opponent (B5).

# Inside trigger effects only:
event.damage_taken            # OnTakeDamage delta
event.damage_dealt            # OnDealDamage / OnKill final blow
event.tick_index              # OnTick 0-based fire count
event.applied_status_count    # OnStatusApply
event.expired_status_count    # OnStatusExpire
event.first_strike_active     # OnFirstStrike (1 = newly active)

# Damage-kind flags inside on_take_damage / on_deal_damage:
event.is_bite                 # 1.0 if a bite landed this iteration
event.is_breath               # 1.0 if a breath tick landed
event.is_dot                  # 1.0 if any DOT status ticked
# Example: if event.is_breath: apply opp Heat_Wave_Status x5  (anti-breath)

# Per-status flags inside on_status_apply / on_status_expire:
event.applied.<status_id>     # 1.0 if that status was applied this tick
event.expired.<status_id>     # 1.0 if that status decayed / was cleansed
# Example: if event.applied.Poison_Status: apply opp Disease_Status x3

# Healing event (on_heal):
event.heal_amount             # total healing applied this iteration

# Active-window expiry (on_active_end):
event.ended.<ability_id>      # 1.0 if that active window just ended
event.ended_count             # how many ended this iter
# <ability_id> is a user.<id>, OR a built-in window:
#   fortify, harden, hunters_curse, unbridled_rage, adrenaline,
#   life_leech, reflect, frost_nova, totem
# Example: if event.ended.user.haste: apply self Slow_Status x5
# Example: if event.ended.fortify: apply opp Bleed_Status x3`}</Code>
      </Section>

      <Section title="Effect statements">
        <p className="hint">
          Effect statements live inside <code>on_fire:</code> /
          trigger blocks / nested compositors. One statement per
          indented line.
        </p>

        <Subhead>HP / damage / heal</Subhead>
        <Code>{`deal <num-or-Expr> to (self|opp)             # direct damage
heal (self|opp) <num-or-Expr>                # heal up to max HP
deal_typed bite|breath|true <num> to (self|opp)
                                              # routed via resistance
detonate (self|opp) <Status_Id> @ <Expr>     # damage = stacks × Expr,
                                              # then remove status
set_hp (self|opp) <num-or-Expr>              # clamped to [0, max]
transfer <num> hp from (self|opp) to (self|opp)
swap_hp                                       # swap caster ↔ opp ratios
pay (self|opp) <pct>%                         # subtract maxHP%, floor at 1`}</Code>

        <Subhead>Statuses</Subhead>
        <Code>{`apply <Status_Id> x<num-or-Expr> to (self|opp)
apply [<Id1> x<n>, <Id2> x<n>, ...] to (self|opp)   # A3 array form
clear (self|opp) <Status_Id>                       # remove specific status
clear (self|opp) [<Id1>, <Id2>, ...]               # A3 array form
modify_status (self|opp) <Status_Id> add|set <num>
dispel (self|opp)                                  # wipe ALL statuses
extend (self|opp) <Status_Id> <secs>               # +remaining_sec
cleanse (self|opp)                                 # remove fortify-removable
tick_next  (self|opp) <Status_Id> @<abs_time>      # A4: re-arm next DOT tick
decay_next (self|opp) <Status_Id> @<abs_time>      # re-arm next stack decay`}</Code>
        <p className="hint">
          <strong>Array forms (A3).</strong> Brackets list multiple
          ids; each is processed independently through the canonical
          resist/plushie pipeline. Empty arrays are rejected at parse
          time. <strong>Status-timer controls (A4)</strong> are advanced
          helpers for custom DOT pacing — the engine floors the
          timestamp at current sim time, so a past value collapses
          to "fire on the next status-tick phase". No-ops when the
          status isn't present on the target.
        </p>

        <Subhead>Cooldowns / engine timers</Subhead>
        <Code>{`cooldown (self|opp) <id> for <num-or-Expr>   # numeric → set_cooldown_until
                                              # Expr   → set_cooldown_until_expr
active   (self|opp) <id> for <num-or-Expr>   # same routing for active windows
reset_cooldown (self|opp) <id>
reset_active   (self|opp) <id>
interrupt (self|opp) <secs>                  # push next bite forward
consume_breath (self|opp) <secs>
restore_breath (self|opp) <secs>`}</Code>
        <p className="hint">
          <strong>Expr-duration cooldowns / actives (2026-05-12).</strong>{" "}
          When the duration text is a plain number the parser emits the
          numeric variant (<code>set_cooldown_until</code> /{" "}
          <code>set_active_until</code>). When the text is any expression —
          e.g. <code>scaling.window</code>, <code>self.hp_ratio * 30</code>{" "}
          — the parser routes to the <code>_expr</code> sibling so the
          duration is recomputed against the pre-fire state. Negative
          results clamp to 0 on the engine side.
        </p>

        <Subhead>Custom state (counters, modifiers, arrays)</Subhead>
        <Code>{`set_extra (self|opp) <key> = <Expr>          # write extras.<key>
inc_extra (self|opp) <key> += <Expr>         # read-modify-write
modify_stat (self|opp) <field> add|mul|set <num> for <secs>
                                              # temporary stat modifier
form_swap [<field> <mode> <value>, ...] on (self|opp) for <secs> hp:<ratio|absolute|set <num>>
                                              # glass-cannon <-> tank; sugar over modify_stat
                                              # (health = max HP); <secs> 0 = permanent;
                                              # hp_policy reconciles current HP on entry + revert
push_extra (self|opp) <key> <Expr>           # B3: append to a numbered-key array
                                              # stored as <key>.length + <key>.<i>;
                                              # cap 256 entries
clear_array (self|opp) <key>                 # remove all <key>.<i> + <key>.length`}</Code>
        <p className="hint">
          <strong>Arrays (B3).</strong> Read back with{" "}
          <code>self.extras.&lt;key&gt;.length</code>,{" "}
          <code>self.extras.&lt;key&gt;.sum</code>,{" "}
          <code>self.extras.&lt;key&gt;.last</code>, or by literal index{" "}
          <code>self.extras.&lt;key&gt;.0</code>. Holes (e.g. from
          out-of-order writes) contribute 0 to <code>.sum</code>.
          Records work for free via dotted keys —{" "}
          <code>set_extra self foo.bar = 1</code> writes the literal
          key and is read as <code>self.extras.foo.bar</code>.
        </p>

        <Subhead>Compositors / control flow</Subhead>
        <Code>{`if <Expr>:                                    # branch
  <effects>
else:
  <effects>

repeat <N>:                                   # apply body N times
  <effects>                                   # capped at 64

chance <prob-Expr>:                           # deterministic-seeded
  <effects>

choose:                                       # weighted one-of-N
  weight <Expr>:                              # multiple branches; exactly
    <effects>                                 # ONE fires per evaluation
  weight <Expr>:
    <effects>

schedule <secs>:                              # fire later (anonymous)
  <effects>                                   # capped 600s, 32 queued
schedule <secs> as <name>:                    # A12: named — cancellable
  <effects>

cancel_schedule <name>                        # A12: drop matching queued
reschedule <name> <secs>                      # A12: move due time`}</Code>
        <p className="hint">
          <strong>Named schedules (A12).</strong> Adding{" "}
          <code>as &lt;name&gt;</code> to a <code>schedule</code> block
          tags it so a later <code>cancel_schedule &lt;name&gt;</code>{" "}
          or <code>reschedule &lt;name&gt; &lt;secs&gt;</code> can find
          it in the queue. Channel-style patterns ("if I take damage,
          cancel my pending bomb"). Anonymous{" "}
          <code>schedule N:</code> blocks keep the fire-and-forget
          semantics — they can't be cancelled.
        </p>

        <Subhead>Snapshots / chaining</Subhead>
        <Code>{`snapshot (self|opp) <key>                    # record hp + statuses
restore (self|opp) <key>                     # rewind to snapshot
trigger <ability_id>                          # chain another user ability`}</Code>
      </Section>

      <Section title="Timing structure">
        <Code>{`timing <id> "<display name>"
  candidates: 0, 0.5, 1, 2, 5      # delays the policy enumerates
  horizon: 15                       # bound for utility integrals
  threshold: 0.001                  # optional (default 1e-6)
  force_skip: <Expr>                # optional gate-out
  force_fire: <Expr>                # optional gate-in (skip wins)`}</Code>
        <p className="hint">
          Reference candidate sets — Fast: <code>0, 0.1, 0.5</code>;
          SemiIdeal: <code>0, 0.5, 1, 2, 5</code>; Ideal:{" "}
          <code>0, 0.5, 1, 2, 5, 10, 15, 30</code>.
        </p>
      </Section>

      <Section title="Examples">
        <Subhead>Half-of-current-HP execute (turret-style)</Subhead>
        <Code>{`ability user.execute "Execute"
  timing really_fast
  utility: opp.hp_ratio < 0.3 ? 1000000 : 0
  available: opp.hp_ratio < 0.3
  on_fire:
    deal opp.hp * 0.5 to opp
    cooldown self user.execute for 5`}</Code>

        <Subhead>LifeLeech vampirism (passive)</Subhead>
        <Code>{`ability user.vampire "Vampirism"
  utility: 0
  available: 0
  on_deal_damage:
    heal self event.damage_dealt * 0.3`}</Code>

        <Subhead>Reflect 50% of damage taken</Subhead>
        <Code>{`ability user.reflect "Reflect 50%"
  utility: 0
  available: 0
  on_take_damage:
    deal event.damage_taken * 0.5 to opp`}</Code>

        <Subhead>Rage meter — combo finisher</Subhead>
        <Code>{`ability user.rage "Rage"
  timing really_fast
  utility: self.extras.rage >= 5 ? 1000000 : 0
  available: self.extras.rage >= 5
  on_fire:
    deal self.extras.rage * 100 to opp
    set_extra self rage = 0
  on_take_damage:
    inc_extra self rage += 1`}</Code>

        <Subhead>Telegraph + Detonate</Subhead>
        <Code>{`ability user.telegraph "Telegraph"
  utility: self.bite_dps
  available: 1
  on_fire:
    apply Mark_Status x3 to opp
    schedule 3:
      detonate opp Mark_Status @ 250`}</Code>

        <Subhead>Conditional execute branch</Subhead>
        <Code>{`ability user.smart "Smart Strike"
  utility: self.bite_dps
  available: 1
  on_fire:
    if opp.hp_ratio < 0.3:
      deal 500 to opp
    else:
      deal 100 to opp
    cooldown self user.smart for 10`}</Code>

        <Subhead>Custom timing — fire on emergencies only</Subhead>
        <Code>{`timing user.emergency_only "Emergency"
  candidates: 0, 0.1
  horizon: 5
  threshold: 0.001
  force_skip: self.hp_ratio > 0.5
  force_fire: self.hp_ratio < 0.2`}</Code>
      </Section>

      <Section title="Vocabulary — exact values you can plug in">
        <p className="hint">
          Fields that take an identifier accept any string the engine
          can resolve. The lists below are the canonical built-ins —
          you can also use freeform IDs for things you've defined
          yourself (any custom status name, your own{" "}
          <code>user.&lt;ability&gt;</code> id, etc.).
        </p>

        <Subhead>Status IDs (for apply / clear / extend / consume / detonate)</Subhead>
        <p>
          {KNOWN_STATUS_IDS.length} engine-recognised statuses. Custom
          status names also work — the engine treats unknown IDs as 0
          stacks until something applies them.
        </p>
        <p>
          <strong>Custom statuses (Phase 6).</strong> Define your own
          parametric status under the <em>Custom → Statuses</em> tab — pick
          polarity, stacking + decay, a periodic DoT/HoT tick (flat or
          %-max-hp, base + per-stack), regen / incoming-damage /
          outgoing-damage / bite-cooldown modifiers, and whether Fortify
          cleanses it. It registers under a <code>user.&lt;name&gt;</code>{" "}
          id; reference that id from any{" "}
          <code>apply_status</code> / on-hit / starting-status slot here and
          it behaves like a built-in ailment. Registered custom statuses are
          suggested in the status-id inputs alongside the built-ins.
        </p>
        <VocabGrid items={KNOWN_STATUS_IDS} />

        <Subhead>Stat fields (for modify_stat)</Subhead>
        <p>
          Numeric / boolean fields on <code>SimpleCombatantStats</code>.
          Expression paths read live base values via{" "}
          <code>self.stats.&lt;field&gt;</code> for <em>any</em> field.{" "}
          <code>modify_stat</code> takes <strong>runtime effect</strong> on
          every numeric combat field (Phase 2 wired the full set through a
          single effective-stats layer threaded into all phases):
        </p>
        <VocabGrid
          items={[
            "damage",
            "damage2",
            "bite_cooldown",
            "weight",
            "health",
            "health_regen",
            "active_cooldown_multiplier",
            "hunker_reduction_pct",
            "breath_resistance",
            "unbreakable_damage_cap_pct",
            "first_strike_pct",
            "first_strike_hp_ratio_threshold",
            "berserk_bite_cooldown_multiplier",
            "berserk_hp_ratio_threshold",
            "quick_recovery_hp_ratio_threshold",
            "damage_taken_multiplier_on_being_bitten",
            "plushie_reflect_avg_pct",
          ]}
        />
        <p className="hint">
          <strong><code>health</code> = max HP</strong> (the modify_stat /
          form_swap field name for max HP is <code>health</code>, not{" "}
          <code>max_hp</code> — <code>max_hp</code> is a read-only expression
          var). Changing it rescales the HP ceiling; current HP is
          reconciled only by <code>form_swap</code>'s <code>hp_policy</code>{" "}
          (a bare <code>modify_stat health</code> raises the ceiling without
          touching current HP).
        </p>
        <p className="hint">
          <strong>Booleans</strong> aren't writable through{" "}
          <code>modify_stat</code>: <code>has_warden_resistance</code> can
          only be flipped via <code>form_swap … set</code>, and{" "}
          <code>has_reflect</code> is excluded (reflect is an
          activation-derived window, not a base stat). All fields remain
          readable via <code>self.stats.&lt;field&gt;</code> regardless.
        </p>
        <VocabGrid items={STATS_FIELDS} />

        <Subhead>Built-in ability IDs (for cooldown / trigger / chain)</Subhead>
        <p>
          The engine ships with these decision policies registered. You
          can target their cooldowns and chain into them. Custom abilities
          use the <code>user.&lt;name&gt;</code> prefix.
        </p>
        <VocabGrid items={BUILT_IN_ABILITY_IDS} />

        <Subhead>Side-state expression paths</Subhead>
        <p>
          Available as <code>self.&lt;field&gt;</code> and{" "}
          <code>opp.&lt;field&gt;</code> (mirror).
        </p>
        <VocabGrid items={EXPR_SIDE_FIELDS} />

        <Subhead>Per-ability timer paths</Subhead>
        <p>
          Available as <code>self.&lt;family&gt;.&lt;id&gt;</code> /{" "}
          <code>opp.&lt;family&gt;.&lt;id&gt;</code>, where{" "}
          <code>id</code> is one of the ability IDs above (or a custom{" "}
          <code>user.&lt;name&gt;</code>).
        </p>
        <VocabGrid items={EXPR_SIDE_TIMER_FAMILIES} />
        <p className="hint">
          Examples: <code>self.cooldown_remaining.fortify</code>,{" "}
          <code>self.is_idle.user.execute</code>,{" "}
          <code>opp.fired_count.life_leech</code>,{" "}
          <code>self.damage_taken_last.5</code> (B2 — last-5s damage),{" "}
          <code>opp.damage_dealt_last.10</code>. <code>opp.</code> is an
          alias for <code>opponent.</code> (B5).
        </p>

        <Subhead>Combat-meta counters</Subhead>
        <p>
          Cumulative per-fight counters surfaced under the{" "}
          <code>combat.</code> namespace; perspective side = whoever
          owns the firing spec.
        </p>
        <Code>{`combat.iteration_count        # loop iterations so far
combat.bites_dealt            # bites dealt by self (B4)
combat.bites_taken            # bites taken by self
combat.damage_dealt_total     # cumulative post-mitigation damage dealt
combat.damage_taken_total     # cumulative post-mitigation damage taken`}</Code>
        <p className="hint">
          <strong>Coverage.</strong> Bite, breath, and DOT damage all
          contribute to <code>combat.damage_dealt_total</code> /{" "}
          <code>combat.damage_taken_total</code> and the{" "}
          <code>damage_*_last.&lt;N&gt;</code> sliding-window buffers.{" "}
          <code>combat.bites_dealt</code> /{" "}
          <code>combat.bites_taken</code> count bites specifically (no
          breath / DOT contribution). Trap / Lance / Reflect /
          life-leech-self-damage sources don't accumulate yet — these
          are passes through their own helpers and didn't get
          instrumented in the current round.
        </p>

        <Subhead>Event fields (inside trigger blocks only)</Subhead>
        <p>
          Available as <code>event.&lt;field&gt;</code> while a trigger
          (on_take_damage, on_deal_damage, on_tick, …) is firing.
        </p>
        <VocabGrid items={EXPR_EVENT_FIELDS} />

        <Subhead>Ability levels &amp; scaling</Subhead>
        <p>
          An ability spec can declare <code>levels: N</code> (default 1)
          and a <code>scaling</code> table of named numeric arrays of length{" "}
          <code>N</code>. At dispatch time the engine surfaces each entry
          as <code>scaling.&lt;key&gt;</code>, evaluated at the current
          active level:
        </p>
        <Code>{`# DSL — header lines between metadata and exprs:
ability user.scaled_strike "Scaled Strike"
  levels 3
  default_level 2
  scaling damage_amount: 50, 100, 200
  scaling cost_hp:       10,  15,  20
  utility: 1
  available: self.cooldown_until.user.scaled_strike <= time
  on_fire:
    deal scaling.damage_amount to opp
    cooldown self user.scaled_strike for 5`}</Code>
        <p className="hint">
          Resolves to <code>0.0</code> when an ability is dispatched
          outside an active spec context, or when the key isn't in the
          spec's <code>scaling</code> table — the engine never errors on
          a missing scaling entry. The visual editor surfaces a Levels
          panel + scaling-table editor when an ability has levels.
          Compare UI will gain a per-matchup level picker in a follow-up
          round; until then <code>default_level</code> on the spec is the
          effective level.
        </p>

        <Subhead>Damage types (for deal_typed)</Subhead>
        <VocabGrid items={["bite", "breath", "true"]} />
        <p className="hint">
          <code>bite</code> routes through bite-resistance modifiers,{" "}
          <code>breath</code> through breath-resistance, and{" "}
          <code>true</code> bypasses all routing.
        </p>

        <Subhead>Modifier modes</Subhead>
        <VocabGrid items={["add", "mul", "set"]} />
        <p className="hint">
          For <code>modify_stat</code> and <code>modify_status</code>:{" "}
          <code>add</code> adds the value, <code>mul</code> multiplies,{" "}
          <code>set</code> overwrites.
        </p>
        <p className="hint">
          <strong>Stacking across abilities (modify_stat).</strong> Each
          ability's <code>modify_stat</code> writes its own modifier slot,
          tagged with the firing ability's id. Two different abilities
          that both apply <code>modify_stat damage mul 1.5</code> stack
          (final effective = base × 1.5 × 1.5), they don't overwrite each
          other. Across modes: every <code>mul</code> from every source
          multiplies; every <code>add</code> sums; <code>set</code>{" "}
          overrides everything (and among multiple <code>set</code>{" "}
          sources, the one with the latest expiry wins). One ability
          applying its own <code>modify_stat</code> a second time refreshes
          its own slot (no self-stacking).
        </p>

        <Subhead>Targets</Subhead>
        <VocabGrid items={["self / caster", "opp / opponent"]} />
        <p className="hint">
          <code>self</code> is the side that owns the ability;{" "}
          <code>opp</code> is the other side. Some effects (e.g.{" "}
          <code>swap_hp</code>) take no target.
        </p>

        <Subhead>Timing modes</Subhead>
        <VocabGrid
          items={["really_fast", "fast", "semi_ideal", "ideal", "extreme"]}
        />
        <p className="hint">
          Each mode dictates how aggressively the policy enumerates
          firing delays. ReallyFast uses an expression gate;
          Ideal/Extreme do a full integral utility evaluation.
        </p>
      </Section>

      <Section title="Damage-modify hooks (A13) — shields, parries, amplifiers">
        <p>
          Two trigger hats fire <em>before</em> the engine applies HP
          changes for a damage event. The handler can write{" "}
          <code>set_extra self damage_override = N</code> to replace the
          final amount the engine applies (clamped ≥ 0; negative values
          fold to 0 → no-damage event).
        </p>

        <Subhead>The two hooks</Subhead>
        <ul>
          <li>
            <strong><code>on_before_deal_damage</code></strong> — fires
            on the side dealing damage. Use for damage amplification /
            crit / conditional buffs.
          </li>
          <li>
            <strong><code>on_before_take_damage</code></strong> — fires
            on the side receiving damage, AFTER the dealer hook. Use for
            shields / parry / absorb / damage reduction.
          </li>
        </ul>

        <Subhead>Event fields available</Subhead>
        <ul>
          <li>
            <code>event.raw_damage</code> — pre-mitigation amount (the
            "intended" damage from the source before Hunker / Fortify
            etc. trimmed it).
          </li>
          <li>
            <code>event.damage_taken</code> — engine's current estimate
            of the post-mitigation amount. The dealer hook sees this as
            "the amount I'm about to deal"; the victim hook sees it AFTER
            the dealer hook may have modified it.
          </li>
          <li>
            <code>event.prevented_damage</code> = raw − taken.
          </li>
          <li>
            <code>event.is_bite</code> / <code>event.is_breath</code> /{" "}
            <code>event.is_dot</code> — same kind flags as the
            post-damage triggers.
          </li>
        </ul>

        <Subhead>Examples</Subhead>
        <Code>{`# Absorb up to 100 incoming damage per hit (victim).
on_before_take_damage:
  set_extra self damage_override = max(0, event.damage_taken - 100)

# Reflect — keep the damage AND deal it back to the dealer.
on_before_take_damage:
  deal event.damage_taken to opp           # reflect first (kills target if lethal)
  # No damage_override → engine applies full damage_taken normally.

# Soft absorb — absorb 50%, but bottom-clamp at 10 so chip damage still lands.
on_before_take_damage:
  set_extra self damage_override = max(10, event.damage_taken * 0.5)

# Critical-hit amplifier (dealer side).
on_before_deal_damage:
  chance 0.2:
    set_extra self damage_override = event.damage_taken * 3.0

# Conditional execute — TRIPLE damage when victim is below 30%.
on_before_deal_damage:
  if opp.hp_ratio < 0.3:
    set_extra self damage_override = event.damage_taken * 3.0`}</Code>

        <Subhead>Ordering &amp; gotchas</Subhead>
        <ul>
          <li>
            <strong>Dealer fires before victim.</strong> The victim's
            hook sees the post-amplification number in{" "}
            <code>event.damage_taken</code> — so a victim shield that
            absorbs "up to N" effectively absorbs N of the
            <em>post-amplification</em> hit.
          </li>
          <li>
            <strong>Every damage source routes through the hooks
            (Phase 4 / G3).</strong> Bite, breath, DOT, lance (aura +
            impact), damage trails, reflux, grim lariat, shadow barrage,
            and reflected self-damage all fire{" "}
            <code>on_before_deal_damage</code> then{" "}
            <code>on_before_take_damage</code> before HP applies, and all
            honour <code>damage_override</code>. The{" "}
            <code>event.is_bite</code> / <code>event.is_breath</code> /{" "}
            <code>event.is_dot</code> flags tell the source apart;
            direct/utility sources get all-zero kind flags (the override
            still works). DOT is adjusted in aggregate per iteration (a
            phase-level post-hoc step, not per-tick), consistent with how{" "}
            <code>on_take_damage</code> coalesces DOT. Recoil does not
            exist in the engine.
          </li>
          <li>
            <strong>One-shot key.</strong>{" "}
            <code>damage_override</code> is cleared from{" "}
            <code>user_extras</code> immediately after the engine reads
            it. A stale value from a prior damage event can never leak in.
          </li>
          <li>
            <strong>Negative values clamp to 0.</strong> Setting{" "}
            <code>damage_override = -100</code> = no damage.
          </li>
          <li>
            <strong>Override applies BEFORE Reflect.</strong> If the
            victim absorbs to 0, there's no damage left to reflect.
          </li>
        </ul>
      </Section>

      <Section title="Ability levels &amp; scaling (A11)">
        <p>
          Build a single spec that powers N "ranks" without copy-pasting.
          Declare <code>levels: N</code> + <code>default_level: K</code>{" "}
          + named <code>scaling</code> arrays of length N; the engine
          surfaces each entry as <code>scaling.&lt;key&gt;</code> at
          dispatch time at the chosen level.
        </p>
        <Code>{`ability user.scaled_strike "Scaled Strike"
  levels 3
  default_level 2
  scaling damage_amount: 50, 100, 200       # arrays of length=levels
  scaling cost_hp:       10,  15,  20       # multiple keys allowed
  utility: 1
  available: self.cooldown_until.user.scaled_strike <= time
  on_fire:
    deal scaling.damage_amount to opp                # 100 at level 2
    pay self scaling.cost_hp                          # 15% HP at level 2
    cooldown self user.scaled_strike for 5`}</Code>
        <Subhead>Compare-time level picker</Subhead>
        <p>
          Compare → Battle Settings → <em>Custom-ability per-fight
          level</em> shows a row for every attached user ability with{" "}
          <code>levels &gt; 1</code>. Pick a different level just for
          this matchup; the spec's <code>default_level</code> is
          untouched. Out-of-range picks (e.g. Lv 5 on a 3-level spec)
          silently fall back to <code>default_level</code>.
        </p>
        <p className="hint">
          <strong>Resolver behavior:</strong> if you read{" "}
          <code>scaling.&lt;key&gt;</code> from a spec that doesn't
          declare that scaling key (or from outside any active
          dispatch), it returns <code>0.0</code> — no error. Useful for
          fallback patterns like{" "}
          <code>max(scaling.damage, self.stats.damage * 0.5)</code>.
        </p>
      </Section>

      <Section title="Batch-level gate (B6) — `when` field">
        <p>
          Any effect batch (<code>on_fire</code>, any trigger body, a
          scheduled effect bundle) can declare a single optional{" "}
          <code>when</code> Expr. When set and the expression evaluates
          falsy (≤ 0.5), the engine SKIPS the entire batch — no effects
          run, no combat-log entry is recorded.
        </p>
        <p>
          Use cases:
        </p>
        <ul>
          <li>
            Conditionally silence a noisy reactive trigger without
            wrapping every line in <code>if X:</code>.
          </li>
          <li>
            Disable an ability based on a global flag stored in extras
            (e.g. <code>extras.disabled_by_player</code> = 1).
          </li>
        </ul>
        <p className="hint">
          <strong>Authoring surface today:</strong> available via the
          Visual editor (where the trigger block shows a "when" Expr slot)
          and via direct JSON spec import. DSL textarea syntax for the{" "}
          <code>when</code> field ships in a follow-up — for now, use
          Visual mode if you need to author <code>when</code>.
        </p>
      </Section>

      <Section title="Custom breath weapons (Phase 7 / G7)">
        <p>
          Breath is a <strong>creature property</strong>, not part of the
          ability DSL — so it's authored in{" "}
          <code>Custom &gt; Creatures</code>, not here. In the creature
          editor, toggle <strong>Custom breath profile</strong> to author a
          full breath weapon instead of picking a named catalog breath. When
          set, it <strong>overrides the breath-name lookup</strong>; build
          buffs (<code>breathDamagePct</code> / <code>breathRegenPct</code>)
          still apply on top, exactly like built-in breaths. The engine runs
          the same <code>SimpleBreathProfile</code> path either way — G7 was
          pure authoring plumbing, no engine change.
        </p>
        <Subhead>Core fields (always present)</Subhead>
        <VocabGrid
          items={[
            "dpsPct",
            "capacity",
            "regenRate",
            "critChancePct",
            "chain",
            "chainMaxStacks",
          ]}
        />
        <Subhead>Special kinds (dispatch behaviour)</Subhead>
        <VocabGrid
          items={[
            "standard",
            "energy",
            "heal",
            "miasma",
            "cloud",
            "lance",
            "plasma_beam",
            "solar_beam",
            "spirit_glare",
            "heliolyth_judgement",
          ]}
        />
        <p className="hint">
          The editor reveals only the fields the chosen kind reads:{" "}
          <code>selfHealPct</code> (+ <code>cleanseStacks</code> for{" "}
          <code>heal</code>) for the self-heal kinds (heal / miasma /
          cloud); <code>lanceDamagePct</code> /{" "}
          <code>lanceChargeSec</code> / <code>lanceCooldownSec</code> /{" "}
          <code>lanceStatusId</code> for <code>lance</code>;{" "}
          <code>autoFireDelaySec</code> / <code>autoFireCooldownSec</code>{" "}
          for the auto-fire kinds (plasma_beam / solar_beam / spirit_glare /
          heliolyth_judgement); and <code>chargesMax</code> /{" "}
          <code>chargeRegenSec</code> for <code>plasma_beam</code>'s discrete
          charges. <code>energy</code> bypasses Hunker reduction.
        </p>
        <Subhead>On-tick status procs</Subhead>
        <p>
          A profile can apply statuses on every breath tick
          (<code>specialStatuses</code>: id + stacks). The id can be a
          built-in ailment <em>or</em> a <code>user.&lt;name&gt;</code>{" "}
          custom status (Phase 6) — so an authored breath can drive an
          authored status, e.g. a custom DoT.
        </p>
      </Section>

      <Section title="Custom statuses — the Status DSL (Phase 6 / G6)">
        <p>
          A custom status (a damage/heal-over-time, a regen or damage
          modifier, a slow…) is authored in <code>Custom &gt; Statuses</code>{" "}
          with its own two-mode editor — <strong>Visual</strong> knobs or this{" "}
          <strong>Status DSL</strong>, kept in lockstep so blocks and code
          always express the same spec. A status is a flat parametric record
          (no effect tree), so the grammar is a header plus one{" "}
          <code>key value</code> line per field — every line optional, defaults
          filled engine-side.
        </p>
        <Subhead>Grammar</Subhead>
        <Code>{`status user.<id> "<Display Name>"
  polarity            negative | positive | neutral
  stack_rule          stacking | non_stacking | unique
  max_stacks          <n>            # or: none  (unbounded)
  decay               <seconds>      # seconds for one stack to fall off
  tick_kind           none | dot_flat | dot_pct_max_hp | heal_flat | heal_pct_max_hp
  tick_base           <n>            # per-tick amount (flat HP, or %-max-hp points)
  tick_per_stack      <n>            # extra per-tick amount per stack
  tick_interval       <seconds>      # 0 / omitted = no periodic tick
  regen_mod           <pct>          # flat HP-regen % modifier while present
  regen_mod_per_stack <pct>
  incoming_mult       <x>            # × damage TAKEN by the bearer (1 = neutral)
  outgoing_mult       <x>            # × damage DEALT by the bearer
  bite_cooldown_mult  <x>            # × the bearer's bite cooldown (0.8 = faster)`}</Code>
        <p className="hint">
          Per-tick magnitude is{" "}
          <code>tick_base + tick_per_stack · stacks</code>; the regen modifier
          is <code>regen_mod + regen_mod_per_stack · stacks</code>.{" "}
          Fortify-removability is derived from <code>polarity</code> (negative ⇒
          cleansable, positive/neutral ⇒ not), exactly like built-in statuses.
          Once registered, apply a status from any ability via{" "}
          <code>apply user.&lt;id&gt; x&lt;n&gt; to …</code>, on-hit statuses,
          or starting statuses — it behaves like a built-in ailment.
        </p>
        <Subhead>Examples</Subhead>
        <InsertExample
          onInsert={onInsertStatus}
          snippet={`status user.deep_bleed "Deep Bleed"
  polarity negative
  stack_rule stacking
  max_stacks 10
  decay 4
  tick_kind dot_flat
  tick_base 5
  tick_per_stack 3
  tick_interval 1`}
        />
        <InsertExample
          onInsert={onInsertStatus}
          snippet={`status user.mending "Mending"
  polarity positive
  stack_rule unique
  decay 2
  tick_kind heal_pct_max_hp
  tick_base 0.5
  tick_interval 1
  regen_mod 25`}
        />
        <InsertExample
          onInsert={onInsertStatus}
          snippet={`status user.expose "Expose"
  polarity negative
  stack_rule non_stacking
  decay 6
  incoming_mult 1.3
  outgoing_mult 0.85
  bite_cooldown_mult 1.2`}
        />

        <Subhead>Programmable statuses (Phase 9) — hooks, expressions &amp; teardown</Subhead>
        <p>
          Beyond the parametric knobs, a status can carry <strong>hooks</strong>{" "}
          — the same effect grammar ability triggers use — plus{" "}
          <strong>expression-valued</strong> knobs. The behaviour belongs to the
          status and rides with it onto any bearer (no ability required on the
          victim). Inside a hook the <strong>bearer is <code>self</code></strong>{" "}
          and the other side is <code>opp</code> (the same frame DoT damage uses).
        </p>
        <Code>{`  on_apply:                 # fires once when the status lands (bearer = self)
    <effect>                #   any effect — same blocks as ability triggers
  on_tick <seconds>:        # fires periodically while present
    <effect>
  on_expire:                # fires once when it falls off (installed
    <effect>                #   modifiers auto-revert, HP fraction preserved)
  # Bearer-reactive triggers — fire on the bearer's own combat events (bearer =
  # self, other side = opp), each exposing event.<key> context to the batch:
  on_round_start:           # t=0 for a status present at fight start
  on_take_damage:           #   event.damage_taken / raw_damage / is_bite|breath|dot
  on_deal_damage:           #   event.damage_dealt
  on_kill:                  # bearer downed the opponent this iteration
  on_first_strike:          #   event.first_strike_active (1 / 0)
  on_heal:                  #   event.heal_amount
  on_status_apply:          #   event.applied.<id>  (another status landed)
  on_status_expire:         #   event.expired.<id>  (another status left)
  on_before_take_damage:    # shield, pre-mitigation: set_extra self damage_override = N
  on_before_deal_damage:    # amp, pre-mitigation:    set_extra self damage_override = N
  on_decay:                 #   event.stacks_lost   (a surviving stack decayed)
  on_restack:               #   event.stacks_gained (re-applied while present)
  # Exprs inside ANY hook read: status.stacks / status.max_hp /
  #   status.age (seconds on the bearer) / time / self.* / opp.* / event.<key>`}</Code>
        <p className="hint">
          <strong>Self-cleaning:</strong> any stat modifier a hook installs
          (e.g. a <code>form_swap</code> / <code>modify_stat</code> on{" "}
          <code>self</code>) is tagged to the status and automatically torn down
          when it falls off, with HP reconciled <strong>proportionally</strong>{" "}
          (the HP fraction is preserved across the max-HP change). Custom HP
          handling on expiry is authored as <code>on_expire</code> effects.
          Statuses may apply other custom statuses or trigger abilities from
          their hooks; such chains are paced by decay and bounded by the shared
          chain-depth cap, so they always terminate.
        </p>
        <p className="hint">
          <strong>Behaviour lives in hooks.</strong> Periodic damage/heal →{" "}
          <code>on_tick</code> with a <code>deal</code> / <code>heal</code> effect;
          damage scaling → the pre-damage hooks (
          <code>set_extra self damage_override = event.damage_taken * k</code>);
          bite-cooldown / regen → <code>modify_stat bite_cooldown</code> /{" "}
          <code>health_regen</code> in <code>on_apply</code> (auto-reverts on
          expiry). The old parametric <code>tick_kind</code> /{" "}
          <code>incoming_damage_mult</code> / … knobs still load for backward-compat
          but are no longer authored here — express the behaviour as hooks instead.
        </p>
        <Subhead>Examples</Subhead>
        <InsertExample
          onInsert={onInsertStatus}
          snippet={`status user.frail "Frail"
  polarity negative
  decay 8
  on_apply:
    form_swap [health mul 0.3] on self for 0 hp:ratio`}
        />
        <InsertExample
          onInsert={onInsertStatus}
          snippet={`status user.creeping_curse "Creeping Curse"
  polarity negative
  decay 3
  on_tick 1:
    deal 50 to self
  on_expire:
    deal 200 to self`}
        />
        <InsertExample
          onInsert={onInsertStatus}
          snippet={`status user.aging "Aging"
  polarity negative
  decay 1000
  on_tick 1:
    deal status.age to self
  on_decay:
    deal 100 to opp`}
        />
        <InsertExample
          onInsert={onInsertStatus}
          snippet={`status user.thorns "Thorns"
  polarity negative
  decay 1000
  on_take_damage:
    deal 40 to opp`}
        />
        <InsertExample
          onInsert={onInsertStatus}
          snippet={`status user.bulwark "Bulwark"
  polarity positive
  decay 1000
  on_before_take_damage:
    set_extra self damage_override = 0`}
        />
      </Section>

      <Section title="Engine semantics — what actually happens at runtime">
        <p className="hint">
          The DSL surface tells you what you can <em>write</em>; this
          section tells you what the engine actually <em>does</em>.
          Everything below is sourced from the Rust engine in{" "}
          <code>wasm-engine/src/</code>.
        </p>

        <Subhead>Iteration order &amp; trigger precedence</Subhead>
        <p>
          Combat advances in discrete iterations. Within one iteration,
          if multiple events happen, triggers fire in this order on
          both sides:
        </p>
        <Code>{`Per-damage-event (interleaved within damage phases):
  1.  on_before_deal_damage — DEALER, before HP applies. Can write
                              damage_override to amplify outgoing damage.
  2.  on_before_take_damage — VICTIM, after dealer hook. Can write
                              damage_override to absorb/reduce.
  3.  (engine applies HP delta now, honoring overrides)

Per-iteration aggregation (after all damage phases that iteration):
  4.  on_take_damage    — damage taken this iteration (delta > 0)
  5.  on_deal_damage    — damage dealt this iteration
  6.  on_status_apply   — statuses applied this iteration
  7.  on_status_expire  — statuses removed this iteration
  8.  on_heal           — cumulative heal_amount > 0 this iter (A7)
  9.  on_active_end     — user.<id> + built-in active windows that elapsed
  10. on_kill           — killing blow if it happened
  11. on_first_strike   — first-strike state transitions
  12. on_round_start    — once at t=0 only
  13. on_tick           — every interval_sec (per-ability)
  14. on_fire           — active firing (after every reactive trigger)`}</Code>
        <p className="hint">
          <strong>Pre-damage hooks (1-3)</strong> fire INLINE during the
          damage phase. They get one chance to mutate the amount via
          <code> set_extra self damage_override = N</code>; engine then
          applies the modified amount, and the post-damage{" "}
          <code>on_take_damage</code> at step 4 sees the FINAL number in
          <code> event.damage_taken</code> plus the original in{" "}
          <code>event.raw_damage</code>.
        </p>
        <p className="hint">
          Reactive triggers fire <strong>before</strong>{" "}
          <code>on_fire</code> in the same iteration, so a hit-reactive
          ability that lands a cooldown can prevent the active from
          double-firing on the same hit. Triggers do not fire
          recursively — a trigger's effects can change state, but
          they don't re-enter the trigger pipeline within the same
          iteration.
        </p>

        <Subhead>Hard limits</Subhead>
        <ul>
          <li>
            <code>repeat N</code>: <code>N</code> hard-clamped to{" "}
            <strong>64</strong> (<code>MAX_REPEAT_COUNT</code>).
          </li>
          <li>
            <code>trigger ability</code>: chains capped at depth{" "}
            <strong>4</strong> (<code>MAX_CHAIN_DEPTH</code>). Calls past
            the limit silently no-op.
          </li>
          <li>
            <code>on_tick</code>: <code>interval_sec</code> floored at{" "}
            <strong>0.05</strong>s (<code>MIN_TICK_INTERVAL_SEC</code>) —
            faster intervals clamp upward at dispatch.
          </li>
          <li>
            <code>schedule</code>: delay clamped to{" "}
            <strong>[0, 600]</strong>s. Queue holds at most{" "}
            <strong>32</strong> entries per side; on overflow the oldest
            entry is dropped.
          </li>
          <li>
            Status stacks: applied via <code>apply</code> /{" "}
            <code>modify_status</code>; the engine has no global stack
            cap, but per-status caps exist for some built-ins.
          </li>
        </ul>

        <Subhead>cooldown_until vs active_until</Subhead>
        <p>
          Each ability has two independent timer slots:
        </p>
        <ul>
          <li>
            <code>cooldown_until</code> — when the ability can next be
            considered for firing. Most "X-second cooldown" effects
            write here.
          </li>
          <li>
            <code>active_until</code> — separate "ability is currently
            active" timer. Used by built-ins like Fortify (active for
            N seconds after fire) where the side has an ongoing effect.
          </li>
        </ul>
        <p>
          <code>is_idle.&lt;id&gt;</code> returns <code>1</code> only when{" "}
          <strong>both</strong> timers are past the current time.{" "}
          <code>cooldown_remaining.&lt;id&gt;</code> reads only the
          cooldown slot.
        </p>

        <Subhead>trigger_ability (chain) semantics</Subhead>
        <p>
          <code>trigger &lt;ability_id&gt;</code> inlines the target
          ability's <code>on_fire</code> effects into the current
          dispatch. Critically:
        </p>
        <ul>
          <li>
            <strong>Skips <code>available</code> gate</strong> — the
            chained ability fires regardless of its own availability.
          </li>
          <li>
            <strong>Does not write the chained ability's cooldown</strong>{" "}
            — if you want the cooldown applied, the chained ability's
            on_fire must include its own <code>cooldown</code> effect.
          </li>
          <li>
            Unknown <code>ability_id</code> is a silent no-op.
          </li>
          <li>
            Recursion capped at depth 4 (see Hard limits).
          </li>
        </ul>

        <Subhead>Snapshot / restore scope</Subhead>
        <p>
          <code>snapshot &lt;side&gt; &lt;key&gt;</code> captures only:
        </p>
        <VocabGrid items={["hp", "statuses (with stacks + remaining time)", "extras (set_extra/inc_extra state)"]} />
        <p>
          <code>restore</code> rewinds those fields back. It does{" "}
          <strong>not</strong> capture cooldowns, active timers, scheduled
          effects, or fired_count. Multiple snapshots with the same key
          overwrite each other. Restoring a key that was never
          snapshotted is a silent no-op.
        </p>

        <Subhead>cleanse vs clear vs dispel</Subhead>
        <ul>
          <li>
            <code>clear &lt;side&gt; &lt;Status&gt;</code> — removes ONE specific
            status by id, regardless of type.
          </li>
          <li>
            <code>cleanse &lt;side&gt;</code> — removes ALL{" "}
            <em>fortify-removable</em> statuses. Every negative-polarity status
            type is fortify-removable; the engine derives the set from polarity
            (not a hard-coded list). The negative types:
            <VocabGrid
              items={[
                "Aftershock",
                "Ashy_Lungs",
                "Bad_Omen",
                "Bleed_Status",
                "Blurred_Vision_Status",
                "Broken_Bones_Status",
                "Broken_Legs_Status",
                "Burn_Status",
                "Confusion_Status",
                "Corrosion_Status",
                "Deep_Wounds_Status",
                "Disease_Status",
                "Drowsy_Status",
                "Fear_Status",
                "Freeze_Status",
                "Frostbite_Status",
                "Heartbroken_Status",
                "Heat_Wave_Status",
                "Hypothermia_Status",
                "Injury_Status",
                "Malices_Mark",
                "Necropoison_Status",
                "Paralyze_Status",
                "Poison_Status",
                "Radiation_Status",
                "Scared_Bear_Status",
                "Scared_Status",
                "Shock_Status",
                "Shredded_Wings",
                "Sickly_Status",
                "Slow_Status",
                "Sticky_Teeth_Status",
                "Sticky_Trap_Status",
                "Stolen_Speed_Status",
                "Torn_Ligaments_Status",
                "Water_Gale_Status",
              ]}
            />
            <p className="hint">
              <strong>Permanent weather is exempt.</strong> The weather
              cataclysms — <code>Acid_Rain_Status</code>,{" "}
              <code>Heat_Wave_Status</code>, <code>Hypothermia_Status</code>{" "}
              (and the Storming marker) — are seeded once at fight start as{" "}
              <code>no_decay</code> environmental statuses and are{" "}
              <strong>NOT</strong> removed by <code>cleanse</code> / Fortify,
              even though their type is negative (the Fortify-immunity gate
              still blocks them by type). Only an <em>ability-applied</em>{" "}
              (decaying) instance of Heat Wave / Hypothermia is cleansable;{" "}
              Acid Rain only ever exists as the permanent weather instance, so
              it is never cleansed.
            </p>
          </li>
          <li>
            <code>dispel &lt;side&gt;</code> — removes <strong>every</strong>{" "}
            status, including non-fortify-removable ones. Use sparingly.
          </li>
        </ul>

        <Subhead>deal_typed_damage routing</Subhead>
        <ul>
          <li>
            <code>bite</code> — multiplied by{" "}
            <code>damage_taken_multiplier_on_being_bitten</code>. Subject
            to all bite-resistance mechanics.
          </li>
          <li>
            <code>breath</code> — multiplied by{" "}
            <code>(1 − clamp(breath_resistance, 0, 1))</code>.
          </li>
          <li>
            <code>true</code> — bypasses bite/breath resistance. Only the
            <code>unbreakable_damage_cap_pct</code> still applies.
          </li>
        </ul>
        <p className="hint">
          Plain <code>deal X to side</code> (the most common form) is
          equivalent to <code>true</code> typed damage — it skips
          resistance routing entirely. Use <code>deal_typed</code>{" "}
          when you specifically want resistance / vulnerability to apply.
        </p>

        <Subhead>detonate / consume_status_for_damage</Subhead>
        <p>
          <code>detonate &lt;side&gt; &lt;Status&gt; @ &lt;Expr&gt;</code>{" "}
          removes the status and deals{" "}
          <code>stacks × Expr</code> as <strong>true damage</strong> —
          bypassing bite/breath resistance, only the unbreakable damage
          cap applies. If the status doesn't exist on the target, it's a
          silent no-op (0 stacks → 0 damage).
        </p>

        <Subhead>Stat modifier composition</Subhead>
        <p>
          Effective stat = <code>base × (∏ mul) + (∑ add)</code>. Modifiers
          are <strong>sourced by the firing ability id</strong>, so each
          ability keeps its own <code>mul</code> / <code>add</code> slot per
          field: every unexpired <code>mul</code> from every source
          multiplies together, every <code>add</code> sums. Re-applying from
          the <em>same</em> ability refreshes that ability's own slot (no
          self-stacking), but two <em>different</em> abilities both doing{" "}
          <code>modify_stat damage mul 1.5</code> compound to{" "}
          <code>base × 2.25</code>. <code>set</code> overrides everything
          (and among multiple <code>set</code> sources the one with the
          latest expiry wins). <code>duration_sec: 0</code> means{" "}
          <em>permanent for the fight</em> (never expires). See{" "}
          <em>Stacking across abilities</em> under Vocabulary for the same
          rule from the authoring side.
        </p>

        <Subhead>Status mechanics</Subhead>
        <ul>
          <li>
            <code>apply &lt;Status&gt; xN to &lt;side&gt;</code> with{" "}
            <code>N ≤ 0</code> is a no-op (won't lower stacks — use{" "}
            <code>modify_status</code> for that).
          </li>
          <li>
            Applying an unknown status_id is silently accepted — the
            status will exist on that side with the given stacks. Useful
            for custom flag-statuses that you read via{" "}
            <code>self.status.&lt;id&gt;.stacks</code>.
          </li>
          <li>
            <code>extend &lt;side&gt; &lt;Status&gt; &lt;secs&gt;</code>{" "}
            adds seconds to the status's remaining-time without
            changing stacks. No-op if status absent.
          </li>
          <li>
            Status decay is event-driven: stacks tick down based on the
            game's per-status decay rules. Custom statuses default to no
            decay unless they match a built-in id.
          </li>
        </ul>

        <Subhead>chance() RNG</Subhead>
        <p>
          <code>chance &lt;p&gt;</code> uses a deterministic LCG seeded
          from <code>(time × 1_000_000 + caster.extras_count)</code>.
          Seeded per-call, not per-fight. The same{" "}
          <em>(time, extras snapshot)</em> always produces the same roll{" "}
          — so two abilities both using <code>chance(0.5)</code> at
          identical times will agree (or both fire / both skip). Useful
          property for testing; not a true randomness source.
        </p>

        <Subhead>Determinism guarantees</Subhead>
        <p>
          The engine is deterministic across runs given identical inputs.
          The Compare runtime relies on this — same creatures, same
          policies, same custom abilities ⇒ byte-identical fight log.
          The only "randomness" is the seeded LCG above.
        </p>

        <Subhead>What fires when the caster is dead</Subhead>
        <ul>
          <li>
            <code>on_take_damage</code> <strong>fires on the killing blow</strong>{" "}
            — damage is calculated pre-death, so reactive triggers like
            "deal 50% back" still apply.
          </li>
          <li>
            <code>on_kill</code> fires on the side that delivered the
            killing blow.
          </li>
          <li>
            <code>schedule</code> entries persist across death — a
            scheduled effect fires when its due-time arrives, even if the
            caster died before then. This can resurrect a dead side
            briefly via heal / set_hp, depending on engine bookkeeping.
          </li>
          <li>
            Active firing (<code>on_fire</code>) and{" "}
            <code>on_tick</code> stop on death.
          </li>
        </ul>

        <Subhead>Per-side state isolation</Subhead>
        <p>
          Every <code>self.X</code> path resolves against the side that
          owns the ability. <code>opp.X</code> resolves against the
          opponent. This is true for every reader path:{" "}
          <code>self.extras.<em>k</em></code>,{" "}
          <code>self.cooldown_remaining.<em>id</em></code>,{" "}
          <code>self.fired_count.<em>id</em></code>, etc.
        </p>
        <p>
          <code>set_extra opp &lt;key&gt; = …</code> writes to the
          opponent's extras — useful for "tag" patterns where one ability
          marks the opponent and another reads the mark.
        </p>

        <Subhead>extras.X (state-level) vs self.extras.X (per-side)</Subhead>
        <p>
          The engine has TWO extras maps that read similarly but live
          in different places. Knowing which one you're touching matters
          for cross-side patterns:
        </p>
        <ul>
          <li>
            <strong><code>self.extras.&lt;key&gt;</code> /{" "}
            <code>self.extra.&lt;key&gt;</code></strong> — PER-SIDE map,
            stored on <code>CombatSide.user_extras</code>. Written by{" "}
            <code>set_extra self &lt;key&gt;</code> /{" "}
            <code>inc_extra self &lt;key&gt;</code> /{" "}
            <code>push_extra self &lt;key&gt;</code>. Lives across the
            entire fight on that side; survives <code>snapshot</code> /{" "}
            <code>restore</code>. The plural and singular spellings
            (<code>extras</code> / <code>extra</code>) are aliases —
            engine accepts both reads.
          </li>
          <li>
            <strong><code>extras.&lt;key&gt;</code></strong> (no side
            prefix) — STATE-LEVEL map, populated by the engine itself
            during dispatch: <code>event.damage_taken</code>,{" "}
            <code>event.tick_index</code>, scaling table entries, etc.
            User effects CAN'T write here. Read-only from the spec's
            perspective.
          </li>
        </ul>
        <p className="hint">
          <strong>One-shot extras keys.</strong> A few keys on{" "}
          <code>self.user_extras</code> are read by the engine and{" "}
          <em>cleared on read</em>:
        </p>
        <ul>
          <li>
            <code>damage_override</code> — set inside{" "}
            <code>on_before_take_damage</code> /{" "}
            <code>on_before_deal_damage</code> to replace the engine's
            damage amount. Cleared after read so a stale value from a
            prior damage event can't leak in.
          </li>
          <li>
            <code>next_hit_floor</code> — set by <code>interrupt</code>{" "}
            to push the next bite's time forward.
          </li>
          <li>
            <code>breath_consume_pending</code> /{" "}
            <code>breath_restore_pending</code> — set by{" "}
            <code>consume_breath</code> / <code>restore_breath</code>.
          </li>
        </ul>

        <Subhead>Validation rules — what makes a spec invalid</Subhead>
        <ul>
          <li>
            <code>id</code> must start with <code>user.</code>.
          </li>
          <li>
            <code>display_name</code> must be non-empty.
          </li>
          <li>
            At least one of <code>on_fire</code> /{" "}
            <code>on_round_start</code> / any trigger hook must be
            present (a spec with <em>only</em> decision exprs but no
            firing path validates as a passive that does nothing).
          </li>
          <li>
            Unknown <code>timing_user_override</code> id is rejected.
          </li>
          <li>
            <code>repeat</code> count must be positive integer; 0 or
            negative is rejected pre-engine.
          </li>
          <li>
            Custom <code>UserTimingSpec</code>: <code>candidates</code>{" "}
            must be non-empty; <code>horizon_sec</code> must be ≥ 1.
          </li>
        </ul>

        <Subhead>Silent no-ops (no error, no effect)</Subhead>
        <p>
          The engine deliberately swallows several edge cases rather
          than throwing. Use this list as a debugging checklist when an
          effect doesn't fire as expected:
        </p>
        <ul>
          <li><code>apply</code> unknown status to a side — silently creates the status entry with the given stacks (works as a "tag").</li>
          <li><code>apply</code> with stacks ≤ 0 — no-op.</li>
          <li><code>clear</code> a status that isn't there — no-op.</li>
          <li><code>extend</code> a status that isn't there — no-op.</li>
          <li><code>detonate</code> a status that isn't there — 0 damage.</li>
          <li><code>heal</code> exceeding max HP — clamps to max.</li>
          <li><code>set_hp</code> outside [0, max] — clamped.</li>
          <li><code>trigger</code> unknown ability_id — no-op.</li>
          <li><code>cooldown_reset</code> for unknown id — no-op.</li>
          <li><code>restore</code> from a key never snapshotted — no-op.</li>
          <li><code>schedule</code> with delay &gt; 600s — clamped to 600s.</li>
          <li>34th queued <code>schedule</code> entry per side — pushes oldest entry off the queue.</li>
        </ul>

        <Subhead>Built-in abilities — what each one does</Subhead>
        <p>
          Knowing what the built-ins do is essential when reading their
          cooldown / fired_count via expression paths.
        </p>
        <ul>
          <li>
            <code>fortify</code> — temporary status-cleanse + buff.{" "}
            <code>cooldown_remaining.fortify</code> reads when it can next fire.
          </li>
          <li>
            <code>life_leech</code> — passive heal-from-damage-dealt.
          </li>
          <li>
            <code>adrenaline</code> — temporary damage / cooldown buff
            below an HP threshold.
          </li>
          <li>
            <code>cocoon</code> — temporary high-HP shell.
          </li>
          <li>
            <code>reflect</code> — passive return-damage on bite.
          </li>
          <li>
            <code>hunker</code> — temporary damage-taken reduction.
          </li>
          <li>
            <code>hunters_curse</code> — applies a bleeding/marker on
            opponent.
          </li>
          <li>
            <code>rewind</code> — reverts HP to a snapshot.
          </li>
          <li>
            <code>unbridled_rage</code> — high-damage burst with
            self-cost.
          </li>
          <li>
            <code>wardens_rage</code> — warden-specific rage form.
          </li>
        </ul>

        <Subhead>TickTrigger timing</Subhead>
        <p>
          <code>on_tick &lt;secs&gt;</code> fires at{" "}
          <code>t = interval_sec, 2 × interval_sec, 3 × interval_sec, …</code>
          (not at <code>t = 0</code> — use <code>on_round_start</code> for
          that). Fires stop on caster death.{" "}
          <code>event.tick_index</code> is 0-based across all fires that
          have happened in this fight. Intervals below 0.05s are clamped
          upward.
        </p>

        <Subhead>time vs delay vs interval</Subhead>
        <ul>
          <li><code>time</code> — sim seconds since fight start (continuous).</li>
          <li><code>candidates</code> in a UserTimingSpec — relative delays the policy considers from "now" (each value &gt;= 0).</li>
          <li><code>schedule N</code> — fires the body N seconds from now (sim time, not real time).</li>
          <li><code>interrupt opp K</code> — pushes opp's next bite forward by K sim-seconds.</li>
          <li><code>cooldown self id for K</code> — sets <code>cooldown_until = time + K</code>.</li>
        </ul>
      </Section>

      <Section title="Working with custom timings end-to-end">
        <p>
          Custom timings are reusable decision profiles. They live in
          their own registry (<em>Custom &gt; Timings</em>) and can be
          plugged in at <strong>three levels</strong>:
        </p>

        <Subhead>1. As the spec's permanent timing</Subhead>
        <p>
          In the ability editor, the <code>Timing</code> dropdown
          shows your registered custom timings under "Your custom
          timings". Picking one writes{" "}
          <code>timing_user_override: "user.&lt;id&gt;"</code> to the
          spec. This is the canonical way: the ability uses that timing
          across every Compare / Best Builds run.
        </p>

        <Subhead>2. As a per-fight Compare override</Subhead>
        <p>
          The <em>Compare &gt; Battle Settings &gt; Custom-ability
          per-fight timing</em> panel lets you pin a different timing
          for THIS matchup without editing the spec. Useful for A/B
          testing two policies on the same ability. Per-creature, per-side.
        </p>
        <Code>{`Resolution priority (engine-side):
  1. Compare-time runtime override   ← per-fight, no spec edit
  2. spec.timing_user_override       ← persisted on the spec
  3. spec.timing_mode_override       ← built-in mode on the spec
  4. session default (Compare's "Ability timing mode")
A stale user-timing id at any level falls through to the next.
The ability never silently disables.`}</Code>

        <Subhead>3. As a built-in mode override</Subhead>
        <p>
          The same per-fight panel also accepts built-in modes
          (really_fast / fast / semi_ideal / ideal / extreme) — pick
          one to override an ability's spec-level timing for this
          matchup with a built-in mode instead of a custom one.
        </p>

        <Subhead>Where the panel pulls data from</Subhead>
        <ul>
          <li>
            <strong>Rows</strong>: the panel shows one row per user
            ability attached to each creature (creature.userAbilityIds).
            If neither creature has any user abilities attached, the
            panel shows <em>none attached</em>.
          </li>
          <li>
            <strong>Override values</strong>: the dropdown shows{" "}
            <em>Spec default</em>, every built-in mode, and every custom
            timing currently registered. Live-updated when you create a
            new timing in another tab.
          </li>
          <li>
            <strong>Stale handling</strong>: if you delete a custom
            timing that's referenced by an active override, the engine
            falls through to the spec's own default — no error.
          </li>
        </ul>

        <Subhead>Best Builds</Subhead>
        <p>
          User abilities attached to a creature also work in Best Builds
          via the spec's own timing. Per-fight overrides are
          Compare-specific (Best Builds runs many builds per matchup —
          per-fight tuning isn't surfaced). To experiment with timings
          at scale, edit the spec or create a clone with a different
          timing.
        </p>
      </Section>

      <Section title="Compare's per-fight timing panel — full walkthrough">
        <p className="hint">
          Where: <code>Compare &gt; Battle Settings &gt; Custom-ability
          per-fight timing</code> (collapsible). Visible only after at
          least one creature in the matchup has a custom ability
          attached; otherwise it shows <em>none attached</em>.
        </p>

        <Subhead>What each part shows</Subhead>
        <ul>
          <li>
            <strong>Header counter</strong>:{" "}
            <code>N active</code> = how many overrides are currently
            non-default across both sides. <code>none attached</code>{" "}
            means neither creature has any user abilities — there's
            nothing to override.
          </li>
          <li>
            <strong>Two columns</strong>: Creature A (left) and Creature
            B (right). Each column lists the user abilities attached to
            that side.
          </li>
          <li>
            <strong>Per-row caption</strong>: the <code>user.&lt;id&gt;</code>{" "}
            and a hint about what timing the spec uses by default
            ("Spec uses custom timing: ...", "Spec uses built-in: ...",
            or "Spec uses session default."). Useful sanity check —
            you'll see immediately if the spec is using something
            you don't expect.
          </li>
          <li>
            <strong>Status badge</strong>: <em>Spec default</em> /
            <em>Built-in</em> / <em>Custom timing</em> — what the
            current override resolves to.
          </li>
          <li>
            <strong>Reset Side</strong> button: clears all overrides on
            that column.
          </li>
        </ul>

        <Subhead>What the dropdown does</Subhead>
        <ul>
          <li>
            <strong>Spec default (no override)</strong>: removes the row's
            entry from the override map. The engine falls through to{" "}
            <code>spec.timing_user_override</code> /{" "}
            <code>spec.timing_mode_override</code> / session default
            in that order.
          </li>
          <li>
            <strong>Built-in modes</strong>: pin to <code>really_fast</code>,{" "}
            <code>fast</code>, <code>semi_ideal</code>,{" "}
            <code>ideal</code>, or <code>extreme</code>. The engine
            uses that mode for THIS matchup only — the spec is
            untouched.
          </li>
          <li>
            <strong>Your custom timings</strong>: pin to any timing
            you've registered under <code>Custom &gt; Timings</code>.
            Live-updates: a new timing appears in the dropdown
            immediately, no tab reload.
          </li>
        </ul>

        <Subhead>Stale-id behaviour</Subhead>
        <p>
          If you delete a custom timing that's currently referenced by
          an override, the engine silently falls back to the spec's
          defaults — your sim still runs. The dropdown will keep showing
          the deleted id as a custom-mode entry until you change it (the
          select preserves the saved value even if the option went
          away). Just pick a different option to update.
        </p>

        <Subhead>How it's wired through to the engine</Subhead>
        <Code>{`Compare panel → ComparePage state (per-side override map)
                → useCompareSimulation hook
                → trySimulateRustCompareMatchup
                → Rust AbilityPolicyOverrides.userAbilityOverrides
                → dispatch_user_actives_for_caster checks override map
                  before consulting spec defaults`}</Code>
        <p className="hint">
          The override map is keyed by the user.&lt;id&gt; on the
          attacker (or defender). Built-in abilities use a different,
          older override panel above this one — they're keyed by display
          name, not id, and only accept built-in modes.
        </p>
      </Section>

      <Section title="Timing examples — five real scenarios">
        <p className="hint">
          These are written in code form; you can paste them into the
          Code-mode textarea of the timing editor. The visual editor
          builds the same shapes via the strategy + condition
          dropdowns.
        </p>

        <Subhead>1. Cast on cooldown (no future-look)</Subhead>
        <Code>{`timing user.always_when_ready "Always when ready"
  candidates: 0
  horizon: 1
  threshold: 0
  force_fire: 1`}</Code>
        <p className="hint">
          Visual editor: pick <em>Always when ready</em> strategy.
          Use case: damage cooldowns where any positive utility ⇒ fire.
          Equivalent to <code>really_fast</code> but stronger — bypasses
          even the utility check.
        </p>

        <Subhead>2. Fire only when self HP is low (defensive)</Subhead>
        <Code>{`timing user.below_30_hp "Self HP &lt; 30%"
  candidates: 0
  horizon: 2
  threshold: 0
  force_fire: self.hp_ratio &lt; 0.3`}</Code>
        <p className="hint">
          Visual editor: <em>Conditional</em> strategy + the{" "}
          <em>self HP &lt; 30%</em> palette tile. Use case: emergency
          heal that should only fire when actually needed.
        </p>

        <Subhead>3. Execute window — wait for opp to be low</Subhead>
        <Code>{`timing user.execute_window "Opp HP &lt; 25%"
  candidates: 0
  horizon: 1
  threshold: 0
  force_fire: opp.hp_ratio &lt; 0.25`}</Code>
        <p className="hint">
          Useful for finishers. Combine with high-damage on_fire
          (e.g. deal opp.hp * 0.5) for a true execute pattern.
        </p>

        <Subhead>4. Hybrid: future-look with low-HP override</Subhead>
        <Code>{`timing user.emergency_with_planning "Emergency override + plan"
  candidates: 0, 0.5, 1, 2, 5
  horizon: 12
  threshold: 0.001
  force_fire: self.hp_ratio &lt; 0.15`}</Code>
        <p className="hint">
          Normal future-look planning, but if HP drops below 15%, fire
          immediately regardless of utility. Models "panic button" style
          play: optimal when stable, reactive when in trouble.
        </p>

        <Subhead>5. Skip while comfortable, score when in danger</Subhead>
        <Code>{`timing user.defensive_score "Score only when needed"
  candidates: 0, 0.5, 1, 2
  horizon: 8
  threshold: 0.001
  force_skip: self.hp_ratio &gt; 0.7`}</Code>
        <p className="hint">
          Inverse of #2 — actively SKIP while caster's HP is &gt; 70%,
          then let the utility integral pick a moment once HP falls.
          Saves the ability for when it matters.
        </p>
      </Section>

      <Section title="Troubleshooting — why isn't my ability firing?">
        <p className="hint">
          Run through this checklist before suspecting an engine bug.
          90% of "ability not firing" reports trace to one of these.
        </p>

        <Subhead>1. Saved? Check the Registered list</Subhead>
        <p>
          <code>Custom &gt; Abilities &gt; Registered (N)</code>. If
          your ability isn't there, the save didn't go through. Most
          common reason: the <strong>+ Add to library</strong> button
          was disabled because of validation errors (empty
          display_name, id missing the <code>user.</code> prefix). Fix
          the banner that appears above the editor and try again.
        </p>

        <Subhead>2. Attached? Check the creature's selected list</Subhead>
        <p>
          <code>Custom &gt; Creatures &gt; Edit creature &gt; Supported
          abilities &gt; Selected abilities</code>. Your ability should
          appear there with a "Custom" chip. If not, find it in the
          picker (filter by <strong>Custom</strong>) and click <strong>Add</strong>,
          then save the creature.
        </p>

        <Subhead>3. Available? Check the available expression</Subhead>
        <p>
          The most subtle gotcha: <code>is_available</code> evaluates
          to 0 ⇒ ability gated out. Common mistake:{" "}
          <code>self.cooldown_remaining.user.x &lt;= 0</code> spelled
          with a different id, or <code>opp.hp_ratio &lt; threshold</code>{" "}
          with a value the matchup never reaches. Use <em>Live preview</em>{" "}
          in the editor to confirm the ability fires against a known
          opponent.
        </p>

        <Subhead>4. Timing? Check the resolution priority</Subhead>
        <Code>{`Resolution priority for user-ability timing:
  1. Compare-time runtime override   ← per-fight (Compare panel)
  2. spec.timing_user_override       ← persisted custom policy
  3. spec.timing_mode_override       ← persisted built-in mode
  4. Session default ("Ability timing mode" in Compare)`}</Code>
        <p className="hint">
          A custom timing with <code>force_skip: 1</code> silences the
          ability entirely. A timing with <code>candidates: [0]</code>{" "}
          and <code>force_fire: 1</code> always fires.
        </p>

        <Subhead>4a. force_fire bypasses is_available</Subhead>
        <p>
          Subtle gotcha: a UserTimingSpec's <code>force_fire</code> Expr
          is consulted by the policy <strong>before</strong>{" "}
          <code>is_available</code>. So a timing with{" "}
          <code>force_fire: 1</code> will fire the ability even when{" "}
          <code>is_available</code> on the spec evaluates to 0 (e.g.
          ability is on cooldown, or under your own threshold gate).
          Use <code>force_fire</code> as an <em>"override the gate"</em>
          {" "}signal — not as a casual fallback.
        </p>
        <p className="hint">
          Practical implication: if you want "always fire when
          AVAILABLE", don't use <code>force_fire: 1</code>. Instead set{" "}
          <code>candidates: [0]</code>, <code>threshold: 0</code>,
          and let the policy fall through to the regular utility +
          available-gate path. <code>force_fire: 1</code> is the
          "I really mean it, fire NOW regardless" hammer.
        </p>

        <Subhead>5. Built-in eligibility blocks the matchup</Subhead>
        <p>
          The Rust runtime rejects matchups containing
          unmodeled-built-in abilities (e.g. some passives mark a
          matchup ineligible). The Compare TS path will fall back to
          its own simulator OR show <em>Compare matchup ineligible</em>.
          Workaround: pick a creature pair where both sides are
          fully Rust-modeled (most modern creatures are).
        </p>

        <Subhead>6. Live preview shows "Skipped — bridge stale"</Subhead>
        <p>
          Means the WASM bundle predates user-ability support. Run{" "}
          <code>npm run rust:build</code> at the repo root to refresh,
          then reload the page.
        </p>

        <Subhead>7. Effect block fires but doesn't seem to do anything</Subhead>
        <p>
          Several effect kinds silently no-op when input is invalid —
          see <em>Silent no-ops</em> in <em>Engine semantics</em>{" "}
          above. Examples: <code>apply x 0</code>, <code>clear</code>{" "}
          a status that isn't there, <code>trigger</code> an unknown
          ability id.
        </p>

        <Subhead>8. Combat log says "fired" but HP didn't change</Subhead>
        <p>
          Possible causes: <code>unbreakable_damage_cap_pct</code> on
          the target trimmed the damage; the target is in a status
          immune phase; reflect mechanics returned damage to the
          caster. Enable <em>Debug mode</em> in Compare to see per-tick
          damage routing.
        </p>

        <Subhead>9. Pre-damage shield (A13) doesn't seem to absorb</Subhead>
        <ul>
          <li>
            <strong>All sources now route (Phase 4 / G3).</strong> Bite,
            breath, DOT, lance, trails, reflux, and reflected self-damage
            all fire <code>on_before_take_damage</code>, so a shield that
            absorbs "up to N" applies to each. If you meant to shield only
            one kind, gate on <code>event.is_bite</code> /{" "}
            <code>event.is_breath</code> / <code>event.is_dot</code> inside
            the hook. Note DOT is absorbed in aggregate per iteration, not
            per individual tick.
          </li>
          <li>
            <strong>Wrote the wrong key.</strong> The convention is{" "}
            <code>set_extra self damage_override = N</code> — no{" "}
            <code>event.</code> prefix, no other namespace. Check the
            visual editor's <code>set_extra</code> block name field.
          </li>
          <li>
            <strong>Override is negative.</strong> Negative values clamp
            to 0 — that turns the hit into a full absorb, which is
            usually what you want. But if you wrote{" "}
            <code>damage_override = self.hp - 100</code> intending "leave
            100 HP" and HP is below 100, the override becomes negative →
            0 damage. Use <code>max(0, …)</code> or just write a
            positive amount directly.
          </li>
        </ul>

        <Subhead>10. Sliding-window (B2) gate never fires</Subhead>
        <ul>
          <li>
            <strong>Reading at a projected time.</strong> If your timing
            is <code>ideal</code> / <code>semi_ideal</code>, the policy
            projects state forward and reads the window at{" "}
            <em>future</em> time — the buffer doesn't contain projected
            events, so the sum is 0. Use <code>really_fast</code> /{" "}
            <code>fast</code>, or read{" "}
            <code>damage_taken_last.&lt;N&gt;</code> only inside a
            trigger (which uses current time, not projected).
          </li>
          <li>
            <strong>Source not bite.</strong> Bite damage only populates
            the sliding-window buffer.
          </li>
          <li>
            <strong>Window &gt; 30s.</strong> Engine keeps a 30s buffer.
            Longer windows return what's in the buffer (could be less
            than expected on a long fight).
          </li>
        </ul>

        <Subhead>11. Level override (A11) doesn't apply</Subhead>
        <ul>
          <li>
            <strong>Spec doesn't declare scaling for the key you read.</strong>
            <code> scaling.damage</code> returns 0.0 if{" "}
            <code>scaling</code> in the spec has no <code>damage</code>{" "}
            key. Add the row to the scaling table or use a fallback like{" "}
            <code>scaling.damage + 50</code>.
          </li>
          <li>
            <strong>Compare-time pick is out of range.</strong>{" "}
            Picking Lv 5 on a 3-level spec silently falls back to{" "}
            <code>default_level</code>. Check the spec's{" "}
            <code>levels</code> field.
          </li>
          <li>
            <strong>Best Builds doesn't read the per-fight picker.</strong>{" "}
            The picker only applies in Compare; Best Builds uses the spec's
            <code> default_level</code>. To test a different level at
            scale, edit the spec or clone it.
          </li>
        </ul>
      </Section>

      <Section title="Common patterns">
        <Subhead>Self-cooldown gating</Subhead>
        <p className="hint">
          Most active abilities want a cooldown that the policy
          respects. The pattern:
        </p>
        <Code>{`available: self.cooldown_remaining.<my-id> <= 0
on_fire:
  ...
  cooldown self <my-id> for <secs>`}</Code>

        <Subhead>HP-threshold ramping</Subhead>
        <p className="hint">
          Damage scales with how hurt the caster is.
        </p>
        <Code>{`# Dmg modifier 1× at full HP, 1.5× at 0 HP
modify_stat self damage mul (1 + (1 - self.hp_ratio) * 0.5) for 10`}</Code>

        <Subhead>Status-stack reading</Subhead>
        <Code>{`# Damage scales with own Vigor stacks
deal self.status.Vigor_Status.stacks * 50 to opp`}</Code>

        <Subhead>Determinism</Subhead>
        <p className="hint">
          The engine is deterministic. Same inputs ⇒ same output.
          The <code>chance</code> gate uses a seeded LCG for
          reproducible probability rolls.
        </p>
      </Section>
    </>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }): ReactNode {
  return (
    <section className="ce-docs-section">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

function Subhead({ children }: { children: ReactNode }): ReactNode {
  return <h4 className="ce-docs-subhead">{children}</h4>;
}

function Code({ children }: { children: string }): ReactNode {
  return <pre className="ce-docs-code">{children}</pre>;
}

/**
 * A code example with an optional one-click "Insert" button. When the
 * surrounding editor passes an `onInsert` handler (the Status editor does),
 * the button drops the snippet into the editor; otherwise the snippet is
 * shown read-only, exactly like a plain `<Code>` block.
 */
function InsertExample({
  snippet,
  onInsert,
}: {
  snippet: string;
  onInsert?: (snippet: string) => void;
}): ReactNode {
  return (
    <div className="ce-docs-example">
      <Code>{snippet}</Code>
      {onInsert ? (
        <button
          type="button"
          className="ce-btn ce-btn-ghost ce-docs-insert-btn"
          onClick={() => onInsert(snippet)}
          title="Replace the editor with this example"
        >
          ↧ Insert
        </button>
      ) : null}
    </div>
  );
}

/** Renders a list of identifier strings as a compact pill grid —
 * easier to scan than a comma-separated paragraph. */
function VocabGrid({
  items,
}: {
  items: ReadonlyArray<string>;
}): ReactNode {
  return (
    <div className="ce-docs-vocab-grid">
      {items.map((item) => (
        <code key={item} className="ce-docs-vocab-item">
          {item}
        </code>
      ))}
    </div>
  );
}
