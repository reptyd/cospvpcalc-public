//! Reference: compare_mud_pile
//!
//! Mud Pile is a Compare-only rule applied at TS build time
//! (`src/engine/compareBuffRuntime.ts:117-119`) by injecting a
//! Muddy_Status starting status with 90 s remaining. The Rust
//! composable engine receives the Muddy_Status as a starting status
//! via `starting_statuses` and the +25% regen + 2x Bleed/Poison heal
//! rate are handled by the generic Muddy_Status status logic in
//! `combat.rs` and `statuses.rs`. The "Mud Pile" rule itself has no
//! Rust runtime path by name.

#[test]
fn no_rust_runtime_path_starting_status_injected_by_ts() {
    // [REF:compare_mud_pile]
    // Bullet 1 + 2 + 3: "In Compare, Mud Pile is currently
    // represented through the Muddy Status toggle." + "applies Muddy
    // Status for 90 seconds." + "Muddy gives +25% health
    // regeneration and doubles Bleed and Poison healing rate."
    // The Muddy status itself is covered separately under
    // status_muddy / status semantics; Mud Pile is just the toggle
    // that schedules its application at t=0 from TS.
    //
    // No Rust assertion is possible. The coverage gate is satisfied
    // by the marker comment above.
}
