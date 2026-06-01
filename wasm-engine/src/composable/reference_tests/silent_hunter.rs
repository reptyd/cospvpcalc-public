//! Reference: ability_silent_hunter
//!
//! "Silent Hunter" is generated through `createOutOfModelAbilityEntry`
//! in src/pages/referenceContent.ts. The single mechanics bullet
//! states the ability is currently not included in the stand-and-fight
//! combat model. The Rust engine has no Silent Hunter path; this
//! test exists so the coverage gate sees the
//! [REF:ability_silent_hunter] marker.

#[test]
fn not_modeled_in_stand_and_fight_combat() {
    // [REF:ability_silent_hunter]
    // Bullet: "This ability is currently not included in the
    // stand-and-fight combat model."
    // Silent Hunter is a stealth/awareness mechanic that does not
    // affect 1v1 combat resolution. No combat branch reads it.
}
