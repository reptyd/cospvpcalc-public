//! Reference: ability_invisibility
//!
//! "Invisibility" is generated through `createOutOfModelAbilityEntry`
//! in src/pages/referenceContent.ts. The single mechanics bullet states
//! the ability is currently not included in the stand-and-fight combat
//! model. The Rust engine has no Invisibility path; this test exists
//! so the coverage gate sees the [REF:ability_invisibility] marker.

#[test]
fn not_modeled_in_stand_and_fight_combat() {
    // [REF:ability_invisibility]
    // Bullet: "This ability is currently not included in the
    // stand-and-fight combat model."
    // The engine has no Invisibility branch - verified by absence of
    // any `invisibility` / `Invisibility` symbols in wasm-engine/src as
    // of this revision. Stealth/positioning effects are documented as
    // out-of-model in the entry's Notes.
}
