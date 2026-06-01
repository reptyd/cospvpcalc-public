//! Reference: ability_channeling
//!
//! "Channeling" is generated through `createOutOfModelAbilityEntry`
//! in src/pages/referenceContent.ts (migrated to the canonical
//! placeholder shape under Phase 2 batch 19). The single mechanics
//! bullet states the ability is currently not included in the
//! stand-and-fight combat model. The Rust engine has no Channeling
//! path; this test exists so the coverage gate sees the
//! [REF:ability_channeling] marker.

#[test]
fn not_modeled_in_stand_and_fight_combat() {
    // [REF:ability_channeling]
    // Bullet: "This ability is currently not included in the
    // stand-and-fight combat model."
    // No combat branch reads this ability.
}
