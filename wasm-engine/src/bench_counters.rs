//! Test-only counters used by `bench_policy_counters` and the
//! `perf_guard_*` regression gate to surface per-sim instrumentation
//! (loop iterations, policy-window projections, should-activate calls).
//!
//! **Cost discipline (round 30 audit #50):** these were previously
//! always-on atomics with a comment claiming the cost was "a few ns".
//! In practice `fetch_add(1, Relaxed)` on x86 compiles to `LOCK XADD`
//! which is ~5-10 ns per call. The composable event loop calls
//! `inc_loop_iteration` ~10^5 times per matchup, and Best Builds
//! sweeps run ~10^4-10^5 matchups — that's seconds of pure atomic
//! synchronization overhead per Best Builds run, in shipped WASM.
//!
//! Fix: the increment helpers are no-ops in non-test builds. The
//! counters + reset/snapshot exist only under `cfg(test)`. Production
//! WASM compiles the calls down to nothing (each helper is empty +
//! `#[inline(always)]`). Tests still get the instrumentation — they
//! run under `cfg(test)` which enables the real bodies.
//!
//! **Thread-local, not global (test isolation):** the test counters are
//! `thread_local!` cells, not shared statics. `cargo test` runs tests in
//! parallel, and the engine increments `inc_loop_iteration` on *every*
//! simulation — so a shared counter would be raced by every concurrently
//! running test's sims, making a single-sim measurement meaningless. With
//! a thread-local cell, a test that does `reset()` → one sim → `snapshot()`
//! reads only its own thread's count (a sim is single-threaded), regardless
//! of what other test threads are doing. No atomics are needed because each
//! cell is only ever touched by its own thread.

#[cfg(test)]
use std::cell::Cell;

#[cfg(test)]
thread_local! {
    static LOOP_ITERATIONS: Cell<u64> = const { Cell::new(0) };
    static PROJECT_POLICY_WINDOW_CALLS: Cell<u64> = const { Cell::new(0) };
    static SHOULD_ACTIVATE_CALLS: Cell<u64> = const { Cell::new(0) };
}

#[derive(Clone, Copy, Debug, Default)]
pub struct BenchSnapshot {
    pub loop_iterations: u64,
    pub project_policy_window_calls: u64,
    pub should_activate_calls: u64,
}

#[cfg(test)]
pub fn reset() {
    LOOP_ITERATIONS.with(|c| c.set(0));
    PROJECT_POLICY_WINDOW_CALLS.with(|c| c.set(0));
    SHOULD_ACTIVATE_CALLS.with(|c| c.set(0));
}

#[cfg(test)]
pub fn snapshot() -> BenchSnapshot {
    BenchSnapshot {
        loop_iterations: LOOP_ITERATIONS.with(Cell::get),
        project_policy_window_calls: PROJECT_POLICY_WINDOW_CALLS.with(Cell::get),
        should_activate_calls: SHOULD_ACTIVATE_CALLS.with(Cell::get),
    }
}

#[cfg(test)]
#[inline(always)]
pub fn inc_loop_iteration() {
    LOOP_ITERATIONS.with(|c| c.set(c.get() + 1));
}

#[cfg(not(test))]
#[inline(always)]
pub fn inc_loop_iteration() {}

#[cfg(test)]
#[inline(always)]
pub fn inc_project_policy_window() {
    PROJECT_POLICY_WINDOW_CALLS.with(|c| c.set(c.get() + 1));
}

#[cfg(not(test))]
#[inline(always)]
pub fn inc_project_policy_window() {}

#[cfg(test)]
#[inline(always)]
pub fn inc_should_activate() {
    SHOULD_ACTIVATE_CALLS.with(|c| c.set(c.get() + 1));
}

#[cfg(not(test))]
#[inline(always)]
pub fn inc_should_activate() {}
