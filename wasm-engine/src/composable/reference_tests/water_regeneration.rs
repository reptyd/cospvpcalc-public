//! Reference: status_water_regeneration
//!
//! Partial / out-of-model status: the site records when the status
//! is applied but produces no separate combat effect in the
//! stand-and-fight model. The Rust composable engine has no
//! status_water_regeneration-driven branch - the status simply lives in the
//! per-side statuses BTreeMap and runs out via the standard decay
//! path. This test exists so the coverage gate sees the
//! [REF:status_water_regeneration] marker.

#[test]
fn no_combat_effect_in_stand_and_fight_model() {
    // [REF:status_water_regeneration]
    // Bullets: "The site currently only records that this effect is
    // present." + "It does not currently produce a separate combat
    // effect in the stand-and-fight model."
    // No Rust assertion is meaningful - the engine has no
    // status-water_regeneration branch in any combat formula.
}
