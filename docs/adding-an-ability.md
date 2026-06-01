# Adding a new ability

Walkthrough for the single most common contribution. The pattern is well-trodden — the ~250 reference entries already shipped cover most shapes, so the fastest start is usually to find a similar one and follow it.

There are two flavors of "ability":

- **Passive** — always on; modifies the engine's behavior every iteration. It has no fire decision: the effect is a standing rule the combat/status layers apply whenever the relevant moment occurs. Resistances (Block Bleed, Breath Resistance, Warden's Resistance), on-hit-taken status application (Defensive Bleed, Sticky Fur, Serrated Teeth, Wing Shredder), and conditional damage rules (First Strike, Unbreakable) are all passive.
- **Active** — a discrete fire decision the policy engine schedules and times. It has a trigger condition, often a cooldown, and the engine chooses *when* to commit it (Fortify, Cocoon, Adrenaline, Cause Fear, Reflect, Totem).

The deciding question is whether there is a fire decision to schedule. If the effect just *is* (it changes a number, resists a status, or reacts to an event the engine already runs), it is passive. If the engine has to pick a moment to activate it, it is active.

A few classifications are not obvious from the name:

- **Self-Destruct** is **passive** — it is a standing special-event rule, not a scheduled activation.
- **First Strike** is **passive** — a generic conditional damage rule that lives in the combat/stat layer, not an activated contour.
- **Harden** is **active** — despite reading like a standing buff, it is a triggered activation the policy engine commits.

## Five-step ritual

### 1. Reference entry

Open `src/pages/referenceContent.ts` and add the ability. Style rules live in [docs/reference_style.md](reference_style.md). The entry is the **authoritative spec** — code, Reference, and observed game behavior must converge. If you discover a mismatch, raise it for the maintainer to arbitrate rather than silently shipping one side.

Pick a stable `id` (e.g. `ability_x_aura`). The coverage gate in `src/pages/referenceCoverage.test.ts` requires every entry whose `mechanics` array is non-empty to be backed by a test that carries a matching `[REF:<id>]` marker (see step 4). Until that test exists, the build fails — either add the test or, if coverage is intentionally deferred, regenerate the baseline:

```bash
npx tsx tools/generate_reference_coverage_baseline.ts
```

### 2. Wire the field through the Compare path

If the ability introduces a new stat or config flag the engine needs to read, follow the four-step bridge ritual. Compare runs the Rust engine only, so a TS-only change is a silent no-op in Compare — skip any of these four steps and the field is dropped at the bridge. This is the most common source of "I added the field but Compare ignores it" bugs.

1. Add the field to `SimpleCombatantStats` (`wasm-engine/src/contracts.rs`) or `ComposableAbilityConfig` (`wasm-engine/src/composable/config.rs`) in Rust, annotated `#[serde(default)]` so old payloads still deserialize.
2. Mirror it in the `RustSimpleCombatantStats` / `RustComposableAbilityConfig` types in `src/optimizer/rustMatchupBridge.ts`.
3. Thread it from `FinalStats` through the stat/breath builders `toRustStatusMeleeStats` / `toRustBreathProfile` (defined in `src/optimizer/rustBestBuildsRuntime.ts`) and the `addCompareRuntimeFlags` builder (defined in `src/optimizer/rustCompareMatchupRuntime.ts`, which imports and calls the first two). The Compare path is orchestrated by `src/hooks/useCompareSimulation.ts`.
4. Implement the effect in Rust.

### 3. Rust implementation

Where the code goes depends on the ability shape. Combat sub-steps live in the `composable/phases/` submodule — `breath.rs`, `melee.rs`, `misc.rs`, `mod.rs`, `phase4.rs`, `post_tick.rs`, `scheduler.rs`, `status.rs` — each holding `process_phase_*` functions. These are dispatched by `run_one_event_loop_iter` in `composable/loop_iter.rs`, which the `simulate_composable_matchup_with_trace_control` driver in `composable/mod.rs` calls once per iteration — so the phases are driven transitively through `run_one_event_loop_iter`, not directly by the named driver fn.

| Ability shape | Where it lives |
|---|---|
| **Passive that ticks** (Harden's regen multiplier, breath resistance) | Extend the relevant `process_phase_*` function in `wasm-engine/src/composable/phases/`. Often a single conditional branch. |
| **Passive triggered by an event** (Reflect on bite-taken, First Strike threshold) | Same — drop a branch into the phase that already runs at the right moment (`process_phase_10_11_melee` in `melee.rs` for bite events, `process_phase_14_15_breath` in `breath.rs` for breath, etc.). |
| **Active with simple timing** (Adrenaline, Hunters Curse) | New file under `wasm-engine/src/policy/decisions/`. Implement the decision trait from `policy/traits.rs` and register the id in `policy/decisions/mod.rs`. |
| **Active with stateful behavior** (Cocoon, Rewind) | As above, plus state on the combatant side in `wasm-engine/src/composable/side.rs`. Watch the determinism contract — every piece of state must be reset and reproducible run-to-run. |
| **Whole new combat phase** (rare) | A new `process_phase_X` function in the appropriate `composable/phases/` file, wired into the driver in `composable/mod.rs`. |

A useful shortcut: search for an ability that does something similar and follow its pattern.

### 4. Tests

Two layers minimum:

- **Reference test** under `wasm-engine/src/composable/reference_tests/`, one file per entry named after the id with its prefix stripped (entry `ability_x_aura` lives in `x_aura.rs`). Scaffold it:

  ```bash
  npx tsx tools/scaffold_reference_test.ts ability_x_aura
  ```

  This creates the file, registers the `mod` line in `reference_tests/mod.rs`, and seeds a marker comment plus helper imports. Replace the TODOs with real assertions against observable engine behavior (post-fight HP, log entries, status stacks). Build scenarios with the `default_combatant()` and `applied_status()` helpers in `reference_tests/mod.rs` rather than hand-spelling every field — that keeps the test insulated from future field additions. Each test body must contain `// [REF:ability_x_aura]` so the coverage gate sees it, and the id must be removed from `src/pages/referenceCoverage.baseline.json`.
- **Phase-isolation test** in `wasm-engine/src/composable/phase_tests.rs` if you added a branch to a `process_phase_*` function and want to assert that branch fires in isolation. Not always needed — the reference test usually covers it through the end-to-end driver.

For an active ability with policy logic, add a unit test in the decision's own module or under `wasm-engine/src/policy/tests/`.

### 5. Verify and ship

```bash
cd wasm-engine
cargo test --lib                     # engine tests
cargo clippy --all-targets -- -D warnings   # clippy gate (separate from eslint)
cd ..
npm run build                        # tsc -b + vite build (required if any TS surface changed)
npx vitest run                       # frontend tests (if any TS surface changed)
npm run lint                         # eslint . (TS lint gate)
npm run check:mojibake               # encoding guard
```

> `npx tsc --noEmit` is a false positive here — the root `tsconfig.json` is references-only, so it exits 0 without checking anything. Always go through `npm run build`.

If everything passes and you changed Rust, **rebuild the WASM bundle** so the change reaches the running app:

```bash
npm run rust:build                   # wasm-pack
```

CI does not rebuild WASM — the regenerated `src/rust-pkg/` artifacts must be committed alongside the source change, or the deployed engine silently lags behind.

## A short worked example

To add a passive *"X-Aura: while on the field, deals 5 true damage per second to the opponent"*:

1. **Reference entry** in `src/pages/referenceContent.ts`:
   ```ts
   { id: "ability_x_aura", name: "X-Aura", role: "passive",
     mechanics: ["deals 5 true damage per second to the opponent as long as the caster is alive."],
     // ... rest of the entry fields per docs/reference_style.md.
   }
   ```
2. **Wire the field**: not needed here — the aura keys off the caster's passive-ability list rather than a new stat, so the bridge ritual is skipped.
3. **Rust implementation**: add a branch to the aura cluster in `composable/phases/phase4.rs` (`process_phase_4_aura_and_trails_cluster`) that, when the caster carries X-Aura and is alive, deals 5 true damage per second to the opponent.
4. **Test**: scaffold `wasm-engine/src/composable/reference_tests/x_aura.rs` with `npx tsx tools/scaffold_reference_test.ts ability_x_aura`. Set up a matchup with one side carrying X-Aura, run for 10 seconds of sim time, and assert the opponent's HP dropped by 50 within a tiny tolerance. Keep the `// [REF:ability_x_aura]` marker in each test body, and drop `ability_x_aura` from `referenceCoverage.baseline.json`.
5. **Verify**:
   ```bash
   cd wasm-engine && cargo test --lib x_aura       # focused
   cargo test --lib                                # full sweep
   ```
   Once green, run `npm run rust:build` and commit the rebuilt `src/rust-pkg/` artifacts.

## When to stop and ask

**Stop and ask the maintainer** rather than pushing through if:

- Reference, code, or observed game behavior disagree.
- Your fix breaks three or more unrelated fixtures.
- A new mechanic produces a "wrong winner" in any fixture — a signal that the new logic is mis-routed.
- The change is architectural (engine boundary, `SimpleCombatantStats` schema, the core policy engine under `policy/`).
- You would be deleting or renaming an existing Reference entity, even if it looks dead.

Surface format:

```
STOP: <trigger>
Context: ...
Options: A / B / C
Recommend: A because ...
Question: which do you want me to take?
```
