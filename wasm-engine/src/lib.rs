//! Creatures of Sonaria combat + active-timing engine.
//!
//! A deterministic Rust core compiled to WASM via `wasm-pack`. The same engine
//! serves a single Compare matchup and a million Best-Builds matchups — there is
//! one combat simulator, not a fast path and a slow path.
//!
//! Load-bearing pieces:
//!
//! - `composable` — the unified combat event loop. The driver lives in
//!   `composable/mod.rs`; the per-tick work is the `process_phase_*` functions
//!   in the `composable/phases` submodule.
//! - [`policy`] — the active-timing search tree (the "decision brain" that picks
//!   when activated abilities fire).
//! - [`effects`] — the [`effects::EffectKind`] status-effect vocabulary.
//! - `contracts` — the serde DTO types (e.g. [`SimpleCombatantStats`],
//!   [`Winner`]) that cross the WASM boundary and are mirrored on the TS side.
//! - `wasm_api` — the `wasm-bindgen` JS entrypoints the TypeScript bridge calls.
#![cfg_attr(test, allow(clippy::field_reassign_with_default))] // test builders favor incremental field assignment after Default::default()

mod abilities;
mod active_runtime;
pub mod bench_counters;
#[cfg(test)]
mod fixture_tests;
#[cfg(test)]
mod compare_fixture_tests;
mod actives;
mod combat;
mod compare_hunger;
mod composable;
mod contracts;
pub mod effects;
pub mod effects_registry;
pub mod policy;
mod statuses;
pub mod user_status;
mod wasm_api;

pub use contracts::*;
pub use wasm_api::*;

pub fn aggregate_best_builds_matchup_summary(
    summary: &BestBuildsMatchupSummary,
) -> BestBuildAggregate {
    let win = if summary.winner == Winner::A { 1.0 } else { 0.0 };
    let draw = if summary.winner == Winner::Draw { 1.0 } else { 0.0 };
    let survival = summary.death_time_a.unwrap_or(summary.max_time_sec);
    let avg_dps = summary.dps_a_to_b;
    let ttk_win = if summary.winner == Winner::A {
        summary.ttk_a_to_b
    } else {
        summary.max_time_sec
    };
    let immortal_damage = if summary.winner == Winner::A {
        summary.damage_dealt_a_at_b_death + summary.extended_damage_potential_a
    } else {
        summary.damage_dealt_a
    };

    BestBuildAggregate {
        win,
        draw,
        survival,
        avg_dps,
        ttk_win,
        immortal_damage,
    }
}

#[cfg(test)]
mod contour_bench;
#[cfg(test)]
mod tests;
