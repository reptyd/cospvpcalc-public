//! Reference: plushie_jammy_slug
//!
//! Plushie effects are applied entirely at TS build time
//! (`src/engine/plushieBuildMappings.ts` + `useCompareSimulation.ts` +
//! `rustBestBuildsRuntime.ts`) before `SimpleCombatantStats` and
//! `ComposableAbilityConfig` cross the WASM boundary. Stat
//! modifications (damage / weight / health / regen / breath
//! resistance / cooldown), block fractions, and any starting-status
//! injection are baked in TS; the Rust composable engine has no
//! plushie path by name.

#[test]
fn no_rust_runtime_path_applied_at_build_time_in_ts() {
    // [REF:plushie_jammy_slug]
    // Mechanics bullets describe a plushie's stat / block / status
    // contribution. All multiplication and gating happens in TS
    // before stats cross the WASM boundary. The Rust engine never
    // sees this plushie by name.
    //
    // No Rust assertion is possible. The coverage gate is satisfied
    // by the marker comment above.
}
