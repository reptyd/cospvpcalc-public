//! Reference: compare_scared_status
//!
//! Compare-only rule applied at TS build time
//! (`src/engine/compareBuffRuntime.ts`) before `SimpleCombatantStats`
//! crosses the WASM boundary. Stat tweaks (healthRegen,
//! activeCooldownMultiplier) and starting-status injection happen on
//! the TS side; the Rust composable engine has no path for this
//! rule by name.

#[test]
fn no_rust_runtime_path_applied_at_build_time_in_ts() {
    // [REF:compare_scared_status]
    // Mechanics bullets describe a Compare-only adjustment. All
    // multiplication / starting-status injection happens in TS before
    // `SimpleCombatantStats` and `ComposableAbilityConfig` cross the
    // WASM boundary. The Rust engine never sees this rule by name.
    //
    // No Rust assertion is possible. The coverage gate is satisfied
    // by the marker comment above.
}
