//! Battle-time decision engine.
//!
//! The single entry point for "should the actor take action X now,
//! wait, or skip it?" questions during a live combat encounter.
//!
//! ## Design pillars
//!
//! See `docs/policy_engine_pillars.md` (in the repo root) for the
//! authoritative design contract. Summary:
//!
//! - **Plugin-friendly.** Built-in decisions (Fortify, Life Leech, …)
//!   are example impls of [`TimedDecision`] — they share the same
//!   registry and evaluation path as future user-registered or
//!   constructor-built decisions. No engine code special-cases a
//!   built-in by name.
//! - **Object-safe traits.** Every public trait works behind
//!   `Box<dyn …>` so runtime registration (eventually from JS via
//!   `wasm_bridge` adapter, or from a visual constructor) is a
//!   first-class citizen.
//! - **One code path.** Engine evaluates utility at one or more
//!   projected states (per the timing mode) and picks the best.
//!   "Analytic" decisions just have a closed-form `utility()`;
//!   "search-style" decisions enumerate candidates through the
//!   timing mode. No shortcut paths.
//!
//! ## Module layout
//!
//! - [`traits`] — `TimedDecision`, `Policy`, `StateProjection`.
//! - [`state`] — `PolicyState` (built-in fields + `extras` HashMap).
//! - [`timing_mode`] — `TimingMode` enum + the five built-in policies.
//! - [`registry`] — `DecisionRegistry`, `PolicyRegistry`.
//! - [`light_projection`] — deterministic forward-projection helpers.
//! - `decisions/` — built-in decision impls (one file per ability).
//!
//! ## Status
//!
//! Phase 1 (foundation): traits + registry + state + light projection
//! + Fortify built-in + unit tests for the engine itself. The engine
//!   is **not yet wired into `composable/mod.rs`** — old
//!   `should_activate_*` per-ability functions remain authoritative.
//!   Phase 2 migrates abilities one at a time.

pub mod light_projection;
pub mod registry;
pub mod state;
pub mod timing_mode;
pub mod traits;
pub mod user_ability;
pub mod user_timing;

pub mod decisions;

#[cfg(test)]
pub(crate) mod testing;

#[cfg(test)]
mod tests;

pub use registry::{DecisionRegistry, PolicyRegistry, RegistryEntry};
pub use state::{PolicyState, PolicyValue};
pub use timing_mode::TimingMode;
pub use traits::{
    BiteVariant, BiteVariantReplayDecision, BiteVariantReplayer, BiteVariantSideView, Policy,
    StanceAction, StanceDecision, StancePosture, StanceReplayer, StanceSideView, StateProjection,
    TimedChoice, TimedDecision, ToggleDecision, TogglePolicy, VariantDecision, VariantPolicy,
    POLICY_SEARCH_DELAY_KEY,
};
