# Effects Registry — Single Source of Truth

Every status effect in the game (Bleed, Muddy, Clean Water, Necropoison, …)
needs to answer the same set of questions: is it positive or negative? How
long does it last? Does it tick? How does it stack? Where can it come from?
What does it actually do? The effects registry is the one place that holds
those answers, and every consumer — UI pickers, the Compare buff toggles,
the Rust combat engine — reads from it instead of carrying its own copy.

## Pipeline

The registry is authored once in TypeScript and projected into Rust by a
codegen step:

```
src/pages/referenceContent.ts   (STATUS_REFERENCE_DRAFTS — prose spec)
src/engine/statusCatalog.ts     (NAME_TO_ENGINE_ID + NAME_TO_EFFECT_META)
        │
        │   npm run gen:registry   (scripts/gen_effects_registry.ts)
        ▼
wasm-engine/src/effects_registry.rs   (generated lookup functions)
```

`statusCatalog.ts` is the source of truth. It joins three hand-authored
inputs into one ordered `STATUS_CATALOG`:

1. **`STATUS_REFERENCE_DRAFTS`** (in `referenceContent.ts`) — the prose
   spec: display name, `Modeled`/`Partial` status, one-line summary, and a
   mechanics bullet list. This is the project's mini-wiki and the
   test-backed spec the engine is written against. Only entries marked
   `Modeled` or `Partial` enter the catalog; anything the engine can't
   simulate is deliberately excluded so the UI never offers it.
2. **`NAME_TO_ENGINE_ID`** — maps each Reference display name (`"Bleed"`)
   to the engine status id (`"Bleed_Status"`). The id is stable and safe to
   persist across sessions; the display name tracks the Reference catalog.
3. **`NAME_TO_EFFECT_META`** — the structured, machine-readable companion to
   the prose: polarity, category, timing, stack rule, effect shape, and
   apply sources.

`buildCatalog()` walks `STATUS_REFERENCE_DRAFTS`, looks up each entry's
engine id and effect meta, and emits a `StatusCatalogEntry`. A Reference
entry missing from `NAME_TO_ENGINE_ID` is a wiring bug and is skipped with a
dev-console warning. An entry missing from `NAME_TO_EFFECT_META` falls back
to a conservative neutral default (also warned), so the catalog always
builds rather than hard-failing while prose moves ahead of meta backfill.

### Why codegen into Rust

The combat engine is Rust compiled to WASM; the catalog is TypeScript. Three
shapes were possible for keeping Rust in sync: a runtime-loaded JSON blob, a
hand-mirrored Rust table guarded by a drift test, or codegen. The registry
uses **codegen** because it gives zero drift by construction — the Rust file
is a deterministic projection of the TS catalog — while keeping the Rust
side fully static (plain `match` arms usable in `const`-ish contexts, no
runtime parse cost, no dynamic registry). The generated file is reviewable
as a normal Rust diff even when only data changed.

`scripts/gen_effects_registry.ts` imports `STATUS_CATALOG`, emits the Rust
module, and writes it to `wasm-engine/src/effects_registry.rs`. The
generated file is committed to the repo so CI does not have to run codegen
during the build.

### Drift gate

`generateRegistryRustSource()` is a pure function (no filesystem
side-effects when imported). The vitest suite
`src/engine/effectsRegistryDrift.test.ts` re-runs it and compares the result
against the committed `effects_registry.rs` (normalizing line endings). If
someone edits the TS catalog but forgets to run `npm run gen:registry`, the
test fails with a hint to regenerate. This makes the generated file's
freshness a CI invariant.

## Data shapes

### `StatusCatalogEntry`

The entry every TypeScript consumer reads:

```ts
type StatusCatalogEntry = {
  // --- identity ---
  id: string;                          // engine status id, e.g. "Bleed_Status"
  name: string;                        // Reference display name, e.g. "Bleed"
  referenceStatus: "Modeled" | "Partial";

  // --- prose (from STATUS_REFERENCE_DRAFTS) ---
  summary: string;                     // one-liner
  mechanics: string[];                 // full bullet list

  // --- classification (from NAME_TO_EFFECT_META) ---
  polarity: EffectPolarity;            // positive | negative | neutral
  category: EffectCategory;
  displayGroup?: string;               // optional UI grouping, e.g. "compare_temp_buff"

  // --- timing ---
  defaultDurationSec: number | null;   // fixed lifetime; null = per-stack decay
  defaultTickSec: number | null;       // DoT / heal tick interval; null = no tick
  defaultMaxStacks: number | null;     // stack cap; null = unbounded
  stackRule: EffectStackRule;          // stacking | non_stacking | unique

  // --- effect content ---
  effect: EffectShape;                 // machine-readable behaviour

  // --- sources ---
  sources: EffectSource[];             // where this effect can originate
};
```

### `EffectMeta`

The hand-curated structured half (one row per status in
`NAME_TO_EFFECT_META`). It carries exactly the classification, timing,
effect, and source fields above; `buildCatalog()` merges it with the
identity and prose fields to produce the full `StatusCatalogEntry`.

### Vocabularies

**Polarity** — `"positive" | "negative" | "neutral"`. Drives Yolk Bomb
SELF/ENEMY routing, Fortify cleanse eligibility (negative statuses are
removable), and UI colour. Niche routing cases are expressed by combining
polarity with `sources` plus engine-side logic rather than a richer enum.

**Category** — high-level grouping for filtering and display:

```
regen_buff | stat_buff | stat_debuff
dot_damage | tick_heal
control | ailment_meta | neutral_marker
```

**StackRule** — `"stacking"` (stacks accumulate, the default),
`"non_stacking"` (re-applying only refreshes duration), `"unique"` (single
instance, no stacks).

**EffectSource** — where an effect can come from. Picker visibility is
filtered on this:

```
compare_toggle      // surfaced in the Compare buff selection UI / battle settings
yolk_bomb_self      // Yolk Bomb self-buff routing
yolk_bomb_enemy     // Yolk Bomb enemy-debuff routing
lich_mark_payload   // Lich Mark payload dropdown
ability_apply       // any ability or breath that applies the status
plushie             // baked-in plushie effect
```

**EffectShape** — the machine-readable behaviour, a discriminated union on
`kind`:

```ts
type EffectShape =
  | { kind: "stat_modifier"; mods: Partial<Record<string, number>>;
      opStyle: "add_pct" | "mult" | "add_flat" | "per_stack_pct" }
  | { kind: "dot_damage"; damagePerStackPerTick: number }
  | { kind: "tick_heal"; healPerStackPerTick: number; healUnit?: "flat" | "pct_max_hp" }
  | { kind: "control"; disables: string[] }
  | { kind: "meta_marker" }
  | { kind: "composite"; parts: EffectShape[] };
```

`stat_modifier` covers flat and per-stack stat changes — e.g. Muddy is
`{ healthRegenPct: 25, opStyle: "add_pct" }`, Disease is
`{ healthRegenPct: -15, opStyle: "per_stack_pct" }`. `composite` pairs
several shapes — e.g. Bleed combines a `dot_damage` tick with a `-100%`
regen `stat_modifier`. `meta_marker` is for statuses whose effect the engine
reads from stack count directly (Bad Omen's end-of-duration random follow-up,
Necropoison's ability-disable at 10+ stacks, Sticky Teeth) — the catalog
records that the status exists and its timing/polarity, and bespoke engine
code handles the rest.

## Generated Rust surface

`effects_registry.rs` exposes the catalog as a set of pure lookup functions
keyed on the engine status id. Each returns `Option<T>`; statuses without a
registry row return `None`, and the caller falls back to engine-side
defaults.

```rust
pub enum Polarity  { Positive, Negative, Neutral }
pub enum Category  { RegenBuff, StatBuff, StatDebuff, DotDamage,
                     TickHeal, Control, AilmentMeta, NeutralMarker }
pub enum StackRule { Stacking, NonStacking, Unique }

pub fn polarity(status_id: &str)                     -> Option<Polarity>;
pub fn category(status_id: &str)                     -> Option<Category>;
pub fn stack_rule(status_id: &str)                   -> Option<StackRule>;
pub fn default_duration_sec(status_id: &str)         -> Option<f64>;
pub fn default_tick_sec(status_id: &str)             -> Option<f64>;
pub fn default_max_stacks(status_id: &str)           -> Option<f64>;
pub fn regen_modifier_pct(status_id: &str)           -> Option<f64>;  // flat add_pct
pub fn regen_modifier_per_stack_pct(status_id: &str) -> Option<f64>;  // per_stack_pct
pub fn is_known(status_id: &str)                     -> bool;
```

The two `regen_modifier_*` functions are derived from the `EffectShape`:
codegen walks each entry's `effect` (recursing into `composite` parts) and
pulls out the `healthRegenPct` modifier for the matching `opStyle`. So the
regen math has one source — the catalog effect shape — rather than a
hand-maintained Rust constant.

## Consumers

### TypeScript

- **Status pickers** (Lich Mark payload, Yolk Bomb value, Custom Creatures)
  read `STATUS_CATALOG` and filter by `sources` and `polarity`. Yolk Bomb
  splits SELF vs ENEMY on polarity; Lich Mark shows entries with the
  `lich_mark_payload` source.
- **Lookups** — `lookupStatusEngineId(name)`, `lookupStatusEntry(name)`,
  `statusEngineIdMap()`, and `isCatalogedStatus(name)` give callers
  name→id resolution and membership checks (case-insensitive).
- **Compare buff toggles** read entries with the `compare_toggle` source;
  `displayGroup === "compare_temp_buff"` collects Muddy, Clean Water, and
  Refreshed under one StatCard regen row.

### Rust engine

The engine never hardcodes per-status timing or polarity; it consults the
generated registry:

- `statuses::status_tick_sec` → `default_tick_sec`
- `statuses::status_decay_sec` → `default_duration_sec` (falling back to the
  3-second engine baseline when `None`)
- `statuses::status_max_stacks` → `default_max_stacks`
- `statuses::is_fortify_removable_status` → `polarity == Negative`
- `combat.rs` regen multiplier → `regen_modifier_pct` and
  `regen_modifier_per_stack_pct`, composed multiplicatively across active
  statuses

User-defined statuses (the `user.`-namespaced parametric specs) are resolved
ahead of the registry on these same seams: each metadata lookup first checks
for a `user.` spec and only falls through to the generated catalog for
built-ins. This keeps the built-in hot path to a cheap prefix check.

## Adding or changing an effect

1. Add (or edit) the Reference entry in `referenceContent.ts` under
   `STATUS_REFERENCE_DRAFTS`, with `status: "Modeled" | "Partial"`.
2. Add one row to `NAME_TO_ENGINE_ID` mapping the display name to the
   engine `*_Status` id.
3. Add one row to `NAME_TO_EFFECT_META` with the structured fields.
4. Run `npm run gen:registry` and commit the regenerated
   `effects_registry.rs`.

The new effect then flows automatically into every picker (filtered by its
`sources`), the Compare toggles (if it carries `compare_toggle`), the regen
math, and the Rust timing/polarity lookups — without per-consumer edits. The
drift gate ensures the Rust projection cannot silently fall out of sync.

## Boundaries

A few effect classes live outside this registry by design:

- **Plushies** are build-time stat modifiers baked into the combatant's
  stats before crossing the WASM boundary, not in-fight statuses. They stay
  in their own `plushieBuildMappings.ts` system.
- **Custom Abilities DSL effects** have their own architecture.
- **Trail / Trap Compare-only effects** are gated separately and out of the
  combat model.
- **Posture / stance policy** lives in its own subsystem.

Reference prose stays hand-authored and is the arbiter when prose, machine
fields, and game-actual behaviour disagree. The registry's structured
metadata is the machine-readable companion to that prose, not a generated
view of it — there is no auto-generation of summaries or mechanics from the
effect shape.
