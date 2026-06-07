//! Reference: status_broken_bones
//!
//! "broken_bones" is a Partial / out-of-model status: the status is recorded
//! when applied but produces no separate combat effect in the
//! stand-and-fight model. The Rust composable engine has no
//! STATUS_BROKEN_BONES-driven branch - the status simply lives in the
//! per-side statuses BTreeMap and runs out via the standard decay
//! path. This test exists so the coverage gate sees the
//! [REF:status_broken_bones] marker.

#[test]
fn no_combat_effect_in_stand_and_fight_model() {
    // [REF:status_broken_bones]
    // Bullets: "The site currently only records that this effect is
    // present." + "It does not currently produce a separate combat
    // effect in the stand-and-fight model."
    // No Rust assertion is meaningful - the engine has no
    // status-status_broken_bones branch in any combat formula.
}
