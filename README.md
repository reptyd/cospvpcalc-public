# Creatures of Sonaria PvP Calculator (Recode)

A data-driven PvP calculator and matchup optimizer for *Creatures of Sonaria* (Recode version). Every page runs the same Rust combat engine, compiled to WebAssembly.

Live site: <https://cospvpcalc.ru/>. Released under the [GNU Affero General Public License v3.0 only](LICENSE) - (c) 2026 Tymamatyty.

This is a developer-focused README.

## What's in here

The app is a set of top-level pages, all sharing the same WASM combat engine:

- **Compare** - head-to-head matchup between two creature builds with full build customization (traits, veneration, plushies, breath, actives, and the effect catalog). Renders a turn-by-turn combat log + a result summary.
- **Best Builds** - exhaustive build search for a chosen creature against an opponent pool. Results ranked by win rate / TTK / damage delta.
- **Optimizer** - counter-mode build search: fix Creature A's build, optimize Creature B against it. A single-mode wrapper over the Best Builds engine.
- **Sandbox** - a step-through debugger for a single matchup: advance by time or by event, force-fire bite / breath / abilities, and inspect per-side internal state.
- **Custom** - author new abilities and timing policies in a Python-like text DSL (or a visual constructor), live-test them against the roster, and share. Sub-tabs cover creatures, abilities, timings, and statuses. Specs evaluate inside the same Rust dispatch path as built-ins.
- **Search** - filter creatures by numeric stats with multi-field predicates.
- **Speed Builds** - ranks a creature's loadouts by movement speed. No fight runs here: the combat engine does not simulate movement, so this page evaluates the speed channels directly and runs no matchup.
- **Reference** - renders the user-authored mechanic spec (what each status / ability / plushie does) from `src/pages/referenceContent.ts`.

**Share / Report.** A "Share / Report" button builds a match-snapshot URL (prefix `COSM1:` through `COSM4:`, carried in the `?match=` query param) that captures the open page's state plus a diagnostic block. The encoder builds four encodings and emits the shortest; all four decode. There is no in-app bug tracker - reporting a problem means pasting the share link to the Contact channel (email `cos.pvp.contact@gmail.com` / Discord). The custom library exports and imports as a JSON bundle (prefix `cosab1:`).

## Quickstart

Node 20 is the version the project is built and tested on (`.nvmrc`; every CI job that runs Node pins `node-version: "20"`).

```bash
git clone https://github.com/reptyd/cospvpcalc-public.git
cd cospvpcalc-public
npm install
npm run dev          # Vite dev server, http://localhost:5173
```

A pre-built WASM bundle ships in `src/rust-pkg/`, so the frontend runs without a Rust toolchain. CI checks that the committed bundle still matches a fresh rebuild, but it never commits one, so an un-rebuilt change is silently absent from the running engine. Full procedure in [CONTRIBUTING.md](CONTRIBUTING.md).

If the WASM bundle fails to load - a 404 on the asset, or WebAssembly disabled in the browser - a bridge-status banner is shown and Compare, Best Builds, Optimizer and Sandbox render no results. There is no JavaScript fallback path - combat math lives only in the Rust engine, so TS-only changes to combat logic are no-ops on the live engine.

## Tech stack

- **Frontend:** Vite + React 19 + TypeScript (strict). Self-hosted fonts (`@fontsource`), no runtime CSS framework. The bundle is split into chunks; `npm run check:bundle` fails when the initial-paint assets total more than 600000 bytes (`BUDGET_BYTES` in `scripts/check-bundle-size.mjs`).
- **Combat engine:** Rust crate in `wasm-engine/`, compiled to WASM with `wasm-pack`. Event-loop architecture driven by `simulate_composable_matchup_with_trace_control` in `composable/mod.rs`; the per-step `process_phase_*` functions live in the `composable/phases/` submodule. Single source of truth for all combat math.
- **Policy / active-timing engine:** the `policy/` tree picks when to fire active abilities. Built-in timing modes - `really_fast`, `fast`, `semi_ideal`, `ideal`, `extreme` - share infrastructure with user-defined `UserTimingSpec` policies.
- **Custom-ability DSL:** a Python-like text mode parses and prints `UserAbilitySpec`. A plain `<textarea>` with an inline parser-error overlay is used instead of a heavyweight editor; a visual constructor offers the same surface without writing text.
- **Hosting:** Cloudflare Pages, static-only. CSP / HSTS / COOP / COEP enforced via `public/_headers`.

Rust compiled to WASM was chosen over a TypeScript engine for two reasons. Determinism: the same inputs must produce the same combat log on every host, and a Best Builds run replays the same matchup set across every candidate build. Speed: Best Builds needs a fight to resolve in under 10 milliseconds.

## Browser support

The app targets the **last two stable releases** of the major evergreen engines. There is no legacy build and no polyfills - the hard runtime requirements are **WebAssembly** and **ES2022 ES modules** (plus `fetch`, `Promise`, `globalThis`).

| Browser | Supported |
| --- | --- |
| Chrome / Edge (desktop) | last 2 stable |
| Firefox (desktop) | last 2 stable + current ESR |
| Safari (macOS) | last 2 stable |
| Safari (iOS) | last 2 stable |
| Chrome (Android) | current stable |

(Build `browserslist`: `last 2 {Chrome,Firefox,Safari,Edge} versions`, `Firefox ESR`, `not dead`; TypeScript/Vite target ES2022.)

`src/main.tsx` feature-detects these before mounting React. A browser that loads the app but lacks WebAssembly (or `fetch` / `Promise`) gets a clear **"This browser is too old"** message instead of a blank page; with JavaScript disabled, an equivalent `<noscript>` notice is shown. Browsers too old to parse ES modules at all (pre-2018, e.g. IE) are unsupported by design - they silently ignore the module entry script, and the strict CSP (`script-src 'self' 'wasm-unsafe-eval'`, no inline scripts) rules out a `nomodule` shim.

## Architecture

Quick map of the load-bearing pieces:

- **Driver:** `wasm-engine/src/composable/mod.rs` - `simulate_composable_matchup_with_trace_control` runs the event-loop iterations and time advance.
- **Phases:** `wasm-engine/src/composable/phases/` - an 8-file submodule (`breath`, `melee`, `misc`, `mod`, `phase4`, `post_tick`, `scheduler`, `status`) holding the `process_phase_*` functions, one cluster per combat sub-step (bite, breath, status tick, status block, etc.). Each has at least one isolation test in `composable/phase_tests.rs`.
- **Policy / active-timing engine:** the `wasm-engine/src/policy/` tree - `mod.rs`, `registry.rs`, `traits.rs`, `light_projection.rs`, `state.rs`, `timing_mode.rs`, `user_ability.rs`, `user_timing.rs`, `testing.rs`, the per-decision modules under `decisions/`, and `tests/`.
- **Reference tests:** `wasm-engine/src/composable/reference_tests/` - one file per `referenceContent.ts` entry, marked with `[REF:<id>]` so the coverage test in the vitest suite (`src/pages/referenceCoverage.test.ts`, run by the `test-ts` job) can verify coverage.
- **Fixture harness:** `wasm-engine/src/fixture_tests.rs` - end-to-end matchup fixtures.
- **TS <-> WASM bridge:** `src/optimizer/rustMatchupBridge.ts` + `src/optimizer/rustMatchupLoader.ts`.
- **Compare entry:** `src/hooks/useCompareSimulation.ts`.
- **Sandbox:** `wasm-engine/src/composable/sandbox.rs` (Rust event-loop session) + `src/engine/sandboxBridge.ts` (WASM bridge) + `src/hooks/useSandboxSimulation.ts` (React hook). Force-actions mutate state directly to guarantee only the requested action fires.

Deeper architectural reference: [docs/architecture.md](docs/architecture.md). Walkthrough for adding a new ability: [docs/adding-an-ability.md](docs/adding-an-ability.md).

## Tests and verification

The local verification stack - run these before considering a change verified:

```bash
npm run build             # tsc -b && vite build (strict type-check + bundle)
npx vitest run            # frontend runtime tests
npm run lint              # eslint .
npm run check:mojibake    # UTF-8 -> CP1251 corruption guard over tracked text
npm run check:bundle      # initial-paint asset-size guard
npm run test:e2e          # Playwright chromium smoke suite (incl. axe-core a11y gate)

cd wasm-engine
cargo test --lib          # engine tests (phase isolation + reference + fixtures)
```

`npx tsc --noEmit` is a **false positive** in this repo (the root `tsconfig.json` is references-only and exits 0 without checking anything). Always go through `npm run build`.

Two workflows run on every push to `main` or `master` and on every pull request. `.github/workflows/ci.yml` runs eight jobs, listed below; `.github/workflows/audit.yml` runs two more, `npm-audit` and `cargo-audit`.

- **build-ts** - `npm run build` (strict type-check + production bundle) followed by the `npm run check:bundle` size guard.
- **test-ts** - `npx vitest run`.
- **test-rust** - `cargo test --lib` inside `wasm-engine/`.
- **lint-ts** - `npm run check:mojibake` then `npm run lint` (`eslint .`); zero-warning gate.
- **lint-rust** - `cargo clippy --all-targets -- -D warnings` inside `wasm-engine/`; zero-warning gate.
- **e2e** - `npm run test:e2e`, a Playwright Chromium suite covering boot, accessibility (axe-core), and the Compare, Optimizer and Sandbox flows.
- **wasm-fresh** - rebuilds the WASM bundle and compares its behaviour against the committed one, matchup by matchup; fails when they disagree.
- **bundle-load** - `npm run test:bundle`, which cold-loads the built `dist/` through `vite preview`.

## Repository layout

```
src/                  Vite + React + TypeScript frontend
  pages/              one component per route (Compare, BestBuilds, Sandbox, Optimizer,
                      Custom, Search, Reference, Contact, Credits, Donate)
  components/         shared UI + per-page panels
  engine/             TypeScript helpers + the sandbox WASM bridge surface
  hooks/              React hooks driving the engine pages (Compare, Sandbox, ...)
  optimizer/          Best Builds flow, scoring, and the matchup WASM bridge
  shared/             cross-cutting types + DSL + share/import bundles
  rust-pkg/           pre-built WASM bundle (committed; regenerated by npm run rust:build)
wasm-engine/          Rust crate - the combat engine
  src/composable/     event-loop driver (mod.rs) + phases/ submodule + sandbox
  src/policy/         active-timing decision engine + per-ability decisions
  src/effects.rs      EffectKind enum - user-ability effect primitives
data/                 runtime JSON imported directly by the frontend (creatures, plushies, ...)
docs/                 architecture and design references
notes/                ability-model scope + known engine behaviours
scripts/              profiling, fixture generators, maintenance helpers
tools/                wiki sync, creature editor, effects-catalog sync, reference-test scaffolding
e2e/                  Playwright smoke suite
public/               static assets shipped as-is (icons, _headers, robots.txt, ...)
run_wiki_sync_review.bat   Windows wrapper that runs the wiki sync with its review prompts
```

## Documentation

The docs in `docs/` are the place to look for design context:

- [architecture.md](docs/architecture.md) - single-page architecture overview.
- [adding-an-ability.md](docs/adding-an-ability.md) - walkthrough for the most common contribution.
- [policy_engine_pillars.md](docs/policy_engine_pillars.md) - design contract for the active-timing decision engine.
- [reference_style.md](docs/reference_style.md) - authoring rules for `referenceContent.ts` entries.
- [optimizer.md](docs/optimizer.md) - when to use Optimizer vs Best Builds vs Compare vs Sandbox.

## License

GNU Affero General Public License v3.0 only - see [LICENSE](LICENSE). Copyright (c) 2026 Tymamatyty (`cos.pvp.contact@gmail.com`).

Contributing implies agreement to release your contribution under AGPL-3.0-only. The copyright notice in `LICENSE` covers all contributions; preserve it in derivative works.
