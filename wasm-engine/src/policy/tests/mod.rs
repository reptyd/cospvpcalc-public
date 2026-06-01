//! Phase 3 hard test layers (per `docs/policy_engine_pillars.md`
//! pillar 5):
//!
//! - `engine` — engine-level plumbing tests (traits, registry,
//!   policy modes wiring). Originally lived in
//!   `policy/tests.rs`; moved here when Phase 3 began so the
//!   tests/ tree could host the four hard layers as sibling
//!   modules.
//! - `monotonicity` — pillar 5.2: per ability + curated matchup,
//!   `Ideal_outcome >= Fast_outcome >= ReallyFast_outcome` with
//!   0 % tolerance.
//!
//! Future modules (kept at the same nesting level so adding them
//! is a one-line change to this `mod.rs`):
//!
//! - `edge_cases` — pillar 5.1: per-ability × per-mode sanity
//!   assertions over corner-case states (HP=100 %, HP≈0 %, no
//!   statuses, max statuses, opp dying soon, opp tanky).
//! - `math_ideal_proximity` — pillar 5.3: for abilities with
//!   tractable closed-form optimal timing (Life Leech, Adrenaline,
//!   Hunters Curse), assert Ideal lands within ±0.5 s and ≤1 %
//!   damage delta.
//! - `fixture_parity` — pillar 5.4: every existing fixture matchup
//!   produces the same winner under the new engine.
//! - `cost_budget` — pillar 9: `decide_timed` per ability under
//!   Ideal completes in ≤1 ms on a reference matchup.

mod cost_budget;
mod edge_cases;
mod engine;
mod fixture_parity;
mod math_ideal_proximity;
mod monotonicity;
mod properties;
