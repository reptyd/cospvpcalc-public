# Creatures of Sonaria PvP Calculator (Recode)

A data-driven PvP calculator and matchup optimizer for *Creatures of Sonaria* (Recode version). Compare creature builds, search for best builds against a roster, manually step through combat in a sandbox, and author custom abilities + timing policies in a text DSL — all running against the same deterministic Rust combat engine compiled to WebAssembly.

Live site: <https://cospvpcalc.ru/>. Released under the [GNU Affero General Public License v3.0 only](LICENSE) — (c) 2026 Tymamatyty.

This is a developer-focused README. End users do not need this repo — the live site is the product. This document is for anyone forking, contributing, or studying the architecture.

## Contents

- [What's in here](#whats-in-here)
- [Quickstart](#quickstart)
- [Tech stack](#tech-stack)
- [Browser support](#browser-support)
- [Architecture](#architecture)
- [Tests and verification](#tests-and-verification)
- [Repository layout](#repository-layout)
- [Documentation](#documentation)
- [License](#license)

## What's in here

The app is a set of top-level pages, all sharing the same WASM combat engine:

- **Compare** — head-to-head matchup between two creature builds with full build customization (traits, veneration, plushies, breath, actives, and the effect catalog). Renders a turn-by-turn combat log + a result summary.
- **Best Builds** — exhaustive build search for a chosen creature against an opponent pool. Results ranked by win rate / TTK / damage delta.
- **Optimizer** — counter-mode build search: fix Creature A's build, optimize Creature B against it. A single-mode wrapper over the Best Builds engine.
- **Sandbox** — a step-through debugger for a single matchup: advance by time or by event, force-fire bite / breath / abilities, and inspect per-side internal state.
- **Custom** — author new abilities and timing policies in a Python-like text DSL (or a visual constructor), live-test them against the roster, and share. Sub-tabs cover creatures, abilities, timings, and statuses. Specs evaluate inside the same Rust dispatch path as built-ins.
- **Search** — filter creatures by numeric stats with multi-field predicates.
- **Reference** — renders the user-authored mechanic spec (what each status / ability / plushie does) from `src/pages/referenceContent.ts`.

Minor pages: Contact, Credits, Donate.

**Share / Report.** A "Share / Report" button builds a match-snapshot URL (prefix `COSM1:`, carried in the `?match=` query param) that captures the open page's state plus a diagnostic block. There is no in-app bug tracker — reporting a problem means pasting the share link to the Contact channel (email `cos.pvp.contact@gmail.com` / Discord). The custom library exports and imports as a JSON bundle (prefix `cosab1:`).

## Quickstart

```bash
git clone https://github.com/reptyd/cospvpcalc-public.git
cd cospvpcalc
npm install
npm run dev          # Vite dev server, http://localhost:5173
```

A pre-built WASM bundle ships in `src/rust-pkg/`, so the frontend runs without a Rust toolchain. If you change Rust code, rebuild the bundle via `npm run rust:build` (`wasm-pack`) and commit the regenerated `src/rust-pkg/` — CI does not rebuild it, so an un-rebuilt change is silently absent from the running engine. Full procedure in [CONTRIBUTING.md](CONTRIBUTING.md).

If the WASM bundle fails to load (asset 404, disabled WebAssembly), the UI surfaces a bridge-status banner and the engine-driven pages stay empty. There is no JavaScript fallback path — combat math lives only in the Rust engine, so TS-only changes to combat logic are no-ops on the live engine.

## Tech stack

- **Frontend:** Vite + React 19 + TypeScript (strict). Self-hosted fonts (`@fontsource`), no runtime CSS framework. Bundle chunked to keep the initial paint small.
- **Combat engine:** Rust crate in `wasm-engine/`, compiled to WASM with `wasm-pack`. Event-loop architecture driven by `simulate_composable_matchup_with_trace_control` in `composable/mod.rs`; the per-step `process_phase_*` functions live in the `composable/phases/` submodule. Single source of truth for all combat math.
- **Policy / active-timing engine:** the `policy/` tree picks when to fire active abilities. Built-in timing modes — `really_fast`, `fast`, `semi_ideal`, `ideal`, `extreme` — share infrastructure with user-defined `UserTimingSpec` policies.
- **Custom-ability DSL:** a Python-like text mode parses and prints `UserAbilitySpec`. A plain `<textarea>` with an inline parser-error overlay is used instead of a heavyweight editor; a visual constructor offers the same surface without writing text.
- **Hosting:** Cloudflare Pages, static-only. CSP / HSTS / COOP / COEP enforced via `public/_headers`.

The choice of Rust -> WASM over a pure-TS engine is driven by two needs: (1) determinism — the same inputs must produce the same combat log regardless of host, including in the Best Builds optimizer which runs millions of matchups, and (2) speed — the Best Builds search wants single-digit milliseconds per fight, achievable in Rust without sacrificing readability.

## Browser support

The app targets the **last two stable releases** of the major evergreen engines. There is no legacy build and no polyfills — the hard runtime requirements are **WebAssembly** and **ES2022 ES modules** (plus `fetch`, `Promise`, `globalThis`).

| Browser | Supported |
| --- | --- |
| Chrome / Edge (desktop) | last 2 stable |
| Firefox (desktop) | last 2 stable + current ESR |
| Safari (macOS) | last 2 stable |
| Safari (iOS) | last 2 stable |
| Chrome (Android) | current stable |

(Build `browserslist`: `last 2 {Chrome,Firefox,Safari,Edge} versions`, `Firefox ESR`, `not dead`; TypeScript/Vite target ES2022.)

`src/main.tsx` feature-detects these before mounting React. A browser that loads the app but lacks WebAssembly (or `fetch` / `Promise`) gets a clear **"This browser is too old"** message instead of a blank page; with JavaScript disabled, an equivalent `<noscript>` notice is shown. Browsers too old to parse ES modules at all (pre-2018, e.g. IE) are unsupported by design — they silently ignore the module entry script, and the strict CSP (`script-src 'self' 'wasm-unsafe-eval'`, no inline scripts) rules out a `nomodule` shim.

## Architecture

Quick map of the load-bearing pieces:

- **Driver:** `wasm-engine/src/composable/mod.rs` — `simulate_composable_matchup_with_trace_control` runs the event-loop iterations and time advance.
- **Phases:** `wasm-engine/src/composable/phases/` — an 8-file submodule (`breath`, `melee`, `misc`, `mod`, `phase4`, `post_tick`, `scheduler`, `status`) holding the `process_phase_*` functions, one cluster per combat sub-step (bite, breath, status tick, status block, etc.). Each has at least one isolation test in `composable/phase_tests.rs`.
- **Policy / active-timing engine:** the `wasm-engine/src/policy/` tree — `mod.rs`, `registry.rs`, `traits.rs`, `light_projection.rs`, `state.rs`, `timing_mode.rs`, `user_ability.rs`, the per-decision modules under `decisions/`, and `tests/`.
- **Reference tests:** `wasm-engine/src/composable/reference_tests/` — one file per `referenceContent.ts` entry, marked with `[REF:<id>]` so the coverage test in the vitest suite (`src/pages/referenceCoverage.test.ts`, run by the `test-ts` job) can verify coverage.
- **Fixture harness:** `wasm-engine/src/fixture_tests.rs` — end-to-end matchup fixtures.
- **TS <-> WASM bridge:** `src/optimizer/rustMatchupBridge.ts` + `src/optimizer/rustMatchupLoader.ts`.
- **Compare entry:** `src/hooks/useCompareSimulation.ts`.
- **Sandbox:** `wasm-engine/src/composable/sandbox.rs` (Rust event-loop session) + `src/engine/sandboxBridge.ts` (WASM bridge) + `src/hooks/useSandboxSimulation.ts` (React hook). Force-actions mutate state directly to guarantee only the requested action fires.

Deeper architectural reference: [docs/architecture.md](docs/architecture.md). Walkthrough for adding a new ability: [docs/adding-an-ability.md](docs/adding-an-ability.md).

## Tests and verification

The local verification stack — run these before considering a change verified:

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

After changing Rust, rebuild the WASM bundle with `npm run rust:build` and commit the regenerated `src/rust-pkg/` — CI does not rebuild it.

CI (`.github/workflows/ci.yml`) gates every PR on six jobs:

- **build-ts** — `npm run build` (strict type-check + production bundle) followed by the `npm run check:bundle` size guard.
- **test-ts** — `npx vitest run`.
- **test-rust** — `cargo test --lib` inside `wasm-engine/`.
- **lint-ts** — `npm run check:mojibake` then `npm run lint` (`eslint .`); zero-warning gate.
- **lint-rust** — `cargo clippy --all-targets -- -D warnings` inside `wasm-engine/`; zero-warning gate.
- **e2e** — `npm run test:e2e`, a Playwright Chromium smoke suite (boot + top-level navigation) that includes an axe-core accessibility gate.

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
wasm-engine/          Rust crate — the combat engine
  src/composable/     event-loop driver (mod.rs) + phases/ submodule + sandbox
  src/policy/         active-timing decision engine + per-ability decisions
  src/effects.rs      EffectKind enum — user-ability effect primitives
data/                 runtime JSON imported directly by the frontend (creatures, plushies, ...)
docs/                 architecture and design references
scripts/              profiling, fixture generators, maintenance helpers
tools/                wiki sync + creature-editor tooling (wiki-sync.ts, creature-editor.ts)
e2e/                  Playwright smoke suite
public/               static assets shipped as-is (icons, _headers, robots.txt, ...)
```

## Documentation

The docs in `docs/` are the place to look for design context:

- [architecture.md](docs/architecture.md) — single-page architecture overview.
- [adding-an-ability.md](docs/adding-an-ability.md) — walkthrough for the most common contribution.
- [policy_engine_pillars.md](docs/policy_engine_pillars.md) — design contract for the active-timing decision engine.
- [reference_style.md](docs/reference_style.md) — authoring rules for `referenceContent.ts` entries.
- [optimizer.md](docs/optimizer.md) — when to use Optimizer vs Best Builds vs Compare vs Sandbox.

## License

GNU Affero General Public License v3.0 only — see [LICENSE](LICENSE). Copyright (c) 2026 Tymamatyty (`cos.pvp.contact@gmail.com`).

The AGPL choice protects the project from paywall-fork scenarios: any web-served derivative must publish its full source under AGPL, which keeps the original work free for community use even when a fork wants to charge for hosted access. Substantial new functionality added by a third-party developer can still be released commercially as long as the source is published under AGPL.

Contributing implies agreement to release your contribution under AGPL-3.0-only. The copyright notice in `LICENSE` covers all contributions; preserve it in derivative works. Attribution to the original author is required by the license.
