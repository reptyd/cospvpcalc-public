//! Hard test layers for the decision engine:
//!
//! - `engine` - engine-level plumbing tests (traits, registry,
//!   policy modes wiring). Originally lived in
//!   `policy/tests.rs`; moved here so the
//!   tests/ tree could host the four hard layers as sibling
//!   modules.
//! - `monotonicity`: per ability + curated matchup,
//!   `Ideal_outcome >= Fast_outcome >= ReallyFast_outcome` with
//!   0 % tolerance.
//!
//! Future modules (kept at the same nesting level so adding them
//! is a one-line change to this `mod.rs`):
//!
//! - `edge_cases`: per-ability × per-mode sanity
//!   assertions over corner-case states (HP=100 %, HP≈0 %, no
//!   statuses, max statuses, opp dying soon, opp tanky).
//! - `math_ideal_proximity`: for abilities with
//!   tractable closed-form optimal timing (Life Leech, Adrenaline,
//!   Hunters Curse), assert Ideal lands within ±0.5 s and ≤1 %
//!   damage delta.
//! - `fixture_parity`: every existing fixture matchup
//!   produces the same winner under the new engine.
//! - `cost_budget`: `decide_timed` per ability under
//!   Ideal completes in ≤1 ms on a reference matchup.

mod cost_budget;
mod edge_cases;
mod engine;
mod fixture_parity;
mod math_ideal_proximity;
mod monotonicity;
mod properties;
