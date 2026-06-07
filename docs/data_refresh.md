# Data refresh workflow

The runtime JSON files under `data/` are derived from external sources (primarily the Sonaria fandom wiki and game patch notes). They're checked into the repo as the bundle's source-of-truth and consumed via vite's `resolveJsonModule`.

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
| `status_effects.runtime.json` | `parsed.rawDescription` | Wiki HTML/nav scraping noise. The Unbridled Rage entry alone had 24.9 kB of `Fandom_RON_Desktop_HDX_Prebid`-style ad-prebid garbage. No code reads this field. |
| `plushies.runtime.json` | `rawDescription` + `snippet` | Redundant pair of human-readable description strings. No code reads either; the structured `modifiersParsed` field is the canonical source. |
| `traits.runtime.json` | `raw` | Long-form trait description duplicated against the short `effectText`. Only `effectText` is rendered in the UI. |

Before the strip, these fields totaled ~80 kB of source-file noise that bundled into 165 kB of dead bytes across multiple chunks - most painfully `enginePlushiesData` (preloaded on first paint) which carried 39 kB of pure noise.

## What the script does NOT strip

**`data/breath_specs.runtime.json` `raw` field is preserved.** It looks similar to the trait/plushie `raw` fields but is actively parsed at runtime:

- `src/engine/breathHelpersRuntime.ts` - `parseBreathAilments(spec.raw)`
- `src/optimizer/optimizerContextStatuses.ts` - `parseBreathAilmentsRaw(spec.raw)`
- `src/optimizer/rustBestBuildsRuntime.ts` - `getRustBreathSpecialStatuses(spec.raw)`

Stripping it would break the optimizer's status-effect probability ingest path. The script's docblock calls out this asymmetry so a future "clean up similar fields" pass doesn't accidentally remove it.

## Other data discipline

- **Versioning.** No schema version field is enforced today; the consumers in `src/engine/data.ts` use TypeScript shapes (`StatusEffect[]`, `PlushiesRoot`, etc.) and rely on `#[serde(default)]` on the Rust side for forward-compatibility. If you change a schema, also update the consumer type and add a migration note here.
- **Hand-edits to scraped data.** Discouraged but tolerated - the wiki occasionally lags game updates. Note hand-edits in the commit message if they touch creature stats or ability values. Reference text edits don't need this.
- **Icons.** `creatures.icons.json`, `plushies.icons.json`, `trait_icons.json` are Base64-encoded image data. They're large but compress well in transfer; no special workflow.
