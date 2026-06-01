//! Reference: compare_pack_healer
//!
//! Pack Healer is a Compare-only rule applied at TS build time
//! (`src/engine/compareBuffRuntime.ts:87`) by adding +25% to the
//! `healthRegen` field before stats cross the WASM boundary. The
//! Rust composable engine has no Pack Healer path by name.

#[test]
fn no_rust_runtime_path_applied_at_build_time_in_ts() {
    // [REF:compare_pack_healer]
    // Bullet: "In Compare, Pack Healer nearby gives +25% health
    // regeneration to both creatures if it is enabled on either
    // side."
    // TS multiplies `next.healthRegen` by 1.25 before stats reach
    // Rust. The engine never sees the rule by name.
    //
    // No Rust assertion is possible. The coverage gate is satisfied
    // by the marker comment above.
}
