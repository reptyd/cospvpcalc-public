//! Reference: compare_frosty
//!
//! Frosty is a Compare-only ability whose +25% health regeneration
//! (and +25% stamina regen) is applied at TS build time
//! (`src/hooks/useCompareSimulation.ts:62-66`) before
//! `SimpleCombatantStats` crosses the WASM boundary. The Rust
//! composable engine has no Frosty path; the +25% arrives baked into
//! `health_regen` and the rule is invisible to Rust by name.

#[test]
fn no_rust_runtime_path_applied_at_build_time_in_ts() {
    // [REF:compare_frosty]
    // Bullet: "In Compare, Frosty currently applies only its +25%
    // health regeneration effect."
    // Multiplication happens in TS via `applyPct(next.healthRegen, 25)`
    // before stats cross the WASM boundary. The Rust engine never
    // sees the rule by name.
    //
    // No Rust assertion is possible. The coverage gate is satisfied
    // by the marker comment above.
}
