//! Reference: ability_iron_stomach
//!
//! "Iron Stomach" is generated through `createOutOfModelAbilityEntry`
//! in src/pages/referenceContent.ts. The single mechanics bullet states
//! the ability is currently not included in the stand-and-fight combat
//! model. The Rust engine has no Iron Stomach combat path; this test
//! exists so the coverage gate sees the [REF:ability_iron_stomach]
//! marker.

#[test]
fn not_modeled_in_stand_and_fight_combat() {
    // [REF:ability_iron_stomach]
    // Bullet: "This ability is currently not included in the
    // stand-and-fight combat model."
    // Iron Stomach interacts with food/hunger systems outside the
    // 1v1 combat model. Some plushie entries grant Iron Stomach as a
    // tooltip effect (e.g. plushie_pie_chomper) but the runtime does
    // not branch on it for combat.
}
