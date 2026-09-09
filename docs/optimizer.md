# Optimizer page - when to use it

Five pages answer a build or fight question: Optimizer, Best Builds, Speed
Builds, Compare and Sandbox. Four run the Rust engine - `runBestBuildsFlow`
for Optimizer and Best Builds, `simulate_composable_matchup_with_trace` for
Compare, `SandboxRuntime` for Sandbox. Speed Builds runs no matchup. They
differ in what the user is solving for. Pick the one that matches the
question.

## Optimizer (`src/pages/OptimizerPage.tsx`)

**Question:** "I'm fighting Creature A with a specific build - what's the
best Creature B build to counter that?"

**Inputs:**

- Creature A + a fully-specified build (Veneration / Traits / Ascension /
  Plushies / Elder). The build is locked through the run.
- Creature B (the side the optimizer searches builds for).
- Search settings: Optimization Mode (`fast` / `guaranteed`, mapping to the
  `soft` / `detailed` search depth Best Builds exposes directly), Goal
  (Win Priority / Fastest kill (TTK) / Max DPS / Max survival time),
  Veneration mode, Ability timing, results limit.
- Optional locks (Trait / Ascension / Plushie / Elder) that pin parts of
  Creature B's build search.

**Engine:** `runBestBuildsFlow` with `activePool = [creatureA.name]` - the
BB matchup engine searches Creature B's builds against the single fixed
opponent.

**When NOT to use Optimizer:**

- You want the best build for Creature A against many opponents → use
  **Best Builds** instead. A pool of one ranks builds on the result against
  that one opponent. No other opponent enters the ranking.
- You want to step through a fight tick-by-tick → use **Sandbox**.

## Best Builds (`src/pages/BestBuildsPage.tsx`)

**Question:** "For Creature A, what build wins the most matchups against a
realistic opponent pool?"

**Inputs:** Creature A, a pool of opponents (curated meta40 / meta60 /
custom set), search depth (soft / detailed), objective (win-rate / DPS /
TTK / effective damage / survival), aggregation tiebreakers.

**Engine:** `runBestBuildsFlow` with `activePool = [...opponentPool]`.

Optimizer is Best Builds with a pool of one opponent.

## Speed Builds (`src/pages/SpeedBuildsPage.tsx`)

**Question:** "What build makes this creature fastest on a given
movement channel?"

**Inputs:** One creature, a target channel, constraints on what the
sweep may equip, and a rank-by setting.

**Engine:** none of the above. `searchSpeedBuilds`
(`src/speed/speedSearch.ts`) sweeps builds and scores each through
`evaluateSpeed` (`src/speed/speedMath.ts`). There is no fight, so
nothing crosses the WASM boundary and no timing mode applies.

Use it for a movement question. Best Builds and Optimizer rank on combat
outcomes and read no movement channel.

## Compare (`src/pages/ComparePage.tsx`)

**Question:** "I have two specific builds - how does this fight actually
play out?"

**Inputs:** Two creature + build pairs. No search.

**Engine:** `simulate_composable_matchup_with_trace` - one run, full
trace + timeline + outcome card. The frontend hook is
`useCompareSimulation`.

Best Builds and Optimizer produce a build; "Apply to Compare A" loads it
here and Compare runs that one matchup with a full trace.

## Sandbox (`src/pages/SandboxPage.tsx`)

**Question:** "I want to manually drive a fight - step time, fire
abilities, apply statuses, override stats."

**Inputs:** Two creatures, full Manual / Semi-Auto controls, per-side
HP + status seeding, per-side stat / ability / resist / status-attack
overrides.

**Engine:** `SandboxRuntime` (Rust) holds a stateful event-loop session;
the TS bridge in `src/engine/sandboxBridge.ts` drives one step at a
time.

Sandbox is where an unexpected result from Compare, Optimizer or Best
Builds is stepped through.

## Cheat sheet

| Question | Page |
|---|---|
| Best build for A across many opponents | Best Builds |
| Best build for B against this fixed A | Optimizer |
| Fastest build on a movement channel | Speed Builds |
| How does this exact A vs B fight play out | Compare |
| Step through a fight manually | Sandbox |

## History

An earlier Optimizer page had a second mode (`solo` / `dummy`) that
optimized against synthetic stats - a pre-Best-Builds, pre-Rust design.
The current Optimizer has no solo mode. Best Builds searches against an
opponent pool and Compare runs a single named matchup, so no flow
optimizes against synthetic stats.
