# Model Known Behaviors

What the combat model does where the behavior is approximate or intentionally limited.

How to read this file:
- Each item is confirmed current behavior, not a guess - linked to a test or code location
  where possible.
- Each item is intended behavior. Change one as a decision, and read the cited source before
  changing it.

### Core assumptions
- Simulation is 1v1, point-blank, pack off, environment off.
- Posture is not fixed: each side runs its own Sit/Lay/Stand policy, which can sit or lie down
  to trade damage taken for regen and faster ailment decay. See the Sit/Lay/Stand Policy entry.
- `applyRulesAndBuild` ([buildRules.ts](../src/engine/buildRules.ts)) applies the elder weight
  modifier, then veneration, then traits, then `applyPlushies`, and then the remaining elder
  modifiers - damage, bite cooldown, health regeneration, stamina, stamina regeneration,
  ailment block and active cooldown. Plushies apply before that second elder group, not after
  every stat modifier.
- Some passive and active abilities in data are still not modeled. Scope decisions live in
  [ability-model-scope.md](ability-model-scope.md).
- Harden and Hunker apply their combat stat changes; their movement penalties are real and
  stated on both entries, but the fight has no movement for them to act on. Speed Builds reads
  them.
- Rewind restores HP toward the user's value from 9 seconds earlier, capped at 25% max HP. It
  restores HP only - statuses and position are not rewound.

### Structured approximations already represented in code
Source: `KNOWN_APPROXIMATION_REFERENCE_DRAFTS` in
[referenceContent.ts](../src/pages/referenceContent.ts)

Twelve approximations carry their own Reference entry, each stating why the model simplifies
(`whyApproximated`) separately from what it does instead (`currentApproximation`): Bad Omen
outcome resolution, Breath pseudo-crits and pseudo-procs, Broodwatcher, Buffered natural
regeneration, First Tick Rule, Frosty, Hunker first activation, Reflux puddle occupancy,
Special Air PvP Rule, Thorn Trap target behavior, Totem target behavior, and Two-Faced.

`referenceFieldOverlap.test.ts` keeps the two fields from restating each other by counting the
words they share.

### Regression tests that currently protect model behavior

Combat behavior is protected on the Rust side, run by `cargo test --lib` in `wasm-engine/`:

- Phase isolation: `composable/phase_tests.rs`
- Per-entry reference tests: `composable/reference_tests/`, one file per Reference entry
- End-to-end matchups: `fixture_tests.rs`
- Decision layer: `policy/tests/` - edge cases, monotonicity, math-ideal proximity, fixture
  parity, cost budget, reference entries

On the TypeScript side, run by `npx vitest run`:

- The shipped WASM actually running the current wiring:
  [wasmMatchupSmoke.test.ts](../src/optimizer/wasmMatchupSmoke.test.ts)
- Live-roster schema invariants: [dataIntegrity.test.ts](../src/engine/dataIntegrity.test.ts)
- Compare entry point: [useCompareSimulation.test.ts](../src/hooks/useCompareSimulation.test.ts)

### Behaviors no test covers yet
- Special-event timing order for `Self-Destruct` and `Totem`.
- Fight-loop sequencing around simultaneous hits and death snapshots.
- Breath cases with auto-fire plus cooldown plus resource refill.
- Fixtures for a matchup where both sides carry a breath, and for a matchup against a Reflect
  defender.

### Removed, and where the content went

- An earlier `src/engine/approximationNotes.ts` carried a parallel set of sixteen `*_APPROX`
  constants. It was deleted in `80078c28` along with the rest of the TypeScript engine; the
  approximation entries above are where that content lives now, and none of the old constant
  names survive.
- An earlier version of this file recorded an auto-fire delay gate for Spirit Glare, with Burn
  and Fear withheld until a cooldown gate passed. That described the TypeScript breath runtime,
  which no longer exists. The live behavior is in `ability_spirit_glare` in
  [referenceContent.ts](../src/pages/referenceContent.ts).
- The engine-level suites this file used to list (`engine.statuses.test.ts`,
  `engine.specials.test.ts`, `engine.breath.test.ts`, `engine.golden.test.ts`,
  `optimizerPageFlow.test.ts`, `optimizer.test.ts`) were removed with the TypeScript engine.
