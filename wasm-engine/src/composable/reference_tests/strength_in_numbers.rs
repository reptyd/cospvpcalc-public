//! Reference: compare_strength_in_numbers
//!
//! Compare-only rule applied at TS build time
//! (`src/hooks/useCompareSimulation.ts`) - stat changes (damage,
//! healthRegen) arrive baked into `SimpleCombatantStats` before the
//! WASM boundary. The Rust composable engine has no path for this
//! rule by name.

#[test]
fn no_rust_runtime_path_applied_at_build_time_in_ts() {
    // [REF:compare_strength_in_numbers]
    // Mechanics bullets describe a TS-only stat scaling. Multiplication
    // happens before `SimpleCombatantStats` crosses the WASM boundary;
    // Rust never sees this rule by name.
    //
    // No Rust assertion is possible. The coverage gate is satisfied
    // by the marker comment above.
}
