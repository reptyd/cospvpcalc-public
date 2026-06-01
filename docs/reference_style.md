# Reference style guide

`src/pages/referenceContent.ts` is dual-purpose: machine spec for the Rust engine and player-facing documentation. Every `mechanics` and `policyDifferences` bullet must read naturally and back a test. This guide lists the canonical phrasing for every claim type so writers can copy a template and fill in parameters instead of inventing prose.

This file is style only. The authoring workflow is: verify code first, then draft and seek approval.

---

## 1. Schema

| Array | Type | id prefix |
|---|---|---|
| `MODELED_ABILITY_REFERENCE_DRAFTS` | `AbilityReferenceEntry` | `ability_*` |
| `STATUS_REFERENCE_DRAFTS` | `StatusReferenceEntry` | `status_*` |
| `COMPARE_ONLY_REFERENCE_DRAFTS` | `AbilityReferenceEntry` | `compare_*` |
| `KNOWN_APPROXIMATION_REFERENCE_DRAFTS` | `ApproximationReferenceEntry` | `approx_*` |
| `ABILITY_POLICY_REFERENCE_DRAFTS` | `PolicyReferenceEntry` | `policy_*` |

Field rules:
- `id` — stable; generated once via `slugifyReferenceName(name)`. Tests bind to `id`. Never change after first commit.
- `name` — must match the canonical lookup key in `data/creatures.runtime.json` and `data/effects_catalog.runtime.v2.json`. Cosmetic edits to `name` (e.g. adding apostrophes) silently break ability detection.
- `status` — one of `Modeled` / `Partial` / `Out of model` / `Not modeled yet` / `Not planned` / `Disputed` / `Compare-only`.
- `summary` — one neutral, player-readable sentence.
- `mechanics: string[]` — atomic testable claims, one per bullet.
- `policyDifferences: string[]` — testable timing-policy claims (ability entries only).
- `notes: string[]` — non-testable: combat log mentions, modeling caveats, compare-only carve-outs.

---

## 2. Tone & voice

- Present simple, declarative. No future tense, no conditionals like "would" except inside policy descriptions.
- Active voice; passive only when the subject of action is irrelevant ("damage is reduced", "the cooldown is started").
- No emoji, no all-caps, no markdown inside string values.
- No contractions (`does not`, never `doesn't`; `cannot`, never `can't`).
- Modal verbs: only `can`, only for policy-dependent behavior.
- One claim per bullet. If you find yourself joining two facts with "and", consider splitting.

---

## 3. Actors and roles

Applies to ability entries (`MODELED_ABILITY_REFERENCE_DRAFTS`, `COMPARE_ONLY_REFERENCE_DRAFTS`). Status, plushie, approximation, and policy entries follow their own actor conventions and are out of scope for this section.

Use only the role names below. No synonyms.

| Role | Term | When to use |
|---|---|---|
| Owner of the ability being described | **the user** | Default for all abilities (active and passive). The HP/state belongs to *the user*. |
| Recipient of a directly-applied effect | **the target** | Ability fires at one specific opponent ("applies 10 stacks of Fear to the target", "deals 5% of the target's max HP"). |
| Other side, generic | **the opponent** | Used when the bullet is not pointed at a specific recipient ("the opponent's projected damage", "the opponent's max HP"). Use "the target" for specific recipients; "the opponent" for generic references. |
| Biter in a defensive-ability context | **the attacker** | Defensive ability fires when bitten; the attacker is the one who bit ("the attacker takes the reflected damage"). |

Banned synonyms: `the owner`, `the creature`, `the caster`, `the wielder`, `the holder`, `the defender`. Migrate any existing prose to the canonical term above.

Possessives: `the user's`, `the target's`, `the opponent's`, `the attacker's`. Never `they/them` or `he/she/it`.

You/your: never. The reference is third person.

---

## 4. Numbers and units

- **Time:** `X seconds`, `X second cooldown`, `X second window`. No `s` or `sec` abbreviation.
- **Percent:** `5%`. No space, no `%` written out as `percent` except in narrative (rare).
- **Multiplier:** `1.2x`, `0.5x`. Lower-case x, no asterisk (`*`) outside formulas.
- **Inline formulas:** `D_normal × (1 + 0.05 × bleed_stacks)`. Use `×` (Unicode multiplication sign) for math; reserve `*` for verbatim engine-formula reproduction. Define every variable in the same or adjacent bullet.
- **Stacks:** always include `stacks of` before the status name when applying. `"applies 10 stacks of Fear"`, `"applies 0.5 stacks of Corrosion"`, `"applies 1 stack of Disease"` — all use `stacks of` (or `stack of` for exactly 1).

---

## 5. Per-claim templates

Copy and fill in placeholders. If a claim type is not listed here, it is either out of scope or needs a new template — flag in PR.

### 5.1 Cooldown

| Variant | Template |
|---|---|
| Fixed | `"It has a X second cooldown."` |
| Scaling (subject to `active_cooldown_multiplier`) | `"Its base cooldown is X seconds."` |
| Named subject (first bullet of section, no preceding context) | `"<Ability> has a X second cooldown."` |
| Special breath cooldown replacing regen | `"It has a X second cooldown instead of normal breath regeneration."` |

Drift to fix:
- `"<Ability> has an X-second cooldown..."` (hyphen) → drop the hyphen.
- `"The ability has a X second cooldown..."` → use `"It has a X second cooldown."` if context is clear, else name the ability.

### 5.2 Active duration

`"<Ability> lasts for X seconds."`

Used for time-windowed actives (Adrenaline, Hunters Curse, Frost Nova, Reflect, etc.).

### 5.3 Startup delay / charge / arming

| Mechanic | Template |
|---|---|
| Auto-fire breath waiting before first damage tick | `"It has a X second startup delay before firing begins."` |
| Active that prepares then fires once | `"<Ability> starts with a X second charge."` |
| Window during which the next bite is special | `"When the cooldown is ready, <Ability> arms for X seconds."` |
| Single-shot prepare-then-impact | `"When it becomes available, it first arms for X seconds."` |

### 5.4 Tick rate (breath)

| Mechanic | Template |
|---|---|
| Damage breath | `"<Breath> deals damage 2 times per second while it is firing."` |
| Heal / cleanse / non-damage breath | `"<Breath> ticks 2 times per second while it is firing."` |

### 5.5 Capacity (breath)

| Mechanic | Template |
|---|---|
| Standard breath | `"<Breath> has capacity N."` |
| Auto-fire / no-regen breath | `"<Breath> has capacity N (N seconds of firing) and, once started, it continues firing until that capacity is emptied."` |

Capacity is in seconds of firing. The "1 unit per second of firing" drain rate is a global engine convention — do not repeat it per-entry.

### 5.6 Per-tick breath damage formula

Two-bullet pair, in order:

```
"Breath damage per tick is calculated as (((target max HP * ((attacker effective weight / defender effective weight) + 1)) / 2) / 100) * <perhit> * <crit_mult> * (1 - breath resistance).",
"That means the base of breath damage comes from the target's max HP, and then it is modified by the effective weight ratio, the breath's listed per-hit multiplier, pseudo-crits, and any breath resistance on the target.",
```

Variants:
- Add `* chain multiplier` between `<crit_mult>` and `(1 - breath resistance)` for breaths with a chain stacking mechanic. Define the chain ramp in a separate bullet.
- For "ignores weight / breath resistance" breaths (Heliolyth's Judgement), use a different formula bullet: `"Per-tick damage equals X% of the target's max HP."` and a follow-up bullet stating that weight scaling and breath resistance do not apply.

### 5.7 Activation gate / trigger

| Trigger type | Template |
|---|---|
| HP threshold (passive trail / step) | `"It activates while the user's current HP is at or below X% of max HP."` |
| HP threshold (auto-arming active like Self-Destruct) | `"<Ability> arms automatically while the user's HP is at or below X%."` |
| Cooldown-only (no other gate) | `"<Ability> arms automatically as soon as its cooldown elapses."` |
| On-hit (offensive) | `"<Ability> applies <Effect> when the user lands a direct hit."` |
| On-being-bitten (defensive) | `"<Ability> applies <Effect> when the user is bitten."` |
| Auto-active at fight start | `"<Ability> starts immediately at t=0 if actives are enabled."` |
| Always active passive | `"<Ability> is treated as always active in the current model."` |

### 5.8 While-active multiplier on user's stat

`"While <Ability> is active, the user's <stat> is multiplied by <N>x."`

Stat names to use as-is: `bite damage`, `bite cooldown`, `effective combat weight`, `passive health regeneration`, `bite damage multiplier`. The phrase `multiplied by Nx` is canonical. Avoid `increased to Nx` and `reduced to Nx` — they encode direction redundantly with the number.

### 5.9 Damage / multiplier scaling over a charge window

`"The <stat> bonus scales from 0% to the creature's <Ability> value over that X second charge."`

Example: Spite — bonus from 0% to value over 5 seconds.

### 5.10 Status apply

| Form | Template |
|---|---|
| Standard | `"<Subject> applies N stacks of <Status>."` (e.g. `"Cause Fear applies 10 stacks of Fear."`) |
| With recipient | `"<Subject> applies N stacks of <Status> to <recipient>."` |
| Periodic | `"While <Ability> is active, it applies N stacks of <Status> every X seconds."` |
| Per-tick | `"Each tick applies N stacks of <Status>."` (or `"to <recipient>"` if needed) |
| Side-effect on event | `"It also applies N stacks of <Status> on <event>."` (e.g. `"It also applies 10 stacks of Burn on explosion."`) |

`stacks of` is always present. Use `stack of` (singular) for exactly 1.

Capitalize status names exactly as in-game (TitleCase). Use the *display* name in player-facing prose: `Bleed`, `Bad Omen`, `Necropoison`, `Broken Bones`, `Slowed`. Do NOT use the engine id (`Bleed_Status`).

### 5.11 Heal

| Form | Template |
|---|---|
| Per-tick heal of breath | `"Each tick heals the user for X% of max HP."` |
| Lump heal at event boundary | `"A lump heal equal to X% of max HP is applied at <event>."` |
| Heal capped | `"The heal from <Ability> is capped at X% of the user's max HP."` |

### 5.12 Cleanse

| Form | Template |
|---|---|
| Per-tick fixed amount | `"Each tick also removes X stacks of removable negative statuses from the user."` |
| Priority order | `"That cleanse is not random. It works in a fixed order: A, B, C, then D."` |

### 5.13 HP cost / self-damage

`"When it is activated, the user immediately loses X% of its max HP."`

If a floor applies: `"The activation cost cannot drop the user below 1 HP."`

### 5.14 Negation / exclusion

`"<Ability> does not <action>."` — formal, declarative. Used in `mechanics` and `notes` alike. Common cases: "X does not boost breath damage", "X does not use a separate timing policy", "X does not reset on new bites".

`"<Ability> cannot <action>."` — capability-based, rare.

Avoid double negatives. Avoid contractions (`doesn't`, `can't`).

### 5.15 Cross-references

Rare and discouraged. Each entry should be self-contained as far as a reader can read it once. If you must reference another mechanic, name it directly: `"See the <Other Ability> entry."` Do not use "above" / "below" / "previously mentioned" — entries are not displayed in linear order.

---

## 6. Policy section

Canonical names, lowercase mid-sentence, capitalized at sentence start: `really fast`, `fast`, `semi-ideal`, `ideal`, `extreme`. Cover all five policies even when several share behavior (group with commas).

When the ability has no policy-dependent behavior:

```
"<Name> does not currently use a separate timing policy.",
"Once actives are enabled, it <…> automatically.",
```

When ReallyFast has its own rule (HP-gated, cost heuristics, etc.):

```
"Really fast <activation rule>.",
"Fast <heuristic rule>.",
"Semi-ideal, ideal, and extreme <projection rule>.",
```

### Pre-existing canonical phrases

- `activates as soon as it is available` — fires on cooldown immediately.
- `activates immediately when the creature is in a clearly losing fight` — precision-policy emergency activation.
- `can delay <Ability> to a better damage window instead of always using it immediately` — precision delay for offensive actives.
- `uses a simple efficiency rule before casting` — Fast policy heuristic intro.
- `uses projection-based timing` — precision-policy intro.

---

## 7. Notes templates

Every note must be **non-testable**. Move testable claims to `mechanics`.

| Note category | Template |
|---|---|
| Combat log mention | `"The timeline can show when <Ability> is activated."` |
| Combat log — periodic ticks | `"The timeline can show <Ability> damage ticks."` |
| Combat log — multi-channel | `"The timeline can show breath damage ticks and any applied modeled secondary effects."` |
| Pseudo-crit qualifier | `"<Breath> uses a X% pseudo-crit, so its crit multiplier is <N>x instead of random crit rolls."` |
| Zero crit qualifier | `"<Breath> has 0% crit, so its pseudo-crit multiplier is 1.0x."` |
| Listed secondaries | `"Its listed secondary effects are X at A% chance for B stacks and Y at C% chance for D stacks."` |
| Pseudo-proc note | `"Its listed secondary effects use pseudo-procs, but only Z is currently modeled, so that becomes E expected stacks per tick."` |
| All secondaries out of model | `"Its listed secondary effects are currently out of model."` |
| Modeling caveat | `"The model currently assumes …"` / `"… is a modeling choice and can be changed later if needed."` |
| Compare-only carve-out | `"In compare-only hunger mode, …"` / `"With the compare-only hunger rule on, …"` |

---

## 8. Canonical terminology

- `actives are enabled` / `actives are disabled` — never `actions`, never `abilities are on`.
- `bite damage`, `breath damage` — direct hits.
- `status damage over time` — never `DoT`, never `tick damage`.
- `weight-adjusted bite damage`, `effective combat weight`.
- `removable negative statuses`, `status immunity`.
- `the stand-and-fight combat model` (long form), `the model` (short).
- Status names exactly as in-game, TitleCase (`Bleed`, `Bad Omen`, `Necropoison`, `Broken Bones`, `Slowed`, `Shredded Wings`).
- `health` / `max HP` / `current HP` — preferred. Avoid `HP pool`, `life`, `health bar`.
- `the user's HP is at or below X%` — canonical HP-gate phrasing. Not `falls below`, not `drops to`.

---

## 9. Sorting and scope

- Within each array, alphabetical by `name` (case-insensitive, ignore leading articles).
- Out of scope: Rust/TS file paths/symbols, release versions/dates, wiki URLs, stamina/movement/positioning detail, any in-engine field name. A single page-level disclaimer covers stamina/movement.
- A status / ability / mechanic that is **not implemented anywhere in code** must not be mentioned in Reference (no "X is not currently modeled" placeholder for non-existent code paths). Stamina is the canonical example: it has zero engine support, so it does not appear in any `mechanics` or `notes`.
- A status / ability / mechanic that **exists in code** but is currently non-combat or partial is mentioned in `mechanics` (full apply description) and may carry a `notes` caveat that the effect is not yet wired into combat. Slow, Shock, Tunnel Vision, Blurred Vision, Injury, Shredded Wings — all examples; their applies appear in `mechanics`, the "currently out of model" caveat sits in `notes`.

### 9.1 Out-of-model abilities — unified style

All out-of-model abilities use a single minimal shape: one boilerplate mechanics bullet plus one generic notes line. Use the helper `createOutOfModelAbilityEntry(name)` directly — it produces this shape automatically:

```
mechanics: [
  "This ability is currently not included in the stand-and-fight combat model.",
],
notes: [
  "Movement, positioning, stealth, and other non-direct combat effects do not currently affect the PvP model.",
],
```

Hand-written out-of-model entries that currently include in-game behavior descriptions (Heal Beam, Healing Hunter) should be migrated to this shape during backfill — drop any in-game detail from `mechanics`, leave only the boilerplate. We don't have ready game-side info for non-modeled abilities and don't want every placeholder to spawn research work.

`Not planned` entries are different: they use the `whyItsNotModeledHere` field for the specific reason an ability is excluded from the modeling roadmap (Heal Aura, Silly Beam, Snow Shield). That field stays as written; no migration needed.
