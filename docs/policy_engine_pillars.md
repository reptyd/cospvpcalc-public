# Policy / decision engine - design contract

This document is the design contract for the battle-time decision
engine under `wasm-engine/src/policy/`. The combat engine is Rust
compiled to WASM; the decision engine lives inside it. Each section
below is an invariant the module holds today. A change that breaks one
is a change to this contract, not a change under it.

## Module layout

```
wasm-engine/src/policy/
  mod.rs              re-exports + module docs
  traits.rs           the public trait surface
  state.rs            PolicyState / PolicySide / PolicyValue
  timing_mode.rs      TimingMode enum + the five built-in policies
  light_projection.rs deterministic forward-projection
  registry.rs         DecisionRegistry / PolicyRegistry
  user_ability.rs     user-defined decisions (data-driven Expr DSL)
  user_timing.rs      user-defined timing policies (UserTimingSpec)
  decisions/          built-in decision impls, one file per ability
  tests/              the engine's own test suites
  testing.rs          shared test fixtures (test builds only)
```

Translation between the live combat side (`composable::CombatSide`) and
the engine's `PolicyState` happens in bridge modules under `composable/`
(`policy_bridge.rs`, `stance_bridge.rs`, `bite_variant_bridge.rs`), so no
decision sees a combat-loop type. One import crosses the other way:
`decisions/stance.rs` pulls the posture transition constants
(`SIT_TRANSITION_SEC`, `LAY_TRANSITION_SEC`, `SIT_LAY_DIRECT_SEC`) from
`composable::posture` rather than restating them. That is the only
`composable::` import in shipped engine code; the rest sit in
`policy/tests/`, which drives whole matchups on purpose.

## 1. Scope: battle-time decisions only

The engine answers questions of the form *"should the actor take
action X now, wait, or skip it?"* during a single combat encounter.
Decisions in scope:

- **Ability activation** - when to fire Fortify, Life Leech, Hunter's
  Curse, Warden's Rage, Adrenaline, etc.
- **Toggle hold** - whether a continuous on/off ability (Hunker,
  Warden's Rage) should be ON or OFF on this tick.
- **Posture / stance** - when to stand, sit, or lie down (game-state
  changes that affect damage taken and regen).
- **Variant selection** - which of N variants of an action firing
  this tick to use. Primary vs. secondary bite is the shipped case,
  resolved by engine replay (§4).

**Out of scope:** build optimization, plushie selection, creature
composition - anything that runs *outside* a live combat encounter.
Those are different problems with different tradeoffs and live in
their own modules. The boundary is the projection: an in-scope decision
operates on a `State` that a `StateProjection` impl advances by
`delta_sec` deterministically. A build search has no such state.

## 2. One code path, no special cases

- New decisions are added by implementing a decision trait for a new
  type - never by adding `if let Some(special_case)` branches inside
  the engine.
- New state shapes (e.g. team-fight state with multiple targets) are
  added by implementing `StateProjection` for a new state type. Engine
  code stays generic over the projected `PolicyState`.
- Per-ability timing thresholds, availability gates, and value
  formulas live **inside** that ability's decision impl - not in the
  engine, not as a parallel shortcut path.
- There are not two paths for the same decision. If Life Leech is
  "analytic and cheap", that is the body of its `utility()`, not a
  separate `should_activate_life_leech` shortcut.

The registry has no concrete-type fast path. Engine call sites look up
a decision by id and dispatch through the trait; a built-in is treated
identically to a user-registered or constructor-built decision.

## 3. Plugin-friendly: built-ins are examples, not the API

User-defined decisions and policies register through the same traits and
registry as built-ins:

- **Built-in decisions** (Fortify, Life Leech, …) are example impls of
  the decision traits, not the engine's contract. They share the same
  registry and evaluation path as user-registered decisions.
- **Built-in timing modes** (ReallyFast / Fast / SemiIdeal / Ideal /
  Extreme) are themselves `Policy` impls registered with the engine. A
  custom mode registers the same way and becomes an additional
  selectable mode.
- All public traits are **object-safe** (`Box<dyn …>` works).
  Compile-time `impl Trait for SomeStruct` is a registration
  convenience for built-ins, not a requirement of the API.
- Decisions live in a **registry** (`DecisionRegistry`) keyed by an id
  namespace: `builtin.{name}` for shipped impls (`builtin.fortify`,
  `builtin.life_leech`, …); `user.{name}` for runtime-registered ones.
- A JS/WASM bridge can expose the trait surface to JS so the
  browser-side can register a decision whose `utility()` is a JS
  closure. The engine does not distinguish built-in from JS decisions.
- A visual constructor can compose decisions from primitive operators
  (e.g. `WhenStatusPresent`, `ScaleByHpRatio`, `ActivateAboveThreshold`).
  Those primitives are expressible in the same trait surface: the
  constructor emits a tree that compiles into a boxed decision. The
  engine sees no constructor-specific code.

What this rules out: any concrete-type switch (`if let
DecisionKind::Fortify`) in the engine, any per-ability hardcode at the
dispatch site, any shortcut path that bypasses the registry.

## 4. The trait surface

The engine routes four decision *shapes*, each with a paired policy
trait. Every decision trait is object-safe and carries a stable `id()`
in the `builtin.{name}` / `user.{name}` namespace.

### `TimedDecision` - one-shot fire / wait / skip

```rust
trait TimedDecision: Send + Sync {
    fn id(&self) -> &str;
    fn utility(&self, state: &PolicyState) -> f64;
    fn is_available(&self, state: &PolicyState) -> bool;
    fn really_fast_gate(&self, state: &PolicyState) -> Option<bool> { … }
}
```

`utility` is in damage-dealt-equivalent units: `> 0` is worthwhile,
`0` is neutral, `< 0` is net-negative. `is_available` is the
eligibility gate (cooldown elapsed, prerequisites met). The optional
`really_fast_gate` is consulted only by the ReallyFast policy:
`Some(true)` forces fire, `Some(false)` forces skip, `None` falls back
to evaluating utility at the current state. Its default returns
`Some(is_available(state))` - a decision plugged in without a custom
gate fires under ReallyFast as soon as it is eligible.

The paired policy is `Policy`:

```rust
trait Policy: Send + Sync {
    fn id(&self) -> &str;
    fn decide(&self, decision: &dyn TimedDecision,
              state: &PolicyState,
              projector: &dyn StateProjection) -> TimedChoice;
}
```

`TimedChoice` is `Now`, `Wait { delay_sec }`, or `Skip`. The policy is
free to call `decision.utility` on projected states however its
strategy requires; candidate enumeration is the policy's
responsibility, not the engine's.

### `ToggleDecision` - continuous ON / OFF

For abilities whose state flips between on and off across ticks
(Hunker, Warden's Rage hold). `on_off_delta(state)` returns the net
value of ON minus OFF; positive sets the toggle ON. `is_eligible`
gates evaluation; `really_fast_default` supplies the gate-only answer
for the simple modes. Paired with `TogglePolicy`.

### `VariantDecision` - pick one of N at fire time

For an action already firing this tick where the question is *which
variant*. `variants()` lists the fixed variant ids; `utility(state,
variant)` scores each; `default_variant()` is the fallback when the
decision is unavailable. Paired with `VariantPolicy`, whose built-in
form picks the argmax of `utility` and breaks ties in `variants()`
iteration order (so the conservative default is listed first).

No built-in implements this trait today. Bite variant selection, the
obvious candidate, is resolved by engine replay instead (below) because
a closed-form score for it was not tractable. The trait, its registry
slot and `MaxUtilityVariantPolicy` all ship, exercised by the tests in
`registry.rs` and `timing_mode.rs`; it is the plugin surface for a
variant decision, not a description of one the engine runs.

### `StanceDecision`, `BiteVariantReplayDecision`, `ToggleReplayDecision` - engine-replay

Posture, bite-variant and toggle-hold choices are scored by *engine
replay* rather than a closed-form utility: the decision is handed a
replayer (`StanceReplayer` / `BiteVariantReplayer` / `ToggleReplayer`)
that clones the live engine state, installs a candidate plan as an
override, runs the real engine forward over an inner horizon, and
returns a scalar fitness through the shared `compute_replay_fitness`.
The decision compares plans by fitness and commits the immediate
action. The replayer runs the inner replay with the override forced off
to avoid recursion, scoring by surviving HP and outlive duration. A
narrow read-only side view (`StanceSideView` / `BiteVariantSideView` /
`ToggleReplaySideView`) lets plans condition on dynamic state
mid-replay without exposing combat-loop types.

`ToggleReplayDecision` supersedes `ToggleDecision::on_off_delta` for
Hunker and Warden's Rage under the precision modes, behind the
`TOGGLE_ROLLOUT` flag in `composable/posture_policy.rs` (`true` today).
The analytic delta collapsed to roughly zero for
a toggle with no cooldown: a single-tick counterfactual is undone the
next tick, so nothing measurable remained. Each replay plan instead
forces the toggle to one value at every consultation across the window
(`hold_on` / `hold_off`), which prices the held effect rather than the
flip.

### `StateProjection` - deterministic forward projection

```rust
trait StateProjection: Send + Sync {
    fn project(&self, state: &PolicyState, delta_sec: f64) -> PolicyState;
}
```

Returns a projected *copy* advanced by `delta_sec`; the input is never
mutated. Search-style policies call this to ask "what would the world
look like in `t` seconds if I do nothing?" before computing utility
there. The built-in projector is `CombatStateProjection`; future state
shapes implement their own.

## 5. Determinism and purity

Every `utility` / `on_off_delta` impl is **deterministic and pure**:
the same state always produces the same number, with no side effects
on the state. The engine evaluates utility many times across projected
futures, and the monotonicity guarantee (§8) depends on this purity.

`PolicyState` is owned and immutable at the call site. The engine
projects forward by cloning and mutating the clone, never by mutating
the input. Decisions cannot be added to or removed from a registry
mid-run; a registry is constructed once per simulation and moved into
the engine.

## 6. State extensibility

`PolicyState` has two parts (`self_side` / `opponent`, each a
`PolicySide`, plus a top-level `time` and `extras`):

- **Built-in fields** - HP, statuses, per-ability cooldown and
  active-until timestamps, breath capacity and profile, next-hit /
  next-breath schedule, recent-damage windows, posture label, static
  stats. Built-in decisions read these directly via convenience
  accessors (`hp_ratio`, `bite_dps`, `status_stacks`, `is_idle_for`,
  …).
- **Extras** - a `BTreeMap<String, PolicyValue>` where `PolicyValue`
  is a tagged value (number / bool / text / list / map). These carry
  user-added or constructor-built fields, read by key. Extras exist at
  both the state level and per side.

Forward projection advances the built-in fields deterministically and
copies extras through unchanged. A user decision whose custom extras
need to evolve over time supplies its own `StateProjection` impl.

## 7. Built-in timing modes

Five modes ship as `Policy` impls. The simple modes are gate-only; the
precision modes are instances of one generic candidate-search policy
that differ only in their candidate-delay vector.

| Mode | Candidate delays (s) | Horizon | Strategy |
|------|----------------------|---------|----------|
| ReallyFast | gate-only | 0 | Honor `really_fast_gate`; otherwise skip. |
| Fast | {0, 1, 3} | 15 s | Best of 3 candidates if it beats skipping. |
| SemiIdeal | {0, 0.5, 1, 2, 4, 8} | 24 s | 6 candidates. |
| Ideal | {0, 0.25, 0.5, 1, 1.5, 2, 3, 4, 6, 8, 12} | 45 s | 11 candidates. |
| Extreme | dense grid 0-12 @ 0.1, 12.5-30 @ 0.5, 32-120 @ 2 | 120 s | ~200 candidates. |

The candidate-search policy projects state forward to each candidate
delay, skips candidates where the decision is unavailable at that
projected state, evaluates utility, and picks the argmax. If the best
utility clears the threshold and the best candidate is delay 0, it
fires `Now`; otherwise it emits `Wait { best_delay }`; if no candidate
is positive it returns `Skip`. The candidate delay is exposed to the
decision through the `__policy.search_delay_sec` extras key as
read-only context, so a decision can compensate for projection
blind-spots that scale with the wait (e.g. statuses that would
continue to be applied during it). This is context, not part of any
state transition.

Toggle and variant decisions get matching policies per mode:
ReallyFast and Fast use "on if eligible" for toggles and the argmax
for variants; the precision modes use a delta-driven toggle policy.
All five share the same variant policy shape - the look-ahead horizon
lives inside the variant decision's utility formula, not in the
policy.

### User-defined timing modes

A custom timing policy is a sixth-plus mode registered alongside the
built-ins and selectable for any decision. It is described by data
(`UserTimingSpec` in `user_timing.rs`):

- `candidates: Vec<f64>` - delay values to project to before
  evaluating utility (at least one; `0.0` means "now", no projection).
- `horizon_sec` - informational cap a decision can read to bound its
  utility integral. Not enforced at search time.
- `threshold` - utility floor below which the policy emits `Skip`.
  Built-ins use a numerical epsilon; higher values are more
  conservative.
- `force_skip` / `force_fire` - optional `Expr` gates evaluated
  against the current state, mirroring how ReallyFast consults
  `really_fast_gate`. `force_skip` is checked first; if both fire,
  skip wins.

Decisions say *what* the utility is; policies say *when* to evaluate
it (which delays, which horizon, which threshold). The five built-in
modes prove the orthogonality - they differ only in the candidate
vector. `UserTimingSpec` is the data-driven counterpart, reusing the
same `Expr` DSL as user-defined decisions so one parser/evaluator
covers both halves of the custom-ability feature.

## 8. Light projection

`CombatStateProjection` advances the built-in fields cheaply - it does
**not** run the full combat simulation. The projection's omissions,
listed at the end of this section, are accepted; the per-tick
re-projection from a fresh snapshot is the reason. Over `delta_sec` it:

- advances `time`;
- decays each persistent ailment's stacks at 1 per 3 s (mirroring the
  status-decay cadence) and subtracts that window's DoT from HP;
- drops expired self-buff windows (`active_until` < projected time);
- adds natural regen ticks at 1 per 15 s, gated by current statuses
  (Bleed disables regen, Burn reduces it, …);
- drains breath capacity 1:1 with `delta_sec`, floored at 0.

It deliberately does **not** model opponent ability activations, new
status applications during the window, or breath refill from regen.
Omitting these is consistent with the cost budget (§10); the
per-tick re-projection absorbs the drift.

## 9. Analytic and search-style decisions are the same thing

The engine does not distinguish "analytic" decisions (Life Leech:
closed-form value formula) from "search-style" decisions (Fortify:
candidate enumeration). Both are just `utility()` impls. The engine
evaluates utility at one or more projected states (per the timing
mode) and picks the best. If an ability has a clean closed form, its
`utility()` body is that formula and the policy evaluates it at one
state. If it needs candidate enumeration, the timing mode handles
enumeration generically - the ability still only writes `utility()`.

## 10. Cost discipline

Ideal mode must be cheap enough to run in interactive Compare / Best
Builds without blocking the UI. The budget is concrete: a single
`decide_timed` call under Ideal mode completes in **≤1 ms**, enforced
by `tests/cost_budget.rs` using `std::time::Instant` (no external
benchmark harness, to keep the bench in-tree). It times five decisions
- Life Leech, Fortify, Hunters Curse, Cocoon, Rewind - against a
synthetic pre-wounded side from `policy/testing.rs`, not a
`fixture_tests.rs` fixture, and asserts the mean over 200 calls rather
than a single timing, which is too noisy to gate on. A decision that
exceeds 1 ms per call is rewritten with a cheaper `utility()` body. The
budget is not raised and the test is not skipped.

## 11. Test layers

The engine ships its own test suites under `tests/`, plus
property/engine-level coverage:

- **Edge cases** (`edge_cases.rs`) - per (decision, timing mode):
  HP 100 %, HP near 0 %, no removable statuses, cooldown pending, and
  a zero-value ability. These call `utility` / `is_available` /
  `really_fast_gate` (or the toggle pair) directly - no simulation
  runs. Each case asserts the expected choice.
- **Monotonicity** (`monotonicity.rs`) - for each ability across a
  curated matchup set, the final damage dealt is non-decreasing in
  mode precision:
  `damage(Ideal) >= damage(Fast) >= damage(ReallyFast)`, at 0 %
  tolerance. A more-precise mode never produces a strictly worse
  outcome.
- **Math-ideal proximity** (`math_ideal_proximity.rs`) - for abilities
  whose optimal timing has a closed form, Ideal picks an activation
  time within ±0.5 s of the analytic optimum and within 1 % outcome
  difference. Three qualify, all pure outgoing buffs whose optimum is
  `t = 0`: Adrenaline, Unbridled Rage, Reflect. Life Leech and Hunters
  Curse are deliberately *not* here - their fire timing depends on
  accumulated incoming damage, so the analytic helper would have to
  re-implement the simulation. Monotonicity covers them instead.
- **Fixture parity** (`fixture_parity.rs`) - a smoke test, not a
  sweep: a handful of curated matchups representative of the migrated
  abilities, asserting winner and outcome stability. It exists to
  catch a regression that monotonicity cannot see, where Ideal and
  Fast degrade together. The full fixture suite in `fixture_tests.rs`
  catches the rest.
- **Reference entries** (`reference_entries.rs`) - the Ability Policy
  Reference entries driven through the registered policy rather than
  read off its constants, so a rewired gate has to answer the same way
  the entry says it does.
- **Cost budget** (`cost_budget.rs`) - §10.
- **Engine / property tests** (`engine.rs`, `properties.rs`) -
  registry routing, projection determinism, and policy invariants.

## 12. Code style

Conventions the module keeps:

- Module-level docs explain *what* and *why*, not just *how*.
- Naming follows the conventions already established (`composable/`,
  `policy/`, the `builtin.` / `user.` id namespaces).
- The public API surface is minimized: a helper not used outside its
  module is `pub(super)` or private.
