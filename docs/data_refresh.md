# Data refresh workflow

The runtime JSON files under `data/` are derived from the Sonaria fandom wiki, from game patch notes, and from the per-creature corrections the sync layers over the scrape. They are checked into the repository and imported directly by the frontend, which TypeScript allows through `"resolveJsonModule": true` in `tsconfig.app.json`.

## When you re-scrape or hand-edit `data/*.json`

After replacing or editing any of:

- `data/status_effects.runtime.json`
- `data/plushies.runtime.json`
- `data/traits.runtime.json`

…always run:

```bash
node scripts/strip_unused_data_fields.mjs
```

This is **idempotent** - running it on already-clean files is a no-op.

## What it strips and why

| File | Field removed | Reason |
|---|---|---|
| `status_effects.runtime.json` | `parsed.rawDescription` | Wiki page HTML and navigation markup captured by the scrape. No code reads this field. |
| `plushies.runtime.json` | `rawDescription` + `snippet` | Redundant pair of human-readable description strings. No code reads either; the structured `modifiersParsed` field is the canonical source. |
| `traits.runtime.json` | `raw` | Long-form trait description duplicated against the short `effectText`. Only `effectText` is rendered in the UI. |

## What the script does NOT strip

**`data/breath_specs.runtime.json` `raw` field is preserved.** It looks similar to the trait/plushie `raw` fields but is actively parsed at runtime:

- `src/engine/runtimeHelpers.ts` - defines `parseBreathAilments(raw)`
- `src/optimizer/optimizerContextStatuses.ts` - calls `parseBreathAilments(spec.raw)`
- `src/optimizer/rustBestBuildsRuntime.ts` - calls it through `getRustBreathSpecialStatuses(spec.raw)`

Stripping it would break the optimizer's status-effect probability ingest path. The script's docblock states the same exception, so a later pass over similar fields does not remove it.

## Other data discipline

- **Versioning.** No schema version field is enforced today; the consumers assert TypeScript shapes over the imported JSON (`StatusEffect[]` in `src/engine/data.ts`, `PlushiesRoot` in `src/engine/buildData.ts`) and rely on `#[serde(default)]` on the Rust side for forward-compatibility. If you change a schema, also update the consumer type and add a migration note here.
- **Hand-edits to scraped data.** Edit by hand only where the wiki has not yet caught up with a game update; the next sync overwrites the edit unless it is carried in the override layer. Note a hand-edit in the commit message when it touches a creature stat or an ability value. An edit to Reference text does not need the note.
- **Icons.** `creatures.icons.json`, `plushies.icons.json`, `trait_icons.json` are Base64-encoded image data. They're large but compress well in transfer; no special workflow.

## Tests and data coupling

A routine data refresh changes creature stats, ability presence, and ability
values. It must **not** break the test suite. A test that fails on a sync that
changed only values is mis-written.

The rule: **a behavioral test must never use a live game number as its expected
value.** A behavioral test verifies *code* (does the builder thread a field? does
the catalog fallback fire?), so it has three sanctioned ways to express the
expectation, none of which a sync can move:

1. **Own it** — drive the code with a synthetic fixture whose value the test
   itself sets (`src/optimizer/__fixtures__/syntheticCreature.ts`). The fallback
   tests and the `buildAbilityConfig` characterization snapshots work this way.
2. **Cancel it** — assert a relation that holds at every value of the field:
   `built.damage === creature.stats.damage * K`. (See
   `buildRules.test.ts`, the identity tests in `rustBestBuildsRuntime.test.ts`.)
3. **Exclude it** — for structure, snapshot only code-owned shape over fixtures,
   never live-creature output.

Reading live creature data (`creatureByName` / `getCreatureByName`) is allowed
only to assert **data-independent** properties — structure, a relation, presence,
"no errors". `src/optimizer/dataCoupledTestPolicy.test.ts` enforces this: it
forbids snapshotting live creature data outright, and requires every test file
that reads live creatures to be on a reviewed allowlist.

Genuine data *correctness* is checked in one place, on purpose:
`src/engine/dataIntegrity.test.ts` asserts schema/shape invariants over the whole
live roster — every creature has finite required stats, and every ability value
is `null | finite number | string`. These hold at every value, so a sync that
changed only values leaves them passing. A dropped stat, a NaN or a wrong-typed
value fails them. Note it does NOT assert that a
listed ability "has a value": a null ability value is a legitimate "effectively
absent" marker (e.g. a phantom ability the wiki lists with no value), so that is
not an invariant.

**Post-sync workflow:** drop in the new `data/*.runtime.json` → run
`node scripts/strip_unused_data_fields.mjs` → `npm run build` + `npx vitest run`.
The suite passes. A failure is a code regression or a data defect
`dataIntegrity.test.ts` found. No step updates a snapshot to the new numbers: a
test that would need one is coupled to live data and moves to a fixture.
