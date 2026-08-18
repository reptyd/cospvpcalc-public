# Adding a new ability

`src/pages/referenceContent.ts` holds 328 entries across seven `*_REFERENCE_DRAFTS` arrays; find the one whose shape matches the ability being added and follow it.

There are two flavors of "ability":

- **Passive** - the engine applies it on every iteration and never decides when to fire it. The combat and status phases apply it at the moment their own rule matches: a resistance where damage is computed, an on-hit-taken status where a bite lands. Resistances (Block Bleed, Breath Resistance, Warden's Resistance), on-hit-taken status application (Defensive Bleed, Sticky Fur, Serrated Teeth, Wing Shredder), and conditional damage rules (First Strike, Unbreakable) are all passive.
- **Active** - a discrete fire decision the policy engine schedules and times. It has a trigger condition, often a cooldown, and the engine chooses *when* to commit it (Fortify, Cocoon, Adrenaline, Cause Fear, Reflect, Totem).

An ability is passive when nothing schedules it: it changes a number, resists a status, or runs on an event the engine already raises. It is active when the engine picks the moment it fires.

A few classifications are not obvious from the name:

- **Self-Destruct** is **passive** - it is a standing special-event rule, not a scheduled activation.
- **First Strike** is **passive** - a conditional damage rule the combat and stat layers apply. It carries no `contour*` flag.
- **Harden** is **active** - despite reading like a standing buff, it is a triggered activation the policy engine commits.

## The steps

### 1. Registry record

Add one record to `ABILITY_REGISTRY` in `src/optimizer/abilityRegistry.ts`. One record is the only source for the name-to-capability lists: fifteen `derive*` functions in the same file read its flags and build them, among them `COMPOSABLE_SUPPORTED_ACTIVATED/PASSIVE_NAMES`, the narrow `MODELED_OTHER_ABILITIES` list, the four `CONTOUR_*` sets, `OVERRIDE_KEYS`, `GENERIC_TRAIL_STATUS`, and the `BOOL`/`VALUE_CONFIG_GATES`. You set only the flags that apply; the `derive*` functions read flags, not position, so the grouping in the file is for the reader.

The `configGate` field is what feeds Compare *and* Best Builds: both paths build their `RustComposableAbilityConfig` through the single `buildAbilityConfig` (`src/optimizer/buildAbilityConfig.ts`), which reads the registry gates. One `configGate` row wires a gated activated ability into both paths. No other list needs an edit.

A worked example, mirroring the real `Cause Fear` entry - an activated ability the engine routes, with a presence (`bool`) Compare gate:

```ts
{
  name: "Cause Fear",
  composableActivated: true,
  modeledOther: true,
  configGate: { attackerKey: "attackerCauseFear", defenderKey: "defenderCauseFear", kind: "bool" },
},
```

- `composableActivated` puts it in `COMPOSABLE_SUPPORTED_ACTIVATED_NAMES`.
- `modeledOther` credits it in the narrow engine-facing list, which feeds `COMPOSABLE_ROUTED_NAMES` - the registry-derived set the fail-open eligibility keys on, so the carrier's matchup stays eligible.
- `configGate` (`kind: "bool"`) derives a `BOOL_CONFIG_GATES` row; `buildAbilityConfig` flips `attackerCauseFear` / `defenderCauseFear` from the carrier's activated-ability list. Use `kind: "value"` for numeric magnitudes instead (see `Life Leech`, `Spite`).

Other flags follow the same one-row-per-membership shape: `composablePassive`, `overrideKey`, the `contour*` flags, and `genericTrailStatusId` (the engine status id a non-flavor trail rides). A name can carry several at once - `Hunker` is both activated- and passive-supported with an override key; `Adrenaline` is activated-supported and carries `contourNoEffectPassive`.

### 2. Reference entry

Open `src/pages/referenceContent.ts` and add the ability. Style rules live in [docs/reference_style.md](reference_style.md). The entry is the **authoritative spec** - code, Reference, and observed game behavior must converge. If you discover a mismatch, raise it for the maintainer to arbitrate rather than silently shipping one side.

Pick a stable `id` (e.g. `ability_x_aura`). The coverage gate in `src/pages/referenceCoverage.test.ts` requires every entry whose `mechanics` array is non-empty to be verified somewhere: a test that both carries a matching `[REF:<id>]` marker **and asserts something** (see step 5). A body carrying nothing but the marker does not count. Until the entry is verified the build fails - either write the check or, if coverage is intentionally deferred, regenerate the baseline and give the id a reason naming the layer the mechanic runs in. The same test requires the reason to be at least 40 characters and to contain a path segment matching `src/`, `wasm-engine/`, `data/`, `tools/` or `scripts/`:

```bash
npx tsx tools/generate_reference_coverage_baseline.ts
```

### 3. Wire a new engine field through the Compare path

The registry record drives the existing `RustComposableAbilityConfig` fields. It does *not* create a new engine stat or config field - if the ability needs one (a new passive stat or a config flag the engine reads), the Non-negotiable §1 schema path still applies by hand. Compare runs the Rust engine only, so a TS-only change is a silent no-op in Compare - skip any of these four steps and the field is dropped at the bridge. This is the most common source of "I added the field but Compare ignores it" bugs.

1. Add the field to `SimpleCombatantStats` (`wasm-engine/src/contracts.rs`) or `ComposableAbilityConfig` (`wasm-engine/src/composable/config.rs`) in Rust, annotated `#[serde(default)]` so old payloads still deserialize. `SimpleCombatantStats` has a `Default` impl and its builders use `..Default::default()`, so a new passive field defaults to zero/false/`None` without forcing an edit across every exhaustive struct literal.
2. Mirror it in the `RustSimpleCombatantStats` / `RustComposableAbilityConfig` types in `src/optimizer/rustMatchupBridge.ts`.
3. Thread it from `FinalStats` through the stat/breath builders `toRustStatusMeleeStats` / `toRustBreathProfile` (defined in `src/optimizer/rustBestBuildsRuntime.ts`) and the `addCompareRuntimeFlags` builder (defined in `src/optimizer/rustCompareMatchupRuntime.ts`, which imports and calls the first two). The Compare path is orchestrated by `src/hooks/useCompareSimulation.ts`.
4. Implement the effect in Rust.

### 4. Rust implementation

Where the code goes depends on the ability shape. Combat sub-steps live in the `composable/phases/` submodule - `breath.rs`, `melee.rs`, `misc.rs`, `mod.rs`, `phase4.rs`, `post_tick.rs`, `scheduler.rs`, `status.rs` - each holding `process_phase_*` functions. These are dispatched by `run_one_event_loop_iter` in `composable/loop_iter.rs`, which the `simulate_composable_matchup_with_trace_control` driver in `composable/mod.rs` calls once per iteration - so the phases are driven transitively through `run_one_event_loop_iter`, not directly by the named driver fn.

| Ability shape | Where it lives |
|---|---|
| **Passive that ticks** (Harden's regen multiplier, breath resistance) | Extend the relevant `process_phase_*` function in `wasm-engine/src/composable/phases/`. Often a single conditional branch. |
| **Passive triggered by an event** (Reflect on bite-taken, First Strike threshold) | Same - drop a branch into the phase that already runs at the right moment (`process_phase_10_11_melee` in `melee.rs` for bite events, `process_phase_14_15_breath` in `breath.rs` for breath, etc.). |
| **Active with simple timing** (Adrenaline, Hunters Curse) | New file under `wasm-engine/src/policy/decisions/`. Implement the decision trait from `policy/traits.rs` and register the id in `policy/decisions/mod.rs`. |
| **Active with stateful behavior** (Cocoon, Rewind) | As above, plus state on the combatant side in `wasm-engine/src/composable/side.rs`. Watch the determinism contract - every piece of state must be reset and reproducible run-to-run. |
| **Whole new combat phase** (rare) | A new `process_phase_X` function in the appropriate `composable/phases/` file, wired into the driver in `composable/mod.rs`. |

`rg "composableActivated: true" src/optimizer/abilityRegistry.ts` lists the activated abilities already routed; open the phase file or `policy/decisions/` module of the closest one.

### 5. Tests

Two layers minimum:

- **Reference test** under `wasm-engine/src/composable/reference_tests/`, one file per entry named after the id with its prefix stripped (entry `ability_x_aura` lives in `x_aura.rs`). Scaffold it:

  ```bash
  npx tsx tools/scaffold_reference_test.ts ability_x_aura
  ```

  This creates the file, registers the `mod` line in `reference_tests/mod.rs`, and seeds a marker comment plus helper imports. Replace the TODOs with real assertions against observable engine behavior (post-fight HP, log entries, status stacks). Build scenarios with the `default_combatant()` and `applied_status()` helpers in `reference_tests/mod.rs` rather than writing every field out: a field added to the struct later then leaves the test compiling. Each test body must contain `// [REF:ability_x_aura]`. The gate counts a marker only in a file that also asserts, so a marker-only stub does not satisfy it. Once the test asserts, remove the id from `src/pages/referenceCoverage.baseline.json`. If no bullet is assertable, leave the test file out and keep the id in the baseline with a reason (see step 2).
- **Phase-isolation test** in `wasm-engine/src/composable/phase_tests.rs` if you added a branch to a `process_phase_*` function and want to assert that branch fires in isolation. Not always needed - the reference test usually covers it through the end-to-end driver.

For an active ability with policy logic, add a unit test in the decision's own module or under `wasm-engine/src/policy/tests/`.

### 6. Verify and ship

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

> `npx tsc --noEmit` is a false positive here - the root `tsconfig.json` is references-only, so it exits 0 without checking anything. Always go through `npm run build`.

If everything passes and you changed Rust, **rebuild the WASM bundle** so the change reaches the running app:

```bash
npm run rust:build                   # wasm-pack
```

No deploy step rebuilds WASM: the committed `src/rust-pkg/` artifacts are what ships, so commit them alongside the Rust change. The `wasm-fresh` CI job rebuilds the engine and fails when the committed bundle behaves differently from the fresh one.

## A short worked example

To add a passive *"X-Aura: while on the field, deals 5 true damage per second to the opponent"*:

1. **Registry record** in `src/optimizer/abilityRegistry.ts`. A passive the engine routes needs `composablePassive` (so the carrier can disable it in Compare) and `modeledOther` (so the matchup stays eligible). No `configGate` - the aura keys off the passive-ability list, not a new config field:
   ```ts
   { name: "X-Aura", composablePassive: true, modeledOther: true },
   ```
2. **Reference entry** in `src/pages/referenceContent.ts`:
   ```ts
   { id: "ability_x_aura", name: "X-Aura", role: "passive",
     mechanics: ["deals 5 true damage per second to the opponent as long as the caster is alive."],
     // ... rest of the entry fields per docs/reference_style.md.
   }
   ```
3. **Wire the field**: not needed here - the aura keys off the caster's passive-ability list rather than a new stat, so the bridge sequence is skipped.
4. **Rust implementation**: add a branch to the aura cluster in `composable/phases/phase4.rs` (`process_phase_4_aura_and_trails_cluster`) that, when the caster carries X-Aura and is alive, deals 5 true damage per second to the opponent.
5. **Test**: scaffold `wasm-engine/src/composable/reference_tests/x_aura.rs` with `npx tsx tools/scaffold_reference_test.ts ability_x_aura`. Set up a matchup with one side carrying X-Aura, run for 10 seconds of simulated time, and assert the opponent's HP dropped by 50, within 1e-6. Keep the `// [REF:ability_x_aura]` marker in each test body, and drop `ability_x_aura` from `referenceCoverage.baseline.json`.
6. **Verify**:
   ```bash
   cd wasm-engine && cargo test --lib x_aura       # focused
   cargo test --lib                                # full sweep
   ```
   Once green, run `npm run rust:build` and commit the rebuilt `src/rust-pkg/` artifacts.

## What catches a mistake

The registry's guard tests map a forgotten or wrong flag back to a named failing test, so an omission fails on the exact list rather than as a silent inert ability or an ineligible matchup:

- **Wrong / flipped registry flag, renamed gate key** - the frozen-snapshot tests in `src/optimizer/abilityRegistry.test.ts` pin each `derive*` output to a literal; a shifted derive fails on the exact list. This is the only guard for the config gates and override keys.
- **Forgot `modeledOther` on a routed ability (carrier silently goes ineligible)** - `src/optimizer/eligibilityUnsupported.test.ts` freezes every creature's unsupported-ability set against a baseline and fails on the exact creature + ability.
- **Routed an ability the engine has no handler for** - `src/optimizer/engineCoverageBoundary.test.ts` pins the split: `COMPOSABLE_ROUTED_NAMES` decides whether a matchup is eligible, and membership in a coverage list does not.
- **Generic trail mis-routed** - `src/optimizer/genericStatusParity.test.ts` requires every Attack/Block/Defensive map status to be generic-supported or an explicit exception.
- **Wrong `configGate` key / a gate field dropped from BB or Compare** - `src/optimizer/buildAbilityConfig.test.ts` snapshots the unified builder's output for both paths and asserts neither drops a shared field.
- **The shipped WASM does not actually run the new wiring** - `src/optimizer/wasmMatchupSmoke.test.ts` runs representative and roster-wide matchups through the rebuilt `src/rust-pkg/*.wasm` (catches a stale bundle, i.e. a forgotten `npm run rust:build`).

## When to check with the maintainer

Raise it rather than pushing through if:

- Reference, code, or observed game behavior disagree.
- Your fix breaks three or more unrelated fixtures.
- A new mechanic produces a "wrong winner" in any fixture - a sign the new logic is mis-routed.
- The change is architectural (engine boundary, `SimpleCombatantStats` schema, the core policy engine under `policy/`).
- You would be deleting or renaming an existing Reference entity, even if it looks dead.

State the options and your recommendation. The maintainer decides.
