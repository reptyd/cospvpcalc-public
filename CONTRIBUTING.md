# Contributing

Thanks for your interest in working on the Creatures of Sonaria PvP Calculator. This document covers the minimum to get a fork running, the full verification stack, and the conventions the project relies on.

## Development setup

```bash
git clone <your fork URL>
cd cos-calc
npm install
npm run dev      # Vite dev server at http://localhost:5173
```

The frontend imports a pre-built WASM bundle from `src/rust-pkg/`, so the dev server runs without a Rust toolchain installed.

### Working on the Rust engine

The combat engine is a Rust crate in `wasm-engine/`, compiled to WASM with `wasm-pack`. To test it directly:

```bash
cd wasm-engine
cargo test --lib    # unit + reference + phase isolation + fixture tests
```

After Rust changes that should ship to the running site, rebuild the WASM bundle:

```bash
npm run rust:build    # wasm-pack build -> src/rust-pkg/
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
- Doc-only change: optionally `npm run build` to catch broken Markdown anchors, plus `npm run check:mojibake`.

Single Rust test by substring: `cargo test --lib <substring>` from `wasm-engine/`.

## Continuous integration

`.github/workflows/ci.yml` runs six required jobs on every push and pull request. All six must pass:

- **build-ts** - `npm run build` (`tsc -b` strict type-check + `vite build`), then `npm run check:bundle` to guard initial-paint asset size.
- **test-ts** - `npx vitest run`.
- **test-rust** - `cargo test --lib` inside `wasm-engine/`.
- **lint-ts** - `npm run check:mojibake`, then `npm run lint` (`eslint .`). Zero-warning gate.
- **lint-rust** - `cargo clippy --all-targets -- -D warnings` inside `wasm-engine/`. Zero-warning gate.
- **e2e** - `npm run test:e2e`: a Playwright Chromium smoke suite (app boots, top-level navigation works) including an axe-core accessibility gate.

CI does not run `npm run rust:build`. If your change touches Rust, commit the rebuilt `src/rust-pkg/` so CI and the live site see it.

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
- **Policy / active-timing engine:** the `policy/` tree (`mod.rs`, `registry.rs`, `traits.rs`, `light_projection.rs`, `state.rs`, `timing_mode.rs`, `user_ability.rs`, `decisions/`, `tests/`). Built-in timing modes are `really_fast`, `fast`, `semi_ideal`, `ideal`, and `extreme`, plus user-defined timing specs.
- **TS<->WASM bridge:** `src/optimizer/rustMatchupBridge.ts` + `src/optimizer/rustMatchupLoader.ts`. Compare enters through `src/hooks/useCompareSimulation.ts`. The Sandbox uses `composable/sandbox.rs` (Rust) + `src/engine/sandboxBridge.ts` + `src/hooks/useSandboxSimulation.ts`.

See [docs/architecture.md](docs/architecture.md) for the architectural overview and [docs/adding-an-ability.md](docs/adding-an-ability.md) for the most common contribution flow.

## Code conventions

- **TypeScript** strict mode is on; no `any` without an inline comment justifying it.
- **Rust:** `rustfmt` defaults; the engine targets a warning-free `cargo clippy --all-targets -- -D warnings`.
- **Comments** explain *why*, not *what*. Restating the code is an anti-pattern - trust well-named identifiers to communicate intent.
- **Combat math lives in Rust.** Only pure-math primitives (`applyRulesAndBuild`, `computeMeleeDamagePerHit`, `computeBreathDamage`) live on the TS side, where they feed the Rust-bridge mappers.
- **Reference text** in `src/pages/referenceContent.ts` is the authoritative mechanic spec. Code, Reference, and observed game behavior must converge - disagreements get surfaced to the maintainer to arbitrate before code changes land.
- **Data refresh discipline:** if `data/*.runtime.json` files are re-scraped from the wiki, run `node scripts/strip_unused_data_fields.mjs` before committing to remove HTML noise from the runtime payloads. The script is idempotent.

## Wiring a new field through Compare

The Rust engine is the source of truth. Adding a new field that Compare should respect is a four-step sequence:

1. Add the field to `SimpleCombatantStats` or `ComposableAbilityConfig` in Rust with `#[serde(default)]`.
2. Mirror it in `RustSimpleCombatantStats` / `RustComposableAbilityConfig` in `src/optimizer/rustMatchupBridge.ts`.
3. Wire from `FinalStats` in `toRustStatusMeleeStats` / `toRustBreathProfile` / `addCompareRuntimeFlags` / `useCompareSimulation.ts`.
4. Implement the effect inside the relevant `process_phase_*` function (or add a new phase, if needed).

Skip any of these four and the field is silently dropped at the bridge. See [docs/adding-an-ability.md](docs/adding-an-ability.md) for the full walkthrough, including the Reference entry and isolation test.

## Commit messages

Concise imperative summaries with a body explaining the *why*:

```
Module: short summary in <70 chars

Body explains motivation: what was wrong, what changed, what side
effects exist. Use the body to record decisions a future reader
(including future you) would otherwise have to reverse-engineer.
```

When a change touches the Rust engine, commit the rebuilt `src/rust-pkg/` in the same change so the bundle never drifts from the source.

## License

By contributing, you agree that your contributions are released under the [GNU Affero General Public License v3.0 only](LICENSE) and that you have the right to release them under that license. The copyright notice in `LICENSE` (Copyright (C) 2026 Tymamatyty) covers all contributions; preserve it in derivative works as the license requires.

AGPL imposes a source-disclosure obligation on any network-served derivative - if you self-host or modify this project for public use, you must publish your source under AGPL too. Attribution to the original author is required.
