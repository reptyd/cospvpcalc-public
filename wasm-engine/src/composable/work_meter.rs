//! Deterministic engine-work meter.
//!
//! Counts event-loop iterations - the live driver's AND every inner replay's,
//! which the `bench_count` counter deliberately excludes. The unit is a pure
//! function of the inputs: no clock, no allocation, same total on every machine
//! and every run, so a caller can size its own search against it and get the
//! same answer twice. `simulate_composable_matchup` reports the per-fight total
//! on its summary (`workUnits`); nothing inside the engine branches on it.

use std::cell::Cell;

thread_local! {
    static ENGINE_ITERS: Cell<u64> = const { Cell::new(0) };
}

/// Count one event-loop iteration.
#[inline]
pub(crate) fn note_engine_iter() {
    ENGINE_ITERS.with(|c| c.set(c.get().wrapping_add(1)));
}

/// The thread's running total. Callers price a span by differencing around it,
/// which nests correctly when one simulation drives another.
#[inline]
pub(crate) fn engine_iters() -> u64 {
    ENGINE_ITERS.with(Cell::get)
}

/// Reset the counter and return its prior value.
#[cfg(test)]
pub(crate) fn take_engine_iters() -> u64 {
    ENGINE_ITERS.with(|c| {
        let v = c.get();
        c.set(0);
        v
    })
}
