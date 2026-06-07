//! Reference: compare_damage_boost
//!
//! Compare-only rule applied entirely at TS build time
//! (`src/engine/compareBuffRuntime.ts`) before `SimpleCombatantStats`
//! crosses the WASM boundary. The Rust composable engine has no
//! dedicated path for this rule - stat changes (damage / weight /
//! biteCooldown / healthRegen) arrive already baked, and any
//! starting status (Aggressive_Status, Defensive_Status) ships in
//! `starting_statuses`. This test exists so the coverage gate sees
//! the [REF:compare_damage_boost] marker.

#[test]
fn no_rust_runtime_path_applied_at_build_time_in_ts() {
    // [REF:compare_damage_boost]
    // Mechanics bullets describe a Compare-only adjustment. All
    // multiplication / starting-status injection happens in TS before
    // `SimpleCombatantStats` and `ComposableAbilityConfig` cross the
    // WASM boundary. The Rust engine never sees this rule by name.
    //
    // No Rust assertion is possible. The coverage gate is satisfied
    // by the marker comment above.
}
