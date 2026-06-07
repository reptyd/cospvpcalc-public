# Optimizer page - when to use it

The site has three flows for "find the right build". They share the Rust
matchup engine (`runBestBuildsFlow` for two of them, `simulate_composable_matchup_*`
for the third) but differ in what the user is solving for. Pick the one
that matches the question.

## Optimizer (`src/pages/OptimizerPage.tsx`)

**Question:** "I'm fighting Creature A with a specific build - what's the
best Creature B build to counter that?"

**Inputs:**

- Creature A + a fully-specified build (Veneration / Traits / Ascension /
  Plushies / Elder). The build is locked through the run.
- Creature B (the side the optimizer searches builds for).
- Search settings: Optimization Mode (`fast` / `guaranteed`), Goal
  (Win priority / Effective damage / DPS), Veneration mode, Ability
  timing, results limit.
- Optional locks (Trait / Ascension / Plushie / Elder) that pin parts of
  Creature B's build search.

**Engine:** `runBestBuildsFlow` with `activePool = [creatureA.name]` - the
BB matchup engine searches Creature B's builds against the single fixed
opponent.

**When NOT to use Optimizer:**

- You want the best build for Creature A against many opponents → use
  **Best Builds** instead. Optimizer's single-opponent pool would give a
  build that beats *exactly* that opponent and may lose to anything else.
- You want to step through a fight tick-by-tick → use **Sandbox**.

## Best Builds (`src/pages/BestBuildsPage.tsx`)

**Question:** "For Creature A, what build wins the most matchups against a
realistic opponent pool?"

**Inputs:** Creature A, a pool of opponents (curated meta40 / meta60 /
custom set), search depth (soft / detailed), objective (win-rate / DPS /
TTK / effective damage / survival), aggregation tiebreakers.

**Engine:** `runBestBuildsFlow` with `activePool = [...opponentPool]`.

Best Builds is the production "I want the best general-purpose build"
flow. Optimizer is the specialized "vs this one creature" flow that
falls out of it when the pool has length 1.

## Compare (`src/pages/ComparePage.tsx`)

**Question:** "I have two specific builds - how does this fight actually
play out?"

**Inputs:** Two creature + build pairs. No search.

**Engine:** `simulate_composable_matchup_with_trace` - one run, full
trace + timeline + outcome card. The frontend hook is
`useCompareSimulation`.

This is the bottom of the funnel: Best Builds / Optimizer surface a
build, you click "Apply to Compare A", and Compare shows the matchup in
detail.

## Sandbox (`src/pages/SandboxPage.tsx`)

**Question:** "I want to manually drive a fight - step time, fire
abilities, apply statuses, override stats."

**Inputs:** Two creatures, full Manual / Semi-Auto controls, per-side
HP + status seeding, per-side stat / ability / resist / status-attack
overrides.

**Engine:** `SandboxRuntime` (Rust) holds a stateful event-loop session;
the TS bridge in `src/engine/sandboxBridge.ts` drives one step at a
time.

This is the diagnostic surface - the thing you reach for when the other
three give a surprising outcome and you want to see *why*.

## Cheat sheet

| Question | Page |
|---|---|
| Best build for A across many opponents | Best Builds |
| Best build for B against this fixed A | Optimizer |
| How does this exact A vs B fight play out | Compare |
| Step through a fight manually | Sandbox |

## History

An earlier Optimizer page had a second mode (`solo` / `dummy`) that
optimized against synthetic stats - a pre-Best-Builds, pre-Rust design.
The current Optimizer drops solo entirely; Best Builds + Compare cover
the same ground better.
