# Architecture overview

One-page tour of how the project is wired together. Start here when you need a mental model of where a change should land.

The site is a single-page React app that loads a Rust crate compiled to WebAssembly and drives every combat simulation through it. The browser is the only platform that ships the bundle: there is no server-side rendering, no API backend, and no database. State lives in `localStorage` (custom abilities and timings, persisted creatures) and in URL-encoded match snapshots. Hosting is Cloudflare Pages serving static assets; security headers (CSP / HSTS / COOP / COEP) come from `public/_headers`. Live site: <https://cospvpcalc.ru/>.

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
| Pages | `src/pages/*.tsx` | One component per top-level route (Compare, BestBuilds, Optimizer, Sandbox, Custom, Search, Reference; plus Contact, Credits, Donate). |
| Page controllers | `src/pages/use*PageController.ts`, `src/hooks/*.ts` | All page-level orchestration: form state, debounced runs, cached results. |
| Engine helpers | `src/engine/*.ts` | Pure-math primitives (`applyRulesAndBuild`, `computeMeleeDamagePerHit`, `computeBreathDamage`) plus the TS bridge surface. The only TS code that looks like "combat" -- and even here it is bridge plumbing, not combat math. |
| Bridge | `src/optimizer/rustMatchupBridge.ts` + `src/optimizer/rustMatchupLoader.ts` | Converts `FinalStats` (TS) into `RustSimpleCombatantStats` (mirrors the Rust serde shape) and back, and loads/initializes the WASM module. |
| Custom-ability surface | `src/shared/customAbility*.ts`, `src/shared/abilityDsl.ts`, `src/components/custom/*.tsx` | DSL parser/printer and visual constructor for user-authored ability and timing specs. |

The bundle is split into manual chunks via `manualChunks` in `vite.config.ts` so the initial paint stays small even though the creature runtime data ships as its own large chunk. The `npm run check:bundle` guard fails CI if the initial-paint asset size jumps unexpectedly.

## Engine layers

The Rust crate (`wasm-engine/`) is the entire combat engine. Top-down:

| Layer | Path | Responsibility |
|---|---|---|
| Driver | `wasm-engine/src/composable/mod.rs` | `simulate_composable_matchup_with_trace_control` -- the main event loop. Runs one matchup to completion. |
| Phases | `wasm-engine/src/composable/phases/` | The `process_phase_*` functions, one per combat sub-step (bite, breath, status tick, status block, scheduler, post-tick, etc.). Eight modules: `breath`, `melee`, `misc`, `mod`, `phase4`, `post_tick`, `scheduler`, `status`. Each phase function has at least one isolation test in `composable/phase_tests.rs`. |
| Policy / active timing | `wasm-engine/src/policy/` | Decides *when* to fire active abilities (the "decision brain"). See the dedicated section below. |
| User abilities | `wasm-engine/src/policy/user_ability.rs` + `wasm-engine/src/policy/user_timing.rs` | Expression DSL, trigger hooks (`on_take_damage`, `on_heal`, `on_before_take_damage`, ...), spec validation, registration entrypoints called from JS. |
| Effects | `wasm-engine/src/effects.rs` | The `EffectKind` enum -- the primitive vocabulary user abilities can apply (deal damage, apply status, schedule effect, choose-one-of-N, etc.). The Rust enum is the source of truth; `customAbilityTypes.ts` mirrors it. |
| Reference tests | `wasm-engine/src/composable/reference_tests/` | One file per `referenceContent.ts` entry. Marker pattern `[REF:<id>]` lets the coverage test in the vitest suite (`src/pages/referenceCoverage.test.ts`, run by the `test-ts` job) verify coverage. |
| Fixture harness | `wasm-engine/src/fixture_tests.rs` | End-to-end matchup fixtures. Catches regressions across the whole engine. |
| Sandbox | `wasm-engine/src/composable/sandbox.rs` | Stateful session API: step-by-time or step-by-event, force-actions, undo via action-log replay. See the Sandbox section below. |

### The Rust combat event loop

`simulate_composable_matchup_with_trace_control` in `composable/mod.rs` is the driver. It owns the timeline: it advances simulated time, pulls the next scheduled work item, and dispatches it to the matching phase processor. Each combat sub-step -- resolving a bite, resolving a breath, ticking statuses, applying a status block, running the scheduler, post-tick bookkeeping -- is a `process_phase_*` function in the `composable/phases/` submodule. The driver stays a thin loop; the phase functions hold the mechanics.

Splitting the engine this way keeps each sub-step independently testable: `composable/phase_tests.rs` exercises every phase function in isolation, so a regression in (say) breath resolution surfaces as a focused failing test rather than a mysterious end-to-end fixture drift.

## The policy / active-timing engine

`wasm-engine/src/policy/` answers a single question during a live encounter: should the actor fire ability X now, wait, or skip it? It is structured as a small plugin framework rather than a pile of per-ability `if` statements:

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

Built-in timing modes are `really_fast`, `fast`, `semi_ideal`, `ideal`, and `extreme`. Each mode enumerates a set of candidate fire-delays over a horizon, projects the state at each candidate, scores them, and picks the best (or skips if none beat doing nothing). `really_fast` is gate-only; `extreme` searches a dense grid. User-defined `UserTimingSpec` policies plug into the same registry and evaluation path -- no engine code special-cases a built-in by name.

The engine reaches the policy layer through `composable/policy_bridge.rs`, which maps the user-selected timing mode onto a `TimingMode` and drives decisions through the shared `PolicyRegistry`. Because built-in and user-authored decisions run through one code path, adding a new active ability is additive: register a decision, and every timing mode can already schedule it.

## The TS <-> WASM bridge

All combat math lives behind the WASM boundary; TypeScript only marshals data in and renders results out.

- `src/optimizer/rustMatchupBridge.ts` defines `RustSimpleCombatantStats` / `RustComposableAbilityConfig` (mirrors of the Rust serde shapes) and converts a built `FinalStats` into them and back.
- `src/optimizer/rustMatchupLoader.ts` loads and initializes the compiled WASM module and exposes the simulate entrypoints.
- `src/hooks/useCompareSimulation.ts` is the Compare entry point: it builds both sides, calls the bridge, and hands the returned trace and summary to the React combat-log renderer.
- Sandbox uses a parallel set of seams: `wasm-engine/src/composable/sandbox.rs` (the Rust session) <-> `src/engine/sandboxBridge.ts` (the WASM bridge) <-> `src/hooks/useSandboxSimulation.ts` (the React hook).

### The bridge contract

Adding a new field that Compare should respect is a four-step ritual; skip any step and the field is silently dropped:

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

User-authored abilities and timings are registered into the engine through a wasm-bindgen entrypoint. Once registered they are first-class citizens: the dispatcher walks built-in and user decisions through the same registry. The dispatch path:

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
- **Optimizer** -- a counter-mode wrapper over the Best Builds engine: fix Creature A's build and optimize Creature B against it.
- **Sandbox** -- the step-through debugger described above.
- **Custom** -- author abilities and timing policies in a Python-like text DSL or a visual constructor, live-test, and share. Sub-tabs: creatures, abilities, timings, statuses.
- **Search** -- filter creatures by numeric stats with multi-field predicates.
- **Reference** -- renders the user-authored mechanic spec from `src/pages/referenceContent.ts`.
- Minor pages: **Contact**, **Credits**, **Donate**.

### Share / Report

A "Share / Report" button builds a URL match-snapshot (prefix `COSM1:`, query `?match=`) capturing the open page's state plus a diagnostic block, implemented in `src/shared/matchSnapshot.ts`. The custom library exports and imports as a JSON bundle (prefix `cosab1:`, `src/shared/customLibraryBundle.ts`). There is no in-app bug tracker: reporting means pasting the share link to the Contact channel (email `cos.pvp.contact@gmail.com` / Discord).

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
- `s1_blocks.runtime.json`, `s2_status_attacks.runtime.json`, `a1_defensive_status.runtime.json` -- status-block / status-attack / defensive-status per-creature data.

If you re-scrape from the wiki, run `node scripts/strip_unused_data_fields.mjs` before committing -- it strips the wiki HTML noise from `parsed.rawDescription` (status_effects), `rawDescription` + `snippet` (plushies), and `raw` (traits). The script is idempotent.

## Determinism guarantee and why Rust -> WASM

Reproducibility is **non-negotiable**: the same inputs produce the same combat log on every host, every browser, every run. The engine takes no time-based seeds; randomness in the user-ability DSL (`Expr::Rand`, `EffectKind::Chance`, `EffectKind::Choose`) is seeded from `(state.time, side label, ability id)` so it is reproducible without introducing shared mutable state.

Two properties make compiling the engine to WebAssembly the right choice:

- **Determinism.** A single compiled artifact runs identically across browsers and platforms. There is no second implementation to drift out of sync, and floating-point behaviour is consistent.
- **Speed.** Best Builds runs on the order of 10^5--10^6 matchups per search. That throughput is only practical with a tight, allocation-conscious native-speed core; the same code paths back Compare and Sandbox, so a single matchup and a million matchups share one engine.

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

> Note: `tsc --noEmit` is a **false positive** here -- the root `tsconfig.json` is references-only, so the command exits 0 without checking anything. Always use `npm run build`.

CI (`.github/workflows/ci.yml`) runs six required jobs that mirror the stack above:

| Job | Command(s) |
|---|---|
| `build-ts` | `npm run build` then `npm run check:bundle` |
| `test-ts` | `npx vitest run` |
| `test-rust` | `cargo test --lib` (in `wasm-engine/`) |
| `lint-ts` | `npm run check:mojibake` then `npm run lint` (ESLint) |
| `lint-rust` | `cargo clippy --all-targets -- -D warnings` (in `wasm-engine/`) |
| `e2e` | Playwright Chromium smoke, with an axe-core a11y gate |

### WASM rebuild

After any change under `wasm-engine/`, rebuild the WASM artifact with `npm run rust:build` (wasm-pack). **CI does not rebuild the WASM** -- the regenerated `src/rust-pkg/` must be committed alongside the Rust change, or the running app keeps the old engine.

## License

AGPL-3.0-only. Copyright (c) 2026 Tymamatyty.
