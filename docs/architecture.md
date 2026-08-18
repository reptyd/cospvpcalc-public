# Architecture overview

Where each part of the project runs and which file holds it. Read it before deciding which file a change belongs in.

The site is a single-page React app that loads a Rust crate compiled to WebAssembly and drives every combat simulation through it. Everything runs in the browser: there is no server-side rendering, no API backend, and no database. The site stores state in `localStorage` - custom abilities, custom timings and persisted creatures - and in URL-encoded match snapshots. Hosting is Cloudflare Pages serving static assets; security headers (CSP / HSTS / COOP / COEP) come from `public/_headers`. Live site: <https://cospvpcalc.ru/>.

## Top-level data flow

```
User input  →  React page              →  Page controller hook
                  (Compare / Best Builds /    (e.g. useCompareSimulation)
                   Optimizer / Sandbox /
                   Custom / Search /              │
                   Reference)                     ▼
                                       TS <-> WASM bridge
                                       (rustMatchupBridge.ts +
                                        rustMatchupLoader.ts)
                                                  │
                                                  ▼
                                       WASM module
                                       (wasm-engine compiled)
                                                  │
                                                  ▼
                                       Composable event loop
                                       (driver + phases + policy)
                                                  │
                                                  ▼
                                       Trace + result
                                                  │
                                                  ▼
                                       React renders combat log
                                                                    & summary
```

The bridge layer is the only TS code allowed to touch combat state. Everything inside the WASM boundary is the source of truth.

## Frontend layers

| Layer | Path | Responsibility |
|---|---|---|
| Routes | `src/AppPageRouter.tsx` | URL -> page component mapping. |
| Pages | `src/pages/*.tsx` | One component per top-level route (Compare, BestBuilds, SpeedBuilds, Optimizer, Sandbox, Custom, Search, Reference; plus Contact, Credits, Donate). Each ships a `*Beta.tsx` twin selected by the `compareDesignBeta` flag in `AppPageRouter.tsx`. |
| Page controllers | `src/pages/use*PageController.ts`, `src/hooks/*.ts` | All page-level orchestration: form state, debounced runs, cached results. |
| Engine helpers | `src/engine/` | Pure-math primitives (`applyRulesAndBuild` in `buildRules.ts`; `computeMeleeDamagePerHit` and `computeBreathDamage` in `subsystems/damage.ts`) plus the TypeScript side of the bridge. No fight is resolved here: these functions build the inputs the engine runs on. |
| Bridge | `src/optimizer/rustMatchupBridge.ts` + `src/optimizer/rustMatchupLoader.ts` | Converts `FinalStats` (TS) into `RustSimpleCombatantStats` (mirrors the Rust serde shape) and back, and loads/initializes the WASM module. |
| Custom-ability surface | `src/shared/customAbility*.ts`, `src/shared/abilityDsl.ts`, `src/components/custom/*.tsx` | DSL parser/printer and visual constructor for user-authored ability and timing specs. |

The bundle is split into manual chunks via `manualChunks` in `vite.config.ts` so the initial paint stays small even though the creature runtime data ships as its own large chunk. `npm run check:bundle` fails when the initial-paint assets exceed `BUDGET_BYTES` in `scripts/check-bundle-size.mjs`, 600000 bytes today.

## Engine layers

The Rust crate (`wasm-engine/`) is the entire combat engine. Top-down:

| Layer | Path | Responsibility |
|---|---|---|
| Driver | `wasm-engine/src/composable/mod.rs` | `simulate_composable_matchup_with_trace_control` -- the main event loop. Runs one matchup to completion. |
| Phases | `wasm-engine/src/composable/phases/` | The `process_phase_*` functions, one per combat sub-step (bite, breath, status tick, status block, scheduler, post-tick, etc.). Eight modules: `breath`, `melee`, `misc`, `mod`, `phase4`, `post_tick`, `scheduler`, `status`. Each phase function has at least one isolation test in `composable/phase_tests.rs`. |
| Policy / active timing | `wasm-engine/src/policy/` | Decides whether to fire an active ability now, wait, or skip it. See the dedicated section below. |
| User abilities | `wasm-engine/src/policy/user_ability.rs` + `wasm-engine/src/policy/user_timing.rs` | Expression DSL, trigger hooks (`on_take_damage`, `on_heal`, `on_before_take_damage`, ...), spec validation, registration entrypoints called from JS. |
| Effects | `wasm-engine/src/effects.rs` | The `EffectKind` enum -- the primitive vocabulary user abilities can apply (deal damage, apply status, schedule effect, choose-one-of-N, etc.). The Rust enum is the source of truth; `customAbilityTypes.ts` mirrors it. |
| Reference tests | `wasm-engine/src/composable/reference_tests/` | One file per `referenceContent.ts` entry. Marker pattern `[REF:<id>]` lets the coverage test in the vitest suite (`src/pages/referenceCoverage.test.ts`, run by the `test-ts` job) verify coverage; the marker counts only from a file that asserts. |
| Fixture harness | `wasm-engine/src/fixture_tests.rs` | End-to-end matchup fixtures. Catches regressions across the whole engine. |
| Sandbox | `wasm-engine/src/composable/sandbox.rs` | Stateful session API: step-by-time or step-by-event, force-actions, undo via action-log replay. See the Sandbox section below. |

### The Rust combat event loop

`simulate_composable_matchup_with_trace_control` in `composable/mod.rs` is the driver. It owns the timeline: it advances simulated time, pulls the next scheduled work item, and dispatches it to the matching phase processor. Each combat sub-step -- resolving a bite, resolving a breath, ticking statuses, applying a status block, running the scheduler, post-tick bookkeeping -- is a `process_phase_*` function in the `composable/phases/` submodule. The driver stays a thin loop; the phase functions hold the mechanics.

`composable/phase_tests.rs` calls the phase functions one at a time, so a regression in breath resolution fails a phase test and not only an end-to-end fixture.

## The policy / active-timing engine

`wasm-engine/src/policy/` answers a single question during a live encounter: should the actor fire ability X now, wait, or skip it? Each ability's decision is a registered trait implementation, not a branch in the engine:

| Module | Responsibility |
|---|---|
| `policy/mod.rs` | Crate-level wiring and re-exports. |
| `policy/traits.rs` | The core traits (`TimedDecision`, `Policy`, `StateProjection`) -- all object-safe so decisions can be boxed and registered at runtime. |
| `policy/state.rs` | `PolicyState` / `PolicySide`: the snapshot a decision sees, including an `extras` map for ad-hoc per-side values. |
| `policy/timing_mode.rs` | The `TimingMode` enum and the built-in timing policies. |
| `policy/registry.rs` | `DecisionRegistry` and `PolicyRegistry` -- the lookup tables the engine evaluates through. |
| `policy/light_projection.rs` | Deterministic forward-projection helpers: cheaply estimate the state a few seconds out so a decision can score "fire now vs. fire later". |
| `policy/user_ability.rs`, `policy/user_timing.rs` | User-authored abilities and timing specs (`UserTimingSpec`). |
| `policy/decisions/` | One module per built-in decision (Fortify, Hunker, Cocoon, Reflect, Wardens Rage, Hunters Curse, Adrenaline, Life Leech, Unbridled Rage, Rewind, stance, bite-variant, ...). |
| `policy/tests/` | Engine-level property and parity tests for the decision layer. |

Built-in timing modes are `really_fast`, `fast`, `semi_ideal`, `ideal`, and `extreme`. Each mode enumerates a set of candidate fire-delays over a horizon, projects the state at each candidate, scores them, and picks the best (or skips if none beat doing nothing). `really_fast` evaluates only the gate. `extreme` evaluates about 200 candidate delays over a 120 second horizon; the full table is in `docs/policy_engine_pillars.md` §7. User-defined `UserTimingSpec` policies plug into the same registry and evaluation path -- no engine code special-cases a built-in by name.

The engine reaches the policy layer through `composable/policy_bridge.rs`, which maps the user-selected timing mode onto a `TimingMode` and drives decisions through the shared `PolicyRegistry`. Because built-in and user-authored decisions run through one code path, adding a new active ability is additive: register a decision, and every timing mode can already schedule it.

## The TS <-> WASM bridge

All combat math lives behind the WASM boundary; TypeScript only marshals data in and renders results out.

- `src/optimizer/rustMatchupBridge.ts` defines `RustSimpleCombatantStats` / `RustComposableAbilityConfig` (mirrors of the Rust serde shapes) and converts a built `FinalStats` into them and back.
- `src/optimizer/rustMatchupLoader.ts` loads and initializes the compiled WASM module and exposes the simulate entrypoints.
- `src/hooks/useCompareSimulation.ts` is the Compare entry point: it builds both sides, calls the bridge, and hands the returned trace and summary to the React combat-log renderer.
- Sandbox uses a parallel set of seams: `wasm-engine/src/composable/sandbox.rs` (the Rust session) <-> `src/engine/sandboxBridge.ts` (the WASM bridge) <-> `src/hooks/useSandboxSimulation.ts` (the React hook).

### The bridge contract

Adding a new field that Compare should respect is a four-step sequence; skip any step and the field is silently dropped:

1. Add to `SimpleCombatantStats` or `ComposableAbilityConfig` in Rust with `#[serde(default)]`.
2. Mirror in `RustSimpleCombatantStats` / `RustComposableAbilityConfig` in `src/optimizer/rustMatchupBridge.ts`.
3. Wire from `FinalStats` in `src/engine/*` (`toRustStatusMeleeStats` / `toRustBreathProfile` / `addCompareRuntimeFlags` / `useCompareSimulation.ts`).
4. Implement the effect inside the relevant `process_phase_*` function (or policy decision).

This is the most common source of "I added a field but Compare ignores it" bugs.

## Sandbox: a step-through debugger

Sandbox needs three things the main driver is not built for:

- **Step by event** -- advance simulated time exactly until the next scheduled event, then stop. The main driver runs to completion.
- **Force-action** -- fire a specific action right now (bite, breath, or a named ability), ignoring the engine's decision logic. The main driver couples decision and dispatch.
- **Reversible state** -- undo via action-log replay.

`sandbox.rs` therefore exposes a stateful session over the same combat state the driver uses. Force-actions (`force_bite`, `force_breath`, `force_ability`) mutate state directly rather than running a full loop iteration, so exactly the requested action fires and nothing else. The session lets the UI inspect per-side internal state between steps.

## Custom abilities: where user specs plug in

User-authored abilities and timings are registered into the engine through a wasm-bindgen entrypoint. Once registered, the dispatcher looks them up in the same registry as built-ins and dispatches through the same trait. The dispatch path:

```
User authors spec in DSL                  parseAbility() in abilityDsl.ts
                                                 │
              (visual constructor)               ▼
                                          UserAbilitySpec (TS)
                                                 │
                                       Bridge serializes to JSON
                                                 │
                                                 ▼
                                       register_user_ability (wasm-bindgen)
                                                 │
                                                 ▼
                                       DecisionRegistry inside the engine
                                                 │
                                                 ▼
                                       Same Compare / Best Builds / Sandbox
                                       path as built-ins
```

The hot path is Rust-only. Specs are parsed and registered once at simulation start; the engine then evaluates them via the recursive AST walk over the `Expr` enum. There are no JS callbacks during simulation.

The DSL grammar lives in the parser/printer at `src/shared/abilityDsl.ts` (expressions in `exprDsl.ts`); the in-page reference panel renders the full set of variables, operators, and effect kinds the engine accepts.

## User-facing surfaces

- **Compare** -- a 1v1 matchup with full build customization, producing a turn-by-turn combat log and a summary.
- **Best Builds** -- exhaustive build search for a creature against an opponent pool, ranked by win rate, time-to-kill, and damage.
- **Speed Builds** -- build search over movement speed rather than combat. It does not run a matchup at all: `src/speed/speedSearch.ts` sweeps builds and scores them through `speedMath.ts`, so nothing here crosses the WASM boundary.
- **Optimizer** -- a counter-mode wrapper over the Best Builds engine: fix Creature A's build and optimize Creature B against it.
- **Sandbox** -- the step-through debugger described above.
- **Custom** -- author abilities and timing policies in a Python-like text DSL or a visual constructor, live-test, and share. Sub-tabs: creatures, abilities, timings, statuses.
- **Search** -- filter creatures by numeric stats with multi-field predicates.
- **Reference** -- renders the user-authored mechanic spec from `src/pages/referenceContent.ts`.
- Minor pages: **Contact**, **Credits**, **Donate**.

### Share / Report

A "Share / Report" button builds a URL match-snapshot (query `?match=`) capturing the open page's state plus a diagnostic block, implemented in `src/shared/matchSnapshot.ts`. Four encodings exist -- `COSM1:` plain base64url, `COSM2:` lz-string, `COSM3:` lz-string over name-token substitution, `COSM4:` raw DEFLATE against a versioned preset dictionary. `encodeMatchSnapshot` builds all four and returns the shortest; every prefix still decodes, so old links keep working. The custom library exports and imports as a JSON bundle (prefix `cosab1:`, `src/shared/customLibraryBundle.ts`). There is no in-app bug tracker: reporting means pasting the share link to the Contact channel (email `cos.pvp.contact@gmail.com` / Discord).

## Data layout

Runtime data lives in `data/*.runtime.json` and is imported directly by the frontend. Each file maps to a specific Vite chunk via `manualChunks` in `vite.config.ts`:

- `creatures.runtime.json` -- stat blocks, abilities, breath specs.
- `creatures.icons.json` + `public/icons/creatures/*` -- creature portraits.
- `plushies.runtime.json` + `plushies.icons.json` -- plushie definitions.
- `traits.runtime.json` + `trait_icons.json` -- traits.
- `veneration.runtime.json` -- veneration stage rules.
- `effects_catalog.runtime.v2.json` -- per-creature effect catalogs (status applies, resistances).
- `status_effects.runtime.json` -- status spec.
- `special_abilities.runtime.json` -- special-ability spec.
- `breath_specs.runtime.json` -- breath spec.
- `rules.recode.json` -- global combat rules (stat formulas, bite weight bracket).
- `manual_overrides.json` -- per-creature corrections layered over the wiki sync.
- `subspecies.json` -- subspecies detection for the sync.

Status-block, status-attack and defensive-status data used to live in separate `s1_blocks` / `s2_status_attacks` / `a1_defensive_status` files. Commit `0e76bbda` made the synced `effects_catalog.runtime.v2.json` authoritative and deleted all three.

If you re-scrape from the wiki, run `node scripts/strip_unused_data_fields.mjs` before committing -- it strips the wiki HTML noise from `parsed.rawDescription` (status_effects), `rawDescription` + `snippet` (plushies), and `raw` (traits). The script is idempotent.

## Determinism guarantee and why Rust -> WASM

Reproducibility is **non-negotiable**: the same inputs produce the same combat log on every host, every browser, every run. The engine takes no wall-clock seeds; randomness in the user-ability DSL (`Expr::Rand`, `EffectKind::Chance`, `EffectKind::Choose`) runs an LCG seeded from simulated time and the acting side's `extras` length -- `(state.time * 1e6).round()` mixed with `extras.len() * 0x9E3779B9` -- so a rerun of the same simulation draws the same numbers. All three share one seed mix, so a `choose` and a `chance` at the same instant draw from the same stream.

Two properties make compiling the engine to WebAssembly the right choice:

- **Determinism.** A single compiled artifact runs identically across browsers and platforms. There is no second implementation to drift out of sync, and floating-point behaviour is consistent.
- **Speed.** Best Builds runs on the order of 10^5--10^6 matchups per search. Compare and Sandbox call the same engine functions, so one implementation serves a single matchup and a whole search.

Best Builds depends directly on determinism -- the optimizer's rankings would be meaningless if matchups disagreed across runs.

## Build, test, and CI

Local verification stack (run before claiming a change is verified):

- `npm run build` -- `tsc -b && vite build`: strict type-check **and** production bundle.
- `npx vitest run` -- TS runtime tests.
- `cargo test --lib` (in `wasm-engine/`) -- engine tests, including phase-isolation and reference tests.
- `npm run lint` -- ESLint, zero-warning gate.
- `npm run check:mojibake` -- UTF-8 / CP1251 corruption guard over tracked text.
- `npm run check:bundle` -- initial-paint asset-size guard.
- `npm run test:e2e` -- Playwright Chromium smoke suite, including an axe-core accessibility gate.
- `npm run test:bundle` -- Playwright over the built `dist/` served by `vite preview`, loading bare `/`. Required for any `vite.config.ts` / chunking / import-graph change: the dev-server e2e serves unbundled ESM and cannot see production chunk-init order.

> Note: `tsc --noEmit` is a **false positive** here -- the root `tsconfig.json` is references-only, so the command exits 0 without checking anything. Always use `npm run build`.

CI (`.github/workflows/ci.yml`) runs eight jobs that mirror the stack above:

| Job | Command(s) |
|---|---|
| `build-ts` | `npm run build` then `npm run check:bundle` |
| `test-ts` | `npx vitest run` |
| `test-rust` | `cargo test --lib` (in `wasm-engine/`) |
| `wasm-fresh` | `src/optimizer/wasmFreshness.test.ts` against the committed bundle, then `npm run rust:build`, then the same test again; `scripts/compare_wasm_summaries.mjs` diffs the two |
| `lint-ts` | `npm run check:mojibake` then `npm run lint` (ESLint) |
| `lint-rust` | `cargo clippy --all-targets -- -D warnings` (in `wasm-engine/`) |
| `e2e` | Playwright Chromium smoke, with an axe-core a11y gate |
| `bundle-load` | Cold-loads the built `dist/` at bare `/` to catch cross-chunk module-init-order crashes |

### WASM rebuild

After any change under `wasm-engine/`, rebuild the WASM artifact with `npm run rust:build` (wasm-pack, then `wasm-opt -O`). The regenerated `src/rust-pkg/` must be committed alongside the Rust change: that committed `.wasm` is what ships, and no deploy step rebuilds it. Forgetting the rebuild is not silent -- the `wasm-fresh` job rebuilds the engine itself and fails if the committed bundle's behaviour differs from the fresh one.

## License

AGPL-3.0-only. Copyright (c) 2026 Tymamatyty.
