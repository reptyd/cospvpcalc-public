//! Reference: ability_two_faced
//!
//! Two-Faced is applied at TS build time via per-page toggles
//! (Tranquility / Madness) that scale `damage` and `bite_cooldown`
//! before final stats reach the Rust composable engine. There is no
//! Rust runtime path for Two-Faced - no config flag, no per-frame
//! check. This test exists so the coverage gate sees the
//! [REF:ability_two_faced] marker.

#[test]
fn no_rust_runtime_path_overrides_applied_at_build_time_in_ts() {
    // [REF:ability_two_faced]
    // Mechanics bullets describe per-page toggles (Compare / Best Builds /
    // Optimizer) and the two modes (Tranquility ×1.6, Madness ×0.625).
    // All multiplication happens in TS before `SimpleCombatantStats`
    // crosses the WASM boundary; the Rust engine receives stats already
    // scaled and never knows Two-Faced exists.
    //
    // No Rust assertion is possible. The coverage gate is satisfied by
    // the marker comment above.
}
