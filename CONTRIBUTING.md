# Contributing

Thanks for your interest in working on the Creatures of Sonaria PvP Calculator. This document covers the minimum to get a fork running, the full verification stack, and the conventions the project relies on.

## Development setup

Node 20 is the version the project is built and tested on (`.nvmrc`; every CI job that runs Node pins `node-version: "20"`).

```bash
git clone https://github.com/reptyd/cospvpcalc-public.git
cd cospvpcalc-public
npm install
npm run dev      # Vite dev server at http://localhost:5173
```

The frontend imports a pre-built WASM bundle from `src/rust-pkg/`, so the dev server runs without a Rust toolchain installed.

### Working on the Rust engine

The combat engine is a Rust crate in `wasm-engine/`, compiled to WASM with `wasm-pack`. The crate pins Rust 1.93 (`wasm-engine/rust-toolchain.toml`) and builds for the `wasm32-unknown-unknown` target. To test it directly:

```bash
cd wasm-engine
cargo test --lib    # unit + reference + phase isolation + fixture tests
```

After Rust changes that should ship to the running site, rebuild the WASM bundle:

```bash
cargo install wasm-pack --version 0.14.0 --locked   # once; npm install does not provide it
npm run rust:build    # wasm-pack build, then wasm-opt -O over the output
```

**CI does not rebuild the bundle.** The regenerated `src/rust-pkg/` must be committed alongside your Rust changes, or the engine running on the site stays on the old build.

If the bundle is missing or fails to load, the engine-driven views (Compare, Best Builds, Optimizer, Sandbox) stay empty and the bridge-status banner surfaces the error. There is no JavaScript fallback path - TS-only changes to combat logic are silent no-ops on the live engine.

## Verification stack

`npx tsc --noEmit` is a **false positive** in this repo. The root `tsconfig.json` is references-only and exits 0 without checking anything. The real type-check is the `tsc -b` step inside `npm run build`. Never claim verification on `tsc --noEmit` alone.

The full local stack mirrors the CI gates:

```bash
npm run build           # tsc -b && vite build (strict type-check + production bundle)
npx vitest run          # frontend runtime tests
cd wasm-engine && cargo test --lib   # engine tests (phase-isolation, reference, fixtures)
npm run lint            # eslint .
npm run check:mojibake  # UTF-8 -> CP1251 corruption guard over tracked text
npm run check:bundle    # initial-paint asset-size guard
npm run test:e2e        # Playwright Chromium smoke suite (incl. axe-core a11y gate)
```

Scope shortcuts:

- TS-only change: `npm run build` + `npx vitest run` (skip cargo).
- Rust-only change: `cargo test --lib` (skip vitest). Rebuild the bundle (`npm run rust:build`) and commit `src/rust-pkg/`.
- Doc-only change: `npm run check:mojibake`.

Single Rust test by substring: `cargo test --lib <substring>` from `wasm-engine/`.

## Continuous integration

Two workflows run on every push to `main` or `master` and on every pull request.
`.github/workflows/ci.yml` runs eight jobs, listed below, all of which must pass;
`.github/workflows/audit.yml` runs two more, `npm-audit` and `cargo-audit`.

- **build-ts** - `npm run build` (`tsc -b` strict type-check + `vite build`), then `npm run check:bundle` to guard initial-paint asset size.
- **test-ts** - `npx vitest run`.
- **test-rust** - `cargo test --lib` inside `wasm-engine/`.
- **lint-ts** - `npm run check:mojibake`, then `npm run lint` (`eslint .`). Zero-warning gate.
- **lint-rust** - `cargo clippy --all-targets -- -D warnings` inside `wasm-engine/`. Zero-warning gate.
- **e2e** - `npm run test:e2e`: a Playwright Chromium suite covering boot, accessibility (axe-core), and the Compare, Optimizer and Sandbox flows.
- **wasm-fresh** - rebuilds the bundle and compares its behaviour against the committed one, matchup by matchup. It fails when the two disagree.
- **bundle-load** - `npm run test:bundle`: cold-loads the built `dist/` through `vite preview` to catch cross-chunk module-init-order crashes, which `build` and `vitest` are both blind to.

Nothing in CI commits a rebuilt bundle. `wasm-fresh` rebuilds only to compare, so a Rust change landed without `npm run rust:build` still ships inert - commit the regenerated `src/rust-pkg/` yourself. That gate exists because it has happened: Aftershock and Aggressive were inert until someone rebuilt by hand.

## Repository layout

- `src/` - Vite + React + TypeScript frontend.
- `wasm-engine/` - Rust crate: the combat engine and the policy (active-timing) engine.
- `data/` - runtime JSON the frontend imports directly.
- `docs/` - design docs and contributor guides.
- `scripts/` - build helpers, fixture generators, profiling, maintenance scripts.
- `tools/` - wiki-sync and the creature editor.
- `e2e/` - Playwright smoke suite.

### Engine internals

- **Combat driver:** `simulate_composable_matchup_with_trace_control` in `wasm-engine/src/composable/mod.rs` runs the event loop.
- **Combat sub-steps:** the `composable/phases/` submodule (`breath`, `melee`, `misc`, `mod`, `phase4`, `post_tick`, `scheduler`, `status`) holds the `process_phase_*` functions. Each has at least one isolation test in `composable/phase_tests.rs`.
- **Policy / active-timing engine:** the `policy/` tree (`mod.rs`, `registry.rs`, `traits.rs`, `light_projection.rs`, `state.rs`, `timing_mode.rs`, `user_ability.rs`, `user_timing.rs`, `testing.rs`, `decisions/`, `tests/`). Built-in timing modes are `really_fast`, `fast`, `semi_ideal`, `ideal`, and `extreme`, plus user-defined timing specs.
- **TS<->WASM bridge:** `src/optimizer/rustMatchupBridge.ts` + `src/optimizer/rustMatchupLoader.ts`. Compare enters through `src/hooks/useCompareSimulation.ts`. The Sandbox uses `composable/sandbox.rs` (Rust) + `src/engine/sandboxBridge.ts` + `src/hooks/useSandboxSimulation.ts`.

See [docs/architecture.md](docs/architecture.md) for the architectural overview and [docs/adding-an-ability.md](docs/adding-an-ability.md) for the most common contribution flow.

## Code conventions

- **TypeScript** strict mode is on; no `any` without an inline comment justifying it.
- **Rust:** `rustfmt` defaults; the engine targets a warning-free `cargo clippy --all-targets -- -D warnings`.
- **Comments** state why the code is as it is. A comment that restates what the line does is removed.
- **Combat math lives in Rust.** Only pure-math primitives (`applyRulesAndBuild`, `computeMeleeDamagePerHit`, `computeBreathDamage`) live on the TS side, where they feed the Rust-bridge mappers.
- **Reference text** in `src/pages/referenceContent.ts` is the authoritative mechanic spec. Where the entry, the code and observed game behaviour disagree, the maintainer decides which is wrong before any of the three is changed.
- **Register.** Writing or editing that text starts at `docs/reference_style.md`, whose opening register also binds this file, the other three public documents, the interface strings, the code comments and the commit messages.
- **Data refresh discipline:** if `data/*.runtime.json` files are re-scraped from the wiki, run `node scripts/strip_unused_data_fields.mjs` before committing to remove HTML noise from the runtime payloads. The script is idempotent.

A new ability starts with one record in `ABILITY_REGISTRY` (`src/optimizer/abilityRegistry.ts`): fifteen `derive*` functions in that file read its flags and build the capability lists, and its `configGate` feeds both Best Builds and Compare.

## Wiring a new field through Compare

The Rust engine is the source of truth. Adding a new field that Compare should respect is a four-step sequence; the steps below are for a new engine field or passive stat, which the registry record does not cover:

1. Add the field to `SimpleCombatantStats` or `ComposableAbilityConfig` in Rust with `#[serde(default)]`.
2. Mirror it in `RustSimpleCombatantStats` / `RustComposableAbilityConfig` in `src/optimizer/rustMatchupBridge.ts`.
3. Wire from `FinalStats` in `toRustStatusMeleeStats` / `toRustBreathProfile` / `addCompareRuntimeFlags` / `useCompareSimulation.ts`.
4. Implement the effect inside the relevant `process_phase_*` function (or add a new phase, if needed).

A field missing from any of the four steps is dropped at the bridge. No build, test or lint reports it; the field reaches the engine with its `serde(default)` value. See [docs/adding-an-ability.md](docs/adding-an-ability.md) for the full walkthrough, including the Reference entry and isolation test.

## Commit messages

Concise imperative summaries with a body explaining the *why*:

```
Module: short summary in <70 chars

Body explains motivation: what was wrong, what changed, what side
effects exist. Use the body to record decisions a future reader
(including future you) would otherwise have to reverse-engineer.
```

A change to `wasm-engine/` includes the rebuilt `src/rust-pkg/` in the same commit, so no commit contains a bundle built from a different source revision.

## License

By contributing, you agree that your contributions are released under the [GNU Affero General Public License v3.0 only](LICENSE) and that you have the right to release them under that license. The copyright notice in `LICENSE` (Copyright (C) 2026 Tymamatyty) covers all contributions; preserve it in derivative works as the license requires.

AGPL imposes a source-disclosure obligation on any network-served derivative - if you self-host or modify this project for public use, you must publish your source under AGPL too. Attribution to the original author is required.
