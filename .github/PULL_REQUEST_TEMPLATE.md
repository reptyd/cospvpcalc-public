## Summary

<!-- One or two sentences: what does this change do? -->

## What changed and why

<!-- Motivation: what was wrong or missing, and the approach taken. -->

## How verified

Tick what you ran (see CONTRIBUTING.md for the full stack):

- [ ] `npm run build` (tsc -b + vite build)
- [ ] `npx vitest run` (if any TS changed)
- [ ] `cargo test --lib` in `wasm-engine/` (if any Rust changed)
- [ ] `npm run lint` + `npm run check:mojibake`
- [ ] `npm run test:e2e` (if the UI changed)

<!-- If you changed Rust: rebuild the WASM bundle with `npm run rust:build`
     and commit the regenerated `src/rust-pkg/` - CI does not rebuild it. -->
