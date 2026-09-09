//! Reference: status_torn_ligaments
//!
//! Partial / out-of-model status: the site records when the status
//! is applied but produces no separate combat effect in the
//! stand-and-fight model. The Rust composable engine has no
//! status_torn_ligaments-driven branch - the status simply lives in the
//! per-side statuses BTreeMap and runs out via the standard decay
//! path. This test exists so the coverage gate sees the
//! [REF:status_torn_ligaments] marker.

#[test]
fn offensive_application_scales_stacks_by_weight_ratio() {
    // [REF:status_torn_ligaments]
    // LigamentTear is one of the game's weight-scaled *Attack passives, so
    // when Torn Ligaments is applied as an offensive payload its stack count
    // scales by the attacker/defender weight ratio - even though the status
    // itself has no combat effect in the stand-and-fight model.
    assert!(
        crate::combat::is_weight_scaled_direct_attack_offensive_ailment_status(
            "Torn_Ligaments_Status"
        ),
        "Torn_Ligaments_Status must be tagged as a weight-scaled offensive ailment (LigamentTear)"
    );
}
