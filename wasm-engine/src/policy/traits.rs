//! Public traits of the decision engine.
//!
//! All traits here are object-safe so the engine can hold
//! `Box<dyn TimedDecision>` and `Box<dyn Policy>` in its registries.
//! That is what makes runtime registration (JS bridge, visual
//! constructor) possible without engine-side code changes.

use crate::policy::state::PolicyState;

/// `state.extras` key under which search-style policies
/// ([`Policy`] impls that enumerate candidate delays) expose the
/// *delay* they used to project this state. Decisions that need to
/// reason about "how far in the future is this projected state
/// from the live `now`?" - e.g. to compensate for projection
/// blind-spots like opp's continued status applies - read this key
/// and default to `0.0` when missing (gate-only / non-search
/// policies don't set it).
///
/// This is read-only context populated by the policy *before*
/// invoking `decision.utility(projected_state)`. It is not part of
/// any deterministic state transition - projections themselves do
/// not depend on it.
pub const POLICY_SEARCH_DELAY_KEY: &str = "__policy.search_delay_sec";

/// Outcome of a timed decision evaluation.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum TimedChoice {
    /// Activate immediately at the current tick.
    Now,
    /// Wait `delay_sec` and re-evaluate.
    Wait { delay_sec: f64 },
    /// Skip - do not activate within the current planning horizon.
    Skip,
}

/// A decision the engine can be asked about.
///
/// Concrete examples: "should Fortify fire now", "should the actor
/// sit / lie down", "should Life Leech be cast on this tick", ...
///
/// Each impl is self-contained: it carries its own analytic value
/// formula in [`utility`], its own availability check in
/// [`is_available`], and an optional "ReallyFast hard gate" in
/// [`really_fast_gate`]. The engine never inspects the impl's
/// concrete type.
///
/// [`utility`]: TimedDecision::utility
/// [`is_available`]: TimedDecision::is_available
/// [`really_fast_gate`]: TimedDecision::really_fast_gate
pub trait TimedDecision: Send + Sync {
    /// Stable identifier used by the registry. Built-ins use the
    /// `builtin.{name}` namespace; user/constructor-registered
    /// decisions use `user.{name}`.
    fn id(&self) -> &str;

    /// Estimated utility (in damage-dealt-equivalent units) of
    /// activating this decision at the given projected state.
    ///
    /// Convention:
    /// - `> 0` = activation is worthwhile.
    /// - `0` = no benefit, but no cost either.
    /// - `< 0` = activation is net-negative (e.g. self-cost > buff
    ///   value at low HP).
    ///
    /// Implementations must be deterministic and pure:
    /// the same `state` always produces the same number, with no
    /// side effects on `state`. The engine evaluates `utility` many
    /// times across projected futures - non-determinism breaks the
    /// monotonicity invariant.
    fn utility(&self, state: &PolicyState) -> f64;

    /// Whether this decision is even *eligible* at the given state
    /// (cooldown elapsed, prerequisites satisfied, etc.). Engine
    /// will not consider candidates where `is_available == false`.
    fn is_available(&self, state: &PolicyState) -> bool;

    /// Optional hard gate consulted by [`TimingMode::ReallyFast`].
    ///
    /// Returns:
    /// - `Some(true)` - force activate now.
    /// - `Some(false)` - force skip (e.g. Life Leech HP > 85 %).
    /// - `None` - fall back to utility math.
    ///
    /// Default: fire whenever `is_available` is satisfied. This
    /// keeps fast policies simple: a new
    /// decision plugged into the engine without a custom gate will
    /// fire under ReallyFast as soon as it is eligible. Decisions
    /// whose Reference behavior demands a stricter gate (HP ratio,
    /// stack threshold) override this method.
    ///
    /// [`TimingMode::ReallyFast`]: crate::policy::timing_mode::TimingMode::ReallyFast
    fn really_fast_gate(&self, state: &PolicyState) -> Option<bool> {
        Some(self.is_available(state))
    }
}

/// Forward-projects a [`PolicyState`] by `delta_sec` deterministically.
///
/// The engine asks for projected states when evaluating "what would
/// the world look like in `t` seconds, if I do nothing?" before
/// computing utility there.
///
/// Built-in projection is provided by
/// [`crate::policy::light_projection::CombatStateProjection`]; future
/// states (team fight, build optimization, ...) implement their own
/// projector with their own `State`-aware advance logic.
///
/// Determinism: for a fixed `state` and `delta_sec`, the output
/// must be identical across calls. The engine relies on this for the
/// monotonicity invariant.
pub trait StateProjection: Send + Sync {
    /// Returns a projected copy of `state` advanced by `delta_sec`.
    /// Original `state` must not be mutated.
    fn project(&self, state: &PolicyState, delta_sec: f64) -> PolicyState;
}

/// A toggle decision - *should the actor be ON or OFF right now?*
///
/// Different shape from [`TimedDecision`]: there is no concept of
/// "fire once and lock in"; the actor's state can flip between on
/// and off across ticks (e.g. Hunker stance, Warden's Rage hold).
/// The engine consults the registered toggle policy each tick the
/// decision is eligible and writes the resolved boolean into the
/// owning side.
///
/// Object-safe like [`TimedDecision`] for the same plugin-friendly
/// reason - user/constructor toggle decisions plug into the same
/// registry without engine code changes.
pub trait ToggleDecision: Send + Sync {
    /// Stable identifier. Built-ins use the `builtin.{name}`
    /// namespace; user-registered toggles use `user.{name}`.
    fn id(&self) -> &str;

    /// Eligibility - can the toggle be evaluated at all at the
    /// given state? (E.g. "Hunker disabled by Necropoison".) When
    /// false the engine leaves the prior toggle state in place
    /// and skips evaluation.
    fn is_eligible(&self, state: &PolicyState) -> bool;

    /// The "always on if eligible" (pi-zero) answer. The
    /// [`AlwaysOnIfEligibleTogglePolicy`] consults this whenever the
    /// toggle is eligible. Default: `Some(true)` - most toggles in
    /// this codebase ("Hunker auto-on under ReallyFast", per
    /// Reference) flip to ON. Decisions that need a different
    /// rule override.
    ///
    /// [`AlwaysOnIfEligibleTogglePolicy`]: crate::policy::timing_mode
    fn really_fast_default(&self, _state: &PolicyState) -> Option<bool> {
        Some(true)
    }
}

/// A timing policy ("ReallyFast", "Ideal", or any user-registered
/// alternative) for [`TimedDecision`]s. Decides between
/// [`TimedChoice`] options for a given decision and state.
///
/// The five built-in modes ship as built-in `Policy` impls (see
/// [`crate::policy::timing_mode`]). Users can register additional
/// policies through [`PolicyRegistry`]; the engine treats them
/// identically.
///
/// [`PolicyRegistry`]: crate::policy::registry::PolicyRegistry
pub trait Policy: Send + Sync {
    /// Stable identifier (`builtin.really_fast`, `builtin.ideal`,
    /// `user.{name}`, ...).
    fn id(&self) -> &str;

    /// Decide whether the given decision should fire now, wait, or
    /// be skipped at the given state.
    ///
    /// The policy is free to call `decision.utility` on projected
    /// states (via `projector`) however many times its strategy
    /// requires. The engine itself does not enumerate candidates -
    /// that responsibility belongs to the policy.
    fn decide(
        &self,
        decision: &dyn TimedDecision,
        state: &PolicyState,
        projector: &dyn StateProjection,
    ) -> TimedChoice;
}

/// Toggle counterpart of [`Policy`]. Each timing mode (or user
/// alternative) ships a pair: a [`Policy`] for `TimedDecision`s and
/// a [`TogglePolicy`] for `ToggleDecision`s, registered together
/// in [`crate::policy::registry::PolicyRegistry`].
pub trait TogglePolicy: Send + Sync {
    /// Stable identifier. Built-ins reuse the same id namespace
    /// as their [`Policy`] sibling but with a `.toggle` suffix:
    /// `builtin.really_fast.toggle`, `builtin.ideal.toggle`, ...
    fn id(&self) -> &str;

    /// Decide whether the toggle should be ON or OFF at the given
    /// state.
    fn decide(
        &self,
        decision: &dyn ToggleDecision,
        state: &PolicyState,
        projector: &dyn StateProjection,
    ) -> bool;
}

/// A decision that picks one of N variants at the moment an
/// action fires.
///
/// Different shape from [`TimedDecision`] (when to fire) and
/// [`ToggleDecision`] (on / off each tick): the action is already
/// firing this tick; the question is which variant to use.
///
/// Concrete examples:
/// - Primary vs. secondary bite. A bite event fires (cadence
///   driven by `next_hit`); the variant decision picks whether this
///   particular bite is the primary (lower damage + offensive
///   ailment) or the secondary (higher damage, no ailment).
/// - Two-Faced mode swap. When Two-Faced is active, every bite
///   can independently be Madness (faster, weaker) or Tranquility
///   (slower, stronger) instead of being locked to one for the
///   whole encounter.
/// - Active-ability target pick. A future case: when an actor
///   fires an ability that can target one of several opponents,
///   the variant decision picks the target.
///
/// Object-safe like [`TimedDecision`] / [`ToggleDecision`] for the
/// same plugin-friendly reason - user / constructor variant
/// decisions plug into the same registry without engine code
/// changes.
///
/// Convention: variant IDs are short stable strings (`"primary"`,
/// `"secondary"`, ...). The engine compares them by `&str`.
/// Implementations should treat variant IDs not in
/// [`Self::variants`] as undefined behavior - return
/// `f64::NEG_INFINITY` so they always lose the max-utility race.
pub trait VariantDecision: Send + Sync {
    /// Stable identifier. Built-ins use `builtin.{name}`;
    /// user-registered variant decisions use `user.{name}`.
    fn id(&self) -> &str;

    /// The fixed set of variant IDs this decision can pick among.
    /// The slice is borrowed for the lifetime of the decision; the
    /// engine treats it as immutable. Order is not significant -
    /// the engine compares variants by utility, not by position.
    fn variants(&self) -> &[&str];

    /// Utility of picking `variant` at the given state. Same purity
    /// and determinism contract as [`TimedDecision::utility`]: same
    /// inputs always produce the same number, with no side effects
    /// on `state`. Convention same as `TimedDecision::utility` -
    /// values are in damage-dealt-equivalent units; the variant
    /// policy picks the maximum.
    fn utility(&self, state: &PolicyState, variant: &str) -> f64;

    /// Whether this decision is eligible at the given state. When
    /// false the engine falls back to the decision's
    /// [`Self::default_variant`] without invoking the policy.
    fn is_available(&self, state: &PolicyState) -> bool;

    /// The variant the engine should pick when:
    /// - [`Self::is_available`] returns false, or
    /// - The variant policy under [`crate::policy::timing_mode::TimingMode::ReallyFast`]
    ///   does not engage utility evaluation.
    ///
    /// Default: `variants()[0]`. Decisions whose Reference behavior
    /// demands a different fallback override this method.
    fn default_variant(&self) -> &str {
        self.variants().first().copied().unwrap_or("")
    }
}

/// Variant counterpart of [`Policy`] / [`TogglePolicy`]. Each timing
/// mode (or user alternative) ships a triple: [`Policy`] for timed
/// decisions, [`TogglePolicy`] for toggle decisions, and
/// [`VariantPolicy`] for variant decisions, all three registered
/// together in [`crate::policy::registry::PolicyRegistry`].
pub trait VariantPolicy: Send + Sync {
    /// Stable identifier. Built-ins reuse the same id namespace
    /// as their [`Policy`] sibling but with a `.variant` suffix:
    /// `builtin.really_fast.variant`, `builtin.ideal.variant`, ...
    fn id(&self) -> &str;

    /// Decide which variant of `decision` to pick at the given
    /// state. The returned `&str` must be one of
    /// `decision.variants()` (the engine assumes this when looking
    /// up the picked variant in downstream code).
    ///
    /// When `decision.is_available(state)` is false the engine
    /// skips the policy and uses `decision.default_variant()`
    /// directly - implementations may assume availability.
    fn decide<'a>(
        &self,
        decision: &'a dyn VariantDecision,
        state: &PolicyState,
        projector: &dyn StateProjection,
    ) -> &'a str;
}

/// Posture state visible to a [`StanceDecision`] - engine-agnostic
/// mirror of `crate::composable::posture::Posture`. The bridge
/// translates between the two so the decision never sees engine
/// types.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StancePosture {
    Standing,
    Sitting,
    Laying,
}

/// Posture transition the actor should request at the current
/// decision moment. Engine-agnostic mirror of
/// `crate::composable::posture_policy::PostureAction`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StanceAction {
    /// Do nothing (or stand up from a non-Standing pending - engine
    /// resolves that based on the actor's current pending posture).
    Stay,
    StartSit,
    StartLay,
    StandUp,
}

/// Read-only view of a side's posture-relevant state. The trait
/// surface is intentionally narrow - only the fields the built-in
/// stance plans inspect - so future user-defined stance decisions
/// can implement it cheaply.
///
/// The bridge in `composable/stance_bridge.rs` adapts a `CombatSide`
/// to this view.
pub trait StanceSideView {
    /// Current pending posture (the posture the actor is in or
    /// transitioning toward). `Standing` means no transition active.
    fn pending_posture(&self) -> StancePosture;

    /// Engine time of the next scheduled regen tick for this side.
    /// `f64::INFINITY` when the side has no regen (`health_regen == 0`)
    /// or the schedule hasn't been initialised.
    fn next_regen_at(&self) -> f64;

    /// Sum of status stacks currently on the actor (across all
    /// status types). Used by status-aware lay plans that fire
    /// settled-Lay to accelerate x4 decay.
    fn total_status_stacks(&self) -> f64;
}

/// Engine-replay primitive the engine provides to a
/// [`StanceDecision`]. The decision invokes `replay_with_plan(plan)`
/// to project the outcome of executing `plan` over an inner replay
/// horizon and receives back a scalar fitness it can compare across
/// plans.
///
/// Implementations clone the engine state, install `plan` as the
/// posture-policy override, run the real engine forward with
/// `posture_policy_override: ForcedOff` on the inner replay to
/// avoid recursion, and score by surviving HP + outlive duration
/// (see `composable::posture_policy::compute_replay_fitness`).
pub trait StanceReplayer {
    /// Project `plan` and return its fitness. The `plan` closure is
    /// invoked at each scheduled posture-decision moment inside the
    /// inner replay with the actor's CURRENT side view at that
    /// moment - closures may inspect dynamic fields like
    /// `next_regen_at()` and `total_status_stacks()` mid-replay.
    fn replay_with_plan(
        &mut self,
        plan: &dyn Fn(&dyn StanceSideView, f64) -> StanceAction,
    ) -> f64;

    /// Whether the replayer is running in the bounded receding-horizon
    /// mode (terminal-value projection). When `false` (the default and
    /// the shipped behavior) the decision uses the unbounded scoring
    /// path verbatim - no death-race confirmation gate, byte-identical
    /// invocation count. The production engine bridge returns the
    /// `POSTURE_BOUNDED_HORIZON` feature flag.
    fn bounded_mode(&self) -> bool {
        false
    }

    /// Bounded-mode-only: project `plan` and return its fitness PLUS
    /// the projected death timestamps (from the actor's / opponent's
    /// perspective) so the decision can detect death-in-tail and
    /// near-tie death-races. Default delegates to
    /// [`Self::replay_with_plan`] and reports no deaths - non-bounded
    /// replayers (and tests) need no override.
    fn replay_with_plan_detailed(
        &mut self,
        plan: &dyn Fn(&dyn StanceSideView, f64) -> StanceAction,
    ) -> StanceReplayOutcome {
        StanceReplayOutcome {
            fitness: self.replay_with_plan(plan),
            me_death: None,
            op_death: None,
        }
    }

    /// Bounded-mode-only: re-project `plan` over the FULL unbounded
    /// (exact-engine) horizon - used by the death-race confirmation
    /// gate to settle who-died-last trades with the real engine rather
    /// than the terminal projection. Default delegates to
    /// [`Self::replay_with_plan`].
    fn replay_with_plan_exact(
        &mut self,
        plan: &dyn Fn(&dyn StanceSideView, f64) -> StanceAction,
    ) -> f64 {
        self.replay_with_plan(plan)
    }

    /// Whether the exact shared-prefix checkpoint DFS is enabled
    /// (`POSTURE_TREE_CHECKPOINT`). When `false` (default) the decision runs
    /// the byte-identical 4-nested-loop tree search. The production bridge
    /// returns the feature flag.
    fn tree_checkpoint_mode(&self) -> bool {
        false
    }

    /// Exact, decision-identical depth-4 tree search via shared-prefix
    /// checkpoint/fork. Enumerates every `(a1,a2,a3,a4)` over
    /// `[Stay,StartSit,StartLay,StandUp]` in the SAME lexicographic order the
    /// nested loops use, computing each leaf's outcome by advancing the inner
    /// replay one decision interval per tree node from a checkpointed state
    /// (the shared prefix simulated once, then forked), and calls `record`
    /// per leaf with the identical outcome the nested loops would produce.
    /// Returns `true` if it ran (the caller skips the nested loops); the
    /// default returns `false` so non-bridge replayers fall back.
    fn tree_search_checkpointed(
        &mut self,
        _record: &mut dyn FnMut(StanceAction, StanceAction, StanceAction, StanceAction, StanceReplayOutcome),
    ) -> bool {
        false
    }

    /// Posture<->toggle coordination (Move 2): whether the actor carries a
    /// posture-gated toggle (Hunker / Warden's Rage under the toggle rollout)
    /// whose value the posture leader should coordinate. When `true` the
    /// decision emits ONE augmented candidate - hold Standing with that toggle
    /// forced to its optimistic feasible plan - so the cold-start `(Sit, Off)`
    /// equilibrium trap can't hide the toggle's buffered-regen value from every
    /// standing candidate. Default `false` => no augmented candidate,
    /// byte-identical to the shipped path.
    fn has_coordinated_toggle(&self) -> bool {
        false
    }

    /// Score the augmented "hold Standing + toggle optimistic" candidate over
    /// the bounded window. Default (non-coordinating replayers / tests) holds
    /// Standing with no toggle coupling.
    fn replay_coordinated_standing(&mut self) -> StanceReplayOutcome {
        self.replay_with_plan_detailed(&|view: &dyn StanceSideView, _t: f64| {
            if view.pending_posture() != StancePosture::Standing {
                StanceAction::StandUp
            } else {
                StanceAction::Stay
            }
        })
    }

    /// Exact-horizon re-run of the augmented candidate for the death-race gate.
    fn replay_coordinated_standing_exact(&mut self) -> f64 {
        self.replay_with_plan_exact(&|view: &dyn StanceSideView, _t: f64| {
            if view.pending_posture() != StancePosture::Standing {
                StanceAction::StandUp
            } else {
                StanceAction::Stay
            }
        })
    }

    /// Move 2 handoff: record whether the augmented candidate won the decision,
    /// so the engine bridge can commit the toggle's optimistic plan + advance
    /// the toggle epoch in the SAME iteration (the follower's `resolve` then
    /// honors the written commit and skips its own ablation that epoch).
    /// Default no-op.
    fn note_coordinated_winner(&self, _won: bool) {}
}

/// Outcome of a bounded-mode detailed stance replay: the scalar
/// fitness plus the projected death timestamps from the actor's
/// (`me_death`) and opponent's (`op_death`) perspective. `None` => that
/// side is projected to survive to `max_time_sec`.
#[derive(Debug, Clone, Copy, Default)]
pub struct StanceReplayOutcome {
    pub fitness: f64,
    pub me_death: Option<f64>,
    pub op_death: Option<f64>,
}

/// A stance decision - *which posture transition (if any) should
/// the actor request right now?*
///
/// Shape differs from [`TimedDecision`] (one-shot fire/wait/skip)
/// and [`VariantDecision`] (pick variant of an action firing this
/// tick): stance picks one of four mutually-exclusive transitions
/// (Stay / StartSit / StartLay / StandUp), evaluated against a
/// projected inner-replay outcome rather than a closed-form
/// utility.
///
/// Object-safe like the other decision traits - future
/// user-defined stance decisions plug in via the same registry path
/// without engine code changes.
pub trait StanceDecision: Send + Sync {
    /// Stable identifier. Built-ins use `builtin.{name}`;
    /// user-registered stance decisions use `user.{name}`.
    fn id(&self) -> &str;

    /// Decide the action for the actor side viewed via `actor_view`
    /// at engine time `decision_time`. Implementations may call
    /// `replayer.replay_with_plan(plan)` any number of times to
    /// project candidate plans before committing to an action.
    fn decide(
        &self,
        actor_view: &dyn StanceSideView,
        decision_time: f64,
        replayer: &mut dyn StanceReplayer,
    ) -> StanceAction;
}

/// Bite-variant labels used by the engine-replay bite-variant
/// decision. Mirror of [`crate::policy::decisions::bite_variant`]'s
/// `PRIMARY_VARIANT` / `SECONDARY_VARIANT` constants so the trait
/// surface in `policy/traits.rs` stays self-contained.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BiteVariant {
    Primary,
    Secondary,
}

/// Read-only side view exposed to a [`BiteVariantReplayDecision`].
/// Narrow on purpose - the decision is supposed to delegate the
/// "which variant on this bite" question to the engine-replay
/// primitive ([`BiteVariantReplayer`]) rather than reason about
/// side state directly. The fields here exist for tactical plans
/// that condition on "do I even have a secondary worth picking".
pub trait BiteVariantSideView {
    /// True iff the actor has a viable secondary attack
    /// (`stats.damage2 > 0`). When false the decision short-
    /// circuits to Primary without consulting the replayer.
    fn has_secondary(&self) -> bool;
}

/// Engine-replay primitive for [`BiteVariantReplayDecision`].
/// Clones the live engine, installs `plan` as the bite-variant
/// override at every subsequent bite event in the inner replay,
/// runs forward through `max_time_sec` (or until first side death),
/// and returns the trade fitness (same compute_replay_fitness as
/// the stance decision).
///
/// `plan` is invoked once per inner-replay bite (in firing order),
/// receiving the 0-based bite index AND the side view at that
/// moment. Plans that want "this bite primary, then secondary
/// forever" use the bite index; plans that want state-aware
/// choices use the view.
pub trait BiteVariantReplayer {
    fn replay_with_plan(
        &mut self,
        plan: &dyn Fn(u32, &dyn BiteVariantSideView) -> BiteVariant,
    ) -> f64;
}

/// A per-bite variant decision - *which attack (primary vs.
/// secondary) should the actor use for the bite about to fire?*
///
/// Same shape as [`StanceDecision`] / [`VariantDecision`]: the
/// engine asks "now" at every bite event. Object-safe so future
/// user-registered bite-variant decisions plug in via the same
/// registry.
pub trait BiteVariantReplayDecision: Send + Sync {
    fn id(&self) -> &str;

    /// Pick the variant for the bite about to fire at engine time
    /// `decision_time`. Implementations call
    /// `replayer.replay_with_plan(plan)` to score candidate plans
    /// before committing the immediate (= this-bite) variant.
    fn decide(
        &self,
        actor_view: &dyn BiteVariantSideView,
        decision_time: f64,
        replayer: &mut dyn BiteVariantReplayer,
    ) -> BiteVariant;
}

/// The held state a toggle-replay decision commits at a decision
/// epoch. It is a *plan tag*, not a single boolean: the tag is
/// re-evaluated against the live side view at every consultation
/// between epochs (see [`toggle_commit_answer`]), so a time-dependent
/// plan (the Warden's Rage harvest) can drive a sub-epoch schedule
/// without storing a closure on engine state.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ToggleCommit {
    /// Force the toggle OFF at every consultation across the epoch.
    Off,
    /// Force the toggle ON at every consultation across the epoch.
    On,
    /// Warden's Rage only: hold ON, but release (OFF) in the narrow
    /// window just before the next regen tick so the buffered regen
    /// tick flushes; the passive controller re-arms on the next bite.
    Harvest,
}

/// Lead time (seconds) before a regen tick within which the
/// [`ToggleCommit::Harvest`] plan releases the manual hold so the
/// buffered regen tick flushes. Comparable to a bite cadence so a
/// real consultation event lands inside the window.
pub const TOGGLE_HARVEST_RELEASE_LEAD_SEC: f64 = 1.0;

/// Resolve a committed plan tag to the ON/OFF the actor should hold at
/// engine time `t`. Used both inside the inner replay (as the scored
/// plan) and on the live path between epochs, so both drive the toggle
/// identically.
pub fn toggle_commit_answer(
    commit: ToggleCommit,
    view: &dyn ToggleReplaySideView,
    t: f64,
) -> bool {
    match commit {
        ToggleCommit::Off => false,
        ToggleCommit::On => true,
        ToggleCommit::Harvest => {
            // Release OFF only AT the regen-tick instant. The regen event lands
            // the loop exactly on `next_regen`, and the ActiveAbilities phase
            // (which drives this toggle) sorts before Regen at that shared
            // timestamp, so the switch reads OFF when Regen heals the tick. A
            // pre-tick lead window instead let a fast opponent's bite re-arm the
            // switch before the tick (it buffers forever, never flushing) and
            // burned the carrier's own bites at 1x through the window.
            let nr = view.next_regen_at();
            let tick_now = nr.is_finite() && (nr - t).abs() <= 1e-9;
            !tick_now
        }
    }
}

/// Read-only side view exposed to a [`ToggleReplayDecision`] and its
/// plans. Narrow on purpose - the only dynamic field a toggle plan
/// conditions on is the next regen tick (the Warden's Rage harvest
/// window).
pub trait ToggleReplaySideView {
    /// Engine time of this side's next scheduled regen tick.
    /// `f64::INFINITY` when the side has no regen.
    fn next_regen_at(&self) -> f64;
}

/// Engine-replay primitive for [`ToggleReplayDecision`]. Clones the
/// live engine, installs `plan` as this toggle's override on the
/// evaluated side for the whole inner replay (every OTHER toggle runs
/// its pi-zero gate), runs forward over the bounded window with a terminal
/// projection, and returns the fitness (same `compute_replay_fitness`
/// as the stance / bite-variant decisions).
///
/// The override PERSISTS across the whole window: `plan(view, t)` is
/// consulted at every moment the evaluated toggle is decided inside
/// the replay, so a `hold_on` vs `hold_off` ablation does not collapse
/// (pi-zero cannot flip the forced value back).
pub trait ToggleReplayer {
    fn replay_with_plan(
        &mut self,
        plan: &dyn Fn(&dyn ToggleReplaySideView, f64) -> bool,
    ) -> f64;
}

/// A toggle decision resolved by engine REPLAY - *should the toggle be
/// held ON, OFF, or on a harvest schedule for the coming epoch?*
///
/// Replaces the analytic `ToggleDecision::on_off_delta` for the
/// precision modes behind the `TOGGLE_ROLLOUT` flag. Shape mirrors
/// [`StanceDecision`] / [`BiteVariantReplayDecision`]: the decision
/// scores candidate held-plans through the replayer and commits the
/// winning [`ToggleCommit`] tag, which the bridge holds across the
/// epoch.
pub trait ToggleReplayDecision: Send + Sync {
    fn id(&self) -> &str;

    /// Score the candidate held-plans over the bounded window and
    /// return the committed plan tag for the coming epoch.
    fn decide(
        &self,
        actor_view: &dyn ToggleReplaySideView,
        decision_time: f64,
        replayer: &mut dyn ToggleReplayer,
    ) -> ToggleCommit;
}
